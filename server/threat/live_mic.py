"""Gunshot sound from the microphone of a live browser camera (the camera tile's "device camera").

A live camera sends the server only pictures, so the page also streams the device microphone:
16 kHz mono 16-bit PCM in short chunks (`push`). Each camera keeps the last few seconds; every
HOP_S the 2 s window ending now is classified by the AST model when something is heard in it (an
impulsive sound, or clearly louder than the room), and a hit is raised at once as a live gunshot
event of that camera — same emitter, team and snapshot as the camera's other threat events.
"""

from __future__ import annotations

import threading
import time
from collections import deque
from typing import Any, Deque, Dict, Optional

import numpy as np

from . import settings as S
from .audio import SR, analyze_audio, boom_hit, gun_hit, impulsive_onsets

HOP_S = 0.25         # a window is classified at most this often
WINDOW_S = 2.0       # classified window, ending at the newest sample
KEEP_S = 4.0         # audio kept per camera
SILENT_RMS = 2e-3    # quieter windows are never classified
LOUDER = 2.5         # ... nor windows below LOUDER × the room level, unless they hold an impulsive sound
IDLE_S = 30.0        # a camera's mic worker stops after this long without audio


class _Mic(threading.Thread):
    def __init__(self, camera_id: str) -> None:
        super().__init__(daemon=True, name=f"threat-live-mic-{camera_id}")
        self.camera_id = camera_id
        self.cond = threading.Condition()
        self.buf = np.zeros(0, np.float32)
        self.new = 0                 # samples received since the last classified window
        self.last_audio = time.time()
        self.room: Deque[float] = deque(maxlen=int(10 / HOP_S))  # window levels of the last ~10 s
        self.level = 0.0
        self.last_hit: Optional[Dict[str, Any]] = None
        self.error = ""

    def push(self, pcm: np.ndarray) -> None:
        with self.cond:
            self.buf = np.concatenate([self.buf, pcm])[-int(KEEP_S * SR):]
            self.new += len(pcm)
            self.last_audio = time.time()
            self.cond.notify()

    def run(self) -> None:
        while True:
            with self.cond:
                while self.new < HOP_S * SR:
                    if time.time() - self.last_audio > IDLE_S:
                        with _lock:
                            if _mics.get(self.camera_id) is self:
                                _mics.pop(self.camera_id)
                        return
                    self.cond.wait(timeout=1.0)
                self.new = 0
                win = self.buf[-int(WINDOW_S * SR):].copy()
            try:
                self._classify(win)
            except Exception as exc:  # noqa: BLE001 — model unavailable: reported on the page
                self.error = str(exc)[:200]

    def _classify(self, win: np.ndarray) -> None:
        if len(win) < SR // 2:
            return
        rms = float(np.sqrt(np.mean(win.astype(np.float64) ** 2)))
        self.level = rms
        room = float(np.median(self.room)) if self.room else rms
        self.room.append(rms)
        dur = len(win) / SR
        tail = [t for t in impulsive_onsets(win) if t >= dur - HOP_S - 0.3]  # a sharp sound since the last window
        if rms < SILENT_RMS or not (tail or rms >= LOUDER * room):
            return
        w = analyze_audio(win, fast=True, onsets=[dur])[0]
        gun, boom = gun_hit(w), boom_hit(w)
        if not (gun or boom):
            return
        from .live import _workers  # the camera's live worker: its emitter and current picture

        labels = ([w["kind"]] if gun else []) + (["explosion"] if boom else [])
        score = round(max(w["gunshot"] if gun else 0.0, w["explosion"] if boom else 0.0), 3)
        self.last_hit = {"at": int(time.time() * 1000), "labels": labels, "score": score}
        worker = _workers.get(self.camera_id)
        if worker is None:
            return
        hit = {"score": score, "labels": labels, "boxes": [], "extra": {"audio_top": w["top"], "audio_source": "live_mic"}}
        worker.emitter.observe("gunshot", "gunshot", time.time(), hit, worker.last_frame)


_lock = threading.Lock()
_mics: Dict[str, _Mic] = {}


def push(camera_id: str, raw: bytes) -> Dict[str, Any]:
    """Add a chunk of 16 kHz mono int16 little-endian PCM from a camera's microphone."""
    pcm = np.frombuffer(raw[: len(raw) // 2 * 2], dtype="<i2").astype(np.float32) / 32768.0
    with _lock:
        mic = _mics.get(camera_id)
        if mic is None:
            mic = _mics[camera_id] = _Mic(camera_id)
            mic.start()
    if len(pcm):
        mic.push(pcm)
    return {"ok": True, "level": round(mic.level, 4), "last_hit": mic.last_hit, "error": mic.error}
