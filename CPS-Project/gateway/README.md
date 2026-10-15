# NODE-04 HTTPS ingestion path

How the ESP32 reaches the CPS backend over HTTPS:

```
ESP32 NODE-04 ──HTTPS──▶ Caddy (HOST_IP:8443) ──▶ gateway.py (127.0.0.1:8013) ──▶ CPS backend (127.0.0.1:8001)
```

Only Caddy listens on the network; the gateway and CPS backend stay on localhost. Caddy accepts
only `POST /heartbeat` and `POST /readings`; the gateway requires the `X-Device-Credential`
header and forwards it to CPS, which checks it against the stored hash.

| File | Purpose |
| --- | --- |
| `gateway.py` | Loopback forwarder. `CPS_UPSTREAM_URL` sets the CPS backend (default `http://127.0.0.1:8001`). |
| `Caddyfile.example` | TLS proxy config; replace `{{HOST_IP}}` with this PC's IP and save as `Caddyfile`. |
| `issue-cert.sh` | Issues `certs/node04.crt` / `.key` for the host IP, signed by the CA embedded in the firmware. |

## Run

```
python gateway.py
sh issue-cert.sh <HOST_IP> <root.crt> <root.key>
caddy run --config Caddyfile --adapter caddyfile
```

Allow inbound TCP 8443 in the firewall, only on `HOST_IP` and only from the ESP32's subnet.
The firmware's `BACKEND_URL` must be `https://<HOST_IP>:8443`. If the IP changes, issue a new
certificate and update the Caddyfile (and the firmware if `BACKEND_URL` changes).

For a private network without TLS, see `NODE04_TEAMMATE_SETUP.md` in the repository root
(plain `http://<HOST_IP>:8001`, no gateway or Caddy).

Never commit `certs/`, `Caddyfile` with real IPs if private, the CA private key, or `secrets.h`.
