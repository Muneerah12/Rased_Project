"""Real-time hub.

* WebSocket fan-out to every open Rasid tab (thread-safe `publish`).
* Journal: the ordered, persisted log of everything that changes shared records
  (AI events, notifications, operator/responder actions). Every Rasid client applies
  the same journal in the same order to the same reducer, so all screens show the
  same incidents, assignments and IDs, and the state survives page reloads and
  server restarts.
"""

from __future__ import annotations

import asyncio
import json
import threading
import time
from typing import Any, Dict, List, Optional, Set

from fastapi import WebSocket

from config import JOURNAL_FILE


def now_ms() -> int:
    return int(time.time() * 1000)


class Journal:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.entries: List[Dict[str, Any]] = []
        self.epoch = now_ms()
        self._load()

    def _load(self) -> None:
        if not JOURNAL_FILE.exists():
            self._write_header()
            return
        try:
            with JOURNAL_FILE.open("r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    rec = json.loads(line)
                    if rec.get("kind") == "header":
                        self.epoch = int(rec["epoch"])
                    else:
                        self.entries.append(rec)
        except Exception as exc:  # noqa: BLE001
            print(f"[journal] could not read {JOURNAL_FILE}: {exc}; starting a new journal")
            self.entries = []
            self.epoch = now_ms()
            self._write_header()

    def _write_header(self) -> None:
        with JOURNAL_FILE.open("w", encoding="utf-8") as f:
            f.write(json.dumps({"kind": "header", "epoch": self.epoch}) + "\n")

    @property
    def last_seq(self) -> int:
        return self.entries[-1]["seq"] if self.entries else 0

    def append(self, action: Dict[str, Any]) -> Dict[str, Any]:
        with self._lock:
            entry = {"seq": self.last_seq + 1, "at": now_ms(), "action": action}
            self.entries.append(entry)
            with JOURNAL_FILE.open("a", encoding="utf-8") as f:
                f.write(json.dumps(entry, ensure_ascii=False) + "\n")
            return entry

    def since(self, seq: int) -> List[Dict[str, Any]]:
        with self._lock:
            return [e for e in self.entries if e["seq"] > seq]

    def reset(self) -> None:
        with self._lock:
            self.entries = []
            self.epoch = now_ms()
            self._write_header()


class Hub:
    def __init__(self) -> None:
        self.clients: Set[WebSocket] = set()
        self.loop: Optional[asyncio.AbstractEventLoop] = None
        self.journal = Journal()

    def bind_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self.loop = loop

    async def _send_all(self, msg: Dict[str, Any]) -> None:
        data = json.dumps(msg, ensure_ascii=False)
        dead = []
        for ws in list(self.clients):
            try:
                await ws.send_text(data)
            except Exception:  # noqa: BLE001
                dead.append(ws)
        for ws in dead:
            self.clients.discard(ws)

    def publish(self, msg: Dict[str, Any]) -> None:
        """Broadcast from any thread."""
        if self.loop is None:
            return
        try:
            running = asyncio.get_running_loop()
        except RuntimeError:
            running = None
        if running is self.loop:
            self.loop.create_task(self._send_all(msg))
        else:
            asyncio.run_coroutine_threadsafe(self._send_all(msg), self.loop)

    def record(self, action: Dict[str, Any]) -> Dict[str, Any]:
        """Append to the journal and broadcast the entry to every client."""
        entry = self.journal.append(action)
        self.publish({"type": "journal", "entries": [entry]})
        return entry


hub = Hub()
