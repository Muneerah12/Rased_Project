# CPS Backend — Project Status

## Integrated Platform Status (2026-10-15)

The CPS backend is integrated into the RASID CPS platform (`Rasid_LA` repository,
`CPS-Project/`). The physical pipeline is complete: ESP32 NODE-04 sends heartbeats and
BME280 readings over HTTPS (Caddy → gateway → CPS) and RASID shows them live. Setup from
scratch: `RUN_FROM_ZERO.md`.

| Area | Status |
| --- | --- |
| NODE-04 physical link (HTTPS, verified TLS) | Working on the hotspot network |
| Plain-HTTP option for private networks | Available in firmware; documented |
| CPS backend tests | 181 passed |
| RASID ↔ CPS read-only integration | Working: node state, readings and heartbeat history |
| NODE-04 offline alert + incident | Working; Telegram/webhook when configured |
| Operational HVAC recommendation | Working, monitor-only, approved thresholds in `.env` |
| Simulation Center (digital twin) | Working, browser-local only |
| Relay control from RASID | Not implemented; commands remain non-actuating |
| Recorded data in git | `cps.db` snapshot (115k readings, 13.6k heartbeats as of 2026-10-15) |

Open items: production deployment (TLS without a self-managed CA, secret storage,
monitoring), rotation of credentials whose hashes are in the committed `cps.db`, a CO2
sensor for real exhaust decisions, and more deployed subzones (A1-2 … A1-4 have no sensor).

The sections below record the backend's history and remain accurate for their dates.

---

## Current Status

The CPS backend is currently in the prototype/development phase.

The backend is running successfully using FastAPI, Uvicorn,
SQLAlchemy, and SQLite.

The first physical ESP32 integration step is complete. The ESP32 is
successfully connected to the development environment, and firmware can be
uploaded through COM3. BME280 sensor reading and physical communication with
the backend remain work in progress; the physical CPS pipeline is not yet
complete.

The core backend currently supports CPS node management,
device authentication, heartbeat processing, sensor telemetry,
node lifecycle management, and node connection-state tracking.

The narrow RASID node-state and heartbeat-history integration routes now have
their own server-only read credential and retain their NODE-04 allowlist. They
do not grant RASID
administrator, device-ingestion, actuator, or other CPS API access.
The NODE-04 state contract also exposes a strictly allowlisted nullable
device-reported network-observation snapshot from the latest heartbeat; it
remains read-only and does not expose credentials or arbitrary telemetry.
The integration boundary is ready for a server-to-server RASID client, but no
RASID client, CPS-to-RASID data flow, or browser credential exposure has been
implemented.

Phase 1 authorization guards and automated tests are in place. Verification
recorded on 2026-09-29 completed with 58 passed, 0 failed, and 0 skipped in
the full backend suite (18.10s), and 25 passed, 0 failed, and 0 skipped in
the dedicated reading-integrity suite. Manual checks demonstrated cross-node
`SUSPICIOUS` on disagreement, cross-node `NORMAL` on agreement, and same-node
`NORMAL` and `UNKNOWN` outcomes.

---

## Implemented

### Backend Foundation

- FastAPI backend
- Local API
- Swagger/OpenAPI documentation
- SQLAlchemy database integration
- SQLite development database

### Node Management

- Node model
- Node registration endpoint
- Duplicate node registration handling
- Administrator authentication for node provisioning
- Get all registered nodes
- Get individual node information
- Node revocation / deprovisioning
- Node reactivation
- Device credential rotation during reactivation

### Device Authentication

- Per-node device credentials
- Device credential verification
- Unknown-node rejection
- Invalid credential rejection
- Missing credential rejection
- Separation between administrator credentials and device credentials

### Heartbeat / Node Health

- Heartbeat schema
- Heartbeat endpoint
- Registered node heartbeat processing
- Heartbeat storage
- last_seen tracking
- Heartbeat history retrieval
- ONLINE / STALE / OFFLINE connection-state calculation

### Sensor Telemetry

- Sensor reading endpoint
- Sensor reading database storage
- Authenticated sensor readings
- Get all sensor readings
- Get sensor readings by node

### Sensor Reading Integrity

- Engineering-range and supported-unit validation
- Same-node median peer comparison
- Cross-node median peer comparison using configured comparison groups
- Configurable peer freshness and type-specific tolerance settings
- NORMAL / SUSPICIOUS / UNKNOWN / INVALID outcomes
- Persisted confidence and validation reason
- Integrity fields returned by authorized reading endpoints

---

## Current Limitations

- The simulator requires HTTPS and uses verified server certificates
- Uvicorn HTTPS transport has passed local integration tests; production
  certificate issuance, deployment, and renewal still need configuration
- Administrator authentication currently uses a development provisioning-token approach
- Production secret management has not been implemented
- Secure credential storage on the ESP32 has not been implemented
- Full production-grade authorization / RBAC has not been implemented
- Replay protection has not been implemented
- Event-based communication is not implemented
- Network degradation detection is not implemented
- Sensor fault/recovery lifecycle and calibration-aware thresholds are not implemented
- AI / CCTV integration is not implemented
- Occupancy / density calculation is not implemented
- Decision engine is not implemented
- Action manager / actuation integration is not implemented
- Phase 1B provides a tested non-actuating command ledger for NODE-04 only;
  it does not provide GPIO control, ESP32 command handling, or physical fan
  actuation.
- Production database has not been selected
- Production deployment configuration has not been completed
- Production logging and monitoring have not been completed
- Production error-handling hardening remains

---

## Pre-Deployment Requirements

### Security

[x] Device authentication

[x] Authentication for sensor readings

[x] Authentication for heartbeat messages

[x] Secure node provisioning

[x] Unknown-node rejection

[x] Node revocation / deprovisioning

[x] Node reactivation with credential rotation

[x] Basic separation between administrator and device authentication

[x] Scoped read-only RASID integration credential for NODE-04 state and heartbeat history

[ ] Production-grade administrator authentication

[ ] Full authorization / RBAC

[x] HTTPS/TLS MVP transport and certificate validation tests

[ ] Secure credential storage on ESP32

[ ] Replay protection

[ ] Production secret management

### Node Health

[x] last_seen tracking

[x] ONLINE / STALE / OFFLINE logic

[x] Heartbeat timeout mechanism

[x] Unknown-node heartbeat rejection

[ ] Network degradation detection

### Telemetry

[x] Authenticated sensor readings

[x] Sensor reading storage

[x] Per-node sensor reading retrieval

[x] MVP reading integrity and grouped peer validation

[ ] Sensor fault/recovery lifecycle and calibration-aware thresholds

### CPS / AI Integration

[ ] Event-based communication

[x] Read-only RASID NODE-04 state and heartbeat-history integration boundary

[ ] AI / CCTV integration

[ ] People-count input

[ ] Occupancy / density calculation

[ ] Decision engine

[ ] Action manager / actuation

### Production Infrastructure

[ ] Production database

[ ] Production deployment configuration

[ ] Logging and monitoring

[ ] Production error handling

[ ] Security hardening and final penetration testing

Admin-token startup configuration and deterministic database-path handling
were implemented on 2026-09-30. The backend loads the project-root `.env`
without overriding process environment settings, fails clearly at startup
when the admin token is missing or blank, and uses `backend/cps.db` regardless
of launch directory. The focused configuration suite passed 6 tests; the full
backend suite passed 64 tests (0 failed, 0 skipped), and `py_compile` passed
for 9 backend Python files.

## V2 Foundation Update (2026-10-01)

Implemented the 64-subzone catalogue, NODE-03's A1-1 assignment, immutable
reading location snapshots, server-receipt connectivity freshness, optional
device-reported network observations, protected location APIs, and bounded
server-side history filters. The frontend includes a real-data location heat
map, heartbeat timeline, and explicit pending integration areas for
Actuators, CCTV, Drones, and Other IoT.

Weather provider integration remains blocked pending provider and site
configuration. A provider-neutral temperature observation model and
protected read endpoint are in place; without a configured source, the API
reports `UNCONFIGURED`. Camera and actuator operation remain pending their
actual API, device, and safety contracts. The backend suite passed 95 tests
on 2026-10-01. Frontend build and ESP32 compile passed; no firmware upload
was performed as part of this V2 foundation work.

## Phase 1B Command Foundation Update (2026-10-10)

Implemented a NODE-04-only, HTTPS-required, non-actuating command ledger with
separate control-service authentication, expiry, idempotent device
acknowledgement, duplicate-poll delivery, and revocation handling. It is a
protocol foundation only: ESP32 command handling, secure firmware transport,
remote leases, RASID issuance UI, GPIO execution, and physical feedback remain
blocked pending explicit later phases and hardware verification.
