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
from models import ControlCommand, Node


CONTROL_TOKEN = "control-test-token"
ADMIN_TOKEN = "admin-test-token"
DEVICE_CREDENTIAL = "node-04-device-credential"
CREATE = "/api/v1/control/nodes/NODE-04/commands"
POLL = "/api/v1/device/nodes/NODE-04/commands/next"


@pytest.fixture
def control_api(monkeypatch):
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    enable_sqlite_foreign_keys(engine)
    main.Base.metadata.create_all(bind=engine)
    migrate_v2_location_network_schema(engine)
    sessions = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    def override_db():
        db = sessions()
        try:
            yield db
        finally:
            db.close()

    main.app.dependency_overrides[main.get_db] = override_db
    monkeypatch.setattr(main, "RASID_CONTROL_TOKEN", CONTROL_TOKEN)
    monkeypatch.setattr(main, "ADMIN_PROVISIONING_TOKEN", ADMIN_TOKEN)
    with sessions() as db:
        db.add_all([
            Node(
                node_id="NODE-04",
                credential_hash=main.password_hash.hash(DEVICE_CREDENTIAL),
                status="ACTIVE",
                connection_status="ONLINE",
                location_id="A1-1",
            ),
            Node(
                node_id="NODE-OTHER",
                credential_hash=main.password_hash.hash("other-device-credential"),
                status="ACTIVE",
                connection_status="ONLINE",
            ),
        ])
        db.commit()

    # HTTPS is deliberate: command endpoints reject HTTP even in tests.
    client = TestClient(main.app, base_url="https://testserver")
    yield client, sessions, engine
    client.close()
    main.app.dependency_overrides.clear()
    main.Base.metadata.drop_all(bind=engine)
    engine.dispose()


def control_headers():
    return {"X-Rasid-Control-Token": CONTROL_TOKEN}


def device_headers():
    return {"X-Device-Credential": DEVICE_CREDENTIAL}


def command_payload(*, state="ON", key="command-key-1", expires_in=30):
    return {
        "actuator_id": "RELAY-01",
        "requested_state": state,
        "expires_at": (datetime.now(timezone.utc) + timedelta(seconds=expires_in)).isoformat(),
        "idempotency_key": key,
    }


def create_command(client, **kwargs):
    response = client.post(CREATE, headers=control_headers(), json=command_payload(**kwargs))
    assert response.status_code == 200, response.text
    return response.json()


def test_command_issue_requires_distinct_control_identity_and_https(control_api):
    client, _, _ = control_api
    assert client.post(CREATE, json=command_payload()).status_code == 401
    assert client.post(CREATE, headers={"X-Rasid-Integration-Token": CONTROL_TOKEN}, json=command_payload()).status_code == 401
    assert client.post(CREATE, headers={"X-Admin-Token": ADMIN_TOKEN}, json=command_payload()).status_code == 401
    assert client.post(CREATE, headers=device_headers(), json=command_payload()).status_code == 401

    http_client = TestClient(main.app, base_url="http://testserver")
    try:
        assert http_client.post(CREATE, headers=control_headers(), json=command_payload()).status_code == 426
    finally:
        http_client.close()


def test_control_identity_fails_closed_when_unconfigured(control_api, monkeypatch):
    client, _, _ = control_api
    monkeypatch.setattr(main, "RASID_CONTROL_TOKEN", None)
    response = client.post(CREATE, headers=control_headers(), json=command_payload())
    assert response.status_code == 503
    assert CONTROL_TOKEN not in response.text


def test_command_is_node_bound_non_actuating_and_idempotent(control_api):
    client, sessions, _ = control_api
    created = create_command(client, key="same-command")
    assert created["node_id"] == "NODE-04"
    assert created["status"] == "PENDING"
    assert created["command_kind"] == "NON_ACTUATING"
    assert created["non_actuating"] is True
    assert "idempotency_key" not in created
    assert "credential" not in created

    same = client.post(CREATE, headers=control_headers(), json={
        **command_payload(key="same-command"),
        "expires_at": created["expires_at"],
    })
    assert same.status_code == 200
    assert same.json()["command_id"] == created["command_id"]
    with sessions() as db:
        assert db.query(ControlCommand).count() == 1

    conflict = client.post(CREATE, headers=control_headers(), json=command_payload(state="OFF", key="same-command"))
    assert conflict.status_code == 409
    assert client.post("/api/v1/control/nodes/NODE-03/commands", headers=control_headers(), json=command_payload(key="other")).status_code == 403


def test_polling_requires_bound_device_credential_and_redelivers_same_envelope(control_api):
    client, _, _ = control_api
    created = create_command(client)
    assert client.get(POLL).status_code == 422  # required device credential header
    assert client.get(POLL, headers={"X-Device-Credential": "wrong"}).status_code == 401

    http_client = TestClient(main.app, base_url="http://testserver")
    try:
        assert http_client.get(POLL, headers=device_headers()).status_code == 426
    finally:
        http_client.close()

    first = client.get(POLL, headers=device_headers())
    assert first.status_code == 200
    command = first.json()["command"]
    assert command["command_id"] == created["command_id"]
    assert command["non_actuating"] is True
    assert command["command_kind"] == "NON_ACTUATING"
    assert set(command) == {"command_id", "node_id", "actuator_id", "requested_state", "command_kind", "non_actuating", "expires_at"}

    duplicate_poll = client.get(POLL, headers=device_headers())
    assert duplicate_poll.status_code == 200
    assert duplicate_poll.json()["command"]["command_id"] == created["command_id"]


def test_acknowledgement_is_idempotent_and_does_not_claim_actuation(control_api):
    client, _, _ = control_api
    command_id = create_command(client)["command_id"]
    assert client.get(POLL, headers=device_headers()).status_code == 200
    ack_path = f"/api/v1/device/nodes/NODE-04/commands/{command_id}/acknowledgements"

    acknowledged = client.post(ack_path, headers=device_headers(), json={"disposition": "ACKNOWLEDGED"})
    assert acknowledged.status_code == 200
    payload = acknowledged.json()
    assert payload["status"] == "ACKNOWLEDGED"
    assert payload["acknowledged_at"] is not None
    assert payload["non_actuating"] is True
    assert "reported_relay_state" not in payload

    repeated = client.post(ack_path, headers=device_headers(), json={"disposition": "ACKNOWLEDGED"})
    assert repeated.status_code == 200
    assert repeated.json()["acknowledged_at"] == payload["acknowledged_at"]
    assert client.post(ack_path, headers=device_headers(), json={"disposition": "REJECTED", "reason_code": "NO"}).status_code == 409


def test_expired_commands_are_never_delivered_or_acknowledged(control_api):
    client, sessions, _ = control_api
    command_id = create_command(client, key="expire-me")["command_id"]
    with sessions() as db:
        command = db.query(ControlCommand).filter(ControlCommand.command_id == command_id).one()
        command.expires_at = datetime(2000, 1, 1)
        db.commit()

    polled = client.get(POLL, headers=device_headers())
    assert polled.status_code == 200
    assert polled.json() == {"command": None}
    ack_path = f"/api/v1/device/nodes/NODE-04/commands/{command_id}/acknowledgements"
    assert client.post(ack_path, headers=device_headers(), json={"disposition": "ACKNOWLEDGED"}).status_code == 409
    with sessions() as db:
        assert db.query(ControlCommand).filter(ControlCommand.command_id == command_id).one().status == "EXPIRED"


def test_revocation_rejects_open_commands_and_device_cannot_poll(control_api):
    client, sessions, _ = control_api
    command_id = create_command(client, key="revoke-me")["command_id"]
    revoked = client.post("/nodes/NODE-04/revoke", headers={"X-Admin-Token": ADMIN_TOKEN})
    assert revoked.status_code == 200
    assert client.get(POLL, headers=device_headers()).status_code == 403
    with sessions() as db:
        command = db.query(ControlCommand).filter(ControlCommand.command_id == command_id).one()
        assert command.status == "REJECTED"
        assert command.rejection_reason == "NODE_REVOKED"


def test_command_endpoint_rejects_invalid_shape_ttl_and_wrong_node_acknowledgement(control_api):
    client, _, _ = control_api
    assert client.post(CREATE, headers=control_headers(), json={**command_payload(), "unexpected": True}).status_code == 422
    assert client.post(CREATE, headers=control_headers(), json=command_payload(expires_in=91)).status_code == 422
    command_id = create_command(client, key="wrong-node-ack")["command_id"]
    wrong_node_path = f"/api/v1/device/nodes/NODE-03/commands/{command_id}/acknowledgements"
    assert client.post(wrong_node_path, headers=device_headers(), json={"disposition": "ACKNOWLEDGED"}).status_code == 403
