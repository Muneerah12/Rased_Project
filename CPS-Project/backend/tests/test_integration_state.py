import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import main
from database import enable_sqlite_foreign_keys, migrate_v2_location_network_schema
from models import Heartbeat, Node, SensorReading


INTEGRATION_TOKEN = "integration-state-test-rasid"
ENDPOINT = "/api/v1/integration/nodes/{}/state"
HEARTBEATS_ENDPOINT = "/api/v1/integration/nodes/{}/heartbeats"
READINGS_ENDPOINT = "/api/v1/integration/nodes/{}/readings"


@pytest.fixture
def integration_api(monkeypatch):
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    enable_sqlite_foreign_keys(engine)
    main.Base.metadata.create_all(bind=engine)
    migrate_v2_location_network_schema(engine)
    sessions = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    def override_db():
        session = sessions()
        try:
            yield session
        finally:
            session.close()

    main.app.dependency_overrides[main.get_db] = override_db
    monkeypatch.setattr(main, "RASID_INTEGRATION_TOKEN", INTEGRATION_TOKEN)
    # A configured admin token (distinct from the integration token) so admin routes reject
    # the integration credential with 401 rather than failing closed as unconfigured (500).
    monkeypatch.setattr(main, "ADMIN_PROVISIONING_TOKEN", "integration-state-test-admin")

    now = datetime.now(timezone.utc)
    with sessions() as db:
        db.add_all([
            Node(
                node_id="NODE-04",
                credential_hash="test-verifier-only",
                status="ACTIVE",
                connection_status="STALE",
                location_id="A1-1",
                last_heartbeat_received_at=now,
            ),
        ])
        db.add(SensorReading(
            node_id="NODE-04",
            sensor_id="TEMP-03",
            sensor_type="temperature",
            value=23.5,
            unit="C",
            timestamp=now - timedelta(seconds=2),
            validation_status="NORMAL",
            confidence=0.99,
            validation_reason="must not be exposed",
        ))
        db.add(Heartbeat(
            node_id="NODE-04",
            timestamp=now - timedelta(minutes=5),
            received_at=now,
            reported_relay_state="ON",
        ))
        db.commit()

    client = TestClient(main.app)
    yield client, sessions, engine
    client.close()
    main.app.dependency_overrides.clear()
    main.Base.metadata.drop_all(bind=engine)
    engine.dispose()


def integration_headers():
    return {"X-Rasid-Integration-Token": INTEGRATION_TOKEN}


def test_node_04_state_response_is_minimal_and_preserves_location(integration_api):
    client, _, _ = integration_api
    response = client.get(ENDPOINT.format("NODE-04"), headers=integration_headers())

    assert response.status_code == 200
    payload = response.json()
    assert set(payload) == {
        "node_id", "status", "connection_status", "location_id",
        "last_heartbeat_received_at", "reported_relay_state",
        "relay_reported_at", "network_observation", "as_of", "readings",
    }
    assert payload["node_id"] == "NODE-04"
    assert payload["status"] == "ACTIVE"
    assert payload["connection_status"] == "ONLINE"
    assert payload["location_id"] == "A1-1"
    assert payload["last_heartbeat_received_at"].endswith("+00:00")
    assert payload["reported_relay_state"] == "ON"
    assert payload["relay_reported_at"] == payload["last_heartbeat_received_at"]
    assert payload["as_of"].endswith("+00:00")
    assert payload["readings"] == [{
        "sensor_id": "TEMP-03",
        "sensor_type": "temperature",
        "value": 23.5,
        "unit": "C",
        "timestamp": payload["readings"][0]["timestamp"],
        "validation_status": "NORMAL",
    }]
    assert set(payload["readings"][0]) == {
        "sensor_id", "sensor_type", "value", "unit", "timestamp", "validation_status",
    }
    assert payload["network_observation"] == {
        "reported_ip": None, "reported_mac": None, "reported_rssi_dbm": None,
        "reported_ssid": None, "reported_bssid": None, "reported_wifi_channel": None,
        "reported_gateway": None, "reported_subnet_mask": None,
        "reported_at": payload["last_heartbeat_received_at"],
    }


def test_integration_state_returns_only_latest_heartbeat_network_observation(integration_api):
    client, sessions, _ = integration_api
    older_received_at = datetime.now(timezone.utc) - timedelta(minutes=2)
    latest_received_at = older_received_at + timedelta(seconds=1)
    with sessions() as db:
        db.query(Heartbeat).filter(Heartbeat.node_id == "NODE-04").delete()
        db.add_all([
            Heartbeat(
                node_id="NODE-04", timestamp=older_received_at,
                received_at=older_received_at, reported_ip="192.0.2.10",
                reported_mac="AA:BB:CC:DD:EE:FF", reported_rssi_dbm=-55,
                reported_ssid="CPS-Lab", reported_bssid="11:22:33:44:55:66",
                reported_wifi_channel=6, reported_gateway="192.0.2.1",
                reported_subnet_mask="255.255.255.0",
            ),
            Heartbeat(
                node_id="NODE-04", timestamp=latest_received_at,
                received_at=latest_received_at, reported_rssi_dbm=-60,
            ),
        ])
        db.commit()

    response = client.get(ENDPOINT.format("NODE-04"), headers=integration_headers())
    assert response.status_code == 200
    observation = response.json()["network_observation"]
    assert observation == {
        "reported_ip": None, "reported_mac": None, "reported_rssi_dbm": -60,
        "reported_ssid": None, "reported_bssid": None, "reported_wifi_channel": None,
        "reported_gateway": None, "reported_subnet_mask": None,
        "reported_at": latest_received_at.isoformat(),
    }


def test_integration_state_network_observation_is_all_null_without_heartbeat(integration_api):
    client, sessions, _ = integration_api
    with sessions() as db:
        db.query(Heartbeat).filter(Heartbeat.node_id == "NODE-04").delete()
        db.commit()

    response = client.get(ENDPOINT.format("NODE-04"), headers=integration_headers())
    assert response.status_code == 200
    assert response.json()["network_observation"] == {
        "reported_ip": None, "reported_mac": None, "reported_rssi_dbm": None,
        "reported_ssid": None, "reported_bssid": None, "reported_wifi_channel": None,
        "reported_gateway": None, "reported_subnet_mask": None, "reported_at": None,
    }


def test_integration_state_preserves_historical_network_observation_when_offline(integration_api):
    client, sessions, _ = integration_api
    received_at = datetime.now(timezone.utc) - timedelta(seconds=91)
    with sessions() as db:
        db.query(Heartbeat).filter(Heartbeat.node_id == "NODE-04").delete()
        node = db.query(Node).filter(Node.node_id == "NODE-04").one()
        node.last_heartbeat_received_at = received_at
        db.add(Heartbeat(
            node_id="NODE-04", timestamp=received_at, received_at=received_at,
            reported_ip="192.0.2.10", reported_mac="AA:BB:CC:DD:EE:FF",
        ))
        db.commit()

    payload = client.get(ENDPOINT.format("NODE-04"), headers=integration_headers()).json()
    assert payload["connection_status"] == "OFFLINE"
    assert payload["network_observation"]["reported_ip"] == "192.0.2.10"
    assert payload["network_observation"]["reported_at"] == received_at.isoformat()


@pytest.mark.parametrize("headers", [None, {"X-Rasid-Integration-Token": "wrong-token"}])
def test_integration_state_rejects_missing_or_invalid_auth(integration_api, headers):
    client, _, _ = integration_api
    response = client.get(ENDPOINT.format("NODE-04"), headers=headers)
    assert response.status_code == 401


def test_integration_state_rejects_node_outside_allowlist(integration_api):
    client, _, _ = integration_api
    response = client.get(ENDPOINT.format("NODE-OTHER"), headers=integration_headers())
    assert response.status_code == 403


def test_integration_state_rejects_node_03_with_valid_integration_token(integration_api):
    client, _, _ = integration_api
    response = client.get(ENDPOINT.format("NODE-03"), headers=integration_headers())
    assert response.status_code == 403


def test_integration_state_returns_not_found_for_unknown_allowed_node(integration_api):
    client, sessions, _ = integration_api
    with sessions() as db:
        db.query(Node).filter(Node.node_id == "NODE-04").delete()
        db.commit()

    response = client.get(ENDPOINT.format("NODE-04"), headers=integration_headers())
    assert response.status_code == 404


def test_integration_state_rejects_invalid_node_identifier(integration_api):
    client, _, _ = integration_api
    response = client.get(ENDPOINT.format("bad%20id"), headers=integration_headers())
    assert response.status_code == 422


def test_integration_state_hides_storage_failure_details(integration_api):
    client, _, _ = integration_api

    class BrokenSession:
        def query(self, *_args):
            raise RuntimeError("private database failure details")

        def close(self):
            pass

    def broken_db():
        yield BrokenSession()

    main.app.dependency_overrides[main.get_db] = broken_db
    response = client.get(ENDPOINT.format("NODE-04"), headers=integration_headers())

    assert response.status_code == 503
    assert response.json() == {"detail": "Integration state is temporarily unavailable"}
    assert "private database failure details" not in response.text


@pytest.mark.parametrize(("status", "age_seconds", "expected"), [
    ("ACTIVE", 30, "ONLINE"),
    ("ACTIVE", 30.001, "STALE"),
    ("ACTIVE", 90, "STALE"),
    ("ACTIVE", 90.001, "OFFLINE"),
    ("ACTIVE", None, "OFFLINE"),
    ("REVOKED", 1, "OFFLINE"),
])
def test_integration_connection_status_rules(status, age_seconds, expected):
    as_of = datetime(2026, 10, 5, 12, 0, tzinfo=timezone.utc)
    received = as_of - timedelta(seconds=age_seconds) if age_seconds is not None else None
    assert main.calculate_integration_connection_status(status, received, as_of) == expected


def test_integration_state_returns_only_bounded_latest_readings(integration_api):
    client, sessions, _ = integration_api
    now = datetime.now(timezone.utc)
    with sessions() as db:
        db.query(SensorReading).filter(SensorReading.node_id == "NODE-04").delete()
        db.add_all([
            SensorReading(
                node_id="NODE-04",
                sensor_id=f"S-{number:02d}",
                sensor_type="temperature",
                value=float(number),
                unit="C",
                timestamp=now - timedelta(seconds=number),
                validation_status="NORMAL",
            )
            for number in range(12)
        ])
        db.commit()

    response = client.get(ENDPOINT.format("NODE-04"), headers=integration_headers())
    assert response.status_code == 200
    readings = response.json()["readings"]
    assert len(readings) == main.INTEGRATION_STATE_READING_LIMIT
    assert readings[0]["sensor_id"] == "S-00"
    assert readings[-1]["sensor_id"] == "S-09"


@pytest.mark.parametrize("relay_state", ["ON", "OFF"])
def test_integration_state_returns_latest_persisted_relay_report_with_receipt_timestamp(integration_api, relay_state):
    client, sessions, _ = integration_api
    received_at = datetime.now(timezone.utc) + timedelta(minutes=1)
    device_timestamp = received_at - timedelta(days=1)
    with sessions() as db:
        db.add(Heartbeat(
            node_id="NODE-04",
            timestamp=device_timestamp,
            received_at=received_at,
            reported_relay_state=relay_state,
        ))
        db.commit()

    payload = client.get(ENDPOINT.format("NODE-04"), headers=integration_headers()).json()
    assert payload["reported_relay_state"] == relay_state
    assert payload["relay_reported_at"] == received_at.isoformat()
    assert payload["relay_reported_at"] != device_timestamp.isoformat()


def test_integration_state_returns_null_when_latest_heartbeat_has_no_relay_report(integration_api):
    client, sessions, _ = integration_api
    with sessions() as db:
        db.add(Heartbeat(
            node_id="NODE-04",
            timestamp=datetime.now(timezone.utc),
            received_at=datetime.now(timezone.utc) + timedelta(minutes=1),
            reported_relay_state=None,
        ))
        db.commit()

    payload = client.get(ENDPOINT.format("NODE-04"), headers=integration_headers()).json()
    assert payload["reported_relay_state"] is None
    assert payload["relay_reported_at"] is None


def test_integration_state_returns_null_when_no_heartbeat_exists(integration_api):
    client, sessions, _ = integration_api
    with sessions() as db:
        db.query(Heartbeat).filter(Heartbeat.node_id == "NODE-04").delete()
        db.commit()

    payload = client.get(ENDPOINT.format("NODE-04"), headers=integration_headers()).json()
    assert payload["reported_relay_state"] is None
    assert payload["relay_reported_at"] is None


def test_integration_state_keeps_historical_relay_report_when_node_is_offline(integration_api):
    client, sessions, _ = integration_api
    received_at = datetime.now(timezone.utc) - timedelta(seconds=91)
    with sessions() as db:
        db.query(Heartbeat).filter(Heartbeat.node_id == "NODE-04").delete()
        node = db.query(Node).filter(Node.node_id == "NODE-04").one()
        node.last_heartbeat_received_at = received_at
        db.add(Heartbeat(
            node_id="NODE-04",
            timestamp=received_at - timedelta(days=1),
            received_at=received_at,
            reported_relay_state="OFF",
        ))
        db.commit()

    payload = client.get(ENDPOINT.format("NODE-04"), headers=integration_headers()).json()
    assert payload["connection_status"] == "OFFLINE"
    assert payload["reported_relay_state"] == "OFF"
    assert payload["relay_reported_at"] == received_at.isoformat()


def test_integration_state_omits_forbidden_fields(integration_api):
    client, _, _ = integration_api
    response = client.get(ENDPOINT.format("NODE-04"), headers=integration_headers())

    assert response.status_code == 200
    payload = response.json()
    assert "credential_hash" not in payload
    assert "revoked_at" not in payload
    assert "registered_at" not in payload
    assert "next_cursor" not in payload
    assert "confidence" not in payload["readings"][0]
    assert "validation_reason" not in payload["readings"][0]
    assert set(payload["network_observation"]) == {
        "reported_ip", "reported_mac", "reported_rssi_dbm", "reported_ssid",
        "reported_bssid", "reported_wifi_channel", "reported_gateway",
        "reported_subnet_mask", "reported_at",
    }
    assert "credential_hash" not in payload["network_observation"]
    assert "timestamp" not in payload["network_observation"]
    assert "reported_relay_state" not in payload["network_observation"]


def test_integration_state_performs_no_commit_or_database_write(integration_api, monkeypatch):
    client, sessions, engine = integration_api
    statements = []

    def record_statement(_conn, _cursor, sql, *_):
        statements.append(sql)

    event.listen(engine, "before_cursor_execute", record_statement)

    def forbidden_commit(_self):
        raise AssertionError("integration state endpoint must not commit")

    monkeypatch.setattr(main.Session, "commit", forbidden_commit)
    response = client.get(ENDPOINT.format("NODE-04"), headers=integration_headers())

    event.remove(engine, "before_cursor_execute", record_statement)
    assert response.status_code == 200
    assert not any(sql.lstrip().upper().startswith(("INSERT", "UPDATE", "DELETE", "REPLACE")) for sql in statements)
    with sessions() as db:
        stored = db.query(Node).filter(Node.node_id == "NODE-04").one()
        assert stored.connection_status == "STALE"


def test_admin_or_device_credentials_cannot_substitute_for_integration_token(integration_api):
    client, _, _ = integration_api

    assert client.get(
        ENDPOINT.format("NODE-04"),
        headers={"X-Admin-Token": "admin-token"},
    ).status_code == 401
    assert client.get(
        ENDPOINT.format("NODE-04"),
        headers={"X-Device-Credential": "device-credential"},
    ).status_code == 401


def test_integration_credential_cannot_authorize_other_routes(integration_api):
    client, _, _ = integration_api

    assert client.get("/nodes", headers=integration_headers()).status_code == 401
    assert client.post(
        "/nodes",
        headers=integration_headers(),
        json={"node_id": "NODE-NEW"},
    ).status_code == 401


def test_integration_endpoint_fails_closed_when_token_is_unconfigured(integration_api, monkeypatch):
    client, _, _ = integration_api
    monkeypatch.setattr(main, "RASID_INTEGRATION_TOKEN", None)

    response = client.get(ENDPOINT.format("NODE-04"), headers=integration_headers())

    assert response.status_code == 503
    assert response.json() == {"detail": "Integration identity is not configured"}
    assert INTEGRATION_TOKEN not in response.text


def test_integration_heartbeat_history_returns_minimal_utc_receipts(integration_api):
    client, _, _ = integration_api

    response = client.get(HEARTBEATS_ENDPOINT.format("NODE-04"), headers=integration_headers())

    assert response.status_code == 200
    payload = response.json()
    assert set(payload) == {"node_id", "as_of", "items"}
    assert payload["node_id"] == "NODE-04"
    assert payload["as_of"].endswith("+00:00")
    assert len(payload["items"]) == 1
    assert set(payload["items"][0]) == {"received_at"}
    assert payload["items"][0]["received_at"].endswith("+00:00")
    forbidden = {
        "id", "timestamp", "reported_ip", "reported_mac", "reported_rssi_dbm",
        "reported_ssid", "reported_bssid", "reported_wifi_channel",
        "reported_gateway", "reported_subnet_mask", "reported_relay_state",
        "credential", "credential_hash",
    }
    assert not (forbidden & set(payload["items"][0]))


def test_integration_heartbeat_history_applies_default_and_maximum_limits(integration_api):
    client, sessions, _ = integration_api
    now = datetime.now(timezone.utc)
    with sessions() as db:
        db.query(Heartbeat).filter(Heartbeat.node_id == "NODE-04").delete()
        db.add_all([
            Heartbeat(node_id="NODE-04", timestamp=now, received_at=now - timedelta(seconds=index))
            for index in range(55)
        ])
        db.commit()

    default_response = client.get(HEARTBEATS_ENDPOINT.format("NODE-04"), headers=integration_headers())
    maximum_response = client.get(f"{HEARTBEATS_ENDPOINT.format('NODE-04')}?limit=50", headers=integration_headers())

    assert default_response.status_code == 200
    assert maximum_response.status_code == 200
    assert len(default_response.json()["items"]) == 50
    assert default_response.json()["items"] == maximum_response.json()["items"]


@pytest.mark.parametrize("limit", ["0", "-1", "51", "not-a-number"])
def test_integration_heartbeat_history_rejects_invalid_limits(integration_api, limit):
    client, _, _ = integration_api

    response = client.get(f"{HEARTBEATS_ENDPOINT.format('NODE-04')}?limit={limit}", headers=integration_headers())

    assert response.status_code == 422


def test_integration_heartbeat_history_is_newest_first_with_id_tiebreak(integration_api):
    client, sessions, _ = integration_api
    first = datetime(2026, 10, 8, 9, 0, tzinfo=timezone.utc)
    newest = datetime(2026, 10, 8, 10, 0, tzinfo=timezone.utc)
    with sessions() as db:
        db.query(Heartbeat).filter(Heartbeat.node_id == "NODE-04").delete()
        db.add_all([
            Heartbeat(node_id="NODE-04", timestamp=first, received_at=first),
            Heartbeat(node_id="NODE-04", timestamp=newest, received_at=newest),
            Heartbeat(node_id="NODE-04", timestamp=newest, received_at=newest),
        ])
        db.commit()
        tied_rows = db.query(Heartbeat).filter(
            Heartbeat.node_id == "NODE-04", Heartbeat.received_at == newest
        ).order_by(Heartbeat.id.desc()).all()

    statements = []

    def record_statement(_conn, _cursor, sql, *_):
        statements.append(sql)

    _, _, engine = integration_api
    event.listen(engine, "before_cursor_execute", record_statement)
    response = client.get(HEARTBEATS_ENDPOINT.format("NODE-04"), headers=integration_headers())
    event.remove(engine, "before_cursor_execute", record_statement)

    assert response.status_code == 200
    items = response.json()["items"]
    assert [item["received_at"] for item in items] == [
        newest.isoformat(), newest.isoformat(), first.isoformat(),
    ]
    # The internal ID is intentionally not exposed; inspect the executed
    # query to prove deterministic ordering for identical receipt timestamps.
    assert len(tied_rows) == 2
    normalized_statements = "\n".join(" ".join(statement.upper().split()) for statement in statements)
    assert "ORDER BY HEARTBEATS.RECEIVED_AT DESC, HEARTBEATS.ID DESC" in normalized_statements


def test_integration_heartbeat_history_returns_empty_items_when_absent(integration_api):
    client, sessions, _ = integration_api
    with sessions() as db:
        db.query(Heartbeat).filter(Heartbeat.node_id == "NODE-04").delete()
        db.commit()

    response = client.get(HEARTBEATS_ENDPOINT.format("NODE-04"), headers=integration_headers())

    assert response.status_code == 200
    assert response.json()["items"] == []


@pytest.mark.parametrize("headers", [None, {"X-Rasid-Integration-Token": "wrong-token"}])
def test_integration_heartbeat_history_rejects_missing_or_invalid_auth(integration_api, headers):
    client, _, _ = integration_api
    assert client.get(HEARTBEATS_ENDPOINT.format("NODE-04"), headers=headers).status_code == 401


def test_admin_or_device_credentials_cannot_access_integration_heartbeat_history(integration_api):
    client, _, _ = integration_api
    assert client.get(HEARTBEATS_ENDPOINT.format("NODE-04"), headers={"X-Admin-Token": "admin-token"}).status_code == 401
    assert client.get(HEARTBEATS_ENDPOINT.format("NODE-04"), headers={"X-Device-Credential": "device-credential"}).status_code == 401


@pytest.mark.parametrize("node_id", ["NODE-03", "NODE-OTHER"])
def test_integration_heartbeat_history_rejects_nodes_outside_allowlist(integration_api, node_id):
    client, _, _ = integration_api
    assert client.get(HEARTBEATS_ENDPOINT.format(node_id), headers=integration_headers()).status_code == 403


def test_integration_heartbeat_history_fails_closed_when_token_is_unconfigured(integration_api, monkeypatch):
    client, _, _ = integration_api
    monkeypatch.setattr(main, "RASID_INTEGRATION_TOKEN", None)

    response = client.get(HEARTBEATS_ENDPOINT.format("NODE-04"), headers=integration_headers())

    assert response.status_code == 503
    assert response.json() == {"detail": "Integration identity is not configured"}
    assert INTEGRATION_TOKEN not in response.text


def test_integration_heartbeat_history_performs_no_commit_or_database_write(integration_api, monkeypatch):
    client, sessions, engine = integration_api
    statements = []

    def record_statement(_conn, _cursor, sql, *_):
        statements.append(sql)

    event.listen(engine, "before_cursor_execute", record_statement)

    def forbidden_commit(_self):
        raise AssertionError("integration heartbeat endpoint must not commit")

    monkeypatch.setattr(main.Session, "commit", forbidden_commit)
    response = client.get(HEARTBEATS_ENDPOINT.format("NODE-04"), headers=integration_headers())

    event.remove(engine, "before_cursor_execute", record_statement)
    assert response.status_code == 200
    assert not any(sql.lstrip().upper().startswith(("INSERT", "UPDATE", "DELETE", "REPLACE")) for sql in statements)
    with sessions() as db:
        stored = db.query(Node).filter(Node.node_id == "NODE-04").one()
        assert stored.connection_status == "STALE"


def test_integration_reading_history_returns_minimal_schema_and_bounded_page(integration_api):
    client, sessions, _ = integration_api
    now = datetime.now(timezone.utc)
    with sessions() as db:
        db.add_all([
            SensorReading(
                node_id="NODE-04", sensor_id="TEMP-01", sensor_type="temperature",
                value=float(index), unit="C", timestamp=now - timedelta(seconds=index),
                validation_status="NORMAL", confidence=0.99,
                validation_reason="must not be exposed",
            )
            for index in range(205)
        ])
        db.commit()

    response = client.get(
        READINGS_ENDPOINT.format("NODE-04"),
        headers=integration_headers(),
        params={
            "sensor_id": "TEMP-01",
            "start": (now - timedelta(hours=1)).isoformat(),
            "end": (now + timedelta(minutes=1)).isoformat(),
            "limit": 200,
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert set(payload) == {
        "node_id", "sensor_id", "sensor_type", "start", "end", "as_of",
        "items", "next_cursor",
    }
    assert payload["node_id"] == "NODE-04"
    assert payload["sensor_id"] == "TEMP-01"
    assert payload["sensor_type"] == "temperature"
    assert len(payload["items"]) == 200
    assert isinstance(payload["next_cursor"], str)
    assert set(payload["items"][0]) == {
        "sensor_id", "sensor_type", "value", "unit", "timestamp",
        "validation_status",
    }
    assert payload["items"][0]["sensor_id"] == "TEMP-01"
    assert payload["items"][0]["sensor_type"] == "temperature"
    assert "confidence" not in payload["items"][0]
    assert "validation_reason" not in payload["items"][0]
    assert "id" not in payload["items"][0]


@pytest.mark.parametrize("headers", [None, {"X-Rasid-Integration-Token": "wrong-token"}])
def test_integration_reading_history_rejects_missing_or_invalid_auth(integration_api, headers):
    client, _, _ = integration_api
    now = datetime.now(timezone.utc)
    response = client.get(
        READINGS_ENDPOINT.format("NODE-04"),
        headers=headers,
        params={
            "sensor_id": "TEMP-01",
            "start": (now - timedelta(minutes=1)).isoformat(),
            "end": now.isoformat(),
        },
    )
    assert response.status_code == 401


@pytest.mark.parametrize("node_id", ["NODE-03", "NODE-OTHER"])
def test_integration_reading_history_rejects_nodes_outside_allowlist(integration_api, node_id):
    client, _, _ = integration_api
    now = datetime.now(timezone.utc)
    response = client.get(
        READINGS_ENDPOINT.format(node_id),
        headers=integration_headers(),
        params={
            "sensor_id": "TEMP-01",
            "start": (now - timedelta(minutes=1)).isoformat(),
            "end": now.isoformat(),
        },
    )
    assert response.status_code == 403


@pytest.mark.parametrize("sensor_id", ["OTHER", "TEMP-03"])
def test_integration_reading_history_rejects_unapproved_sensor_scope(integration_api, sensor_id):
    client, _, _ = integration_api
    now = datetime.now(timezone.utc)
    response = client.get(
        READINGS_ENDPOINT.format("NODE-04"),
        headers=integration_headers(),
        params={
            "sensor_id": sensor_id,
            "start": (now - timedelta(minutes=1)).isoformat(),
            "end": now.isoformat(),
        },
    )
    assert response.status_code == 422
