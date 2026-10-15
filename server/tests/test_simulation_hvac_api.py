from __future__ import annotations

import math
import sys
import unittest
from pathlib import Path

from fastapi import HTTPException
from starlette.requests import Request

SERVER_DIR = Path(__file__).resolve().parents[1]
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))

from simulation_hvac_api import SimulationHvacRequestError, evaluate_simulation_request  # noqa: E402
import main  # noqa: E402


NOW = "2026-10-10T12:01:00Z"


def payload(**overrides):
    value = {
        "schema_version": "simulation-hvac-evaluate-request-v1",
        "context": "simulation",
        "simulated": True,
        "sensor": {
            "temperature_c": 26.0,
            "observed_at": NOW,
            "validation_status": "NORMAL",
        },
        "simulation_context": {
            "connection_status": "ONLINE",
            "previous_simulated_state": "OFF",
            "last_simulated_state_change_at": "2026-10-10T12:00:00Z",
            "evaluated_at": NOW,
        },
    }
    value.update(overrides)
    return value


class SimulationHvacApiTests(unittest.TestCase):
    def test_evaluates_a_synthetic_snapshot_with_an_exact_public_contract(self):
        result = evaluate_simulation_request(payload())
        self.assertEqual(set(result), {"schema_version", "context", "simulated", "evaluation"})
        self.assertEqual(result["schema_version"], "simulation-hvac-evaluation-api-v1")
        self.assertEqual(result["context"], "simulation")
        self.assertTrue(result["simulated"])
        self.assertEqual(result["evaluation"]["recommendation"], "TURN_FAN_ON")
        self.assertEqual(result["evaluation"]["policy_version"], "sim-hvac-v1")
        self.assertEqual(result["evaluation"]["evaluated_at"], NOW)
        self.assertEqual(result["evaluation"]["proposed_simulated_state"], "ON")
        rendered = str(result).lower()
        for forbidden in ("command", "cps", "node-04", "incident", "journal", "notification", "relay"):
            self.assertNotIn(forbidden, rendered)

    def test_hysteresis_and_dwell_are_preserved_by_the_server_evaluation(self):
        value = payload()
        value["sensor"]["temperature_c"] = 25.0
        self.assertEqual(evaluate_simulation_request(value)["evaluation"]["recommendation"], "HOLD")

        value = payload()
        value["simulation_context"]["last_simulated_state_change_at"] = "2026-10-10T12:00:02Z"
        self.assertEqual(evaluate_simulation_request(value)["evaluation"]["reason_code"], "MINIMUM_DWELL_ACTIVE")

    def test_semantically_insufficient_synthetic_data_is_a_normal_evaluation_result(self):
        value = payload()
        value["simulation_context"]["connection_status"] = "OFFLINE"
        result = evaluate_simulation_request(value)["evaluation"]
        self.assertEqual((result["recommendation"], result["reason_code"]), ("INSUFFICIENT_DATA", "NODE_NOT_ONLINE"))

    def test_rejects_unknown_fields_context_and_invalid_enums(self):
        cases = []
        unknown = payload()
        unknown["unexpected"] = True
        cases.append(unknown)
        bad_context = payload(context="real_operations")
        cases.append(bad_context)
        bad_marker = payload(simulated=False)
        cases.append(bad_marker)
        bad_enum = payload()
        bad_enum["simulation_context"]["connection_status"] = "RECONNECTING"
        cases.append(bad_enum)
        nested_unknown = payload()
        nested_unknown["sensor"]["threshold"] = 1
        cases.append(nested_unknown)
        for value in cases:
            with self.subTest(value=value):
                with self.assertRaises(SimulationHvacRequestError):
                    evaluate_simulation_request(value)

    def test_rejects_naive_and_malformed_timestamps_and_nonfinite_temperature(self):
        naive = payload()
        naive["sensor"]["observed_at"] = "2026-10-10T12:01:00"
        malformed = payload()
        malformed["simulation_context"]["evaluated_at"] = "not-a-time"
        nonfinite = payload()
        nonfinite["sensor"]["temperature_c"] = math.inf
        for value in (naive, malformed, nonfinite):
            with self.subTest(value=value):
                with self.assertRaises(SimulationHvacRequestError):
                    evaluate_simulation_request(value)

    def test_implementation_has_no_operational_or_physical_dependencies(self):
        source = (SERVER_DIR / "simulation_hvac_api.py").read_text(encoding="utf-8")
        for forbidden in ("cps_integration", "operational_hvac", "people_snapshot", "hub", "notifier", "command"):
            self.assertNotIn(forbidden, source)

    def test_registered_route_is_loopback_only(self):
        loopback = Request({"type": "http", "method": "POST", "path": "/", "headers": [], "client": ("127.0.0.1", 1234)})
        self.assertEqual(main.simulation_hvac_evaluate(loopback, payload())["context"], "simulation")
        malformed = payload()
        malformed["unexpected"] = True
        with self.assertRaises(HTTPException) as invalid:
            main.simulation_hvac_evaluate(loopback, malformed)
        self.assertEqual(invalid.exception.status_code, 422)
        remote = Request({"type": "http", "method": "POST", "path": "/", "headers": [], "client": ("192.0.2.20", 1234)})
        with self.assertRaises(HTTPException) as raised:
            main.simulation_hvac_evaluate(remote, payload())
        self.assertEqual(raised.exception.status_code, 403)


if __name__ == "__main__":
    unittest.main()
