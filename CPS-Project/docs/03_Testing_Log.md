# CPS Project — Testing Log

## Test Status Legend

PASS — Test completed successfully.

FAIL — Test was executed and the expected behavior did not occur.

BLOCKED — Test could not be completed because a required component
was not ready.

NOT TESTED — Test has not yet been executed.

---

# 1. Backend Availability Tests

## T-001 — Start FastAPI Server

Date:

2026-09-25

### Objective

Verify that the FastAPI backend starts successfully.

### Command

python -m uvicorn main:app --reload

### Expected Result

The server should start without application errors.

### Actual Result

Server started successfully.

Output included:

Uvicorn running on http://127.0.0.1:8000

Application startup completed successfully.

### Status

PASS

---

## T-002 — GET /

Date:

2026-09-25

### Objective

Verify that the backend responds to a basic HTTP request.

### Request

GET /

### Expected Result

The backend should return:

{
    "message": "CPS Backend is running"
}

### Actual Result

The expected response was returned.

### Status

PASS

---

## T-003 — FastAPI Swagger Documentation

Date:

2026-09-25

### Objective

Verify that the automatic API documentation is available.

### Request

GET /docs

### Expected Result

FastAPI Swagger UI should be displayed.

### Actual Result

Swagger UI was successfully displayed.

### Status

PASS

---

## T-004 — OpenAPI Schema

Date:

2026-09-25

### Objective

Verify that FastAPI generates the OpenAPI specification.

### Request

GET /openapi.json

### Expected Result

The API OpenAPI schema should be returned.

### Actual Result

The OpenAPI documentation was successfully loaded.

### Status

PASS

---

# 2. Sensor Reading Tests

## T-005 — POST /readings

Date:

2026-09-25

### Objective

Verify that the backend can receive and store a sensor reading.

### Test Data

{
    "node_id": "NODE-01",
    "sensor_id": "TEMP-01",
    "sensor_type": "temperature",
    "value": 24.5,
    "unit": "°C",
    "timestamp": "2026-09-25T10:30:00Z"
}

### Expected Result

The backend should:

1. Accept the request.
2. Validate the data.
3. Store the reading.
4. Return a reading ID.

### Actual Result

The reading was accepted and stored successfully.

The API returned a reading ID.

### Status

PASS

---

## T-006 — Sensor Reading Database Storage

Date:

2026-09-25

### Objective

Verify that received sensor readings are persisted in the SQLite
database.

### Expected Result

A database record should be created for the submitted reading.

### Actual Result

The SQLite database was created and the reading storage flow worked.

### Status

PASS

---

# 3. Node Registration and Provisioning Tests

## T-007 — Node Registration

### Objective

Verify that a new node can be registered in the backend.

### Request

POST /nodes

### Test Data

{
    "node_id": "NODE-01"
}

### Expected Result

A new node should be created in the database.

The node should initially have:

connection_status = OFFLINE

### Actual Result

The node was successfully registered.

The node was initially assigned:

connection_status = OFFLINE

A device-specific credential was generated during provisioning.

### Status

PASS

---

## T-008 — Duplicate Node Registration

### Objective

Verify that an already registered node cannot be registered again.

### Test Data

{
    "node_id": "NODE-01"
}

### Expected Result

The backend should detect that the node already exists and
should not create a duplicate node.

### Actual Result

The backend detected that the node was already registered.

The response indicated:

"Node already registered"

No duplicate node was created.

### Status

PASS

---

## T-009 — Unauthorized Node Registration

### Objective

Determine whether an unauthenticated client can register an
arbitrary node.

### Test Data

{
    "node_id": "FAKE-NODE-01"
}

### Expected Security Behavior

Only an authorized administrator should be able to register
new nodes.

A request without a valid administrator provisioning token
should be rejected.

### Actual Result

The request was rejected because a valid administrator
provisioning token was not provided.

Response:

401 Unauthorized

"Invalid admin provisioning token"

The node was not registered.

### Security Observation

Node provisioning is protected by an administrator provisioning
token.

An unknown client cannot create a node simply by submitting
an arbitrary node_id.

### Status

PASS

---

## T-010 — Authorized Node Provisioning

### Objective

Verify that an authorized administrator can register a new node
using the protected provisioning endpoint.

### Request

POST /nodes

### Test Data

{
    "node_id": "NODE-01"
}

### Expected Security Behavior

A request containing the valid administrator provisioning token
should be allowed to register a new node.

### Actual Result

The node was successfully registered.

The backend generated a random device credential during
provisioning.

The node was initially assigned:

connection_status = OFFLINE

### Security Observation

Node provisioning is separated from normal device communication.

The administrator provisioning token is used to authorize
node registration.

The generated device credential is different from the
administrator provisioning token.

### Status

PASS

---

# 4. Device Credential Tests

## T-011 — Device Credential Generation

### Objective

Verify that a device-specific credential is generated when a
node is provisioned.

### Expected Result

A random device credential should be generated for the node.

The plaintext credential should be provided during the initial
provisioning process.

The backend should store a credential verifier rather than
the plaintext credential.

### Actual Result

A device-specific credential was generated during node
provisioning.

The credential was returned in the provisioning response.

The credential is intended to be used by the device for
subsequent authentication.

### Security Observation

The administrator provisioning token and device credential
are separate credentials.

The administrator token authorizes node provisioning.

The device credential authenticates the individual node.

### Status

PASS

---

## T-012 — Device Credential Protection

### Objective

Verify that the backend does not rely on storing the plaintext
device credential in the database.

### Expected Result

The backend should store a password/credential verifier rather
than the original plaintext credential.

### Actual Result

The node model uses a credential_hash field for the stored
device credential verifier.

Argon2id-based password hashing is used for credential
verification.

The original device credential cannot be recovered from the
stored verifier.

### Security Observation

The device credential is treated as a secret.

The credential is available during the provisioning process,
but the backend stores its verifier rather than the plaintext
secret.

### Status

PASS

---

## T-013 — Missing Device Credential

### Objective

Verify that a node cannot authenticate to a protected endpoint
without providing its device credential.

### Test Scenario

A registered node attempts to submit a heartbeat without the
X-Device-Credential header.

### Expected Result

The request should be rejected.

The heartbeat should not be accepted.

### Actual Result

The request was rejected because the required device credential
was not provided.

### Status

PASS

---

## T-014 — Invalid Device Credential

### Objective

Verify that a registered node cannot authenticate using an
incorrect device credential.

### Test Scenario

NODE-01 was registered with a device-specific credential.

An incorrect credential was submitted to the heartbeat endpoint.

### Expected Result

The backend should reject the request.

### Actual Result

The backend returned:

401 Unauthorized

"Invalid node credentials"

The heartbeat was not accepted.

### Security Observation

Knowing the node_id alone is not sufficient to authenticate
to the protected heartbeat endpoint.

### Status

PASS

---

## T-015 — Valid Device Credential

### Objective

Verify that a legitimate registered node can authenticate using its
correct device credential.

### Expected Behavior

A registered ACTIVE node presenting its valid device credential
should be authenticated successfully.

The heartbeat should then be processed.

### Actual Result

NODE-01 successfully authenticated using its valid device credential.

The heartbeat was accepted and the node connection status was
updated to ONLINE.

### Status

PASS

---
# 5. Heartbeat Tests

## T-016 — Heartbeat Request Validation

### Objective

Verify the expected structure and validation of a heartbeat request.

### Expected Structure

{
    "node_id": "NODE-01",
    "timestamp": "2026-09-25T10:40:00Z"
}

### Expected Result

A valid heartbeat should be accepted when the node is authenticated
using its valid device credential.

### Actual Result

The heartbeat request was successfully validated and processed.

The backend updated last_seen and the node connection status.

### Status

PASS
---

## T-017 — Unknown Node Heartbeat

### Objective

Verify that an unregistered node cannot submit a heartbeat.

### Test Scenario

A node_id that does not exist in the database attempts to submit
a heartbeat.

### Expected Result

The backend should reject the request.

The unknown node should not be automatically created.

### Actual Result

The backend rejected the heartbeat from the unknown node.

The unknown node was not automatically registered.

### Status

PASS

---

# 6. Authorization Tests

## T-018 — Device Authorization

### Objective

Verify that an authenticated device can only perform operations
permitted to the device.

### Expected Behavior

A device should be allowed to:

- Submit heartbeat
- Submit sensor readings

A device should not be allowed to perform administrator operations
such as:

- Register another node
- Revoke another node
- Reactivate another node
- Modify node provisioning

### Actual Result

Device credentials are accepted for protected device operations.

Administrator operations require the separate administrator
provisioning token.

The device credential is therefore not treated as an administrator
credential.

### Status

PASS

---

## T-019 — Administrator Authorization

### Objective

Verify that node provisioning is restricted to an authorized
administrator.

### Expected Behavior

Valid administrator provisioning token:

→ Request accepted

Missing administrator token:

→ Request rejected

Invalid administrator token:

→ Request rejected

### Current Implementation

The /nodes provisioning endpoint requires an administrator
provisioning token.

### Status

PASS

---

# 7. Node Lifecycle Tests

## T-020 — Node Deprovisioning / Revocation

### Objective

Verify that an administrator can revoke a registered node and prevent
the node from continuing to authenticate using its device credential.

### Test Scenario

A registered node was selected and the administrator used:

POST /nodes/{node_id}/revoke

### Expected Result

The backend should:

1. Authenticate the administrator.
2. Change the node status to REVOKED.
3. Record revoked_at.
4. Prevent the revoked node from authenticating to protected
   device endpoints.

### Actual Result

The node was successfully revoked.

The node status changed to REVOKED and the revocation timestamp was
recorded.

The revoked node could no longer authenticate using its previous
device credential.

### Status

PASS

## T-021 — Credential Re-Provisioning

### Objective

Verify that a revoked node can be reactivated through an authorized
administrative process and receive a new device credential.

### Test Scenario

The administrator used:

POST /nodes/{node_id}/reactivate

### Expected Result

The backend should:

1. Authenticate the administrator.
2. Allow reactivation of the revoked node.
3. Generate a new device credential.
4. Replace the stored credential verifier.
5. Change the node status to ACTIVE.
6. Invalidate the previous device credential.

### Actual Result

The node was successfully reactivated.

A new device credential was generated and returned through the
reactivation response.

The node returned to ACTIVE status.

The credential was rotated as part of the reactivation process.

### Status

PASS

# 8. Node Health Tests

## T-022 — Node Offline Detection

### Objective

Verify that the backend can distinguish between:

- ONLINE
- STALE
- OFFLINE

based on the time since the node's latest heartbeat.

### Test Scenario

Heartbeat requests were sent for NODE-01 and the resulting
connection status was observed.

The backend was also tested with older last_seen values.

### Expected Result

The node should transition according to the configured timeout
rules.

### Actual Result

The backend successfully calculated node connection status using
last_seen.

The following states were observed:

- ONLINE after a recent heartbeat.
- STALE when the heartbeat became older.
- OFFLINE when the heartbeat exceeded the configured threshold.

### Status

PASS
# 9. Event-Based Communication Tests

## T-023 — Event-Based Alert

### Objective

Verify that a node can immediately report an important event.

Example:

NETWORK_DEGRADED

### Expected Result

The backend should receive the event and record/process it.

### Current Status

The event endpoint has not yet been implemented.

### Status

NOT IMPLEMENTED



---

# 10. Sensor Health Tests

## T-024 — Sensor Health Validation

### Objective

Verify that the backend can identify potentially abnormal or
unreliable sensor readings.

### Example Scenario

TEMP-01 = 24.2°C

TEMP-02 = 24.4°C

TEMP-03 = 32.0°C

TEMP-04 = 24.3°C

### Expected Result

The system should be able to identify TEMP-03 as a potentially
suspicious outlier rather than immediately treating 32°C as
the environmental state.

### Current Status

Sensor health and outlier detection logic have not yet been
implemented.

### Status

NOT IMPLEMENTED

---

# 11. Environmental State Tests

## T-025 — Environmental State Estimation

### Objective

Verify that multiple sensor readings can be combined to estimate
the environmental condition.

### Expected Behavior

Multiple related sensor readings should be evaluated together.

For example:

TEMP-01 = 31.8°C

TEMP-02 = 32.0°C

TEMP-03 = 31.9°C

TEMP-04 = 32.1°C

The system may determine that the temperature increase is
consistent across multiple sensors.

### Current Status

Environmental state estimation has not yet been implemented.

### Status

NOT IMPLEMENTED

---

# 12. Crowd / AI Integration Tests

## T-026 — People Count Input

### Objective

Verify that the CPS backend can receive people-count information
from the CCTV/AI component.

### Expected Data

{
    "zone_id": "ZONE-01",
    "people_count": 50,
    "timestamp": "...",
    "confidence": 0.95,
    "status": "VALID"
}

### Expected Result

The backend should receive and process the people-count
information.

### Current Status

CCTV/AI integration has not yet been implemented.

### Status

NOT IMPLEMENTED

---

## T-027 — Occupancy / Density Calculation

### Objective

Verify that the CPS can calculate occupancy or density from
people-count information and configured zone limits.

### Expected Result

The CPS should calculate the current occupancy/density and
provide the resulting state to the decision logic.

### Current Status

Not implemented.

### Status

NOT IMPLEMENTED

---

# 13. Decision and Action Tests

## T-028 — Decision Engine

### Objective

Verify that validated environmental and occupancy information
can be evaluated by the decision engine.

### Expected Result

The decision engine should evaluate the current system state
and determine whether an action is required.

### Current Status

Not implemented.

### Status

NOT IMPLEMENTED

---

## T-029 — Action Manager

### Objective

Verify that the system can execute an appropriate action based
on the decision engine output.

Potential actions may include:

- Adjust environmental controls
- Trigger an alert
- Notify an operator
- Change system state

### Expected Result

A valid decision should result in the appropriate controlled
action.

### Current Status

Not implemented.

### Status

NOT IMPLEMENTED

---

# 14. Transport Security Tests

## T-030 - HTTPS / TLS

### Objective

Verify that production API communication is protected using
HTTPS/TLS.

### Expected Result

Verify successful encrypted API communication and reject invalid server
trust or hostname identity.

### Verified MVP Configuration

Uvicorn is started with certificate and private-key files from a temporary
test directory. The integration suite verified:

- A trusted CA and matching hostname returns HTTP 200 over HTTPS.
- An untrusted CA is rejected.
- A hostname mismatch is rejected.
- Plain HTTP is rejected by the TLS-only listener.
- The maintained simulator requires an HTTPS URL and passes the configured CA
  bundle to Requests without disabling verification.

Test certificates and private keys are generated in temporary directories;
none are stored in the repository.

### Execution Result

`python -m pytest -p no:cacheprovider backend/tests/test_https_transport.py`
completed with **5 passed**.

### Status

PASS

Full backend suite: `python -m pytest -p no:cacheprovider backend/tests`
completed with **33 passed**.

---

# 15. Production Security Requirements

## T-031 — Secure Credential Management

### Objective

Verify that sensitive credentials are not hardcoded into the
application source code.

### Expected Result

Secrets such as:

- Administrator provisioning token
- Device credentials
- Database credentials

should be managed securely through an appropriate secret
management mechanism.

### Current State

The administrator provisioning token is supplied through an
environment variable during development.

Device credentials are generated during node provisioning.

### Production Requirement

A production-grade secret management approach must be selected
before deployment.

### Status

IN PROGRESS

---

## T-032 — Production Database

### Objective

Verify that the backend uses an appropriate production database
rather than the development SQLite database.

### Current Development Database

SQLite

Database:

cps.db

### Expected Production Requirement

A production database should be selected and configured before
deployment.

### Status

NOT IMPLEMENTED

---

# 16. Current Security and Backend Test Summary

## Completed

### Backend

- Backend availability
- GET / endpoint
- Swagger documentation
- OpenAPI schema

### Sensor Telemetry

- Sensor reading submission
- Sensor reading database storage
- GET /readings
- GET /nodes/{node_id}/readings

### Node Management

- Node registration
- Duplicate node registration prevention
- Administrator authentication
- GET /nodes
- GET /nodes/{node_id}
- Node revocation
- Node reactivation
- Credential re-provisioning / rotation

### Device Authentication

- Valid device credential authentication
- Missing device credential rejection
- Invalid device credential rejection
- Unknown-node authentication rejection
- Protected heartbeat
- Protected sensor readings

### Heartbeat / Node Health

- Heartbeat request validation
- Heartbeat storage
- Heartbeat history retrieval
- ONLINE / STALE / OFFLINE connection-state calculation

### Authorization

- Administrator authorization
- Separation between administrator credentials and device credentials
- Device access to protected device operations

---

## Pending / Not Implemented

- Event-based alert endpoint
- Network degradation detection
- Sensor health validation
- Environmental state estimation
- CCTV / AI integration
- Occupancy / density calculation
- Decision engine
- Action manager
- HTTPS / TLS
- Production secret management
- Production database
- Secure ESP32 credential storage
- Replay protection
- Production administrator authentication / RBAC
## T-033 — Get All Nodes

### Objective

Verify that the backend can retrieve all registered CPS nodes and
their current lifecycle and connection information.

### Request

GET /nodes

### Expected Result

The endpoint should return registered nodes including:

- node_id
- status
- connection_status
- last_seen
- provisioned_at
- revoked_at

### Actual Result

The endpoint successfully returned the registered nodes and their
current status information.

Multiple nodes were displayed, including NODE-01, NODE-02, and
NODE-11.

### Status

PASS
## T-034 — Get Individual Node

### Objective

Verify that the backend can retrieve information for a specific
registered node.

### Request

GET /nodes/{node_id}

### Test Cases

- Existing node
- Nonexistent node
- Invalid administrator token

### Expected Result

An existing node should return its current information.

A nonexistent node should return HTTP 404.

An invalid administrator token should return HTTP 401.

### Actual Result

The endpoint successfully returned information for the requested
node.

Administrative authentication was enforced.

### Status

PASS

## T-035 — Get All Sensor Readings

### Objective

Verify that stored sensor readings can be retrieved from the backend.

### Request

GET /readings

### Expected Result

The endpoint should return stored readings including:

- id
- node_id
- sensor_id
- sensor_type
- value
- unit
- timestamp

### Actual Result

The endpoint successfully returned the stored sensor readings.

Readings from different nodes were visible when they had been
submitted to the database.

### Status

PASS

## T-036 — Get Sensor Readings by Node

### Objective

Verify that sensor readings can be retrieved for one specific CPS
node.

### Request

GET /nodes/{node_id}/readings

### Test Cases

- NODE-01
- NODE-11
- NODE-02

### Expected Result

The endpoint should return only readings associated with the
requested node.

If the node has no stored readings, the endpoint should return an
empty result.

### Actual Result

NODE-01 returned its stored readings.

NODE-11 returned its stored reading.

NODE-02 returned no readings because no sensor readings had been
submitted for NODE-02.

The endpoint correctly filtered the readings by node_id.

### Status

PASS

## T-037 — Heartbeat History Retrieval

### Objective

Verify that stored heartbeat records can be retrieved from the
backend.

### Request

GET /heartbeats

### Expected Result

The endpoint should return stored heartbeat records including:

- id
- node_id
- timestamp
- received_at

### Actual Result

The endpoint successfully returned the stored heartbeat history.

Multiple heartbeat records for NODE-01 were retrieved from the
database.

### Status

PASS

## Phase 1 Authorization Tests

Automated authorization coverage in `backend/tests/test_authorization.py`
uses an isolated in-memory SQLite database. It covers admin access,
device-to-node binding, device denial on GET routes, valid device
submissions, revoked-device rejection, and credential non-disclosure.

The full suite, including authorization and HTTPS tests, completed with
**58 passed** using:

```text
python -m pytest -v
```

## Sensor Reading Integrity Tests

The deterministic integrity suite covers individual ranges and types,
same-node and cross-node median comparisons, group/type/unit isolation,
freshness and future timestamp filtering, configurable thresholds,
credential-to-node binding, revoked nodes, persistence/migration, and
authorized API output.

```text
python -m pytest tests/test_reading_integrity.py -v
```

**Result: 25 passed.** The full backend test suite completed with **58
passed**, including authorization and HTTPS transport tests.

## Sensor Integrity Verification (2026-09-29)

Backend verification results:

```text
python -m pytest tests/test_reading_integrity.py -v
25 passed, 0 failed, 0 skipped

python -m pytest -v
58 passed, 0 failed, 0 skipped, completed in 18.10s
```

Manual cross-node comparison checks:

- NODE-01 approximately 40?C and NODE-02 approximately 25?C:
  `SUSPICIOUS`, reason `cross-node peer deviation`.
- NODE-01 approximately 25?C and NODE-02 approximately 25?C:
  `NORMAL`, reason `cross-node peers agree`.

Manual same-node checks demonstrated both `NORMAL` and `UNKNOWN` outcomes.

## T-038 - Physical ESP32 Connection and Firmware Upload (2026-09-29)

### Objective

Verify the physical ESP32 connection to the development environment and
upload of the default PlatformIO firmware.

### Actual Result

Windows detected the ESP32 through the Silicon Labs CP210x USB-to-UART
bridge on COM3. PlatformIO successfully uploaded the firmware through COM3.
`esptool` detected the ESP32-D0WD-V3 (revision v3.1), completed writing,
and verified the written image hash. The board performed a hard reset after
upload, and PlatformIO reported `[SUCCESS]`.

This test verifies ESP32 connectivity and firmware upload only. BME280
readings, Wi-Fi, HTTPS, backend communication, and sensor integration have
not been tested.

### Status

PASS

## 2026-09-30 - Admin Configuration Verification

The focused configuration tests exercised `.env` loading, process-environment precedence, startup failure when the token is missing, authorization with correct and incorrect admin tokens, and a deterministic SQLite path.

```text
backend\.venv\Scripts\python.exe -m pytest backend\tests\test_admin_configuration.py -v
6 passed, 0 failed, 0 skipped

backend\.venv\Scripts\python.exe -m pytest -v
64 passed, 0 failed, 0 skipped, completed in 24.34s

py_compile over all backend Python files (excluding the virtual environment)
9 files compiled successfully
```

## V2 Foundation Verification (2026-10-01)

Added migration coverage for preserving existing node, reading, and heartbeat
rows; idempotent catalogue seeding; one-time NODE-03 assignment; unassigned
NODE-04/NODE-11; and historical reading location remaining NULL. Added API
coverage for location authorization/validation, reading location snapshots,
server-receipt heartbeat freshness, optional network observation validation,
and filtered cursor-paginated history.

The full backend suite completed with 95 passed, 0 failed, and 0 skipped on
2026-10-01. Coverage includes the additive/idempotent migration, protected
location and weather reads, location snapshots, heartbeat freshness and
network observations, filtered history, and the explicit unconfigured
weather response. Stored naive UTC weather timestamps serialize with an
explicit `+00:00` marker.

## T-039 - Expanded Device-Reported Network Observations (2026-10-05)

Backend tests cover the five optional Wi-Fi fields, value validation,
serialization through the existing protected heartbeat history API,
backwards-compatible payloads without the fields, and additive migration of
an older heartbeat table.

```text
backend\.venv\Scripts\python.exe -m pytest -q
134 passed, 0 failed

frontend: npm.cmd run build
passed

frontend: npm.cmd run lint
passed with four existing warnings in useDashboardPolling.ts and Primitives.tsx

esp32: pio run
SUCCESS (NodeMCU-32S compile; placeholder secrets.example.h used temporarily)
```

No firmware was uploaded and no physical NODE-03 heartbeat was received for
this verification. Therefore actual SSID, BSSID, channel, gateway, and subnet
values, and their display from a live heartbeat, remain unverified. The
temporary compile-only `secrets.h` was removed after the successful build.

## T-040 - Scoped RASID Read-Only Integration Authentication (2026-10-08)

Focused verification used a project-local pytest temporary directory:

```text
backend\.venv\Scripts\python.exe -m pytest -q tests\test_integration_state.py tests\test_admin_configuration.py --basetemp .pytest-integration-tmp
26 passed in 1.27s
```

The focused suite verifies the dedicated `X-Rasid-Integration-Token` path,
missing and invalid credential rejection, valid NODE-03 state access, admin
and device credential rejection at the integration endpoint, integration-token
rejection at normal read/provisioning routes, missing-token configuration
failure, process-environment precedence, the NODE-03 allowlist, response
minimization, bounded readings, and no-write behavior.

Full-suite verification was also run with a project-local temporary directory:

```text
backend\.venv\Scripts\python.exe -m pytest -q --basetemp .pytest-full-tmp
1 failed, 142 passed in 25.32s
```

The sole failure is pre-existing and outside this authentication change:
`tests/test_https_transport.py` references the absent local file
`simulator/simulator_before_offline_buffer.py`. The integration and
configuration tests passed. The system-default temporary directory was not
usable in this execution environment, so the project-local `--basetemp`
override was required.

## T-041 - Maintained Simulator HTTPS Transport Regression (2026-10-08)

The HTTPS transport regression test was updated to load only the maintained
`simulator/simulator.py`. The deleted, untracked
`simulator/simulator_before_offline_buffer.py` was a legacy backup mistakenly
included as a parameterized test target; it is not a supported simulator
implementation and was not recreated.

Verified commands:

```text
backend\.venv\Scripts\python.exe -m pytest -q tests\test_https_transport.py --basetemp ..\.pytest-https-transport-tmp
5 passed in 7.39s

backend\.venv\Scripts\python.exe -m pytest -q -p no:cacheprovider --basetemp ..\.pytest-full-verified-tmp
142 passed in 24.61s
```

The focused test continues to verify that the maintained simulator requires a
valid HTTPS URL and forwards a configured private CA bundle. The suite also
verifies trusted-CA success, untrusted-CA rejection, hostname-mismatch
rejection, and rejection of plain HTTP by the TLS listener.

## T-042 - RASID Integration Target Retargeting (2026-10-08)

The scoped read-only integration target was moved from `NODE-03` to
`NODE-04`. Focused integration coverage verifies successful `NODE-04` access
with `X-Rasid-Integration-Token`, preserves the bounded response and no-write
checks, and verifies that `NODE-03` receives `403` with the same valid token.

```text
backend\.venv\Scripts\python.exe -m pytest -q tests\test_integration_state.py --basetemp ..\.pytest-integration-node04-tmp
20 passed in 1.03s

backend\.venv\Scripts\python.exe -m pytest -q -p no:cacheprovider --basetemp ..\.pytest-full-node04-tmp
143 passed in 28.71s
```

## T-043 - NODE-04 Integration Network Observation Contract (2026-10-08)

Focused integration tests verified the strictly allowlisted, nullable
`network_observation` response for the existing NODE-04 state endpoint.
Coverage includes populated values, null latest-heartbeat values without
fallback to older observations, no heartbeat, offline historical observations,
existing integration authentication and NODE-04 allowlist isolation, response
minimization, and no-write behavior.

```text
backend\.venv\Scripts\python.exe -m pytest -q backend\tests\test_integration_state.py -p no:cacheprovider --basetemp .pytest-noc-integration-tmp
43 passed in 2.82s
```

## T-044 - Phase 1B Non-Actuating Command Foundation (2026-10-10)

All tests ran from an isolated temporary copy of the CPS backend so the
working runtime SQLite database and credentials were not touched. The focused
suite covers separate control authentication, HTTPS-only command endpoints,
NODE-04 binding, idempotent issuance and acknowledgement, duplicate polling,
expiry, revocation, malformed requests, and non-actuating response semantics.

```text
backend\tests\test_control_command_foundation.py
8 passed in 3.75s

All backend tests except HTTPS transport
169 passed in 28.10s

backend\tests\test_https_transport.py
5 passed in 8.06s

Total: 174 passed
```

`py_compile` passed for `main.py`, `models.py`, and `database.py` in the same
isolated copy. No ESP32 flashing, command polling by a physical device, GPIO
write, or physical relay/fan test was performed.


## T-045 - Integrated Platform Automated Suites (2026-10-15)

CPS backend tests ran from an isolated temporary copy of `CPS-Project/` without
the runtime database or `.env`.

```text
CPS backend   backend/tests (no .env, no admin token)         181 passed
RASID server  server/tests (unittest)                         84 passed
Dashboard     web npm test (14 suites) + CPS workspace suites all passed
              tsc --noEmit                                    no errors
```

A first run without an admin token failed one test:
`test_integration_state.py::test_integration_credential_cannot_authorize_other_routes`
returned HTTP 500 instead of 401, because admin routes fail closed when
`ADMIN_PROVISIONING_TOKEN` is unset and the test's fixture relied on a developer `.env`.
The fixture now sets its own admin token (distinct from the integration token), so the
test checks the intended rule — the integration credential is rejected by admin routes —
on any machine. Status: PASS.

## T-046 - NODE-04 HTTPS Ingestion Through Caddy (2026-10-14)

ESP32 NODE-04 on the hotspot, Caddy on 172.20.10.12:8443, gateway on
127.0.0.1:8013, CPS backend on 127.0.0.1:8101 (main-version copy).

| Step | Result |
| --- | --- |
| Caddy `tls internal` certificate (IP SAN only) | FAIL — `X509 - Certificate verification failed` (-9984) |
| Leaf signed by the embedded root, IP SAN + DNS SAN | PASS — heartbeat and readings HTTP 200 |
| NODE-04 state through RASID `/api/cps/node-state` | PASS — ONLINE with fresh readings |

Status: PASS.

## T-047 - NODE-04 Offline Alert and Incident (2026-10-15)

Live test: the gateway was stopped so heartbeats stopped reaching CPS.

| Step | Result |
| --- | --- |
| Last heartbeat 16:26:22 UTC; CPS OFFLINE after 90 s | OFFLINE journal entry at 16:28:00 UTC |
| Dashboard bell | "Node NODE-04 offline", severity high, active |
| Incidents → source IoT Sensor | "CPS Node Offline" incident, open |
| Heartbeats resumed | ONLINE entry; alert cleared, incident resolved |

Unit tests cover first-read silence, STALE not alerting, OFFLINE alerting once,
recovery, unreachable CPS after two polls, and incident creation/resolution.
Status: PASS.

## T-048 - Simulation Center Scenarios (2026-10-15)

Browser-driven with real mouse events against the built dashboard.

| Scenario | Result |
| --- | --- |
| Heat +2 ×2, run, apply | both circulation fans ON |
| 18 visitors, apply exhaust | both exhaust fans ON; below 8 visitors → OFF |
| Node disconnected | no recommendation for either fan group |
| Fire / armed person / fight | CAM-2 / CAM-C / CAM-1 alarm, detection box and label |
| Fire → smoke control | exhaust ON, circulation OFF |
| Heat button after cooling | initially FAIL (global `.heat` style disabled pointer events); PASS after class rename |

Status: PASS.
