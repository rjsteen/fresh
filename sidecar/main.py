"""
ML Sidecar — internal-only FastAPI service.

Responsibilities:
- Accumulate anonymized training data batches from the Phoenix backend
- Train transaction categorization models on accumulated data
- Export trained models to ONNX format
- Upload model weights to Cloudflare R2 CDN
- Trigger model:updated signals via the Phoenix backend

NEVER exposed publicly. Runs in the Docker Compose network only.
No financial data ever enters this service — it trains on category-labelled
feature vectors only (hashed/anonymized at export time).
"""

import asyncio
import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

import boto3
import httpx
import numpy as np
from fastapi import FastAPI, BackgroundTasks, HTTPException, Security
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
import skl2onnx
from skl2onnx import convert_sklearn
from skl2onnx.common.data_types import FloatTensorType
from sklearn.linear_model import SGDClassifier
from sklearn.preprocessing import LabelEncoder
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
import joblib

app = FastAPI(title="Fresh ML Sidecar", docs_url=None, redoc_url=None)
security = HTTPBearer()

SIDECAR_TOKEN = os.environ.get("SIDECAR_TOKEN", "dev-sidecar-token")
PHOENIX_INTERNAL_URL = os.environ.get("PHOENIX_INTERNAL_URL", "http://backend:4000")
R2_ENDPOINT = os.environ.get("R2_ENDPOINT_URL")
R2_BUCKET = os.environ.get("R2_BUCKET", "finapp-models")
R2_ACCESS_KEY = os.environ.get("R2_ACCESS_KEY_ID")
R2_SECRET_KEY = os.environ.get("R2_SECRET_ACCESS_KEY")

MODELS_DIR = Path("/tmp/models")
MODELS_DIR.mkdir(exist_ok=True)

# Input dimensionality must match packages/core/src/ml/inference.ts
INPUT_DIM = 100  # 64 merchant + 32 text + 4 numeric

# ---------------------------------------------------------------------------
# In-memory training data store (per model type)
# Populated by POST /training-data; consumed by POST /train
# ---------------------------------------------------------------------------

_training_store: dict[str, list[dict]] = {"categorizer": [], "anomaly": []}
_store_lock = asyncio.Lock()


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------

def verify_token(credentials: HTTPAuthorizationCredentials = Security(security)):
    if credentials.credentials != SIDECAR_TOKEN:
        raise HTTPException(status_code=403, detail="Invalid sidecar token")
    return credentials


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class TrainingExample(BaseModel):
    features: list[float]      # INPUT_DIM floats (pre-extracted on device, anonymized)
    label: str                 # category_id for categorizer; ignored for anomaly


class TrainingBatch(BaseModel):
    model_type: Literal["categorizer", "anomaly"]
    examples: list[TrainingExample]


class TrainRequest(BaseModel):
    model_type: Literal["categorizer", "anomaly"]
    category_ids: list[str]    # Ordered class list (categorizer only; defines output shape)


class TrainResponse(BaseModel):
    model_type: str
    version: str
    cdn_path: str
    checksum_sha256: str
    num_examples: int
    num_classes: int


# ---------------------------------------------------------------------------
# Training data ingestion
# ---------------------------------------------------------------------------

@app.post("/training-data", status_code=204)
async def ingest_training_data(
    batch: TrainingBatch,
    _auth=Security(verify_token),
):
    """
    Accept a batch of anonymized feature vectors from the Phoenix backend.
    The backend aggregates these from opted-in devices before forwarding here.
    Data accumulates in memory until the next /train run, then is cleared.
    """
    if not batch.examples:
        raise HTTPException(400, "Batch must contain at least one example")

    if any(len(e.features) != INPUT_DIM for e in batch.examples):
        raise HTTPException(
            400,
            f"All feature vectors must have exactly {INPUT_DIM} dimensions"
        )

    async with _store_lock:
        _training_store[batch.model_type].extend(
            {"features": e.features, "label": e.label} for e in batch.examples
        )


@app.get("/training-data/stats")
async def training_data_stats(_auth=Security(verify_token)):
    """Return the number of accumulated examples per model type."""
    async with _store_lock:
        return {model_type: len(examples) for model_type, examples in _training_store.items()}


# ---------------------------------------------------------------------------
# Training
# ---------------------------------------------------------------------------

def _make_version(onnx_bytes: bytes) -> str:
    """Generate a version string: YYYYMMDD-<sha8>."""
    date_str = datetime.now(timezone.utc).strftime("%Y%m%d")
    sha8 = hashlib.sha256(onnx_bytes).hexdigest()[:8]
    return f"{date_str}-{sha8}"


@app.post("/train", response_model=TrainResponse)
async def train_model(
    req: TrainRequest,
    background_tasks: BackgroundTasks,
    _auth=Security(verify_token),
):
    async with _store_lock:
        raw_examples = list(_training_store[req.model_type])

    if len(raw_examples) < 10:
        raise HTTPException(
            400,
            f"Need at least 10 accumulated training examples for {req.model_type} "
            f"(have {len(raw_examples)}). Send data via POST /training-data first."
        )

    X = np.array([e["features"] for e in raw_examples], dtype=np.float32)

    if req.model_type == "categorizer":
        if not req.category_ids:
            raise HTTPException(400, "category_ids is required for categorizer training")

        le = LabelEncoder()
        le.fit(req.category_ids)
        y_raw = [e["label"] for e in raw_examples]
        unknown = set(y_raw) - set(req.category_ids)
        if unknown:
            raise HTTPException(400, f"Training data contains unknown category labels: {unknown}")
        y = le.transform(y_raw)

        onnx_bytes, checksum = train_categorizer(X, y, le, req.category_ids)
    else:
        onnx_bytes, checksum = train_anomaly_detector(X)

    version = _make_version(onnx_bytes)
    cdn_path = f"models/{req.model_type}/{version}/model.onnx"
    local_path = MODELS_DIR / f"{req.model_type}_{version}.onnx"
    local_path.write_bytes(onnx_bytes)

    # Clear accumulated data for this model type now that training succeeded
    async with _store_lock:
        _training_store[req.model_type].clear()

    background_tasks.add_task(
        upload_and_notify,
        local_path=local_path,
        cdn_path=cdn_path,
        model_type=req.model_type,
        version=version,
        checksum=checksum,
        category_ids=req.category_ids if req.model_type == "categorizer" else None,
    )

    return TrainResponse(
        model_type=req.model_type,
        version=version,
        cdn_path=cdn_path,
        checksum_sha256=checksum,
        num_examples=len(raw_examples),
        num_classes=len(req.category_ids),
    )


def train_categorizer(
    X: np.ndarray, y: np.ndarray, le: LabelEncoder, category_ids: list[str]
) -> tuple[bytes, str]:
    clf = Pipeline([
        ("scaler", StandardScaler()),
        ("clf", SGDClassifier(
            loss="modified_huber",
            max_iter=1000,
            tol=1e-4,
            random_state=42,
            class_weight="balanced",
        )),
    ])
    clf.fit(X, y)

    initial_type = [("input", FloatTensorType([None, INPUT_DIM]))]
    onnx_model = convert_sklearn(clf, initial_types=initial_type, target_opset=17)

    onnx_bytes = onnx_model.SerializeToString()
    checksum = hashlib.sha256(onnx_bytes).hexdigest()
    return onnx_bytes, checksum


def train_anomaly_detector(X: np.ndarray) -> tuple[bytes, str]:
    """
    One-Class SVM anomaly detector exported to ONNX.
    nu≈0.05 treats ~5% of transactions as anomalous.
    Replace with an autoencoder for production-scale data.
    IsolationForest is preferred algorithmically but has a skl2onnx 1.17 export bug.
    """
    from sklearn.svm import OneClassSVM

    clf = Pipeline([
        ("scaler", StandardScaler()),
        ("clf", OneClassSVM(kernel="rbf", nu=0.05, gamma="scale")),
    ])
    clf.fit(X)

    initial_type = [("input", FloatTensorType([None, INPUT_DIM]))]
    onnx_model = convert_sklearn(clf, initial_types=initial_type, target_opset=17)

    onnx_bytes = onnx_model.SerializeToString()
    checksum = hashlib.sha256(onnx_bytes).hexdigest()
    return onnx_bytes, checksum


# ---------------------------------------------------------------------------
# CDN upload + Phoenix notification
# ---------------------------------------------------------------------------

async def upload_and_notify(
    local_path: Path,
    cdn_path: str,
    model_type: str,
    version: str,
    checksum: str,
    category_ids: list[str] | None,
):
    # Upload ONNX model to R2
    upload_to_r2(local_path, cdn_path)

    # Upload category map alongside the model weights (categorizer only)
    if category_ids is not None:
        map_path = cdn_path.replace("model.onnx", "categories.json")
        category_map = json.dumps({"category_ids": category_ids}).encode()
        upload_bytes_to_r2(category_map, map_path, content_type="application/json")

    # Notify Phoenix backend to upsert model_versions and broadcast model:updated
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{PHOENIX_INTERNAL_URL}/internal/models/notify",
            json={
                "model_type": model_type,
                "version": version,
                "cdn_path": cdn_path,
                "checksum_sha256": checksum,
            },
            headers={"X-Internal-Token": SIDECAR_TOKEN},
            timeout=10.0,
        )
        resp.raise_for_status()


def upload_to_r2(local_path: Path, cdn_path: str):
    s3 = boto3.client(
        "s3",
        endpoint_url=R2_ENDPOINT,
        aws_access_key_id=R2_ACCESS_KEY,
        aws_secret_access_key=R2_SECRET_KEY,
        region_name="auto",
    )
    with local_path.open("rb") as f:
        s3.upload_fileobj(
            f,
            R2_BUCKET,
            cdn_path,
            ExtraArgs={"ContentType": "application/octet-stream", "CacheControl": "public, max-age=31536000, immutable"},
        )


def upload_bytes_to_r2(data: bytes, cdn_path: str, content_type: str):
    import io
    s3 = boto3.client(
        "s3",
        endpoint_url=R2_ENDPOINT,
        aws_access_key_id=R2_ACCESS_KEY,
        aws_secret_access_key=R2_SECRET_KEY,
        region_name="auto",
    )
    s3.upload_fileobj(
        io.BytesIO(data),
        R2_BUCKET,
        cdn_path,
        ExtraArgs={"ContentType": content_type},
    )


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

@app.get("/health")
async def health():
    return {"status": "ok"}
