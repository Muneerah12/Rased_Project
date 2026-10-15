"""Threat-detection HTTP API (new routes only, under /api/threat).

  GET  /api/threat/status                     feature switch, model states, thresholds
  GET  /api/threat/jobs/{job_id}              threat results of an uploaded video (same id as /api/jobs)
  GET  /api/threat/jobs/{job_id}/report       printable incident report (HTML); ?format=json for data
  POST /api/threat/jobs/{job_id}/rerun-zones  re-check restricted-area entry after editing the zones
  POST /api/threat/live-audio                 (multipart file, camera_id) gunshots in a file attached to a live camera
  GET  /api/threat/live-audio/{id}            shots found so far (the analysis runs in the background)
  POST /api/threat/live-audio/{id}/shot/{i}   playback reached shot i: raise it on that camera now
  POST /api/threat/live-mic/{camera_id}       (16 kHz mono int16 PCM body) microphone of a live camera
  GET  /api/threat/zones/{camera_id}          restricted areas of a camera
  PUT  /api/threat/zones/{camera_id}          {"zones": [{"id", "name", "polygon": [[x, y], ...]}]}  (0..1 coords)
"""

from __future__ import annotations

from typing import Any, Dict

from fastapi import APIRouter, Body, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import HTMLResponse
from starlette.concurrency import run_in_threadpool

from . import jobs, settings as S
from .models import models_status
from .report import render_html
from .zones import get_zones, set_zones

router = APIRouter(prefix="/api/threat")


@router.get("/status")
def status():
    from .live import status as live_status

    return {
        "enabled": S.ENABLED,
        "models": models_status(),
        "live": live_status(),
        "thresholds": {
            "weapon_conf": S.WEAPON_CONF, "weapon_hits": f"{S.WEAPON_MIN_HITS}/{S.WEAPON_WINDOW}",
            "gunshot": S.GUNSHOT_THRESHOLD, "explosion": S.EXPLOSION_THRESHOLD,
            "violence": S.VIOLENCE_THRESHOLD, "violence_clips": S.VIOLENCE_MIN_HITS,
            "run_speed_body_heights_per_s": S.RUN_SPEED, "run_min_s": S.RUN_MIN_S, "intrusion_min_s": S.INTRUSION_MIN_S,
        },
    }


@router.get("/jobs/{job_id}")
def job(job_id: str):
    j = jobs.get(job_id)
    if j is None:
        raise HTTPException(404, "no threat analysis for this job")
    return j


@router.get("/jobs/{job_id}/report")
def report(job_id: str, format: str = "html"):  # noqa: A002
    j = jobs.get(job_id)
    if j is None:
        raise HTTPException(404, "no threat analysis for this job")
    if format == "json":
        return j
    return HTMLResponse(render_html(j))


@router.post("/jobs/{job_id}/rerun-zones")
def rerun_zones(job_id: str):
    j = jobs.rerun_zones(job_id)
    if j is None:
        raise HTTPException(409, "analysis not found, still running, or its video is no longer in memory")
    return {"ok": True, "job_id": job_id}


@router.post("/live-audio")
async def live_audio(file: UploadFile = File(...), camera_id: str = Form(...)):
    from . import live_audio as la
    from .live import monitored

    if not monitored(camera_id):
        return {"monitored": False, "camera_id": camera_id}
    raw = await file.read()
    if not raw:
        raise HTTPException(400, "empty file")
    if len(raw) > S.LIVE_AUDIO_MAX_MB * (1 << 20):
        raise HTTPException(413, f"file larger than {S.LIVE_AUDIO_MAX_MB} MB")
    try:
        res = await run_in_threadpool(la.analyze, camera_id, raw, file.filename or "clip.mp4")
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"monitored": True, **res}


@router.get("/live-audio/{file_id}")
def live_audio_get(file_id: str):
    from . import live_audio as la

    res = la.get(file_id)
    if res is None:
        raise HTTPException(404, "unknown file")
    return res


@router.post("/live-audio/{file_id}/shot/{index}")
def live_audio_shot(file_id: str, index: int):
    from . import live_audio as la

    res = la.trigger(file_id, index)
    if res is None:
        raise HTTPException(404, "unknown file or shot")
    return res


@router.post("/live-mic/{camera_id}")
async def live_mic(camera_id: str, request: Request):
    from . import live_mic as lm
    from .live import monitored

    if not monitored(camera_id):
        return {"monitored": False, "camera_id": camera_id}
    raw = await request.body()
    if len(raw) > 1 << 20:
        raise HTTPException(413, "audio chunk larger than 1 MB")
    return {"monitored": True, **lm.push(camera_id, raw)}


@router.get("/zones/{camera_id}")
def zones_get(camera_id: str):
    return {"camera_id": camera_id, "zones": get_zones(camera_id)}


@router.put("/zones/{camera_id}")
def zones_put(camera_id: str, body: Dict[str, Any] = Body(...)):
    from cameras import registry

    if not registry.get(camera_id):
        raise HTTPException(404, "unknown camera")
    return {"camera_id": camera_id, "zones": set_zones(camera_id, body.get("zones") or [])}
