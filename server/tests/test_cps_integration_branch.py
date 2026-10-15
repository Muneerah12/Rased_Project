from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from fastapi import HTTPException
from starlette.requests import Request

SERVER_DIR = Path(__file__).resolve().parents[1]
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))

import config  # noqa: E402
import cps_integration  # noqa: E402
import main  # noqa: E402


def payload(connection_status: str = "ONLINE", relay_state: str | None = "ON"):
    return {
        "node_id": "NODE-04", "status": "ACTIVE", "connection_status": connection_status,
        "location_id": "A1-1", "last_heartbeat_received_at": "2026-10-08T10:00:00+00:00",
        "reported_relay_state": relay_state,
        "relay_reported_at": "2026-10-08T10:00:00+00:00" if relay_state is not None else None,
        "network_observation": {
            "reported_ip": "192.0.2.10", "reported_mac": "AA:BB:CC:DD:EE:FF",
            "reported_rssi_dbm": -55, "reported_ssid": "CPS-Lab",
            "reported_bssid": "11:22:33:44:55:66", "reported_wifi_channel": 6,
            "reported_gateway": "192.0.2.1", "reported_subnet_mask": "255.255.255.0",
            "reported_at": "2026-10-08T10:00:00+00:00",
        },
        "as_of": "2026-10-08T10:00:01+00:00",
        "readings": [{
            "sensor_id": "TEMP-03", "sensor_type": "temperature", "value": 23.5,
            "unit": "C", "timestamp": "2026-10-08T10:00:00+00:00", "validation_status": "NORMAL",
        }],
    }


def actual_node_04_response_shape():
    """Shape observed from the local CPS NODE-04 integration endpoint (values are test fixtures)."""
    sensor_types = ["temperature", "humidity", "pressure", "temperature", "humidity", "pressure", "temperature", "humidity", "pressure", "temperature"]
    readings = [
        {
            "sensor_id": f"SENSOR-{index:02d}", "sensor_type": sensor_type,
            "value": float(index) + 20.5, "unit": "C" if sensor_type == "temperature" else "%" if sensor_type == "humidity" else "hPa",
            "timestamp": "2026-10-08T10:00:00+00:00", "validation_status": "NORMAL",
        }
        for index, sensor_type in enumerate(sensor_types, 1)
    ]
    return {
        "node_id": "NODE-04", "status": "ACTIVE", "connection_status": "ONLINE",
        "location_id": "A1-1", "last_heartbeat_received_at": "2026-10-08T10:00:00+00:00",
        "reported_relay_state": "ON", "relay_reported_at": "2026-10-08T10:00:00+00:00",
        "network_observation": {
            "reported_ip": "192.0.2.10", "reported_mac": "AA:BB:CC:DD:EE:FF",
            "reported_rssi_dbm": -55, "reported_ssid": "CPS-Lab",
            "reported_bssid": "11:22:33:44:55:66", "reported_wifi_channel": 6,
            "reported_gateway": "192.0.2.1", "reported_subnet_mask": "255.255.255.0",
            "reported_at": "2026-10-08T10:00:00+00:00",
        },
        "as_of": "2026-10-08T10:00:01+00:00", "readings": readings,
    }


def heartbeat_history(items=None, as_of="2026-10-08T10:00:05+00:00"):
    return {
        "node_id": "NODE-04",
        "as_of": as_of,
        "items": items if items is not None else [
            {"received_at": "2026-10-08T10:00:00+00:00"},
            {"received_at": "2026-10-08T09:59:55+00:00"},
        ],
    }


class CpsIntegrationTests(unittest.TestCase):
    def settings(self, **overrides):
        values = {
            "CPS_INTEGRATION_BASE_URL": "http://127.0.0.1:8000",
            "CPS_RASID_INTEGRATION_TOKEN": "test-token",
            "CPS_INTEGRATION_DEVELOPMENT_MODE": True,
            "CPS_INTEGRATION_TIMEOUT_S": 4.0,
        }
        values.update(overrides)
        return patch.multiple(config, **values)

    def test_local_development_http_is_limited_to_loopback_and_sends_server_header(self):
        response = Mock(status_code=200, is_redirect=False)
        response.json.return_value = payload()
        with self.settings(), patch.object(cps_integration.requests, "get", return_value=response) as get:
            self.assertEqual(cps_integration.fetch_node_state(), payload())
        get.assert_called_once_with(
            "http://127.0.0.1:8000/api/v1/integration/nodes/NODE-04/state",
            headers={"X-Rasid-Integration-Token": "test-token"}, timeout=4.0, verify=True, allow_redirects=False,
        )

    def test_http_is_rejected_without_explicit_local_development_configuration(self):
        with self.settings(CPS_INTEGRATION_DEVELOPMENT_MODE=False):
            with self.assertRaisesRegex(cps_integration.CpsIntegrationError, "unavailable") as raised:
                cps_integration.fetch_node_state()
        self.assertEqual(raised.exception.status_code, 503)

    def test_http_is_rejected_for_non_loopback_host(self):
        with self.settings(CPS_INTEGRATION_BASE_URL="http://cps.example"):
            with self.assertRaisesRegex(cps_integration.CpsIntegrationError, "unavailable"):
                cps_integration.fetch_node_state()

    def test_https_keeps_certificate_and_hostname_verification_enabled(self):
        response = Mock(status_code=200, is_redirect=False)
        response.json.return_value = payload()
        with self.settings(CPS_INTEGRATION_BASE_URL="https://cps.example"), patch.object(cps_integration.requests, "get", return_value=response) as get:
            cps_integration.fetch_node_state()
        self.assertTrue(get.call_args.kwargs["verify"])

    def test_timeout_has_a_safe_gateway_timeout(self):
        with self.settings(), patch.object(cps_integration.requests, "get", side_effect=cps_integration.requests.Timeout()):
            with self.assertRaises(cps_integration.CpsIntegrationError) as raised:
                cps_integration.fetch_node_state()
        self.assertEqual(raised.exception.status_code, 504)

    def test_invalid_upstream_credential_is_not_forwarded_to_browser(self):
        response = Mock(status_code=401, is_redirect=False)
        with self.settings(), patch.object(cps_integration.requests, "get", return_value=response):
            with self.assertRaises(cps_integration.CpsIntegrationError) as raised:
                cps_integration.fetch_node_state()
        self.assertEqual(raised.exception.status_code, 502)
        self.assertNotIn("test-token", raised.exception.detail)

    def test_offline_payload_is_preserved_without_synthesizing_readings(self):
        offline = payload("OFFLINE", "OFF")
        response = Mock(status_code=200, is_redirect=False)
        response.json.return_value = offline
        with self.settings(), patch.object(cps_integration.requests, "get", return_value=response):
            self.assertEqual(cps_integration.fetch_node_state(), offline)

    def test_relay_reports_on_off_and_null_are_preserved(self):
        for relay_state in ("ON", "OFF", None):
            upstream = payload("ONLINE", relay_state)
            response = Mock(status_code=200, is_redirect=False)
            response.json.return_value = upstream
            with self.settings(), patch.object(cps_integration.requests, "get", return_value=response):
                self.assertEqual(cps_integration.fetch_node_state(), upstream)

    def test_malformed_relay_fields_are_rejected_before_reaching_the_browser(self):
        for relay_state, relay_reported_at in (("UNKNOWN", "2026-10-08T10:00:00+00:00"), ("ON", None), (None, "2026-10-08T10:00:00+00:00")):
            malformed = payload()
            malformed["reported_relay_state"] = relay_state
            malformed["relay_reported_at"] = relay_reported_at
            response = Mock(status_code=200, is_redirect=False)
            response.json.return_value = malformed
            with self.settings(), patch.object(cps_integration.requests, "get", return_value=response):
                with self.assertRaisesRegex(cps_integration.CpsIntegrationError, "invalid state response") as raised:
                    cps_integration.fetch_node_state()
            self.assertEqual(raised.exception.status_code, 502)

    def test_actual_cps_node_04_response_shape_with_ten_readings_is_accepted(self):
        response_shape = actual_node_04_response_shape()
        response = Mock(status_code=200, is_redirect=False)
        response.json.return_value = response_shape
        with self.settings(), patch.object(cps_integration.requests, "get", return_value=response):
            self.assertEqual(cps_integration.fetch_node_state(), response_shape)

    def test_network_observation_is_allowlisted_and_nullable(self):
        upstream = payload()
        upstream["unexpected"] = "must not reach the browser"
        response = Mock(status_code=200, is_redirect=False)
        response.json.return_value = upstream
        with self.settings(), patch.object(cps_integration.requests, "get", return_value=response):
            with self.assertRaisesRegex(cps_integration.CpsIntegrationError, "invalid state response"):
                cps_integration.fetch_node_state()

        upstream = payload()
        upstream["network_observation"] = {
            "reported_ip": None, "reported_mac": None, "reported_rssi_dbm": None,
            "reported_ssid": None, "reported_bssid": None, "reported_wifi_channel": None,
            "reported_gateway": None, "reported_subnet_mask": None, "reported_at": None,
        }
        response.json.return_value = upstream
        with self.settings(), patch.object(cps_integration.requests, "get", return_value=response):
            state = cps_integration.fetch_node_state()
        self.assertEqual(state["network_observation"], upstream["network_observation"])

    def test_network_observation_rejects_unapproved_or_inconsistent_fields(self):
        malformed_payloads = []
        with_extra = payload()
        with_extra["network_observation"]["credential_hash"] = "must-not-pass"
        malformed_payloads.append(with_extra)
        stale_value = payload()
        stale_value["network_observation"]["reported_at"] = None
        malformed_payloads.append(stale_value)
        malformed_rssi = payload()
        malformed_rssi["network_observation"]["reported_rssi_dbm"] = "-55"
        malformed_payloads.append(malformed_rssi)
        for malformed in malformed_payloads:
            response = Mock(status_code=200, is_redirect=False)
            response.json.return_value = malformed
            with self.settings(), patch.object(cps_integration.requests, "get", return_value=response):
                with self.assertRaisesRegex(cps_integration.CpsIntegrationError, "invalid state response"):
                    cps_integration.fetch_node_state()

    def test_heartbeat_history_is_requested_with_the_server_secret_and_returned_minimally(self):
        upstream = heartbeat_history()
        response = Mock(status_code=200, is_redirect=False)
        response.json.return_value = upstream
        with self.settings(), patch.object(cps_integration.requests, "get", return_value=response) as get:
            self.assertEqual(cps_integration.fetch_node_heartbeat_history(), upstream)
        get.assert_called_once_with(
            "http://127.0.0.1:8000/api/v1/integration/nodes/NODE-04/heartbeats?limit=50",
            headers={"X-Rasid-Integration-Token": "test-token"}, timeout=4.0, verify=True, allow_redirects=False,
        )

    def test_heartbeat_history_rejects_malformed_or_inconsistent_payloads(self):
        malformed_payloads = [
            {"node_id": "NODE-OTHER", "as_of": "2026-10-08T10:00:05+00:00", "items": []},
            {"node_id": "NODE-04", "as_of": "not-a-time", "items": []},
            heartbeat_history(items=[{"received_at": "not-a-time"}]),
            heartbeat_history(items=[{"received_at": "2026-10-08T10:00:06+00:00"}]),
            heartbeat_history(items=[
                {"received_at": "2026-10-08T09:59:00+00:00"},
                {"received_at": "2026-10-08T10:00:00+00:00"},
            ]),
            heartbeat_history(items=[{"received_at": "2026-10-08T10:00:00+00:00", "reported_ip": "192.0.2.1"}]),
            heartbeat_history(items=[{"received_at": "2026-10-08T10:00:00+00:00"}] * 51),
        ]
        for upstream in malformed_payloads:
            response = Mock(status_code=200, is_redirect=False)
            response.json.return_value = upstream
            with self.settings(), patch.object(cps_integration.requests, "get", return_value=response):
                with self.assertRaises(cps_integration.CpsIntegrationError) as raised:
                    cps_integration.fetch_node_heartbeat_history()
            self.assertEqual(raised.exception.status_code, 502)

    def test_heartbeat_history_preserves_empty_history(self):
        upstream = heartbeat_history(items=[])
        response = Mock(status_code=200, is_redirect=False)
        response.json.return_value = upstream
        with self.settings(), patch.object(cps_integration.requests, "get", return_value=response):
            self.assertEqual(cps_integration.fetch_node_heartbeat_history(), upstream)

    def test_heartbeat_history_proxy_is_loopback_only_and_returns_adapter_data(self):
        loopback = Request({"type": "http", "method": "GET", "path": "/", "headers": [], "client": ("127.0.0.1", 1234)})
        upstream = heartbeat_history()
        with patch.object(main, "fetch_node_heartbeat_history", return_value=upstream):
            self.assertEqual(main.cps_node_heartbeats(loopback), upstream)
        remote = Request({"type": "http", "method": "GET", "path": "/", "headers": [], "client": ("192.0.2.20", 1234)})
        with self.assertRaises(HTTPException) as raised:
            main.cps_node_heartbeats(remote)
        self.assertEqual(raised.exception.status_code, 403)

    def test_malformed_reading_is_rejected_before_reaching_the_browser(self):
        malformed = payload()
        malformed["readings"][0].pop("sensor_type")
        response = Mock(status_code=200, is_redirect=False)
        response.json.return_value = malformed
        with self.settings(), patch.object(cps_integration.requests, "get", return_value=response):
            with self.assertRaises(cps_integration.CpsIntegrationError) as raised:
                cps_integration.fetch_node_state()
        self.assertEqual(raised.exception.status_code, 502)

    def test_cps_route_allows_only_direct_loopback_peers(self):
        loopback = Request({"type": "http", "method": "GET", "path": "/", "headers": [], "client": ("127.0.0.1", 1234)})
        self.assertIsNone(main.require_loopback_request(loopback))
        remote = Request({"type": "http", "method": "GET", "path": "/", "headers": [], "client": ("192.0.2.20", 1234)})
        with self.assertRaises(HTTPException) as raised:
            main.require_loopback_request(remote)
        self.assertEqual(raised.exception.status_code, 403)

    def test_operational_hvac_endpoint_is_loopback_only_and_monitor_only_service_is_serialized(self):
        loopback = Request({"type": "http", "method": "GET", "path": "/", "headers": [], "client": ("127.0.0.1", 1234)})
        evaluation = object()
        public = {"context": "real_operations", "monitor_only": True}
        with patch.object(main, "collect_and_evaluate_operational_hvac", return_value=evaluation) as collect, patch.object(main, "recommendation_response", return_value=public):
            self.assertEqual(main.operational_hvac_recommendation(loopback), public)
        collect.assert_called_once()
        self.assertIsNone(collect.call_args.kwargs["evaluated_at"])
        remote = Request({"type": "http", "method": "GET", "path": "/", "headers": [], "client": ("192.0.2.20", 1234)})
        with self.assertRaises(HTTPException) as raised:
            main.operational_hvac_recommendation(remote)
        self.assertEqual(raised.exception.status_code, 403)


if __name__ == "__main__":
    unittest.main()
