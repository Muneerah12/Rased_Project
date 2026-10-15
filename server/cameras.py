"""Camera registry and video sources.

A Rasid camera (CAM-1..CAM-4, the central CAM-C, the threat camera CAM-TH and thermal CAM-T1) gets frames from ONE of:
  * browser  – the Rasid page captures this device's camera (or a looping video file)
               and posts frames to /api/detect with camera_id.
  * stream   – the server opens a URL itself with OpenCV: rtsp://… (IP cameras / NVR),
               http(s)://… (MJPEG / HLS), a local file path, or "0", "1"… for a USB
               camera attached to the server. Works with the browser closed.

Both paths run the same detectors and the same EventEngine. A camera with kind "thermal"
runs thermal.analyze (per-pixel temperature, hot spots) instead of the YOLO detectors.
"""

from __future__ import annotations

import json
import threading
import time
from typing import Any, Dict, List, Optional

import cv2
import numpy as np

import config
from detectors import annotate, reset_session, run_enabled
from events import EventEngine
import thermal
import threat
from hub import hub, now_ms
from people_snapshot import derived_person_detection_confidence, people_snapshot_cache

VALID_MODELS = ["people", "smoke", "fire", "fall", "wrong_way", "thermal"]
VALID_DIRECTIONS = ["down", "up", "left", "right"]

DEFAULT_CAMERAS: List[Dict[str, Any]] = [
    # one camera per job, spread over the site's zones; the central camera stays in A1.1 and counts it (crowding)
    {
        "id": "CAM-1", "name": {"ar": "كاميرا 2", "en": "Camera 2"}, "zone_id": "D2",
        "counts_zone": False, "capacity": None, "models": ["smoke", "fire"],
        "direction": "down", "stream_url": "", "autostart": False,
    },
    {
        "id": "CAM-2", "name": {"ar": "كاميرا 3", "en": "Camera 3"}, "zone_id": "D3",
        "counts_zone": False, "capacity": None, "models": ["fall"],
        "direction": "down", "stream_url": "", "autostart": False,
    },
    {
        "id": "CAM-3", "name": {"ar": "كاميرا 4", "en": "Camera 4"}, "zone_id": "D4",
        "counts_zone": False, "capacity": None, "models": ["wrong_way"],
        "direction": "down", "stream_url": "", "autostart": False,
    },
    {
        # no behavior model yet: falls and walking direction stand in until one is added
        "id": "CAM-4", "name": {"ar": "كاميرا 6", "en": "Camera 6"}, "zone_id": "D5",
        "counts_zone": False, "capacity": None, "models": ["fall", "wrong_way"],
        "direction": "down", "stream_url": "", "autostart": False,
    },
    {
        "id": "CAM-C", "name": {"ar": "كاميرا 1", "en": "Camera 1"}, "zone_id": "A1.1",
        "counts_zone": True, "capacity": 150, "models": ["people"],
        "direction": "down", "stream_url": "", "autostart": False,
    },
    {
        # threat add-on: weapons, fights, sudden running and restricted areas (server/threat); no YOLO
        # detectors of its own by default, so its frames arrive fast enough for the violence model
        "id": "CAM-TH", "name": {"ar": "كاميرا 5", "en": "Camera 5"}, "zone_id": "A1",
        "counts_zone": False, "capacity": None, "models": [],
        "direction": "down", "stream_url": "", "autostart": False,
    },
    {
        "id": "CAM-T1", "kind": "thermal", "name": {"ar": "كاميرا 7", "en": "Camera 7"}, "zone_id": "D5",
        "counts_zone": False, "capacity": None, "models": ["thermal"],
        "direction": "down", "stream_url": "", "autostart": False, "thermal": dict(thermal.DEFAULT_THERMAL),
    },
]


class CameraRuntime:
    def __init__(self, cfg: Dict[str, Any]) -> None:
        self.cfg = cfg
        self.engine = EventEngine(cfg, source="live")
        self.source = "none"  # none | browser | stream
        self.generation = 0
        self.last_frame_at = 0
        self.last_result: Dict[str, Any] = {}
        self.fps = 0.0
        self.error = ""
        self.worker: Optional[StreamWorker] = None
        self._fps_t: List[float] = []
        self.browser_owner = ""
        self.published_active = False

    @property
    def is_thermal(self) -> bool:
        return self.cfg.get("kind") == "thermal"

    def analyze(self, frame: np.ndarray, from_browser: bool = False) -> Dict[str, Any]:
        if self.is_thermal:
            return thermal.analyze(frame, self.cfg, force_gray=from_browser)
        cfg = self.cfg
        return run_enabled(frame, cfg.get("models", []), self.session_id, cfg.get("direction", "down"))

    @property
    def session_id(self) -> str:
        return f"{self.cfg['id']}:{self.generation}"

    def new_generation(self) -> None:
        reset_session(self.session_id)
        self.generation += 1

    def status(self) -> Dict[str, Any]:
        r = self.last_result
        active = self.source != "none" and now_ms() - self.last_frame_at < 6000
        return {
            "id": self.cfg["id"],
            "kind": self.cfg.get("kind", "video"),
            "config": self.cfg,
            "thermal": r.get("thermal"),
            "source": self.source,
            "active": active,
            "fps": round(self.fps, 2),
            "last_frame_at": self.last_frame_at or None,
            "people": r.get("people_count"),
            "people_smoothed": self.engine.smoothed_people(),
            "alerts": r.get("alerts", []),
            "infer_ms": r.get("infer_ms"),
            "frame_size": r.get("frame_size"),
            "error": self.error,
            "stream_url": self.cfg.get("stream_url", ""),
            "active_events": [e["id"] for e in self.engine.active_events()],
        }

    def handle_result(self, result: Dict[str, Any], frame: np.ndarray) -> Dict[str, Any]:
        """Common path after inference: event engine + live broadcast."""
        display = result.pop("display", None)  # thermal: false-colour frame for snapshots
        if display is not None:
            frame = display
        else:  # threat add-on: the frame also goes to weapon/behavior detection (own thread); its boxes join the view
            extra = threat.on_live_frame(self.cfg, frame)
            if extra:
                result["detections"] = list(result.get("detections") or []) + extra
        t = time.time()
        self._fps_t = [x for x in self._fps_t if t - x < 5] + [t]
        self.fps = (len(self._fps_t) - 1) / max(0.001, self._fps_t[-1] - self._fps_t[0]) if len(self._fps_t) > 1 else 0.0
        self.last_frame_at = now_ms()
        self.last_result = result
        events = self.engine.process(result, frame, t)
        # Passive cache update using this completed inference result only.  It must
        # never affect inference, events, or the websocket payload below.
        people_snapshot_cache.update(
            camera_id=self.cfg.get("id"),
            zone_id=self.cfg.get("zone_id"),
            observed_at=self.last_frame_at,
            people_count=result.get("people_count"),
            people_smoothed=self.engine.smoothed_people(),
            derived_detection_confidence=derived_person_detection_confidence(result.get("detections")),
        )
        if not self.published_active:  # tell every screen the camera started analyzing
            self.published_active = True
            hub.publish({"type": "camera", "camera": self.status()})
        hub.publish({
            "type": "frame",
            "camera_id": self.cfg["id"],
            "t": self.last_frame_at,
            "source": self.source,
            "people": result.get("people_count"),
            "people_smoothed": self.engine.smoothed_people(),
            "counts_zone": self.cfg.get("counts_zone", False),
            "alerts": result.get("alerts", []),
            "n_detections": len(result.get("detections", [])),
            "infer_ms": result.get("infer_ms"),
            "fps": round(self.fps, 2),
            "thermal": result.get("thermal"),
        })
        return {**result, "events": events, "people_smoothed": self.engine.smoothed_people()}


class StreamWorker(threading.Thread):
    """Reads a stream with OpenCV, analyzes frames, keeps the latest frame for MJPEG."""

    def __init__(self, rt: CameraRuntime, url: str) -> None:
        super().__init__(daemon=True, name=f"stream-{rt.cfg['id']}")
        self.rt = rt
        self.url = url
        self.stop_evt = threading.Event()
        self.latest: Optional[np.ndarray] = None
        self.latest_lock = threading.Lock()
        self.frame_cond = threading.Condition()

    def _open(self):
        src: Any = self.url
        if isinstance(src, str) and src.strip().isdigit():
            src = int(src.strip())
        cap = cv2.VideoCapture(src)
        if self.rt.is_thermal and thermal.thermal_cfg(self.rt.cfg)["mode"] == "y16":
            # radiometric USB cameras (PureThermal / Lepton): ask for raw 16-bit frames
            cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc("Y", "1", "6", " "))
            cap.set(cv2.CAP_PROP_CONVERT_RGB, 0)
        if isinstance(src, str) and src.lower().startswith("rtsp"):
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        return cap

    def run(self) -> None:
        backoff = 1.0
        is_file = not self.url.strip().isdigit() and "://" not in self.url
        while not self.stop_evt.is_set():
            cap = self._open()
            if not cap.isOpened():
                self.rt.error = f"cannot open stream: {self.url}"
                hub.publish({"type": "camera", "camera": self.rt.status()})
                if self.stop_evt.wait(backoff):
                    break
                backoff = min(30.0, backoff * 2)
                continue
            self.rt.error = ""
            backoff = 1.0
            src_fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
            last_analysis = 0.0
            # reader thread keeps only the newest frame so analysis never lags behind live video
            reader_alive = threading.Event()
            reader_alive.set()

            def reader():
                while reader_alive.is_set() and not self.stop_evt.is_set():
                    ok, frame = cap.read()
                    if not ok:
                        if is_file:
                            cap.set(cv2.CAP_PROP_POS_FRAMES, 0)  # loop local files
                            continue
                        break
                    with self.latest_lock:
                        self.latest = frame
                    with self.frame_cond:
                        self.frame_cond.notify_all()
                    if is_file:
                        time.sleep(1.0 / max(1.0, src_fps))
                reader_alive.clear()

            rd = threading.Thread(target=reader, daemon=True)
            rd.start()
            while not self.stop_evt.is_set() and reader_alive.is_set():
                wait = (1.0 / config.STREAM_MAX_FPS) - (time.time() - last_analysis)
                if wait > 0 and self.stop_evt.wait(wait):
                    break
                with self.latest_lock:
                    frame = None if self.latest is None else self.latest.copy()
                if frame is None:
                    time.sleep(0.05)
                    continue
                last_analysis = time.time()
                try:
                    self.rt.handle_result(self.rt.analyze(frame), frame)
                except Exception as exc:  # noqa: BLE001
                    self.rt.error = f"analysis error: {exc}"
            reader_alive.clear()
            rd.join(timeout=2)
            cap.release()
            if not self.stop_evt.is_set():
                self.rt.error = "stream ended, reconnecting…"
                hub.publish({"type": "camera", "camera": self.rt.status()})
                self.stop_evt.wait(2)

    def stop(self) -> None:
        self.stop_evt.set()

    def mjpeg_frames(self):
        """Annotated JPEG frames for /api/cameras/{id}/mjpeg."""
        period = 1.0 / config.MJPEG_FPS
        while not self.stop_evt.is_set():
            with self.frame_cond:
                self.frame_cond.wait(timeout=1.0)
            with self.latest_lock:
                frame = None if self.latest is None else self.latest.copy()
            if frame is None:
                continue
            dets = self.rt.last_result.get("detections", [])
            if self.rt.is_thermal:
                try:
                    t = thermal.thermal_cfg(self.rt.cfg)
                    frame = thermal.colorize(thermal.temperature_map(frame, t), t)
                except Exception:  # noqa: BLE001 - shown in status by the analysis loop
                    continue
            img = annotate(frame, dets)
            ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 75])
            if ok:
                yield b"--frame\r\nContent-Type: image/jpeg\r\n\r\n" + buf.tobytes() + b"\r\n"
            time.sleep(period)


class Registry:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.cams: Dict[str, CameraRuntime] = {}
        for cfg in self._load():
            self.cams[cfg["id"]] = CameraRuntime(cfg)

    def _load(self) -> List[Dict[str, Any]]:
        if config.CAMERAS_FILE.exists():
            try:
                saved = json.loads(config.CAMERAS_FILE.read_text(encoding="utf-8"))
                by_id = {c["id"]: c for c in saved}
                return [{**d, **by_id.get(d["id"], {})} for d in DEFAULT_CAMERAS] + [c for c in saved if c["id"] not in {d["id"] for d in DEFAULT_CAMERAS}]
            except Exception as exc:  # noqa: BLE001
                print(f"[cameras] bad {config.CAMERAS_FILE}: {exc}")
        return [dict(c) for c in DEFAULT_CAMERAS]

    def save(self) -> None:
        config.CAMERAS_FILE.write_text(json.dumps([rt.cfg for rt in self.cams.values()], ensure_ascii=False, indent=2), encoding="utf-8")

    def get(self, cam_id: str) -> Optional[CameraRuntime]:
        return self.cams.get(cam_id)

    def statuses(self) -> List[Dict[str, Any]]:
        return [rt.status() for rt in self.cams.values()]

    def update_config(self, cam_id: str, patch: Dict[str, Any]) -> CameraRuntime:
        rt = self.cams[cam_id]
        with self.lock:
            cfg = rt.cfg
            if "models" in patch:
                cfg["models"] = [m for m in VALID_MODELS if m in (patch["models"] or [])]
            if patch.get("direction") in VALID_DIRECTIONS and patch["direction"] != cfg.get("direction"):
                cfg["direction"] = patch["direction"]
                rt.new_generation()
            if "capacity" in patch:
                cap = patch["capacity"]
                cfg["capacity"] = int(cap) if cap not in (None, "") else None
            if "thermal" in patch and rt.is_thermal:
                cfg["thermal"] = thermal.patch_thermal(cfg.get("thermal"), patch["thermal"] or {})
            for k in ("zone_id", "counts_zone", "autostart", "name"):
                if k in patch:
                    cfg[k] = patch[k]
            self.save()
        hub.publish({"type": "camera", "camera": rt.status()})
        return rt

    def start_stream(self, cam_id: str, url: str) -> CameraRuntime:
        rt = self.cams[cam_id]
        self.stop_source(cam_id)
        with self.lock:
            rt.cfg["stream_url"] = url
            rt.new_generation()
            rt.source = "stream"
            rt.error = ""
            rt.worker = StreamWorker(rt, url)
            rt.worker.start()
            self.save()
        hub.publish({"type": "camera", "camera": rt.status()})
        return rt

    def stop_source(self, cam_id: str) -> CameraRuntime:
        rt = self.cams[cam_id]
        with self.lock:
            if rt.worker:
                rt.worker.stop()
                rt.worker = None
            rt.source = "none"
            rt.browser_owner = ""
            rt.last_result = {}
            rt.engine.counts.clear()
            people_snapshot_cache.remove(cam_id)
        hub.publish({"type": "camera", "camera": rt.status()})
        return rt

    def browser_frame(self, cam_id: str, frame: np.ndarray, client_id: str, models: Optional[List[str]], direction: Optional[str]) -> Dict[str, Any]:
        rt = self.cams[cam_id]
        if rt.source == "stream":
            raise RuntimeError(f"{cam_id} is bound to a server stream; stop it before sending browser frames")
        if rt.source != "browser" or rt.browser_owner != client_id:
            rt.new_generation()
            rt.source = "browser"
            rt.browser_owner = client_id
            hub.publish({"type": "camera", "camera": rt.status()})
        cfg = rt.cfg
        if rt.is_thermal:
            return rt.handle_result(rt.analyze(frame, from_browser=True), frame)
        use_models = cfg.get("models", []) if models is None else models
        res = run_enabled(frame, use_models, rt.session_id, direction or cfg.get("direction", "down"))
        return rt.handle_result(res, frame)

    def tick(self) -> None:
        t = time.time()
        for rt in self.cams.values():
            rt.engine.tick(t)
            active = rt.status()["active"]
            if rt.published_active and not active:
                rt.published_active = False
                hub.publish({"type": "camera", "camera": rt.status()})
            # a browser source that stopped sending frames becomes idle
            if rt.source == "browser" and now_ms() - rt.last_frame_at > 8000:
                rt.source = "none"
                rt.browser_owner = ""
                rt.engine.counts.clear()
                people_snapshot_cache.remove(rt.cfg["id"])
                hub.publish({"type": "camera", "camera": rt.status()})

    def autostart(self) -> None:
        for rt in self.cams.values():
            url = rt.cfg.get("stream_url")
            if rt.cfg.get("autostart") and url:
                print(f"[cameras] autostart {rt.cfg['id']} -> {url}")
                self.start_stream(rt.cfg["id"], url)


registry = Registry()
