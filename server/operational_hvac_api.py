"""Public-safe serialization for the read-only HVAC intelligence endpoint."""

from __future__ import annotations

from typing import Any

from operational_hvac_policy import policy_is_configured
from operational_hvac_service import OperationalHvacEvaluation


API_SCHEMA_VERSION = "operational-hvac-recommendation-api-v1"


def _timestamp(value: Any) -> str | None:
    return value.isoformat() if value is not None else None


def _trend(value: Any) -> dict[str, Any]:
    return {
        "direction": value.direction.value,
        "delta": value.delta,
        "previous_observed_at": _timestamp(value.previous_observed_at),
        "current_observed_at": _timestamp(value.current_observed_at),
        "reason_code": value.reason_code,
    }


def _thresholds(policy: Any) -> dict[str, Any] | None:
    """Approved thresholds for display; None until the policy is approved and complete."""
    if not policy_is_configured(policy):
        return None
    return {
        "reactive_temperature_c": float(policy.reactive_temperature_c),
        "normal_temperature_max_c": float(policy.normal_temperature_max_c),
        "minimum_temperature_rise_c": float(policy.minimum_temperature_rise_c),
        "minimum_crowd_increase": int(policy.minimum_crowd_increase),
    }


def recommendation_response(evaluation: OperationalHvacEvaluation) -> dict[str, Any]:
    """Return explicit safe fields only; excludes relay/network/credential data."""
    cps = evaluation.cps
    ai = evaluation.ai
    recommendation = evaluation.recommendation
    return {
        "schema_version": API_SCHEMA_VERSION,
        "context": recommendation.context,
        "monitor_only": recommendation.monitor_only,
        "evaluation": {
            "status": recommendation.recommendation.value,
            "reason_code": recommendation.reason_code,
            "explanation": recommendation.reason,
            "policy_version": recommendation.policy_version,
            "evaluated_at": _timestamp(recommendation.evaluated_at),
            "zone_id": recommendation.zone_id,
            "sources": list(recommendation.sources),
            "evidence_issues": list(recommendation.evidence_issues),
            "temperature_trend": _trend(recommendation.temperature_trend),
            "crowd_trend": _trend(recommendation.crowd_trend),
            "thresholds": _thresholds(evaluation.policy),
        },
        "evidence": {
            "cps": {
                "source": cps.source,
                "node_id": cps.node_id,
                "location_id": cps.location_id,
                "zone_id": cps.zone_id,
                "status": cps.status,
                "connection_status": cps.connection_status,
                "as_of": _timestamp(cps.as_of),
                "snapshot_freshness": cps.snapshot_freshness.value,
                "last_heartbeat_received_at": _timestamp(cps.last_heartbeat_received_at),
                "issues": list(cps.issues),
                "temperature": {
                    "sensor_id": cps.temperature.sensor_id,
                    "value_c": cps.temperature.value_c,
                    "observed_at": _timestamp(cps.temperature.observed_at),
                    "validation_status": cps.temperature.validation_status,
                    "freshness": cps.temperature.freshness.value,
                    "issues": list(cps.temperature.issues),
                },
            },
            "ai_people": {
                "source": ai.source,
                "camera_id": ai.camera_id,
                "zone_id": ai.zone_id,
                "observed_at": _timestamp(ai.observed_at),
                "freshness": ai.freshness.value,
                "people_count": ai.people_count,
                "people_smoothed": ai.people_smoothed,
                "derived_detection_confidence": ai.derived_detection_confidence,
                "confidence_note": "Derived detection confidence is not count accuracy.",
                "issues": list(ai.issues),
            },
        },
    }
