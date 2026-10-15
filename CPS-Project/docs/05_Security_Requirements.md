# 05 — Security Requirements

## Device Identity

Each CPS node must have a unique node identity.

The node_id is an identifier and must not be treated as an
authentication credential.

Each node must also have a unique device credential used to
authenticate protected communication with the backend.

A node must not be able to impersonate another registered node by
changing its node_id.

---

## Authentication

### Phase 1 MVP Route Policy

The MVP uses the existing shared administrator provisioning token for
management and read access. `X-Admin-Token` is required for:

- `GET /nodes`
- `GET /nodes/{node_id}`
- `GET /readings`
- `GET /nodes/{node_id}/readings`
- `GET /heartbeats`
- Node provisioning, revocation, and reactivation

`GET /api/v1/integration/nodes/{node_id}/state` and
`GET /api/v1/integration/nodes/{node_id}/heartbeats` are separate from the
administrator routes. They require the dedicated server-to-server
`X-Rasid-Integration-Token` credential and an explicit server-side allowlist
that currently permits only `NODE-04`.

Device credentials are node-specific and are accepted only by `POST /readings`
and `POST /heartbeat`. A device credential must verify against
the stored verifier for the node named in the request. The authenticated
database node is the canonical identity used for the operation; a device
cannot submit data for another node. Device credentials do not authorize
any GET endpoint. GET responses must use explicit fields and must never
include credential verifiers or plaintext credentials.

This is the MVP policy; it does not introduce user accounts, OAuth, or RBAC.

The integration routes are narrow, read-only contracts with a dedicated RASID
service credential. That credential authorizes only the two documented
integration routes and must remain server-side; it is not an administrator
identity and must never be exposed to a browser.

The system uses separate authentication mechanisms for:

### Administrator

Administrative node-management operations require an administrator
provisioning credential.

This protects operations such as:

- Node registration
- Node revocation
- Node reactivation
- Node credential re-provisioning

### CPS Device

Protected device operations require the node's device credential.

These currently include:

- Heartbeat submission
- Sensor reading submission

Invalid, missing, revoked, or unknown-node credentials must be
rejected.

---

## Authorization

Administrator and device authentication are separate security
boundaries.

A device credential must not provide access to administrator
operations.

A device should only be permitted to perform operations required
for normal CPS operation, such as:

- Sending heartbeat messages
- Sending sensor readings

Administrator operations must require administrator authentication.

### Production Requirement

A production deployment should implement stronger administrator
identity management and role-based access control (RBAC).

---

## HTTPS / TLS

The MVP backend can be run with Uvicorn's HTTPS listener. The simulator
requires an HTTPS backend URL and keeps certificate-chain and hostname
verification enabled. Production communication must use HTTPS/TLS; do not
expose a plaintext HTTP listener to CPS clients.

TLS must protect:

- Device-to-backend communication
- Administrator-to-backend communication
- API credentials
- Sensor telemetry
- Heartbeat messages

For a controlled MVP network, clients may trust a private CA. The server
certificate must identify the configured backend hostname in its Subject
Alternative Name. Keep the CA certificate on clients and keep the server's
private key outside the repository with access restricted to the service.
For public deployments, use a publicly trusted certificate and a stable
DNS name. Certificate issuance, renewal, expiry monitoring, and key
rotation remain deployment responsibilities.

TLS is server-authenticated only in this phase. Existing
`X-Device-Credential` API authentication remains in place; client
certificates/mTLS are not required. Clients must reject untrusted,
expired, or hostname-mismatched certificates. Disabling verification is
not permitted.

---

## API Security

Protected API endpoints must require appropriate authentication.

Current protected device operations include:

- POST /heartbeat
- POST /readings

Administrative node-management operations must also require
administrator authentication.

API responses must not expose:

- Device credential secrets
- Credential hashes/verifiers
- Administrator credentials
- Other sensitive internal security information

Production deployment should also include appropriate rate limiting,
secure headers, and other API hardening controls.

---

## Input Validation

All API input must be validated before processing.

Validation must cover:

- node_id
- sensor_id
- sensor_type
- sensor value
- unit
- timestamps
- heartbeat data
- administrative parameters

Malformed or unexpected input must be rejected safely.

Production hardening should include additional validation and abuse
testing.

---
---

## Sensor Data Trust and Hierarchical Validation

### Implemented MVP Integrity Controls

The backend validates individual temperature, humidity, and pressure
readings, then compares eligible peers on the same node and across nodes.
Comparison eligibility requires the same measurement type, compatible
unit, configured comparison group, and a timestamp within the configured
freshness window. Cross-node comparisons are limited to group members;
sensor type alone does not establish a physical relationship.

The implementation uses the median of fresh peer observations. It excludes
the current sensor, future observations, stale readings, mismatched units,
and peers outside the configured group. Current unit matching is limited to
compatible representations of Celsius (`C` and `°C`), percent (`%`), and
hectopascals (`hPa`); it does not convert units.

Out-of-range values and unsupported types/units are recorded as `INVALID`.
Valid readings with no eligible peers are `UNKNOWN`; peer agreement is
`NORMAL`; sufficient disagreement is `SUSPICIOUS`. A suspicious result
means the reading needs investigation and is not proof of device or sensor
compromise. Authorized reading APIs expose the validation status,
confidence, and reason without returning credentials or credential hashes.

The 60-second default freshness window and temperature 2.0°C, humidity 5
percentage-point, and pressure 10 hPa tolerances are prototype engineering
assumptions. They are not values mandated by NIST, IEC, ISA, or another
standard. NIST measurement guidance informs the need to account for
measurement uncertainty; ISA/IEC 62443 informs the risk-based cybersecurity
context, not the numerical tolerances. See [NIST TN 1900](https://www.nist.gov/publications/simple-guide-evaluating-and-expressing-uncertainty-nist-measurement-results)
and the [ISA/IEC 62443 series](https://www.isa.org/standards-and-publications/isa-standards/isa-iec-62443-series-of-standards).

Thresholds and freshness can be configured using environment variables.
Comparison-group membership is configured with
`CPS_SENSOR_COMPARISON_GROUPS`, a JSON mapping of node IDs to sensor IDs
and group names. These values require future calibration against actual
sensor specifications, calibration records, and measurement uncertainty.

Confidence is stored as a small deterministic heuristic tier to indicate
integrity evidence. It is not a probability or calibrated uncertainty
estimate. The MVP does not maintain persistent sensor fault/recovery states,
perform unit conversion, or manage comparison groups through an API.

Authentication of a CPS node does not automatically mean that its sensor
measurements are trustworthy.

The system must distinguish between:

- Device identity
- Device authentication
- Sensor health
- Reading trust
- Environmental state

An authenticated node may still produce faulty, anomalous, or compromised
sensor measurements.

### Sensor-Level Validation

When multiple sensors within the same node measure the same or related
environmental parameter, their readings should be compared.

For example:

NODE-01

- Temperature Sensor 01 → 24.2°C
- Temperature Sensor 02 → 24.4°C

The readings show reasonable local agreement.

If the readings significantly disagree:

- Temperature Sensor 01 → 24.3°C
- Temperature Sensor 02 → 32.1°C

the system must not immediately treat 32.1°C as the environmental state.

Instead, the disagreement should be treated as a potential sensor anomaly.

Possible causes include:

- Sensor malfunction
- Poor electrical connection
- Temporary measurement error
- Local heat source
- Calibration issue
- Genuine localized environmental change

### Node-Level and Neighbor Validation

Agreement between sensors within one node does not guarantee that the node
itself is reporting the correct environmental condition.

When multiple nodes are deployed in the same monitored zone, measurements
should also be compared with physically or spatially neighboring nodes.

Neighbor relationships should represent physical proximity rather than
simply network connectivity.

For example:

NODE-01 → approximately 24°C
NODE-02 → approximately 24°C
NODE-03 → approximately 32°C

If NODE-03 has internally consistent sensor readings but significantly
differs from multiple nearby nodes, its measurements should be treated as
suspicious rather than automatically accepted.

The system should prefer multiple neighboring observations when available
instead of relying on a single neighboring node.

A robust statistic such as the median may be used to establish a local
reference.

### Reading Trust

The system should preserve the original sensor reading while separately
recording its validation result.

For example:

```text
Raw Reading: 32.0°C
Validation Status: SUSPICIOUS
Confidence: LOW

## Node Registration

Node registration must be an administrator-controlled operation.

The backend must:

1. Authenticate the administrator.
2. Validate the requested node information.
3. Prevent duplicate node registration.
4. Generate or provision a unique device credential.
5. Store only the protected credential verifier.
6. Return the device credential only through the secure provisioning
   process.

A node must not be automatically registered merely because it sends
a heartbeat or sensor reading.

---

## Credential Management

Device credentials are treated as sensitive secrets.

The backend stores a protected credential verifier rather than the
plaintext device credential.

Device credentials must:

- Be unique per node.
- Not be exposed through normal API responses.
- Be invalidated when a node is revoked.
- Be rotated when a node is reactivated.

The current implementation uses credential rotation during node
reactivation.

### Production Requirements

- Secure credential storage on the ESP32.
- Secure administrative secret management.
- Credential rotation procedures.
- Protection against credential disclosure.
- Consideration of replay-resistant authentication.

---

## Event Security

Event-based communication is planned but has not yet been
implemented.

When implemented, events must:

- Require appropriate device authentication.
- Be associated with a registered node.
- Validate event type and payload.
- Prevent unauthorized event injection.
- Record sufficient information for investigation.

Examples include:

- NETWORK_DEGRADED
- SENSOR_FAILURE
- SECURITY_EVENT

---

## Database Security

The current development environment uses SQLite.

The database must protect:

- Node identities
- Device credential verifiers
- Sensor readings
- Heartbeat history
- Node lifecycle information

Sensitive database fields must not contain plaintext credentials.

Production deployment requires:

- A production database solution.
- Appropriate database access controls.
- Secure database credentials.
- Backup and recovery procedures.
- Database monitoring.

---

## Logging

Security-relevant operations should be logged.

Examples include:

- Node registration
- Failed authentication
- Successful authentication
- Node revocation
- Node reactivation
- Credential rotation
- Invalid API requests
- Security events

Logs must not contain plaintext device credentials,
administrator credentials, or other sensitive secrets.

Production logging should support investigation and auditing.

---

## Monitoring

The backend should monitor CPS communication and node health.

Current monitoring includes:

- Heartbeat processing
- last_seen tracking
- ONLINE state
- STALE state
- OFFLINE state

Future monitoring should include:

- Authentication failures
- Repeated invalid credentials
- Unexpected node behavior
- Network degradation
- Sensor failures
- Security events
- API abuse

Monitoring should generate actionable alerts where appropriate.

---

## Threat Model

The system should consider threats including:

### Node Impersonation

An attacker attempts to use a known node_id to impersonate a
legitimate node.

**Control:**

Node identity alone is not sufficient for authentication. Device
credentials are required.

### Unauthorized Node Registration

An attacker attempts to register a fake node.

**Control:**

Node provisioning requires administrator authentication.

### Credential Theft

An attacker obtains a device credential.

**Controls:**

- Credential verification on the backend.
- Credential rotation.
- Node revocation.
- Secure credential storage requirements.

### Sensor Data Injection

An attacker attempts to submit fake sensor readings.

**Controls:**

- Device authentication.
- Node-to-credential association.
- Input validation.

### Heartbeat Spoofing

An attacker attempts to make an offline node appear online.

**Controls:**

- Device authentication.
- last_seen tracking.
- Connection-state calculation.

### Unauthorized Administrative Operations

An attacker attempts to revoke, reactivate, or provision nodes.

**Control:**

Administrative operations require administrator authentication.

### Replay Attacks

An attacker captures and replays previously valid device requests.

**Current Status:**

Replay protection is not yet implemented.

**Production Requirement:**

A replay-resistant mechanism should be introduced, such as
appropriate timestamps, nonces, or request signing.

---

## Security Testing

Security testing must verify both implemented controls and remaining
security requirements.

Current testing includes:

- Unauthorized node registration
- Device credential validation
- Unknown-node rejection
- Invalid credential rejection
- Heartbeat authentication
- Sensor reading authentication
- Node revocation
- Node reactivation
- Credential rotation
- Node connection-state calculation
- Node retrieval
- Per-node sensor reading retrieval

Remaining security testing includes:

- HTTPS/TLS
- Replay protection
- ESP32 credential storage
- Production administrator authentication
- RBAC
- Network degradation
- Event security
- Production deployment configuration
- Final penetration testing

## Local Admin Token Configuration (Implemented 2026-09-30)

For local development, the backend loads `ADMIN_PROVISIONING_TOKEN` from the
process environment or the project-root `.env` file. The process environment
takes precedence. Application startup fails with a generic error if the
setting is missing or blank; the token value is never included in that error.
The checked-in `.env.example` contains an empty placeholder only, and the
repository `.gitignore` excludes the real `.env`. Do not put a real token in
source code or commit `.env`.

The admin token remains a shared static secret with no expiration mechanism.
Changing it requires updating local configuration and restarting the backend.
Use HTTPS whenever it crosses a network. This local configuration mechanism
does not add operator identities, token rotation, or a secrets manager.

## RASID Integration Token Configuration (Implemented 2026-10-08)

`RASID_INTEGRATION_TOKEN` is a separate, server-only secret for the narrow
read-only routes `GET /api/v1/integration/nodes/{node_id}/state` and
`GET /api/v1/integration/nodes/{node_id}/heartbeats`. CPS loads it
from the process environment or project-root `.env`; process environment
values take precedence. Missing or blank configuration leaves only this
integration route unavailable with a generic `503`; it does not change
administrator or device routes. The credential is supplied in
`X-Rasid-Integration-Token`, compared with `secrets.compare_digest`, and must
not be placed in browser configuration, source, logs, or documentation.

The current implementation supports one active credential only. Rotation,
expiry, and managed-secret deployment remain operational requirements. Rotate
by changing the secret in CPS and RASID server-side secret stores together,
restarting/reloading the services, verifying only the NODE-04 state read, and
revoking access to the retired secret.

## V2 Location and Network Observation Boundaries (2026-10-01)

Location catalogue reads, node-location changes, and history reads use the
existing admin-token authorization. Backend validation rejects unknown
locations and locations not marked DEPLOYED. The frontend does not decide
whether a location assignment is authorized.

Reading location is snapshotted from the authenticated node when ingestion is
accepted. Historical readings remain location-unknown unless independently
verified deployment evidence supports a migration assignment.

Heartbeat-reported IP, MAC, RSSI, SSID, BSSID, Wi-Fi channel, gateway, and
subnet mask are nullable observations associated with the authenticated node.
They are not independently verified network facts and may disclose internal
topology. Restrict access to authorized routes, use HTTPS, and never add
Wi-Fi passwords or device credentials to telemetry. Device credentials remain
in the authentication header; credential verifiers remain server-side.

Weather provider keys must remain in backend configuration after a provider
is approved. Camera authentication and stream access must use a separate
integration boundary rather than generic node credentials. Actuator commands
must not be enabled until device-specific safety limits, authorization, and
audit requirements are defined.

The RASID integration credential is distinct from the admin token and device
credentials. It authorizes neither telemetry writes nor node management, and
the integration routes retain the NODE-04 allowlist and read-only response
contracts. Heartbeat history returns only server receipt timestamps, bounded
to 50 newest records. It must not expose device timestamps, internal record
IDs, IP/MAC/RSSI, Wi-Fi observations, credentials, or credential verifiers.

The NODE-04 state response may include the nullable device-reported fields
`reported_relay_state` and `relay_reported_at`. Both are derived from the same
latest persisted heartbeat selected by server receipt time (`received_at`), not
from a command, inferred physical condition, node connectivity, or an earlier
heartbeat. `relay_reported_at` is null whenever that latest heartbeat has no
relay report. These fields are read-only observations and do not authorize any
actuator command or confirm physical actuation.

The same NODE-04 state response includes a strictly allowlisted nullable
`network_observation` object containing only `reported_ip`, `reported_mac`,
`reported_rssi_dbm`, `reported_ssid`, `reported_bssid`,
`reported_wifi_channel`, `reported_gateway`, `reported_subnet_mask`, and
`reported_at`. Every value, including `reported_at`, comes from the same
latest persisted heartbeat selected by `received_at DESC, id DESC`.
`reported_at` is that server receipt time. If no heartbeat exists every field
is null; a null value on the latest heartbeat is never filled from an older
record. The object is device-reported, can be stale or historical when
`connection_status` is not `ONLINE`, must not be logged, and contains no
credentials, device timestamps, internal IDs, or arbitrary heartbeat fields.
The separate bounded heartbeat-history route remains network-metadata-free.

## Phase 1B non-actuating control-command foundation

The command foundation is separate from the read-only RASID integration
identity. `RASID_CONTROL_TOKEN` is a server-only CPS/RASID service credential
and must never be supplied to a browser, device, source file, log, or
documentation. It is not interchangeable with `X-Rasid-Integration-Token`,
`X-Admin-Token`, or `X-Device-Credential`.

Only `NODE-04` is allowlisted. The control service may create a short-lived
`NON_ACTUATING` envelope through `POST /api/v1/control/nodes/NODE-04/commands`.
An authenticated device may poll its own envelope through
`GET /api/v1/device/nodes/NODE-04/commands/next` and acknowledge it through
the matching acknowledgement endpoint using its existing device credential.
All command routes fail closed unless directly served as HTTPS; forwarded TLS
headers are not accepted without explicitly configured trusted-proxy support.

The lifecycle is limited to `PENDING`, `DELIVERED`, `ACKNOWLEDGED`, `EXPIRED`,
and `REJECTED`. Commands have a UUID, node/actuator binding, idempotency key,
auditable timestamps, and a maximum 90-second lifetime. Duplicate polling can
redeliver one outstanding envelope; matching duplicate acknowledgements are
idempotent. Node revocation rejects outstanding envelopes.

**Phase 1B never authorizes or performs GPIO, relay, HVAC, or fan actuation.**
The existing ESP32 firmware remains the sole authority over GPIO25 and its
local safeguards. `ACKNOWLEDGED` is delivery-protocol evidence only; it is not
a relay report, a fan-state confirmation, or physical-actuation proof.


## Integrated Platform Security (2026-10-15)

### Device transport

- The HTTPS path exposes only Caddy on `HOST_IP:8443`. Caddy forwards `POST /heartbeat`
  and `POST /readings` to a loopback gateway; everything else returns 404. The gateway
  and the CPS backend listen on `127.0.0.1` only.
- The firmware verifies the server certificate against `LOCAL_ROOT_CA_CERT`;
  `setInsecure` is not used. Because mbedTLS 2.28 cannot match IP SANs, the leaf lists
  the host IP as both an IP SAN and a DNS SAN (`CPS-Project/gateway/issue-cert.sh`).
- The firewall rule allows TCP 8443 only on the host IP and only from the ESP32's subnet.
- The plain-HTTP option (`http://HOST_IP:8001`, backend on `0.0.0.0`) sends the device
  credential and readings unencrypted and exposes the CPS API on the network. Use it only on
  a private network for development; never on shared or campus Wi-Fi.

### Secrets

- Never committed: `CPS-Project/.env`, `server/.env`, `esp32/include/secrets.h`
  (Wi-Fi password, device credential), the local CA private key, and
  `CPS-Project/gateway/certs/` (gitignored).
- `RASID_INTEGRATION_TOKEN` (CPS) and `CPS_RASID_INTEGRATION_TOKEN` (RASID) must match
  and stay server-side; the browser never receives them.

### Committed database

`CPS-Project/backend/cps.db` is committed so the platform shows real history (readings,
heartbeat timing, locations). In this published copy every node credential was reset to the
hash of a discarded random secret, and device-reported network observations (IP, MAC, SSID,
BSSID, gateway, subnet) were removed. Issue a fresh device credential with the admin
revoke + reactivate calls (`RUN_FROM_ZERO.md` section 4). For production, do not commit the
database at all.

### Monitoring and control

- The RASID watcher reports NODE-04 OFFLINE (> 90 s without a heartbeat) or an unreachable
  CPS backend as a high-severity alert and incident; recovery clears them. This detects
  power, Wi-Fi or gateway loss, but not falsified readings.
- RASID holds read-only CPS access. The operational HVAC evaluation is monitor-only and the
  Phase 1B command ledger stays non-actuating; no RASID path can switch the relay.
- The Simulation Center is browser-local and cannot reach CPS, the journal, or devices.
- The dashboard sign-in is a prototype check in the browser only; it is not access control
  for the APIs.
