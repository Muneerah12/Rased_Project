# CPS-Project — part of the Rased Platform

This folder is **not a separate project**. It holds the CPS parts of the Rased Platform:

| Folder | Role |
| --- | --- |
| `backend/` | CPS backend (port 8001): receives NODE-04 heartbeats and readings, keeps the recorded history in `backend/cps.db`, and serves it read-only to the Rased Platform server |
| `esp32/` | NODE-04 firmware (ESP32 + BME280 + HVAC relay) |
| `gateway/` | HTTPS ingestion path for the ESP32 (Caddy + loopback gateway) |
| `simulator/` | Software node for testing without hardware |
| `docs/` | 01 architecture · 02 implementation log · 03 testing log · 04 status · 05 security · 06 handoff |

The CPS backend has no user interface of its own. Operators use the Rased Platform dashboard
at http://localhost:8010 → IoT / CPS. To run everything, follow `RUN_FROM_ZERO.md` in the
repository root (or double-click `start-cps.bat`).
