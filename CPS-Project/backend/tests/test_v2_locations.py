import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import main
from database import enable_sqlite_foreign_keys, migrate_v2_location_network_schema
from models import Node, SensorReading


ADMIN_TOKEN = "v2-location-test-admin"
DEVICE_TOKEN = "v2-location-test-device"


@pytest.fixture
def location_api(monkeypatch):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
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

    monkeypatch.setattr(main, "ADMIN_PROVISIONING_TOKEN", ADMIN_TOKEN)
    main.app.dependency_overrides[main.get_db] = override_db
    with sessions() as db:
        for node_id in ("NODE-03", "NODE-04", "NODE-11"):
            db.add(Node(
                node_id=node_id,
                credential_hash=main.password_hash.hash(DEVICE_TOKEN),
                status="ACTIVE",
                connection_status="OFFLINE",
            ))
        db.add(SensorReading(
            node_id="NODE-03", sensor_id="OLD-TEMP", sensor_type="temperature",
            value=23.0, unit="C", timestamp=datetime.now(timezone.utc) - timedelta(days=1),
            validation_status="UNKNOWN",
        ))
        db.commit()
    client = TestClient(main.app)
    yield client, sessions
    client.close()
    main.app.dependency_overrides.clear()
    main.Base.metadata.drop_all(bind=engine)
    engine.dispose()


def headers():
    return {"X-Admin-Token": ADMIN_TOKEN}


def test_location_catalogue_has_64_subzones_and_only_a1_1_deployed(location_api):
    client, _ = location_api
    response = client.get("/locations", headers=headers())
    assert response.status_code == 200
    locations = response.json()
    assert len(locations) == 64
    assert sum(location["deployment_status"] == "DEPLOYED" for location in locations) == 1
    assert next(item for item in locations if item["location_id"] == "A1-1")["deployment_status"] == "DEPLOYED"
    assert all(item["deployment_status"] == "NOT_DEPLOYED" for item in locations if item["location_id"] != "A1-1")


def test_location_reads_and_assignment_require_admin_and_validate_deployed_codes(location_api):
    client, sessions = location_api
    assert client.get("/locations").status_code == 401
    assert client.get("/locations/A1-1", headers=headers()).json()["hall"] == "A1"
    assert client.put("/nodes/NODE-03/location", json={"location_id": "A1-1"}).status_code == 401
    not_deployed = client.put("/nodes/NODE-03/location", headers=headers(), json={"location_id": "A1-2"})
    assert not_deployed.status_code == 409
    unknown = client.put("/nodes/NODE-03/location", headers=headers(), json={"location_id": "Z9-9"})
    assert unknown.status_code == 404
    assigned = client.put("/nodes/NODE-03/location", headers=headers(), json={"location_id": "A1-1"})
    assert assigned.status_code == 200
    assert assigned.json() == {"node_id": "NODE-03", "location_id": "A1-1"}
    with sessions() as db:
        locations = {node.node_id: node.location_id for node in db.query(Node).all()}
        assert locations == {"NODE-03": "A1-1", "NODE-04": None, "NODE-11": None}


def test_new_reading_snapshots_node_location_and_old_rows_remain_unassigned(location_api):
    client, sessions = location_api
    assert client.put("/nodes/NODE-03/location", headers=headers(), json={"location_id": "A1-1"}).status_code == 200
    timestamp = datetime.now(timezone.utc).isoformat()
    response = client.post("/readings", headers={"X-Device-Credential": DEVICE_TOKEN}, json={
        "node_id": "NODE-03", "sensor_id": "TEMP-NEW", "sensor_type": "temperature",
        "value": 24.0, "unit": "C", "timestamp": timestamp,
    })
    assert response.status_code == 200
    with sessions() as db:
        rows = db.query(SensorReading).order_by(SensorReading.id).all()
        assert rows[0].location_id is None
        assert rows[-1].location_id == "A1-1"


def test_heartbeat_receipt_time_drives_freshness_and_network_fields_are_validated(location_api):
    client, _ = location_api
    device_timestamp = datetime.now(timezone.utc) - timedelta(days=3)
    response = client.post("/heartbeat", headers={"X-Device-Credential": DEVICE_TOKEN}, json={
        "node_id": "NODE-03", "timestamp": device_timestamp.isoformat(),
        "reported_ip": "192.0.2.10", "reported_mac": "AA:BB:CC:DD:EE:FF",
        "reported_rssi_dbm": -61,
    })
    assert response.status_code == 200
    assert response.json()["connection_status"] == "ONLINE"
    node = client.get("/nodes/NODE-03", headers=headers()).json()
    assert node["last_seen"].startswith(device_timestamp.strftime("%Y-%m-%dT%H:%M:%S"))
    assert node["last_heartbeat_received_at"] != node["last_seen"]
    page = client.get("/heartbeats?node_id=NODE-03", headers=headers()).json()
    heartbeat = page["items"][0]
    assert heartbeat["reported_ip"] == "192.0.2.10"
    assert heartbeat["reported_mac"] == "AA:BB:CC:DD:EE:FF"
    assert heartbeat["reported_rssi_dbm"] == -61
    assert heartbeat["reported_ssid"] is None
    assert heartbeat["reported_bssid"] is None
    assert heartbeat["reported_wifi_channel"] is None
    assert heartbeat["reported_gateway"] is None
    assert heartbeat["reported_subnet_mask"] is None
    assert heartbeat["reported_relay_state"] is None
    assert all("credential" not in key.lower() for key in heartbeat)
    bad_mac = client.post("/heartbeat", headers={"X-Device-Credential": DEVICE_TOKEN}, json={
        "node_id": "NODE-03", "timestamp": datetime.now(timezone.utc).isoformat(),
        "reported_mac": "not-a-mac",
    })
    assert bad_mac.status_code == 422


def test_heartbeat_stores_and_exposes_optional_device_reported_wifi_fields(location_api):
    client, _ = location_api
    response = client.post("/heartbeat", headers={"X-Device-Credential": DEVICE_TOKEN}, json={
        "node_id": "NODE-03", "timestamp": datetime.now(timezone.utc).isoformat(),
        "reported_ip": "192.0.2.44", "reported_mac": "02:00:5E:00:00:04", "reported_rssi_dbm": -69,
        "reported_ssid": "CPS-Lab", "reported_bssid": "AA:BB:CC:DD:EE:FF",
        "reported_wifi_channel": 6, "reported_gateway": "192.0.2.1",
        "reported_subnet_mask": "255.255.255.0",
    })
    assert response.status_code == 200
    heartbeat = client.get("/heartbeats?node_id=NODE-03", headers=headers()).json()["items"][0]
    assert heartbeat["reported_ssid"] == "CPS-Lab"
    assert heartbeat["reported_bssid"] == "AA:BB:CC:DD:EE:FF"
    assert heartbeat["reported_wifi_channel"] == 6
    assert heartbeat["reported_gateway"] == "192.0.2.1"
    assert heartbeat["reported_subnet_mask"] == "255.255.255.0"
    assert all("credential" not in key.lower() for key in heartbeat)


@pytest.mark.parametrize("relay_state", ["ON", "OFF"])
def test_heartbeat_stores_and_exposes_reported_relay_state(location_api, relay_state):
    client, _ = location_api
    response = client.post("/heartbeat", headers={"X-Device-Credential": DEVICE_TOKEN}, json={
        "node_id": "NODE-03", "timestamp": datetime.now(timezone.utc).isoformat(),
        "reported_relay_state": relay_state,
    })
    assert response.status_code == 200

    heartbeat = client.get("/heartbeats?node_id=NODE-03", headers=headers()).json()["items"][0]
    assert heartbeat["reported_relay_state"] == relay_state


@pytest.mark.parametrize("relay_state", ["RUNNING", "on", ""])
def test_heartbeat_rejects_invalid_reported_relay_state(location_api, relay_state):
    client, _ = location_api
    response = client.post("/heartbeat", headers={"X-Device-Credential": DEVICE_TOKEN}, json={
        "node_id": "NODE-03", "timestamp": datetime.now(timezone.utc).isoformat(),
        "reported_relay_state": relay_state,
    })
    assert response.status_code == 422


@pytest.mark.parametrize("field,value", [
    ("reported_bssid", "not-a-mac"),
    ("reported_wifi_channel", 0),
    ("reported_wifi_channel", 15),
    ("reported_gateway", "not-an-ip"),
    ("reported_subnet_mask", "not-a-mask"),
])
def test_heartbeat_validates_optional_wifi_fields(location_api, field, value):
    client, _ = location_api
    payload = {"node_id": "NODE-03", "timestamp": datetime.now(timezone.utc).isoformat(), field: value}
    response = client.post("/heartbeat", headers={"X-Device-Credential": DEVICE_TOKEN}, json=payload)
    assert response.status_code == 422


def test_v2_migration_is_idempotent_and_preserves_unassigned_history():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    enable_sqlite_foreign_keys(engine)
    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE nodes (id INTEGER PRIMARY KEY, node_id VARCHAR UNIQUE NOT NULL, credential_hash VARCHAR NOT NULL, status VARCHAR NOT NULL, connection_status VARCHAR NOT NULL, last_seen DATETIME, provisioned_at DATETIME, revoked_at DATETIME)"))
        connection.execute(text("CREATE TABLE sensor_readings (id INTEGER PRIMARY KEY, node_id VARCHAR NOT NULL, sensor_id VARCHAR NOT NULL, sensor_type VARCHAR NOT NULL, value FLOAT NOT NULL, unit VARCHAR NOT NULL, timestamp DATETIME NOT NULL, validation_status VARCHAR NOT NULL, confidence FLOAT, validation_reason VARCHAR)"))
        connection.execute(text("CREATE TABLE heartbeats (id INTEGER PRIMARY KEY, node_id VARCHAR NOT NULL, timestamp DATETIME NOT NULL, received_at DATETIME NOT NULL)"))
        connection.execute(text("INSERT INTO nodes (id,node_id,credential_hash,status,connection_status) VALUES (1,'NODE-03','verifier-placeholder','ACTIVE','OFFLINE'),(2,'NODE-04','verifier-placeholder','ACTIVE','OFFLINE'),(3,'NODE-11','verifier-placeholder','ACTIVE','OFFLINE')"))
        connection.execute(text("INSERT INTO sensor_readings (id,node_id,sensor_id,sensor_type,value,unit,timestamp,validation_status) VALUES (1,'NODE-03','OLD','temperature',22,'C','2026-09-01T00:00:00','UNKNOWN')"))
        connection.execute(text("INSERT INTO heartbeats (id,node_id,timestamp,received_at) VALUES (1,'NODE-03','2026-09-01T00:00:00','2026-09-01T00:00:01')"))
    migrate_v2_location_network_schema(engine)
    with engine.connect() as connection:
        assert connection.execute(text("SELECT location_id FROM nodes WHERE node_id='NODE-03'")).scalar_one() == "A1-1"
        columns = {row[1] for row in connection.execute(text("PRAGMA table_info(heartbeats)"))}
        assert {"reported_ssid", "reported_bssid", "reported_wifi_channel", "reported_gateway", "reported_subnet_mask", "reported_relay_state"} <= columns
    with engine.begin() as connection:
        connection.execute(text("UPDATE nodes SET location_id=NULL WHERE node_id='NODE-03'"))
    migrate_v2_location_network_schema(engine)
    with engine.connect() as connection:
        assert connection.execute(text("SELECT COUNT(*) FROM nodes")).scalar_one() == 3
        assert connection.execute(text("SELECT COUNT(*) FROM sensor_readings")).scalar_one() == 1
        assert connection.execute(text("SELECT COUNT(*) FROM heartbeats")).scalar_one() == 1
        assert connection.execute(text("SELECT location_id FROM nodes WHERE node_id='NODE-03'")).scalar_one() is None
        assert connection.execute(text("SELECT COUNT(*) FROM nodes WHERE node_id IN ('NODE-04','NODE-11') AND location_id IS NULL")).scalar_one() == 2
        assert connection.execute(text("SELECT location_id FROM sensor_readings WHERE id=1")).scalar_one() is None
        assert connection.execute(text("SELECT COUNT(*) FROM subzones")).scalar_one() == 64
        assert connection.execute(text("SELECT COUNT(*) FROM subzones WHERE deployment_status='DEPLOYED'")).scalar_one() == 1
        assert connection.execute(text("PRAGMA foreign_key_check")).fetchall() == []
    engine.dispose()
