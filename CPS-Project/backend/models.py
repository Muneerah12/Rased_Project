from sqlalchemy import (
    CheckConstraint,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
)

from database import Base


class Zone(Base):
    __tablename__ = "zones"

    code = Column(String(1), primary_key=True)


class Hall(Base):
    __tablename__ = "halls"

    code = Column(String(2), primary_key=True)
    zone_code = Column(String(1), ForeignKey("zones.code"), nullable=False)


class Subzone(Base):
    __tablename__ = "subzones"
    __table_args__ = (
        CheckConstraint(
            "deployment_status IN ('NOT_DEPLOYED', 'DEPLOYED')",
            name="ck_subzones_deployment_status",
        ),
    )

    code = Column(String(5), primary_key=True)
    hall_code = Column(String(2), ForeignKey("halls.code"), nullable=False)
    deployment_status = Column(String(16), nullable=False, default="NOT_DEPLOYED")


class ExternalTemperatureObservation(Base):
    __tablename__ = "external_temperature_observations"
    __table_args__ = (
        CheckConstraint(
            "status IN ('CURRENT', 'STALE', 'ERROR')",
            name="ck_external_temperature_status",
        ),
        Index("ix_weather_site_retrieved", "site_id", "retrieved_at"),
    )

    id = Column(Integer, primary_key=True, index=True)
    provider = Column(String(80), nullable=False)
    site_id = Column(String(80), nullable=False)
    observed_at = Column(DateTime, nullable=True)
    retrieved_at = Column(DateTime, nullable=False)
    value = Column(Float, nullable=True)
    unit = Column(String(16), nullable=True)
    status = Column(String(16), nullable=False)
    error_code = Column(String(80), nullable=True)


class SensorReading(Base):
    __tablename__ = "sensor_readings"

    id = Column(Integer, primary_key=True, index=True)

    # Original sensor data
    node_id = Column(String, nullable=False)
    # Snapshot of the authenticated node's assignment at ingestion time.
    location_id = Column(String(5), ForeignKey("subzones.code"), nullable=True)
    sensor_id = Column(String, nullable=False)
    sensor_type = Column(String, nullable=False)
    value = Column(Float, nullable=False)
    unit = Column(String, nullable=False)
    timestamp = Column(DateTime, nullable=False)

    # Sensor data trust / validation
    validation_status = Column(
        String,
        nullable=False,
        default="UNKNOWN"
    )

    confidence = Column(
        Float,
        nullable=True
    )

    validation_reason = Column(
        String,
        nullable=True
    )

    __table_args__ = (
        Index("ix_sensor_readings_node_timestamp", "node_id", "timestamp"),
        Index("ix_sensor_readings_location_timestamp", "location_id", "timestamp"),
    )

class Heartbeat(Base):
    __tablename__ = "heartbeats"

    id = Column(Integer, primary_key=True, index=True)
    node_id = Column(String, nullable=False)
    timestamp = Column(DateTime, nullable=False)
    received_at = Column(DateTime, nullable=False)
    # Nullable self-reported observations from the authenticated node.
    reported_ip = Column(String(45), nullable=True)
    reported_mac = Column(String(17), nullable=True)
    reported_rssi_dbm = Column(Integer, nullable=True)
    reported_ssid = Column(String(64), nullable=True)
    reported_bssid = Column(String(17), nullable=True)
    reported_wifi_channel = Column(Integer, nullable=True)
    reported_gateway = Column(String(45), nullable=True)
    reported_subnet_mask = Column(String(45), nullable=True)
    # Device-commanded relay output; this does not confirm physical actuation.
    reported_relay_state = Column(String(3), nullable=True)

    __table_args__ = (
        Index("ix_heartbeats_node_received", "node_id", "received_at"),
    )


class ControlCommand(Base):
    """A non-actuating command envelope for a device-bound control workflow.

    This record deliberately represents delivery and acknowledgement only.  It
    must not be interpreted as proof that a relay or a fan changed state.
    """

    __tablename__ = "control_commands"
    __table_args__ = (
        CheckConstraint(
            "status IN ('PENDING', 'DELIVERED', 'ACKNOWLEDGED', 'EXPIRED', 'REJECTED')",
            name="ck_control_commands_status",
        ),
        CheckConstraint(
            "requested_state IN ('ON', 'OFF')",
            name="ck_control_commands_requested_state",
        ),
        Index("ix_control_commands_node_status_created", "node_id", "status", "created_at"),
    )

    id = Column(Integer, primary_key=True, index=True)
    command_id = Column(String(36), nullable=False, unique=True, index=True)
    idempotency_key = Column(String(128), nullable=False, unique=True, index=True)
    node_id = Column(String, nullable=False)
    actuator_id = Column(String(64), nullable=False)
    requested_state = Column(String(3), nullable=False)
    # Phase 1B commands are envelopes only.  Firmware must not execute them.
    command_kind = Column(String(40), nullable=False, default="NON_ACTUATING")
    status = Column(String(16), nullable=False, default="PENDING")
    created_at = Column(DateTime, nullable=False)
    expires_at = Column(DateTime, nullable=False)
    delivered_at = Column(DateTime, nullable=True)
    acknowledged_at = Column(DateTime, nullable=True)
    expired_at = Column(DateTime, nullable=True)
    rejected_at = Column(DateTime, nullable=True)
    rejection_reason = Column(String(80), nullable=True)
    issued_by = Column(String(80), nullable=False, default="RASID_CONTROL_SERVICE")

class Node(Base):
    __tablename__ = "nodes"

    id = Column(Integer, primary_key=True, index=True)
    node_id = Column(String, unique=True, nullable=False)

    credential_hash = Column(String, nullable=False)

    # Device lifecycle status
    status = Column(String, nullable=False, default="ACTIVE")

    # Current connectivity status
    connection_status = Column(String, nullable=False, default="OFFLINE")

    location_id = Column(String(5), ForeignKey("subzones.code"), nullable=True)
    # Device-reported clock time; liveness is based on server receipt time below.
    last_seen = Column(DateTime, nullable=True)
    last_heartbeat_received_at = Column(DateTime, nullable=True)

    # Device lifecycle timestamps
    provisioned_at = Column(DateTime, nullable=True)
    revoked_at = Column(DateTime, nullable=True)
