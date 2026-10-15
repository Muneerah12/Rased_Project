"""Weapon detection on one BGR frame (YOLO11 gun/knife fine-tune).

Two checks on top of the raw model output make it more accurate:
  * person context: a weapon is carried by someone. A box on or next to a person is kept from
    WEAPON_HELD_CONF; a box far from every person needs WEAPON_SOLO_CONF (phones, bags, dark
    objects on their own were the common false positives).
  * person zoom: small, distant people are cropped and enlarged and the model runs again on the
    crops, so a weapon only a few pixels wide in the full frame is still found.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Sequence

import numpy as np

from . import settings as S
from .models import get_weapon_model, locks

# model class name -> Rasid label
_LABELS = {"gun": "gun", "pistol": "gun", "handgun": "gun", "rifle": "gun", "firearm": "gun", "knife": "knife"}


def _raw(model, sources: List[np.ndarray], imgsz: int, conf: float) -> List[List[tuple]]:
    """(label, conf, [x1, y1, x2, y2]) per source image, Rasid labels only."""
    with locks["weapon"]:
        results = model.predict(source=sources, conf=conf, iou=0.45, imgsz=imgsz, verbose=False)
    out = []
    for result in results:
        found = []
        if result.boxes is not None and len(result.boxes):
            names = result.names or {}
            xyxy = result.boxes.xyxy.cpu().numpy()
            confs = result.boxes.conf.cpu().numpy()
            clss = result.boxes.cls.cpu().numpy().astype(int)
            for box, c, cls_id in zip(xyxy, confs, clss):
                label = _LABELS.get(str(names.get(int(cls_id), cls_id)).strip().lower())
                if label is not None:
                    found.append((label, float(c), [float(v) for v in box]))
        out.append(found)
    return out


def _iou(a: Sequence[float], b: Sequence[float]) -> float:
    ix = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / union if union > 0 else 0.0


def _near_person(box: Sequence[float], people: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """The person whose box (widened by an arm's reach) the weapon box overlaps, if any."""
    cx, cy = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
    for p in people:
        x1, y1, x2, y2 = p["box"]
        w, h = x2 - x1, y2 - y1
        if x1 - 0.35 * w <= cx <= x2 + 0.35 * w and y1 - 0.1 * h <= cy <= y2 + 0.05 * h:
            return p
    return None


def _zoom_crops(frame: np.ndarray, people: List[Dict[str, Any]]):
    """Crops around the largest small people (upper 75 % of the body, where a weapon is held)."""
    fh, fw = frame.shape[:2]
    small = [p for p in people if (p["box"][3] - p["box"][1]) < S.WEAPON_ZOOM_MAX_H * fh]
    small.sort(key=lambda p: (p["box"][3] - p["box"][1]), reverse=True)
    crops = []
    for p in small[: max(0, S.WEAPON_ZOOM_PEOPLE)]:
        x1, y1, x2, y2 = p["box"]
        w, h = x2 - x1, y2 - y1
        if h < 24:
            continue
        cx1, cy1 = int(max(0, x1 - 0.4 * w)), int(max(0, y1 - 0.05 * h))
        cx2, cy2 = int(min(fw, x2 + 0.4 * w)), int(min(fh, y1 + 0.8 * h))
        if cx2 - cx1 >= 16 and cy2 - cy1 >= 16:
            crops.append((frame[cy1:cy2, cx1:cx2], cx1, cy1))
    return crops


def detect_weapons(frame: np.ndarray, people: Optional[List[Dict[str, Any]]] = None) -> List[Dict[str, Any]]:
    """people: person boxes of the same frame (from the tracker), or None when unavailable —
    then only the model's own confidence decides (WEAPON_CONF)."""
    model = get_weapon_model()
    use_ctx = people is not None and S.WEAPON_PERSON_CONTEXT
    floor = min(S.WEAPON_CONF, S.WEAPON_HELD_CONF) if use_ctx else S.WEAPON_CONF
    cands = _raw(model, [frame], S.WEAPON_IMGSZ, floor)[0]

    if use_ctx and people and S.WEAPON_ZOOM_PEOPLE > 0:
        crops = _zoom_crops(frame, people)
        if crops:
            for (crop, ox, oy), found in zip(crops, _raw(model, [c[0] for c in crops], S.WEAPON_ZOOM_IMGSZ, floor)):
                for label, c, b in found:
                    cands.append((label, c, [b[0] + ox, b[1] + oy, b[2] + ox, b[3] + oy]))

    # merge duplicates (full frame + zoom see the same object): keep the most confident box
    cands.sort(key=lambda d: d[1], reverse=True)
    merged: List[tuple] = []
    for d in cands:
        if all(not (d[0] == m[0] and _iou(d[2], m[2]) > 0.3) for m in merged):
            merged.append(d)

    fh, fw = frame.shape[:2]
    frame_area = float(fh * fw)
    out: List[Dict[str, Any]] = []
    for label, conf, (x1, y1, x2, y2) in merged:
        bw, bh = x2 - x1, y2 - y1
        if min(bw, bh) < S.WEAPON_MIN_PX:
            continue  # a few pixels: noise, not a recognisable weapon
        if bw * bh > S.WEAPON_MAX_AREA.get(label, 1.0) * frame_area:
            continue  # implausibly large for this object: a false positive
        holder = _near_person([x1, y1, x2, y2], people) if use_ctx else None
        if use_ctx:
            if holder is not None:
                pa = (holder["box"][2] - holder["box"][0]) * (holder["box"][3] - holder["box"][1])
                if pa > 0 and bw * bh > 0.6 * pa:
                    continue  # the box is the person, not something in their hand
                need = S.WEAPON_HELD_CONF if label == "gun" else max(S.WEAPON_HELD_CONF, S.KNIFE_CONF)
            else:
                need = S.WEAPON_SOLO_CONF
        else:
            need = S.WEAPON_CONF if label == "gun" else S.KNIFE_CONF
        if conf < need:
            continue
        out.append({
            "model": "weapon", "label": label, "score": round(conf, 3),
            "box": [round(v, 1) for v in (x1, y1, x2, y2)],
            **({"held": holder is not None} if use_ctx else {}),
        })
    return out
