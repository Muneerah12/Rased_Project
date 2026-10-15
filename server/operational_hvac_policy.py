"""Monitor-only HVAC recommendations for real operations.

There are intentionally no command, scheduler, incident, notification, or actuator
interfaces here. Real thresholds are unconfigured until explicitly approved.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import Enum
from math import isfinite

from operational_evidence import Freshness, ObservedTrend, RealAiPeopleEvidence, RealCpsNodeEvidence, Trend


class OperationalRecommendation(str, Enum):
    VENTILATION_RECOMMENDED = "VENTILATION_RECOMMENDED"
    ANTICIPATED_VENTILATION_DEMAND = "ANTICIPATED_VENTILATION_DEMAND"
    PREEMPTIVE_VENTILATION_RECOMMENDED = "PREEMPTIVE_VENTILATION_RECOMMENDED"
    NO_RECOMMENDATION = "NO_RECOMMENDATION"
    INSUFFICIENT_EVIDENCE = "INSUFFICIENT_EVIDENCE"
    POLICY_NOT_CONFIGURED = "POLICY_NOT_CONFIGURED"


@dataclass(frozen=True)
class OperationalHvacPolicy:
    """Reviewable policy inputs. No numerical operational threshold has a default."""

    version: str = "real-hvac-draft-v1"
    approved: bool = False
    reactive_temperature_c: float | None = None
    normal_temperature_max_c: float | None = None
    minimum_temperature_rise_c: float | None = None
    minimum_crowd_increase: int | None = None
    preemptive_activation_enabled: bool = False
    # CPS marks a reading NORMAL only when a configured peer sensor agrees, so a
    # node with one temperature sensor reports UNKNOWN ("insufficient comparable
    # peers"). When enabled, that UNKNOWN is accepted; INVALID/SUSPICIOUS never are.
    accept_single_sensor_temperature: bool = False


UNCONFIGURED_OPERATIONAL_POLICY = OperationalHvacPolicy()


@dataclass(frozen=True)
class OperationalHvacRecommendationRecord:
    recommendation: OperationalRecommendation
    reason_code: str
    reason: str
    policy_version: str
    context: str
    monitor_only: bool
    evaluated_at: datetime
    zone_id: str | None
    temperature_c: float | None
    people_count: int | None
    temperature_trend: ObservedTrend
    crowd_trend: ObservedTrend
    sources: tuple[str, ...]
    evidence_issues: tuple[str, ...]
    derived_detection_confidence: float | None


def _record(
    recommendation: OperationalRecommendation,
    reason_code: str,
    reason: str,
    *,
    policy: OperationalHvacPolicy,
    cps: RealCpsNodeEvidence,
    ai: RealAiPeopleEvidence,
    temperature_trend: ObservedTrend,
    crowd_trend: ObservedTrend,
    issues: tuple[str, ...] = (),
) -> OperationalHvacRecommendationRecord:
    return OperationalHvacRecommendationRecord(
        recommendation,
        reason_code,
        reason,
        policy.version,
        "real_operations",
        True,
        cps.evaluated_at,
        cps.zone_id,
        cps.temperature.value_c,
        ai.people_smoothed if ai.people_smoothed is not None else ai.people_count,
        temperature_trend,
        crowd_trend,
        ("cps_node_state", "live_ai"),
        issues,
        ai.derived_detection_confidence,
    )


def _evidence_issues(cps: RealCpsNodeEvidence, ai: RealAiPeopleEvidence, policy: OperationalHvacPolicy) -> tuple[str, ...]:
    single_sensor_ok = policy.accept_single_sensor_temperature and cps.temperature.validation_status == "UNKNOWN"
    issues = [i for i in cps.issues if not (single_sensor_ok and i == "TEMPERATURE_VALIDATION_NOT_NORMAL")] + list(ai.issues)
    if cps.connection_status != "ONLINE":
        issues.append("CPS_NODE_NOT_ONLINE")
    if cps.snapshot_freshness is not Freshness.FRESH:
        issues.append("CPS_SNAPSHOT_NOT_FRESH")
    if cps.temperature.freshness is not Freshness.FRESH:
        issues.append("TEMPERATURE_NOT_FRESH")
    if cps.temperature.validation_status != "NORMAL" and not single_sensor_ok:
        issues.append("TEMPERATURE_NOT_NORMAL")
    if cps.temperature.value_c is None:
        issues.append("TEMPERATURE_MISSING")
    if ai.freshness is not Freshness.FRESH or ai.people_count is None:
        issues.append("AI_PEOPLE_EVIDENCE_NOT_FRESH")
    if cps.zone_id is None or ai.zone_id is None or cps.zone_id != ai.zone_id:
        issues.append("EVIDENCE_ZONE_CONFLICT")
    return tuple(dict.fromkeys(issues))


def policy_is_configured(policy: OperationalHvacPolicy) -> bool:
    return _configured(policy)


def _configured(policy: OperationalHvacPolicy) -> bool:
    values = (
        policy.reactive_temperature_c,
        policy.normal_temperature_max_c,
        policy.minimum_temperature_rise_c,
        policy.minimum_crowd_increase,
    )
    if not policy.approved or any(value is None for value in values):
        return False
    numeric = values[:3]
    if any(not isinstance(value, (int, float)) or isinstance(value, bool) or not isfinite(float(value)) for value in numeric):
        return False
    crowd_increase = policy.minimum_crowd_increase
    return isinstance(crowd_increase, int) and not isinstance(crowd_increase, bool) and crowd_increase >= 0


def evaluate_operational_hvac(
    cps: RealCpsNodeEvidence,
    ai: RealAiPeopleEvidence,
    *,
    temperature_trend: ObservedTrend,
    crowd_trend: ObservedTrend,
    policy: OperationalHvacPolicy = UNCONFIGURED_OPERATIONAL_POLICY,
) -> OperationalHvacRecommendationRecord:
    """Return an explainable monitor-only result from already normalized evidence."""
    issues = _evidence_issues(cps, ai, policy)
    if issues:
        return _record(OperationalRecommendation.INSUFFICIENT_EVIDENCE, "REAL_EVIDENCE_INSUFFICIENT", "Fresh, compatible CPS temperature and AI people observations are required.", policy=policy, cps=cps, ai=ai, temperature_trend=temperature_trend, crowd_trend=crowd_trend, issues=issues)
    if not _configured(policy):
        return _record(OperationalRecommendation.POLICY_NOT_CONFIGURED, "REAL_POLICY_NOT_APPROVED", "Operational thresholds are not configured and approved.", policy=policy, cps=cps, ai=ai, temperature_trend=temperature_trend, crowd_trend=crowd_trend)

    temperature = cps.temperature.value_c
    people = ai.people_smoothed if ai.people_smoothed is not None else ai.people_count
    assert temperature is not None and people is not None
    temperature_rising = temperature_trend.direction is Trend.INCREASING and (temperature_trend.delta or 0.0) >= float(policy.minimum_temperature_rise_c)
    crowd_increasing = crowd_trend.direction is Trend.INCREASING and (crowd_trend.delta or 0.0) >= float(policy.minimum_crowd_increase)

    if temperature_rising and crowd_increasing:
        return _record(OperationalRecommendation.VENTILATION_RECOMMENDED, "COMBINED_OBSERVED_TEMPERATURE_AND_CROWD_RISE", "Observed temperature and crowd count both increased; this is a monitor-only ventilation recommendation, not a forecast or command.", policy=policy, cps=cps, ai=ai, temperature_trend=temperature_trend, crowd_trend=crowd_trend)
    if temperature >= float(policy.reactive_temperature_c) and crowd_trend.direction is Trend.STABLE:
        return _record(OperationalRecommendation.VENTILATION_RECOMMENDED, "REACTIVE_ELEVATED_TEMPERATURE_STABLE_CROWD", "Observed temperature meets the approved reactive threshold while the observed crowd count is stable.", policy=policy, cps=cps, ai=ai, temperature_trend=temperature_trend, crowd_trend=crowd_trend)
    if crowd_increasing and temperature <= float(policy.normal_temperature_max_c):
        if policy.preemptive_activation_enabled:
            return _record(OperationalRecommendation.PREEMPTIVE_VENTILATION_RECOMMENDED, "APPROVED_PREEMPTIVE_CROWD_POLICY", "Observed crowd count increased while temperature remains within the approved normal range; pre-emptive ventilation is enabled by approved policy.", policy=policy, cps=cps, ai=ai, temperature_trend=temperature_trend, crowd_trend=crowd_trend)
        return _record(OperationalRecommendation.ANTICIPATED_VENTILATION_DEMAND, "OBSERVED_CROWD_INCREASE_NO_FORECAST_MODEL", "Observed crowd count increased while temperature is normal. This indicates anticipated demand only; no forecast model or pre-emptive activation policy is enabled.", policy=policy, cps=cps, ai=ai, temperature_trend=temperature_trend, crowd_trend=crowd_trend)
    return _record(OperationalRecommendation.NO_RECOMMENDATION, "OBSERVED_CONDITIONS_DO_NOT_MATCH_POLICY", "Available observations do not match an approved monitor-only ventilation condition.", policy=policy, cps=cps, ai=ai, temperature_trend=temperature_trend, crowd_trend=crowd_trend)
