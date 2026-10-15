from contextlib import asynccontextmanager
from datetime import datetime, timezone, timedelta
import asyncio
import base64
import binascii
import ipaddress
import json
import logging
import math
import os
from pathlib import Path
import re
import secrets
import uuid
from typing import Literal


from fastapi import FastAPI, Depends, Header, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import and_, or_
from sqlalchemy.orm import Session
from pwdlib import PasswordHash
from dotenv import load_dotenv

from database import (
    Base,
    engine,
    SessionLocal,
    migrate_control_command_schema,
    migrate_sensor_reading_integrity_schema,
    migrate_v2_location_network_schema,
)
from models import (
    Hall,
    Heartbeat as HeartbeatModel,
    ControlCommand,
    Node,
    ExternalTemperatureObservation,
    SensorReading as SensorReadingModel,
    Subzone,
    Zone,
)
from reading_integrity import validate_and_compare_reading


PROJECT_ROOT = Path(__file__).resolve().parent.parent
logger = logging.getLogger(__name__)


def load_admin_provisioning_token(env_file: Path | None = None) -> str | None:
    """Load the local project .env without overriding process configuration."""
    load_dotenv(env_file or PROJECT_ROOT / ".env", override=False)
    return os.getenv("ADMIN_PROVISIONING_TOKEN")


def load_rasid_integration_token(env_file: Path | None = None) -> str | None:
    """Load the server-only credential for Rasid's narrow read integration."""
    load_dotenv(env_file or PROJECT_ROOT / ".env", override=False)
    return os.getenv("RASID_INTEGRATION_TOKEN")


def load_rasid_control_token(env_file: Path | None = None) -> str | None:
    """Load the separate, server-only token for non-actuating control tests."""
    load_dotenv(env_file or PROJECT_ROOT / ".env", override=False)
    return os.getenv("RASID_CONTROL_TOKEN")


ADMIN_PROVISIONING_TOKEN = load_admin_provisioning_token()
RASID_INTEGRATION_TOKEN = load_rasid_integration_token()
RASID_CONTROL_TOKEN = load_rasid_control_token()


def utc_api_datetime(value: datetime | None) -> datetime | None:
    """Return a datetime with an explicit UTC timezone for API responses."""
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def utc_database_datetime(value: datetime | None) -> datetime | None:
    """Normalize aware API values to UTC for SQLite's naive UTC columns."""
    if value is None:
        return None
    normalized = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    return normalized.astimezone(timezone.utc).replace(tzinfo=None)


def encode_cursor(value: datetime, row_id: int) -> str:
    payload = json.dumps([utc_api_datetime(value).isoformat(), row_id]).encode()
    return base64.urlsafe_b64encode(payload).decode().rstrip("=")


def decode_cursor(cursor: str | None) -> tuple[datetime, int] | None:
    if cursor is None:
        return None
    try:
        encoded = cursor + "=" * (-len(cursor) % 4)
        timestamp, row_id = json.loads(base64.urlsafe_b64decode(encoded))
        if not isinstance(timestamp, str):
            raise ValueError
        parsed = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
        if parsed.tzinfo is None or not isinstance(row_id, int) or row_id < 1:
            raise ValueError
        return utc_database_datetime(parsed), row_id
    except (ValueError, TypeError, json.JSONDecodeError, binascii.Error, AttributeError):
        raise HTTPException(status_code=422, detail="Invalid pagination cursor")


def require_aware_filter(value: datetime | None, name: str) -> datetime | None:
    if value is not None and value.tzinfo is None:
        raise HTTPException(
            status_code=422,
            detail=f"{name} must include a timezone offset",
        )
    return utc_database_datetime(value)


def page_response(rows, limit: int, timestamp_field: str) -> dict:
    has_more = len(rows) > limit
    items = rows[:limit]
    next_cursor = None
    if has_more and items:
        last = items[-1]
        next_cursor = encode_cursor(getattr(last, timestamp_field), last.id)
    return {"items": items, "next_cursor": next_cursor}


def apply_history_cursor(query, timestamp_column, id_column, cursor_value):
    if cursor_value is None:
        return query
    cursor_time, cursor_id = cursor_value
    return query.filter(or_(
        timestamp_column < cursor_time,
        and_(timestamp_column == cursor_time, id_column < cursor_id),
    ))


def serialize_location(subzone: Subzone, hall: Hall, zone: Zone) -> dict:
    return {
        "location_id": subzone.code,
        "zone": zone.code,
        "hall": hall.code,
        "subzone": subzone.code,
        "deployment_status": subzone.deployment_status,
    }


@asynccontextmanager
async def lifespan(app: FastAPI):
    if not ADMIN_PROVISIONING_TOKEN or not ADMIN_PROVISIONING_TOKEN.strip():
        raise RuntimeError(
            "ADMIN_PROVISIONING_TOKEN is required; set it in the process "
            "environment or project-root .env file."
        )

    health_task = asyncio.create_task(monitor_node_health())

    yield

    health_task.cancel()

    try:
        await health_task
    except asyncio.CancelledError:
        pass


app = FastAPI(lifespan=lifespan)

password_hash = PasswordHash.recommended()

# Create database tables
Base.metadata.create_all(bind=engine)
migrate_sensor_reading_integrity_schema(engine)
migrate_v2_location_network_schema(engine)
migrate_control_command_schema(engine)


# UTC timestamp validation
FUTURE_TIMESTAMP_TOLERANCE = timedelta(seconds=5)


class UTCTimestampModel(BaseModel):
    timestamp: datetime

    @field_validator("timestamp")
    @classmethod
    def validate_timestamp(cls, value: datetime):
        if value.tzinfo is None:
            raise ValueError(
                "Timestamp must include timezone information"
            )

        value = value.astimezone(timezone.utc)

        now = datetime.now(timezone.utc)

        if value > now + FUTURE_TIMESTAMP_TOLERANCE:
            raise ValueError(
                "Timestamp cannot be in the future"
            )

        return value


class SensorReading(UTCTimestampModel):
    node_id: str
    sensor_id: str
    sensor_type: str
    value: float
    unit: str


class Heartbeat(UTCTimestampModel):
    node_id: str
    reported_ip: ipaddress.IPv4Address | ipaddress.IPv6Address | None = None
    reported_mac: str | None = None
    reported_rssi_dbm: int | None = None
    reported_ssid: str | None = Field(default=None, max_length=64)
    reported_bssid: str | None = None
    reported_wifi_channel: int | None = None
    reported_gateway: ipaddress.IPv4Address | None = None
    reported_subnet_mask: ipaddress.IPv4Address | None = None
    reported_relay_state: Literal["ON", "OFF"] | None = None

    @field_validator("reported_mac")
    @classmethod
    def validate_reported_mac(cls, value: str | None):
        if value is not None and not re.fullmatch(
            r"(?:[0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}", value
        ):
            raise ValueError("reported_mac must be a colon-separated MAC address")
        return value

    @field_validator("reported_bssid")
    @classmethod
    def validate_reported_bssid(cls, value: str | None):
        if value is not None and not re.fullmatch(
            r"(?:[0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}", value
        ):
            raise ValueError("reported_bssid must be a colon-separated MAC address")
        return value

    @field_validator("reported_wifi_channel")
    @classmethod
    def validate_reported_wifi_channel(cls, value: int | None):
        if value is not None and not 1 <= value <= 14:
            raise ValueError("reported_wifi_channel must be between 1 and 14")
        return value

    @field_validator("reported_rssi_dbm")
    @classmethod
    def validate_reported_rssi(cls, value: int | None):
        if value is not None and not -127 <= value <= 0:
            raise ValueError("reported_rssi_dbm must be between -127 and 0")
        return value


class NodeRegistration(BaseModel):
    node_id: str


class NodeLocationAssignment(BaseModel):
    location_id: str | None


class NonActuatingCommandRequest(BaseModel):
    """The only command shape Phase 1B permits to enter the ledger."""

    model_config = ConfigDict(extra="forbid")

    actuator_id: Literal["RELAY-01"]
    requested_state: Literal["ON", "OFF"]
    expires_at: datetime
    idempotency_key: str = Field(min_length=1, max_length=128)

    @field_validator("expires_at")
    @classmethod
    def validate_expiry(cls, value: datetime):
        if value.tzinfo is None:
            raise ValueError("expires_at must include timezone information")
        normalized = value.astimezone(timezone.utc)
        if normalized <= datetime.now(timezone.utc):
            raise ValueError("expires_at must be in the future")
        return normalized


class DeviceCommandAcknowledgement(BaseModel):
    model_config = ConfigDict(extra="forbid")
    disposition: Literal["ACKNOWLEDGED", "REJECTED"]
    reason_code: str | None = Field(default=None, min_length=1, max_length=80)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def authenticate_node(
    node_id: str,
    device_credential: str,
    db: Session

):


    node = db.query(Node).filter(
        Node.node_id == node_id
    ).first()

    if node is None:
        raise HTTPException(
            status_code=401,
            detail="Invalid node credentials"
        )

    if node.status != "ACTIVE":
        raise HTTPException(
            status_code=403,
            detail="Node is not active"
        )

    if not password_hash.verify(
        device_credential,
        node.credential_hash
    ):
        raise HTTPException(
            status_code=401,
            detail="Invalid node credentials"
        )

    return node


def require_admin_token(x_admin_token: str | None) -> None:
    """Enforce the existing shared admin credential for protected routes."""
    if not ADMIN_PROVISIONING_TOKEN:
        raise HTTPException(
            status_code=500,
            detail="Admin provisioning token is not configured"
        )

    if x_admin_token != ADMIN_PROVISIONING_TOKEN:
        raise HTTPException(
            status_code=401,
            detail="Invalid admin provisioning token"
        )


def calculate_connection_status(last_seen: datetime) -> str:
    now = datetime.now(timezone.utc)

    if last_seen.tzinfo is None:
        last_seen = last_seen.replace(tzinfo=timezone.utc)

    elapsed = now - last_seen

    if elapsed <= timedelta(seconds=30):
        return "ONLINE"

    if elapsed <= timedelta(seconds=90):
        return "STALE"

    return "OFFLINE"


# Temporary integration policy. Keep these checks separate from the shared
# admin helper so a scoped service identity can replace them independently.
INTEGRATION_NODE_ALLOWLIST = frozenset({"NODE-04"})
INTEGRATION_STATE_READING_LIMIT = 10
INTEGRATION_HEARTBEAT_LIMIT = 50
INTEGRATION_READING_HISTORY_LIMIT = 200
INTEGRATION_READING_HISTORY_MAX_RANGE = timedelta(days=7)
INTEGRATION_HISTORY_SENSORS = {
    "TEMP-01": "temperature",
    "HUM-01": "humidity",
    "PRESS-01": "pressure",
}
CONTROL_NODE_ALLOWLIST = frozenset({"NODE-04"})
CONTROL_ACTUATOR_ID = "RELAY-01"
CONTROL_COMMAND_MAX_TTL = timedelta(seconds=90)


def authorize_integration_read(x_rasid_integration_token: str | None) -> None:
    """Authorize only Rasid's read-only integration identity."""
    if not RASID_INTEGRATION_TOKEN or not RASID_INTEGRATION_TOKEN.strip():
        raise HTTPException(
            status_code=503,
            detail="Integration identity is not configured",
        )
    if not x_rasid_integration_token or not secrets.compare_digest(
        x_rasid_integration_token,
        RASID_INTEGRATION_TOKEN,
    ):
        raise HTTPException(
            status_code=401,
            detail="Invalid integration credentials",
        )


def authorize_control_service(x_rasid_control_token: str | None) -> None:
    """Authorize the separate server-only control identity, never a browser."""
    if not RASID_CONTROL_TOKEN or not RASID_CONTROL_TOKEN.strip():
        raise HTTPException(status_code=503, detail="Control identity is not configured")
    if not x_rasid_control_token or not secrets.compare_digest(
        x_rasid_control_token, RASID_CONTROL_TOKEN
    ):
        raise HTTPException(status_code=401, detail="Invalid control credentials")


def require_verified_command_tls(request: Request) -> None:
    """Fail closed unless this command endpoint itself is served as HTTPS.

    Phase 1B has no proxy-trust configuration, so forwarded headers are
    deliberately not accepted as proof of TLS.  A deployment that terminates
    TLS upstream must add an explicitly trusted proxy configuration first.
    """
    if request.url.scheme != "https":
        raise HTTPException(status_code=426, detail="Command transport requires HTTPS")


def expire_due_control_commands(db: Session, node_id: str, now: datetime) -> None:
    """Terminally expire undelivered or unacknowledged commands for one node."""
    candidates = db.query(ControlCommand).filter(
        ControlCommand.node_id == node_id,
        ControlCommand.status.in_(("PENDING", "DELIVERED")),
    ).all()
    # SQLite returns naive UTC datetimes, while tests and future database
    # backends may return aware values. Compare normalized instants in Python
    # so an expired envelope can never be delivered because of representation.
    changed = False
    for command in candidates:
        expires_at = utc_api_datetime(command.expires_at)
        if expires_at is not None and expires_at <= now:
            command.status = "EXPIRED"
            command.expired_at = utc_database_datetime(now)
            changed = True
    if changed:
        # SessionLocal intentionally disables autoflush. Persist state changes
        # before the polling/acknowledgement query can select an old PENDING
        # row or before refresh() could discard an expiry transition.
        db.flush()


def reject_open_control_commands(db: Session, node_id: str, reason: str, now: datetime) -> None:
    """Invalidate any command envelope when its device is revoked."""
    open_commands = db.query(ControlCommand).filter(
        ControlCommand.node_id == node_id,
        ControlCommand.status.in_(("PENDING", "DELIVERED")),
    ).all()
    for command in open_commands:
        command.status = "REJECTED"
        command.rejected_at = utc_database_datetime(now)
        command.rejection_reason = reason


def serialize_device_command(command: ControlCommand) -> dict:
    """Return only the non-actuating envelope an authenticated device needs."""
    return {
        "command_id": command.command_id,
        "node_id": command.node_id,
        "actuator_id": command.actuator_id,
        "requested_state": command.requested_state,
        "command_kind": command.command_kind,
        "non_actuating": True,
        "expires_at": utc_api_datetime(command.expires_at),
    }


def serialize_control_command(command: ControlCommand) -> dict:
    """Return the control-lifecycle record without any credential material."""
    return {
        "command_id": command.command_id,
        "node_id": command.node_id,
        "actuator_id": command.actuator_id,
        "requested_state": command.requested_state,
        "command_kind": command.command_kind,
        "non_actuating": True,
        "status": command.status,
        "created_at": utc_api_datetime(command.created_at),
        "expires_at": utc_api_datetime(command.expires_at),
        "delivered_at": utc_api_datetime(command.delivered_at),
        "acknowledged_at": utc_api_datetime(command.acknowledged_at),
        "expired_at": utc_api_datetime(command.expired_at),
        "rejected_at": utc_api_datetime(command.rejected_at),
        "rejection_reason": command.rejection_reason,
    }


def calculate_integration_connection_status(
    node_status: str,
    last_received_at: datetime | None,
    as_of: datetime,
) -> str:
    """Calculate live status without changing the persisted Node record."""
    if node_status != "ACTIVE" or last_received_at is None:
        return "OFFLINE"

    received_at = utc_api_datetime(last_received_at)
    elapsed = as_of - received_at
    if elapsed <= timedelta(seconds=30):
        return "ONLINE"
    if elapsed <= timedelta(seconds=90):
        return "STALE"
    return "OFFLINE"


@app.get("/api/v1/integration/nodes/{node_id}/state")
def get_integration_node_state(
    node_id: str,
    db: Session = Depends(get_db),
    x_rasid_integration_token: str | None = Header(default=None),
):
    authorize_integration_read(x_rasid_integration_token)

    if not re.fullmatch(r"[A-Z0-9][A-Z0-9_-]{0,63}", node_id):
        raise HTTPException(status_code=422, detail="Invalid node identifier")
    if node_id not in INTEGRATION_NODE_ALLOWLIST:
        raise HTTPException(status_code=403, detail="Node is not allowed")

    try:
        node = db.query(Node).filter(Node.node_id == node_id).first()
        if node is None:
            raise HTTPException(status_code=404, detail="Node not found")

        rows = (
            db.query(SensorReadingModel)
            .filter(SensorReadingModel.node_id == node_id)
            .order_by(SensorReadingModel.timestamp.desc(), SensorReadingModel.id.desc())
            .limit(INTEGRATION_STATE_READING_LIMIT)
            .all()
        )
        latest_heartbeat = (
            db.query(HeartbeatModel)
            .filter(HeartbeatModel.node_id == node_id)
            .order_by(HeartbeatModel.received_at.desc(), HeartbeatModel.id.desc())
            .first()
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Integration state read failed")
        raise HTTPException(
            status_code=503,
            detail="Integration state is temporarily unavailable",
        ) from exc

    as_of = datetime.now(timezone.utc)
    return {
        "node_id": node.node_id,
        "status": node.status,
        "connection_status": calculate_integration_connection_status(
            node.status, node.last_heartbeat_received_at, as_of
        ),
        "location_id": node.location_id,
        "last_heartbeat_received_at": utc_api_datetime(node.last_heartbeat_received_at),
        # Both values are from one latest persisted receipt record. Do not
        # fall back to an earlier relay report when the latest omits it.
        "reported_relay_state": latest_heartbeat.reported_relay_state if latest_heartbeat else None,
        "relay_reported_at": utc_api_datetime(latest_heartbeat.received_at)
        if latest_heartbeat and latest_heartbeat.reported_relay_state is not None
        else None,
        # Network values are nullable, device-reported observations from this
        # exact latest receipt record. Do not search older heartbeats for a
        # value: that would misstate the provenance and freshness of the data.
        "network_observation": {
            "reported_ip": latest_heartbeat.reported_ip if latest_heartbeat else None,
            "reported_mac": latest_heartbeat.reported_mac if latest_heartbeat else None,
            "reported_rssi_dbm": latest_heartbeat.reported_rssi_dbm if latest_heartbeat else None,
            "reported_ssid": latest_heartbeat.reported_ssid if latest_heartbeat else None,
            "reported_bssid": latest_heartbeat.reported_bssid if latest_heartbeat else None,
            "reported_wifi_channel": latest_heartbeat.reported_wifi_channel if latest_heartbeat else None,
            "reported_gateway": latest_heartbeat.reported_gateway if latest_heartbeat else None,
            "reported_subnet_mask": latest_heartbeat.reported_subnet_mask if latest_heartbeat else None,
            "reported_at": utc_api_datetime(latest_heartbeat.received_at) if latest_heartbeat else None,
        },
        "as_of": as_of,
        "readings": [
            {
                "sensor_id": reading.sensor_id,
                "sensor_type": reading.sensor_type,
                "value": reading.value,
                "unit": reading.unit,
                "timestamp": utc_api_datetime(reading.timestamp),
                "validation_status": reading.validation_status,
            }
            for reading in rows
        ],
    }


@app.get("/api/v1/integration/nodes/{node_id}/heartbeats")
def get_integration_node_heartbeats(
    node_id: str,
    limit: int = Query(default=INTEGRATION_HEARTBEAT_LIMIT, ge=1, le=INTEGRATION_HEARTBEAT_LIMIT),
    db: Session = Depends(get_db),
    x_rasid_integration_token: str | None = Header(default=None),
):
    """Return a bounded, receipt-time heartbeat history for the allowed node."""
    authorize_integration_read(x_rasid_integration_token)

    if not re.fullmatch(r"[A-Z0-9][A-Z0-9_-]{0,63}", node_id):
        raise HTTPException(status_code=422, detail="Invalid node identifier")
    if node_id not in INTEGRATION_NODE_ALLOWLIST:
        raise HTTPException(status_code=403, detail="Node is not allowed")

    try:
        node_exists = db.query(Node.id).filter(Node.node_id == node_id).first()
        if node_exists is None:
            raise HTTPException(status_code=404, detail="Node not found")
        rows = (
            db.query(HeartbeatModel)
            .filter(HeartbeatModel.node_id == node_id)
            .order_by(HeartbeatModel.received_at.desc(), HeartbeatModel.id.desc())
            .limit(limit)
            .all()
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Integration heartbeat history read failed")
        raise HTTPException(
            status_code=503,
            detail="Integration heartbeat history is temporarily unavailable",
        ) from exc

    return {
        "node_id": node_id,
        "as_of": datetime.now(timezone.utc),
        "items": [{"received_at": utc_api_datetime(row.received_at)} for row in rows],
    }


@app.get("/api/v1/integration/nodes/{node_id}/readings")
def get_integration_node_readings(
    node_id: str,
    sensor_id: str,
    start: datetime,
    end: datetime,
    limit: int = Query(default=100, ge=1, le=INTEGRATION_READING_HISTORY_LIMIT),
    cursor: str | None = None,
    db: Session = Depends(get_db),
    x_rasid_integration_token: str | None = Header(default=None),
):
    """Return bounded, least-privilege historical readings for RASID only."""
    authorize_integration_read(x_rasid_integration_token)

    if not re.fullmatch(r"[A-Z0-9][A-Z0-9_-]{0,63}", node_id):
        raise HTTPException(status_code=422, detail="Invalid node identifier")
    if node_id not in INTEGRATION_NODE_ALLOWLIST:
        raise HTTPException(status_code=403, detail="Node is not allowed")
    if sensor_id not in INTEGRATION_HISTORY_SENSORS:
        raise HTTPException(status_code=422, detail="Invalid sensor identifier")

    lower = require_aware_filter(start, "start")
    upper = require_aware_filter(end, "end")
    if lower is None or upper is None or lower >= upper or upper - lower > INTEGRATION_READING_HISTORY_MAX_RANGE:
        raise HTTPException(status_code=422, detail="Invalid reading history range")
    cursor_value = decode_cursor(cursor)

    try:
        node_exists = db.query(Node.id).filter(Node.node_id == node_id).first()
        if node_exists is None:
            raise HTTPException(status_code=404, detail="Node not found")
        rows = apply_history_cursor(
            db.query(SensorReadingModel).filter(
                SensorReadingModel.node_id == node_id,
                SensorReadingModel.sensor_id == sensor_id,
                SensorReadingModel.sensor_type == INTEGRATION_HISTORY_SENSORS[sensor_id],
                SensorReadingModel.timestamp >= lower,
                SensorReadingModel.timestamp < upper,
            ),
            SensorReadingModel.timestamp,
            SensorReadingModel.id,
            cursor_value,
        ).order_by(
            SensorReadingModel.timestamp.desc(), SensorReadingModel.id.desc()
        ).limit(limit + 1).all()
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Integration reading history read failed")
        raise HTTPException(
            status_code=503,
            detail="Integration reading history is temporarily unavailable",
        ) from exc

    page = page_response(rows, limit, "timestamp")
    return {
        "node_id": node_id,
        "sensor_id": sensor_id,
        "sensor_type": INTEGRATION_HISTORY_SENSORS[sensor_id],
        "start": utc_api_datetime(lower),
        "end": utc_api_datetime(upper),
        "as_of": datetime.now(timezone.utc),
        "items": [
            {
                "sensor_id": reading.sensor_id,
                "sensor_type": reading.sensor_type,
                "value": reading.value,
                "unit": reading.unit,
                "timestamp": utc_api_datetime(reading.timestamp),
                "validation_status": reading.validation_status,
            }
            for reading in page["items"]
        ],
        "next_cursor": page["next_cursor"],
    }


@app.post("/api/v1/control/nodes/{node_id}/commands")
def create_non_actuating_control_command(
    node_id: str,
    command: NonActuatingCommandRequest,
    request: Request,
    db: Session = Depends(get_db),
    x_rasid_control_token: str | None = Header(default=None),
):
    """Create a device-bound envelope only; Phase 1B never actuates hardware."""
    require_verified_command_tls(request)
    authorize_control_service(x_rasid_control_token)
    if node_id not in CONTROL_NODE_ALLOWLIST:
        raise HTTPException(status_code=403, detail="Node is not allowed for control")

    now = datetime.now(timezone.utc)
    expires_at = utc_database_datetime(command.expires_at)
    if expires_at - utc_database_datetime(now) > CONTROL_COMMAND_MAX_TTL:
        raise HTTPException(status_code=422, detail="Command expiry exceeds maximum lifetime")

    node = db.query(Node).filter(Node.node_id == node_id).first()
    if node is None:
        raise HTTPException(status_code=404, detail="Node not found")
    if node.status != "ACTIVE":
        raise HTTPException(status_code=409, detail="Node is not active")

    existing = db.query(ControlCommand).filter(
        ControlCommand.idempotency_key == command.idempotency_key
    ).first()
    if existing is not None:
        same_request = (
            existing.node_id == node_id
            and existing.actuator_id == command.actuator_id
            and existing.requested_state == command.requested_state
            and existing.expires_at == expires_at
        )
        if not same_request:
            raise HTTPException(status_code=409, detail="Idempotency key conflicts with an existing command")
        return serialize_control_command(existing)

    record = ControlCommand(
        command_id=str(uuid.uuid4()),
        idempotency_key=command.idempotency_key,
        node_id=node_id,
        actuator_id=command.actuator_id,
        requested_state=command.requested_state,
        command_kind="NON_ACTUATING",
        status="PENDING",
        created_at=utc_database_datetime(now),
        expires_at=expires_at,
        issued_by="RASID_CONTROL_SERVICE",
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return serialize_control_command(record)


@app.get("/api/v1/device/nodes/{node_id}/commands/next")
def poll_next_non_actuating_command(
    node_id: str,
    request: Request,
    device_credential: str = Header(..., alias="X-Device-Credential"),
    db: Session = Depends(get_db),
):
    """Device-initiated HTTPS polling; returns no GPIO-executable command."""
    require_verified_command_tls(request)
    if node_id not in CONTROL_NODE_ALLOWLIST:
        raise HTTPException(status_code=403, detail="Node is not allowed for control")
    authenticate_node(node_id, device_credential, db)

    now = datetime.now(timezone.utc)
    expire_due_control_commands(db, node_id, now)
    command = db.query(ControlCommand).filter(
        ControlCommand.node_id == node_id,
        ControlCommand.status == "DELIVERED",
    ).order_by(ControlCommand.delivered_at.asc(), ControlCommand.id.asc()).first()
    if command is None:
        command = db.query(ControlCommand).filter(
            ControlCommand.node_id == node_id,
            ControlCommand.status == "PENDING",
        ).order_by(ControlCommand.created_at.asc(), ControlCommand.id.asc()).first()
        if command is not None:
            command.status = "DELIVERED"
            command.delivered_at = utc_database_datetime(now)

    db.commit()
    if command is None:
        return {"command": None}
    db.refresh(command)
    return {"command": serialize_device_command(command)}


@app.post("/api/v1/device/nodes/{node_id}/commands/{command_id}/acknowledgements")
def acknowledge_non_actuating_command(
    node_id: str,
    command_id: str,
    acknowledgement: DeviceCommandAcknowledgement,
    request: Request,
    device_credential: str = Header(..., alias="X-Device-Credential"),
    db: Session = Depends(get_db),
):
    """Persist a device acknowledgement; it is not a relay-state report."""
    require_verified_command_tls(request)
    if node_id not in CONTROL_NODE_ALLOWLIST:
        raise HTTPException(status_code=403, detail="Node is not allowed for control")
    authenticate_node(node_id, device_credential, db)

    command = db.query(ControlCommand).filter(
        ControlCommand.command_id == command_id,
        ControlCommand.node_id == node_id,
    ).first()
    if command is None:
        raise HTTPException(status_code=404, detail="Command not found")

    now = datetime.now(timezone.utc)
    expire_due_control_commands(db, node_id, now)
    db.refresh(command)
    if command.status == "EXPIRED":
        db.commit()
        raise HTTPException(status_code=409, detail="Command has expired")

    if command.status in ("ACKNOWLEDGED", "REJECTED"):
        if command.status == acknowledgement.disposition:
            return serialize_control_command(command)
        raise HTTPException(status_code=409, detail="Command already has a terminal acknowledgement")
    if command.status != "DELIVERED":
        raise HTTPException(status_code=409, detail="Command has not been delivered")

    if acknowledgement.disposition == "ACKNOWLEDGED":
        command.status = "ACKNOWLEDGED"
        command.acknowledged_at = utc_database_datetime(now)
    else:
        command.status = "REJECTED"
        command.rejected_at = utc_database_datetime(now)
        command.rejection_reason = acknowledgement.reason_code or "DEVICE_REJECTED"
    db.commit()
    db.refresh(command)
    return serialize_control_command(command)

async def monitor_node_health():
    while True:
        db = None

        try:
            db = SessionLocal()
            nodes = db.query(Node).all()

            for node in nodes:
                if node.status != "ACTIVE" or node.last_heartbeat_received_at is None:
                    node.connection_status = "OFFLINE"
                else:
                    node.connection_status = calculate_connection_status(
                        node.last_heartbeat_received_at
                    )

            db.commit()
        except Exception:
            if db is not None:
                try:
                    db.rollback()
                except Exception:
                    logger.exception("Node health monitor rollback failed")
            logger.exception("Node health monitor cycle failed")

        finally:
            if db is not None:
                try:
                    db.close()
                except Exception:
                    logger.exception("Node health monitor session close failed")

        await asyncio.sleep(10)
@app.get("/")
def root():
    return {"message": "CPS Backend is running"}


@app.post("/readings")
def receive_reading(
    reading: SensorReading,
    device_credential: str = Header(
        ...,
        alias="X-Device-Credential"
    ),
    db: Session = Depends(get_db)
):
    node = authenticate_node(
        reading.node_id,
        device_credential,
        db
    )

    if not math.isfinite(reading.value):
        raise HTTPException(
            status_code=422,
            detail="Sensor value must be finite",
        )

    # Device authentication establishes the node; integrity then evaluates
    # the authenticated node's reading independently of that identity check.
    assessment = validate_and_compare_reading(
        db,
        node_id=node.node_id,
        sensor_id=reading.sensor_id,
        sensor_type=reading.sensor_type,
        value=reading.value,
        unit=reading.unit,
        timestamp=reading.timestamp,
    )

    db_reading = SensorReadingModel(
        node_id=node.node_id,
        location_id=node.location_id,
        sensor_id=reading.sensor_id,
        sensor_type=reading.sensor_type,
        value=reading.value,
        unit=reading.unit,
        timestamp=reading.timestamp,
        validation_status=assessment.status,
        confidence=assessment.confidence,
        validation_reason=assessment.reason,
    )

    db.add(db_reading)
    db.commit()
    db.refresh(db_reading)

    return {
        "message": "Reading stored successfully",
        "reading_id": db_reading.id,
        "validation_status": db_reading.validation_status,
        "confidence": db_reading.confidence,
        "validation_reason": db_reading.validation_reason,
    }

@app.post("/nodes")
def register_node(
    registration: NodeRegistration,
    db: Session = Depends(get_db),
    x_admin_token: str | None = Header(default=None)
):
    if not ADMIN_PROVISIONING_TOKEN:
        raise HTTPException(
            status_code=500,
            detail="Admin provisioning token is not configured"
        )

    if x_admin_token != ADMIN_PROVISIONING_TOKEN:
        raise HTTPException(
            status_code=401,
            detail="Invalid admin provisioning token"
        )

    existing_node = db.query(Node).filter(
        Node.node_id == registration.node_id
    ).first()

    if existing_node is not None:
        raise HTTPException(
            status_code=409,
            detail="Node already registered"
        )

    # Generate a strong random credential for the device
    credential = secrets.token_urlsafe(32)

    # Store only the Argon2id verifier
    credential_hash = password_hash.hash(credential)

    node = Node(
        node_id=registration.node_id,
        credential_hash=credential_hash,
        status="ACTIVE",
        connection_status="OFFLINE",
        last_seen=None,
        provisioned_at=datetime.now(timezone.utc),
        revoked_at=None
    )

    db.add(node)
    db.commit()
    db.refresh(node)

    return {
    "message": "Node registered successfully",
    "node_id": node.node_id,
    "status": node.status,
    "connection_status": node.connection_status,
    "registered_at": utc_api_datetime(node.provisioned_at),
    "credential": credential
}


@app.get("/nodes/{node_id}")
def get_node(
    node_id: str,
    db: Session = Depends(get_db),
    x_admin_token: str | None = Header(default=None)
):
    # Verify admin provisioning token is configured
    if not ADMIN_PROVISIONING_TOKEN:
        raise HTTPException(
            status_code=500,
            detail="Admin provisioning token is not configured"
        )

    # Authenticate administrator
    if x_admin_token != ADMIN_PROVISIONING_TOKEN:
        raise HTTPException(
            status_code=401,
            detail="Invalid admin provisioning token"
        )

    # Find node
    node = db.query(Node).filter(
        Node.node_id == node_id
    ).first()

    if node is None:
        raise HTTPException(
            status_code=404,
            detail="Node not found"
        )

    # Recalculate current connection status
    if node.status != "ACTIVE" or node.last_heartbeat_received_at is None:
        node.connection_status = "OFFLINE"
    else:
        node.connection_status = calculate_connection_status(
            node.last_heartbeat_received_at
        )
    if node.status == "REVOKED":
        node.connection_status = "OFFLINE"
    db.commit()
    db.refresh(node)

    return {
        "node_id": node.node_id,
        "status": node.status,
        "connection_status": node.connection_status,
        "last_seen": utc_api_datetime(node.last_seen),
        "last_heartbeat_received_at": utc_api_datetime(node.last_heartbeat_received_at),
        "location_id": node.location_id,
        "registered_at": utc_api_datetime(node.provisioned_at),
        "revoked_at": utc_api_datetime(node.revoked_at)
    }


@app.get("/locations")
def get_locations(
    db: Session = Depends(get_db),
    x_admin_token: str | None = Header(default=None),
):
    require_admin_token(x_admin_token)
    rows = db.query(Subzone, Hall, Zone).join(
        Hall, Subzone.hall_code == Hall.code
    ).join(Zone, Hall.zone_code == Zone.code).order_by(
        Zone.code, Hall.code, Subzone.code
    ).all()
    return [serialize_location(subzone, hall, zone) for subzone, hall, zone in rows]


@app.get("/weather/external-temperature")
def get_external_temperature(
    db: Session = Depends(get_db),
    x_admin_token: str | None = Header(default=None),
):
    """Return the latest stored observation, or an explicit unconfigured state."""
    require_admin_token(x_admin_token)
    observation = db.query(ExternalTemperatureObservation).order_by(
        ExternalTemperatureObservation.retrieved_at.desc(),
        ExternalTemperatureObservation.id.desc(),
    ).first()
    if observation is None:
        return {"status": "UNCONFIGURED", "observation": None}
    return {
        "status": observation.status,
        "observation": {
            "provider": observation.provider,
            "site_id": observation.site_id,
            "observed_at": utc_api_datetime(observation.observed_at),
            "retrieved_at": utc_api_datetime(observation.retrieved_at),
            "value": observation.value,
            "unit": observation.unit,
            "status": observation.status,
            "error_code": observation.error_code,
        },
    }


@app.get("/locations/{location_id}")
def get_location(
    location_id: str,
    db: Session = Depends(get_db),
    x_admin_token: str | None = Header(default=None),
):
    require_admin_token(x_admin_token)
    row = db.query(Subzone, Hall, Zone).join(
        Hall, Subzone.hall_code == Hall.code
    ).join(Zone, Hall.zone_code == Zone.code).filter(
        Subzone.code == location_id
    ).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Location not found")
    return serialize_location(*row)


@app.put("/nodes/{node_id}/location")
def assign_node_location(
    node_id: str,
    assignment: NodeLocationAssignment,
    db: Session = Depends(get_db),
    x_admin_token: str | None = Header(default=None),
):
    require_admin_token(x_admin_token)
    node = db.query(Node).filter(Node.node_id == node_id).first()
    if node is None:
        raise HTTPException(status_code=404, detail="Node not found")
    if assignment.location_id is not None:
        location = db.query(Subzone).filter(
            Subzone.code == assignment.location_id
        ).first()
        if location is None:
            raise HTTPException(status_code=404, detail="Location not found")
        if location.deployment_status != "DEPLOYED":
            raise HTTPException(
                status_code=409,
                detail="Cannot assign a node to a location that is not deployed",
            )
    node.location_id = assignment.location_id
    db.commit()
    return {"node_id": node.node_id, "location_id": node.location_id}

@app.post("/nodes/{node_id}/revoke")
def revoke_node(
    node_id: str,
    db: Session = Depends(get_db),
    x_admin_token: str | None = Header(default=None)
):
    # Verify admin provisioning token is configured
    if not ADMIN_PROVISIONING_TOKEN:
        raise HTTPException(
            status_code=500,
            detail="Admin provisioning token is not configured"
        )

    # Authenticate administrator
    if x_admin_token != ADMIN_PROVISIONING_TOKEN:
        raise HTTPException(
            status_code=401,
            detail="Invalid admin provisioning token"
        )

    # Find node
    node = db.query(Node).filter(
        Node.node_id == node_id
    ).first()

    if node is None:
        raise HTTPException(
            status_code=404,
            detail="Node not found"
        )

    # Prevent duplicate revocation
    if node.status == "REVOKED":
        raise HTTPException(
            status_code=409,
            detail="Node is already revoked"
        )

    # Revoke node
    node.status = "REVOKED"
    node.connection_status = "OFFLINE"
    node.revoked_at = datetime.now(timezone.utc)
    reject_open_control_commands(
        db, node.node_id, "NODE_REVOKED", node.revoked_at
    )
    db.commit()
    db.refresh(node)

    return {
        "message": "Node revoked successfully",
        "node_id": node.node_id,
        "status": node.status,
        "connection_status": node.connection_status,
        "revoked_at": utc_api_datetime(node.revoked_at)
    }
@app.post("/nodes/{node_id}/reactivate")
def reactivate_node(
    node_id: str,
    db: Session = Depends(get_db),
    x_admin_token: str | None = Header(default=None)
):
    # Verify admin provisioning token is configured
    if not ADMIN_PROVISIONING_TOKEN:
        raise HTTPException(
            status_code=500,
            detail="Admin provisioning token is not configured"
        )

    # Authenticate administrator
    if x_admin_token != ADMIN_PROVISIONING_TOKEN:
        raise HTTPException(
            status_code=401,
            detail="Invalid admin provisioning token"
        )

    # Find node
    node = db.query(Node).filter(
        Node.node_id == node_id
    ).first()

    if node is None:
        raise HTTPException(
            status_code=404,
            detail="Node not found"
        )

    # Only revoked nodes can be reactivated
    if node.status != "REVOKED":
        raise HTTPException(
            status_code=409,
            detail="Node is not revoked"
        )

    # Generate a completely new credential
    new_credential = secrets.token_urlsafe(32)

    # Store only the new Argon2id verifier
    node.credential_hash = password_hash.hash(new_credential)

    # Reactivate node
    node.status = "ACTIVE"
    node.connection_status = "OFFLINE"
    node.last_heartbeat_received_at = None
    node.revoked_at = None

    db.commit()
    db.refresh(node)

    return {
        "message": "Node reactivated successfully",
        "node_id": node.node_id,
        "status": node.status,
        "connection_status": node.connection_status,
        "credential": new_credential
    }

@app.get("/nodes")
def get_nodes(
    db: Session = Depends(get_db),
    x_admin_token: str | None = Header(default=None)
):
    require_admin_token(x_admin_token)
    nodes = db.query(Node).all()

    for node in nodes:
        if node.status != "ACTIVE" or node.last_heartbeat_received_at is None:
            node.connection_status = "OFFLINE"
        else:
            node.connection_status = calculate_connection_status(
                node.last_heartbeat_received_at
            )
    db.commit()

    return [
        {
            "node_id": node.node_id,
            "status": node.status,
            "connection_status": node.connection_status,
            "last_seen": utc_api_datetime(node.last_seen),
            "last_heartbeat_received_at": utc_api_datetime(node.last_heartbeat_received_at),
            "location_id": node.location_id,
            "provisioned_at": utc_api_datetime(node.provisioned_at),
            "revoked_at": utc_api_datetime(node.revoked_at)
        }
        for node in nodes
    ]

@app.post("/heartbeat")
def receive_heartbeat(
    heartbeat: Heartbeat,
    device_credential: str = Header(..., alias="X-Device-Credential"),
    db: Session = Depends(get_db)
):
    node = authenticate_node(
        heartbeat.node_id,
        device_credential,
        db
    )

    # Keep the device clock value for diagnostics. Liveness uses server time.
    node.last_seen = heartbeat.timestamp
    received_at = datetime.now(timezone.utc)
    node.last_heartbeat_received_at = received_at
    node.connection_status = calculate_connection_status(received_at)

    heartbeat_record = HeartbeatModel(
        node_id=node.node_id,
        timestamp=heartbeat.timestamp,
        received_at=received_at,
        reported_ip=str(heartbeat.reported_ip) if heartbeat.reported_ip else None,
        reported_mac=heartbeat.reported_mac,
        reported_rssi_dbm=heartbeat.reported_rssi_dbm,
        reported_ssid=heartbeat.reported_ssid or None,
        reported_bssid=heartbeat.reported_bssid,
        reported_wifi_channel=heartbeat.reported_wifi_channel,
        reported_gateway=str(heartbeat.reported_gateway) if heartbeat.reported_gateway else None,
        reported_subnet_mask=str(heartbeat.reported_subnet_mask) if heartbeat.reported_subnet_mask else None,
        reported_relay_state=heartbeat.reported_relay_state,
    )

    db.add(heartbeat_record)
    db.commit()
    db.refresh(node)

    return {
        "message": "Heartbeat received",
        "node_id": node.node_id,
        "connection_status": node.connection_status,
        "last_seen": utc_api_datetime(node.last_seen),
        "last_heartbeat_received_at": utc_api_datetime(
            node.last_heartbeat_received_at
        ),
    }
@app.get("/heartbeats")
def get_heartbeats(
    db: Session = Depends(get_db),
    x_admin_token: str | None = Header(default=None),
    node_id: str | None = None,
    received_after: datetime | None = None,
    received_before: datetime | None = None,
    limit: int = Query(default=200, ge=1, le=500),
    cursor: str | None = None,
):
    require_admin_token(x_admin_token)
    lower = require_aware_filter(received_after, "received_after")
    upper = require_aware_filter(received_before, "received_before")
    if lower and upper and lower >= upper:
        raise HTTPException(status_code=422, detail="received_after must be before received_before")
    query = db.query(HeartbeatModel)
    if node_id:
        query = query.filter(HeartbeatModel.node_id == node_id)
    if lower:
        query = query.filter(HeartbeatModel.received_at >= lower)
    if upper:
        query = query.filter(HeartbeatModel.received_at < upper)
    query = apply_history_cursor(
        query,
        HeartbeatModel.received_at,
        HeartbeatModel.id,
        decode_cursor(cursor),
    )
    records = query.order_by(
        HeartbeatModel.received_at.desc(), HeartbeatModel.id.desc()
    ).limit(limit + 1).all()
    page = page_response(records, limit, "received_at")
    page["items"] = [
        {
            "id": heartbeat.id,
            "node_id": heartbeat.node_id,
            "timestamp": utc_api_datetime(heartbeat.timestamp),
            "received_at": utc_api_datetime(heartbeat.received_at),
            "reported_ip": heartbeat.reported_ip,
            "reported_mac": heartbeat.reported_mac,
            "reported_rssi_dbm": heartbeat.reported_rssi_dbm,
            "reported_ssid": heartbeat.reported_ssid,
            "reported_bssid": heartbeat.reported_bssid,
            "reported_wifi_channel": heartbeat.reported_wifi_channel,
            "reported_gateway": heartbeat.reported_gateway,
            "reported_subnet_mask": heartbeat.reported_subnet_mask,
            "reported_relay_state": heartbeat.reported_relay_state,
        }
        for heartbeat in page["items"]
    ]
    return page

@app.get("/nodes/{node_id}/readings")
def get_node_readings(
    node_id: str,
    db: Session = Depends(get_db),
    x_admin_token: str | None = Header(default=None),
    sensor_type: str | None = None,
    start: datetime | None = None,
    end: datetime | None = None,
    limit: int = Query(default=200, ge=1, le=500),
    cursor: str | None = None,
):
    require_admin_token(x_admin_token)
    lower = require_aware_filter(start, "start")
    upper = require_aware_filter(end, "end")
    if lower and upper and lower >= upper:
        raise HTTPException(status_code=422, detail="start must be before end")
    query = db.query(SensorReadingModel).filter(
        SensorReadingModel.node_id == node_id
    )
    if sensor_type:
        query = query.filter(SensorReadingModel.sensor_type == sensor_type)
    if lower:
        query = query.filter(SensorReadingModel.timestamp >= lower)
    if upper:
        query = query.filter(SensorReadingModel.timestamp < upper)
    query = apply_history_cursor(
        query,
        SensorReadingModel.timestamp,
        SensorReadingModel.id,
        decode_cursor(cursor),
    )
    records = query.order_by(
        SensorReadingModel.timestamp.desc(), SensorReadingModel.id.desc()
    ).limit(limit + 1).all()
    page = page_response(records, limit, "timestamp")
    page["items"] = [
        {
            "id": reading.id,
            "node_id": reading.node_id,
            "location_id": reading.location_id,
            "sensor_id": reading.sensor_id,
            "sensor_type": reading.sensor_type,
            "value": reading.value,
            "unit": reading.unit,
            "timestamp": utc_api_datetime(reading.timestamp),
            "validation_status": reading.validation_status,
            "confidence": reading.confidence,
            "validation_reason": reading.validation_reason,
        }
        for reading in page["items"]
    ]
    return page

@app.get("/readings")
def get_readings(
    db: Session = Depends(get_db),
    x_admin_token: str | None = Header(default=None),
    node_id: str | None = None,
    location_id: str | None = None,
    sensor_type: str | None = None,
    start: datetime | None = None,
    end: datetime | None = None,
    limit: int = Query(default=200, ge=1, le=500),
    cursor: str | None = None,
):
    require_admin_token(x_admin_token)
    lower = require_aware_filter(start, "start")
    upper = require_aware_filter(end, "end")
    if lower and upper and lower >= upper:
        raise HTTPException(status_code=422, detail="start must be before end")
    query = db.query(SensorReadingModel)
    if node_id:
        query = query.filter(SensorReadingModel.node_id == node_id)
    if location_id:
        query = query.filter(SensorReadingModel.location_id == location_id)
    if sensor_type:
        query = query.filter(SensorReadingModel.sensor_type == sensor_type)
    if lower:
        query = query.filter(SensorReadingModel.timestamp >= lower)
    if upper:
        query = query.filter(SensorReadingModel.timestamp < upper)
    query = apply_history_cursor(
        query,
        SensorReadingModel.timestamp,
        SensorReadingModel.id,
        decode_cursor(cursor),
    )
    records = query.order_by(
        SensorReadingModel.timestamp.desc(), SensorReadingModel.id.desc()
    ).limit(limit + 1).all()
    page = page_response(records, limit, "timestamp")
    page["items"] = [
        {
            "id": reading.id,
            "node_id": reading.node_id,
            "location_id": reading.location_id,
            "sensor_id": reading.sensor_id,
            "sensor_type": reading.sensor_type,
            "value": reading.value,
            "unit": reading.unit,
            "timestamp": utc_api_datetime(reading.timestamp),
            "validation_status": reading.validation_status,
            "confidence": reading.confidence,
            "validation_reason": reading.validation_reason,
        }
        for reading in page["items"]
    ]
    return page
