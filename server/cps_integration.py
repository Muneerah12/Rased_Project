"""Narrow, read-only server-side adapter for approved CPS NODE-04 data."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from math import isfinite
from typing import Any
from urllib.parse import urlencode, urlsplit, urlunsplit

import requests
from fastapi import HTTPException

import config


NODE_ID = "NODE-04"
LOCAL_DEVELOPMENT_HOSTS = frozenset({"127.0.0.1", "localhost"})
STATE_FIELDS = frozenset({
    "node_id", "status", "connection_status", "location_id",
    "last_heartbeat_received_at", "reported_relay_state", "relay_reported_at",
    "network_observation", "as_of", "readings",
})
READING_FIELDS = frozenset({"sensor_id", "sensor_type", "value", "unit", "timestamp", "validation_status"})
NETWORK_OBSERVATION_FIELDS = frozenset({
    "reported_ip", "reported_mac", "reported_rssi_dbm", "reported_ssid",
    "reported_bssid", "reported_wifi_channel", "reported_gateway",
    "reported_subnet_mask", "reported_at",
})
HEARTBEAT_HISTORY_FIELDS = frozenset({"node_id", "as_of", "items"})
HEARTBEAT_HISTORY_ITEM_FIELDS = frozenset({"received_at"})
HISTORY_FIELDS = frozenset({"node_id", "sensor_id", "sensor_type", "start", "end", "as_of", "items", "next_cursor"})
HEARTBEAT_HISTORY_LIMIT = 50
HISTORY_DEFAULT_LIMIT = 100
HISTORY_MAX_LIMIT = 200
HISTORY_MAX_RANGE = timedelta(days=7)
HISTORY_SENSOR_IDS = {"TEMP-01": "temperature", "HUM-01": "humidity", "PRESS-01": "pressure"}


class CpsIntegrationError(Exception):
    """A generic, browser-safe CPS dependency failure."""

    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def require_loopback_request(request: Any) -> None:
    """Allow only the direct local peer; this is not user authentication.

    Forwarded headers are intentionally ignored. A shared or network-exposed
    deployment needs a separate authenticated server-side access model.
    """
    client = getattr(request, "client", None)
    host = getattr(client, "host", "") if client is not None else ""
    if host not in {"127.0.0.1", "::1"}:
        raise HTTPException(403, "CPS integration is available only on this development host")


def _utc_timestamp(value: Any) -> datetime:
    if not isinstance(value, str):
        raise ValueError("timestamp must be a string")
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("timestamp must include a timezone")
    return parsed.astimezone(timezone.utc)


def _integration_url(endpoint: str) -> str:
    base_url = config.CPS_INTEGRATION_BASE_URL
    token = config.CPS_RASID_INTEGRATION_TOKEN
    if (
        not base_url
        or not token
        or not isfinite(config.CPS_INTEGRATION_TIMEOUT_S)
        or config.CPS_INTEGRATION_TIMEOUT_S <= 0
    ):
        raise CpsIntegrationError(503, "CPS integration is unavailable")

    try:
        parsed = urlsplit(base_url)
    except ValueError as exc:
        raise CpsIntegrationError(503, "CPS integration is unavailable") from exc
    hostname = (parsed.hostname or "").lower()
    local_http = (
        parsed.scheme == "http"
        and config.CPS_INTEGRATION_DEVELOPMENT_MODE
        and hostname in LOCAL_DEVELOPMENT_HOSTS
    )
    if (
        parsed.scheme not in {"https", "http"}
        or (parsed.scheme != "https" and not local_http)
        or not hostname
        or parsed.username
        or parsed.password
        or parsed.path not in {"", "/"}
        or parsed.query
        or parsed.fragment
    ):
        raise CpsIntegrationError(503, "CPS integration is unavailable")
    return urlunsplit((parsed.scheme, parsed.netloc, f"/api/v1/integration/nodes/{NODE_ID}/{endpoint}", "", ""))


def _state_url() -> str:
    return _integration_url("state")


def _heartbeat_history_url() -> str:
    return f"{_integration_url('heartbeats')}?limit={HEARTBEAT_HISTORY_LIMIT}"


def _history_url(*, sensor_id: str, start: datetime, end: datetime, limit: int, cursor: str | None) -> str:
    query = {
        "sensor_id": sensor_id,
        "start": start.astimezone(timezone.utc).isoformat(),
        "end": end.astimezone(timezone.utc).isoformat(),
        "limit": str(limit),
    }
    if cursor is not None:
        query["cursor"] = cursor
    return f"{_integration_url('readings')}?{urlencode(query)}"


def _valid_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and isfinite(float(value))


def _validate_reading(value: Any, *, detail: str) -> dict[str, Any]:
    if (
        not isinstance(value, dict)
        or set(value) != READING_FIELDS
        or not all(isinstance(value.get(field), str) for field in ("sensor_id", "sensor_type", "unit", "timestamp", "validation_status"))
        or not _valid_number(value.get("value"))
    ):
        raise CpsIntegrationError(502, detail)
    try:
        _utc_timestamp(value["timestamp"])
    except (TypeError, ValueError) as exc:
        raise CpsIntegrationError(502, detail) from exc
    return {field: value[field] for field in READING_FIELDS}


def _validated_state(payload: Any) -> dict[str, Any]:
    detail = "CPS returned an invalid state response"
    if (
        not isinstance(payload, dict)
        or set(payload) != STATE_FIELDS
        or payload.get("node_id") != NODE_ID
        or payload.get("status") not in {"ACTIVE", "REVOKED"}
        or payload.get("connection_status") not in {"ONLINE", "STALE", "OFFLINE"}
        or payload.get("location_id") is not None and not isinstance(payload.get("location_id"), str)
        or payload.get("last_heartbeat_received_at") is not None and not isinstance(payload.get("last_heartbeat_received_at"), str)
        or not isinstance(payload.get("as_of"), str)
        or not isinstance(payload.get("readings"), list)
        or len(payload["readings"]) > 10
    ):
        raise CpsIntegrationError(502, detail)
    try:
        as_of = _utc_timestamp(payload["as_of"])
        if payload["last_heartbeat_received_at"] is not None:
            if _utc_timestamp(payload["last_heartbeat_received_at"]) > as_of:
                raise ValueError("heartbeat is after snapshot")
    except (TypeError, ValueError) as exc:
        raise CpsIntegrationError(502, detail) from exc

    relay_state, relay_reported_at = payload["reported_relay_state"], payload["relay_reported_at"]
    if not ((relay_state in {"ON", "OFF"} and isinstance(relay_reported_at, str)) or (relay_state is None and relay_reported_at is None)):
        raise CpsIntegrationError(502, detail)
    try:
        if relay_reported_at is not None:
            if _utc_timestamp(relay_reported_at) > as_of:
                raise ValueError("relay report is after snapshot")
    except (TypeError, ValueError) as exc:
        raise CpsIntegrationError(502, detail) from exc

    observation = payload["network_observation"]
    if not isinstance(observation, dict) or set(observation) != NETWORK_OBSERVATION_FIELDS:
        raise CpsIntegrationError(502, detail)
    string_fields = NETWORK_OBSERVATION_FIELDS - {"reported_rssi_dbm", "reported_wifi_channel", "reported_at"}
    if any(observation[field] is not None and not isinstance(observation[field], str) for field in string_fields):
        raise CpsIntegrationError(502, detail)
    if any(observation[field] is not None and (not isinstance(observation[field], int) or isinstance(observation[field], bool)) for field in ("reported_rssi_dbm", "reported_wifi_channel")):
        raise CpsIntegrationError(502, detail)
    try:
        if observation["reported_at"] is not None:
            if _utc_timestamp(observation["reported_at"]) > as_of:
                raise ValueError("network report is after snapshot")
    except (TypeError, ValueError) as exc:
        raise CpsIntegrationError(502, detail) from exc
    if observation["reported_at"] is None and any(observation[field] is not None for field in NETWORK_OBSERVATION_FIELDS - {"reported_at"}):
        raise CpsIntegrationError(502, detail)

    readings = [_validate_reading(item, detail=detail) for item in payload["readings"]]
    if any(_utc_timestamp(reading["timestamp"]) > as_of for reading in readings):
        raise CpsIntegrationError(502, detail)
    return {
        "node_id": NODE_ID,
        "status": payload["status"],
        "connection_status": payload["connection_status"],
        "location_id": payload["location_id"],
        "last_heartbeat_received_at": payload["last_heartbeat_received_at"],
        "reported_relay_state": relay_state,
        "relay_reported_at": relay_reported_at,
        "network_observation": {field: observation[field] for field in NETWORK_OBSERVATION_FIELDS},
        "as_of": payload["as_of"],
        "readings": readings,
    }


def _validated_heartbeat_history(payload: Any) -> dict[str, Any]:
    detail = "CPS returned an invalid heartbeat history response"
    if not isinstance(payload, dict) or set(payload) != HEARTBEAT_HISTORY_FIELDS or payload.get("node_id") != NODE_ID or not isinstance(payload.get("items"), list) or len(payload["items"]) > HEARTBEAT_HISTORY_LIMIT:
        raise CpsIntegrationError(502, detail)
    try:
        as_of = _utc_timestamp(payload.get("as_of"))
        previous: datetime | None = None
        items: list[dict[str, str]] = []
        for item in payload["items"]:
            if not isinstance(item, dict) or set(item) != HEARTBEAT_HISTORY_ITEM_FIELDS:
                raise ValueError("invalid item")
            received_at = _utc_timestamp(item.get("received_at"))
            if received_at > as_of or (previous is not None and received_at > previous):
                raise ValueError("inconsistent order")
            previous = received_at
            items.append({"received_at": item["received_at"]})
    except (TypeError, ValueError) as exc:
        raise CpsIntegrationError(502, detail) from exc
    return {"node_id": NODE_ID, "as_of": payload["as_of"], "items": items}


def validate_history_request(*, sensor_id: str, start: datetime, end: datetime, limit: int, cursor: str | None) -> tuple[datetime, datetime]:
    if (
        sensor_id not in HISTORY_SENSOR_IDS
        or start.tzinfo is None
        or end.tzinfo is None
        or start >= end
        or end - start > HISTORY_MAX_RANGE
        or not isinstance(limit, int)
        or isinstance(limit, bool)
        or not 1 <= limit <= HISTORY_MAX_LIMIT
        or cursor is not None and (not isinstance(cursor, str) or len(cursor) > 1024)
    ):
        raise CpsIntegrationError(422, "Invalid reading history request")
    return start.astimezone(timezone.utc), end.astimezone(timezone.utc)


def _validated_reading_history(payload: Any, *, sensor_id: str, start: datetime, end: datetime) -> dict[str, Any]:
    detail = "CPS returned an invalid reading history response"
    if (
        not isinstance(payload, dict)
        or set(payload) != HISTORY_FIELDS
        or payload.get("node_id") != NODE_ID
        or payload.get("sensor_id") != sensor_id
        or payload.get("sensor_type") != HISTORY_SENSOR_IDS[sensor_id]
        or not isinstance(payload.get("next_cursor"), (str, type(None)))
        or isinstance(payload.get("next_cursor"), str) and len(payload["next_cursor"]) > 1024
        or not isinstance(payload.get("items"), list)
        or len(payload["items"]) > HISTORY_MAX_LIMIT
    ):
        raise CpsIntegrationError(502, detail)
    try:
        response_start = _utc_timestamp(payload.get("start"))
        response_end = _utc_timestamp(payload.get("end"))
        as_of = _utc_timestamp(payload.get("as_of"))
        if response_start != start or response_end != end or response_start >= response_end or response_end - response_start > HISTORY_MAX_RANGE:
            raise ValueError("inconsistent range")
        previous: datetime | None = None
        items: list[dict[str, Any]] = []
        for item in payload["items"]:
            validated = _validate_reading(item, detail=detail)
            if validated["sensor_id"] != sensor_id or validated["sensor_type"] != HISTORY_SENSOR_IDS[sensor_id]:
                raise ValueError("inconsistent sensor")
            observed_at = _utc_timestamp(validated["timestamp"])
            if observed_at < response_start or observed_at >= response_end or observed_at > as_of or (previous is not None and observed_at > previous):
                raise ValueError("inconsistent order")
            previous = observed_at
            items.append(validated)
    except (TypeError, ValueError) as exc:
        raise CpsIntegrationError(502, detail) from exc
    return {
        "node_id": NODE_ID, "sensor_id": sensor_id, "sensor_type": HISTORY_SENSOR_IDS[sensor_id],
        "start": payload["start"], "end": payload["end"], "as_of": payload["as_of"],
        "items": items, "next_cursor": payload["next_cursor"],
    }


def _get(url: str, invalid_response_detail: str) -> dict[str, Any]:
    try:
        response = requests.get(
            url,
            headers={"X-Rasid-Integration-Token": config.CPS_RASID_INTEGRATION_TOKEN},
            timeout=config.CPS_INTEGRATION_TIMEOUT_S,
            verify=True,
            allow_redirects=False,
        )
    except requests.Timeout as exc:
        raise CpsIntegrationError(504, "CPS request timed out") from exc
    except (requests.ConnectionError, requests.exceptions.SSLError) as exc:
        raise CpsIntegrationError(503, "CPS integration is unavailable") from exc
    except requests.RequestException as exc:
        raise CpsIntegrationError(503, "CPS integration is unavailable") from exc
    if response.is_redirect:
        raise CpsIntegrationError(502, invalid_response_detail)
    if response.status_code in {401, 403}:
        raise CpsIntegrationError(502, "CPS integration authentication failed")
    if response.status_code >= 500:
        raise CpsIntegrationError(503, "CPS integration is unavailable")
    if response.status_code != 200:
        raise CpsIntegrationError(502, invalid_response_detail)
    try:
        payload = response.json()
    except ValueError as exc:
        raise CpsIntegrationError(502, invalid_response_detail) from exc
    if not isinstance(payload, dict):
        raise CpsIntegrationError(502, invalid_response_detail)
    return payload


def fetch_node_state() -> dict[str, Any]:
    return _validated_state(_get(_state_url(), "CPS returned an invalid state response"))


def fetch_node_heartbeat_history() -> dict[str, Any]:
    return _validated_heartbeat_history(_get(_heartbeat_history_url(), "CPS returned an invalid heartbeat history response"))


def fetch_node_reading_history(*, sensor_id: str, start: datetime, end: datetime, limit: int = HISTORY_DEFAULT_LIMIT, cursor: str | None = None) -> dict[str, Any]:
    start_utc, end_utc = validate_history_request(sensor_id=sensor_id, start=start, end=end, limit=limit, cursor=cursor)
    payload = _get(_history_url(sensor_id=sensor_id, start=start_utc, end=end_utc, limit=limit, cursor=cursor), "CPS returned an invalid reading history response")
    return _validated_reading_history(payload, sensor_id=sensor_id, start=start_utc, end=end_utc)
