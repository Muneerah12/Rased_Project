# CPS NODE-04 local development bridge

The IoT/OT Overview displays read-only CPS state for `NODE-04` through the
same-origin RASID route `GET /api/cps/node-state`. The CPS integration token is
sent only by the RASID Python server and is never exposed to the browser.

For the local CPS server only, place the following in `server/.env` (never
commit the token):

```ini
CPS_INTEGRATION_DEVELOPMENT_MODE=1
CPS_INTEGRATION_BASE_URL=http://127.0.0.1:8001
CPS_RASID_INTEGRATION_TOKEN=replace-with-the-CPS-token
CPS_INTEGRATION_TIMEOUT_S=5
```

HTTP is rejected unless development mode is explicitly enabled and the CPS host
is exactly `127.0.0.1` or `localhost`. All other targets must use HTTPS with
certificate and hostname verification. The RASID route accepts only direct
loopback clients (`127.0.0.1` or `::1`) and deliberately ignores forwarded
address headers; it is not a reverse-proxy or production endpoint.

If CPS reports `OFFLINE`, returned readings are labelled historical. RASID does
not cache, fabricate, or control CPS data.

## MVP closure preflight (2026-10-10)

This bridge is ready for a local, read-only demonstration only after the CPS
backend and RASID backend are both running with their server-side configuration
loaded. Verify the following from the RASID loopback host before presenting
live data:

1. `GET /api/health` returns successfully.
2. `GET /api/cps/node-state` returns `NODE-04` with its exact CPS
   `connection_status`, heartbeat timestamp, readings, and nullable
   device-reported relay state.
3. `GET /api/cps/node-heartbeats` returns bounded, newest-first receipt-time
   history.
4. `GET /api/operational/hvac/recommendation` reports monitor-only evidence.
   It must return `POLICY_NOT_CONFIGURED` until an operational policy is
   explicitly approved; it never controls a relay.

Do not present a fixture, Simulation Center value, missing source, or stale
observation as real operational data. This integration deliberately has no
physical actuator command path.
