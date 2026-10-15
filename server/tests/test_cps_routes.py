"""Route-boundary tests that avoid importing the camera-starting FastAPI app."""

from __future__ import annotations

import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

SERVER_DIR = Path(__file__).resolve().parents[1]
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))

import cps_integration as cps  # noqa: E402


class CpsRouteBoundaryTests(unittest.TestCase):
    def test_main_declares_only_the_three_approved_cps_get_routes(self) -> None:
        main = (SERVER_DIR / "main.py").read_text(encoding="utf-8")
        for route in ("/api/cps/node-state", "/api/cps/node-heartbeats", "/api/cps/node-readings"):
            self.assertIn(f'@app.get("{route}")', main)
        self.assertNotIn('@app.post("/api/cps', main)
        self.assertNotIn('@app.patch("/api/cps', main)
        self.assertNotIn('@app.delete("/api/cps', main)

    def test_each_cps_route_uses_the_direct_peer_guard(self) -> None:
        main = (SERVER_DIR / "main.py").read_text(encoding="utf-8")
        for function_name in ("cps_node_state", "cps_node_heartbeats", "cps_node_readings"):
            start = main.index(f"def {function_name}")
            self.assertIn("require_loopback_request(request)", main[start:start + 900])

    def test_ipv6_loopback_is_allowed_and_nonloopback_is_denied(self) -> None:
        cps.require_loopback_request(SimpleNamespace(client=SimpleNamespace(host="::1")))
        with self.assertRaises(Exception) as caught:
            cps.require_loopback_request(SimpleNamespace(client=SimpleNamespace(host="10.0.0.5")))
        self.assertEqual(getattr(caught.exception, "status_code", None), 403)

    def test_history_parameter_bounds_are_checked_before_upstream_access(self) -> None:
        start = datetime(2026, 10, 12, 9, tzinfo=timezone.utc)
        end = datetime(2026, 10, 12, 10, tzinfo=timezone.utc)
        self.assertEqual(cps.validate_history_request(sensor_id="HUM-01", start=start, end=end, limit=100, cursor=None), (start, end))
        with self.assertRaises(cps.CpsIntegrationError) as caught:
            cps.validate_history_request(sensor_id="HUM-01", start=start, end=end, limit=100, cursor="x" * 1025)
        self.assertEqual(caught.exception.status_code, 422)


if __name__ == "__main__":
    unittest.main()
