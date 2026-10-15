import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

# main.py uses local absolute imports (database/models), so expose backend.
BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import main
from database import enable_sqlite_foreign_keys, migrate_v2_location_network_schema
from models import ExternalTemperatureObservation, Heartbeat, Node, SensorReading


ADMIN_TOKEN = "test-admin-token"
NODE_A_CREDENTIAL = "node-a-test-credential"
NODE_B_CREDENTIAL = "node-b-test-credential"


@pytest.fixture
def api(monkeypatch):
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    enable_sqlite_foreign_keys(engine)
    main.Base.metadata.create_all(bind=engine)
    migrate_v2_location_network_schema(engine)
    test_session = sessionmaker(
        autocommit=False, autoflush=False, bind=engine
    )

    def override_get_db():
        db = test_session()
        try:
            yield db
        finally:
            db.close()

    main.app.dependency_overrides[main.get_db] = override_get_db
    monkeypatch.setattr(main, "ADMIN_PROVISIONING_TOKEN", ADMIN_TOKEN)

    with test_session() as db:
        db.add_all([
            Node(
                node_id="NODE-A",
                credential_hash=main.password_hash.hash(NODE_A_CREDENTIAL),
                status="ACTIVE",
                connection_status="OFFLINE",
                provisioned_at=datetime.now(timezone.utc),
            ),
            Node(
                node_id="NODE-B",
                credential_hash=main.password_hash.hash(NODE_B_CREDENTIAL),
                status="ACTIVE",
                connection_status="OFFLINE",
                provisioned_at=datetime.now(timezone.utc),
            ),
        ])
        db.add(SensorReading(
            node_id="NODE-A",
            sensor_id="TEMP-A",
            sensor_type="temperature",
            value=24.0,
            unit="C",
            timestamp=datetime.now(timezone.utc),
            validation_status="NORMAL",
            confidence=1.0,
        ))
        db.add(Heartbeat(
            node_id="NODE-A",
            timestamp=datetime.now(timezone.utc),
            received_at=datetime.now(timezone.utc),
        ))
        db.commit()

    client = TestClient(main.app)
    yield client
    client.close()
    main.app.dependency_overrides.clear()
    main.Base.metadata.drop_all(bind=engine)
    engine.dispose()


def admin_headers():
    return {"X-Admin-Token": ADMIN_TOKEN}


def test_external_temperature_reports_unconfigured_without_provider(api):
    response = api.get("/weather/external-temperature", headers=admin_headers())

    assert response.status_code == 200
    assert response.json() == {"status": "UNCONFIGURED", "observation": None}


def test_external_temperature_serializes_latest_stored_observation_as_utc(api):
    # Insert through the API test's overridden database dependency.
    db_dependency = main.app.dependency_overrides[main.get_db]
    db = next(db_dependency())
    try:
        db.add(ExternalTemperatureObservation(
            provider="configured-test-adapter",
            site_id="test-site",
            observed_at=datetime(2026, 10, 1, 12, 0),
            retrieved_at=datetime(2026, 10, 1, 12, 1),
            value=31.5,
            unit="C",
            status="CURRENT",
        ))
        db.commit()
    finally:
        db.close()

    response = api.get("/weather/external-temperature", headers=admin_headers())

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "CURRENT"
    assert payload["observation"]["provider"] == "configured-test-adapter"
    assert payload["observation"]["observed_at"].endswith("+00:00")
    assert payload["observation"]["retrieved_at"].endswith("+00:00")


def device_headers(credential):
    return {"X-Device-Credential": credential}


READ_ENDPOINTS = [
    ("/weather/external-temperature", None),
    ("/locations", None),
    ("/locations/A1-1", None),
    ("/nodes", None),
    ("/nodes/NODE-A", None),
    ("/readings", None),
    ("/nodes/NODE-A/readings", None),
    ("/heartbeats", None),
]


@pytest.mark.parametrize(("path", "_"), READ_ENDPOINTS)
def test_read_endpoints_reject_missing_admin_credential(api, path, _):
    assert api.get(path).status_code == 401


@pytest.mark.parametrize(("path", "_"), READ_ENDPOINTS)
def test_read_endpoints_reject_invalid_admin_credential(api, path, _):
    assert api.get(path, headers={"X-Admin-Token": "wrong"}).status_code == 401


@pytest.mark.parametrize(("path", "_"), READ_ENDPOINTS)
def test_read_endpoints_accept_admin_and_omit_credentials(api, path, _):
    response = api.get(path, headers=admin_headers())
    assert response.status_code == 200
    assert "credential_hash" not in response.text
    assert NODE_A_CREDENTIAL not in response.text
    assert NODE_B_CREDENTIAL not in response.text


@pytest.mark.parametrize(("path", "_"), READ_ENDPOINTS)
def test_device_credential_cannot_access_read_endpoints(api, path, _):
    response = api.get(path, headers=device_headers(NODE_A_CREDENTIAL))
    assert response.status_code == 401


def test_device_cannot_access_another_nodes_readings(api):
    response = api.get(
        "/nodes/NODE-B/readings",
        headers=device_headers(NODE_A_CREDENTIAL),
    )
    assert response.status_code == 401


def reading_payload(node_id):
    return {
        "node_id": node_id,
        "sensor_id": "HUM-A",
        "sensor_type": "humidity",
        "value": 55.0,
        "unit": "%",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


def test_device_can_submit_reading_for_its_bound_node(api):
    response = api.post(
        "/readings",
        json=reading_payload("NODE-A"),
        headers=device_headers(NODE_A_CREDENTIAL),
    )
    assert response.status_code == 200
    assert response.json()["reading_id"]


def test_registration_and_revocation_return_utc_lifecycle_timestamps(api):
    registered = api.post(
        "/nodes",
        headers=admin_headers(),
        json={"node_id": "NODE-NEW"},
    )

    assert registered.status_code == 200
    assert registered.json()["registered_at"].endswith("+00:00")

    revoked = api.post("/nodes/NODE-A/revoke", headers=admin_headers())

    assert revoked.status_code == 200
    assert revoked.json()["revoked_at"].endswith("+00:00")


def test_device_cannot_submit_reading_for_another_node(api):
    response = api.post(
        "/readings",
        json=reading_payload("NODE-B"),
        headers=device_headers(NODE_A_CREDENTIAL),
    )
    assert response.status_code == 401


def test_device_can_submit_heartbeat_for_its_bound_node(api):
    response = api.post(
        "/heartbeat",
        json={
            "node_id": "NODE-A",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        },
        headers=device_headers(NODE_A_CREDENTIAL),
    )
    assert response.status_code == 200
    assert response.json()["node_id"] == "NODE-A"
    assert response.json()["connection_status"] == "ONLINE"


def test_node_and_heartbeat_datetimes_include_utc_timezone(api):
    device_timestamp = datetime.now(timezone.utc) - timedelta(seconds=2)
    submitted = api.post(
        "/heartbeat",
        json={"node_id": "NODE-A", "timestamp": device_timestamp.isoformat()},
        headers=device_headers(NODE_A_CREDENTIAL),
    )
    assert submitted.status_code == 200

    nodes = api.get("/nodes", headers=admin_headers())
    assert nodes.status_code == 200
    node = next(item for item in nodes.json() if item["node_id"] == "NODE-A")
    assert node["last_seen"].endswith("+00:00")

    heartbeats = api.get("/heartbeats", headers=admin_headers())
    assert heartbeats.status_code == 200
    heartbeat = next(
        item for item in heartbeats.json()["items"]
        if item["node_id"] == "NODE-A"
        and item["timestamp"].startswith(device_timestamp.strftime("%Y-%m-%dT%H:%M:%S"))
    )
    assert heartbeat["timestamp"].endswith("+00:00")
    assert heartbeat["received_at"].endswith("+00:00")


@pytest.mark.parametrize("path", ["/readings", "/nodes/NODE-A/readings"])
def test_reading_timestamps_include_utc_timezone(api, path):
    response = api.get(path, headers=admin_headers())

    assert response.status_code == 200
    reading = next(item for item in response.json()["items"] if item["node_id"] == "NODE-A")
    assert reading["timestamp"].endswith("+00:00")


def test_utc_api_datetime_normalizes_aware_values_without_changing_instant():
    local_offset = datetime(2026, 9, 30, 23, 40, tzinfo=timezone(timedelta(hours=3)))

    normalized = main.utc_api_datetime(local_offset)

    assert normalized == datetime(2026, 9, 30, 20, 40, tzinfo=timezone.utc)


def test_device_cannot_submit_heartbeat_for_another_node(api):
    response = api.post(
        "/heartbeat",
        json={
            "node_id": "NODE-B",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        },
        headers=device_headers(NODE_A_CREDENTIAL),
    )
    assert response.status_code == 401


@pytest.mark.parametrize("path", ["/readings", "/heartbeat"])
def test_revoked_device_cannot_submit_data(api, path):
    revoked = api.post(
        "/nodes/NODE-A/revoke",
        headers=admin_headers(),
    )
    assert revoked.status_code == 200

    if path == "/readings":
        response = api.post(
            path,
            json=reading_payload("NODE-A"),
            headers=device_headers(NODE_A_CREDENTIAL),
        )
    else:
        response = api.post(
            path,
            json={
                "node_id": "NODE-A",
                "timestamp": datetime.now(timezone.utc).isoformat(),
            },
            headers=device_headers(NODE_A_CREDENTIAL),
        )
    assert response.status_code == 403
