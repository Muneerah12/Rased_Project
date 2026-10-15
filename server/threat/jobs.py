"""Threat analysis of an uploaded video, running next to (not inside) the existing video job.

It reads the same stored file on its own, with its own models, and shares the existing job id,
so the Rasid page shows both results for one upload. Stages:

  audio   PyAV extracts the soundtrack → AST scores gunshot / explosion per window
  video   frames sampled at SAMPLE_FPS: weapons + people tracking on every DETECT_EVERY-th sample,
          VideoMAE violence on the last VIOLENCE_CLIP_S seconds every VIOLENCE_STRIDE_S seconds
"""

from __future__ import annotations

import json
import threading
import time
from collections import deque
from pathlib import Path
from typing import Any, Deque, Dict, List, Optional, Set, Tuple

import cv2
import numpy as np

from . import settings as S
from .audio import analyze_audio, boom_hit, extract_audio, gun_hit
from .behavior import PeopleTracker, classify_violence, interaction_box
from .emitter import ThreatEmitter
from .models import MODEL_INFO, new_tracker
from .weapons import detect_weapons
from .zones import get_zones

ALL_KINDS: Set[str] = {"weapon", "gunshot", "violence", "running", "intrusion"}
SEVERITY = {"weapon": "critical", "gunshot": "critical", "violence": "high", "intrusion": "high", "running": "medium"}

_jobs: Dict[str, Dict[str, Any]] = {}
_lock = threading.Lock()
_run_slot = threading.Semaphore(1)  # one threat analysis at a time (CPU-heavy)


def _job_file(job_id: str) -> Path:
    return S.THREAT_DIR / f"{job_id}.json"


def _save(job: Dict[str, Any]) -> None:
    try:
        meta = {k: v for k, v in job.items() if not k.startswith("_")}
        _job_file(job["id"]).write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
    except Exception as exc:  # noqa: BLE001
        print(f"[threat] could not save job {job['id']}: {exc}")


def start(job_id: str, path: Path, file_name: str, camera: Dict[str, Any], video_url: str) -> Dict[str, Any]:
    job = {
        "id": job_id, "state": "queued", "progress": 0.0, "stage": "", "file_name": file_name, "camera_id": camera["id"],
        "video_url": video_url, "duration_sec": None, "fps": None, "frame_size": None, "zones": get_zones(camera["id"]),
        "models": {k: v["name"] for k, v in MODEL_INFO.items()},
        "stages": {"audio": {"state": "pending", "has_audio": None, "error": ""}, "video": {"state": "pending", "error": ""}},
        "events": [], "detections": {"weapons": [], "gunshot": [], "behavior": []},
        "audio_timeline": [], "violence_timeline": [], "max_people": 0, "runs": 1,
        "created_at": int(time.time() * 1000), "finished_at": None, "error": "",
        "_path": str(path), "_camera": dict(camera),
    }
    with _lock:
        _jobs[job_id] = job
    threading.Thread(target=_run, args=(job, set(ALL_KINDS)), daemon=True, name=f"threat-{job_id}").start()
    return job


def rerun_zones(job_id: str) -> Optional[Dict[str, Any]]:
    """Re-check restricted-area entry only (after the zones changed); other results are kept."""
    with _lock:
        job = _jobs.get(job_id)
    if job is None or job["state"] in ("queued", "running") or not job.get("_path"):
        return None
    job["zones"] = get_zones(job["camera_id"])
    job["events"] = [e for e in job["events"] if (e.get("threat") or {}).get("kind") != "intrusion"]
    job["detections"]["behavior"] = [d for d in job["detections"]["behavior"] if d.get("kind") != "intrusion"]
    job["state"], job["progress"], job["runs"] = "queued", 0.0, job.get("runs", 1) + 1
    job.pop("_ap", None)
    job["_vp"] = 0.0
    threading.Thread(target=_run, args=(job, {"intrusion"}), daemon=True, name=f"threat-zones-{job_id}").start()
    return job


def get(job_id: str) -> Optional[Dict[str, Any]]:
    with _lock:
        j = _jobs.get(job_id)
    out = None
    if j is not None:
        for _ in range(5):  # snapshot; the worker thread may be updating the job meanwhile
            try:
                out = json.loads(json.dumps({k: v for k, v in j.items() if not k.startswith("_")}))
                break
            except RuntimeError:
                time.sleep(0.01)
    if out is None and _job_file(job_id).exists():
        try:
            out = json.loads(_job_file(job_id).read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            out = None
    if out is not None:
        out["alerts"] = security_alerts(out.get("events", []))
    return out


def security_alerts(events: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    out = []
    for e in events:
        th = e.get("threat") or {}
        kind = th.get("kind", "")
        sev = SEVERITY.get(kind, "high")
        if kind == "weapon" and "gun" not in e.get("labels", []):
            sev = "high"
        if kind == "running" and "crowd_running" in e.get("labels", []):
            sev = "high"
        out.append({
            "event_id": e["id"], "category": e["category"], "kind": kind, "labels": e.get("labels", []), "severity": sev,
            "start_sec": th.get("start_offset_sec"), "end_sec": th.get("end_offset_sec"), "confidence": e.get("peak_score"),
            "zone_name": th.get("zone_name"), "snapshot_url": e.get("snapshot_url"), "ongoing": e.get("phase") != "end",
        })
    return sorted(out, key=lambda a: (a["start_sec"] or 0))


def _frame_at(path: Path, t: float) -> Optional[np.ndarray]:
    cap = cv2.VideoCapture(str(path))
    try:
        cap.set(cv2.CAP_PROP_POS_MSEC, max(0.0, t) * 1000.0)
        ok, frame = cap.read()
        return frame if ok else None
    finally:
        cap.release()


def _push(lst: List[Dict[str, Any]], item: Dict[str, Any]) -> None:
    if len(lst) < S.MAX_DETECTIONS:
        lst.append(item)


def _run(job: Dict[str, Any], kinds: Set[str]) -> None:
    with _run_slot:
        path = Path(job["_path"])
        camera = job["_camera"]

        def on_event(rec: Dict[str, Any]) -> None:
            for i, e in enumerate(job["events"]):
                if e["id"] == rec["id"]:
                    job["events"][i] = rec
                    return
            job["events"].append(rec)

        emitter = ThreatEmitter(camera, job["file_name"], job["video_url"], job["models"], on_event)
        job["state"] = "running"
        try:
            # audio runs in parallel with the video pass (both are CPU-bound but use separate models)
            audio = threading.Thread(target=_audio_stage, args=(job, path, emitter), daemon=True) if "gunshot" in kinds else None
            if audio:
                audio.start()
            _video_stage(job, path, emitter, kinds)
            if audio:
                job["stage"] = "audio"
                audio.join()
            emitter.flush()
            job["state"] = "done"
            job["progress"] = 1.0
        except Exception as exc:  # noqa: BLE001
            emitter.flush()
            job["state"] = "failed"
            job["error"] = str(exc)[:300]
            print(f"[threat] job {job['id']} failed: {exc}")
        finally:
            job["stage"] = ""
            job["finished_at"] = int(time.time() * 1000)
            _save(job)


def _audio_stage(job: Dict[str, Any], path: Path, emitter: ThreatEmitter) -> None:
    st = job["stages"]["audio"]
    st["state"] = "running"
    job["_ap"] = 0.0
    try:
        samples = extract_audio(path)
        if samples is None or len(samples) < 1600:
            st.update(state="done", has_audio=False)
            job["_ap"] = 1.0
            return
        st["has_audio"] = True

        def prog(p: float) -> None:
            job["_ap"] = p
            _progress(job)

        windows = analyze_audio(samples, prog)
        for w in windows:
            job["audio_timeline"].append({"t": w["peak_t"], "gunshot": w["gunshot"], "explosion": w["explosion"]})
            # AudioSet scores are low in absolute terms: a hit also needs the class among the top 3
            gun, boom = gun_hit(w), boom_hit(w)
            if w["gunshot"] >= 0.1 or w["explosion"] >= 0.1:
                _push(job["detections"]["gunshot"], {**w, "detected": gun or boom})
            hit = None
            frame = None
            if gun or boom:
                labels = ([w["kind"]] if gun else []) + (["explosion"] if boom else [])
                hit = {"score": max(w["gunshot"] if gun else 0.0, w["explosion"] if boom else 0.0), "labels": labels,
                       "boxes": [], "extra": {"audio_top": w["top"], "window": [w["start"], w["end"]]}}
                frame = _frame_at(path, w["peak_t"])
            emitter.observe("gunshot", "gunshot", w["peak_t"], hit, frame)
        st["state"] = "done"
    except Exception as exc:  # noqa: BLE001
        st.update(state="failed", error=str(exc)[:300])
        job["_ap"] = 1.0
        print(f"[threat] audio stage failed: {exc}")


def _progress(job: Dict[str, Any]) -> None:
    """Video pass weighs 75 %, the parallel audio pass 25 % (100 % video when audio is not analyzed)."""
    v = job.get("_vp", 0.0)
    a = job.get("_ap")
    job["progress"] = round(min(0.999, v if a is None else 0.75 * v + 0.25 * a), 3)


def _video_stage(job: Dict[str, Any], path: Path, emitter: ThreatEmitter, kinds: Set[str]) -> None:
    st = job["stages"]["video"]
    st["state"] = "running"
    job["stage"] = "video"
    errors: Dict[str, str] = {}

    def soft(key: str, fn, *a):
        """Run one detector; a model that cannot load is reported once and skipped."""
        if key in errors:
            return None
        try:
            return fn(*a)
        except Exception as exc:  # noqa: BLE001
            errors[key] = str(exc)[:200]
            print(f"[threat] {key} unavailable: {exc}")
            return None

    want_weapon = "weapon" in kinds
    want_violence = "violence" in kinds
    # the weapon check also uses the tracked people (a weapon is carried by someone)
    want_track = bool(kinds & {"running", "intrusion", "violence"}) or (want_weapon and S.WEAPON_PERSON_CONTEXT)
    zones = job["zones"] if "intrusion" in kinds else []
    tracker = None
    if want_track:
        model = soft("tracker", new_tracker)
        tracker = PeopleTracker(model, zones) if model is not None else None

    cap = cv2.VideoCapture(str(path))
    try:
        if not cap.isOpened():
            raise RuntimeError("the video could not be opened (unsupported codec?)")
        fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
        total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        job["fps"] = round(fps, 2)
        job["duration_sec"] = round(total / fps, 1) if total else None
        buf: Deque[Tuple[float, np.ndarray]] = deque()
        counts: Deque[Tuple[float, int]] = deque()
        people: List[Dict[str, Any]] = []
        next_sample = 0.0
        next_violence = S.VIOLENCE_CLIP_S
        n_sample = 0
        idx = 0
        while True:
            if not cap.grab():
                break
            t = idx / fps
            idx += 1
            if t + 1e-6 < next_sample:
                continue
            ok, frame = cap.retrieve()
            if not ok:
                break
            next_sample += 1.0 / S.SAMPLE_FPS
            if job["frame_size"] is None:
                job["frame_size"] = [int(frame.shape[1]), int(frame.shape[0])]
            if want_violence:
                h, w = frame.shape[:2]
                sc = 256.0 / min(h, w)
                buf.append((t, cv2.resize(frame, (int(w * sc), int(h * sc))) if sc < 1 else frame.copy()))
                while buf and t - buf[0][0] > S.VIOLENCE_CLIP_S:
                    buf.popleft()

            if n_sample % max(1, S.DETECT_EVERY) == 0:
                frame_people: Optional[List[Dict[str, Any]]] = None  # this frame's people, for the weapon check
                if tracker is not None:
                    tr = soft("tracker_run", tracker.update, frame, t)
                    if tr is not None:
                        people = frame_people = tr["people"]
                        counts.append((t, len(people)))
                        job["max_people"] = max(job["max_people"], len(people))
                        if "running" in kinds:
                            run = tr["running"]
                            hit = None
                            if run:
                                labels = ["running"] + (["sudden_running"] if any(r["sudden"] for r in run) else []) + (["crowd_running"] if len(run) >= 3 else [])
                                boxes = [{"label": "running", "score": min(1.0, (r.get("speed") or 0) / (2 * S.RUN_SPEED)), "box": r["box"], "speed": r.get("speed")} for r in run]
                                hit = {"score": max(b["score"] for b in boxes), "labels": labels, "boxes": boxes, "extra": {"people_running": len(run)}}
                                _push(job["detections"]["behavior"], {"t": round(t, 2), "kind": "running", "labels": labels, "boxes": boxes})
                            emitter.observe("running", "running", t, hit, frame)
                        for z in zones:
                            inside = [p for p in tr["intrusions"] if p["zone_id"] == z["id"]]
                            hit = None
                            if inside:
                                boxes = [{"label": "intrusion", "score": p["score"], "box": p["box"]} for p in inside]
                                hit = {"score": max(b["score"] for b in boxes), "labels": ["intrusion"], "boxes": boxes,
                                       "extra": {"zone_id": z["id"], "zone_name": z["name"]}}
                                _push(job["detections"]["behavior"], {"t": round(t, 2), "kind": "intrusion", "zone_id": z["id"], "zone_name": z["name"], "boxes": boxes})
                            emitter.observe(f"intrusion:{z['id']}", "intrusion", t, hit, frame, zones=[z])
                if want_weapon:
                    dets = soft("weapon", detect_weapons, frame, frame_people)
                    if dets is not None:
                        for d in dets:
                            _push(job["detections"]["weapons"], {"t": round(t, 2), **d})
                        hit = {"score": max(d["score"] for d in dets), "labels": [d["label"] for d in dets], "boxes": dets} if dets else None
                        emitter.observe("weapon", "weapon", t, hit, frame)
                while counts and t - counts[0][0] > S.VIOLENCE_CLIP_S:
                    counts.popleft()

            if want_violence and t >= next_violence and len(buf) >= 8:
                next_violence = t + S.VIOLENCE_STRIDE_S
                n_people = max((c for _, c in counts), default=0) if tracker is not None else S.VIOLENCE_MIN_PEOPLE
                hit = None
                if n_people >= S.VIOLENCE_MIN_PEOPLE:
                    score = soft("violence", classify_violence, [f for _, f in buf])
                    if score is not None:
                        job["violence_timeline"].append({"t": round(buf[0][0], 2), "score": round(score, 3), "people": n_people})
                        if score >= S.VIOLENCE_THRESHOLD:
                            box = interaction_box(people, (frame.shape[1], frame.shape[0])) or [0, 0, float(frame.shape[1]), float(frame.shape[0])]
                            boxes = [{"label": "violence", "score": round(score, 3), "box": box}]
                            hit = {"score": score, "labels": ["violence"], "boxes": boxes,
                                   "extra": {"clip": [round(buf[0][0], 2), round(t, 2)], "people": n_people}}
                            _push(job["detections"]["behavior"], {"t": round(t, 2), "kind": "violence", "score": round(score, 3), "boxes": boxes})
                emitter.observe("violence", "violence", t, hit, frame)

            n_sample += 1
            if total:
                job["_vp"] = min(1.0, idx / total)
                _progress(job)
        st["state"] = "done" if not errors else "partial"
        st["error"] = "; ".join(f"{k}: {v}" for k, v in errors.items())
    finally:
        cap.release()
