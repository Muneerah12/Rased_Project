import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import main
from database import enable_sqlite_foreign_keys, migrate_v2_location_network_schema
from models import Heartbeat, Node, SensorReading


ADMIN_TOKEN = "history-test-admin"


@pytest.fixture
def history_api(monkeypatch):
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
    now = datetime.now(timezone.utc)
    with sessions() as db:
        db.add_all([
            Node(node_id="NODE-A", credential_hash="not-used", status="ACTIVE", connection_status="OFFLINE"),
            Node(node_id="NODE-B", credential_hash="not-used", status="ACTIVE", connection_status="OFFLINE"),
        ])
        for offset, node_id, sensor_type in (
            (5, "NODE-A", "temperature"), (10, "NODE-A", "humidity"),
            (15, "NODE-B", "temperature"),
        ):
            db.add(SensorReading(
                node_id=node_id, sensor_id=f"S-{offset}", sensor_type=sensor_type,
                value=20.0 + offset, unit="C", timestamp=now - timedelta(minutes=offset),
                validation_status="UNKNOWN",
            ))
        for offset, node_id in ((5, "NODE-A"), (10, "NODE-A"), (15, "NODE-B")):
            db.add(Heartbeat(
                node_id=node_id, timestamp=now - timedelta(days=30),
                received_at=now - timedelta(minutes=offset),
            ))
        db.commit()
    client = TestClient(main.app)
    yield client
    client.close()
    main.app.dependency_overrides.clear()
    main.Base.metadata.drop_all(bind=engine)
    engine.dispose()


def admin():
    return {"X-Admin-Token": ADMIN_TOKEN}


def test_reading_filters_and_cursor_pagination(history_api):
    client = history_api
    response = client.get("/readings?node_id=NODE-A&sensor_type=temperature&limit=1", headers=admin())
    assert response.status_code == 200
    page = response.json()
    assert len(page["items"]) == 1
    assert page["items"][0]["node_id"] == "NODE-A"
    assert page["items"][0]["sensor_type"] == "temperature"
    assert page["next_cursor"] is None

    all_a = client.get("/readings?node_id=NODE-A&limit=1", headers=admin()).json()
    assert all_a["next_cursor"] is not None
    next_page = client.get(
        f"/readings?node_id=NODE-A&limit=1&cursor={all_a['next_cursor']}",
        headers=admin(),
    ).json()
    assert len(next_page["items"]) == 1
    assert next_page["items"][0]["id"] != all_a["items"][0]["id"]


def test_heartbeat_filters_use_server_received_at(history_api):
    client = history_api
    after = (datetime.now(timezone.utc) - timedelta(minutes=12)).isoformat()
    response = client.get("/heartbeats", params={"node_id": "NODE-A", "received_after": after}, headers=admin())
    assert response.status_code == 200
    items = response.json()["items"]
    assert len(items) == 2
    assert all(item["node_id"] == "NODE-A" for item in items)
    assert all(datetime.fromisoformat(item["timestamp"]) < datetime.fromisoformat(item["received_at"]) for item in items)


@pytest.mark.parametrize("path", [
    "/readings?start=2026-09-30T20:00:00",
    "/heartbeats?received_after=2026-09-30T20:00:00",
    "/readings?limit=501",
    "/heartbeats?cursor=invalid",
    "/heartbeats?cursor=W251bGwsMV0",
])
def test_history_filters_reject_naive_times_invalid_page_size_and_cursor(history_api, path):
    response = history_api.get(path, headers=admin())
    assert response.status_code == 422


def test_node_reading_route_accepts_filters(history_api):
    client = history_api
    response = client.get(
        "/nodes/NODE-A/readings?sensor_type=humidity&limit=10",
        headers=admin(),
    )
    assert response.status_code == 200
    assert len(response.json()["items"]) == 1
    assert response.json()["items"][0]["sensor_type"] == "humidity"
