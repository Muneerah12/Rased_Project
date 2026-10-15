"""Threat detection on live camera sources (browser camera / looping file / RTSP), next to the
existing detectors.

cameras.py hands every analyzed frame of a live camera to `submit`. Each monitored camera has
its own worker thread that keeps only the newest frame and analyzes at its own pace, so the
existing per-frame detectors and event engine never wait for it:

  weapons + people tracking (running, restricted areas) on every sample (up to LIVE_FPS),
  VideoMAE violence on the last VIOLENCE_CLIP_S seconds every VIOLENCE_STRIDE_S when 2+ people.

Events go through the same ThreatEmitter as uploaded videos (journal AI_EVENT → incident for the
security team, snapshot, notifications) with source "live". The newest threat boxes are returned
to cameras.py so they show on the live view next to the existing boxes.
"""

from __future__ import annotations

import threading
import time
from collections import deque
from typing import Any, Deque, Dict, List, Optional, Tuple

import cv2
import numpy as np

from . import settings as S
from .behavior import PeopleTracker, classify_violence, interaction_box
from .emitter import ThreatEmitter
from .models import MODEL_INFO, new_tracker
from .weapons import detect_weapons
from .zones import get_zones

BOX_TTL_S = 2.0  # threat boxes stay on the live view this long after the frame they came from (live sources can be ~1 fps)


def monitored(cam_id: str) -> bool:
    ids = {c.strip() for c in S.LIVE_CAMERAS.split(",") if c.strip()}
    return "*" in ids or cam_id in ids


class _Worker(threading.Thread):
    def __init__(self, camera: Dict[str, Any]) -> None:
        super().__init__(daemon=True, name=f"threat-live-{camera['id']}")
        self.camera = dict(camera)
        self.cond = threading.Condition()
        self.frame: Optional[np.ndarray] = None
        self.frame_t = 0.0
        self.boxes: List[Dict[str, Any]] = []
        self.boxes_t = 0.0
        self.errors: Dict[str, str] = {}
        # every incoming frame (small copy) for the violence model, independent of the analysis rate
        self.clip: Deque[Tuple[float, np.ndarray]] = deque(maxlen=96)
        self.violence_note = ""
        self.last_frame: Optional[np.ndarray] = None
        # VideoMAE (~0.7 s on CPU) runs in a thread of its own, so it never holds up weapon detection
        self.violence_busy = False
        self.violence_boxes: List[Dict[str, Any]] = []
        self.violence_boxes_t = 0.0
        self.emitter = ThreatEmitter(self.camera, None, None, {k: v["name"] for k, v in MODEL_INFO.items()}, lambda _ev: None, live=True)

    def submit(self, frame: np.ndarray) -> None:
        now = time.time()
        if S.LIVE_VIOLENCE:
            h, w = frame.shape[:2]
            sc = 256.0 / min(h, w)
            small = cv2.resize(frame, (int(w * sc), int(h * sc))) if sc < 1 else frame.copy()
        with self.cond:
            self.frame = frame
            self.frame_t = now
            self.last_frame = frame  # for events raised outside the analysis loop (gunshots in an attached file)
            if S.LIVE_VIOLENCE:
                self.clip.append((now, small))
                while self.clip and now - self.clip[0][0] > S.LIVE_CLIP_MAX_S:
                    self.clip.popleft()
            self.cond.notify()

    def _violence_clip(self, now: float) -> List[np.ndarray]:
        """Frames of the last VIOLENCE_CLIP_S seconds, or the last LIVE_CLIP_MIN_FRAMES within
        LIVE_CLIP_MAX_S. Too slow a source gives no clip: its result would not be reliable."""
        with self.cond:
            items = list(self.clip)
        recent = [f for t, f in items if now - t <= S.VIOLENCE_CLIP_S]
        if len(recent) >= S.LIVE_CLIP_MIN_FRAMES:
            self.violence_note = ""
            return recent
        window = [f for t, f in items if now - t <= S.LIVE_CLIP_MAX_S][-S.LIVE_CLIP_MIN_FRAMES:]
        self.violence_note = "" if len(window) >= S.LIVE_CLIP_MIN_FRAMES else (
            f"source too slow for fight detection ({len(window)} frames in {S.LIVE_CLIP_MAX_S:g}s, "
            f"needs {S.LIVE_CLIP_MIN_FRAMES}); turn off this camera's other detectors or lower its resolution")
        return window if not self.violence_note else []

    def latest_boxes(self) -> List[Dict[str, Any]]:
        return list(self.boxes) if time.time() - self.boxes_t <= BOX_TTL_S else []

    def _soft(self, key: str, fn, *a):
        if key in self.errors:
            return None
        try:
            return fn(*a)
        except Exception as exc:  # noqa: BLE001 — a missing model is reported once and skipped
            self.errors[key] = str(exc)[:200]
            print(f"[threat-live] {self.camera['id']} {key} unavailable: {exc}")
            return None

    def run(self) -> None:
        tracker_model = self._soft("tracker", new_tracker)
        zones = get_zones(self.camera["id"])
        zones_at = time.time()
        tracker = PeopleTracker(tracker_model, zones, sparse=True) if tracker_model is not None else None
        counts: Deque[Tuple[float, int]] = deque()
        next_violence = 0.0
        period = 1.0 / max(0.5, S.LIVE_FPS)
        while True:
            with self.cond:
                self.cond.wait(timeout=1.0)
                frame, ft = self.frame, self.frame_t
                self.frame = None
            now = time.time()
            if frame is None:
                if now - self.frame_t > S.EVENT_GAP_S:
                    self.emitter.flush()  # the source stopped: close open events
                continue
            t0 = time.perf_counter()
            if now - zones_at > 5:  # pick up restricted areas edited on the page
                zones, zones_at = get_zones(self.camera["id"]), now
                if tracker is not None:
                    tracker.zones = zones
            boxes: List[Dict[str, Any]] = []

            people: List[Dict[str, Any]] = []
            if tracker is not None:
                tr = self._soft("tracker_run", tracker.update, frame, ft)
                if tr is not None:
                    people = tr["people"]
                    counts.append((ft, len(people)))
                    run = tr["running"]
                    hit = None
                    if run:
                        labels = ["running"] + (["sudden_running"] if any(r["sudden"] for r in run) else []) + (["crowd_running"] if len(run) >= 3 else [])
                        rb = [{"label": "running", "score": min(1.0, (r.get("speed") or 0) / (2 * S.RUN_SPEED)), "box": r["box"]} for r in run]
                        boxes += rb
                        hit = {"score": max(b["score"] for b in rb), "labels": labels, "boxes": rb}
                    self.emitter.observe("running", "running", ft, hit, frame)
                    for z in zones:
                        inside = [p for p in tr["intrusions"] if p["zone_id"] == z["id"]]
                        hit = None
                        if inside:
                            ib = [{"label": "intrusion", "score": p["score"], "box": p["box"]} for p in inside]
                            boxes += ib
                            hit = {"score": max(b["score"] for b in ib), "labels": ["intrusion"], "boxes": ib,
                                   "extra": {"zone_id": z["id"], "zone_name": z["name"]}}
                        self.emitter.observe(f"intrusion:{z['id']}", "intrusion", ft, hit, frame, zones=[z])
            while counts and ft - counts[0][0] > S.LIVE_CLIP_MAX_S:
                counts.popleft()

            # after the tracker: the weapon check uses this frame's people (None when tracking is unavailable)
            dets = self._soft("weapon", detect_weapons, frame, people if tracker is not None else None)
            if dets is not None:
                boxes += dets
                hit = {"score": max(d["score"] for d in dets), "labels": [d["label"] for d in dets], "boxes": dets} if dets else None
                self.emitter.observe("weapon", "weapon", ft, hit, frame)

            if S.LIVE_VIOLENCE and ft >= next_violence and not self.violence_busy:
                clip = self._violence_clip(ft)
                if clip:
                    next_violence = ft + S.VIOLENCE_STRIDE_S
                    n_people = max((c for _, c in counts), default=0) if tracker is not None else S.VIOLENCE_MIN_PEOPLE
                    if n_people >= S.VIOLENCE_MIN_PEOPLE:
                        self.violence_busy = True
                        threading.Thread(target=self._violence, args=(clip, list(people), frame, ft, n_people), daemon=True,
                                         name=f"threat-live-violence-{self.camera['id']}").start()
                    else:
                        self.emitter.observe("violence", "violence", ft, None, frame)
            if ft - self.violence_boxes_t <= BOX_TTL_S:
                boxes += self.violence_boxes

            if "gunshot" in self.emitter.tracks:  # close a gunshot event after EVENT_GAP_S of quiet
                self.emitter.observe("gunshot", "gunshot", time.time(), None)
            self.boxes = [{**b, "model": "threat"} for b in boxes]
            self.boxes_t = ft
            spare = period - (time.perf_counter() - t0)
            if spare > 0:
                time.sleep(spare)


    def _violence(self, clip: List[np.ndarray], people: List[Dict[str, Any]], frame: np.ndarray, ft: float, n_people: int) -> None:
        try:
            score = self._soft("violence", classify_violence, clip)
            hit = None
            if score is not None and score >= S.VIOLENCE_THRESHOLD:
                h, w = frame.shape[:2]
                box = interaction_box(people, (w, h)) or [0, 0, float(w), float(h)]
                vb = [{"label": "violence", "score": round(score, 3), "box": box}]
                self.violence_boxes, self.violence_boxes_t = vb, ft
                hit = {"score": score, "labels": ["violence"], "boxes": vb, "extra": {"people": n_people}}
            self.emitter.observe("violence", "violence", ft, hit, frame)
        finally:
            self.violence_busy = False


_workers: Dict[str, _Worker] = {}
_lock = threading.Lock()


def submit(camera: Dict[str, Any], frame: np.ndarray) -> List[Dict[str, Any]]:
    """Queue a live frame of `camera` (never blocks) and return the newest threat boxes for it."""
    cam_id = camera["id"]
    if camera.get("kind") == "thermal" or not monitored(cam_id):
        return []
    with _lock:
        w = _workers.get(cam_id)
        if w is None:
            w = _workers[cam_id] = _Worker(camera)
            w.start()
    w.camera.update(camera)  # settings edited on the page (zone, name) apply to the next event; the emitter shares this dict
    w.submit(frame)
    return w.latest_boxes()


def status() -> Dict[str, Any]:
    return {
        "cameras": S.LIVE_CAMERAS, "fps": S.LIVE_FPS, "violence": S.LIVE_VIOLENCE,
        "running": {cid: {"errors": w.errors, "last_frame_at": int(w.frame_t * 1000), "violence": w.violence_note or "ok",
                          "input_fps": round(len([1 for t, _ in list(w.clip) if time.time() - t <= 3]) / 3, 1)} for cid, w in _workers.items()},
    }
