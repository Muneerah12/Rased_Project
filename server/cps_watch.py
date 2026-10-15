"""Watches NODE-04 through the read-only CPS integration and raises an alert when it goes offline.

Every screen gets the alert through the shared journal (bell + alerts list); Telegram and the
webhook are used too when configured. Recovery clears the alert. Read-only: no command is sent.
"""

from __future__ import annotations

import threading
import time
from typing import Any, Callable, Dict, Optional

from cps_integration import CpsIntegrationError, fetch_node_state

POLL_S = 10.0
# CPS itself reports ONLINE (<= 30 s since the last heartbeat), STALE (<= 90 s) and OFFLINE.
# OFFLINE is alerted at once (CPS already waited 90 s); STALE never alerts on its own.
# An unreachable CPS backend must fail twice in a row (~20 s) before it alerts.
CONFIRM_UNREACHABLE_POLLS = 2


class NodeWatch:
    """Turns periodic CPS node-state reads into ONLINE/OFFLINE transitions."""

    def __init__(
        self,
        record: Callable[[Dict[str, Any]], Any],
        notify: Optional[Callable[[str, Dict[str, Any]], Any]] = None,
        fetch: Callable[[], Dict[str, Any]] = fetch_node_state,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self.record, self.notify, self.fetch, self.clock = record, notify, fetch, clock
        self.status: Optional[str] = None  # last reported status
        self.offline_streak = 0

    def observe(self, payload: Optional[Dict[str, Any]], reason_if_missing: str = "CPS_UNREACHABLE") -> Optional[Dict[str, Any]]:
        """Feed one read (None when CPS could not be reached); returns the recorded action, if any."""
        if payload is None:
            self.offline_streak += 1
            if self.status == "OFFLINE" or self.offline_streak < CONFIRM_UNREACHABLE_POLLS:
                return None
            return self._report("OFFLINE", reason_if_missing, None)
        self.offline_streak = 0
        status = payload.get("connection_status")
        if status == "ONLINE":
            return None if self.status == "ONLINE" else self._report("ONLINE", "NODE_ONLINE", payload)
        if status == "OFFLINE":
            return None if self.status == "OFFLINE" else self._report("OFFLINE", "NODE_OFFLINE", payload)
        return None  # STALE: heartbeat late but within CPS's 90 s window — wait

    def _report(self, status: str, reason: str, payload: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        first = self.status is None
        self.status = status
        action = {
            "type": "CPS_NODE_STATUS",
            "node_id": (payload or {}).get("node_id") or "NODE-04",
            "status": status,
            "reason": reason,
            "location_id": (payload or {}).get("location_id"),
            "last_heartbeat_received_at": (payload or {}).get("last_heartbeat_received_at"),
        }
        self.record(action)
        # Notify people on a real change; a server start that finds the node online stays quiet.
        if self.notify and not (first and status == "ONLINE"):
            self.notify(_message(action), action)
        return action

    def poll_once(self) -> Optional[Dict[str, Any]]:
        try:
            payload = self.fetch()
        except CpsIntegrationError:
            payload = None
        except Exception:  # noqa: BLE001 - a watcher failure must never stop the server
            payload = None
        return self.observe(payload)

    def run(self, stop: threading.Event) -> None:
        while not stop.is_set():
            self.poll_once()
            stop.wait(POLL_S)


def _message(action: Dict[str, Any]) -> str:
    node = action["node_id"]
    if action["status"] == "ONLINE":
        return f"✅ {node} is back online — readings and heartbeats are arriving again.\n✅ العقدة {node} عادت للاتصال."
    hb = action.get("last_heartbeat_received_at") or "unknown"
    if action["reason"] == "CPS_UNREACHABLE":
        return f"⚠️ CPS backend unreachable — {node} status unknown (last heartbeat {hb}).\n⚠️ تعذّر الوصول إلى خادم CPS — حالة {node} غير معروفة."
    return f"⚠️ {node} is OFFLINE — no heartbeat since {hb}. Check the device power, Wi-Fi and gateway.\n⚠️ العقدة {node} غير متصلة — تحقق من الجهاز والشبكة."
