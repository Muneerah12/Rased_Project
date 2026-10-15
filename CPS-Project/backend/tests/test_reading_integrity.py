import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import main
from database import migrate_sensor_reading_integrity_schema
from models import Node, SensorReading


ADMIN_TOKEN = "integrity-test-admin"
NODE_CREDENTIALS = {
    "NODE-A": "integrity-credential-a",
    "NODE-B": "integrity-credential-b",
    "NODE-C": "integrity-credential-c",
}
DEFAULT_GROUPS = {
    "NODE-A": {
        "TEMP-01": "AREA-A",
        "TEMP-02": "AREA-A",
        "TEMP-03": "AREA-A",
        "TEMP-04": "AREA-A",
        "HUM-01": "AREA-A",
        "HUM-02": "AREA-A",
        "PRESS-01": "AREA-A",
        "PRESS-02": "AREA-A",
    },
    "NODE-B": {"TEMP-01": "AREA-A", "TEMP-02": "AREA-A"},
    "NODE-C": {"TEMP-01": "AREA-B"},
}


@pytest.fixture
def integrity_api(monkeypatch):
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    main.Base.metadata.create_all(bind=engine)
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
    monkeypatch.setenv("CPS_SENSOR_COMPARISON_GROUPS", json.dumps(DEFAULT_GROUPS))
    monkeypatch.delenv("CPS_PEER_FRESHNESS_SECONDS", raising=False)
    for sensor_type in ("temperature", "humidity", "pressure"):
        monkeypatch.delenv(
            f"CPS_{sensor_type.upper()}_PEER_TOLERANCE",
            raising=False,
        )

    with test_session() as db:
        for node_id, credential in NODE_CREDENTIALS.items():
            db.add(Node(
                node_id=node_id,
                credential_hash=main.password_hash.hash(credential),
                status="ACTIVE",
                connection_status="OFFLINE",
                provisioned_at=datetime.now(timezone.utc),
            ))
        db.commit()

    client = TestClient(main.app)
    yield client, test_session, monkeypatch
    client.close()
    main.app.dependency_overrides.clear()
    main.Base.metadata.drop_all(bind=engine)
    engine.dispose()


def groups(monkeypatch, value):
    monkeypatch.setenv("CPS_SENSOR_COMPARISON_GROUPS", json.dumps(value))


def add_peer(
    session_factory,
    *,
    node_id="NODE-A",
    sensor_id="TEMP-02",
    sensor_type="temperature",
    value=35.0,
    unit="C",
    timestamp=None,
    validation_status="NORMAL",
    confidence=0.8,
    validation_reason="test peer",
):
    timestamp = timestamp or datetime.now(timezone.utc) - timedelta(seconds=2)
    with session_factory() as db:
        reading = SensorReading(
            node_id=node_id,
            sensor_id=sensor_id,
            sensor_type=sensor_type,
            value=value,
            unit=unit,
            timestamp=timestamp,
            validation_status=validation_status,
            confidence=confidence,
            validation_reason=validation_reason,
        )
        db.add(reading)
        db.commit()
        db.refresh(reading)
        return reading.id


def submit(
    client,
    *,
    node_id="NODE-A",
    credential=None,
    sensor_id="TEMP-01",
    sensor_type="temperature",
    value=35.0,
    unit="C",
    timestamp=None,
):
    timestamp = timestamp or datetime.now(timezone.utc)
    return client.post(
        "/readings",
        json={
            "node_id": node_id,
            "sensor_id": sensor_id,
            "sensor_type": sensor_type,
            "value": value,
            "unit": unit,
            "timestamp": timestamp.isoformat(),
        },
        headers={
            "X-Device-Credential": credential or NODE_CREDENTIALS[node_id],
        },
    )


@pytest.mark.parametrize(
    ("sensor_type", "unit", "value"),
    [
        ("temperature", "C", 35.0),
        ("humidity", "%", 55.0),
        ("pressure", "hPa", 1013.0),
    ],
)
def test_valid_engineering_ranges_are_not_invalid(
    integrity_api, sensor_type, unit, value
):
    client, _, _ = integrity_api
    response = submit(
        client,
        sensor_id={
            "temperature": "TEMP-01",
            "humidity": "HUM-01",
            "pressure": "PRESS-01",
        }[sensor_type],
        sensor_type=sensor_type,
        unit=unit,
        value=value,
    )
    assert response.status_code == 200
    assert response.json()["validation_status"] == "UNKNOWN"
    assert response.json()["validation_reason"] == "insufficient comparable peers"


@pytest.mark.parametrize(
    ("sensor_type", "sensor_id", "unit", "value"),
    [
        ("temperature", "TEMP-01", "C", 150.0),
        ("humidity", "HUM-01", "%", 110.0),
        ("pressure", "PRESS-01", "hPa", 1200.0),
        ("gas", "GAS-01", "ppm", 10.0),
        ("temperature", "TEMP-01", "F", 72.0),
    ],
)
def test_invalid_values_types_and_units_are_invalid(
    integrity_api, sensor_type, sensor_id, unit, value
):
    client, _, _ = integrity_api
    response = submit(
        client,
        sensor_id=sensor_id,
        sensor_type=sensor_type,
        unit=unit,
        value=value,
    )
    assert response.status_code == 200
    assert response.json()["validation_status"] == "INVALID"
    assert response.json()["confidence"] == 0.1


@pytest.mark.parametrize("value", [float("nan"), float("inf"), float("-inf")])
def test_non_finite_sensor_values_are_rejected_at_the_api_boundary(integrity_api, value):
    client, _, _ = integrity_api
    token = "NaN" if value != value else "Infinity" if value > 0 else "-Infinity"
    timestamp = datetime.now(timezone.utc).isoformat()
    response = client.post(
        "/readings",
        content=(
            '{"node_id":"NODE-A","sensor_id":"TEMP-01",'
            '"sensor_type":"temperature","value":' + token +
            ',"unit":"C","timestamp":"' + timestamp + '"}'
        ),
        headers={
            "Content-Type": "application/json",
            "X-Device-Credential": NODE_CREDENTIALS["NODE-A"],
        },
    )

    assert response.status_code == 422


def test_same_node_peer_agreement_is_normal(integrity_api):
    client, session_factory, _ = integrity_api
    add_peer(session_factory, sensor_id="TEMP-02", value=35.2)
    add_peer(session_factory, sensor_id="TEMP-03", value=34.8)
    response = submit(client, sensor_id="TEMP-01", value=35.0)
    assert response.json()["validation_status"] == "NORMAL"
    assert response.json()["confidence"] > 0.5
    assert response.json()["validation_reason"] == "same-node peers agree"


def test_same_node_outlier_is_suspicious(integrity_api):
    client, session_factory, _ = integrity_api
    add_peer(session_factory, sensor_id="TEMP-01", value=35.0)
    add_peer(session_factory, sensor_id="TEMP-02", value=35.0)
    response = submit(client, sensor_id="TEMP-03", value=20.0)
    assert response.json()["validation_status"] == "SUSPICIOUS"
    assert response.json()["validation_reason"] == "same-node peer deviation"
    assert response.json()["confidence"] < 0.8


def test_median_reference_resists_one_outlier(integrity_api):
    client, session_factory, _ = integrity_api
    add_peer(session_factory, sensor_id="TEMP-01", value=35.0)
    add_peer(session_factory, sensor_id="TEMP-02", value=35.0)
    add_peer(session_factory, sensor_id="TEMP-03", value=20.0)
    response = submit(client, sensor_id="TEMP-04", value=33.0)
    # Median(35, 35, 20) is 35 (deviation 2); the mean is 30 (deviation 3).
    assert response.json()["validation_status"] == "NORMAL"


def test_current_sensor_id_is_excluded_from_same_node_peers(integrity_api):
    client, session_factory, _ = integrity_api
    add_peer(session_factory, sensor_id="TEMP-01", value=20.0)
    add_peer(session_factory, sensor_id="TEMP-02", value=35.0)
    response = submit(client, sensor_id="TEMP-01", value=35.0)
    assert response.json()["validation_status"] == "NORMAL"


def test_no_comparable_peer_is_unknown(integrity_api):
    client, _, _ = integrity_api
    response = submit(client, sensor_id="TEMP-01", value=35.0)
    assert response.json()["validation_status"] == "UNKNOWN"
    assert response.json()["confidence"] == 0.5


def test_cross_node_peers_in_same_group_agree(integrity_api):
    client, session_factory, _ = integrity_api
    add_peer(
        session_factory,
        node_id="NODE-B",
        sensor_id="TEMP-01",
        value=34.7,
    )
    response = submit(client, sensor_id="TEMP-01", value=35.0)
    assert response.json()["validation_status"] == "NORMAL"
    assert response.json()["validation_reason"] == "cross-node peers agree"


def test_cross_node_disagreement_is_suspicious(integrity_api):
    client, session_factory, _ = integrity_api
    add_peer(
        session_factory,
        node_id="NODE-B",
        sensor_id="TEMP-01",
        value=25.0,
    )
    response = submit(client, sensor_id="TEMP-01", value=35.0)
    assert response.json()["validation_status"] == "SUSPICIOUS"
    assert response.json()["validation_reason"] == "cross-node peer deviation"


def test_different_comparison_groups_are_not_compared(integrity_api):
    client, session_factory, _ = integrity_api
    add_peer(
        session_factory,
        node_id="NODE-C",
        sensor_id="TEMP-01",
        value=25.0,
    )
    response = submit(client, sensor_id="TEMP-01", value=35.0)
    assert response.json()["validation_status"] == "UNKNOWN"


def test_different_sensor_types_are_not_compared(integrity_api):
    client, session_factory, _ = integrity_api
    add_peer(
        session_factory,
        sensor_id="HUM-02",
        sensor_type="humidity",
        value=30.0,
        unit="%",
    )
    response = submit(client, sensor_id="TEMP-01", value=35.0)
    assert response.json()["validation_status"] == "UNKNOWN"


def test_compatible_celsius_unit_aliases_are_compared(integrity_api):
    client, session_factory, _ = integrity_api
    add_peer(
        session_factory,
        sensor_id="TEMP-02",
        value=35.0,
        unit="°C",
    )
    response = submit(client, sensor_id="TEMP-01", value=35.0, unit="C")
    assert response.json()["validation_status"] == "NORMAL"


def test_incompatible_unit_peer_is_ignored(integrity_api):
    client, session_factory, _ = integrity_api
    add_peer(
        session_factory,
        sensor_id="TEMP-02",
        value=20.0,
        unit="F",
    )
    response = submit(client, sensor_id="TEMP-01", value=35.0, unit="C")
    assert response.json()["validation_status"] == "UNKNOWN"


def test_stale_peer_is_ignored(integrity_api):
    client, session_factory, _ = integrity_api
    add_peer(
        session_factory,
        sensor_id="TEMP-02",
        value=20.0,
        timestamp=datetime.now(timezone.utc) - timedelta(seconds=120),
    )
    response = submit(client, sensor_id="TEMP-01", value=35.0)
    assert response.json()["validation_status"] == "UNKNOWN"


def test_future_peer_is_ignored(integrity_api):
    client, session_factory, _ = integrity_api
    add_peer(
        session_factory,
        node_id="NODE-B",
        sensor_id="TEMP-01",
        value=20.0,
        timestamp=datetime.now(timezone.utc) + timedelta(seconds=30),
    )
    response = submit(client, sensor_id="TEMP-01", value=35.0)
    assert response.json()["validation_status"] == "UNKNOWN"


def test_peer_threshold_is_configurable(integrity_api):
    client, session_factory, monkeypatch = integrity_api
    add_peer(session_factory, sensor_id="TEMP-02", value=32.5)
    monkeypatch.setenv("CPS_TEMPERATURE_PEER_TOLERANCE", "3.0")
    response = submit(client, sensor_id="TEMP-01", value=35.0)
    assert response.json()["validation_status"] == "NORMAL"


def test_device_identity_binding_and_revoked_rejection(integrity_api):
    client, _, _ = integrity_api
    cross_node = submit(
        client,
        node_id="NODE-B",
        credential=NODE_CREDENTIALS["NODE-A"],
        sensor_id="TEMP-01",
    )
    assert cross_node.status_code == 401

    revoked = client.post(
        "/nodes/NODE-A/revoke",
        headers={"X-Admin-Token": ADMIN_TOKEN},
    )
    assert revoked.status_code == 200
    after_revoke = submit(client, node_id="NODE-A", sensor_id="TEMP-01")
    assert after_revoke.status_code == 403


def test_integrity_fields_persist_and_authorized_get_exposes_no_secrets(
    integrity_api,
):
    client, session_factory, _ = integrity_api
    response = submit(client, sensor_id="TEMP-01", value=150.0)
    assert response.json()["validation_status"] == "INVALID"
    reading_id = response.json()["reading_id"]

    with session_factory() as db:
        stored = db.query(SensorReading).filter_by(id=reading_id).one()
        assert stored.validation_status == "INVALID"
        assert stored.confidence == 0.1
        assert stored.validation_reason == "outside engineering range"

    headers = {"X-Admin-Token": ADMIN_TOKEN}
    all_readings = client.get("/readings", headers=headers)
    node_readings = client.get("/nodes/NODE-A/readings", headers=headers)
    for result in (all_readings, node_readings):
        assert result.status_code == 200
        record = next(item for item in result.json()["items"] if item["id"] == reading_id)
        assert record["validation_status"] == "INVALID"
        assert record["confidence"] == 0.1
        assert record["validation_reason"] == "outside engineering range"
        assert "credential_hash" not in result.text
        assert all(secret not in result.text for secret in NODE_CREDENTIALS.values())


def test_sqlite_migration_adds_reason_column_and_is_idempotent():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    with engine.begin() as connection:
        connection.execute(text(
            "CREATE TABLE sensor_readings "
            "(id INTEGER PRIMARY KEY, validation_status VARCHAR)"
        ))
        connection.execute(text(
            "INSERT INTO sensor_readings (id, validation_status) "
            "VALUES (1, 'NORMAL')"
        ))

    migrate_sensor_reading_integrity_schema(engine)
    migrate_sensor_reading_integrity_schema(engine)
    columns = {column["name"] for column in inspect(engine).get_columns("sensor_readings")}
    assert "validation_reason" in columns
    with engine.connect() as connection:
        reason = connection.execute(text(
            "SELECT validation_reason FROM sensor_readings WHERE id = 1"
        )).scalar_one()
    assert reason == "legacy reading; reason unavailable"
    engine.dispose()
