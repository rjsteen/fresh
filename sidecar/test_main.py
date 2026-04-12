"""
Tests for the ML sidecar FastAPI app.

Run with: pytest sidecar/test_main.py -v

External dependencies (R2 upload, Phoenix notify) are patched out so tests
run without network access or running containers.
"""

import asyncio
import re
from unittest.mock import AsyncMock, MagicMock, patch

import numpy as np
import pytest
from fastapi.testclient import TestClient

from main import INPUT_DIM, _training_store, app


AUTH = {"Authorization": "Bearer dev-sidecar-token"}
BAD_AUTH = {"Authorization": "Bearer wrong"}


@pytest.fixture(autouse=True)
def clear_store():
    """Reset in-memory training store between tests."""
    _training_store["categorizer"].clear()
    _training_store["anomaly"].clear()
    yield
    _training_store["categorizer"].clear()
    _training_store["anomaly"].clear()


@pytest.fixture()
def client():
    return TestClient(app)


def make_examples(n: int, labels: list[str] | None = None) -> list[dict]:
    rng = np.random.default_rng(0)
    examples = []
    for i in range(n):
        label = (labels[i % len(labels)] if labels else "cat_0")
        examples.append({
            "features": rng.random(INPUT_DIM).tolist(),
            "label": label,
        })
    return examples


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------

def test_training_data_requires_auth(client):
    resp = client.post("/training-data", json={"model_type": "categorizer", "examples": []})
    assert resp.status_code == 403


def test_train_requires_auth(client):
    resp = client.post("/train", json={"model_type": "categorizer", "category_ids": ["a"]})
    assert resp.status_code == 403


def test_wrong_token_rejected(client):
    resp = client.get("/training-data/stats", headers=BAD_AUTH)
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# POST /training-data
# ---------------------------------------------------------------------------

def test_ingest_stores_examples(client):
    examples = make_examples(5, labels=["groceries", "transport"])
    resp = client.post(
        "/training-data",
        json={"model_type": "categorizer", "examples": examples},
        headers=AUTH,
    )
    assert resp.status_code == 204
    assert len(_training_store["categorizer"]) == 5


def test_ingest_anomaly_examples(client):
    examples = make_examples(3, labels=["normal"])
    resp = client.post(
        "/training-data",
        json={"model_type": "anomaly", "examples": examples},
        headers=AUTH,
    )
    assert resp.status_code == 204
    assert len(_training_store["anomaly"]) == 3


def test_ingest_accumulates_across_batches(client):
    examples = make_examples(4, labels=["groceries"])
    client.post("/training-data", json={"model_type": "categorizer", "examples": examples}, headers=AUTH)
    client.post("/training-data", json={"model_type": "categorizer", "examples": examples}, headers=AUTH)
    assert len(_training_store["categorizer"]) == 8


def test_ingest_empty_batch_rejected(client):
    resp = client.post(
        "/training-data",
        json={"model_type": "categorizer", "examples": []},
        headers=AUTH,
    )
    assert resp.status_code == 400


def test_ingest_wrong_feature_dim_rejected(client):
    bad = [{"features": [0.1] * 50, "label": "groceries"}]  # wrong dim
    resp = client.post(
        "/training-data",
        json={"model_type": "categorizer", "examples": bad},
        headers=AUTH,
    )
    assert resp.status_code == 400
    assert str(INPUT_DIM) in resp.text


# ---------------------------------------------------------------------------
# GET /training-data/stats
# ---------------------------------------------------------------------------

def test_stats_returns_counts(client):
    examples = make_examples(7, labels=["a", "b"])
    client.post("/training-data", json={"model_type": "categorizer", "examples": examples}, headers=AUTH)
    resp = client.get("/training-data/stats", headers=AUTH)
    assert resp.status_code == 200
    data = resp.json()
    assert data["categorizer"] == 7
    assert data["anomaly"] == 0


# ---------------------------------------------------------------------------
# POST /train — categorizer
# ---------------------------------------------------------------------------

@pytest.fixture()
def mock_upload_and_notify():
    """Patch the background upload+notify so tests don't hit R2 or Phoenix."""
    with patch("main.upload_and_notify", new_callable=AsyncMock) as m:
        yield m


def test_train_categorizer_succeeds(client, mock_upload_and_notify):
    category_ids = ["groceries", "transport", "entertainment"]
    examples = make_examples(30, labels=category_ids)
    client.post("/training-data", json={"model_type": "categorizer", "examples": examples}, headers=AUTH)

    resp = client.post(
        "/train",
        json={"model_type": "categorizer", "category_ids": category_ids},
        headers=AUTH,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["model_type"] == "categorizer"
    assert body["num_examples"] == 30
    assert body["num_classes"] == 3
    assert body["cdn_path"].startswith("models/categorizer/")
    assert body["cdn_path"].endswith("/model.onnx")
    # checksum is a hex SHA-256
    assert re.fullmatch(r"[0-9a-f]{64}", body["checksum_sha256"])


def test_train_categorizer_version_format(client, mock_upload_and_notify):
    category_ids = ["a", "b"]
    examples = make_examples(20, labels=category_ids)
    client.post("/training-data", json={"model_type": "categorizer", "examples": examples}, headers=AUTH)

    resp = client.post(
        "/train",
        json={"model_type": "categorizer", "category_ids": category_ids},
        headers=AUTH,
    )
    version = resp.json()["version"]
    assert re.fullmatch(r"\d{8}-[0-9a-f]{8}", version), f"Unexpected version format: {version}"


def test_train_clears_store_after_success(client, mock_upload_and_notify):
    category_ids = ["a", "b"]
    examples = make_examples(20, labels=category_ids)
    client.post("/training-data", json={"model_type": "categorizer", "examples": examples}, headers=AUTH)

    client.post(
        "/train",
        json={"model_type": "categorizer", "category_ids": category_ids},
        headers=AUTH,
    )
    assert len(_training_store["categorizer"]) == 0


def test_train_insufficient_data_rejected(client):
    examples = make_examples(5, labels=["a", "b"])
    client.post("/training-data", json={"model_type": "categorizer", "examples": examples}, headers=AUTH)

    resp = client.post(
        "/train",
        json={"model_type": "categorizer", "category_ids": ["a", "b"]},
        headers=AUTH,
    )
    assert resp.status_code == 400
    assert "10" in resp.text


def test_train_no_data_rejected(client):
    resp = client.post(
        "/train",
        json={"model_type": "categorizer", "category_ids": ["a", "b"]},
        headers=AUTH,
    )
    assert resp.status_code == 400


def test_train_unknown_label_rejected(client, mock_upload_and_notify):
    category_ids = ["groceries", "transport"]
    examples = make_examples(20, labels=category_ids)
    # Inject an example with an unknown label
    examples[0]["label"] = "unknown_category"
    client.post("/training-data", json={"model_type": "categorizer", "examples": examples}, headers=AUTH)

    resp = client.post(
        "/train",
        json={"model_type": "categorizer", "category_ids": category_ids},
        headers=AUTH,
    )
    assert resp.status_code == 400
    assert "unknown_category" in resp.text


# ---------------------------------------------------------------------------
# POST /train — anomaly
# ---------------------------------------------------------------------------

def test_train_anomaly_succeeds(client, mock_upload_and_notify):
    examples = make_examples(50, labels=["normal"])
    client.post("/training-data", json={"model_type": "anomaly", "examples": examples}, headers=AUTH)

    resp = client.post(
        "/train",
        json={"model_type": "anomaly", "category_ids": []},
        headers=AUTH,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["model_type"] == "anomaly"
    assert body["num_examples"] == 50
    assert body["cdn_path"].startswith("models/anomaly/")
    assert re.fullmatch(r"[0-9a-f]{64}", body["checksum_sha256"])


def test_train_anomaly_clears_store(client, mock_upload_and_notify):
    examples = make_examples(20, labels=["normal"])
    client.post("/training-data", json={"model_type": "anomaly", "examples": examples}, headers=AUTH)

    client.post("/train", json={"model_type": "anomaly", "category_ids": []}, headers=AUTH)
    assert len(_training_store["anomaly"]) == 0


def test_model_stores_are_independent(client, mock_upload_and_notify):
    """Ingesting categorizer data must not affect the anomaly store and vice versa."""
    cat_examples = make_examples(15, labels=["a", "b"])
    client.post("/training-data", json={"model_type": "categorizer", "examples": cat_examples}, headers=AUTH)

    anon_examples = make_examples(5, labels=["normal"])
    client.post("/training-data", json={"model_type": "anomaly", "examples": anon_examples}, headers=AUTH)

    assert len(_training_store["categorizer"]) == 15
    assert len(_training_store["anomaly"]) == 5


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

def test_health(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}
