"""
ML Sidecar — internal-only FastAPI service.

Responsibilities:
- Train transaction categorization models on anonymized data
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
from pathlib import Path
from typing import Literal

import boto3
import httpx
import numpy as np
import onnx
import onnxmltools
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
    category_id: str


class TrainRequest(BaseModel):
    model_type: Literal["categorizer", "anomaly"]
    examples: list[TrainingExample]
    category_ids: list[str]    # Ordered list of category IDs (defines output classes)
    version: str               # Caller-specified semver, e.g. "1.2.3"


class TrainResponse(BaseModel):
    model_type: str
    version: str
    cdn_path: str
    checksum_sha256: str
    num_examples: int
    num_classes: int


class TriggerUpdateRequest(BaseModel):
    model_type: Literal["categorizer", "anomaly"]
    version: str
    cdn_path: str
    checksum_sha256: str


# ---------------------------------------------------------------------------
# Training
# ---------------------------------------------------------------------------

@app.post("/train", response_model=TrainResponse)
async def train_model(
    req: TrainRequest,
    background_tasks: BackgroundTasks,
    _auth=Security(verify_token),
):
    if len(req.examples) < 10:
        raise HTTPException(400, "Need at least 10 training examples")

    X = np.array([e.features for e in req.examples], dtype=np.float32)
    y_raw = [e.category_id for e in req.examples]

    le = LabelEncoder()
    le.fit(req.category_ids)
    y = le.transform(y_raw)

    if req.model_type == "categorizer":
        onnx_bytes, checksum = train_categorizer(X, y, le, req.category_ids)
    else:
        onnx_bytes, checksum = train_anomaly_detector(X, y)

    cdn_path = f"models/{req.model_type}/{req.version}/model.onnx"
    local_path = MODELS_DIR / f"{req.model_type}_{req.version}.onnx"
    local_path.write_bytes(onnx_bytes)

    background_tasks.add_task(
        upload_and_notify,
        local_path=local_path,
        cdn_path=cdn_path,
        model_type=req.model_type,
        version=req.version,
        checksum=checksum,
        category_ids=req.category_ids if req.model_type == "categorizer" else None,
    )

    return TrainResponse(
        model_type=req.model_type,
        version=req.version,
        cdn_path=cdn_path,
        checksum_sha256=checksum,
        num_examples=len(req.examples),
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

    # Export to ONNX
    initial_type = [("input", FloatTensorType([None, INPUT_DIM]))]
    onnx_model = convert_sklearn(clf, initial_types=initial_type, target_opset=17)

    onnx_bytes = onnx_model.SerializeToString()
    checksum = hashlib.sha256(onnx_bytes).hexdigest()
    return onnx_bytes, checksum


def train_anomaly_detector(X: np.ndarray, y: np.ndarray) -> tuple[bytes, str]:
    """
    Simple isolation-forest-style anomaly detector exported to ONNX.
    For the prototype, we use a one-class SVM; replace with a proper
    autoencoder for production.
    """
    from sklearn.svm import OneClassSVM
    from sklearn.covariance import EllipticEnvelope

    clf = Pipeline([
        ("scaler", StandardScaler()),
        ("clf", EllipticEnvelope(contamination=0.05, random_state=42)),
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

    # Notify Phoenix backend to broadcast model:updated to all devices
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
