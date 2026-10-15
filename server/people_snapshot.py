"""Passive, in-memory snapshots of completed live AI people detections.

This module deliberately does not invoke detectors, decode frames, or publish data.
Camera processing writes a snapshot only after its existing inference path finishes.
"""

from __future__ import annotations

import math
import threading
from collections import OrderedDict, deque
from dataclasses import dataclass, replace
from typing import Any, Optional


@dataclass(frozen=True)
class PeopleSnapshot:
    """An immutable observation, not a claim about occupancy accuracy."""

    camera_id: str
    zone_id: str
    observed_at: int
    people_count: int
    people_smoothed: Optional[int]
    derived_detection_confidence: Optional[float]
    source: str = "live_ai"


def _finite_number(value: Any) -> Optional[float]:
    if isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _nonnegative_int(value: Any) -> Optional[int]:
    number = _finite_number(value)
    if number is None or number < 0 or not number.is_integer():
        return None
    return int(number)


def derived_person_detection_confidence(detections: Any) -> Optional[float]:
    """Return the median current-frame person score, or ``None`` when absent.

    This is a derived per-detection score only. It is not a confidence in a count,
    occupancy, or downstream decision.
    """
    if not isinstance(detections, (list, tuple)):
        return None
    scores = []
    # The latter three values are emitted by the existing wrong-way person tracker.
    person_models = {"people", "wrong_way", "ok_way", "tracking"}
    for detection in detections:
        if not isinstance(detection, dict):
            continue
        if detection.get("model") not in person_models and detection.get("label") != "person":
            continue
        score = _finite_number(detection.get("score"))
        if score is not None and 0.0 <= score <= 1.0:
            scores.append(score)
    if not scores:
        return None
    scores.sort()
    midpoint = len(scores) // 2
    if len(scores) % 2:
        return scores[midpoint]
    return (scores[midpoint - 1] + scores[midpoint]) / 2.0


class PeopleSnapshotCache:
    """Thread-safe bounded cache keyed by camera id.

    Besides the latest snapshot it keeps a short per-camera history of real
    observations (one every ``history_step_ms``, for ``history_keep_ms``) so a
    trend can compare against an earlier observed count; nothing is synthesized.
    """

    def __init__(self, max_entries: int = 100, history_step_ms: int = 5_000, history_keep_ms: int = 900_000) -> None:
        if max_entries < 1:
            raise ValueError("max_entries must be positive")
        self._max_entries = max_entries
        self._snapshots: OrderedDict[str, PeopleSnapshot] = OrderedDict()
        self._history: dict[str, deque[PeopleSnapshot]] = {}
        self._history_step_ms = history_step_ms
        self._history_keep_ms = history_keep_ms
        self._lock = threading.RLock()

    def update(
        self,
        *,
        camera_id: Any,
        zone_id: Any,
        observed_at: Any,
        people_count: Any,
        people_smoothed: Any = None,
        derived_detection_confidence: Any = None,
    ) -> Optional[PeopleSnapshot]:
        """Store a validated observation; malformed input is safely ignored."""
        try:
            if not isinstance(camera_id, str) or not camera_id.strip():
                return None
            observed = _nonnegative_int(observed_at)
            count = _nonnegative_int(people_count)
            smoothed = None if people_smoothed is None else _nonnegative_int(people_smoothed)
            confidence = (
                None
                if derived_detection_confidence is None
                else _finite_number(derived_detection_confidence)
            )
            if observed is None or count is None:
                return None
            if confidence is not None and not 0.0 <= confidence <= 1.0:
                confidence = None
            snapshot = PeopleSnapshot(
                camera_id=camera_id.strip(),
                zone_id=zone_id.strip() if isinstance(zone_id, str) else "",
                observed_at=observed,
                people_count=count,
                people_smoothed=smoothed,
                derived_detection_confidence=confidence,
            )
            with self._lock:
                self._snapshots[snapshot.camera_id] = snapshot
                self._snapshots.move_to_end(snapshot.camera_id)
                while len(self._snapshots) > self._max_entries:
                    evicted, _ = self._snapshots.popitem(last=False)
                    self._history.pop(evicted, None)
                history = self._history.setdefault(snapshot.camera_id, deque())
                if not history or snapshot.observed_at - history[-1].observed_at >= self._history_step_ms:
                    history.append(snapshot)
                while history and snapshot.observed_at - history[0].observed_at > self._history_keep_ms:
                    history.popleft()
            return replace(snapshot)
        except Exception:  # A cache failure must never interrupt camera processing.
            return None

    def get(self, camera_id: str) -> Optional[PeopleSnapshot]:
        with self._lock:
            snapshot = self._snapshots.get(camera_id)
            return replace(snapshot) if snapshot is not None else None

    def observed_at_or_before(self, camera_id: str, at_ms: int) -> Optional[PeopleSnapshot]:
        """The newest recorded observation no later than ``at_ms``, if any."""
        with self._lock:
            earlier = [s for s in self._history.get(camera_id, ()) if s.observed_at <= at_ms]
            return replace(earlier[-1]) if earlier else None

    def remove(self, camera_id: str) -> None:
        with self._lock:
            self._snapshots.pop(camera_id, None)
            self._history.pop(camera_id, None)

    def clear_stale(self, older_than_ms: int) -> int:
        """Remove observations strictly older than the supplied epoch-millisecond cutoff."""
        cutoff = _nonnegative_int(older_than_ms)
        if cutoff is None:
            return 0
        with self._lock:
            stale = [camera_id for camera_id, item in self._snapshots.items() if item.observed_at < cutoff]
            for camera_id in stale:
                del self._snapshots[camera_id]
                self._history.pop(camera_id, None)
            return len(stale)

    def clear(self) -> None:
        with self._lock:
            self._snapshots.clear()
            self._history.clear()


people_snapshot_cache = PeopleSnapshotCache()
