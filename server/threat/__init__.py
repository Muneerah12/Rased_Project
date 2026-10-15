"""AI Threat & Abnormal Behaviour Detection — an add-on to the existing Rasid AI.

Self-contained: own models, own locks, own routes (/api/threat/*). The existing detectors,
event engine, video jobs and endpoints are untouched; main.py only calls the two hooks below,
and both are no-ops when the feature is disabled (RASID_THREAT_ENABLED=0) or fails to import.
"""

from __future__ import annotations

import threading
from pathlib import Path
from typing import Any, Dict

from . import settings

_ready = False


def setup(app) -> None:
    """Register /api/threat/* and warm the models in the background."""
    global _ready
    if not settings.ENABLED:
        print("[threat] disabled (RASID_THREAT_ENABLED=0)")
        return
    try:
        from .api import router
        from .models import preload

        app.include_router(router)
        if settings.env_bool("RASID_THREAT_PRELOAD", True):
            threading.Thread(target=preload, daemon=True, name="threat-preload").start()
        _ready = True
    except Exception as exc:  # noqa: BLE001 — never block the existing server
        print(f"[threat] not available: {exc}")


def on_live_frame(camera: Dict[str, Any], frame) -> list:
    """Hand a live camera frame to threat detection (own thread, never blocks).
    Returns the newest threat boxes for that camera to show on the live view ([] when off)."""
    if not _ready:
        return []
    try:
        from .live import submit

        return submit(camera, frame)
    except Exception as exc:  # noqa: BLE001 — never disturb the existing live analysis
        print(f"[threat] live frame skipped: {exc}")
        return []


def local_gunshot_classifier():
    """classify(raw, filename, content_type) for the IoT microphone when OpenRouter is not configured,
    or None when the add-on is disabled or unavailable."""
    if not _ready:
        return None
    try:
        from .mic import classify_clip

        return classify_clip
    except Exception as exc:  # noqa: BLE001
        print(f"[threat] local gunshot classifier not available: {exc}")
        return None


def on_video_uploaded(job_id: str, path: Path, file_name: str, camera: Dict[str, Any], video_url: str) -> None:
    """Start the threat analysis of an uploaded video next to the existing analysis."""
    if not _ready:
        return
    try:
        from .jobs import start

        start(job_id, path, file_name, camera, video_url)
    except Exception as exc:  # noqa: BLE001
        print(f"[threat] could not start analysis for {job_id}: {exc}")
