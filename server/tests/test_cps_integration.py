"""Isolated tests for the read-only CPS adapter; no FastAPI lifespan is started."""

from __future__ import annotations

import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

SERVER_DIR = Path(__file__).resolve().parents[1]
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))

import cps_integration as cps  # noqa: E402


NOW = "2026-10-12T10:00:00Z"


class FakeResponse:
    def __init__(self, status_code: int, payload: object = None, *, redirect: bool = False, json_error: bool = False) -> None:
        self.status_code = status_code
        self._payload = payload
        self.is_redirect = redirect
        self._json_error = json_error

    def json(self):
        if self._json_error:
            raise ValueError("not json")
        return self._payload


def state_payload() -> dict:
    return {
        "node_id": "NODE-04", "status": "ACTIVE", "connection_status": "ONLINE",
        "location_id": "A1-1", "last_heartbeat_received_at": NOW,
        "reported_relay_state": None, "relay_reported_at": None,
        "network_observation": {
            "reported_ip": None, "reported_mac": None, "reported_rssi_dbm": None,
            "reported_ssid": None, "reported_bssid": None, "reported_wifi_channel": None,
            "reported_gateway": None, "reported_subnet_mask": None, "reported_at": None,
        },
        "as_of": NOW,
        "readings": [{
            "sensor_id": "TEMP-01", "sensor_type": "temperature", "value": 25.0,
            "unit": "C", "timestamp": NOW, "validation_status": "NORMAL",
        }],
    }


class CpsAdapterTests(unittest.TestCase):
    def setUp(self) -> None:
        self.config = patch.multiple(
            cps.config,
            CPS_INTEGRATION_BASE_URL="https://cps.example.test",
            CPS_RASID_INTEGRATION_TOKEN="test-token-that-must-not-leak",
            CPS_INTEGRATION_DEVELOPMENT_MODE=False,
            CPS_INTEGRATION_TIMEOUT_S=2.0,
        )
        self.config.start()
        self.addCleanup(self.config.stop)

    def assert_error(self, action, status: int, detail: str) -> None:
        with self.assertRaises(cps.CpsIntegrationError) as caught:
            action()
        self.assertEqual(caught.exception.status_code, status)
        self.assertEqual(caught.exception.detail, detail)
        self.assertNotIn("test-token", caught.exception.detail)

    def test_unsafe_urls_and_missing_configuration_fail_closed(self) -> None:
        for url in ("http://127.0.0.1", "http://example.test", "https://example.test/path", "https://user:pass@example.test", "ftp://example.test"):
            with patch.object(cps.config, "CPS_INTEGRATION_BASE_URL", url):
                self.assert_error(cps._state_url, 503, "CPS integration is unavailable")
        with patch.object(cps.config, "CPS_RASID_INTEGRATION_TOKEN", ""):
            self.assert_error(cps._state_url, 503, "CPS integration is unavailable")
        with patch.object(cps.config, "CPS_INTEGRATION_TIMEOUT_S", float("nan")):
            self.assert_error(cps._state_url, 503, "CPS integration is unavailable")
        with patch.object(cps.config, "CPS_INTEGRATION_DEVELOPMENT_MODE", True), patch.object(cps.config, "CPS_INTEGRATION_BASE_URL", "http://127.0.0.1:8000"):
            self.assertEqual(cps._state_url(), "http://127.0.0.1:8000/api/v1/integration/nodes/NODE-04/state")

    def test_https_uses_verification_and_refuses_redirects(self) -> None:
        with patch.object(cps.requests, "get", return_value=FakeResponse(200, state_payload())) as request:
            self.assertEqual(cps.fetch_node_state()["node_id"], "NODE-04")
        _, kwargs = request.call_args
        self.assertTrue(kwargs["verify"])
        self.assertFalse(kwargs["allow_redirects"])
        self.assertEqual(kwargs["headers"], {"X-Rasid-Integration-Token": "test-token-that-must-not-leak"})
        with patch.object(cps.requests, "get", return_value=FakeResponse(302, redirect=True)):
            self.assert_error(cps.fetch_node_state, 502, "CPS returned an invalid state response")

    def test_state_schema_is_exact_and_network_observation_is_consistent(self) -> None:
        malformed = state_payload()
        malformed["unexpected"] = "blocked"
        with patch.object(cps.requests, "get", return_value=FakeResponse(200, malformed)):
            self.assert_error(cps.fetch_node_state, 502, "CPS returned an invalid state response")
        malformed = state_payload()
        malformed["network_observation"]["reported_ip"] = "192.0.2.1"
        with patch.object(cps.requests, "get", return_value=FakeResponse(200, malformed)):
            self.assert_error(cps.fetch_node_state, 502, "CPS returned an invalid state response")
        malformed = state_payload()
        malformed["readings"][0]["value"] = float("nan")
        with patch.object(cps.requests, "get", return_value=FakeResponse(200, malformed)):
            self.assert_error(cps.fetch_node_state, 502, "CPS returned an invalid state response")
        malformed = state_payload()
        malformed["readings"][0]["timestamp"] = "2026-10-12T10:00:01Z"
        with patch.object(cps.requests, "get", return_value=FakeResponse(200, malformed)):
            self.assert_error(cps.fetch_node_state, 502, "CPS returned an invalid state response")

    def test_heartbeat_history_rejects_inconsistent_or_oversized_payloads(self) -> None:
        bad_order = {"node_id": "NODE-04", "as_of": NOW, "items": [{"received_at": "2026-10-12T09:00:00Z"}, {"received_at": "2026-10-12T09:01:00Z"}]}
        with patch.object(cps.requests, "get", return_value=FakeResponse(200, bad_order)):
            self.assert_error(cps.fetch_node_heartbeat_history, 502, "CPS returned an invalid heartbeat history response")
        too_many = {"node_id": "NODE-04", "as_of": NOW, "items": [{"received_at": NOW}] * 51}
        with patch.object(cps.requests, "get", return_value=FakeResponse(200, too_many)):
            self.assert_error(cps.fetch_node_heartbeat_history, 502, "CPS returned an invalid heartbeat history response")

    def test_history_bounds_and_response_contract(self) -> None:
        start = datetime(2026, 10, 12, 9, tzinfo=timezone.utc)
        end = datetime(2026, 10, 12, 10, tzinfo=timezone.utc)
        history = {
            "node_id": "NODE-04", "sensor_id": "TEMP-01", "sensor_type": "temperature",
            "start": start.isoformat(), "end": end.isoformat(), "as_of": NOW,
            "items": [{"sensor_id": "TEMP-01", "sensor_type": "temperature", "value": 24.0, "unit": "C", "timestamp": "2026-10-12T09:30:00Z", "validation_status": "NORMAL"}],
            "next_cursor": None,
        }
        with patch.object(cps.requests, "get", return_value=FakeResponse(200, history)):
            self.assertEqual(cps.fetch_node_reading_history(sensor_id="TEMP-01", start=start, end=end)["items"][0]["value"], 24.0)
        self.assert_error(lambda: cps.fetch_node_reading_history(sensor_id="OTHER", start=start, end=end), 422, "Invalid reading history request")
        self.assert_error(lambda: cps.fetch_node_reading_history(sensor_id="TEMP-01", start=start.replace(tzinfo=None), end=end), 422, "Invalid reading history request")
        self.assert_error(lambda: cps.fetch_node_reading_history(sensor_id="TEMP-01", start=start, end=start + timedelta(days=8)), 422, "Invalid reading history request")

    def test_upstream_failures_are_generic_and_do_not_leak_token(self) -> None:
        with patch.object(cps.requests, "get", side_effect=cps.requests.Timeout("hidden")):
            self.assert_error(cps.fetch_node_state, 504, "CPS request timed out")
        with patch.object(cps.requests, "get", side_effect=cps.requests.ConnectionError("hidden")):
            self.assert_error(cps.fetch_node_state, 503, "CPS integration is unavailable")
        with patch.object(cps.requests, "get", return_value=FakeResponse(401, {"detail": "hidden"})):
            self.assert_error(cps.fetch_node_state, 502, "CPS integration authentication failed")

    def test_loopback_guard_ignores_forwarded_header_spoofing(self) -> None:
        cps.require_loopback_request(SimpleNamespace(client=SimpleNamespace(host="127.0.0.1"), headers={"X-Forwarded-For": "198.51.100.1"}))
        spoofed = SimpleNamespace(client=SimpleNamespace(host="198.51.100.1"), headers={"X-Forwarded-For": "127.0.0.1"})
        with self.assertRaises(Exception) as caught:
            cps.require_loopback_request(spoofed)
        self.assertEqual(getattr(caught.exception, "status_code", None), 403)


if __name__ == "__main__":
    unittest.main()
