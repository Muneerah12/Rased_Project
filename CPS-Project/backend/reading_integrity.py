"""Deterministic integrity checks for CPS sensor readings."""

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import json
import math
import os
from statistics import median

from sqlalchemy.orm import Session

from models import SensorReading as SensorReadingModel


DEFAULT_FRESHNESS_SECONDS = 60.0
DEFAULT_TOLERANCES = {
    "temperature": 2.0,
    "humidity": 5.0,
    "pressure": 10.0,
}

CONFIDENCE_BY_STATUS = {
    "INVALID": 0.1,
    "UNKNOWN": 0.5,
    "SUSPICIOUS": 0.3,
    "NORMAL": 0.8,
}

UNIT_ALIASES = {
    "temperature": {"c": "celsius", "°c": "celsius"},
    "humidity": {"%": "percent"},
    "pressure": {"hpa": "hpa"},
}


@dataclass(frozen=True)
class IntegrityAssessment:
    status: str
    confidence: float
    reason: str


@dataclass(frozen=True)
class IntegritySettings:
    comparison_groups: dict[tuple[str, str], str]
    freshness_seconds: float
    tolerances: dict[str, float]


def load_integrity_settings() -> IntegritySettings:
    """Load small MVP settings from environment variables."""
    raw_groups = os.environ.get("CPS_SENSOR_COMPARISON_GROUPS", "{}")
    try:
        group_data = json.loads(raw_groups)
    except json.JSONDecodeError as error:
        raise ValueError("CPS_SENSOR_COMPARISON_GROUPS must be valid JSON") from error

    if not isinstance(group_data, dict):
        raise ValueError("Comparison groups must be a JSON object")

    comparison_groups = {}
    for node_id, sensor_map in group_data.items():
        if not isinstance(node_id, str) or not isinstance(sensor_map, dict):
            raise ValueError("Comparison groups must map node IDs to sensor maps")
        for sensor_id, group in sensor_map.items():
            if not isinstance(sensor_id, str) or not isinstance(group, str) or not group:
                raise ValueError("Each comparison group needs a sensor ID and group name")
            comparison_groups[(node_id, sensor_id)] = group

    try:
        freshness_seconds = float(os.environ.get(
            "CPS_PEER_FRESHNESS_SECONDS",
            str(DEFAULT_FRESHNESS_SECONDS),
        ))
        tolerances = {
            sensor_type: float(os.environ.get(
                f"CPS_{sensor_type.upper()}_PEER_TOLERANCE",
                str(default),
            ))
            for sensor_type, default in DEFAULT_TOLERANCES.items()
        }
    except ValueError as error:
        raise ValueError("Freshness and peer tolerances must be numeric") from error

    if not math.isfinite(freshness_seconds) or freshness_seconds <= 0:
        raise ValueError("CPS_PEER_FRESHNESS_SECONDS must be positive")
    if any(not math.isfinite(value) or value < 0 for value in tolerances.values()):
        raise ValueError("Peer tolerances must be finite and non-negative")

    return IntegritySettings(
        comparison_groups=comparison_groups,
        freshness_seconds=freshness_seconds,
        tolerances=tolerances,
    )


def _canonical_unit(sensor_type: str, unit: str) -> str | None:
    aliases = UNIT_ALIASES.get(sensor_type)
    if aliases is None:
        return None
    return aliases.get(unit.strip().casefold())


def _utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _assessment(
    status: str,
    reason: str,
    peer_count: int = 0,
) -> IntegrityAssessment:
    confidence = CONFIDENCE_BY_STATUS[status]
    if status == "NORMAL":
        # Coarse evidence tiers (not probabilities): more independent peer
        # sensors provide stronger support, capped to avoid false precision.
        confidence = 0.7 if peer_count == 1 else 0.8 if peer_count == 2 else 0.9
    return IntegrityAssessment(
        status=status,
        confidence=confidence,
        reason=reason,
    )


def validate_and_compare_reading(
    db: Session,
    *,
    node_id: str,
    sensor_id: str,
    sensor_type: str,
    value: float,
    unit: str,
    timestamp: datetime,
    settings: IntegritySettings | None = None,
) -> IntegrityAssessment:
    """Validate a reading and compare it with configured, fresh peers."""
    settings = settings or load_integrity_settings()

    if sensor_type not in DEFAULT_TOLERANCES:
        return _assessment("INVALID", "unsupported sensor type")
    canonical_unit = _canonical_unit(sensor_type, unit)
    if canonical_unit is None:
        return _assessment("INVALID", "unsupported unit for sensor type")
    if not math.isfinite(value):
        return _assessment("INVALID", "outside engineering range")

    ranges = {
        "temperature": (-40.0, 85.0),
        "humidity": (0.0, 100.0),
        "pressure": (300.0, 1100.0),
    }
    minimum, maximum = ranges[sensor_type]
    if value < minimum or value > maximum:
        return _assessment("INVALID", "outside engineering range")

    current_group = settings.comparison_groups.get((node_id, sensor_id))
    if current_group is None:
        return _assessment("UNKNOWN", "insufficient comparable peers")

    current_time = _utc(timestamp)
    now = datetime.now(timezone.utc)
    upper_bound = min(current_time, now)
    lower_bound = current_time - timedelta(seconds=settings.freshness_seconds)

    candidates = (
        db.query(SensorReadingModel)
        .filter(
            SensorReadingModel.sensor_type == sensor_type,
            SensorReadingModel.timestamp >= lower_bound,
            SensorReadingModel.timestamp <= upper_bound,
        )
        .order_by(
            SensorReadingModel.timestamp.desc(),
            SensorReadingModel.id.desc(),
        )
        .all()
    )

    # Keep the newest fresh observation from each configured physical sensor.
    latest_by_sensor = {}
    for candidate in candidates:
        candidate_key = (candidate.node_id, candidate.sensor_id)
        if candidate_key == (node_id, sensor_id):
            continue
        if _canonical_unit(candidate.sensor_type, candidate.unit) != canonical_unit:
            continue
        if settings.comparison_groups.get(candidate_key) != current_group:
            continue
        latest_by_sensor.setdefault(candidate_key, candidate)

    same_node = [
        reading.value
        for (peer_node_id, _), reading in latest_by_sensor.items()
        if peer_node_id == node_id
    ]
    cross_node = [
        reading.value
        for (peer_node_id, _), reading in latest_by_sensor.items()
        if peer_node_id != node_id
    ]
    tolerance = settings.tolerances[sensor_type]
    disagreements = []
    agreements = []

    for peer_values, reason_prefix in (
        (same_node, "same-node"),
        (cross_node, "cross-node"),
    ):
        if not peer_values:
            continue
        reference = median(peer_values)
        if abs(value - reference) > tolerance:
            disagreements.append(f"{reason_prefix} peer deviation")
        else:
            agreements.append(reason_prefix)

    if disagreements:
        return _assessment(
            "SUSPICIOUS",
            "; ".join(disagreements),
            len(same_node) + len(cross_node),
        )
    if agreements:
        reason = " and ".join(agreements) + " peers agree"
        return _assessment("NORMAL", reason, len(same_node) + len(cross_node))
    return _assessment("UNKNOWN", "insufficient comparable peers")
