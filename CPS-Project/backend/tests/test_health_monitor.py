import asyncio
import logging
import sys
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import main


class FailingSession:
    def __init__(self):
        self.rolled_back = False
        self.closed = False

    def query(self, _model):
        raise RuntimeError("transient database failure")

    def rollback(self):
        self.rolled_back = True

    def close(self):
        self.closed = True


class SuccessfulSession:
    def __init__(self):
        self.committed = False
        self.closed = False

    def query(self, _model):
        return self

    def all(self):
        return []

    def commit(self):
        self.committed = True

    def close(self):
        self.closed = True


def test_health_monitor_rolls_back_logs_and_continues_after_transient_failure(monkeypatch, caplog):
    failed_session = FailingSession()
    recovered_session = SuccessfulSession()
    sessions = iter((failed_session, recovered_session))
    monkeypatch.setattr(main, "SessionLocal", lambda: next(sessions))
    sleep_calls = 0

    async def stop_after_recovery(_seconds):
        nonlocal sleep_calls
        sleep_calls += 1
        if sleep_calls == 2:
            raise asyncio.CancelledError

    monkeypatch.setattr(main.asyncio, "sleep", stop_after_recovery)

    with caplog.at_level(logging.ERROR):
        with pytest.raises(asyncio.CancelledError):
            asyncio.run(main.monitor_node_health())

    assert failed_session.rolled_back
    assert failed_session.closed
    assert recovered_session.committed
    assert recovered_session.closed
    assert "Node health monitor cycle failed" in caplog.text
