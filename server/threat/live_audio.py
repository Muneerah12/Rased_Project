"""Gunshot sound of a video file attached to a live camera (the camera tile's "attach video").

The browser plays an attached file muted and sends the camera only pictures, so the sound is
analyzed from the file itself, when it is attached (`analyze`), with the same AST model as uploaded
videos. The page then reports when playback reaches each detected shot (`trigger`), and the shot
becomes a live event of that camera — security team, snapshot of the camera's current picture —
exactly when it is heard in the video.

The file starts playing the moment it is attached, so the analysis runs in the background in time
order and the page polls (`get`): a shot near the start is known within a second, long before
playback reaches it. Besides the impulsive sounds (sharp energy rises), the whole soundtrack is
probed every SCAN_HOP_S: sustained fire has no sharp rise against the fire before it, and one louder
blast lowers the onset floor below everything else.
"""

from __future__ import annotations

import os
import tempfile
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np

from . import settings as S
from .audio import SR, analyze_audio, boom_hit, extract_audio, gun_hit, impulsive_onsets

_lock = threading.Lock()
_files: Dict[str, Dict[str, Any]] = {}  # id -> {camera_id, shots, done, cancelled, at}
MAX_FILES = 50
SCAN_HOP_S = 1.0     # a probe window (2 s, ending at the probe time) every second of the soundtrack
CHUNK = 2            # probes classified per step (≈0.5 s of CPU): shots are published after each step
BURST_GAP_S = 1.5    # hits closer than this are one burst of fire (one shot entry, one alert)
SILENT_RMS = 1e-3    # probe windows quieter than this are not classified


def _hit(w: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    gun, boom = gun_hit(w), boom_hit(w)
    if not (gun or boom):
        return None
    return {"t": w["peak_t"], "t_end": w["peak_t"], "labels": ([w["kind"]] if gun else []) + (["explosion"] if boom else []),
            "score": round(max(w["gunshot"] if gun else 0.0, w["explosion"] if boom else 0.0), 3), "top": w["top"]}


def _probes(samples: np.ndarray) -> List[float]:
    """Impulsive sounds plus a probe every SCAN_HOP_S over the non-silent soundtrack, in time order."""
    dur = len(samples) / SR
    times = list(impulsive_onsets(samples))
    for t in np.arange(min(SCAN_HOP_S, dur), dur + 1e-3, SCAN_HOP_S):
        a, b = int(max(0.0, t - 2 * S.AUDIO_WINDOW_S) * SR), int(t * SR)
        if b - a >= SR // 4 and float(np.sqrt(np.mean(samples[a:b] ** 2))) >= SILENT_RMS \
                and all(abs(t - u) >= 0.5 for u in times):  # an onset nearby already covers it
            times.append(round(float(t), 2))
    return sorted(times)


def _run(file_id: str, samples: np.ndarray) -> None:
    rec = _files[file_id]
    try:
        probes = _probes(samples)
        for i in range(0, len(probes), CHUNK):
            if rec["cancelled"]:
                return
            for w in analyze_audio(samples, fast=True, onsets=probes[i : i + CHUNK]):
                h = _hit(w)
                if h is None:
                    continue
                with _lock:
                    last = rec["shots"][-1] if rec["shots"] else None
                    if last is not None and h["t"] - last["t_end"] <= BURST_GAP_S:
                        last["t_end"] = max(last["t_end"], h["t"])
                        last["labels"] = sorted(set(last["labels"]) | set(h["labels"]))
                        if h["score"] > last["score"]:
                            last["score"], last["top"] = h["score"], h["top"]
                    else:
                        rec["shots"].append(h)
            rec["progress"] = round(min(1.0, (i + CHUNK) / max(1, len(probes))), 2)
    except Exception as exc:  # noqa: BLE001 — model unavailable: report it to the page
        rec["error"] = str(exc)[:200]
        print(f"[threat-live-audio] {file_id} failed: {exc}")
    finally:
        rec["done"] = True


def _public(file_id: str, rec: Dict[str, Any]) -> Dict[str, Any]:
    with _lock:
        shots = [{"i": i, "t": s["t"], "t_end": s["t_end"], "labels": list(s["labels"]), "score": s["score"]}
                 for i, s in enumerate(rec["shots"])]
    return {"id": file_id, "camera_id": rec["camera_id"], "has_audio": rec["has_audio"], "done": rec["done"],
            "progress": rec["progress"], "error": rec["error"], "shots": shots}


def analyze(camera_id: str, raw: bytes, filename: str) -> Dict[str, Any]:
    """Decode the attached file's soundtrack and start finding its shots in the background.
    Raises ValueError for unreadable files."""
    suffix = Path(filename or "clip.mp4").suffix or ".mp4"
    fd, tmp = tempfile.mkstemp(suffix=suffix, prefix="rasid-live-audio-")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(raw)
        try:
            samples = extract_audio(Path(tmp))
        except Exception as exc:  # noqa: BLE001
            raise ValueError(f"could not read the file's audio: {exc}") from exc
    finally:
        try:
            os.unlink(tmp)
        except OSError:
            pass
    file_id = uuid.uuid4().hex[:12]
    has_audio = samples is not None and len(samples) > 1600
    rec = {"camera_id": camera_id, "shots": [], "has_audio": has_audio, "done": not has_audio, "progress": 0.0 if has_audio else 1.0,
           "error": "", "cancelled": False, "at": time.time()}
    with _lock:
        for other in _files.values():  # a new file on this camera replaces the one analyzed before
            if other["camera_id"] == camera_id:
                other["cancelled"] = True
        if len(_files) >= MAX_FILES:
            _files.pop(min(_files, key=lambda k: _files[k]["at"]))
        _files[file_id] = rec
    if has_audio:
        threading.Thread(target=_run, args=(file_id, samples), daemon=True, name=f"threat-live-audio-{file_id}").start()
    return _public(file_id, rec)


def get(file_id: str) -> Optional[Dict[str, Any]]:
    """Shots found so far in an attached file (None if unknown)."""
    with _lock:
        rec = _files.get(file_id)
    return None if rec is None else _public(file_id, rec)


def trigger(file_id: str, index: int) -> Optional[Dict[str, Any]]:
    """Playback reached shot `index` of an analyzed file: raise it on the camera (None if unknown)."""
    from .live import _workers  # the camera's live worker: its emitter and current picture

    with _lock:
        rec = _files.get(file_id)
        shot = dict(rec["shots"][index]) if rec is not None and 0 <= index < len(rec["shots"]) else None
    if shot is None:
        return None
    worker = _workers.get(rec["camera_id"])
    if worker is None:
        return {"ok": False, "reason": "camera is not analyzing (no live frames yet)"}
    hit = {"score": shot["score"], "labels": shot["labels"], "boxes": [],
           "extra": {"audio_top": shot["top"], "file_time_sec": shot["t"], "file_time_end_sec": shot["t_end"]}}
    worker.emitter.observe("gunshot", "gunshot", time.time(), hit, worker.last_frame)
    return {"ok": True}

