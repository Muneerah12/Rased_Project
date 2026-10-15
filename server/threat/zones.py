"""Restricted areas per camera, as polygons in normalized frame coordinates (0..1).

Stored in data/restricted_zones.json:
  {"CAM-1": [{"id": "RZ-1", "name": "Server room door", "polygon": [[0.1, 0.5], [0.3, 0.5], [0.3, 0.9]]}]}
"""

from __future__ import annotations

import json
import threading
from typing import Any, Dict, List

from . import settings as S

_lock = threading.Lock()


def _load_all() -> Dict[str, List[Dict[str, Any]]]:
    if not S.ZONES_FILE.exists():
        return {}
    try:
        data = json.loads(S.ZONES_FILE.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception as exc:  # noqa: BLE001
        print(f"[threat] bad {S.ZONES_FILE}: {exc}")
        return {}


def get_zones(camera_id: str) -> List[Dict[str, Any]]:
    with _lock:
        return list(_load_all().get(camera_id, []))


def _clean(zones: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    out = []
    for i, z in enumerate(zones or []):
        pts = []
        for p in z.get("polygon") or []:
            try:
                x, y = float(p[0]), float(p[1])
            except (TypeError, ValueError, IndexError):
                continue
            pts.append([round(min(1.0, max(0.0, x)), 4), round(min(1.0, max(0.0, y)), 4)])
        if len(pts) < 3:
            continue
        out.append({"id": str(z.get("id") or f"RZ-{i + 1}")[:40], "name": str(z.get("name") or f"Restricted area {i + 1}")[:80], "polygon": pts})
    return out


def set_zones(camera_id: str, zones: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    clean = _clean(zones)
    with _lock:
        data = _load_all()
        data[camera_id] = clean
        S.ZONES_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return clean


def point_in_polygon(x: float, y: float, poly: List[List[float]]) -> bool:
    """Ray casting; x, y and poly in the same (normalized) space."""
    inside = False
    n = len(poly)
    j = n - 1
    for i in range(n):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-9) + xi:
            inside = not inside
        j = i
    return inside
