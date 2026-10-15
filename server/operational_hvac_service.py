"""Callable monitor-only assembly point for current real HVAC evidence.

No endpoint, scheduler, persistence, command, or background polling is provided.
Callers explicitly choose when to collect evidence and must supply any genuinely
observed prior values used for trend comparison.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Callable

from cps_integration import CpsIntegrationError, fetch_node_reading_history, fetch_node_state
from operational_evidence import (
    NumericObservation,
    RealAiPeopleEvidence,
    RealCpsNodeEvidence,
    derive_observed_trend,
    normalize_cps_node_evidence,
    normalize_people_snapshot,
)
from operational_hvac_policy import (
    OperationalHvacPolicy,
    OperationalHvacRecommendationRecord,
    UNCONFIGURED_OPERATIONAL_POLICY,
    evaluate_operational_hvac,
)
from people_snapshot import PeopleSnapshot, PeopleSnapshotCache, people_snapshot_cache


DEFAULT_CAMERA_ID = "CAM-1"


@dataclass(frozen=True)
class OperationalHvacEvaluation:
    """Current evidence and its monitor-only evaluation; no history is retained."""

    cps: RealCpsNodeEvidence
    ai: RealAiPeopleEvidence
    recommendation: OperationalHvacRecommendationRecord
    policy: OperationalHvacPolicy = UNCONFIGURED_OPERATIONAL_POLICY


def collect_operational_evidence(
    *,
    evaluated_at: datetime | None,
    cps_freshness_limit: timedelta,
    ai_freshness_limit: timedelta,
    camera_id: str = DEFAULT_CAMERA_ID,
    fetch_cps_state: Callable[[], dict] = fetch_node_state,
    snapshot_cache: PeopleSnapshotCache = people_snapshot_cache,
) -> tuple[RealCpsNodeEvidence, RealAiPeopleEvidence]:
    """Read existing sources once; a CPS failure becomes explicit missing evidence.

    A live CPS ``as_of`` timestamp is produced while the HTTP request is in
    flight.  When the caller does not supply a deterministic test timestamp,
    capture the evaluation time *after* both passive reads so that a fresh CPS
    snapshot is not incorrectly classified as a future observation merely due
    to request ordering.  Genuine future source timestamps still fail closed in
    the normalizer.
    """
    try:
        payload = fetch_cps_state()
    except CpsIntegrationError:
        payload = None
    snapshot: PeopleSnapshot | None = snapshot_cache.get(camera_id)
    effective_evaluated_at = evaluated_at or datetime.now(timezone.utc)
    cps = normalize_cps_node_evidence(payload, evaluated_at=effective_evaluated_at, freshness_limit=cps_freshness_limit)
    ai = normalize_people_snapshot(snapshot, evaluated_at=effective_evaluated_at, freshness_limit=ai_freshness_limit)
    return cps, ai


def collect_and_evaluate_operational_hvac(
    *,
    evaluated_at: datetime | None,
    cps_freshness_limit: timedelta,
    ai_freshness_limit: timedelta,
    previous_temperature: NumericObservation | None = None,
    previous_people: NumericObservation | None = None,
    policy: OperationalHvacPolicy = UNCONFIGURED_OPERATIONAL_POLICY,
    camera_id: str = DEFAULT_CAMERA_ID,
    fetch_cps_state: Callable[[], dict] = fetch_node_state,
    snapshot_cache: PeopleSnapshotCache = people_snapshot_cache,
) -> OperationalHvacEvaluation:
    """Evaluate only supplied current/prior observations; never creates history."""
    cps, ai = collect_operational_evidence(
        evaluated_at=evaluated_at,
        cps_freshness_limit=cps_freshness_limit,
        ai_freshness_limit=ai_freshness_limit,
        camera_id=camera_id,
        fetch_cps_state=fetch_cps_state,
        snapshot_cache=snapshot_cache,
    )
    current_temperature = (
        NumericObservation(cps.temperature.value_c, cps.temperature.observed_at, cps.temperature.sensor_id)
        if cps.temperature.value_c is not None and cps.temperature.observed_at is not None and cps.temperature.sensor_id is not None
        else None
    )
    current_people_value = ai.people_smoothed if ai.people_smoothed is not None else ai.people_count
    current_people = (
        NumericObservation(float(current_people_value), ai.observed_at, ai.camera_id)
        if current_people_value is not None and ai.observed_at is not None and ai.camera_id is not None
        else None
    )
    recommendation = evaluate_operational_hvac(
        cps,
        ai,
        temperature_trend=derive_observed_trend(previous_temperature, current_temperature),
        crowd_trend=derive_observed_trend(previous_people, current_people),
        policy=policy,
    )
    return OperationalHvacEvaluation(cps, ai, recommendation, policy)


def _optional_number(raw: str, kind: type) -> float | int | None:
    try:
        return kind(raw) if raw.strip() else None
    except ValueError:
        return None


def policy_from_settings(
    *,
    approved: bool,
    reactive_temperature_c: str,
    normal_temperature_max_c: str,
    minimum_temperature_rise_c: str,
    minimum_crowd_increase: str,
    accept_single_sensor_temperature: bool,
) -> OperationalHvacPolicy:
    """Build the policy from configuration; a missing or malformed value leaves it unconfigured."""
    return OperationalHvacPolicy(
        version="real-hvac-v1-approved" if approved else UNCONFIGURED_OPERATIONAL_POLICY.version,
        approved=approved,
        reactive_temperature_c=_optional_number(reactive_temperature_c, float),
        normal_temperature_max_c=_optional_number(normal_temperature_max_c, float),
        minimum_temperature_rise_c=_optional_number(minimum_temperature_rise_c, float),
        minimum_crowd_increase=_optional_number(minimum_crowd_increase, int),
        accept_single_sensor_temperature=accept_single_sensor_temperature,
    )


def previous_temperature_observation(
    *,
    sensor_id: str,
    now: datetime,
    lookback: timedelta,
    fetch_history: Callable[..., dict] = fetch_node_reading_history,
) -> NumericObservation | None:
    """The newest real CPS reading at least ``lookback`` old (within a 2-minute window)."""
    end = now - lookback
    try:
        history = fetch_history(sensor_id=sensor_id, start=end - timedelta(minutes=2), end=end)
    except CpsIntegrationError:
        return None
    points = []
    for item in history.get("items", []):
        try:
            observed = datetime.fromisoformat(str(item["timestamp"]).replace("Z", "+00:00"))
            if observed.tzinfo is None:
                observed = observed.replace(tzinfo=timezone.utc)
            points.append((observed, float(item["value"])))
        except (KeyError, TypeError, ValueError):
            continue
    if not points:
        return None
    observed, value = max(points)
    return NumericObservation(value, observed, sensor_id)


def previous_people_observation(
    *,
    camera_id: str,
    now: datetime,
    lookback: timedelta,
    snapshot_cache: PeopleSnapshotCache = people_snapshot_cache,
) -> NumericObservation | None:
    """The newest recorded people count at least ``lookback`` old, from the live cache history."""
    snapshot = snapshot_cache.observed_at_or_before(camera_id, int((now - lookback).timestamp() * 1000))
    if snapshot is None:
        return None
    value = snapshot.people_smoothed if snapshot.people_smoothed is not None else snapshot.people_count
    return NumericObservation(float(value), datetime.fromtimestamp(snapshot.observed_at / 1000, tz=timezone.utc), camera_id)


def evaluate_current_operational_hvac(
    **kwargs: object,
) -> OperationalHvacRecommendationRecord:
    """Compatibility helper returning only the monitor-only recommendation record."""
    return collect_and_evaluate_operational_hvac(**kwargs).recommendation  # type: ignore[arg-type]
