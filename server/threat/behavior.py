"""Abnormal behaviour: violence (VideoMAE), sudden running and restricted-area entry (tracking).

* Violence / fight / assault: a VideoMAE-base fine-tuned on Violence vs NonViolence classifies
  16 frames spread over VIOLENCE_CLIP_S seconds. Only clips with at least VIOLENCE_MIN_PEOPLE
  tracked people are classified. The box is the union of the people closest to each other.
* Running: each person is tracked (ByteTrack on a dedicated YOLO instance). Speed is measured in
  body-heights per second so it does not depend on the camera distance or resolution.
* Restricted area: the foot point (bottom-centre of the person box) inside a camera polygon.
"""

from __future__ import annotations

from collections import deque
from typing import Any, Deque, Dict, List, Optional, Tuple

import cv2
import numpy as np

from . import settings as S
from .models import get_violence_model, locks
from .zones import point_in_polygon


def _max_step(dt: float, sparse: bool) -> float:
    """Largest plausible move of one person between two samples, in body heights: 1.6 (calibrated at
    4 samples per second); a live source can be slower, so there it grows with the gap (~4 heights/s)."""
    return max(1.6, 4.0 * dt) if sparse else 1.6


class PeopleTracker:
    """People tracking on a dedicated YOLO instance + per-track speed and zone checks."""

    def __init__(self, model, zones: List[Dict[str, Any]], sparse: bool = False) -> None:
        """sparse=True for live sources, whose frame rate can drop to ~1 per second."""
        self.model = model
        self.sparse = sparse
        self._keep_s = 2.5 if sparse else 1.0  # how long an unseen person can still be matched
        self.zones = zones
        self.hist: Dict[int, Deque[Tuple[float, float, float, float]]] = {}  # id -> (t, cx, cy, h)
        self.fast_since: Dict[int, float] = {}
        self.calm_before: Dict[int, bool] = {}
        self.in_zone_since: Dict[Tuple[int, str], float] = {}
        self._prev: List[Dict[str, Any]] = []
        self._next_id = 1
        # camera motion (pan / handheld), accumulated in full-resolution pixels
        self._prev_gray: Optional[np.ndarray] = None
        self._cam = [0.0, 0.0]

    def _camera_shift(self, frame: np.ndarray) -> None:
        """Background shift since the previous sample (phase correlation on a small grey frame).

        Positions used for matching and speed are in background coordinates, so a camera that pans
        or shakes does not make everyone look like they are running.
        """
        h, w = frame.shape[:2]
        k = max(1, int(round(max(h, w) / 320)))
        g = cv2.cvtColor(cv2.resize(frame, (w // k, h // k), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2GRAY).astype(np.float32)
        if self._prev_gray is not None and self._prev_gray.shape == g.shape:
            win = cv2.createHanningWindow((g.shape[1], g.shape[0]), cv2.CV_32F)
            (sx, sy), resp = cv2.phaseCorrelate(self._prev_gray, g, win)
            if resp >= 0.05:
                self._cam[0] += sx * k
                self._cam[1] += sy * k
        self._prev_gray = g

    def _associate(self, people: List[Dict[str, Any]], t: float) -> None:
        """Greedy nearest-neighbour matching in body-height units.

        IoU trackers (ByteTrack) lose a running person at a few frames per second because the
        box moves more than its own width between samples; distance in body heights does not.
        """
        pairs: List[Tuple[float, int, int]] = []
        prev = self._prev
        for i, p in enumerate(people):
            x1, y1, x2, y2 = p["box"]
            cx, cy, h = (x1 + x2) / 2 - self._cam[0], (y1 + y2) / 2 - self._cam[1], max(1.0, y2 - y1)
            p["_c"] = (cx, cy, h)
            for j, q in enumerate(prev):
                if t - q["t"] > self._keep_s:
                    continue
                ratio = h / q["h"]
                if not 0.6 <= ratio <= 1.6:
                    continue
                d = ((cx - q["cx"]) ** 2 + (cy - q["cy"]) ** 2) ** 0.5 / ((h + q["h"]) / 2)
                if d <= _max_step(t - q["t"], self.sparse):
                    pairs.append((d, i, j))
        pairs.sort()
        used_i, used_j = set(), set()
        for _d, i, j in pairs:
            if i in used_i or j in used_j:
                continue
            used_i.add(i)
            used_j.add(j)
            people[i]["id"] = prev[j]["id"]
        for i, p in enumerate(people):
            if i not in used_i:
                p["id"] = self._next_id
                self._next_id += 1
        keep = [q for j, q in enumerate(prev) if j not in used_j and t - q["t"] <= self._keep_s]
        self._prev = keep + [{"id": p["id"], "cx": p["_c"][0], "cy": p["_c"][1], "h": p["_c"][2], "t": t} for p in people]
        for p in people:
            p.pop("_c", None)

    def update(self, frame: np.ndarray, t: float) -> Dict[str, Any]:
        h_img, w_img = frame.shape[:2]
        self._camera_shift(frame)
        with locks["tracker"]:
            r = self.model.predict(source=frame, classes=[0], conf=S.TRACK_CONF, imgsz=S.TRACK_IMGSZ, verbose=False)[0]
        people: List[Dict[str, Any]] = []
        if r.boxes is not None and len(r.boxes) > 0:
            for box, conf in zip(r.boxes.xyxy.cpu().numpy(), r.boxes.conf.cpu().numpy()):
                people.append({"id": None, "score": float(conf), "box": [float(v) for v in box]})
        self._associate(people, t)

        running: List[Dict[str, Any]] = []
        intrusions: List[Dict[str, Any]] = []
        seen = set()
        for p in people:
            tid = p["id"]
            x1, y1, x2, y2 = p["box"]
            bh = max(1.0, y2 - y1)
            cx, cy = (x1 + x2) / 2.0, (y1 + y2) / 2.0
            if tid is not None:
                seen.add(tid)
                speed = self._speed(tid, t, cx - self._cam[0], cy - self._cam[1], bh)
                p["speed"] = None if speed is None else round(speed, 2)
                # a box cut by the frame edge has an unreliable height (and so speed): not judged
                cut = x1 <= 2 or y1 <= 2 or x2 >= w_img - 3 or y2 >= h_img - 3
                full_body = bh >= 1.6 * max(1.0, x2 - x1)  # a running person is seen whole; upper bodies are not judged
                if speed is not None and bh >= S.RUN_MIN_BOX_PX and not cut and full_body:
                    if speed >= S.RUN_SPEED:
                        self.fast_since.setdefault(tid, t)
                        if t - self.fast_since[tid] >= S.RUN_MIN_S:
                            running.append({**p, "sudden": bool(self.calm_before.get(tid))})
                    else:
                        self.fast_since.pop(tid, None)
                        if speed <= S.RUN_CALM_SPEED:
                            self.calm_before[tid] = True
            # restricted areas: foot point in normalized coordinates
            fx, fy = cx / w_img, y2 / h_img
            for z in self.zones:
                key = (tid if tid is not None else -1, z["id"])
                if point_in_polygon(fx, fy, z["polygon"]):
                    self.in_zone_since.setdefault(key, t)
                    if t - self.in_zone_since[key] >= S.INTRUSION_MIN_S:
                        intrusions.append({**p, "zone_id": z["id"], "zone_name": z["name"]})
                else:
                    self.in_zone_since.pop(key, None)
        for tid in list(self.hist):
            if tid not in seen and self.hist[tid] and t - self.hist[tid][-1][0] > 3.0:
                self.hist.pop(tid, None)
                self.fast_since.pop(tid, None)
                self.calm_before.pop(tid, None)
        for key in [k for k in self.in_zone_since if k[0] not in seen]:
            self.in_zone_since.pop(key, None)  # left the frame: a later entry starts a new dwell
        return {"people": people, "running": running, "intrusions": intrusions}

    def _speed(self, tid: int, t: float, cx: float, cy: float, bh: float) -> Optional[float]:
        """Body-heights per second over the last RUN_WINDOW_S; resets on gaps and implausible jumps (ID switch)."""
        h = self.hist.setdefault(tid, deque(maxlen=12))
        if h:
            pt, px, py, ph = h[-1]
            jump = ((cx - px) ** 2 + (cy - py) ** 2) ** 0.5 / max(1.0, (bh + ph) / 2)
            if t - pt > (1.5 if self.sparse else 0.8) or jump > _max_step(t - pt, self.sparse):
                h.clear()
                self.fast_since.pop(tid, None)
        h.append((t, cx, cy, bh))
        old = [x for x in h if t - x[0] <= S.RUN_WINDOW_S + 0.05]
        if len(old) < 3 and self.sparse:  # slow live source: the last two samples, up to 1.5 s apart
            old = list(h)[-2:] if len(h) >= 2 and t - h[-2][0] <= 1.5 else []
        if len(old) < (2 if self.sparse else 3) or old[-1][0] - old[0][0] < S.RUN_WINDOW_S - 0.1:
            return None
        hs = [x[3] for x in old]
        if max(hs) > 1.35 * min(hs):
            return None  # height changing: partly hidden or a different person, speed is unreliable
        t0, x0, y0, _ = old[0]
        dist = ((cx - x0) ** 2 + (cy - y0) ** 2) ** 0.5
        mean_h = float(np.mean([x[3] for x in old]))
        return dist / max(1.0, mean_h) / max(1e-3, t - t0)


def classify_violence(frames: List[np.ndarray]) -> float:
    """Probability of the violence class for one clip of BGR frames (resampled to the model length)."""
    import torch

    proc, model, idx = get_violence_model()
    n = int(model.config.num_frames or 16)
    pick = np.linspace(0, len(frames) - 1, n).round().astype(int)
    rgb = [cv2.cvtColor(frames[i], cv2.COLOR_BGR2RGB) for i in pick]
    inputs = proc(rgb, return_tensors="pt")
    with locks["violence"], torch.inference_mode():
        logits = model(**inputs).logits
    return float(torch.softmax(logits, dim=-1)[0, idx])


def interaction_box(people: List[Dict[str, Any]], frame_size: Tuple[int, int]) -> Optional[List[float]]:
    """Where the violence most likely is: the pair of nearby people moving the most.

    VideoMAE classifies the whole clip and does not localize, so the box is chosen from the tracked
    people: boxes cut by the frame edge (spectators right at the camera) are skipped, then the pair
    with the highest combined, camera-compensated speed among pairs closer than 1.5 body heights.
    """
    w, h = frame_size
    inside = [p for p in people if p["box"][0] > 2 and p["box"][1] > 2 and p["box"][2] < w - 3 and p["box"][3] < h - 3]
    cand = inside if len(inside) >= 2 else people
    if not cand:
        return None
    best: Optional[Tuple[float, int, int]] = None
    for i in range(len(cand)):
        for j in range(i + 1, len(cand)):
            a, b = cand[i]["box"], cand[j]["box"]
            ca = ((a[0] + a[2]) / 2, (a[1] + a[3]) / 2)
            cb = ((b[0] + b[2]) / 2, (b[1] + b[3]) / 2)
            d = ((ca[0] - cb[0]) ** 2 + (ca[1] - cb[1]) ** 2) ** 0.5 / max(1.0, ((a[3] - a[1]) + (b[3] - b[1])) / 2)
            if d >= 1.5:
                continue
            score = (cand[i].get("speed") or 0.0) + (cand[j].get("speed") or 0.0) - 0.2 * d
            if best is None or score > best[0]:
                best = (score, i, j)
    sel = [cand[best[1]], cand[best[2]]] if best is not None else cand
    xs1, ys1, xs2, ys2 = zip(*[p["box"] for p in sel])
    return [min(xs1), min(ys1), max(xs2), max(ys2)]
