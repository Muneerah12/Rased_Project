# CPS Project — Implementation Log

## 2026-09-25

### 1. Project Structure

Created the project structure:

CPS-Project/
├── backend/
├── docs/
├── esp32/
├── simulator/
└── README.md

The backend is developed separately from the ESP32 and simulator components.

---

### 2. Python Environment

Created a Python virtual environment for the backend.

Python version:

Python 3.13.15

The virtual environment is located inside:

backend/.venv/

---

### 3. PlatformIO

PlatformIO Core was installed and verified.

Verified version:

PlatformIO Core 6.2.0

The `pio` command was initially unavailable in one VS Code terminal,
but worked correctly after opening a new PowerShell terminal.

---

### 4. FastAPI Installation

Installed FastAPI inside the backend virtual environment.

Verified using:

python -m pip show fastapi

FastAPI version installed:

0.141.1

---

### 5. Uvicorn Setup

Installed Uvicorn and used it to run the FastAPI development server.

Command:

python -m uvicorn main:app --reload

The backend successfully started at:

http://127.0.0.1:8000

---

### 6. FastAPI Root Endpoint

Created:

GET /

The endpoint returns:

{
    "message": "CPS Backend is running"
}

The endpoint was successfully tested through the browser.

---

### 7. FastAPI Documentation

FastAPI's automatic documentation was verified at:

http://127.0.0.1:8000/docs

The OpenAPI specification was also accessible through:

http://127.0.0.1:8000/openapi.json

FastAPI generates these automatically from the application and its
declared API schemas.

---

### 8. Database Setup

SQLAlchemy was installed in the backend virtual environment.

Verified version:

2.1.0

Created:

database.py

The project currently uses SQLite for development.

Database file:

cps.db

---

### 9. Database Models

Created:

models.py

The database models currently include:

- Sensor readings
- Nodes

The Node model contains:

- id
- node_id
- connection_status
- last_seen

The SensorReading model contains:

- id
- node_id
- sensor_id
- sensor_type
- value
- unit
- timestamp

Database tables are created through:

Base.metadata.create_all(bind=engine)

---

### 10. Sensor Reading API

Created the Pydantic request model:

SensorReading

Fields:

- node_id
- sensor_id
- sensor_type
- value
- unit
- timestamp

---

### 11. POST /readings

Implemented:

POST /readings

The endpoint:

1. Receives a sensor reading.
2. Validates the request structure.
3. Creates a database reading object.
4. Adds it to the database session.
5. Commits the transaction.
6. Refreshes the object.
7. Returns the generated reading ID.

Example response:

{
    "message": "Reading stored successfully",
    "reading_id": 1
}

---

### 12. Sensor Reading Test

A test reading was successfully sent through the API.

Example:

NODE-01
TEMP-01
temperature
24.5°C

The backend successfully accepted and stored the reading.

---

### 13. Heartbeat Schema

Created the Pydantic model:

Heartbeat

Fields:

- node_id
- timestamp

Example:

{
    "node_id": "NODE-01",
    "timestamp": "2026-09-25T10:40:00Z"
}

This represents the expected structure of a node heartbeat.

---

### 14. Node Model

Created the Node database model.

The model stores:

- Unique node identifier
- Connection status
- Last heartbeat timestamp

Initial nodes are registered with:

connection_status = "OFFLINE"

and:

last_seen = NULL

A node becomes ONLINE after a valid heartbeat is received.

---

### 15. Node Registration

Implemented:

POST /nodes

Created the Pydantic request model:

NodeRegistration

Fields:

- node_id

The endpoint checks whether the node already exists before creating
a new database record.

New nodes are initially created with:

connection_status = "OFFLINE"

and:

last_seen = NULL

---

### 16. Node Registration Validation

The node registration endpoint was tested with:

NODE-01

The node was successfully created.

A second registration attempt using the same node ID did not create
a duplicate node and returned:

{
    "message": "Node already registered",
    "node_id": "NODE-01"
}

---

### 17. Heartbeat Endpoint

Implemented:

POST /heartbeat

The endpoint searches for the node using its node_id.

For a registered node:

1. The node is located in the database.
2. connection_status is updated to ONLINE.
3. last_seen is updated using the heartbeat timestamp.
4. The updated node information is returned.

---

### 18. Unknown Node Rejection

The heartbeat endpoint was modified so that it no longer creates
nodes automatically.

If a heartbeat is received from an unregistered node, the backend
returns:

{
    "message": "Node not registered",
    "node_id": "FAKE-NODE-02",
    "connection_status": "UNKNOWN"
}

This prevents the heartbeat endpoint from being used to create
arbitrary nodes.

---

### 19. Valid Heartbeat Test

A heartbeat was sent from the registered node:

NODE-01

Example:

{
    "node_id": "NODE-01",
    "timestamp": "2026-09-25T11:00:00Z"
}

The backend successfully updated the node to:

connection_status = ONLINE

and updated:

last_seen = 2026-09-25T11:00:00Z

---

### 20. Current Implementation State

Implemented:

- FastAPI application
- Root endpoint
- FastAPI documentation
- OpenAPI specification
- SQLAlchemy setup
- SQLite database
- Sensor reading model
- Node model
- POST /readings
- POST /nodes
- POST /heartbeat
- Node registration validation
- Unknown heartbeat rejection
- Basic node ONLINE status
- last_seen tracking

## 2026-09-26

### 21. Device Authentication

Implemented device authentication for registered CPS nodes.

Each node receives a unique randomly generated device credential
during provisioning.

The backend stores only the Argon2id credential verifier.

The node must provide its device credential when accessing
protected device communication endpoints.

Authentication verifies:

- The node exists
- The node is ACTIVE
- The presented credential matches the stored verifier

Authentication failures are rejected by the backend.

---

### 22. Protected Heartbeat

Updated:

POST /heartbeat

The endpoint now requires:

X-Device-Credential

The backend authenticates the node before accepting the heartbeat.

A valid registered node can update:

- connection_status
- last_seen

Invalid or missing credentials are rejected.

---

### 23. Protected Sensor Telemetry

Updated:

POST /readings

The endpoint now requires:

X-Device-Credential

The backend authenticates the submitting node before storing
sensor telemetry.

The sensor reading is stored only after successful device
authentication.

---

### 24. UTC Timestamp Handling

Standardized CPS timestamps to UTC.

Incoming timestamps must include timezone information.

Timezone-aware timestamps are normalized to UTC before being used
by the backend.

Example:

2026-09-26T10:00:00+03:00

is normalized to:

2026-09-26T07:00:00Z

Node provisioning timestamps also use UTC.

---

### 25. Node Registration Timestamp

Node provisioning records the time at which the node was registered.

The database stores this timestamp as:

provisioned_at

The API exposes the registration time as:

registered_at

This provides a basic audit trail for node provisioning.

---

### 26. Authentication Testing

The device authentication mechanism was tested using registered
nodes.

Tests included:

- Valid device credential
- Invalid device credential
- Missing device credential
- Unknown node

Valid credentials were accepted.

Invalid, missing, and unauthorized node requests were rejected.

---

### 27. Current Backend Security State

Protected device communication currently includes:

- POST /heartbeat
- POST /readings

Node provisioning and lifecycle management are protected separately
using the administrator provisioning token.

The node_id is treated as an identifier and is not considered an
authentication credential.

Device credentials are stored using an Argon2id verifier rather than
plaintext credentials.

Implemented security and lifecycle controls currently include:

- Device authentication
- Administrator authentication for node management
- Node revocation / deprovisioning
- Node reactivation
- Device credential rotation during reactivation
- ONLINE / STALE / OFFLINE connection-state calculation
- Heartbeat-based connectivity tracking
- Per-node sensor reading retrieval

Remaining production/security work includes:

- HTTPS/TLS
- Secure credential/key storage on ESP32
- Stronger administrator authentication and role-based authorization
- Input validation hardening
- Production database
- Logging and monitoring
- Error handling
- Replay protection / stronger device request authentication
- Network degradation detection
- Event-based communication

ESP32-side credential protection is not implemented yet because the
physical/PlatformIO integration phase has not started.

### 28. Node Revocation / Deprovisioning

Implemented administrator-controlled node revocation.

The endpoint:

POST /nodes/{node_id}/revoke

allows an administrator to disable a registered node using the
administrator provisioning token.

When a node is revoked:

- status is changed to REVOKED
- connection_status is changed to OFFLINE
- revoked_at is recorded using UTC
- the existing node record is retained

The node is not deleted from the database so that its provisioning
and lifecycle information remains available.

A revoked node cannot authenticate to protected device endpoints.

### 29. Node Reactivation and Credential Rotation

Implemented administrator-controlled node reactivation.

The endpoint:

POST /nodes/{node_id}/reactivate

can only reactivate a node whose lifecycle status is REVOKED.

Reactivation does not restore the previous device credential.

Instead, the backend:

1. Generates a new random device credential.
2. Creates a new Argon2id credential verifier.
3. Replaces the previous credential verifier.
4. Changes the node status to ACTIVE.
5. Sets the connection status to OFFLINE.
6. Returns the new credential for secure device provisioning.

The previous credential therefore remains invalid after reactivation.

**### 30. Node Connection-State Calculation**

Implemented dynamic node connection-state calculation based on the
latest heartbeat information stored in last_seen.

The backend distinguishes between:

- ONLINE
- STALE
- OFFLINE

The connection state represents the current communication status of
the node and is separate from the node lifecycle status.

For example:

ACTIVE + OFFLINE

means that the node is still authorized but is not currently
communicating with the backend.

A node can therefore remain ACTIVE while its connection status becomes
STALE or OFFLINE.

**### 31. Node Retrieval**

Implemented:

GET /nodes

The endpoint returns the registered nodes and their current
management/connectivity information.

Returned information includes:

- node_id
- status
- connection_status
- last_seen
- provisioned_at
- revoked_at

The endpoint is intended to provide an overview of the registered
CPS nodes.

**### 32. Individual Node Retrieval**

Implemented:

GET /nodes/{node_id}

The endpoint retrieves information for a specific registered node.

The endpoint:

1. Authenticates the administrator.
2. Searches for the requested node.
3. Returns HTTP 404 if the node does not exist.
4. Recalculates the current connection status using last_seen.
5. Returns the node's lifecycle and connectivity information.

The node credential hash is not returned by the endpoint.

**### 33. Sensor Reading Retrieval**

Implemented:

GET /readings

The endpoint retrieves stored sensor readings from the database.

Returned information includes:

- reading ID
- node_id
- sensor_id
- sensor_type
- value
- unit
- timestamp

The endpoint provides a system-wide view of stored telemetry.

**### 33. Sensor Reading Retrieval**

Implemented:

GET /readings

The endpoint retrieves stored sensor readings from the database.

Returned information includes:

- reading ID
- node_id
- sensor_id
- sensor_type
- value
- unit
- timestamp

The endpoint provides a system-wide view of stored telemetry.

## 2026-09-26 — Current Backend Implementation State

The backend currently supports the core CPS node-management and
telemetry flows.

### Node Management

- POST /nodes
- GET /nodes
- GET /nodes/{node_id}
- POST /nodes/{node_id}/revoke
- POST /nodes/{node_id}/reactivate

### Node Connectivity

- POST /heartbeat
- GET /heartbeats
- ONLINE / STALE / OFFLINE connection states
- last_seen tracking

### Sensor Telemetry

- POST /readings
- GET /readings
- GET /nodes/{node_id}/readings

### Security

- Administrator provisioning authentication
- Per-node device credentials
- Argon2id credential verification
- Protected heartbeat
- Protected sensor telemetry
- Node revocation
- Credential rotation during reactivation

### Next Major Development Phase

The next major phase is integration with the physical ESP32 node.

The planned flow is:

ESP32 Sensors
↓
ESP32 Node
↓
Authenticated Backend API
↓
Sensor Readings / Heartbeat
↓
Database
↓
Validation and Sensor Health
↓
AI / Decision Layer
↓
Actuation


## 2026-09-28 — Hierarchical Sensor Validation and Reading Trust Design

### Objective

Define how the CPS will determine whether sensor readings are trustworthy
before allowing them to influence environmental decisions.

### Design Decision

The system will use hierarchical validation rather than blindly trusting
individual sensor readings.

The planned validation flow is:

Raw Sensor Reading
↓
Basic Reading Validation
↓
Sensor-Level Validation
↓
Node-Level Validation
↓
Neighbor-Based Context Validation
↓
Reading Trust / Confidence
↓
Environmental Data Fusion
↓
Environmental State
↓
Decision Engine

### Sensor-Level Validation

When multiple sensors within the same node measure the same or related
environmental parameters, their readings will be compared.

Significant disagreement between sensors will be treated as a potential
sensor anomaly rather than immediately being interpreted as a change in
the physical environment.

### Neighbor-Based Validation

A node's measurements will also be compared with measurements from
physically or spatially neighboring nodes when sufficient data is
available.

Multiple neighboring observations should be preferred over relying on a
single neighbor.

A robust statistic such as the median may be used to establish a local
reference for anomaly detection.

### Reading Trust

The design separates:

- Device authentication
- Sensor health
- Reading trust
- Environmental state

An authenticated device does not automatically produce trusted
measurements.

Suspicious readings should be preserved and may later be down-weighted or
excluded from environmental data fusion depending on their validation
result.

### State Separation

The following states remain independent:

Connection Status:

- ONLINE
- STALE
- OFFLINE

Sensor Health:

- NORMAL
- WARNING / SUSPICIOUS
- FAULT
- UNKNOWN

Environmental State:

- NORMAL
- WARNING
- CRITICAL
- UNKNOWN

An abnormal sensor should therefore not automatically cause the
environmental state to become abnormal.

Similarly, an offline node does not imply that its last known
environmental value is still current.

### Temporal Validation and Recovery

A single abnormal measurement should not permanently classify a sensor as
faulty.

The planned validation behavior supports progression from:

NORMAL
→ WARNING / SUSPICIOUS
→ FAULT

and recovery from:

FAULT
→ consistent readings
→ NORMAL

Repeated observations, spatial relationships, and temporal trends will be
considered during implementation.

### Implementation Status

**Design:** COMPLETED

**Backend implementation:** NOT YET IMPLEMENTED

**Testing:** NOT YET IMPLEMENTED

The next implementation stage will introduce the required data structures
and validation logic while preserving the existing authenticated sensor
ingestion functionality.
## 2026-09-28 - HTTPS/TLS MVP Transport

Uvicorn's HTTPS listener is configured with certificate and private-key
files stored outside the repository. Example:

```powershell
python -m uvicorn main:app --host 0.0.0.0 --port 8000 `
  --ssl-certfile "C:\secure\cps-server.pem" `
  --ssl-keyfile "C:\secure\cps-server-key.pem"
```

The server certificate must contain the backend hostname in its Subject
Alternative Name. Keep the private key on the backend host. For local or
private-network use, clients can trust a private CA certificate.

Both simulator scripts now require `CPS_BACKEND_URL` to be an HTTPS base
URL, append `/readings`, and keep Requests certificate/hostname validation
enabled. Set `CPS_CA_BUNDLE` to the CA bundle path for a private CA; when
unset, the system's default trust store is used. Set `DEVICE_CREDENTIAL`
separately as before. The older simulator no longer embeds a device
credential and uses the same HTTPS transport configuration. Example
PowerShell settings:

```powershell
$env:CPS_BACKEND_URL = "https://cps-backend.example.lan:8000"
$env:CPS_CA_BUNDLE = "C:\secure\mvp-ca.pem"
$env:DEVICE_CREDENTIAL = "<provisioned-node-credential>"
python ..\simulator\simulator.py
```

HTTPS integration tests start a local Uvicorn TLS server using temporary
test certificates outside the repository. Results: all 6 transport tests
passed; the full backend suite passed (33 tests).
The test environment also needs the backend runtime packages, `pytest`,
`trustme`, and the Argon2 extra for `pwdlib`.

The ESP32 directory is empty, so firmware TLS support remains a future
client implementation task. The backend application code and API-level
device authentication were not changed for TLS.

## 2026-09-29 - Sensor Reading Integrity MVP

`POST /readings` now keeps device authentication separate from integrity
assessment. Individual validation accepts temperature from -40 to 85°C,
humidity from 0 to 100%, and pressure from 300 to 1100 hPa. Unsupported
types, unsupported units, non-finite values, and out-of-range values are
stored as `INVALID` rather than silently marked normal.

Comparable peers must have the same measurement type and compatible unit,
be assigned to the same configured comparison group, and have a timestamp
within the configured freshness window. The implementation excludes the
current sensor, future records, stale records, and sensors in other groups.
It selects the latest record per physical sensor and uses the median as the
reference for same-node and cross-node comparisons.

Configuration is environment-based. `CPS_SENSOR_COMPARISON_GROUPS` accepts
a JSON object keyed by node ID, then sensor ID, then group name. An
unconfigured sensor receives `UNKNOWN` when no comparable evidence exists.
The freshness default is 60 seconds. Prototype tolerances default to 2.0°C,
5 percentage points of humidity, and 10 hPa of pressure. These are
engineering assumptions, not standards-mandated values. Confidence is a
small deterministic heuristic tier and must not be interpreted as a
probability.

The `validation_reason` column was added through an idempotent SQLite
startup migration. Existing rows are preserved and receive
`legacy reading; reason unavailable`, since their original rationale
cannot be reconstructed. Authorized reading GET endpoints and the reading
submission response include status, confidence, and reason; no credential
fields are exposed.

Verification recorded on 2026-09-29: `python -m pytest tests/test_reading_integrity.py -v` completed with 25 passed, 0 failed, and
0 skipped. `python -m pytest -v` completed with 58 passed, 0 failed, and 0
skipped in 18.10s, including the existing authorization and HTTPS suites.
Manual cross-node checks returned `SUSPICIOUS` / `cross-node peer deviation`
for NODE-01 approximately 40?C versus NODE-02 approximately 25?C, and
`NORMAL` / `cross-node peers agree` when both nodes reported approximately
25?C. Manual same-node checks demonstrated `NORMAL` and `UNKNOWN` outcomes.

NIST measurement-uncertainty guidance informs the need for calibration and
uncertainty-aware thresholds. ISA/IEC 62443 informs the risk-based
cybersecurity context; neither is used as a source for the numeric sensor
tolerances. See [NIST TN 1900](https://www.nist.gov/publications/simple-guide-evaluating-and-expressing-uncertainty-nist-measurement-results)
and the [ISA/IEC 62443 series overview](https://www.isa.org/standards-and-publications/isa-standards/isa-iec-62443-series-of-standards).

## 2026-09-29 - First Physical ESP32 Integration

Created the `CPS-ESP32` PlatformIO project for the NodeMCU-32S board using
the Arduino framework. Installed the Silicon Labs CP210x USB-to-UART driver;
Windows detected the connected ESP32 on COM3. Configured
`upload_port = COM3` in `platformio.ini`.

The default PlatformIO firmware in `src/main.cpp` built successfully and
uploaded through COM3. `esptool` detected an ESP32-D0WD-V3, revision v3.1;
firmware writing completed, the image hash was verified, and the ESP32
performed a hard reset. PlatformIO reported `[SUCCESS]`.

## 2026-09-30 - Admin Token and Database Startup Configuration

The backend now loads `ADMIN_PROVISIONING_TOKEN` from the process environment or the project-root `.env` file before the FastAPI app starts. Existing process environment values take precedence. FastAPI startup stops with a generic configuration error when the token is missing or blank; the secret value is not included in the error.

The root `.env.example` contains an empty token setting and no real secret. The existing `.gitignore` excludes `.env` files. `backend/requirements.txt` now declares the backend and test dependencies, including `python-dotenv`.

SQLite now uses an absolute path based on `backend/database.py`, so launching from the repository root or another working directory selects `backend/cps.db`.

Verification: the focused admin configuration suite completed with 6 passed. The full backend suite completed with 64 passed, 0 failed, and 0 skipped in 24.34s. `py_compile` passed for all 9 backend Python files.

From the project root, install dependencies with `python -m pip install -r backend/requirements.txt` and start with `python -m uvicorn main:app --app-dir backend --reload`. Copy `.env.example` to `.env` and set a local random token before launch.

## 2026-10-01 — V2 Location, History, and Network Foundation

Added normalized zones, halls, and subzones with a repeatable SQLite migration.
The catalogue contains 64 subzones; only A1-1 is DEPLOYED. The migration
assigned NODE-03 to A1-1 and left other nodes unassigned. It did not assign
locations to historical readings. New readings snapshot the node's current
location.

Node liveness now uses the backend's heartbeat `received_at`; the device
timestamp remains separately available as `last_seen`. Heartbeat records can
store optional reported IP, MAC, and RSSI. The ESP32 heartbeat sends these
three observations; it sends no SSID, gateway, password, sequence number, or
credential in JSON.

Added admin-protected location catalogue and node-location assignment routes,
plus node/type/location/time filters and bounded cursors for readings and
node/time/receipt-time filters and bounded cursors for heartbeats. The frontend
now requests filtered pages, shows the location hierarchy and real-data heat
map, draws heartbeat receipt timelines, and exposes explicit pending states for
actuator/CCTV/drone/other-IoT integrations. No weather provider was selected;
weather integration is waiting for provider and site configuration.

See the V2 test log for verification. The pre-existing SQLite database was
migrated in place; it was not dropped or recreated.

Added a provider-neutral external-temperature observation model and a
protected latest-observation endpoint. With no observation configured, the
API returns `UNCONFIGURED`; there is no selected provider, site, credential,
outbound request, or synthetic observation.

## 2026-10-05 - Expanded ESP32 Network Observations

Extended the existing device-authenticated heartbeat with optional device-
reported SSID, BSSID, Wi-Fi channel, gateway, and subnet mask. Existing
reported IP, MAC, and RSSI fields and the heartbeat interval remain unchanged.
The firmware emits null for unavailable optional string/channel observations
and JSON-escapes SSIDs. The existing heartbeat record was extended with
nullable fields through an additive SQLite migration; old payloads remain
accepted. The existing admin-protected `GET /heartbeats` response and NOC now
carry and display the observations. Credentials and Wi-Fi passwords are not
stored in the heartbeat model or returned by the API. Network fields remain
unverified device reports; connection status continues to use server receipt
time only.

## 2026-10-08 - Scoped RASID Read-Only Integration Authentication

Replaced the temporary administrator-token authorization on
`GET /api/v1/integration/nodes/{node_id}/state` with a dedicated,
server-only `RASID_INTEGRATION_TOKEN` supplied in
`X-Rasid-Integration-Token`. The endpoint retains the existing NODE-04
allowlist, bounded ten-reading response, in-memory status calculation, and
no-database-write behavior.

The new credential is loaded through the existing process-environment and
project-root `.env` mechanism, compared with `secrets.compare_digest`, and
authorizes no other CPS route. Missing configuration returns generic `503`;
missing or invalid credentials return generic `401`. Administrator and device
authentication, telemetry ingestion, and actuator behavior were not changed.

No rotation overlap is implemented: the initial implementation supports one
active integration credential. Actual secret values are excluded from tracked
files; `.env.example` contains only an empty placeholder.

## 2026-10-08 - NODE-04 Read-Only Network Observation Contract

Extended only the existing authenticated NODE-04 integration-state response
with a strictly allowlisted nullable `network_observation` object. The nine
response fields are sourced exclusively from the same newest persisted
heartbeat selected by server receipt time; no older heartbeat fallback is
performed. `reported_at` is that heartbeat's server `received_at` value.
This change did not modify ingestion, the database schema, ESP32 firmware,
authentication, allowlisting, connection-status calculation, or read-only
behavior.

## 2026-10-10 - Phase 1B Non-Actuating NODE-04 Command Foundation

Added an isolated `control_commands` ledger for NODE-04 only. It records a
UUID command ID, `RELAY-01` binding, requested state, idempotency key, bounded
expiry, lifecycle timestamps, and terminal rejection reason. The only states
are `PENDING`, `DELIVERED`, `ACKNOWLEDGED`, `EXPIRED`, and `REJECTED`.

The dedicated server-only `RASID_CONTROL_TOKEN` is separate from the existing
read-only RASID integration token, admin token, and device credential.
Control-service issuance and device poll/acknowledgement routes require direct
HTTPS; no forwarded TLS-header trust was added. Polling redelivers the same
outstanding envelope after a lost response, acknowledgements are idempotent,
and revoking a node rejects its open envelopes.

Every Phase 1B envelope is explicitly `NON_ACTUATING`. No ESP32 source,
running firmware, GPIO25 behavior, local thresholds, hysteresis, dwell timer,
sensor-failure path, node location assignment, or physical device was changed.


## 2026-10-14 - Integration into the RASID repository and NODE-04 HTTPS link

The CPS project (backend, firmware, frontend, simulator, docs and the recorded
`cps.db`) was added to the RASID repository under `CPS-Project/`. Local secrets
(`.env`, `esp32/include/secrets.h`, test TLS keys) were excluded.

NODE-04 was reconnected over a phone hotspot. The firmware's Wi-Fi name needed a
trailing space to match the hotspot SSID. Caddy and the Windows firewall rule were
moved to the hotspot address (172.20.10.12) and scoped to the hotspot subnet.

TLS verification on the ESP32 failed with `X509 - Certificate verification failed`
although the certificate chained to the embedded root. Cause: the ESP32 Arduino core
uses mbedTLS 2.28.7, which cannot match a hostname against an IP-address SAN, and
Caddy's internal certificates carry the IP only as an IP SAN. A leaf certificate signed
directly by the embedded Caddy root, listing the IP as both an IP SAN and a DNS SAN,
resolved it without weakening verification (`setInsecure` is still not used).

The firmware now accepts either `https://` (verified against `LOCAL_ROOT_CA_CERT`) or
plain `http://` backends, so a teammate can run NODE-04 on a private network without
the TLS proxy. `start-cps.bat` and `NODE04_TEAMMATE_SETUP.md` were added.

## 2026-10-15 - Operations UI, simulation center and node monitoring

- **Operational HVAC.** Approved thresholds are read from `server/.env`
  (26 °C reactive, 25 °C normal maximum, +0.5 °C rise, +3 people); code defaults
  stay unapproved. Single-sensor `UNKNOWN` readings are accepted only when
  configured; `SUSPICIOUS` and `INVALID` never are. Temperature trends compare with
  the real CPS reading 5 minutes earlier; crowd trends use a 15-minute in-memory
  history of CAM-C people counts.
- **Dashboard.** Plain-language HVAC card; reading history chart with time axes,
  gaps and full-period paging; heartbeat interval telemetry on the node page and NOC;
  reorganized NOC; inside-and-outside card with live sensor tiles and Riyadh weather;
  coverage map of hall A1; camera status ring; adaptive layout by container width.
- **Simulation Center.** Isometric Expo zone A1.1 with two circulation fans
  (temperature policy, 26 °C on / 24 °C off), two exhaust fans (crowd rule, 16 on /
  8 off), three CCTV cameras, two-way controls, one simulated minute per run, and
  simulated AI detections (fire, armed person, fight) with smoke control.
- **NODE-04 offline watcher.** `server/cps_watch.py` turns CPS node state into
  ONLINE/OFFLINE journal entries; the dashboard raises a high-severity alert and an
  IoT Sensor incident ("CPS Node Offline") and resolves both on recovery.
- **HTTPS ingestion files.** `CPS-Project/gateway/` now holds `gateway.py`, a
  `Caddyfile.example` template and `issue-cert.sh` for the mbedTLS-compatible
  certificate.
