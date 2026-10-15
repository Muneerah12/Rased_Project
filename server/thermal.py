"""Thermal camera analysis.

A thermal camera gives a temperature for every pixel. Two input modes are supported:

  * y16   – radiometric 16-bit frames in centi-Kelvin (FLIR Lepton 3.5 on a PureThermal
            board over USB, and other UVC cameras that output Y16). Temperatures are real:
            °C = raw / 100 − 273.15.
  * gray  – an 8-bit "white-hot" video stream (RTSP thermal channel of an IP camera, or a
            USB camera without Y16). The camera must be set to a FIXED temperature range
            (no auto-gain); that range is entered here as range_min_c … range_max_c and
            each grey level is mapped linearly onto it. Accuracy depends on that setting.

Hot spots: connected regions at or above hot_c are reported; regions at or above fire_c
raise the "fire" alert, which the event engine turns into a Fire & Smoke event routed to
Civil Defense (same path as the YOLO fire detector).
"""

from __future__ import annotations

import time
from typing import Any, Dict, List, Optional

import cv2
import numpy as np

DEFAULT_THERMAL: Dict[str, Any] = {
    "mode": "y16",          # y16 | gray
    "range_min_c": 20.0,    # gray mode: temperature of black
    "range_max_c": 150.0,   # gray mode: temperature of white
    "hot_c": 50.0,          # hot spot shown (no alert)
    "fire_c": 80.0,         # hot spot that raises the fire alert
    "min_area_px": 12,      # ignore single-pixel noise
    "frame_w": 160,         # y16 frames delivered as raw bytes need the sensor size
    "frame_h": 120,
}
MODES = ("y16", "gray")


def thermal_cfg(cam: Dict[str, Any]) -> Dict[str, Any]:
    return {**DEFAULT_THERMAL, **(cam.get("thermal") or {})}


def temperature_map(frame: np.ndarray, t: Dict[str, Any]) -> np.ndarray:
    """Per-pixel temperature in °C (float32, H×W)."""
    if t["mode"] == "y16":
        raw = frame
        if raw.dtype != np.uint16:
            # some capture backends hand Y16 over as a flat byte buffer
            buf = np.ascontiguousarray(raw).reshape(-1).view(np.uint16)
            w, h = int(t["frame_w"]), int(t["frame_h"])
            if buf.size < w * h:
                raise ValueError(f"Y16 frame has {buf.size} values, expected {w}×{h}; check frame_w/frame_h or use gray mode")
            raw = buf[: w * h].reshape(h, w)
        if raw.ndim == 3:
            raw = raw[:, :, 0]
        return raw.astype(np.float32) / 100.0 - 273.15
    gray = frame if frame.ndim == 2 else cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    lo, hi = float(t["range_min_c"]), float(t["range_max_c"])
    return lo + gray.astype(np.float32) * ((hi - lo) / 255.0)


def colorize(temp: np.ndarray, t: Dict[str, Any]) -> np.ndarray:
    """False-colour BGR view (blue = cold, yellow/white = hot) over the configured range."""
    lo, hi = float(t["range_min_c"]), float(t["range_max_c"])
    norm = np.clip((temp - lo) / max(0.1, hi - lo) * 255.0, 0, 255).astype(np.uint8)
    img = cv2.applyColorMap(norm, cv2.COLORMAP_INFERNO)
    if img.shape[1] < 480:  # small radiometric sensors: upscale for viewing and snapshots
        k = 480 / img.shape[1]
        img = cv2.resize(img, (480, int(round(img.shape[0] * k))), interpolation=cv2.INTER_CUBIC)
    return img


def _hotspots(temp: np.ndarray, t: Dict[str, Any], scale: float) -> List[Dict[str, Any]]:
    mask = (temp >= float(t["hot_c"])).astype(np.uint8)
    n, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    out: List[Dict[str, Any]] = []
    fire_c = float(t["fire_c"])
    for i in range(1, n):
        x, y, w, h, area = stats[i]
        if area < int(t["min_area_px"]):
            continue
        peak = float(temp[labels == i].max())
        fire = peak >= fire_c
        out.append({
            "box": [float(x) * scale, float(y) * scale, float(x + w) * scale, float(y + h) * scale],
            "label": "fire" if fire else "hotspot",
            "model": "thermal",
            "score": round(min(1.0, 0.5 + max(0.0, peak - fire_c) / max(1.0, fire_c)), 3) if fire else 0.4,
            "temp_c": round(peak, 1),
        })
    out.sort(key=lambda d: d["temp_c"], reverse=True)
    return out[:20]


def analyze(frame: np.ndarray, cam: Dict[str, Any], force_gray: bool = False) -> Dict[str, Any]:
    """Run thermal analysis on one frame. Returns the usual detector result plus `thermal`
    readings and `display` (the false-colour BGR frame used for MJPEG and snapshots)."""
    t0 = time.perf_counter()
    t = thermal_cfg(cam)
    if force_gray:  # browser frames are 8-bit video: only the fixed-range grey mapping applies
        t["mode"] = "gray"
    temp = temperature_map(frame, t)
    display = colorize(temp, t)
    scale = float(display.shape[1]) / float(temp.shape[1])
    dets = _hotspots(temp, t, scale)
    max_c = float(temp.max())
    alerts = ["fire"] if any(d["label"] == "fire" for d in dets) else []
    # mark the hottest pixel
    yx = np.unravel_index(int(temp.argmax()), temp.shape)
    px, py = int(yx[1] * scale), int(yx[0] * scale)
    cv2.drawMarker(display, (px, py), (255, 255, 255), cv2.MARKER_CROSS, 18, 2)
    cv2.putText(display, f"MAX {max_c:.1f}C", (8, display.shape[0] - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2, cv2.LINE_AA)
    return {
        "people_count": None,
        "detections": dets,
        "alerts": alerts,
        "frame_size": [int(display.shape[1]), int(display.shape[0])],
        "infer_ms": round((time.perf_counter() - t0) * 1000.0, 1),
        "models_used": [f"Thermal hot-spot ({t['mode']}, fire >= {t['fire_c']:.0f} °C)"],
        "thermal": {
            "mode": t["mode"],
            "max_c": round(max_c, 1),
            "min_c": round(float(temp.min()), 1),
            "mean_c": round(float(temp.mean()), 1),
            "hot_pct": round(float((temp >= float(t["hot_c"])).mean() * 100.0), 2),
            "hot_c": t["hot_c"],
            "fire_c": t["fire_c"],
        },
        "display": display,
    }


def patch_thermal(current: Optional[Dict[str, Any]], patch: Dict[str, Any]) -> Dict[str, Any]:
    """Validate a settings patch from the UI."""
    t = {**DEFAULT_THERMAL, **(current or {})}
    if patch.get("mode") in MODES:
        t["mode"] = patch["mode"]
    for k in ("range_min_c", "range_max_c", "hot_c", "fire_c"):
        if k in patch:
            try:
                t[k] = float(patch[k])
            except (TypeError, ValueError):
                pass
    for k in ("min_area_px", "frame_w", "frame_h"):
        if k in patch:
            try:
                t[k] = max(1, int(patch[k]))
            except (TypeError, ValueError):
                pass
    if t["range_max_c"] <= t["range_min_c"]:
        t["range_max_c"] = t["range_min_c"] + 1.0
    return t
