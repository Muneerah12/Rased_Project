# Run NODE-04 on your own PC and Wi-Fi

The ESP32 sends plain HTTP to the CPS backend on your PC at
`http://<your PC IP>:8001`. Use a home router or phone hotspot: campus and
office networks usually block devices from reaching each other. Data is not
encrypted, so do not use this on a shared network.

## What you need

- This repository (`main`), Python 3.10+
- PlatformIO (VS Code extension "PlatformIO IDE") and the Silicon Labs CP210x
  USB driver, to flash the ESP32
- A NODE-04 `DEVICE_CREDENTIAL` (never commit it): issue one with the revoke + reactivate
  admin calls in `RUN_FROM_ZERO.md` section 4, or get it privately from whoever runs the backend

## 1. Your PC

1. Connect to your Wi-Fi (2.4 GHz) and run `ipconfig`. Note the Wi-Fi
   "IPv4 Address", e.g. `192.168.1.20`. Give it a fixed IP or a DHCP
   reservation in the router so it does not change; if it changes, the ESP32
   must be reflashed.
2. Copy `CPS-Project\.env.example` to `CPS-Project\.env`. Put any long random
   value in each token, for example from
   `python -c "import secrets; print(secrets.token_urlsafe(32))"`.
3. Copy `server\.env.example` to `server\.env` and set
   `CPS_RASID_INTEGRATION_TOKEN` to the same value as `RASID_INTEGRATION_TOKEN`
   in `CPS-Project\.env`. Keep `CPS_INTEGRATION_BASE_URL=http://127.0.0.1:8001`.

## 2. The ESP32

1. Copy `CPS-Project\esp32\include\secrets.example.h` to `secrets.h` in the
   same folder and set:
   ```c
   #define WIFI_SSID "YourWiFiName"
   #define WIFI_PASSWORD "YourWiFiPassword"
   #define NODE_ID "NODE-04"
   #define DEVICE_CREDENTIAL "<the credential you were sent>"
   #define BACKEND_URL "http://192.168.1.20:8001"   // your IP from step 1
   ```
   Leave `LOCAL_ROOT_CA_CERT` empty.
2. Plug in the ESP32. In Device Manager > Ports, note its COM port and set
   `upload_port` in `CPS-Project\esp32\platformio.ini` to it.
3. Open `CPS-Project\esp32` in VS Code and run PlatformIO **Upload**
   (or `pio run -t upload`).

## 3. Run

Double-click `start-cps.bat` in the repository root. The first run installs
requirements and asks once for admin rights to open port 8001 in the firewall.
It starts the CPS backend on port 8001 and Rasid at http://localhost:8010.

## Check

- PlatformIO **Monitor** (9600 baud) shows `Heartbeat HTTP status: 200`.
- In Rasid, IoT > CPS shows NODE-04 as ONLINE with new readings.

`-1 connection refused` means a wrong IP in `BACKEND_URL`, the backend not
running, or the firewall/network blocking port 8001. `Wi-Fi status: 1` means
the Wi-Fi name is wrong (check spaces and capitals). `401` or `403` means a wrong
`DEVICE_CREDENTIAL`.
