"""Turns threat detections into Rasid AI events (same shape and path as events.EventEngine).

Every event goes through the shared journal as AI_EVENT, so each Rasid screen creates the
event → alert → incident chain, with a snapshot, and the notifier routes it to the security team.
Extra details (all boxes, end time, zone) ride along in the "threat" field; older clients ignore it.
"""

from __future__ import annotations

import random
import threading
import time
from collections import deque
from typing import Any, Callable, Deque, Dict, List, Optional

import cv2
import numpy as np

import config
from events import persist_event
from hub import hub, now_ms

from . import settings as S

# kind -> Rasid event category
KIND_CATEGORY = {
    "weapon": "weapon",
    "gunshot": "gunshot",
    "violence": "abnormal_behavior",
    "running": "abnormal_behavior",
    "intrusion": "abnormal_behavior",
}
# kind -> key in models.MODEL_INFO
MODEL_OF = {"weapon": "weapon", "gunshot": "audio", "violence": "violence", "running": "tracker", "intrusion": "tracker"}
# BGR
COLORS = {"gun": (40, 40, 230), "knife": (30, 90, 240), "violence": (200, 60, 170), "running": (0, 150, 255),
          "intrusion": (220, 40, 220), "zone": (220, 40, 220)}
TEXT = {"gun": "GUN", "knife": "KNIFE", "violence": "VIOLENCE", "running": "RUNNING", "intrusion": "RESTRICTED AREA"}


def new_event_id() -> str:
    return f"AIE-{time.strftime('%Y%m%d-%H%M%S')}-{random.randint(0, 0xFFFF):04X}"


def draw(frame: np.ndarray, boxes: List[Dict[str, Any]], header: str, zones: Optional[List[Dict[str, Any]]] = None) -> np.ndarray:
    out = frame.copy()
    h, w = out.shape[:2]
    thick = max(2, int(round(min(w, h) / 300)))
    fs = max(0.5, min(w, h) / 800)
    for z in zones or []:
        pts = np.array([[int(x * w), int(y * h)] for x, y in z["polygon"]], dtype=np.int32)
        overlay = out.copy()
        cv2.fillPoly(overlay, [pts], COLORS["zone"])
        out = cv2.addWeighted(overlay, 0.18, out, 0.82, 0)
        cv2.polylines(out, [pts], True, COLORS["zone"], thick)
    for b in boxes:
        x1, y1, x2, y2 = [int(round(v)) for v in b["box"]]
        x1, y1, x2, y2 = max(0, x1), max(0, y1), min(w - 1, x2), min(h - 1, y2)
        lab = b.get("label", "")
        color = COLORS.get(lab, (40, 40, 230))
        cv2.rectangle(out, (x1, y1), (x2, y2), color, thick + 1)
        text = f"{TEXT.get(lab, str(lab).upper())} {int(round(float(b.get('score', 0)) * 100))}%"
        (tw, th), _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, fs, 1)
        ty = max(th + 6, y1)
        cv2.rectangle(out, (x1, ty - th - 6), (x1 + tw + 6, ty), color, -1)
        cv2.putText(out, text, (x1 + 3, ty - 4), cv2.FONT_HERSHEY_SIMPLEX, fs, (255, 255, 255), 1, cv2.LINE_AA)
    bar = int(30 * fs / 0.5)
    cv2.rectangle(out, (0, 0), (w, bar), (25, 25, 120), -1)
    cv2.putText(out, header, (8, int(bar * 0.68)), cv2.FONT_HERSHEY_SIMPLEX, fs, (255, 255, 255), 1, cv2.LINE_AA)
    return out


class _Track:
    def __init__(self, window: int) -> None:
        self.window: Deque[bool] = deque(maxlen=max(1, window))
        self.active: Optional[Dict[str, Any]] = None
        self.last_hit: float = -1e9


class ThreatEmitter:
    """One per analysis job (times are video seconds) or per live camera (live=True, wall-clock seconds)."""

    def __init__(self, camera: Dict[str, Any], file_name: Optional[str], video_url: Optional[str], models: Dict[str, str],
                 on_event: Callable[[Dict[str, Any]], None], live: bool = False) -> None:
        self.camera = camera
        self.file_name = file_name
        self.video_url = video_url
        self.models = models
        self.on_event = on_event
        self.live = live
        self.tracks: Dict[str, _Track] = {}
        self.lock = threading.RLock()  # a live camera's worker and its gunshot requests share this emitter

    def _off(self, t: float) -> Optional[float]:
        """Position in the video; live events have none."""
        return None if self.live else round(t, 2)

    # rules per kind: (window, hits needed)
    @staticmethod
    def _rule(kind: str):
        if kind == "weapon":
            return S.WEAPON_WINDOW, min(S.WEAPON_MIN_HITS, S.WEAPON_WINDOW)
        if kind == "violence":
            return S.VIOLENCE_MIN_HITS, S.VIOLENCE_MIN_HITS
        return 1, 1  # gunshot (instant), running / intrusion (already time-debounced)

    @staticmethod
    def _gap(kind: str) -> float:
        """Silence that ends an event; violence is only sampled every VIOLENCE_STRIDE_S, so one
        missed clip must not split a fight in two."""
        if kind == "violence":
            return max(S.EVENT_GAP_S, 2 * S.VIOLENCE_STRIDE_S + 0.5)
        return S.EVENT_GAP_S

    def observe(self, key: str, kind: str, t: float, hit: Optional[Dict[str, Any]], frame: Optional[np.ndarray] = None,
                zones: Optional[List[Dict[str, Any]]] = None) -> None:
        with self.lock:
            self._observe(key, kind, t, hit, frame, zones)

    def _observe(self, key: str, kind: str, t: float, hit: Optional[Dict[str, Any]], frame: Optional[np.ndarray] = None,
                zones: Optional[List[Dict[str, Any]]] = None) -> None:
        """Feed one observation. hit = None (nothing seen) or {score, labels, boxes, extra}."""
        tr = self.tracks.get(key)
        if tr is None:
            window, _ = self._rule(kind)
            tr = self.tracks[key] = _Track(window)
        _, need = self._rule(kind)
        if tr.active is not None and t - tr.last_hit >= self._gap(kind):
            self._end(tr)  # quiet long enough: this observation belongs to a new occurrence
        tr.window.append(hit is not None)
        if hit is not None:
            tr.last_hit = t
        if tr.active is None:
            instant = kind == "weapon" and hit is not None and hit["score"] >= S.WEAPON_INSTANT_CONF
            if hit is not None and (instant or sum(tr.window) >= need):
                self._start(tr, kind, t, hit, frame, zones)
            return
        ev = tr.active
        if hit is not None:
            ev["last_seen"] = now_ms()
            ev["labels"] = sorted(set(ev["labels"]) | set(hit.get("labels", [])))
            ev["threat"]["end_offset_sec"] = self._off(t)
            if hit["score"] > ev["peak_score"]:
                ev["peak_score"] = round(float(hit["score"]), 3)
                ev["threat"]["peak_offset_sec"] = self._off(t)
            ev["threat"]["hits"] += 1
        elif t - tr.last_hit >= self._gap(kind):
            self._end(tr)

    def _start(self, tr: _Track, kind: str, t: float, hit: Dict[str, Any], frame: Optional[np.ndarray],
               zones: Optional[List[Dict[str, Any]]]) -> None:
        cat = KIND_CATEGORY[kind]
        ev_id = new_event_id()
        snapshot = None
        if frame is not None:
            where = f"LIVE  {time.strftime('%Y-%m-%d %H:%M:%S')}" if self.live else f"{self.file_name}  t={t:.1f}s"
            header = f"RASID THREAT  {self.camera['id']}  {where}  {kind.upper()}"
            img = draw(frame, hit.get("boxes", []), header, zones)
            cv2.imwrite(str(config.SNAP_DIR / f"{ev_id}.jpg"), img, [cv2.IMWRITE_JPEG_QUALITY, 88])
            snapshot = f"/api/snapshots/{ev_id}.jpg"
        ev = {
            "id": ev_id, "camera_id": self.camera["id"], "zone_id": self.camera.get("zone_id", ""),
            "category": cat, "source": "live" if self.live else "recorded", "started_at": now_ms(), "last_seen": now_ms(), "ended_at": None,
            "peak_score": round(float(hit["score"]), 3), "peak_count": None, "capacity": None,
            "labels": sorted(set(hit.get("labels", []))), "team": S.TEAM, "snapshot_url": snapshot,
            "video_url": self.video_url, "file_name": self.file_name, "offset_sec": None if self.live else round(t, 1),
            "models": [self.models.get(MODEL_OF[kind], kind)], "notifications": [],
            "threat": {
                "kind": kind, "start_offset_sec": self._off(t), "end_offset_sec": self._off(t), "peak_offset_sec": self._off(t),
                "boxes": hit.get("boxes", []), "hits": 1, **(hit.get("extra") or {}),
            },
        }
        tr.active = ev
        self._emit(ev, "start")
        from notify import notifier  # local import, same as events.py

        notifier.dispatch(dict(ev), frame_path=config.SNAP_DIR / f"{ev_id}.jpg" if snapshot else None)

    def _end(self, tr: _Track) -> None:
        ev = tr.active
        if ev is None:
            return
        ev["ended_at"] = now_ms()
        tr.active = None
        tr.window.clear()
        self._emit(ev, "end")

    def _emit(self, ev: Dict[str, Any], phase: str) -> None:
        rec = {**ev, "phase": phase}
        persist_event(rec)
        hub.record({"type": "AI_EVENT", "ev": rec})
        self.on_event(rec)

    def flush(self) -> None:
        with self.lock:
            for tr in self.tracks.values():
                self._end(tr)
