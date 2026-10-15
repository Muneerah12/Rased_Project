# CPS Project — Architecture and Concepts

## 1. Project Overview

This project is a Cyber-Physical System (CPS) designed to monitor and respond to conditions within an exhibition/hall environment.

The system combines:

- Physical sensors
- ESP32 nodes
- Backend services
- Database storage
- Sensor validation and health monitoring
- Environmental state estimation
- Crowd/occupancy information
- Decision logic
- Actuation/action management
- A platform/dashboard

The project is being developed as an MVP/prototype rather than a production-scale system.

The main working principle is:

Sense → Validate → Understand State → Decide → Act → Sense Again

This follows the original project plan. 
## 2. System Domains

The overall platform is divided into four operational domains:

1. Crowd Management & Visitor Safety and Experience
2. CPS Management
3. Visitor Identification, Authentication & Authorization
4. Surveillance, Monitoring & Control

The CPS backend currently focuses on the CPS Core and environmental sensing.
Crowd Management will later be integrated with the CPS data and decision flow.

The final platform is intended to combine information from multiple domains rather than treating CPS as an isolated system.
### CPS Management vs Operational Domains

CPS Management focuses on the operation and health of the CPS
infrastructure itself.

It includes:

- System Health
- CPS Device Management
- CPS Connectivity / Node Health
- CPS Telemetry / Sensor Data

Operational domains use CPS information to support operational
decisions and actions.

The operational domains include:

- Crowd Management & Visitor Safety and Experience
- Visitor Identification, Authentication & Authorization
- Surveillance, Monitoring & Control

CPS telemetry is therefore not limited to a single operational domain.
The same CPS data may be consumed by multiple operational domains
depending on the situation and required decision logic.

## 3. CPS Core Architecture

The current CPS architecture is:

Physical Sensors / ESP32
        ↓
Data Ingestion
        ↓
Validation & Sensor Health
        ↓
Data Fusion / Environmental State
        ↓
Decision Engine
        ↓
Action Manager
        ↓
Platform / Dashboard

The ESP32 is mainly responsible for sensing and data acquisition.

The backend is responsible for processing, validation, state understanding,
decision logic, and coordination with the platform.

## 4. Node vs Sensor

A Node represents an ESP32 device that communicates with the backend.

A Node can contain multiple sensors.

Example:

NODE-01
├── TEMP-01
└── TEMP-02

The sensor produces measurements, while the node is responsible for
collecting and communicating those measurements to the backend.

Therefore:

Node health ≠ Sensor health

A node can be offline even though its sensors were previously working.

Similarly, a single sensor can become suspicious while the node itself
remains online.
## 5. Backend Architecture

The current backend uses:

- Python
- FastAPI
- Uvicorn
- SQLAlchemy
- SQLite

The basic development architecture is:

ESP32 / Simulator
        ↓
HTTPS API (TLS terminated by Uvicorn for the MVP)
        ↓
FastAPI
        ↓
SQLAlchemy
        ↓
SQLite Database

The simulator connects using a configured HTTPS base URL and validates the
backend certificate and hostname. For a private MVP CA, the CA certificate
is provisioned to the simulator as a trust bundle. Device credentials
continue to authenticate nodes at the API layer; mutual TLS is not used.


## 6. Backend API Responsibilities

The backend API is divided according to the responsibility of each
operation rather than according to individual operational domains.

### 6.1 System Health

Endpoint:

GET /

Used to verify that the backend service is running.

### 6.2 CPS Device Management

Node provisioning and lifecycle management include:

POST /nodes
GET /nodes
GET /nodes/{node_id}
POST /nodes/{node_id}/revoke
POST /nodes/{node_id}/reactivate

These endpoints support node registration, inspection, revocation,
and reactivation.

### 6.3 CPS Connectivity / Node Health

Endpoints:

POST /heartbeat
GET /heartbeats

POST /heartbeat receives a heartbeat from a registered node.

GET /heartbeats provides stored heartbeat history.

Node connectivity is represented using:

- ONLINE
- STALE
- OFFLINE

The current connection state is derived from the node's latest
heartbeat / last_seen information.

### 6.4 CPS Telemetry / Sensor Data

Endpoints:

POST /readings
GET /readings
GET /nodes/{node_id}/readings

POST /readings receives and stores sensor measurements.

GET /readings returns stored sensor measurements across nodes.

GET /nodes/{node_id}/readings returns sensor measurements associated
with a specific node.
## 7. Sensor Reading Flow

The first successful CPS flow is:

Sensor
   ↓
Node
   ↓
POST /readings
   ↓
FastAPI
   ↓
Validation
   ↓
SQLAlchemy
   ↓
Database

A sensor reading currently contains:

- node_id
- sensor_id
- sensor_type
- value
- unit
- timestamp

example: 
{
  "node_id": "NODE-01",
  "sensor_id": "TEMP-01",
  "sensor_type": "temperature",
  "value": 24.5,
  "unit": "°C",
  "timestamp": "2026-09-25T10:30:00Z"
}

## 8. Reading ID

Each stored sensor reading receives a database ID.

The reading ID identifies the individual database record.

For example:

Reading ID 1 → TEMP-01 = 24.5°C
Reading ID 2 → TEMP-01 = 24.7°C
Reading ID 3 → TEMP-01 = 24.8°C

The reading ID does not represent the sensor itself.

## 9. Heartbeat

The backend uses the node's latest heartbeat to determine the
current connection state.

The current connection states are:

- ONLINE
- STALE
- OFFLINE

The connection state is calculated from the elapsed time since
last_seen.

The current implementation uses the configured heartbeat timeout
thresholds in the backend.
## 10. Sensor Health vs Environmental State

Sensor health must remain separate from the environmental condition.

Example:

TEMP-03 = 32°C

If other sensors report:

TEMP-01 = 24.2°C
TEMP-02 = 24.4°C
TEMP-04 = 24.3°C

then TEMP-03 may be suspicious.

The system should not immediately conclude that the entire environment
is 32°C.

Instead, the system can compare related sensor readings and determine
whether the reading is an outlier.

If multiple sensors report approximately:

31.8°C
32.0°C
31.9°C
32.1°C

then the system may treat the condition as a genuine environmental change.

## 11. Event-Based Communication

The system will eventually support two different communication patterns.

### Heartbeat

Periodic communication:

ESP32 → Backend

"I'm still connected."

### Event

Immediate communication when an important condition occurs:

ESP32 → Backend

"Something important just happened."

Potential events include:

- Network degradation
- Network recovery
- Sensor fault
- Device error
- Threshold-related events

The event endpoint has not yet been implemented.

## 11. Hierarchical Sensor Validation and Reading Trust

The CPS should not blindly trust a single sensor reading before using it
for environmental decisions.

Sensor validation is performed hierarchically:

Raw Sensor Reading
        ↓
Basic Reading Validation
        ↓
Sensor-Level Validation
        ↓
Node-Level Validation
        ↓
Neighbor-Based Validation
        ↓
Reading Confidence
        ↓
Environmental Data Fusion
        ↓
Environmental State
        ↓
Decision

### 11.1 Sensor-Level Validation

When multiple sensors within the same node measure the same or related
environmental parameter, their measurements can be compared.

Example:

NODE-01

- TEMP-01 → 24.2°C
- TEMP-02 → 24.4°C

The small difference indicates reasonable local agreement.

However:

NODE-01

- TEMP-01 → 24.3°C
- TEMP-02 → 32.1°C

should not immediately cause the system to conclude that the environment
is 32.1°C.

Instead, the disagreement is treated as a potential sensor anomaly.

Possible causes include:

- Sensor malfunction
- Poor electrical connection
- Temporary measurement error
- Local heat source
- Calibration problem
- Genuine localized environmental change

The system therefore assigns a validation/health state to the sensor
rather than immediately changing the environmental state.

### 11.2 Node-Level Validation

Agreement between sensors within a node does not guarantee that the node
itself is reporting the correct environmental condition.

For example:

NODE-01:
- TEMP-01 → 24.2°C
- TEMP-02 → 24.4°C

NODE-02:
- TEMP-01 → 24.3°C
- TEMP-02 → 24.5°C

NODE-03:
- TEMP-01 → 31.8°C
- TEMP-02 → 32.1°C

NODE-03 has internal sensor agreement, but its measurements differ
significantly from nearby nodes.

Therefore, node-level validation also considers the measurements reported
by spatially neighboring nodes.

### 11.3 Neighbor-Based Context Verification

Neighbor relationships should represent physical or spatial proximity,
not simply network connectivity.

For example:

             NODE-02
              24.3°C
                 |
                 |
NODE-01 ───── NODE-03 ───── NODE-04
 24.2°C         32.0°C         24.4°C

The system should not rely on a single neighbor when multiple neighbors
are available.

Instead, multiple neighboring observations can be used to establish a
local reference.

A robust statistic such as the median may be used.

Example:

Neighbor values:

24.2°C
24.3°C
24.4°C

Median = 24.3°C

NODE-03 = 32.0°C

The large deviation from the local reference makes the NODE-03 reading
suspicious.

### 11.4 Reading Trust and Confidence

Reading trust is separate from:

- Device connection status
- Sensor health
- Environmental state

The original sensor reading should be preserved even when the system
determines that the reading is suspicious.

For example:

Raw reading: 32.0°C
Validation status: SUSPICIOUS
Confidence: LOW

A suspicious reading should not automatically be deleted.

Instead, it may be down-weighted or excluded from environmental data
fusion depending on the validation result.

### 11.5 Sensor Anomaly vs Environmental Event

The system should distinguish between an isolated abnormal reading and a
genuine environmental change.

For example:

Initial condition:

NODE-01 → 24°C
NODE-02 → 24°C
NODE-03 → 24°C
NODE-04 → 32°C

NODE-04 is initially suspicious.

If the readings later develop into:

NODE-01 → 27°C
NODE-02 → 28°C
NODE-03 → 29°C
NODE-04 → 32°C

and multiple spatially distributed nodes continue increasing, the system
has stronger evidence that the environment itself may be changing.

Therefore, validation should consider:

- Multiple sensors
- Multiple nodes
- Spatial relationships
- Temporal behavior
- Repeated observations

### 11.6 Validation State and Recovery

A sensor should not permanently be classified as faulty because of a
single abnormal reading.

The intended state transition is:

NORMAL
   ↓
Suspicious readings
   ↓
WARNING / SUSPICIOUS
   ↓
Repeated abnormal behavior
   ↓
FAULT

Recovery should also be possible:

FAULT
   ↓
Consistent readings restored
   ↓
Validation passes
   ↓
NORMAL

This allows the system to recover from temporary measurement errors or
short-lived anomalies.

### 11.7 Connection Status Is Separate

Connection status, sensor health, and environmental state represent
different concepts.

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

For example:

Sensor Health = FAULT

does not necessarily mean:

Environmental State = CRITICAL

Other healthy sensors may continue to indicate that the environment is
normal.

Similarly, an OFFLINE node does not mean that the last known environmental
condition is still current.

The system should retain the last known value together with its timestamp
and connection status.

Example:

Last known temperature: 24.3°C
Last update: 10:42:15
Connection: OFFLINE

This means that 24.3°C was the last observed value, not necessarily the
current environmental temperature.

### 11.8 Implemented MVP Reading Integrity

The current backend implements individual range/type validation followed
by same-node and explicitly grouped cross-node peer comparison. A reading
is compared only when type, compatible unit, configured comparison group,
and freshness rules match. Sensors without a configured group have no
comparable peers.

The backend uses the median of the latest fresh reading from each peer
sensor. Peer records must fall within the configured freshness window
(default 60 seconds), and records later than the reading being assessed
are excluded. Temperature units `C` and `°C` are treated as compatible;
humidity uses `%` and pressure uses `hPa`. No unit conversion is performed.

The outcomes are `INVALID`, `UNKNOWN`, `NORMAL`, and `SUSPICIOUS`.
`SUSPICIOUS` indicates a reading that needs investigation; it is not proof
of compromise. The database stores a concise reason and a coarse numeric
confidence tier. Confidence values are deterministic indicators, not
probabilities or calibrated measurement uncertainty.

Initial peer tolerances are temperature 2.0°C, humidity 5 percentage
points, and pressure 10 hPa. These are prototype engineering assumptions,
not values mandated by NIST, IEC, or ISA. They require calibration using
the actual sensor specifications, calibration records, and measurement
uncertainty before operational use.

Comparison groups are supplied through the backend's
`CPS_SENSOR_COMPARISON_GROUPS` environment variable as a JSON mapping from
node IDs to sensor IDs and group names. Thresholds use the
`CPS_TEMPERATURE_PEER_TOLERANCE`, `CPS_HUMIDITY_PEER_TOLERANCE`, and
`CPS_PRESSURE_PEER_TOLERANCE` variables; freshness uses
`CPS_PEER_FRESHNESS_SECONDS`.

This MVP does not maintain sensor fault/recovery states, calibrate
thresholds automatically, convert units, or manage comparison groups
through an API or dashboard.

## 12. Crowd / AI Integration

The CPS will eventually receive people-count information from
a CCTV/AI component.

The AI data should provide information such as:

- people_count
- zone_id
- timestamp
- confidence
- status

The CPS should then calculate occupancy/density using the zone
information and configured thresholds.

The AI should not directly decide:

crowded = true

Instead:

AI
 ↓
People Count
 ↓
CPS
 ↓
Occupancy / Density
 ↓
Decision

## 13. Final CPS Flow

The intended final architecture is:

REAL ESP32
    ↓
Temperature Sensors
    ↓
Data / Network
    ↓
FastAPI Backend
    ↓
Environmental State

                    Fake / Real AI
                         ↓
                    People Count
                         ↓
                    Context / Fusion
                         ↓
                    Decision Engine
                         ↓
                    Action Manager
                         ↓
                    Platform / Dashboard

                    ## Device Authentication

## 14. Device Authentication

Each CPS node must authenticate to the backend before accessing
protected communication endpoints.

The node_id identifies the device but is not considered an
authentication credential.

The authentication design will use a device-specific credential
associated with the registered node.

The backend will verify the presented credential before allowing
protected operations such as heartbeat submission and sensor
readings.

Authentication and authorization are treated as separate controls:

- Authentication verifies the identity of the communicating node.
- Authorization determines which operations the authenticated node
  is permitted to perform.

Node registration/provisioning will be restricted separately from
normal device communication.

## 15. Node Lifecycle Management

Each registered node has two separate concepts:

### Device lifecycle status

Represents whether the node is authorized to participate in the CPS.

Possible states include:

- ACTIVE
- REVOKED

### Connection status

Represents whether the node is currently communicating with the backend.

Possible states include:

- ONLINE
- STALE
- OFFLINE

These states are intentionally separate.

For example:

ACTIVE + OFFLINE

means that the node is still an authorized device, but it is not
currently communicating with the backend.

REVOKED

means that the node is no longer authorized to communicate,
regardless of its previous connection state.

Node reactivation restores the node to ACTIVE and requires
credential rotation.

## 16. Credential Protection

Device credentials are treated as high-value secrets.

The backend does not store the node credential in plaintext.
A credential verifier/hash is stored with the registered node.

Each node has its own device credential.

The node credential is used to authenticate protected device
communication.

Node credentials must not be embedded in publicly accessible code
or exposed through API responses.

When a revoked node is reactivated, the backend generates a new
device credential. The previous credential must no longer be
accepted.

For production deployment, credential storage on the physical node
must use an appropriate secure storage mechanism where supported.

Production communication must use HTTPS/TLS.

Credential protection alone does not provide replay protection.
A production authentication protocol should also incorporate
appropriate replay-resistant mechanisms such as timestamps,
nonces, or cryptographic request signing where appropriate.

## 17. Administrative Authentication

Administrative operations such as node provisioning, revocation,
and reactivation are separate from device authentication.

The administrator uses an administrative credential to access
protected node-management operations.

The administrative credential is a server-side secret and must not
be embedded in ESP32 firmware or stored as a node credential.

For development, the administrative credential may be supplied
through protected server configuration such as an environment
variable.

For production deployment, a dedicated secrets-management solution
and individual administrator authentication should be considered.

Administrative authentication and node/device authentication are
therefore separate security boundaries.

## V2 Foundation (2026-10-01)

The V2 physical location catalogue is normalized as zones, halls, and
subzones. It contains 4 zones, 16 halls, and 64 subzones. Only A1-1 is marked
DEPLOYED; the remaining subzones are NOT_DEPLOYED. NODE-03 is assigned to
A1-1. NODE-01, NODE-02, NODE-04, and NODE-11 remain unassigned unless a
deployment mapping is confirmed.

Each accepted sensor reading snapshots the authenticated node's current
subzone. Changing a node's assignment therefore affects new readings but does
not relocate historical readings. Existing readings are not backfilled;
unknown historical location remains NULL.

Heartbeat `timestamp` remains device-reported for clock diagnostics.
Server-generated `received_at` is the source for last-heartbeat freshness and
ONLINE/STALE/OFFLINE calculation. Optional reported IP, MAC, and RSSI are
observations supplied by the authenticated device, not verified network
facts. No credentials, SSID, gateway, or Wi-Fi password are part of this
payload.

Location APIs require the existing admin authorization. Reading and heartbeat
history APIs accept server-side filters and bounded cursor pagination. The
frontend's heartbeat timeline uses recorded receipt events and labels longer
intervals as gaps, not packet loss. Its location heat map uses the catalogue,
deployment state, and location-snapshotted readings only.

Weather, actuator, CCTV, drone, and other IoT integrations are not represented
as operational without their contracts and real data. Weather implementation
requires provider and site configuration; camera integration requires the
teammate-owned API/authentication/stream contract; actuator control requires a
device inventory and safety contract.

The backend exposes an admin-protected `/weather/external-temperature`
read contract. It returns `UNCONFIGURED` until a provider adapter stores a
real observation. Provider/site identity, units, observation/retrieval times,
freshness status, and a non-secret error code are represented in the model.
The `TemperatureProvider` protocol in `backend/weather.py` is the integration
boundary; it has no provider client, credentials, or invented site setup.


---

## 18. Integrated RASID CPS Platform (2026-10-15)

The CPS backend now runs as one part of the RASID CPS platform in the
`Rasid_LA` repository (`CPS-Project/` folder). Step-by-step setup is in
`RUN_FROM_ZERO.md` at the repository root.

### 18.1 Components

| Component | Port | Role |
| --- | --- | --- |
| ESP32 NODE-04 | — | BME280 temperature, humidity and pressure; local HVAC relay (GPIO 25, on above 26 °C, off below 24 °C); heartbeats with network observations |
| Caddy TLS proxy | HOST_IP:8443 | Only network-facing listener on the HTTPS path; accepts `POST /heartbeat` and `POST /readings` only |
| Ingestion gateway | 127.0.0.1:8013 | Loopback forwarder; requires `X-Device-Credential` and relays it to CPS |
| CPS backend | 127.0.0.1:8001 | Device authentication, reading integrity, node health, location catalogue, history, integration API (this document) |
| RASID server | 127.0.0.1:8010 | AI camera analytics, incidents and alerts, operational HVAC evaluation, NODE-04 offline watcher, dashboard host |
| Dashboard | served by RASID | React + TypeScript operator UI, including the IoT / CPS workspace |

### 18.2 Data flows

1. **Ingestion.** ESP32 → Caddy (TLS, certificate from a local CA embedded in the
   firmware) → gateway → CPS `POST /heartbeat` and `POST /readings`. On a private
   network the ESP32 may post directly to `http://HOST_IP:8001` instead.
2. **Integration read.** RASID reads NODE-04 state, readings history and heartbeat
   history through the read-only integration API with `RASID_INTEGRATION_TOKEN`.
   The browser never calls CPS directly; RASID proxies through loopback-only routes.
3. **Node health.** CPS derives ONLINE (≤ 30 s since the last received heartbeat),
   STALE (≤ 90 s) and OFFLINE. The RASID watcher polls every 10 s; OFFLINE, or an
   unreachable CPS backend for two polls, records a shared journal entry that raises a
   bell alert and an IoT Sensor incident. Recovery clears both. STALE never alerts.
4. **Operational HVAC (monitor-only).** RASID combines the CPS temperature with the
   AI people count of camera CAM-C (zone A1.1) and observed 5-minute trends against
   approved thresholds. It recommends; it never sends a command to the relay.
5. **Simulation.** The Simulation Center is a browser-local digital twin of zone A1.1
   (circulation and exhaust fans, CCTV, simulated AI detections). It has no path to CPS
   data, the journal, or devices.

### 18.3 Location model in use

Zone A → hall A1 → subzones A1-1 … A1-4. Only A1-1 is DEPLOYED, holding NODE-04
(and NODE-03). The RASID map zone `A1.1` corresponds to CPS location `A1-1`.

### 18.4 Design rules that hold across the platform

- Only Caddy (or, on the plain-HTTP path, the CPS port) is reachable from the network.
- RASID has read-only CPS access; control commands remain non-actuating (Phase 1B).
- Missing or stale evidence is shown as such and never replaced with fixtures.
- Simulation data never mixes with real operations data.
