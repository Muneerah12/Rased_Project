"""Lazy-load YOLO weights (Ultralytics + Hugging Face Hub) and track their status.

Models (same as the lama-main project):
  coco        YOLO26s COCO (people)                 -> yolo26s.pt (Ultralytics release)
  fire_smoke  D-Fire fine-tune: 0=smoke, 1=fire     -> rabahdev/fire-smoke-yolov8n
  fall        0=fallen, 1=sitting, 2=standing       -> melihuzunoglu/human-fall-detection

If PyTorch/Ultralytics are missing or a download fails, the detectors fall back to
OpenCV-only methods (see detectors.py) and the status says so.
"""

from __future__ import annotations

import os
import threading
import time
from typing import Any, Dict

from config import DETECTOR_MODE

_lock = threading.Lock()
_cache: Dict[str, Any] = {}

FIRE_SMOKE_REPO = "rabahdev/fire-smoke-yolov8n"
FIRE_SMOKE_FILE = "best.pt"
FALL_REPO = "melihuzunoglu/human-fall-detection"
FALL_FILE = "best.pt"
COCO_WEIGHTS = os.environ.get("RASID_COCO_WEIGHTS", "yolo26s.pt")

MODEL_INFO = {
    "coco": {"name": "YOLO26s (COCO)", "source": COCO_WEIGHTS},
    "fire_smoke": {"name": "YOLOv8n fire/smoke (D-Fire)", "source": f"hf:{FIRE_SMOKE_REPO}"},
    "fall": {"name": "YOLO human fall", "source": f"hf:{FALL_REPO}"},
}

# key -> {"state": idle|loading|ready|failed|disabled, "error": str, "at": float}
_status: Dict[str, Dict[str, Any]] = {k: {"state": "idle", "error": "", "at": 0.0} for k in MODEL_INFO}

_yolo_cls = None
_yolo_import_error = ""


def _yolo():
    """Import ultralytics.YOLO once; return None when unavailable."""
    global _yolo_cls, _yolo_import_error
    if DETECTOR_MODE == "lite":
        _yolo_import_error = "RASID_DETECTOR=lite"
        return None
    if _yolo_cls is None and not _yolo_import_error:
        try:
            from ultralytics import YOLO  # noqa: WPS433

            _yolo_cls = YOLO
        except Exception as exc:  # noqa: BLE001
            _yolo_import_error = f"ultralytics/torch unavailable: {exc}"
            print(f"[models] {_yolo_import_error}")
    return _yolo_cls


def yolo_available() -> bool:
    return _yolo() is not None


def _token() -> str | None:
    return os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_HUB_TOKEN") or None


def _download(repo_id: str, filename: str) -> str:
    from huggingface_hub import hf_hub_download

    return hf_hub_download(repo_id=repo_id, filename=filename, token=_token())


def _get(key: str, loader):
    """Return the cached model, loading it once. Raises on failure (callers fall back)."""
    with _lock:
        if key in _cache:
            return _cache[key]
        st = _status[key]
        # do not hammer a failing download on every frame: retry after 60 s
        if st["state"] == "failed" and time.time() - st["at"] < 60:
            raise RuntimeError(st["error"])
        yolo = _yolo()
        if yolo is None:
            _status[key] = {"state": "disabled", "error": _yolo_import_error, "at": time.time()}
            raise RuntimeError(_yolo_import_error)
        _status[key] = {"state": "loading", "error": "", "at": time.time()}
        try:
            model = loader(yolo)
        except Exception as exc:  # noqa: BLE001
            _status[key] = {"state": "failed", "error": str(exc)[:300], "at": time.time()}
            print(f"[models] {key} failed: {exc}")
            raise
        _cache[key] = model
        _status[key] = {"state": "ready", "error": "", "at": time.time()}
        print(f"[models] {key} ready")
        return model


def get_coco_model():
    return _get("coco", lambda Y: Y(COCO_WEIGHTS))


def get_fire_smoke_model():
    return _get("fire_smoke", lambda Y: Y(_download(FIRE_SMOKE_REPO, FIRE_SMOKE_FILE)))


def get_fall_model():
    return _get("fall", lambda Y: Y(_download(FALL_REPO, FALL_FILE)))


def models_status() -> Dict[str, Any]:
    device = "cpu"
    if _yolo_cls is not None:
        try:
            import torch

            device = "cuda" if torch.cuda.is_available() else "cpu"
        except Exception:  # noqa: BLE001
            pass
    return {
        "mode": "lite" if _yolo() is None else "yolo",
        "device": device,
        "error": _yolo_import_error,
        "models": {k: {**MODEL_INFO[k], **_status[k]} for k in MODEL_INFO},
    }


def preload_models() -> None:
    """Warm caches in background so the first frame is faster."""
    for key, fn in (("coco", get_coco_model), ("fire_smoke", get_fire_smoke_model), ("fall", get_fall_model)):
        try:
            fn()
        except Exception as exc:  # noqa: BLE001
            print(f"[preload] {key} unavailable -> fallback ({exc})")
