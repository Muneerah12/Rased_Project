# CPS Developer Handoff

> Platform-wide setup (CPS backend, RASID server, dashboard, ESP32 HTTPS or HTTP path): see `RUN_FROM_ZERO.md` in the repository root. The integrated architecture is in `01_Architecture_and_Concepts.md` section 18.

This document describes the current CPS codebase and gives a colleague a local setup path before AI/CPS integration. It records the implementation as it exists; the target platform architecture is not implemented here.

## 1. Project overview

CPS is a prototype for collecting environmental sensor readings from ESP32 nodes, checking reading integrity, tracking node connectivity, and presenting the resulting data in a React dashboard.

Implemented in the current source:

- FastAPI endpoints for node provisioning/lifecycle, authenticated sensor readings and heartbeats, location catalogue/assignment, and paginated history.
- Per-node device credential verification, node revocation/reactivation, timestamp validation, reading integrity assessment, and ONLINE/STALE/OFFLINE status derived from server heartbeat receipt time.
- SQLAlchemy models backed by SQLite, including location snapshots on new readings.
- A React/TypeScript dashboard that polls backend node, location, reading, and heartbeat APIs.
- A simulator that generates synthetic sensor readings and posts them to the backend.
- PlatformIO firmware project for an ESP32 with a BME280 sensor, included in this repository under `esp32/`.

**AI event ingestion, a Decision Engine, occupancy fusion, actuator integration, and actuator commands are not implemented.** Camera and other IoT screens are placeholders, not connected integrations. The external-temperature API has a read contract, but no provider client or ingestion workflow is configured.

## 2. Current architecture

```text
BME280 sensor
    ↓ I²C
ESP32 firmware
    ↓ Wi-Fi
    ↓ HTTP requests with X-Device-Credential (current firmware behavior)
FastAPI
    ↓ schema/authentication/integrity validation
SQLite
    ↓ protected read APIs
React dashboard

Simulator ── HTTPS with certificate verification ──> FastAPI
```

The real firmware and simulator have different current transports: the physical ESP32 uses HTTP; the current simulator requires HTTPS and verifies certificates by default. Do not describe them as having equivalent transport security.

### Future merged architecture (not implemented)

```text
AI service → AI Event ─┐
                       ├→ Decision Engine → Alert/Action → Action service → Actuators
CPS → Validated CPS State ┘
```

The platform Decision Engine is expected to combine AI events and CPS state under contracts agreed by the integration teams. The diagram is a target, not a description of running code.

## 3. Repository structure

- `backend/` — FastAPI application, SQLAlchemy models/database setup, reading-integrity logic, weather provider protocol, requirements, and tests. The runtime SQLite path is `backend/cps.db`; the file is local/generated and ignored by Git.
- `frontend/` — React/TypeScript/Vite dashboard, API client, polling hook, screens, and npm manifests.
- `simulator/` — current synthetic telemetry simulator and a legacy simulator copy if present in the checkout.
- `esp32/` — PlatformIO project for the ESP32/BME280 firmware, including `platformio.ini`, firmware source, and a sanitized secrets template. Local credentials and machine-specific settings are excluded.
- `docs/` — project concepts, implementation/testing logs, status, security requirements, and this handoff.
- `.env.example` — empty local admin-token setting; copy to `.env` and set a local development value.
- `.gitignore` — excludes local `.env`, SQLite files, Python caches/virtual environments, and secret key files including `secrets.h` within this repository.

The ESP32 PlatformIO project is included in this repository under `esp32/`. Its tracked project structure includes `platformio.ini`, `src/main.cpp`, `include/README`, `include/secrets.example.h`, `lib/README`, `test/README`, and a project `.gitignore`. `include/secrets.h` is intentionally not committed; `.pio/` build output and `.vscode/` machine-specific configuration are excluded. The hard-coded `upload_port = COM3` setting was removed; configure a local upload port only if uploading from a machine that requires one.

### Repository baseline vs audited local workspace

The GitHub repository contains the committed CPS baseline. The audited local workspace may contain additional uncommitted or untracked files; those files are not part of a clean clone unless they are committed later. At the time of this audit, the local workspace additionally contains:

- `backend/manual_cross_node_manual.py`
- `frontend/src/data/`
- `simulator/simulator_before_offline_buffer.py`

These are local workspace artifacts, not setup prerequisites. Do not copy them into a clean clone. The handoff's current-frontend observations describe the audited working tree and may differ from the committed baseline until its outstanding changes are committed.

`frontend/src/data/mockDashboardData.ts` is currently untracked and, according to the audit, its mock exports are not imported or used by the current frontend. It is not part of clean-clone setup.

## 4. Required software and dependencies

### Backend

The repository does not pin a Python version. Backend source syntax requires Python 3.10 or newer (including `X | None` type unions); the dependency versions are also unpinned, so the repository does not declare a fully locked Python runtime. Before creating the environment, verify the interpreter with `py --version` or `python --version`. If using the Windows launcher, ensure the selected Python is 3.10 or newer; `py -3` alone does not guarantee that minimum. `backend/requirements.txt` has no package version pins and lists:

- `fastapi`
- `uvicorn[standard]`
- `sqlalchemy`
- `pwdlib[argon2]`
- `python-dotenv`
- `pytest`
- `httpx`
- `trustme`
- `requests`

Pydantic is imported directly by the application and comes through FastAPI's dependency graph; it is not separately declared in `requirements.txt`. The application uses Pydantic v2's `field_validator`. No standalone package versions are specified, so do not assume a lockfile or pinned backend environment exists.

### Frontend

The project has `package-lock.json`; use a Node/npm installation compatible with the lockfile. The manifest does not declare a top-level `engines` value. Vite 8's lockfile package metadata requires Node `^20.19.0 || >=22.12.0`; use a supported Node version and its bundled npm. Install from `frontend/` with `npm install` (or `npm ci` when a clean lockfile install is desired).

Declared dependencies from `frontend/package.json`:

- Runtime: `react` `^19.2.8`, `react-dom` `^19.2.8`.
- Development/build: `@types/node` `^24.13.3`, `@types/react` `^19.2.18`, `@types/react-dom` `^19.2.7`, `@vitejs/plugin-react` `^6.1.1`, `oxlint` `^1.81.0`, `typescript` `~6.0.2`, `vite` `^8.3.0`.

These are manifest ranges, not a claim about the exact versions installed on another developer's machine. `package-lock.json` records resolved packages.

### ESP32 firmware

The firmware project is at `esp32/` and uses PlatformIO, the Espressif32 platform, `nodemcu-32s` board, and the Arduino framework. Its declared library dependency is `adafruit/Adafruit BME280 Library@^2.3.0`; PlatformIO resolves its `Adafruit Unified Sensor` and `Adafruit BusIO` dependencies. Wi-Fi, HTTP client, Wire/I²C, and time support are supplied by the Arduino/ESP32 framework. The `lib/` and `test/` directories contain README placeholders, not additional project libraries or tests.

VS Code with the PlatformIO IDE extension is the convenient workflow; PlatformIO Core can also operate the project. `platformio.ini` does not specify an upload port: the former hard-coded `COM3` setting was removed. Building does not require an upload port; configure one locally when uploading if PlatformIO does not detect the board automatically.

## 5. Backend setup (Windows PowerShell)

Replace `<repository-url>` with the repository URL supplied by the project owner. First confirm that `py --version` or `python --version` reports Python 3.10 or newer. The commands below assume the clone is created in the current directory:

```powershell
git clone <repository-url> cps-project
Set-Location .\cps-project\backend
py -3 -m venv .venv
```

If the Windows launcher selects a Python below 3.10, use an installed 3.10+ interpreter explicitly (for example, `py -3.10 -m venv .venv`).

Activate the environment and install dependencies:

```powershell
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

If PowerShell's execution policy blocks `Activate.ps1`, do not change the machine-wide policy just for this project. Use the virtual environment's Python executable directly for every Python command. From `backend/`:

```powershell
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

After configuring `.env` as described below, start the backend with:

```powershell
.\.venv\Scripts\python.exe -m uvicorn main:app --reload --host 0.0.0.0
```

Stop the server with Ctrl+C, then run tests with:

```powershell
.\.venv\Scripts\python.exe -m pytest
```

Configure the required admin token without putting its value in source control:

```powershell
Copy-Item ..\.env.example ..\.env
notepad ..\.env
```

Set a strong, local development-only `ADMIN_PROVISIONING_TOKEN` in `.env`. Do not paste that value into tickets, documentation, source files, or chat. The backend loads the project-root `.env` without overriding process environment settings and fails startup if the token is absent or blank.

If enabling the narrow RASID state integration, also set a distinct strong
`RASID_INTEGRATION_TOKEN` in the same server-only configuration. RASID sends
it only from its backend in `X-Rasid-Integration-Token`; never place it in a
browser, Vite environment variable, source file, or log. Leaving it blank
keeps only the integration state route unavailable.

### Normal PowerShell path

With the venv activated, start the development backend from `backend/` so the current module imports resolve:

```powershell
python -m uvicorn main:app --reload --host 0.0.0.0
```

This HTTP development server listens on the machine's interfaces so a device on a trusted local network can reach it. Do not expose it to an untrusted network. On the same machine, check `GET http://127.0.0.1:8000/` for the basic running message and open Swagger at `http://127.0.0.1:8000/docs` or the OpenAPI schema at `http://127.0.0.1:8000/openapi.json`. Swagger is useful for exploring schemas, but protected requests still require the appropriate credential. Treat a node credential returned by provisioning as a secret.

Run the backend tests from `backend/` with the environment active:

```powershell
python -m pytest
```

The tests use isolated test databases/fixtures for their cases; do not treat the local development SQLite database as disposable unless its owner agrees.

The HTTP backend command above supports local dashboard/backend development. It does **not** support the current simulator, which rejects HTTP backend URLs and requires HTTPS.

## 6. Frontend setup

Open a second PowerShell terminal. Change to the cloned repository root first, regardless of the terminal's initial directory:

```powershell
Set-Location "<path-to-cloned-repository>"
Set-Location .\frontend
npm install
npm run dev -- --host 0.0.0.0
npm run build
```

Vite prints its development URL (usually `http://localhost:5173`). `--host 0.0.0.0` makes it reachable from other devices on the local network; use only on a trusted development network. The frontend calls relative API paths. `frontend/vite.config.ts` proxies `/nodes`, `/locations`, `/readings`, and `/heartbeats` to `VITE_CPS_API_TARGET`; it defaults to `http://127.0.0.1:8000`. To target another local backend, create a local frontend environment file such as `.env.local` containing `VITE_CPS_API_TARGET=http://127.0.0.1:8000`, then restart Vite. Do not put credentials in Vite environment variables: `VITE_` values are intended for browser-visible configuration. The current proxy list does not include `/weather` because the frontend does not currently call that endpoint. `npm run build` runs TypeScript project checks and the Vite production build.

## 7. ESP32 setup

1. Open the repository's `esp32/` directory as the PlatformIO project in VS Code with the PlatformIO IDE extension, or use PlatformIO Core. The project targets `nodemcu-32s` on Espressif32 with the Arduino framework.
2. Before building, create `esp32/include/secrets.h` locally by copying `esp32/include/secrets.example.h`. Populate the required local settings: `WIFI_SSID`, `WIFI_PASSWORD`, `NODE_ID`, `DEVICE_CREDENTIAL`, and `BACKEND_URL`. Use a backend URL reachable from the device's network; `127.0.0.1` on the developer's computer is not reachable from the ESP32. Use only the credential provisioned for the configured node.
3. `include/secrets.h` is intentionally not committed; `include/secrets.example.h` is committed and contains placeholders only. Never commit real Wi-Fi credentials or device credentials. `.pio/` and machine-specific `.vscode/` configuration are excluded. The repository's root and firmware `.gitignore` rules also exclude the local secrets file.
4. From `esp32/`, run the PlatformIO build:

   ```powershell
   pio run
   ```

   PlatformIO resolves declared platform and library dependencies during the build. A clean clone cannot build the firmware until the developer creates the local `include/secrets.h` from the example and fills in the required settings. The former hard-coded `upload_port = COM3` was removed from `platformio.ini`; set a local upload port only when needed to upload to a connected board. The serial monitor speed matches `Serial.begin(9600)` in the firmware.

**Current transport:** the physical ESP32 uses HTTP; it transmits the device credential over that connection and the current firmware does not implement TLS certificate validation. Do not send production credentials or telemetry over an untrusted network.

**Required before production/final merge:** verified HTTPS/TLS, CA certificate validation, hostname verification, secure device credential storage, and a defined credential rotation/revocation process. These are requirements, not current firmware capabilities. Keep the local `esp32/include/secrets.h` out of Git; it is excluded by the repository ignore rules.

## 8. Running and verifying the current system

### Dashboard/backend local development

Start the HTTP development backend as described in section 5, then Vite as described in section 6. This supports local dashboard/backend work.

### Simulator ingestion

The current simulator requires an HTTPS `CPS_BACKEND_URL` and verifies the server certificate. `DEVICE_CREDENTIAL` must be set through the environment. The simulator uses `NODE-01`; that node must already exist in the backend and the credential must be valid for it. Node registration is currently protected by `X-Admin-Token` and returns the device credential once; keep it secret. A credential cannot be recovered from the stored verifier.

From the CPS repository root, in a terminal where the backend Python environment has the `requests` dependency installed, configure placeholders and run:

```powershell
$env:CPS_BACKEND_URL = "https://<reachable-backend-host>"
$env:DEVICE_CREDENTIAL = "<provisioned-device-credential>"
# Optional for a private CA:
$env:CPS_CA_BUNDLE = "<path-to-local-ca-bundle>"
.\backend\.venv\Scripts\python.exe .\simulator\simulator.py
```

Replace placeholders locally; never put real credentials in this document or source control. The repository does not provide a complete clean-clone local TLS server/certificate setup. The standard local backend command above serves HTTP only, so it cannot be used as `CPS_BACKEND_URL` for the simulator. Successful simulator operation requires a separately available HTTPS backend with a certificate trusted by Requests (or the configured CA bundle).

The simulator sends readings only, not heartbeats. To verify heartbeat handling, use a configured ESP32 or another authorized client.

### Verification pointers

- **Backend health:** request `GET /`; expect the fixed running message. This is not a deep database or dependency health check.
- **Frontend:** open the Vite URL; provide the local admin token in the dashboard gate. The UI keeps it in page memory and sends `X-Admin-Token` for protected requests.
- **Readings:** after authenticated ingestion, inspect `GET /readings` or the dashboard Readings screen. Ingestion returns a reading ID and validation fields.
- **Heartbeat:** after a device heartbeat, inspect `GET /heartbeats`. The simulator sends readings only; it does not currently send heartbeats.
- **Node status:** inspect `GET /nodes` or node details. Status is based on server receipt time: ONLINE up to 30 seconds, STALE through 90 seconds, then OFFLINE. Only ACTIVE nodes with heartbeat receipt data can become online/stale.
- **Location:** `GET /locations` lists the location catalogue. The migration seeds 64 subzones and marks only A1-1 deployed; NODE-03 has a one-time migration assignment to A1-1. Do not change this mapping without agreement.
- **Database:** runtime database is `backend/cps.db`, created/updated by backend initialization and ignored by Git. The audited developer workspace also has an ignored root `cps.db`; this is only an observation about that local workspace, not a required file. Do not copy it into a clean clone. A clean clone initializes its own database through backend initialization. Do not delete or regenerate an existing local database without the data owner's approval.

## 9. Current API inventory

All protected endpoint auth below reflects current code. `X-Device-Credential` is node-specific; `X-Admin-Token` is the shared standalone CPS admin secret. Responses are JSON. Platform merge may change routes/contracts, but authentication must not be removed without replacing it with an explicit platform or service authorization policy.

### Device

| Endpoint | Purpose and important fields | Current authentication | Merge expectation |
|---|---|---|---|
| `POST /readings` | Ingest `node_id`, `sensor_id`, `sensor_type`, `value`, `unit`, timezone-aware `timestamp`; response includes `reading_id`, `validation_status`, `confidence`, `validation_reason`. | `X-Device-Credential`; must match the active node named in the body. | Keep a device-authenticated ingestion boundary; version/adapt it to the platform contract. |
| `POST /heartbeat` | Ingest `node_id`, timestamp, optional reported IP/MAC/RSSI, SSID, BSSID, Wi-Fi channel, gateway, and subnet mask; response includes node and connection status plus receipt time. | `X-Device-Credential`; same node binding/lifecycle check. | Keep device authentication; decide whether platform consumers receive internal events or query CPS state. |

### Operator / admin

| Endpoint | Purpose and important fields | Current authentication | Merge expectation |
|---|---|---|---|
| `POST /nodes` | Provision `{node_id}`; response includes generated one-time device `credential`. | `X-Admin-Token`. | Replace caller identity/authorization with platform operator identity and audited provisioning; retain device credential enrollment. |
| `GET /nodes` | List node lifecycle, connection state, location and timestamps. | `X-Admin-Token`. | Likely platform-authorized inventory/read API. |
| `GET /nodes/{node_id}` | Retrieve one node's lifecycle, connection, location and timestamps. | `X-Admin-Token`. | Likely platform-authorized inventory/read API. |
| `POST /nodes/{node_id}/revoke` | Revoke device access; response includes lifecycle/connection state. | `X-Admin-Token`. | Privileged, audited operation under platform authorization. |
| `POST /nodes/{node_id}/reactivate` | Reactivate and rotate credential; response includes new one-time `credential`. | `X-Admin-Token`. | Privileged, audited provisioning flow; safely deliver the rotated credential. |
| `PUT /nodes/{node_id}/location` | Assign `{location_id}` or null; location must exist and be DEPLOYED. | `X-Admin-Token`. | Location ownership/authority must be agreed with platform. |

### Data / dashboard

| Endpoint | Purpose and important fields | Current authentication | Merge expectation |
|---|---|---|---|
| `GET /readings` | Filter by node, location, sensor type, start/end; bounded cursor pagination; returns measurement, location snapshot and validation fields. | `X-Admin-Token`. | Replace shared token with platform user authorization or scoped internal service identity. |
| `GET /nodes/{node_id}/readings` | Per-node filtered/paginated readings with the same measurement and validation fields. | `X-Admin-Token`. | Same as readings history. |
| `GET /heartbeats` | Filter by node and receipt-time range; bounded cursor pagination; includes device timestamp, server receipt, reported IP/MAC/RSSI, and optional reported SSID/BSSID/Wi-Fi channel/gateway/subnet mask. | `X-Admin-Token`. | Restrict network observations; platform-authorized/internal read. |
| `GET /locations` | List zone/hall/subzone IDs and deployment status. | `X-Admin-Token`. | Decide whether CPS or platform inventory owns location data. |
| `GET /locations/{location_id}` | Retrieve one location record. | `X-Admin-Token`. | Same location ownership decision. |
| `GET /api/v1/integration/nodes/{node_id}/state` | Read-only, narrow node state and latest bounded readings for the RASID integration. Initially only `NODE-04` is allowed. | Server-only `X-Rasid-Integration-Token`. | Keep the credential scoped to the integration routes and allowlist; do not use it for administration or device ingestion. |
| `GET /api/v1/integration/nodes/{node_id}/heartbeats` | Read-only newest-first heartbeat receipt history for RASID. Initially only `NODE-04` is allowed; `limit` defaults to 50 and cannot exceed 50. | Server-only `X-Rasid-Integration-Token`. | Returns only server `received_at` timestamps; do not expose device timestamps, internal IDs, or network observations. |
| `GET /weather/external-temperature` | Latest stored external-temperature observation or `UNCONFIGURED`. Fields include provider/site, observed/retrieved time, value/unit/status/error code. | `X-Admin-Token`. | Keep only if an agreed external provider contract uses it; no provider ingestion is implemented. |

`GET /` is a public minimal running message. FastAPI's default docs/OpenAPI endpoints may also be exposed by the development server. They are not substitutes for authorization on data APIs.

### Narrow platform node-state and heartbeat integration

`GET /api/v1/integration/nodes/{node_id}/state` provides the Rasid/Decision Engine integration with the minimum node health, location, and latest reading data. The initial server-side allowlist contains only `NODE-04`; other syntactically valid node IDs, including `NODE-03`, receive `403`, while an allowed but unregistered node receives `404`.

Authentication uses the dedicated server-only `X-Rasid-Integration-Token`.
`authorize_integration_read` compares it with `secrets.compare_digest`; a
missing or invalid credential returns generic `401`, while a missing CPS
integration configuration returns generic `503`. The credential does not
authorize any administrator, dashboard, device-ingestion, or write route and
must not be exposed to a browser.

The state response contains only `node_id`, `status`, `connection_status`, `location_id`, `last_heartbeat_received_at`, `reported_relay_state`, `relay_reported_at`, `network_observation`, `as_of`, and up to 10 readings. Each reading contains only `sensor_id`, `sensor_type`, `value`, `unit`, `timestamp`, and `validation_status`. Location identifiers are returned exactly as stored (for example, `A1-1`). The route accepts no history filters or cursor parameters.

`GET /api/v1/integration/nodes/{node_id}/heartbeats` uses the same credential
and allowlist. It accepts only optional `limit`, which defaults to 50 and must
be an integer from 1 through 50. It returns `{ "node_id", "as_of", "items" }`;
each item is exactly `{ "received_at" }`. `received_at` is the UTC time CPS
accepted the heartbeat and is authoritative for ordering and liveness. Items
are newest first by `received_at DESC, id DESC`. The endpoint is read-only and
does not return device timestamps, record IDs, relay state, IP/MAC/RSSI,
Wi-Fi metadata, credentials, or credential verifiers.

`reported_relay_state` is `ON`, `OFF`, or null. It is an observation reported
by the device and is not a control result or confirmation of physical
actuation. `relay_reported_at` is the server `received_at` value from the same
latest persisted heartbeat used for the relay report; both fields are null when
there is no heartbeat or the latest heartbeat did not include a relay state.

`network_observation` is a nullable, strictly allowlisted object from that
same latest persisted heartbeat. It contains only `reported_ip`,
`reported_mac`, `reported_rssi_dbm`, `reported_ssid`, `reported_bssid`,
`reported_wifi_channel`, `reported_gateway`, `reported_subnet_mask`, and
`reported_at`. `reported_at` is the heartbeat's authoritative server
`received_at`, not the device timestamp. If no heartbeat exists all fields
are null, and null fields are never filled from older records. These are
device-reported network observations, not independently verified facts; they
may be stale or historical whenever `connection_status` is not `ONLINE`.
Do not log them, expose credentials or Wi-Fi passwords, or add arbitrary
heartbeat fields to this contract.

The route queries the node, latest persisted heartbeat, and latest readings directly. It calculates `connection_status` in memory using the existing 30-second ONLINE and 90-second STALE thresholds; non-active nodes and nodes without a received heartbeat are OFFLINE. It does not call `GET /nodes/{node_id}`, change `node.connection_status`, commit, or otherwise write to the database. Storage/service failures return a generic `503` without internal exception details.

Before production integration, replace the static service secret with managed
service identity/secret rotation as appropriate for deployment. Do not remove
or weaken existing endpoint authentication as part of this integration.

## 10. Authentication to preserve during development

- **`X-Device-Credential`:** authenticates a registered node for `POST /readings` and `POST /heartbeat`. Device authentication remains required. Node ID alone is not authentication, and a device credential cannot authorize admin/data-read APIs.
- **`X-Admin-Token`:** current shared token for standalone CPS administration and dashboard reads. It is a temporary standalone CPS administration mechanism and is expected to be replaced by platform authentication during merge. **Do not remove it now.** Until replacement is implemented and verified, keep protected endpoints protected.
- **`X-Rasid-Integration-Token`:** dedicated server-to-server credential for only `GET /api/v1/integration/nodes/{node_id}/state` and `GET /api/v1/integration/nodes/{node_id}/heartbeats`; the current allowlist permits only `NODE-04`. It is not accepted by any other route.
- **`X-Rasid-Control-Token`:** separate server-to-server credential for the
  non-actuating NODE-04 command foundation only. It cannot read integration
  state, administer CPS, or authenticate a device. Keep it server-side.

Never make telemetry, history, provisioning, revocation, reactivation, or location-assignment APIs public as a side effect of platform integration.

### Phase 1B command foundation

The command ledger is intentionally not an actuator API. The control service
can create an expiring NODE-04/`RELAY-01` envelope through
`POST /api/v1/control/nodes/NODE-04/commands`; future compatible firmware can
poll `GET /api/v1/device/nodes/NODE-04/commands/next` and acknowledge a
delivered envelope using `X-Device-Credential`. Every command route requires
direct HTTPS and rejects plaintext HTTP. Current ESP32 firmware does not call
these routes and must not be flashed or changed as part of Phase 1B.

Each record is `NON_ACTUATING`, node-bound, expiry-bound, and idempotent. Its
lifecycle is `PENDING → DELIVERED → ACKNOWLEDGED`, or
`PENDING/DELIVERED → EXPIRED/REJECTED`; its maximum lifetime is 90 seconds.
Acknowledgement is not a relay change or proof a fan runs. The heartbeat's
`reported_relay_state` remains a separate device-reported observation.

## 11. Current security limitations / blockers

- Physical ESP32 currently uses **HTTP**, not HTTPS. Production requires HTTPS/TLS with certificate-chain and hostname validation.
- The firmware sends its device credential with each request; HTTP exposes it to network interception.
- No idempotency key or replay protection is implemented. Duplicate readings are possible after retries or ambiguous network outcomes.
- Firmware has no persistent offline buffer; failed readings are logged and discarded.
- Device-reported IP/MAC/RSSI are observations, not independently verified network facts.
- Admin token is shared and is not user identity, role-based authorization, or per-user audit.
- SQLite schema changes/migrations run during application startup and are SQLite-specific. There is no general migration framework in the current repository.
- Backend package versions are unpinned. Production dependency, secrets, database, deployment, and monitoring configuration remain separate work.

These are current limitations, not solved controls. The simulator's verified HTTPS behavior does not fix the ESP32 transport gap.

## 12. Current data model

- **Node:** unique node ID, credential verifier, lifecycle state, current connection state, current location, last device timestamp, last server heartbeat receipt time, provisioning/revocation timestamps.
- **SensorReading:** node/sensor identity, measurement type/value/unit, device timestamp, validation status/confidence/reason, nullable location ID.
- **Heartbeat:** node ID, device timestamp, server `received_at`, optional reported IP/MAC/RSSI.
- **Zone, Hall, Subzone:** normalized location catalogue. Only the seeded A1-1 subzone is marked deployed by current migration data.
- **ExternalTemperatureObservation:** provider/site, observation and retrieval times, optional value/unit, status and non-secret error code. No provider client currently writes observations.

When an authenticated reading is accepted, the backend copies the node's current `location_id` into that reading. Later node reassignment affects new readings, not existing snapshots. Historical rows without a verified location remain NULL; the migration does not broadly backfill them. AI event IDs, decisions and actuator command references are not in the current data model.

## 13. Testing

From `backend/` with the virtual environment active, run `python -m pytest`. The repository does not specify a current test count in this handoff; counts vary with the checkout and should be obtained by running the suite.

Current test modules cover:

- Admin-token configuration/startup and deterministic SQLite path.
- Device/admin authorization, node identity binding, lifecycle, and credential omission from responses.
- Reading integrity ranges, supported types/units, peer comparison, configured groups, freshness, and persistence.
- Timestamp timezone/future-skew validation.
- HTTPS behavior for the simulator, CA trust, hostname checks and a local TLS listener.
- Location catalogue/assignment, reading location snapshots, heartbeat receipt freshness and migration behavior.
- History filtering/cursor pagination and health-monitor recovery from a transient failure.

These are automated backend tests; they do not establish that the physical ESP32 uses HTTPS, that a deployed device is online, or that AI/CPS integration exists.

## 14. Simulator

`simulator/simulator.py` simulates a node by generating synthetic temperature, humidity and pressure readings and posting them to `/readings`. It requires:

- `CPS_BACKEND_URL` — an HTTPS base URL; the script appends `/readings`.
- `DEVICE_CREDENTIAL` — the simulated node's device credential, provided through the environment, not source.
- Optional `CPS_CA_BUNDLE` — a CA bundle for a private certificate authority. Without it, Requests uses its default certificate trust.

The current simulator keeps failed readings in an in-memory list and retries them during later cycles. That buffer is not persistent, has no configured bound, and can duplicate records if a prior request succeeded but its response was lost. The simulator does not send heartbeats. `simulator/simulator_before_offline_buffer.py`, if present, is an untracked legacy copy with no reading buffer; do not assume it is the current simulator or part of the committed baseline.

Set environment values only in a local shell/session or a properly ignored local configuration. Do not put real device credentials in scripts or commit them.

## 15. AI/CPS integration boundary

Target flow:

```text
AI service → AI Event
CPS → Validated CPS State
AI Event + CPS State → Decision Engine
Decision → Alert/Action
Action service → authorized actuator control
```

**THIS IS NOT IMPLEMENTED YET.** There is no AI event endpoint, event schema, Decision Engine, decision record, actuator API, or actuator safety/authorization contract in this CPS implementation. Do not treat a dashboard placeholder or weather read endpoint as an integration.

## 16. What the AI team should do first

1. Clone this repository and inspect the current working tree/baseline.
2. Install dependencies using the manifests and the setup instructions above.
3. Start the backend with a local `.env` token.
4. Start the frontend and verify it reaches the local backend.
5. Run the backend test suite and record the result for that checkout.
6. Read the API inventory and inspect current request/response schemas in Swagger/source.
7. Confirm the CPS baseline with an authorized test node or simulator; account for simulator-only HTTPS and firmware HTTP behavior.
8. Agree on the AI Event contract, ownership, validation and delivery semantics.
9. Agree on the CPS State contract, freshness and stale/offline semantics.
10. Agree on canonical node, location, zone and event identifiers.
11. Agree on platform user authorization and service-to-service identity/scopes.
12. Only after those decisions, implement the Decision Engine integration in the agreed service boundary.

## 17. What developers must not do

- Do not commit secrets or place real credentials in source.
- Do not remove device authentication.
- Do not make telemetry or administrative endpoints public.
- Do not treat stale/offline data as current normal state.
- Do not invent sensor readings or AI events and present them as real.
- Do not rename or reassign A1-1 / NODE-03 without agreement.
- Do not embed AI logic in `backend/main.py` without architecture agreement.
- Do not implement actuator control directly from AI events; use an authorized action boundary with safety checks and audit.
- Do not assume Decision Engine integration already exists.
- Do not treat the shared `X-Admin-Token` as user identity or remove it before an authenticated replacement is implemented.

## 18. Current status

### IMPLEMENTED

- FastAPI node provisioning/lifecycle, device-authenticated readings and heartbeats, reading integrity assessment, node health state, SQLite storage, location catalogue/snapshots, bounded history APIs, and admin-protected dashboard APIs.
- React dashboard for CPS readings, nodes, locations, heartbeats and node management.
- HTTPS-enforcing simulator with certificate verification and in-memory retry buffering.
- PlatformIO source for a NodeMCU-32S/ESP32 Arduino firmware using a BME280.

### IN PROGRESS / SECURITY GAP

- Physical firmware integration uses HTTP without TLS certificate validation; production transport security is not complete.
- Admin access uses one shared static token rather than platform user authentication and role-based authorization.
- Firmware has no persistent retry/buffering or replay/idempotency protection.
- SQLite migrations are startup-based and specific to SQLite; production database/deployment is not selected.
- A clean firmware clone requires a locally created `esp32/include/secrets.h` based on the committed placeholder-only `esp32/include/secrets.example.h`; real Wi-Fi and device credentials must never be committed.

### NOT IMPLEMENTED / FUTURE

- AI event ingestion and AI/CCTV integration.
- CPS/AI state correlation, occupancy fusion and Decision Engine.
- Alert/action service integration, actuator inventory/control, safety contract and command auditing.
- Platform authentication/service identity integration.
- External weather provider ingestion.
- Production database, deployment, secrets management, monitoring and operational hardening.

### Clean-clone verification checklist

- **Backend:** install requirements in Python 3.10+; confirm the backend starts with a local admin token; confirm `/docs` or `/openapi.json` is reachable; run `python -m pytest` from `backend/` (or use the venv's Python executable directly if activation is unavailable).
- **Frontend:** run `npm install`, `npm run build`, and confirm the dashboard loads against the local backend.
- **ESP32:** confirm the PlatformIO build succeeds after creating the local secrets file; verify real secrets are not committed.
- **Simulator:** claim successful ingestion only when an HTTPS backend and trusted certificate/CA are actually available, and `NODE-01` has a valid provisioned device credential.

The simulator command above uses the backend venv's Python executable, which is the environment installed from `backend/requirements.txt`. If the venv has not been created, activate an environment with `requests` installed or install the backend requirements first.
