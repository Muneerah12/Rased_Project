from __future__ import annotations

import math
import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path


SERVER_DIR = Path(__file__).resolve().parents[1]
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))

from decision_engine import (  # noqa: E402
    DecisionContext,
    Recommendation,
    SensorInput,
    SimulatedFanState,
    evaluate_hvac_simulation,
)


NOW = datetime(2026, 10, 10, 12, 0, tzinfo=timezone.utc)


def evaluate(
    temperature: float | None = 25.0,
    *,
    status: str | None = "NORMAL",
    connection: str | None = "ONLINE",
    input_at: datetime | None = NOW,
    previous: SimulatedFanState | None = SimulatedFanState.OFF,
    changed_at: datetime | None = NOW - timedelta(seconds=60),
):
    return evaluate_hvac_simulation(
        SensorInput(temperature, input_at, status),
        DecisionContext(connection, previous, changed_at, NOW),
    )


class DecisionEngineTests(unittest.TestCase):
    def test_on_and_off_threshold_boundaries(self):
        on = evaluate(26.0, previous=SimulatedFanState.OFF)
        self.assertEqual(on.recommendation, Recommendation.TURN_FAN_ON)
        self.assertEqual(on.proposed_simulated_state, SimulatedFanState.ON)

        off = evaluate(24.0, previous=SimulatedFanState.ON)
        self.assertEqual(off.recommendation, Recommendation.TURN_FAN_OFF)
        self.assertEqual(off.proposed_simulated_state, SimulatedFanState.OFF)

    def test_hysteresis_holds_previous_state(self):
        self.assertEqual(evaluate(25.0, previous=SimulatedFanState.OFF).recommendation, Recommendation.HOLD)
        self.assertEqual(evaluate(25.0, previous=SimulatedFanState.ON).recommendation, Recommendation.HOLD)
        self.assertEqual(evaluate(26.0, previous=SimulatedFanState.ON).recommendation, Recommendation.HOLD)
        self.assertEqual(evaluate(24.0, previous=SimulatedFanState.OFF).recommendation, Recommendation.HOLD)

    def test_minimum_dwell_holds(self):
        result = evaluate(30.0, changed_at=NOW - timedelta(seconds=59))
        self.assertEqual(result.recommendation, Recommendation.HOLD)
        self.assertEqual(result.reason_code, "MINIMUM_DWELL_ACTIVE")

    def test_missing_nonfinite_and_out_of_range_readings_are_rejected(self):
        cases = [
            (None, "MISSING_TEMPERATURE"),
            (math.nan, "NONFINITE_TEMPERATURE"),
            (math.inf, "NONFINITE_TEMPERATURE"),
            (-math.inf, "NONFINITE_TEMPERATURE"),
            (-40.1, "OUT_OF_RANGE_TEMPERATURE"),
            (85.1, "OUT_OF_RANGE_TEMPERATURE"),
        ]
        for temperature, reason in cases:
            with self.subTest(temperature=temperature):
                result = evaluate(temperature)
                self.assertEqual(result.recommendation, Recommendation.INSUFFICIENT_DATA)
                self.assertEqual(result.reason_code, reason)

    def test_integrity_statuses_except_normal_are_rejected(self):
        for status in (None, "UNKNOWN", "SUSPICIOUS", "INVALID"):
            with self.subTest(status=status):
                result = evaluate(status=status)
                self.assertEqual(result.recommendation, Recommendation.INSUFFICIENT_DATA)
                self.assertEqual(result.reason_code, "UNTRUSTED_SENSOR_STATUS")

    def test_stale_and_offline_nodes_are_rejected(self):
        for connection in ("STALE", "OFFLINE", None):
            with self.subTest(connection=connection):
                result = evaluate(connection=connection)
                self.assertEqual(result.recommendation, Recommendation.INSUFFICIENT_DATA)
                self.assertEqual(result.reason_code, "NODE_NOT_ONLINE")

    def test_stale_and_future_sensor_timestamps_are_rejected(self):
        stale = evaluate(input_at=NOW - timedelta(seconds=31))
        self.assertEqual(stale.reason_code, "STALE_INPUT_TIMESTAMP")
        future = evaluate(input_at=NOW + timedelta(seconds=1))
        self.assertEqual(future.reason_code, "FUTURE_INPUT_TIMESTAMP")

    def test_unknown_state_or_timing_context_is_rejected(self):
        self.assertEqual(evaluate(previous=None).reason_code, "UNKNOWN_SIMULATED_STATE")
        self.assertEqual(evaluate(changed_at=None).reason_code, "UNKNOWN_SIMULATED_STATE")
        future_change = evaluate(changed_at=NOW + timedelta(seconds=1))
        self.assertEqual(future_change.reason_code, "FUTURE_STATE_CHANGE_TIMESTAMP")
        invalid_state = evaluate(previous="ON")  # type: ignore[arg-type]
        self.assertEqual(invalid_state.reason_code, "INVALID_SIMULATED_STATE")

    def test_output_is_explicitly_simulated_and_has_no_side_effect_interface(self):
        result = evaluate(26.0)
        self.assertTrue(result.simulation)
        self.assertEqual(result.policy_version, "sim-hvac-v1")
        self.assertEqual(result.evaluated_at, NOW)
        self.assertEqual(result.input_timestamp, NOW)
        self.assertFalse(hasattr(result, "command"))
        self.assertFalse(hasattr(result, "execute"))


if __name__ == "__main__":
    unittest.main()
