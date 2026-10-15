"""Rasid AI server — FastAPI.

  Web UI ............ GET  /                      (built Rasid app from web/dist)
  Health/models ..... GET  /api/health
  Live updates ...... WS   /api/ws                (journal + camera frames + status)
  Journal ........... GET  /api/journal?since=N   POST /api/journal   POST /api/journal/reset
  Cameras ........... GET  /api/cameras           PATCH /api/cameras/{id}
                      POST /api/cameras/{id}/stream {url}   DELETE /api/cameras/{id}/source
                      GET  /api/cameras/{id}/mjpeg  (annotated live view of a server stream)
  Frame analysis .... POST /api/detect            (multipart; same contract as lama-main + camera_id)
  Recorded video .... POST /api/analyze-video     GET /api/jobs/{id}
  Evidence .......... GET  /api/snapshots/{file}  GET /api/uploads/{file}   POST /api/uploads
  Events ............ GET  /api/events
  Notifications ..... GET  /api/notify            POST /api/notify/test
  Gunshot mic ....... POST /api/gunshot           (audio clip → OpenRouter classification)
"""

from __future__ import annotations

import asyncio
import json
import re
import shutil
import threading
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import cv2
import numpy as np
from fastapi import Body, FastAPI, File, Form, HTTPException, Query, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from starlette.concurrency import run_in_threadpool

import config
from cameras import VALID_DIRECTIONS, VALID_MODELS, registry
from detectors import run_enabled
from events import load_events
import gunshot as gunshot_mod
from hub import hub, now_ms
from jobs import create_job, get_job
from models_loader import models_status, preload_models
from notify import channels_status, notifier
from cps_integration import (
    CpsIntegrationError,
    fetch_node_heartbeat_history,
    fetch_node_reading_history,
    fetch_node_state,
    require_loopback_request,
    validate_history_request,
)
import threat
from cps_watch import NodeWatch
from operational_hvac_api import recommendation_response
from operational_hvac_service import (
    collect_and_evaluate_operational_hvac,
    policy_from_settings,
    previous_people_observation,
    previous_temperature_observation,
)
from simulation_hvac_api import SimulationHvacRequestError, evaluate_simulation_request

# Actions a Rasid client may append to the shared journal (validated, never executed here).
CLIENT_ACTIONS = {"MANUAL_REPORT", "ASSIGN", "STEP", "FIELD_ACTION", "DRONE_DEPLOY", "DRONE_END", "CLOSE"}


async def _ticker() -> None:
    while True:
        await asyncio.sleep(1.0)
        await run_in_threadpool(registry.tick)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    hub.bind_loop(asyncio.get_running_loop())
    # each platform start begins a new shift: staff and drones start available on every screen
    hub.record({"type": "SHIFT_START"})
    threading.Thread(target=preload_models, daemon=True).start()
    registry.autostart()
    task = asyncio.create_task(_ticker())
    # NODE-04 offline alert: shared journal (all screens) + Telegram/webhook when configured
    watch_stop = threading.Event()
    if config.CPS_INTEGRATION_BASE_URL:
        threading.Thread(target=NodeWatch(record=hub.record, notify=notifier.send_text).run, args=(watch_stop,), daemon=True).start()
    yield
    watch_stop.set()
    task.cancel()
    for rt in registry.cams.values():
        if rt.worker:
            rt.worker.stop()


app = FastAPI(title="Rasid AI server", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
threat.setup(app)  # add-on: /api/threat/* (registered before the web UI catch-all)


def _decode_image(data: bytes) -> np.ndarray:
    arr = np.frombuffer(data, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(400, "Could not decode image")
    return img


def _safe_name(name: str) -> str:
    base = re.sub(r"[^A-Za-z0-9._-]+", "_", Path(name or "file").name)[-80:]
    return base or "file"


# ------------------------------------------------------------------ health
@app.get("/api/health")
def health():
    return {
        "ok": True,
        "now": now_ms(),
        "epoch": hub.journal.epoch,
        "last_seq": hub.journal.last_seq,
        "ai": models_status(),
        "notify": channels_status(),
        "cameras": registry.statuses(),
    }


# ------------------------------------------------------------------ CPS read-only bridge (local development only)
@app.get("/api/cps/node-state")
def cps_node_state(request: Request):
    require_loopback_request(request)
    try:
        return fetch_node_state()
    except CpsIntegrationError as exc:
        raise HTTPException(exc.status_code, exc.detail) from exc


@app.get("/api/cps/node-heartbeats")
def cps_node_heartbeats(request: Request):
    """Proxy the approved read-only CPS heartbeat history to local development clients."""
    require_loopback_request(request)
    try:
        return fetch_node_heartbeat_history()
    except CpsIntegrationError as exc:
        raise HTTPException(exc.status_code, exc.detail) from exc


@app.get("/api/cps/node-readings")
def cps_node_readings(
    request: Request,
    sensor_id: str = Query(...),
    start: datetime = Query(...),
    end: datetime = Query(...),
    limit: int = Query(default=100, ge=1, le=200),
    cursor: str | None = Query(default=None, max_length=1024),
):
    require_loopback_request(request)
    try:
        start_utc, end_utc = validate_history_request(
            sensor_id=sensor_id, start=start, end=end, limit=limit, cursor=cursor,
        )
        return fetch_node_reading_history(
            sensor_id=sensor_id, start=start_utc, end=end_utc, limit=limit, cursor=cursor,
        )
    except CpsIntegrationError as exc:
        raise HTTPException(exc.status_code, exc.detail) from exc


# ------------------------------------------------------------------ operational HVAC intelligence (monitor-only)
@app.get("/api/operational/hvac/recommendation")
def operational_hvac_recommendation(request: Request):
    """Evaluate current evidence once; this endpoint never controls CPS hardware."""
    require_loopback_request(request)
    if config.OPERATIONAL_HVAC_CPS_FRESHNESS_S <= 0 or config.OPERATIONAL_HVAC_AI_FRESHNESS_S <= 0:
        raise HTTPException(503, "Operational HVAC intelligence is unavailable")
    try:
        now = datetime.now(timezone.utc)
        lookback = timedelta(seconds=config.OPERATIONAL_HVAC_TREND_LOOKBACK_S)
        camera_id = config.OPERATIONAL_HVAC_CAMERA_ID
        evaluation = collect_and_evaluate_operational_hvac(
            # Let the collector timestamp after its single CPS read.  CPS
            # creates ``as_of`` during that request, so an earlier timestamp
            # would incorrectly classify a fresh snapshot as future data.
            evaluated_at=None,
            cps_freshness_limit=timedelta(seconds=config.OPERATIONAL_HVAC_CPS_FRESHNESS_S),
            ai_freshness_limit=timedelta(seconds=config.OPERATIONAL_HVAC_AI_FRESHNESS_S),
            previous_temperature=previous_temperature_observation(sensor_id="TEMP-01", now=now, lookback=lookback),
            previous_people=previous_people_observation(camera_id=camera_id, now=now, lookback=lookback),
            policy=policy_from_settings(
                approved=config.OPERATIONAL_HVAC_POLICY_APPROVED,
                reactive_temperature_c=config.OPERATIONAL_HVAC_REACTIVE_TEMPERATURE_C,
                normal_temperature_max_c=config.OPERATIONAL_HVAC_NORMAL_TEMPERATURE_MAX_C,
                minimum_temperature_rise_c=config.OPERATIONAL_HVAC_MINIMUM_TEMPERATURE_RISE_C,
                minimum_crowd_increase=config.OPERATIONAL_HVAC_MINIMUM_CROWD_INCREASE,
                accept_single_sensor_temperature=config.OPERATIONAL_HVAC_ACCEPT_SINGLE_SENSOR,
            ),
            camera_id=camera_id,
        )
        return recommendation_response(evaluation)
    except Exception as exc:  # noqa: BLE001 - do not disclose internal CPS/configuration details
        raise HTTPException(503, "Operational HVAC intelligence is unavailable") from exc


# ------------------------------------------------------------------ isolated HVAC simulation
@app.post("/api/simulation/hvac/evaluate")
def simulation_hvac_evaluate(request: Request, payload: Any = Body(...)):
    """Evaluate one synthetic Twin snapshot without reading or controlling operational systems."""
    require_loopback_request(request)
    try:
        return evaluate_simulation_request(payload)
    except SimulationHvacRequestError as exc:
        raise HTTPException(422, str(exc)) from exc


# ------------------------------------------------------------------ websocket
@app.websocket("/api/ws")
async def ws_endpoint(ws: WebSocket):
    await ws.accept()
    hub.clients.add(ws)
    try:
        await ws.send_text(json.dumps({
            "type": "hello", "now": now_ms(), "epoch": hub.journal.epoch, "last_seq": hub.journal.last_seq,
            "ai": models_status(), "notify": channels_status(), "cameras": registry.statuses(),
        }, ensure_ascii=False))
        while True:
            msg = await ws.receive_text()
            if msg == "ping":
                await ws.send_text(json.dumps({"type": "pong", "now": now_ms()}))
    except WebSocketDisconnect:
        pass
    except Exception:  # noqa: BLE001
        pass
    finally:
        hub.clients.discard(ws)


# ------------------------------------------------------------------ journal
@app.get("/api/journal")
def journal(since: int = 0):
    return {"epoch": hub.journal.epoch, "now": now_ms(), "entries": hub.journal.since(since)}


@app.post("/api/journal")
def journal_append(action: Dict[str, Any] = Body(...)):
    if action.get("type") not in CLIENT_ACTIONS:
        raise HTTPException(400, f"action type not allowed: {action.get('type')}")
    entry = hub.record(action)
    return {"ok": True, "seq": entry["seq"]}


@app.post("/api/journal/reset")
def journal_reset():
    """Developer tool: start a fresh shared state (fixtures only). Snapshots/events files are kept."""
    hub.journal.reset()
    hub.publish({"type": "reset", "epoch": hub.journal.epoch})
    return {"ok": True, "epoch": hub.journal.epoch}


# ------------------------------------------------------------------ cameras
@app.get("/api/cameras")
def cameras():
    return {"cameras": registry.statuses(), "models": VALID_MODELS, "directions": VALID_DIRECTIONS}


@app.patch("/api/cameras/{cam_id}")
def camera_patch(cam_id: str, patch: Dict[str, Any] = Body(...)):
    if not registry.get(cam_id):
        raise HTTPException(404, "unknown camera")
    return registry.update_config(cam_id, patch).status()


@app.post("/api/cameras/{cam_id}/stream")
def camera_stream(cam_id: str, body: Dict[str, Any] = Body(...)):
    if not registry.get(cam_id):
        raise HTTPException(404, "unknown camera")
    url = str(body.get("url", "")).strip()
    if not url:
        raise HTTPException(400, "url is required (rtsp://…, http://…, a file path, or 0 for a USB camera)")
    if "autostart" in body:
        registry.update_config(cam_id, {"autostart": bool(body["autostart"])})
    return registry.start_stream(cam_id, url).status()


@app.delete("/api/cameras/{cam_id}/source")
def camera_stop(cam_id: str):
    if not registry.get(cam_id):
        raise HTTPException(404, "unknown camera")
    return registry.stop_source(cam_id).status()


@app.get("/api/cameras/{cam_id}/mjpeg")
def camera_mjpeg(cam_id: str):
    rt = registry.get(cam_id)
    if not rt or not rt.worker:
        raise HTTPException(404, "no server stream on this camera")
    return StreamingResponse(rt.worker.mjpeg_frames(), media_type="multipart/x-mixed-replace; boundary=frame")


# ------------------------------------------------------------------ frame analysis
@app.post("/api/detect")
async def detect(
    image: UploadFile = File(...),
    session_id: str = Form("default"),
    enabled: str = Form("[]"),
    correct_direction: str = Form("down"),
    camera_id: str = Form(""),
    client_id: str = Form(""),
):
    """With camera_id: frame from a Rasid camera source (camera config decides the models,
    events/incidents are produced). Without camera_id: plain lama-main behaviour."""
    raw = await image.read()
    img = _decode_image(raw)
    if camera_id:
        if not registry.get(camera_id):
            raise HTTPException(404, "unknown camera")
        try:
            return await run_in_threadpool(registry.browser_frame, camera_id, img, client_id or session_id, None, None)
        except RuntimeError as exc:
            raise HTTPException(409, str(exc)) from exc
    try:
        enabled_list: List[str] = json.loads(enabled)
    except json.JSONDecodeError:
        enabled_list = []
    if not enabled_list:
        return {"people_count": 0, "detections": [], "alerts": []}
    return await run_in_threadpool(run_enabled, img, enabled_list, session_id, correct_direction)


# ------------------------------------------------------------------ recorded video
@app.post("/api/analyze-video")
async def analyze_video(
    video: UploadFile = File(...),
    camera_id: str = Form("CAM-1"),
    models: str = Form(""),
    direction: str = Form(""),
):
    rt = registry.get(camera_id)
    if not rt:
        raise HTTPException(404, "unknown camera")
    name = _safe_name(video.filename or "video.mp4")
    stored = f"{uuid.uuid4().hex[:8]}_{name}"
    dest = config.UPLOAD_DIR / stored
    size = 0
    with dest.open("wb") as f:
        while True:
            chunk = await video.read(1 << 20)
            if not chunk:
                break
            size += len(chunk)
            if size > config.VIDEO_MAX_MB * (1 << 20):
                f.close()
                dest.unlink(missing_ok=True)
                raise HTTPException(413, f"file larger than {config.VIDEO_MAX_MB} MB")
            f.write(chunk)
    try:
        model_list = [m for m in json.loads(models) if m in VALID_MODELS] if models else list(rt.cfg.get("models", []))
    except json.JSONDecodeError:
        model_list = list(rt.cfg.get("models", []))
    d = direction if direction in VALID_DIRECTIONS else rt.cfg.get("direction", "down")
    job = create_job(dest, video.filename or name, rt.cfg, model_list, d, f"/api/uploads/{stored}")
    threat.on_video_uploaded(job["id"], dest, video.filename or name, rt.cfg, job["video_url"])  # add-on, same job id
    return {"job_id": job["id"], "video_url": job["video_url"]}


@app.get("/api/jobs/{job_id}")
def job_status(job_id: str):
    j = get_job(job_id)
    if not j:
        raise HTTPException(404, "unknown job")
    return j


# ------------------------------------------------------------------ evidence files
@app.get("/api/snapshots/{name}")
def snapshot(name: str):
    p = config.SNAP_DIR / _safe_name(name)
    if not p.exists():
        raise HTTPException(404, "not found")
    return FileResponse(p, media_type="image/jpeg")


@app.get("/api/uploads/{name}")
def upload_file(name: str):
    p = config.UPLOAD_DIR / _safe_name(name)
    if not p.exists():
        raise HTTPException(404, "not found")
    return FileResponse(p)


@app.post("/api/uploads")
async def upload_media(file: UploadFile = File(...)):
    """Media attached to manual reports (photo/video), stored so every screen can open it."""
    stored = f"{uuid.uuid4().hex[:8]}_{_safe_name(file.filename or 'media')}"
    dest = config.UPLOAD_DIR / stored
    with dest.open("wb") as f:
        shutil.copyfileobj(file.file, f)
    return {"url": f"/api/uploads/{stored}", "type": file.content_type or "", "name": file.filename}


@app.get("/api/events")
def events(limit: int = 200):
    return {"events": load_events(limit)}


# ------------------------------------------------------------------ notifications
@app.get("/api/notify")
def notify_status():
    return channels_status()


@app.post("/api/notify/test")
def notify_test(body: Dict[str, Any] = Body(default={})):
    return {"results": notifier.test(str(body.get("team") or "civil_defense"))}


# ------------------------------------------------------------------ gunshot mic (OpenRouter)
@app.post("/api/gunshot")
async def gunshot_classify(audio: UploadFile = File(...)):
    """Classify a short microphone clip as gunshot / not gunshot via OpenRouter
    (without an OpenRouter key: the local AST model of the threat add-on, same response shape)."""
    ok, model = gunshot_mod.configured()
    classify = gunshot_mod.classify_audio if ok else threat.local_gunshot_classifier()
    if classify is None:
        raise HTTPException(503, "OPENROUTER_API_KEY is not configured")
    raw = await audio.read()
    if not raw:
        raise HTTPException(400, "empty audio")
    try:
        result = await run_in_threadpool(
            classify,
            raw,
            audio.filename or "clip.webm",
            audio.content_type or "",
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(502, str(exc)) from exc
    result["now"] = now_ms()
    result["model"] = result.get("model") or model
    return result


# ------------------------------------------------------------------ web UI
@app.get("/{path:path}")
def web(path: str):
    dist = config.WEB_DIST
    if not dist.exists():
        return JSONResponse({
            "service": "Rasid AI server",
            "hint": "Web UI not built yet. Run:  cd web && npm install && npm run build",
        })
    target = (dist / path).resolve()
    if path and target.is_file() and str(target).startswith(str(dist.resolve())):
        return FileResponse(target)
    return FileResponse(dist / "index.html")
