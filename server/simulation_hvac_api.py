"""Strict, stateless API contract for the isolated HVAC simulation evaluator."""

from __future__ import annotations

from datetime import datetime, timezone
from math import isfinite
from typing import Any

from decision_engine import (
    SIMULATION_POLICY_V1,
    DecisionContext,
    DecisionRecord,
    SensorInput,
    SimulatedFanState,
    evaluate_hvac_simulation,
)


class SimulationHvacRequestError(ValueError):
    """Raised for a malformed simulation-only request."""


_ROOT_FIELDS = {"schema_version", "context", "simulated", "sensor", "simulation_context"}
_SENSOR_FIELDS = {"temperature_c", "observed_at", "validation_status"}
_CONTEXT_FIELDS = {"connection_status", "previous_simulated_state", "last_simulated_state_change_at", "evaluated_at"}
_VALIDATION_STATUSES = {"NORMAL", "UNKNOWN", "SUSPICIOUS", "INVALID"}
_CONNECTION_STATUSES = {"ONLINE", "STALE", "OFFLINE"}
_FAN_STATES = {state.value for state in SimulatedFanState}


def _record(value: Any, name: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise SimulationHvacRequestError(f"{name} must be an object")
    return value


def _exact_fields(value: dict[str, Any], expected: set[str], name: str) -> None:
    if set(value) != expected:
        raise SimulationHvacRequestError(f"{name} contains unsupported or missing fields")


def _nullable_enum(value: Any, allowed: set[str], name: str) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str) or value not in allowed:
        raise SimulationHvacRequestError(f"{name} is invalid")
    return value


def _timestamp(value: Any, name: str, *, nullable: bool) -> datetime | None:
    if value is None and nullable:
        return None
    if not isinstance(value, str) or "T" not in value:
        raise SimulationHvacRequestError(f"{name} must be a timezone-aware ISO 8601 timestamp")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise SimulationHvacRequestError(f"{name} must be a timezone-aware ISO 8601 timestamp") from exc
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise SimulationHvacRequestError(f"{name} must include a timezone")
    return parsed.astimezone(timezone.utc)


def _temperature(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not isfinite(value):
        raise SimulationHvacRequestError("temperature_c must be a finite number or null")
    return float(value)


def _format_timestamp(value: datetime | None) -> str | None:
    if value is None:
        return None
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def evaluate_simulation_request(payload: Any) -> dict[str, Any]:
    """Validate a synthetic snapshot and evaluate it without retaining any state."""
    root = _record(payload, "request")
    _exact_fields(root, _ROOT_FIELDS, "request")
    if root["schema_version"] != "simulation-hvac-evaluate-request-v1":
        raise SimulationHvacRequestError("schema_version is invalid")
    if root["context"] != "simulation" or root["simulated"] is not True:
        raise SimulationHvacRequestError("request must be explicitly simulated")

    sensor = _record(root["sensor"], "sensor")
    context = _record(root["simulation_context"], "simulation_context")
    _exact_fields(sensor, _SENSOR_FIELDS, "sensor")
    _exact_fields(context, _CONTEXT_FIELDS, "simulation_context")

    validation_status = _nullable_enum(sensor["validation_status"], _VALIDATION_STATUSES, "validation_status")
    connection_status = _nullable_enum(context["connection_status"], _CONNECTION_STATUSES, "connection_status")
    previous_state = _nullable_enum(context["previous_simulated_state"], _FAN_STATES, "previous_simulated_state")
    observed_at = _timestamp(sensor["observed_at"], "observed_at", nullable=True)
    last_changed_at = _timestamp(context["last_simulated_state_change_at"], "last_simulated_state_change_at", nullable=True)
    evaluated_at = _timestamp(context["evaluated_at"], "evaluated_at", nullable=False)

    result = evaluate_hvac_simulation(
        SensorInput(_temperature(sensor["temperature_c"]), observed_at, validation_status),
        DecisionContext(
            connection_status,
            SimulatedFanState(previous_state) if previous_state is not None else None,
            last_changed_at,
            evaluated_at,
        ),
        policy=SIMULATION_POLICY_V1,
    )
    return simulation_evaluation_response(result)


def simulation_evaluation_response(result: DecisionRecord) -> dict[str, Any]:
    """Serialize only the public, simulation-only decision record."""
    return {
        "schema_version": "simulation-hvac-evaluation-api-v1",
        "context": "simulation",
        "simulated": True,
        "evaluation": {
            "recommendation": result.recommendation.value,
            "reason_code": result.reason_code,
            "reason": result.reason,
            "policy_version": result.policy_version,
            "evaluated_at": _format_timestamp(result.evaluated_at),
            "input_timestamp": _format_timestamp(result.input_timestamp),
            "connection_status": result.connection_status,
            "previous_simulated_state": result.previous_simulated_state.value if result.previous_simulated_state else None,
            "proposed_simulated_state": result.proposed_simulated_state.value if result.proposed_simulated_state else None,
        },
    }
