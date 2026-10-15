"""Pure normalization for real operational HVAC evidence.

This module only transforms already-observed CPS payloads and completed AI snapshots.
It never fetches CPS, invokes inference, persists data, or creates incidents.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from enum import Enum
from math import isfinite
from typing import Any, Optional

from people_snapshot import PeopleSnapshot


EVIDENCE_SCHEMA_VERSION = "real-operational-evidence-v1"
# Explicitly approved physical-location-to-zone mapping. This is intentionally a
# zone association only; it makes no claim about a device coordinate.
CPS_LOCATION_TO_RASID_ZONE = {"A1-1": "A1.1"}


class Freshness(str, Enum):
    FRESH = "FRESH"
    STALE = "STALE"
    MISSING = "MISSING"
    INVALID = "INVALID"


class Trend(str, Enum):
    INCREASING = "INCREASING"
    STABLE = "STABLE"
    DECREASING = "DECREASING"
    UNKNOWN = "UNKNOWN"


@dataclass(frozen=True)
class NumericObservation:
    value: float
    observed_at: datetime
    source_id: str


@dataclass(frozen=True)
class ObservedTrend:
    direction: Trend
    delta: float | None
    previous_observed_at: datetime | None
    current_observed_at: datetime | None
    reason_code: str


@dataclass(frozen=True)
class NormalizedTemperature:
    sensor_id: str | None
    value_c: float | None
    observed_at: datetime | None
    validation_status: str | None
    freshness: Freshness
    issues: tuple[str, ...]


@dataclass(frozen=True)
class RealCpsNodeEvidence:
    schema_version: str
    context: str
    source: str
    evaluated_at: datetime
    node_id: str | None
    location_id: str | None
    zone_id: str | None
    status: str | None
    connection_status: str | None
    as_of: datetime | None
    snapshot_freshness: Freshness
    last_heartbeat_received_at: datetime | None
    temperature: NormalizedTemperature
    issues: tuple[str, ...]


@dataclass(frozen=True)
class RealAiPeopleEvidence:
    schema_version: str
    context: str
    source: str
    evaluated_at: datetime
    camera_id: str | None
    zone_id: str | None
    observed_at: datetime | None
    freshness: Freshness
    people_count: int | None
    people_smoothed: int | None
    derived_detection_confidence: float | None
    issues: tuple[str, ...]


def _utc(value: Any) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return None
    return parsed.astimezone(timezone.utc)


def _utc_datetime(value: datetime) -> datetime:
    if value.tzinfo is None:
        raise ValueError("evaluation timestamps must include a timezone")
    return value.astimezone(timezone.utc)


def _freshness(observed_at: datetime | None, evaluated_at: datetime, limit: timedelta) -> Freshness:
    if observed_at is None:
        return Freshness.MISSING
    age = evaluated_at - observed_at
    if age < timedelta(0):
        return Freshness.INVALID
    return Freshness.FRESH if age <= limit else Freshness.STALE


def rasid_zone_for_cps_location(location_id: str | None) -> str | None:
    return CPS_LOCATION_TO_RASID_ZONE.get(location_id or "")


def _finite_temperature(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if isfinite(number) else None


def normalize_cps_node_evidence(
    payload: Any,
    *,
    evaluated_at: datetime,
    freshness_limit: timedelta,
) -> RealCpsNodeEvidence:
    """Normalize an already validated NODE-04 adapter response without I/O."""
    now = _utc_datetime(evaluated_at)
    if not isinstance(payload, dict):
        missing = NormalizedTemperature(None, None, None, None, Freshness.MISSING, ("CPS_PAYLOAD_MISSING",))
        return RealCpsNodeEvidence(EVIDENCE_SCHEMA_VERSION, "real_operations", "cps_node_state", now, None, None, None, None, None, None, Freshness.MISSING, None, missing, ("CPS_PAYLOAD_MISSING",))

    node_id = payload.get("node_id") if isinstance(payload.get("node_id"), str) else None
    location_id = payload.get("location_id") if isinstance(payload.get("location_id"), str) else None
    zone_id = rasid_zone_for_cps_location(location_id)
    as_of = _utc(payload.get("as_of"))
    snapshot_freshness = _freshness(as_of, now, freshness_limit)
    heartbeat = _utc(payload.get("last_heartbeat_received_at")) if payload.get("last_heartbeat_received_at") is not None else None
    issues: list[str] = []
    if node_id != "NODE-04":
        issues.append("UNEXPECTED_NODE")
    if location_id is None:
        issues.append("MISSING_LOCATION")
    elif zone_id is None:
        issues.append("ZONE_MAPPING_MISSING")
    if snapshot_freshness is not Freshness.FRESH:
        issues.append(f"CPS_SNAPSHOT_{snapshot_freshness.value}")

    temperatures: list[tuple[datetime, dict[str, Any], float]] = []
    readings = payload.get("readings")
    if isinstance(readings, list):
        for reading in readings:
            if not isinstance(reading, dict) or str(reading.get("sensor_type", "")).strip().lower() != "temperature":
                continue
            observed = _utc(reading.get("timestamp"))
            value = _finite_temperature(reading.get("value"))
            if observed is not None and value is not None:
                temperatures.append((observed, reading, value))
    if not temperatures:
        temperature = NormalizedTemperature(None, None, None, None, Freshness.MISSING, ("TEMPERATURE_MISSING_OR_INVALID",))
        issues.append("TEMPERATURE_MISSING_OR_INVALID")
    else:
        observed, reading, value = max(temperatures, key=lambda item: item[0])
        validation = reading.get("validation_status") if isinstance(reading.get("validation_status"), str) else None
        temp_freshness = _freshness(observed, now, freshness_limit)
        temp_issues: list[str] = []
        if temp_freshness is not Freshness.FRESH:
            temp_issues.append(f"TEMPERATURE_{temp_freshness.value}")
        if validation != "NORMAL":
            temp_issues.append("TEMPERATURE_VALIDATION_NOT_NORMAL")
        temperature = NormalizedTemperature(
            reading.get("sensor_id") if isinstance(reading.get("sensor_id"), str) else None,
            value,
            observed,
            validation,
            temp_freshness,
            tuple(temp_issues),
        )
        issues.extend(temp_issues)

    return RealCpsNodeEvidence(
        EVIDENCE_SCHEMA_VERSION,
        "real_operations",
        "cps_node_state",
        now,
        node_id,
        location_id,
        zone_id,
        payload.get("status") if isinstance(payload.get("status"), str) else None,
        payload.get("connection_status") if isinstance(payload.get("connection_status"), str) else None,
        as_of,
        snapshot_freshness,
        heartbeat,
        temperature,
        tuple(dict.fromkeys(issues)),
    )


def normalize_people_snapshot(
    snapshot: PeopleSnapshot | None,
    *,
    evaluated_at: datetime,
    freshness_limit: timedelta,
) -> RealAiPeopleEvidence:
    """Normalize the passive cache observation; absence never becomes a zero count."""
    now = _utc_datetime(evaluated_at)
    if snapshot is None:
        return RealAiPeopleEvidence(EVIDENCE_SCHEMA_VERSION, "real_operations", "live_ai", now, None, None, None, Freshness.MISSING, None, None, None, ("AI_SNAPSHOT_MISSING",))
    observed = datetime.fromtimestamp(snapshot.observed_at / 1000, tz=timezone.utc)
    freshness = _freshness(observed, now, freshness_limit)
    issues: list[str] = []
    if not snapshot.zone_id:
        issues.append("AI_ZONE_MISSING")
    if freshness is not Freshness.FRESH:
        issues.append(f"AI_SNAPSHOT_{freshness.value}")
    return RealAiPeopleEvidence(
        EVIDENCE_SCHEMA_VERSION,
        "real_operations",
        "live_ai",
        now,
        snapshot.camera_id,
        snapshot.zone_id or None,
        observed,
        freshness,
        snapshot.people_count,
        snapshot.people_smoothed,
        snapshot.derived_detection_confidence,
        tuple(issues),
    )


def derive_observed_trend(previous: NumericObservation | None, current: NumericObservation | None) -> ObservedTrend:
    """Compare two supplied observations only; no history is synthesized or retained."""
    if previous is None or current is None:
        return ObservedTrend(Trend.UNKNOWN, None, previous.observed_at if previous else None, current.observed_at if current else None, "OBSERVATION_HISTORY_MISSING")
    if previous.source_id != current.source_id:
        return ObservedTrend(Trend.UNKNOWN, None, previous.observed_at, current.observed_at, "OBSERVATION_SOURCE_MISMATCH")
    if current.observed_at <= previous.observed_at:
        return ObservedTrend(Trend.UNKNOWN, None, previous.observed_at, current.observed_at, "OBSERVATION_TIMESTAMP_NOT_INCREASING")
    delta = current.value - previous.value
    direction = Trend.INCREASING if delta > 0 else Trend.DECREASING if delta < 0 else Trend.STABLE
    return ObservedTrend(direction, delta, previous.observed_at, current.observed_at, "OBSERVED_DELTA")
