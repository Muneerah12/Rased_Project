from sqlalchemy import create_engine, event
from sqlalchemy import inspect, text
from sqlalchemy.engine import URL
from sqlalchemy.orm import declarative_base, sessionmaker
from pathlib import Path


DATABASE_PATH = Path(__file__).resolve().parent / "cps.db"
DATABASE_URL = URL.create("sqlite", database=str(DATABASE_PATH))

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False}
)


def _set_sqlite_foreign_keys(dbapi_connection, _connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


def enable_sqlite_foreign_keys(target_engine):
    """Enable SQLite FK enforcement for every connection from an engine."""
    if target_engine.dialect.name != "sqlite":
        return

    if not event.contains(target_engine, "connect", _set_sqlite_foreign_keys):
        event.listen(target_engine, "connect", _set_sqlite_foreign_keys)


enable_sqlite_foreign_keys(engine)

SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine
)

Base = declarative_base()


def migrate_sensor_reading_integrity_schema(target_engine=engine):
    """Add integrity reasons to existing SQLite databases without data loss."""
    if target_engine.dialect.name != "sqlite":
        raise RuntimeError(
            "The sensor integrity migration currently supports SQLite only"
        )

    inspector = inspect(target_engine)
    if "sensor_readings" not in inspector.get_table_names():
        return

    columns = {
        column["name"]
        for column in inspector.get_columns("sensor_readings")
    }
    if "validation_reason" not in columns:
        with target_engine.begin() as connection:
            connection.execute(text(
                "ALTER TABLE sensor_readings "
                "ADD COLUMN validation_reason VARCHAR"
            ))
            connection.execute(text(
                "UPDATE sensor_readings "
                "SET validation_reason = :reason "
                "WHERE validation_reason IS NULL"
            ), {"reason": "legacy reading; reason unavailable"})


def migrate_v2_location_network_schema(target_engine=engine):
    """Add V2 location/network columns and catalogue without rewriting history."""
    if target_engine.dialect.name != "sqlite":
        raise RuntimeError("The V2 migration currently supports SQLite only")

    enable_sqlite_foreign_keys(target_engine)
    # This creates new catalogue tables, but SQLAlchemy create_all does not
    # alter existing node/reading/heartbeat tables; those are changed below.
    Base.metadata.create_all(bind=target_engine)

    def columns_for(connection, table_name):
        return {
            row["name"]
            for row in inspect(connection).get_columns(table_name)
        }

    with target_engine.begin() as connection:
        connection.execute(text(
            "CREATE TABLE IF NOT EXISTS schema_migrations "
            "(version VARCHAR(80) PRIMARY KEY, applied_at DATETIME NOT NULL)"
        ))
        v2_applied = connection.execute(text(
            "SELECT 1 FROM schema_migrations WHERE version = :version"
        ), {"version": "2026-10-v2-locations-network"}).first() is not None

        node_columns = columns_for(connection, "nodes")
        if "location_id" not in node_columns:
            connection.execute(text(
                "ALTER TABLE nodes ADD COLUMN location_id VARCHAR(5) "
                "REFERENCES subzones(code) DEFAULT NULL"
            ))
        if "last_heartbeat_received_at" not in node_columns:
            connection.execute(text(
                "ALTER TABLE nodes ADD COLUMN last_heartbeat_received_at DATETIME"
            ))

        reading_columns = columns_for(connection, "sensor_readings")
        if "location_id" not in reading_columns:
            connection.execute(text(
                "ALTER TABLE sensor_readings ADD COLUMN location_id VARCHAR(5) "
                "REFERENCES subzones(code) DEFAULT NULL"
            ))

        heartbeat_columns = columns_for(connection, "heartbeats")
        if "reported_ip" not in heartbeat_columns:
            connection.execute(text(
                "ALTER TABLE heartbeats ADD COLUMN reported_ip VARCHAR(45)"
            ))
        if "reported_mac" not in heartbeat_columns:
            connection.execute(text(
                "ALTER TABLE heartbeats ADD COLUMN reported_mac VARCHAR(17)"
            ))
        if "reported_rssi_dbm" not in heartbeat_columns:
            connection.execute(text(
                "ALTER TABLE heartbeats ADD COLUMN reported_rssi_dbm INTEGER"
            ))
        for column_name, column_type in (
            ("reported_ssid", "VARCHAR(64)"),
            ("reported_bssid", "VARCHAR(17)"),
            ("reported_wifi_channel", "INTEGER"),
            ("reported_gateway", "VARCHAR(45)"),
            ("reported_subnet_mask", "VARCHAR(45)"),
            ("reported_relay_state", "VARCHAR(3)"),
        ):
            if column_name not in heartbeat_columns:
                connection.execute(text(
                    f"ALTER TABLE heartbeats ADD COLUMN {column_name} {column_type}"
                ))

        for zone in "ABCD":
            connection.execute(
                text("INSERT OR IGNORE INTO zones (code) VALUES (:code)"),
                {"code": zone},
            )
            for hall_number in range(1, 5):
                hall = f"{zone}{hall_number}"
                connection.execute(text(
                    "INSERT OR IGNORE INTO halls (code, zone_code) "
                    "VALUES (:code, :zone_code)"
                ), {"code": hall, "zone_code": zone})
                for subzone_number in range(1, 5):
                    subzone = f"{hall}-{subzone_number}"
                    deployment_status = (
                        "DEPLOYED" if subzone == "A1-1" else "NOT_DEPLOYED"
                    )
                    connection.execute(text(
                        "INSERT OR IGNORE INTO subzones "
                        "(code, hall_code, deployment_status) "
                        "VALUES (:code, :hall_code, :deployment_status)"
                    ), {
                        "code": subzone,
                        "hall_code": hall,
                        "deployment_status": deployment_status,
                    })

        if not v2_applied:
            # Only the explicitly approved current assignment is made. No old
            # sensor readings are backfilled to a location. This one-time
            # migration guard ensures a deliberate later unassignment sticks.
            connection.execute(text(
                "UPDATE nodes SET location_id = 'A1-1' "
                "WHERE node_id = 'NODE-03' AND location_id IS NULL"
            ))
            connection.execute(text(
                "UPDATE nodes SET last_heartbeat_received_at = "
                "(SELECT MAX(received_at) FROM heartbeats "
                "WHERE heartbeats.node_id = nodes.node_id) "
                "WHERE last_heartbeat_received_at IS NULL "
                "AND EXISTS (SELECT 1 FROM heartbeats "
                "WHERE heartbeats.node_id = nodes.node_id)"
            ))
            connection.execute(text(
                "INSERT INTO schema_migrations (version, applied_at) "
                "VALUES (:version, CURRENT_TIMESTAMP)"
            ), {"version": "2026-10-v2-locations-network"})
        connection.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_sensor_readings_node_timestamp "
            "ON sensor_readings (node_id, timestamp)"
        ))
        connection.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_sensor_readings_location_timestamp "
            "ON sensor_readings (location_id, timestamp)"
        ))
        connection.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_heartbeats_node_received "
            "ON heartbeats (node_id, received_at)"
        ))


def migrate_control_command_schema(target_engine=engine):
    """Create the isolated Phase 1B non-actuating command ledger.

    The model is intentionally a new table: no telemetry, node assignment, or
    historical records are rewritten.
    """
    Base.metadata.create_all(bind=target_engine)
