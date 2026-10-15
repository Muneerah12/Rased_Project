"""Recorded footage analysis: the uploaded file is kept on the server, sampled at
VIDEO_SAMPLE_FPS, run through the same detectors and an EventEngine whose clock is
the video time. Detected events go through the journal like live ones (source=recorded).
"""

from __future__ import annotations

import threading
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List

import cv2

import config
from detectors import reset_session, run_enabled
from events import EventEngine

_jobs: Dict[str, Dict[str, Any]] = {}
_lock = threading.Lock()


def create_job(path: Path, file_name: str, camera: Dict[str, Any], models: List[str], direction: str, video_url: str) -> Dict[str, Any]:
    job_id = uuid.uuid4().hex[:12]
    job = {
        "id": job_id, "state": "queued", "progress": 0.0, "file_name": file_name, "camera_id": camera["id"],
        "models": models, "direction": direction, "video_url": video_url, "events": [], "timeline": [],
        "frames_analyzed": 0, "duration_sec": None, "error": "", "created_at": int(time.time() * 1000),
        "max_people": 0,
    }
    with _lock:
        _jobs[job_id] = job
    threading.Thread(target=_run, args=(job, path, dict(camera)), daemon=True).start()
    return job


def get_job(job_id: str) -> Dict[str, Any] | None:
    with _lock:
        j = _jobs.get(job_id)
        return None if j is None else {**j, "timeline": j["timeline"][-600:]}


def _run(job: Dict[str, Any], path: Path, camera: Dict[str, Any]) -> None:
    session = f"job:{job['id']}"
    cap = cv2.VideoCapture(str(path))
    try:
        if not cap.isOpened():
            raise RuntimeError("the video could not be opened (unsupported codec?)")
        fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
        total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        job["duration_sec"] = round(total / fps, 1) if total else None
        step = max(1, int(round(fps / max(0.2, config.VIDEO_SAMPLE_FPS))))
        cam = {**camera, "models": job["models"], "direction": job["direction"]}

        def on_event(ev: Dict[str, Any]) -> None:
            if ev["phase"] == "start":
                job["events"].append(ev)
            else:
                for i, e in enumerate(job["events"]):
                    if e["id"] == ev["id"]:
                        job["events"][i] = ev

        engine = EventEngine(cam, source="recorded", file_name=job["file_name"], video_url=job["video_url"], on_event=on_event)
        job["state"] = "running"
        idx = 0
        last_t = 0.0
        while True:
            ok = cap.grab()
            if not ok:
                break
            if idx % step == 0:
                ok, frame = cap.retrieve()
                if not ok:
                    break
                t = idx / fps
                last_t = t
                res = run_enabled(frame, cam["models"], session, cam["direction"])
                engine.process(res, frame, t, offset_sec=t)
                job["frames_analyzed"] += 1
                job["max_people"] = max(job["max_people"], int(res.get("people_count") or 0))
                job["timeline"].append({"t": round(t, 2), "people": res.get("people_count"), "alerts": res.get("alerts", [])})
                if total:
                    job["progress"] = min(0.999, idx / total)
            idx += 1
        engine.flush(last_t + config.EVENT_END_AFTER_S)
        job["progress"] = 1.0
        job["state"] = "done"
    except Exception as exc:  # noqa: BLE001
        job["state"] = "failed"
        job["error"] = str(exc)[:300]
    finally:
        cap.release()
        reset_session(session)
