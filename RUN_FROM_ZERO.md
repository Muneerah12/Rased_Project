# RASID CPS — Run Everything From Zero

This guide takes a fresh Windows PC to a running RASID CPS platform: the CPS backend,
the RASID AI server and dashboard, and the physical ESP32 NODE-04. Commands are for
PowerShell or Git Bash from the repository root unless stated otherwise.

---

## 1. What you are running

```
 ESP32 NODE-04 (BME280 + HVAC relay)
        │  heartbeats + readings every few seconds
        ▼
 ┌─ HTTPS path (default) ──────────────────────────┐   ┌─ Plain-HTTP path (private Wi-Fi) ─┐
 │ Caddy  HOST_IP:8443  →  gateway.py 127.0.0.1:8013│   │ ESP32 → http://HOST_IP:8001        │
 └──────────────────────────┬───────────────────────┘   └──────────────┬────────────────────┘
                            ▼                                          ▼
               CPS backend  :8001   (FastAPI + SQLite  CPS-Project/backend/cps.db)
                            │  read-only integration API + token
                            ▼
               RASID server :8010   (FastAPI: AI models, cameras, incidents, HVAC, NODE-04 watcher)
                            │  WebSocket /api/ws + REST
                            ▼
               Dashboard    http://localhost:8010   (React + TypeScript, served from web/dist)
```

| Service | Port | Started by | Code |
| --- | --- | --- | --- |
| CPS backend | 8001 | `start-cps.bat` or uvicorn | `CPS-Project/backend/` |
| RASID server + dashboard | 8010 | `start.bat` / `start-cps.bat` | `server/`, `web/dist` |
| ESP32 gateway (HTTPS path) | 127.0.0.1:8013 | `python gateway.py` | `CPS-Project/gateway/` |
| Caddy TLS proxy (HTTPS path) | HOST_IP:8443 | `caddy run` | `CPS-Project/gateway/Caddyfile.example` |
| Dashboard dev server (optional) | 5173 | `npm run dev` | `web/` |

### Repository structure

```
README.md                      Arabic overview and camera/AI usage
RUN_FROM_ZERO.md               this guide
NODE04_TEAMMATE_SETUP.md       NODE-04 on another PC/Wi-Fi with plain HTTP
NODE04_LOCAL_HTTPS.md          rules for the HTTPS ingestion path
start.bat / start.sh           RASID server only (port 8010)
start-cps.bat                  CPS backend on 8001 (network) + RASID server
server/                        RASID FastAPI server
  main.py                      API, WebSocket, cameras, HVAC, NODE-04 watcher startup
  detectors.py models_loader.py  YOLO detectors (people, fire/smoke, fall)
  threat/                      weapons, violence (VideoMAE), audio (AST), tracking
  cps_integration.py           read-only CPS client (token in server/.env)
  cps_watch.py                 NODE-04 offline alert/incident watcher
  operational_hvac_*.py        monitor-only HVAC recommendation
  data/                        runtime: cameras.json, events/journal .jsonl, snapshots (not in git)
  tests/                       unittest suite
web/                           React + TypeScript dashboard (Vite); web/dist is committed
  src/cps-workspace/           IoT/CPS pages: overview, OT, NOC, simulation center
  tests/                       tsx test files (npm test)
CPS-Project/
  backend/                     CPS FastAPI service, models, tests, cps.db (committed snapshot)
  esp32/                       NODE-04 firmware (PlatformIO); include/secrets.h is local only
  gateway/                     HTTPS ingestion path: gateway.py, Caddyfile.example, issue-cert.sh
  frontend/                    standalone CPS operator UI (React 19, optional)
  simulator/                   software NODE simulator
  docs/                        01–06 architecture, logs, status, security, handoff
docs/                          MVP notes
```

---

## 2. Install the tools (once)

| Tool | Version | Needed for |
| --- | --- | --- |
| Git | any | clone the repo |
| Python | 3.10+ (tested 3.13) | CPS backend and RASID server |
| Node.js | 20+ | only to rebuild or develop the dashboard (`web/dist` is committed) |
| VS Code + PlatformIO IDE | latest | flashing the ESP32 |
| Silicon Labs CP210x driver | latest | ESP32 USB serial (COM port) |
| Caddy | 2.x (`winget install CaddyServer.Caddy`) | HTTPS path only |
| OpenSSL | bundled with Git for Windows | HTTPS path certificate |

The first RASID start downloads the AI models (YOLO and Hugging Face models, ~1–2 GB).
Keep internet access for that run.

---

## 3. Get the code

```
git clone https://github.com/Muneerah12/Rased_Project.git
cd Rased_Project
```

---

## 4. Create the secret files (never commit them)

| File | Copy from | Set |
| --- | --- | --- |
| `CPS-Project/.env` | `CPS-Project/.env.example` | `ADMIN_PROVISIONING_TOKEN`, `RASID_INTEGRATION_TOKEN`, `RASID_CONTROL_TOKEN` — long random values |
| `server/.env` | `server/.env.example` | `CPS_RASID_INTEGRATION_TOKEN` = same value as `RASID_INTEGRATION_TOKEN`; `CPS_INTEGRATION_BASE_URL=http://127.0.0.1:8001` |
| `CPS-Project/esp32/include/secrets.h` | `secrets.example.h` | Wi-Fi name/password, `NODE_ID "NODE-04"`, `DEVICE_CREDENTIAL`, `BACKEND_URL` |

Generate random tokens with:

```
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

`DEVICE_CREDENTIAL` must match the hash stored for the node in `cps.db`. The published
database keeps the recorded readings and heartbeats, but its device credentials were reset and
its Wi-Fi details removed, so issue a fresh credential for NODE-04 once the CPS backend is
running (section 5) — it is shown once, put it in `secrets.h`:

```
curl -X POST http://127.0.0.1:8001/nodes/NODE-04/revoke     -H "X-Admin-Token: <ADMIN_PROVISIONING_TOKEN>"
curl -X POST http://127.0.0.1:8001/nodes/NODE-04/reactivate -H "X-Admin-Token: <ADMIN_PROVISIONING_TOKEN>"
```

Optional `server/.env` settings: `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` and
`NOTIFY_WEBHOOK_URL` (alerts), `OPENROUTER_API_KEY` (gunshot classification), and the
`OPERATIONAL_HVAC_*` approved thresholds (defaults in `.env.example`).

---

## 5. Start the platform

### Quick start (Windows)

Double-click **`start-cps.bat`**. On the first run it creates the virtual environments, installs
requirements, and asks once for admin rights to open port 8001. It starts the CPS backend on
port 8001 and the RASID server on port 8010, then opens http://localhost:8010.

### Manual start

```
# CPS backend (port 8001)
cd CPS-Project
python -m venv backend/.venv
backend\.venv\Scripts\pip install -r backend/requirements.txt
backend\.venv\Scripts\python -m uvicorn main:app --app-dir backend --host 127.0.0.1 --port 8001

# RASID server + dashboard (port 8010), in a second terminal
cd server
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
.venv\Scripts\python -m uvicorn main:app --host 127.0.0.1 --port 8010
```

Use `--host 0.0.0.0` for the CPS backend only on the plain-HTTP path (section 6b).

---

## 6. Connect the ESP32 NODE-04

The laptop and the ESP32 must be on the same 2.4 GHz Wi-Fi that allows device-to-device traffic
(a phone hotspot or home router; campus networks usually block it). Give the laptop a fixed IP or
DHCP reservation — the ESP32 has it in `BACKEND_URL`.

### 6a. HTTPS path (default)

```
cd CPS-Project/gateway
set CPS_UPSTREAM_URL=http://127.0.0.1:8001
python gateway.py
sh issue-cert.sh <HOST_IP> <root.crt> <root.key>      # CA embedded in the firmware
# copy Caddyfile.example to Caddyfile, replace {{HOST_IP}}, then:
caddy run --config Caddyfile --adapter caddyfile
```

Allow inbound TCP 8443 only on `HOST_IP` and only from the ESP32's subnet (admin PowerShell):

```
New-NetFirewallRule -DisplayName "RASID CPS Caddy NODE-04 TLS 8443" -Direction Inbound -Protocol TCP -LocalPort 8443 -LocalAddress <HOST_IP> -RemoteAddress <ESP32_SUBNET> -Action Allow
```

Firmware: `BACKEND_URL "https://<HOST_IP>:8443"`. See `CPS-Project/gateway/README.md`.

### 6b. Plain-HTTP path (private network only)

Firmware: `BACKEND_URL "http://<HOST_IP>:8001"`; run the CPS backend with `--host 0.0.0.0`
(`start-cps.bat` does this). No gateway, Caddy or certificate. Readings and the device credential
are not encrypted. Full steps: `NODE04_TEAMMATE_SETUP.md`.

### Flash the firmware

1. Plug in the ESP32; note its COM port (Device Manager → Ports) and set `upload_port` in
   `CPS-Project/esp32/platformio.ini`.
2. Open `CPS-Project/esp32` in VS Code → PlatformIO **Upload** (or `pio run -t upload`).
3. PlatformIO **Monitor** (9600 baud) should show `Heartbeat HTTP status: 200`.

---

## 7. Verify

| Check | Expected |
| --- | --- |
| http://localhost:8010 | sign-in page, then the dashboard |
| http://localhost:8010/api/health | `ok: true`, AI models `ready` after the first download |
| http://localhost:8010/api/cps/node-state | `"connection_status": "ONLINE"` with recent readings |
| Dashboard → IoT / CPS → Overview | NODE-04 ONLINE, live sensor tiles, Riyadh weather |
| IoT / CPS → NOC | heartbeat bars arriving every ~10–20 s |
| http://localhost:8001/docs | CPS backend API (most routes need a token) |

If NODE-04 stays offline for more than 90 s, the RASID server raises a bell alert and an
IoT Sensor incident ("CPS Node Offline"); both clear when heartbeats resume.

---

## 8. Day-to-day

| Task | Command |
| --- | --- |
| Rebuild the dashboard after editing `web/src` | `cd web && npm install && npm run build` |
| Dashboard dev server with hot reload | `cd web && npm run dev` (port 5173, proxies `/api` to 8010) |
| Dashboard tests | `cd web && npm test` |
| RASID server tests | `cd server && .venv\Scripts\python -m unittest discover -s tests` |
| CPS backend tests | `cd CPS-Project && backend\.venv\Scripts\python -m pytest backend/tests` |
| Start fresh (clear events/journal) | stop the server, delete `server/data/events.jsonl` and `journal.jsonl` |

---

## 9. Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| ESP32 `Wi-Fi status: 1` | Wi-Fi name wrong (check spaces and capitals, e.g. a trailing space) |
| ESP32 `-1 connection refused` | wrong `BACKEND_URL`, service not running, firewall, or laptop on another Wi-Fi |
| ESP32 `X509 - Certificate verification failed` | certificate lacks the IP as a DNS name, or not signed by the firmware's CA — rerun `issue-cert.sh` |
| ESP32 `401` / `403` | wrong `DEVICE_CREDENTIAL` or node revoked |
| NODE-04 OFFLINE but ESP32 fine | laptop switched Wi-Fi and lost `HOST_IP`; rejoin the ESP32's network |
| CPS section "unavailable" in the dashboard | CPS backend not on 8001, or `CPS_RASID_INTEGRATION_TOKEN` ≠ `RASID_INTEGRATION_TOKEN` |
| Camera audio error `No module named 'av'` | `pip install -r server/requirements.txt` in the server venv |
| Incidents page looks empty | clear the "Within scope" box and set status to all |
| Port already in use | another copy is running; stop it or use different ports |

Security notes and the full design are in `CPS-Project/docs/05_Security_Requirements.md` and
`01_Architecture_and_Concepts.md`.
