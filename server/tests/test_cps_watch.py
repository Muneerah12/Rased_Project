from __future__ import annotations

import sys
import unittest
from pathlib import Path

SERVER_DIR = Path(__file__).resolve().parents[1]
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))

from cps_integration import CpsIntegrationError  # noqa: E402
from cps_watch import NodeWatch  # noqa: E402


def state(status: str = "ONLINE") -> dict:
    return {"node_id": "NODE-04", "connection_status": status, "location_id": "A1-1", "last_heartbeat_received_at": "2026-10-15T15:00:00+00:00"}


class NodeWatchTests(unittest.TestCase):
    def setUp(self) -> None:
        self.records: list[dict] = []
        self.messages: list[str] = []
        self.watch = NodeWatch(record=self.records.append, notify=lambda text, action: self.messages.append(text))

    def test_first_online_read_is_recorded_but_not_notified(self) -> None:
        self.watch.observe(state())
        self.assertEqual([r["status"] for r in self.records], ["ONLINE"])
        self.assertEqual(self.messages, [])
        self.assertIsNone(self.watch.observe(state()))

    def test_stale_waits_and_offline_alerts(self) -> None:
        self.watch.observe(state())
        self.assertIsNone(self.watch.observe(state("STALE")), "a late heartbeat is not an alarm")
        self.assertIsNone(self.watch.observe(state("ONLINE")))
        self.assertIsNone(self.watch.observe(state("STALE")))
        action = self.watch.observe(state("OFFLINE"))
        self.assertEqual((action["status"], action["reason"], action["node_id"]), ("OFFLINE", "NODE_OFFLINE", "NODE-04"))
        self.assertIn("OFFLINE", self.messages[-1])
        self.assertIsNone(self.watch.observe(state("OFFLINE")), "no repeat alert while still offline")

    def test_recovery_clears_and_notifies(self) -> None:
        self.watch.observe(state())
        self.watch.observe(state("OFFLINE"))
        action = self.watch.observe(state())
        self.assertEqual(action["status"], "ONLINE")
        self.assertIn("back online", self.messages[-1])

    def test_unreachable_cps_is_reported_distinctly(self) -> None:
        def fail():
            raise CpsIntegrationError(503, "down")
        watch = NodeWatch(record=self.records.append, fetch=fail)
        watch.poll_once()
        action = watch.poll_once()
        self.assertEqual((action["status"], action["reason"]), ("OFFLINE", "CPS_UNREACHABLE"))


if __name__ == "__main__":
    unittest.main()
