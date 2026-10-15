"""Pure, simulation-only HVAC recommendation policy.

This module evaluates caller-supplied data only. It neither reads CPS nor
issues commands, so a future command boundary can require its own explicit
authorization, auditing, acknowledgement, and safety contract.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from enum import Enum
from math import isfinite


class SimulatedFanState(str, Enum):
    ON = "ON"
    OFF = "OFF"


class Recommendation(str, Enum):
    TURN_FAN_ON = "TURN_FAN_ON"
    TURN_FAN_OFF = "TURN_FAN_OFF"
    HOLD = "HOLD"
    INSUFFICIENT_DATA = "INSUFFICIENT_DATA"


@dataclass(frozen=True)
class SimulationPolicy:
    """Simulation defaults copied from the local ESP32 policy, not production limits."""

    version: str = "sim-hvac-v1"
    fan_on_temperature_c: float = 26.0
    fan_off_temperature_c: float = 24.0
    minimum_state_change_interval: timedelta = timedelta(seconds=60)
    freshness_limit: timedelta = timedelta(seconds=30)
    engineering_min_temperature_c: float = -40.0
    engineering_max_temperature_c: float = 85.0


SIMULATION_POLICY_V1 = SimulationPolicy()


@dataclass(frozen=True)
class SensorInput:
    temperature_c: float | None
    timestamp: datetime | None
    validation_status: str | None


@dataclass(frozen=True)
class DecisionContext:
    connection_status: str | None
    previous_simulated_state: SimulatedFanState | None
    last_simulated_state_change_at: datetime | None
    evaluated_at: datetime


@dataclass(frozen=True)
class DecisionRecord:
    recommendation: Recommendation
    reason_code: str
    reason: str
    policy_version: str
    simulation: bool
    evaluated_at: datetime
    input_timestamp: datetime | None
    connection_status: str | None
    previous_simulated_state: SimulatedFanState | None
    proposed_simulated_state: SimulatedFanState | None


def _utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        raise ValueError("timestamp must include a timezone")
    return value.astimezone(timezone.utc)


def _record(
    context: DecisionContext,
    sensor: SensorInput,
    policy: SimulationPolicy,
    recommendation: Recommendation,
    reason_code: str,
    reason: str,
    proposed_state: SimulatedFanState | None,
) -> DecisionRecord:
    return DecisionRecord(
        recommendation=recommendation,
        reason_code=reason_code,
        reason=reason,
        policy_version=policy.version,
        simulation=True,
        evaluated_at=context.evaluated_at,
        input_timestamp=sensor.timestamp,
        connection_status=context.connection_status,
        previous_simulated_state=context.previous_simulated_state,
        proposed_simulated_state=proposed_state,
    )


def evaluate_hvac_simulation(
    sensor: SensorInput,
    context: DecisionContext,
    policy: SimulationPolicy = SIMULATION_POLICY_V1,
) -> DecisionRecord:
    """Return a deterministic recommendation without hardware or network effects.

    The caller owns input acquisition and state persistence. ``evaluated_at``
    must be supplied so tests and any future scheduler remain deterministic.
    """
    evaluated_at = _utc(context.evaluated_at)
    input_timestamp = _utc(sensor.timestamp) if sensor.timestamp is not None else None
    last_change_at = (
        _utc(context.last_simulated_state_change_at)
        if context.last_simulated_state_change_at is not None
        else None
    )
    normalized_context = DecisionContext(
        connection_status=context.connection_status,
        previous_simulated_state=context.previous_simulated_state,
        last_simulated_state_change_at=last_change_at,
        evaluated_at=evaluated_at,
    )
    normalized_sensor = SensorInput(
        temperature_c=sensor.temperature_c,
        timestamp=input_timestamp,
        validation_status=sensor.validation_status,
    )

    if sensor.temperature_c is None or not isinstance(sensor.temperature_c, (int, float)) or isinstance(sensor.temperature_c, bool):
        return _record(normalized_context, normalized_sensor, policy, Recommendation.INSUFFICIENT_DATA, "MISSING_TEMPERATURE", "A numeric temperature reading is required.", None)
    temperature = float(sensor.temperature_c)
    if not isfinite(temperature):
        return _record(normalized_context, normalized_sensor, policy, Recommendation.INSUFFICIENT_DATA, "NONFINITE_TEMPERATURE", "Temperature must be finite.", None)
    if not policy.engineering_min_temperature_c <= temperature <= policy.engineering_max_temperature_c:
        return _record(normalized_context, normalized_sensor, policy, Recommendation.INSUFFICIENT_DATA, "OUT_OF_RANGE_TEMPERATURE", "Temperature is outside the simulation engineering range.", None)
    if sensor.validation_status != "NORMAL":
        return _record(normalized_context, normalized_sensor, policy, Recommendation.INSUFFICIENT_DATA, "UNTRUSTED_SENSOR_STATUS", "Only NORMAL sensor integrity status is eligible for simulation.", None)
    if context.connection_status != "ONLINE":
        return _record(normalized_context, normalized_sensor, policy, Recommendation.INSUFFICIENT_DATA, "NODE_NOT_ONLINE", "The CPS node must be ONLINE for a simulation recommendation.", None)
    if input_timestamp is None:
        return _record(normalized_context, normalized_sensor, policy, Recommendation.INSUFFICIENT_DATA, "MISSING_INPUT_TIMESTAMP", "A sensor timestamp is required.", None)

    input_age = evaluated_at - input_timestamp
    if input_age < timedelta(0):
        return _record(normalized_context, normalized_sensor, policy, Recommendation.INSUFFICIENT_DATA, "FUTURE_INPUT_TIMESTAMP", "A future sensor timestamp is not eligible for simulation.", None)
    if input_age > policy.freshness_limit:
        return _record(normalized_context, normalized_sensor, policy, Recommendation.INSUFFICIENT_DATA, "STALE_INPUT_TIMESTAMP", "The sensor reading exceeds the simulation freshness limit.", None)
    if context.previous_simulated_state is None or last_change_at is None:
        return _record(normalized_context, normalized_sensor, policy, Recommendation.INSUFFICIENT_DATA, "UNKNOWN_SIMULATED_STATE", "Previous simulated fan state and state-change time are required.", None)
    if not isinstance(context.previous_simulated_state, SimulatedFanState):
        return _record(normalized_context, normalized_sensor, policy, Recommendation.INSUFFICIENT_DATA, "INVALID_SIMULATED_STATE", "Previous simulated fan state is not recognised.", None)

    dwell_age = evaluated_at - last_change_at
    if dwell_age < timedelta(0):
        return _record(normalized_context, normalized_sensor, policy, Recommendation.INSUFFICIENT_DATA, "FUTURE_STATE_CHANGE_TIMESTAMP", "The previous simulated state-change time cannot be in the future.", None)
    if dwell_age < policy.minimum_state_change_interval:
        return _record(normalized_context, normalized_sensor, policy, Recommendation.HOLD, "MINIMUM_DWELL_ACTIVE", "The minimum simulated state-change interval has not elapsed.", context.previous_simulated_state)

    if context.previous_simulated_state is SimulatedFanState.OFF and temperature >= policy.fan_on_temperature_c:
        return _record(normalized_context, normalized_sensor, policy, Recommendation.TURN_FAN_ON, "TEMPERATURE_AT_OR_ABOVE_ON_THRESHOLD", "Temperature reached the simulated fan-on threshold.", SimulatedFanState.ON)
    if context.previous_simulated_state is SimulatedFanState.ON and temperature <= policy.fan_off_temperature_c:
        return _record(normalized_context, normalized_sensor, policy, Recommendation.TURN_FAN_OFF, "TEMPERATURE_AT_OR_BELOW_OFF_THRESHOLD", "Temperature reached the simulated fan-off threshold.", SimulatedFanState.OFF)
    return _record(normalized_context, normalized_sensor, policy, Recommendation.HOLD, "HYSTERESIS_OR_STATE_ALREADY_SATISFIED", "Temperature is within the hysteresis band or the simulated fan already matches the policy.", context.previous_simulated_state)
