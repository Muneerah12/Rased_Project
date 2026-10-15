"""Turns per-frame detector output into debounced events.

frame alerts  ──►  CategoryTracker (START_HITS of last WINDOW frames)  ──►  event start
                                   (no hit for END_AFTER_S)             ──►  event end

On start: annotated snapshot saved, event persisted, journal entry AI_EVENT broadcast
(every Rasid client turns it into event → alert → incident), notifications sent.
"""

from __future__ import annotations

import json
import random
import statistics
import threading
import time
from collections import deque
from typing import Any, Callable, Deque, Dict, List, Optional

import cv2
import numpy as np

import config
from detectors import annotate
from hub import hub, now_ms

# detector alert -> Rasid EventCategory
ALERT_CATEGORY = {"fire": "fire_smoke", "smoke": "fire_smoke", "fall": "fall", "wrong_way": "wrong_way"}
CATEGORY_TEAM = {"fall": "medical", "fire_smoke": "civil_defense", "crowding": "organizers", "wrong_way": "organizers"}

_events_lock = threading.Lock()


def persist_event(ev: Dict[str, Any]) -> None:
    with _events_lock:
        with config.EVENTS_FILE.open("a", encoding="utf-8") as f:
            f.write(json.dumps(ev, ensure_ascii=False) + "\n")


def load_events(limit: int = 500) -> List[Dict[str, Any]]:
    """Latest state of each event (the file is append-only)."""
    if not config.EVENTS_FILE.exists():
        return []
    folded: Dict[str, Dict[str, Any]] = {}
    with _events_lock:
        with config.EVENTS_FILE.open("r", encoding="utf-8") as f:
            for line in f:
                try:
                    rec = json.loads(line)
                except json.JSONDecodeError:
                    continue
                folded[rec["id"]] = {**folded.get(rec["id"], {}), **rec}
    out = sorted(folded.values(), key=lambda e: e.get("started_at", 0), reverse=True)
    return out[:limit]


def _new_event_id() -> str:
    return f"AIE-{time.strftime('%Y%m%d-%H%M%S')}-{random.randint(0, 0xFFFF):04X}"


class _Tracker:
    def __init__(self) -> None:
        self.window: Deque[bool] = deque(maxlen=max(1, config.EVENT_WINDOW))
        self.active: Optional[Dict[str, Any]] = None
        self.last_hit_ts: float = 0.0
        self.last_end_ts: float = -1e18
        self.last_update_sent: float = 0.0


class EventEngine:
    """One engine per analysis context (a live camera, or one recorded-video job)."""

    def __init__(
        self,
        camera: Dict[str, Any],
        source: str = "live",
        file_name: Optional[str] = None,
        video_url: Optional[str] = None,
        on_event: Optional[Callable[[Dict[str, Any]], None]] = None,
        notify: bool = True,
    ) -> None:
        self.camera = camera
        self.source = source
        self.file_name = file_name
        self.video_url = video_url
        self.on_event = on_event
        self.notify = notify
        self.trackers: Dict[str, _Tracker] = {}
        self.counts: Deque[int] = deque(maxlen=max(1, config.CROWD_SMOOTH_FRAMES))
        self.lock = threading.Lock()

    # ---------------------------------------------------------------- helpers
    def smoothed_people(self) -> Optional[int]:
        if not self.counts:
            return None
        return int(round(statistics.median(self.counts)))

    def _tracker(self, cat: str) -> _Tracker:
        if cat not in self.trackers:
            self.trackers[cat] = _Tracker()
        return self.trackers[cat]

    def _snapshot(self, ev_id: str, frame: np.ndarray, detections: List[Dict[str, Any]], cat: str) -> str:
        relevant = [d for d in detections if _relevant(d, cat)] or detections
        cam = self.camera
        header = f"RASID  {cam['id']}  {cam.get('zone_id', '')}  {time.strftime('%Y-%m-%d %H:%M:%S')}"
        img = annotate(frame, relevant, header)
        path = config.SNAP_DIR / f"{ev_id}.jpg"
        cv2.imwrite(str(path), img, [cv2.IMWRITE_JPEG_QUALITY, 85])
        return f"/api/snapshots/{ev_id}.jpg"

    def _emit(self, ev: Dict[str, Any], phase: str) -> None:
        rec = {**ev, "phase": phase}
        persist_event(rec)
        hub.record({"type": "AI_EVENT", "ev": rec})
        if self.on_event:
            self.on_event(rec)

    # ---------------------------------------------------------------- main
    def process(self, result: Dict[str, Any], frame: Optional[np.ndarray], ts: float, offset_sec: Optional[float] = None) -> List[Dict[str, Any]]:
        """Feed one analyzed frame. `ts` is in seconds (wall clock or video time)."""
        emitted: List[Dict[str, Any]] = []
        cam = self.camera
        models = set(cam.get("models") or [])
        alerts = set(result.get("alerts") or [])
        dets = result.get("detections") or []
        with self.lock:
            hits: Dict[str, Dict[str, Any]] = {}
            # detector categories
            for a in alerts:
                cat = ALERT_CATEGORY.get(a)
                if not cat:
                    continue
                h = hits.setdefault(cat, {"labels": set(), "score": 0.0, "count": None})
                h["labels"].add(a)
                for d in dets:
                    if _relevant(d, cat):
                        h["score"] = max(h["score"], float(d.get("score", 0)))
            # crowding from the smoothed people count
            counting = bool(models & {"people", "wrong_way"})
            if counting:
                self.counts.append(int(result.get("people_count") or 0))
            cap = cam.get("capacity")
            sm = self.smoothed_people() if counting else None
            if counting and cap and sm is not None and sm > cap:
                hits["crowding"] = {"labels": {"people"}, "score": min(1.0, sm / cap), "count": sm}

            cats = set(self.trackers) | set(hits)
            for cat in cats:
                tr = self._tracker(cat)
                hit = hits.get(cat)
                tr.window.append(hit is not None)
                if hit:
                    tr.last_hit_ts = ts
                if tr.active is None:
                    n_hits = sum(tr.window)
                    need = 3 if cat == "crowding" else config.EVENT_START_HITS
                    cooled = ts - tr.last_end_ts >= config.EVENT_COOLDOWN_S
                    if hit and n_hits >= min(need, tr.window.maxlen or need) and cooled:
                        ev_id = _new_event_id()
                        ev = {
                            "id": ev_id,
                            "camera_id": cam["id"],
                            "zone_id": cam.get("zone_id", ""),
                            "category": cat,
                            "source": self.source,
                            "started_at": now_ms(),
                            "last_seen": now_ms(),
                            "ended_at": None,
                            "peak_score": round(hit["score"], 3),
                            "peak_count": hit["count"],
                            "capacity": cap if cat == "crowding" else None,
                            "labels": sorted(hit["labels"]),
                            "team": CATEGORY_TEAM.get(cat, "organizers"),
                            "snapshot_url": self._snapshot(ev_id, frame, dets, cat) if frame is not None else None,
                            "video_url": self.video_url,
                            "file_name": self.file_name,
                            "offset_sec": round(offset_sec, 1) if offset_sec is not None else None,
                            "models": result.get("models_used") or _models_for(cat),
                            "notifications": [],
                        }
                        tr.active = ev
                        tr.last_update_sent = ts
                        self._emit(ev, "start")
                        emitted.append({**ev, "phase": "start"})
                        if self.notify:
                            from notify import notifier  # local import: avoids a cycle

                            notifier.dispatch(dict(ev), frame_path=config.SNAP_DIR / f"{ev_id}.jpg")
                    continue
                # active event
                ev = tr.active
                if hit:
                    ev["last_seen"] = now_ms()
                    ev["labels"] = sorted(set(ev["labels"]) | hit["labels"])
                    grew = hit["count"] is not None and (ev["peak_count"] or 0) < hit["count"]
                    ev["peak_score"] = round(max(ev["peak_score"], hit["score"]), 3)
                    if grew:
                        ev["peak_count"] = hit["count"]
                        if ts - tr.last_update_sent >= 5:
                            tr.last_update_sent = ts
                            self._emit(ev, "update")
                            emitted.append({**ev, "phase": "update"})
                elif ts - tr.last_hit_ts >= config.EVENT_END_AFTER_S:
                    emitted.extend(self._end(cat, ts))
        return emitted

    def _end(self, cat: str, ts: float) -> List[Dict[str, Any]]:
        tr = self.trackers.get(cat)
        if not tr or tr.active is None:
            return []
        ev = tr.active
        ev["ended_at"] = now_ms()
        tr.active = None
        tr.last_end_ts = ts
        tr.window.clear()
        self._emit(ev, "end")
        return [{**ev, "phase": "end"}]

    def tick(self, ts: float) -> None:
        """Close events whose condition disappeared even if frames stopped arriving."""
        with self.lock:
            for cat, tr in list(self.trackers.items()):
                if tr.active is not None and ts - tr.last_hit_ts >= config.EVENT_END_AFTER_S:
                    self._end(cat, ts)

    def flush(self, ts: float) -> List[Dict[str, Any]]:
        """End every active event (used at the end of a recorded video)."""
        out: List[Dict[str, Any]] = []
        with self.lock:
            for cat in list(self.trackers):
                out.extend(self._end(cat, ts))
        return out

    def active_events(self) -> List[Dict[str, Any]]:
        return [tr.active for tr in self.trackers.values() if tr.active is not None]


def _relevant(d: Dict[str, Any], cat: str) -> bool:
    lab = str(d.get("label", "")).lower()
    if cat == "fire_smoke":
        return lab in ("fire", "smoke")
    if cat == "fall":
        return lab == "fallen"
    if cat == "wrong_way":
        return d.get("status") == "wrong"
    if cat == "crowding":
        return lab == "person" or d.get("model") in ("people", "ok_way", "wrong_way", "tracking")
    return True


def _models_for(cat: str) -> List[str]:
    from models_loader import models_status

    st = models_status()
    m = st["models"]
    def name(k: str, fallback: str) -> str:
        return m[k]["name"] if m[k]["state"] == "ready" else fallback
    if cat == "fire_smoke":
        return [name("fire_smoke", "OpenCV HSV fire fallback")]
    if cat == "fall":
        return [name("fall", "aspect-ratio fall fallback")]
    return [name("coco", "OpenCV HOG people fallback")]
