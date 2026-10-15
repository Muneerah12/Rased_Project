"""Lazy loading of the threat-detection models, with status (separate from models_loader).

  weapon    YOLO11n gun/knife fine-tune            hf:cosgun99/gun-knife-yolo11n
  audio     Audio Spectrogram Transformer (AudioSet) hf:MIT/ast-finetuned-audioset-10-10-0.4593
  violence  VideoMAE-base Violence / NonViolence     hf:cliffer1/videomae-base-finetuned-kinetics-violence-nonviolence-tuned
  tracker   a separate YOLO instance of the existing COCO weights (people tracking)

Nothing here touches the models used by detectors.py: each model is its own instance
with its own lock, so threat analysis never waits on (or blocks) the existing detectors.
"""

from __future__ import annotations

import os
import threading
import time
from typing import Any, Callable, Dict

from . import settings as S

MODEL_INFO: Dict[str, Dict[str, str]] = {
    "weapon": {"name": "YOLO11n weapons (gun/knife)", "source": f"hf:{S.WEAPON_REPO}"},
    "audio": {"name": "AST AudioSet (gunshot/explosion)", "source": f"hf:{S.AUDIO_MODEL}"},
    "violence": {"name": "VideoMAE-base violence", "source": f"hf:{S.VIOLENCE_MODEL}"},
    "tracker": {"name": "YOLO26s people tracking", "source": S.TRACK_WEIGHTS},
}

_lock = threading.Lock()
# one model loads (or downloads) at a time: concurrent first-time downloads share the bandwidth, so the
# audio model a user is waiting on finished only after the violence model (~37 s instead of ~15 s)
_load_lock = threading.Lock()
_cache: Dict[str, Any] = {}
_status: Dict[str, Dict[str, Any]] = {k: {"state": "idle", "error": "", "at": 0.0} for k in MODEL_INFO}
# one inference lock per model (PyTorch modules are not safe to call from several threads at once)
locks: Dict[str, threading.Lock] = {k: threading.Lock() for k in MODEL_INFO}


def _token() -> str | None:
    return os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_HUB_TOKEN") or None


def _get(key: str, loader: Callable[[], Any]) -> Any:
    with _lock:
        if key in _cache:
            return _cache[key]
    with _load_lock:  # a caller of a model already loading waits for it instead of loading it a second time
        with _lock:
            if key in _cache:
                return _cache[key]
            st = _status[key]
            if st["state"] == "failed" and time.time() - st["at"] < 60:
                raise RuntimeError(st["error"])
            _status[key] = {"state": "loading", "error": "", "at": time.time()}
        t0 = time.time()
        try:
            model = loader()
        except Exception as exc:  # noqa: BLE001
            with _lock:
                _status[key] = {"state": "failed", "error": str(exc)[:300], "at": time.time()}
            print(f"[threat] model {key} failed: {exc}")
            raise
        with _lock:
            _cache[key] = model
            _status[key] = {"state": "ready", "error": "", "at": time.time()}
    print(f"[threat] model {key} ready ({time.time() - t0:.1f}s)")
    return model


def get_weapon_model():
    def load():
        from huggingface_hub import hf_hub_download
        from ultralytics import YOLO

        return YOLO(hf_hub_download(S.WEAPON_REPO, S.WEAPON_FILE, token=_token()))

    return _get("weapon", load)


def get_audio_model():
    """Returns (feature_extractor, model, {label_name: index})."""
    def load():
        from transformers import ASTFeatureExtractor, ASTForAudioClassification

        fe = ASTFeatureExtractor.from_pretrained(S.AUDIO_MODEL, token=_token())
        model = ASTForAudioClassification.from_pretrained(S.AUDIO_MODEL, token=_token()).eval()
        return fe, model, {v: int(k) for k, v in model.config.id2label.items()}

    return _get("audio", load)


def get_violence_model():
    """Returns (image_processor, model, index_of_violence_label)."""
    def load():
        from transformers import VideoMAEForVideoClassification, VideoMAEImageProcessor

        proc = VideoMAEImageProcessor.from_pretrained(S.VIOLENCE_MODEL, token=_token())
        model = VideoMAEForVideoClassification.from_pretrained(S.VIOLENCE_MODEL, token=_token()).eval()
        idx = None
        for k, v in model.config.id2label.items():
            name = str(v).lower().replace("-", "").replace("_", "").replace(" ", "")
            if name in ("violence", "fight", "violent"):
                idx = int(k)
        if idx is None:
            raise RuntimeError(f"no violence/fight label in {model.config.id2label}")
        return proc, model, idx

    return _get("violence", load)


def new_tracker():
    """A YOLO instance of its own per analysis job (never the one detectors.py uses)."""
    def load():
        from ultralytics import YOLO

        YOLO(S.TRACK_WEIGHTS)  # validates the weights once (download if missing)
        return True

    _get("tracker", load)
    from ultralytics import YOLO

    return YOLO(S.TRACK_WEIGHTS)


def models_status() -> Dict[str, Any]:
    with _lock:
        return {k: {**MODEL_INFO[k], **_status[k]} for k in MODEL_INFO}


def preload() -> None:
    # audio first: attaching a video to the threat camera waits for it (the others start on live frames)
    for key, fn in (("audio", get_audio_model), ("weapon", get_weapon_model), ("tracker", new_tracker), ("violence", get_violence_model)):
        try:
            fn()
        except Exception as exc:  # noqa: BLE001
            print(f"[threat] preload {key} unavailable ({exc})")
