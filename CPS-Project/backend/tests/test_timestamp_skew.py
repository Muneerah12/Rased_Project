from datetime import datetime, timedelta, timezone

import pytest
from pydantic import ValidationError

import main


FIXED_NOW = datetime(2026, 10, 1, 8, 0, 0, tzinfo=timezone.utc)


class FrozenDateTime(datetime):
    @classmethod
    def now(cls, tz=None):
        return FIXED_NOW.astimezone(tz) if tz else FIXED_NOW.replace(tzinfo=None)


@pytest.fixture(autouse=True)
def freeze_backend_clock(monkeypatch):
    monkeypatch.setattr(main, "datetime", FrozenDateTime)


@pytest.fixture(params=[main.SensorReading, main.Heartbeat])
def timestamp_model(request):
    return request.param


def payload_for(model, timestamp):
    payload = {"timestamp": timestamp.isoformat(), "node_id": "NODE-TEST"}
    if model is main.SensorReading:
        payload.update({
            "sensor_id": "TEMP-TEST",
            "sensor_type": "temperature",
            "value": 21.0,
            "unit": "C",
        })
    return payload


@pytest.mark.parametrize("offset", [timedelta(0), timedelta(seconds=1), timedelta(seconds=5)])
def test_shared_timestamp_validator_accepts_now_through_five_seconds(timestamp_model, offset):
    parsed = timestamp_model.model_validate(
        payload_for(timestamp_model, FIXED_NOW + offset)
    )

    assert parsed.timestamp == FIXED_NOW + offset
    assert parsed.timestamp.utcoffset() == timedelta(0)


def test_shared_timestamp_validator_rejects_more_than_five_seconds_future(timestamp_model):
    with pytest.raises(ValidationError, match="Timestamp cannot be in the future"):
        timestamp_model.model_validate(
            payload_for(timestamp_model, FIXED_NOW + timedelta(seconds=6))
        )


def test_shared_timestamp_validator_still_requires_timezone(timestamp_model):
    payload = payload_for(timestamp_model, FIXED_NOW)
    payload["timestamp"] = "2026-10-01T08:00:00"

    with pytest.raises(ValidationError, match="Timestamp must include timezone information"):
        timestamp_model.model_validate(payload)


def test_shared_timestamp_validator_normalizes_aware_non_utc_time(timestamp_model):
    timestamp = datetime(2026, 10, 1, 11, 0, tzinfo=timezone(timedelta(hours=3)))

    parsed = timestamp_model.model_validate(payload_for(timestamp_model, timestamp))

    assert parsed.timestamp == FIXED_NOW
    assert parsed.timestamp.tzinfo == timezone.utc
