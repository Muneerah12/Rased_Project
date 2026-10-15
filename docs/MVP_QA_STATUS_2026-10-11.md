# RASID-CPS MVP QA status — 2026-10-11

## Live verification

- CPS and RASID were running locally during this check.
- The RASID health endpoint, camera status, events, journal, CPS node-state,
  CPS heartbeat-history, and operational HVAC endpoints each returned HTTP 200.
- `NODE-04` reported `ONLINE`, fresh server-receipt heartbeats, BME280 readings,
  and a nullable device-reported relay state through the server-side CPS bridge.
- `CAM-1` was active through the browser camera path with the `people` model
  enabled. Existing live crowding events and their snapshots were available
  through the event/incident paths.
- The production web build, frontend typecheck and frontend tests passed. The
  RASID backend test suite passed 57 tests.

## Explicit safety and provenance limits

- The operational HVAC API remains monitor-only; it has no command or physical
  actuator path.
- The current CPS temperature integrity status is not `NORMAL`, so the
  operational HVAC endpoint correctly returns `INSUFFICIENT_EVIDENCE`. It does
  not treat `UNKNOWN` integrity as trusted data.
- Iriun-delivered recorded footage is processed by the real browser-camera AI
  pipeline, but the server records that transport as `source=live`; it cannot
  establish whether the pixels originated from a live scene or prerecorded
  footage. Present this explicitly as live inference over a recorded feed, not
  as an independently verified field camera.
- The Simulation Center remains browser-local and is separate from CPS, AI
  operational evidence, incidents, and physical HVAC control.

## Crowding-event review

The inspected journal showed one start/update/end lifecycle per crowding event,
not a new event for every analyzed frame. Several distinct crowding episodes
were recorded while the Iriun footage ran. This is consistent with separate
periods of detection or feed interruption/restart, but should be described as
a demo limitation if a repeated/looping recording is used. No incident logic
was changed during QA.

## Demo decision

The MVP is suitable for a monitor-only demonstration of real CPS telemetry and
real AI inference. Do not represent recorded Iriun footage as a live physical
scene, and do not promise an HVAC recommendation or actuation while sensor
integrity is not `NORMAL`.
