"""Threat-detection settings (server/.env or environment). Nothing here changes an existing setting."""

from __future__ import annotations

import config
from config import DATA_DIR, env_bool, env_float, env_int, env_str

# master switch: 0 turns the whole feature off (existing analysis is never affected)
ENABLED = env_bool("RASID_THREAT_ENABLED", True)

THREAT_DIR = DATA_DIR / "threat"
THREAT_DIR.mkdir(parents=True, exist_ok=True)
ZONES_FILE = DATA_DIR / "restricted_zones.json"

# ---- weapons (YOLO11 fine-tune: 0=gun, 1=knife) ----
WEAPON_REPO = env_str("RASID_WEAPON_REPO", "cosgun99/gun-knife-yolo11n")
WEAPON_FILE = env_str("RASID_WEAPON_FILE", "best.pt")
WEAPON_CONF = env_float("RASID_WEAPON_CONF", 0.50)
WEAPON_IMGSZ = env_int("RASID_WEAPON_IMGSZ", 640)
# knives are the weaker class of this model: stricter confidence, and a knife never fills a big part of the frame
KNIFE_CONF = env_float("RASID_KNIFE_CONF", 0.60)
WEAPON_MAX_AREA = {"gun": env_float("RASID_GUN_MAX_AREA", 0.20), "knife": env_float("RASID_KNIFE_MAX_AREA", 0.06)}
# person context (needs the people tracker): a weapon on/next to a person counts from HELD_CONF,
# one far from every person only from SOLO_CONF. 0 turns it off (WEAPON_CONF / KNIFE_CONF alone).
WEAPON_PERSON_CONTEXT = env_bool("RASID_WEAPON_PERSON_CONTEXT", True)
WEAPON_HELD_CONF = env_float("RASID_WEAPON_HELD_CONF", 0.40)
WEAPON_SOLO_CONF = env_float("RASID_WEAPON_SOLO_CONF", 0.65)
WEAPON_MIN_PX = env_int("RASID_WEAPON_MIN_PX", 8)
# zoom: the N largest people shorter than ZOOM_MAX_H of the frame are cropped and run again
WEAPON_ZOOM_PEOPLE = env_int("RASID_WEAPON_ZOOM_PEOPLE", 3)
WEAPON_ZOOM_MAX_H = env_float("RASID_WEAPON_ZOOM_MAX_H", 0.5)
WEAPON_ZOOM_IMGSZ = env_int("RASID_WEAPON_ZOOM_IMGSZ", 320)
# a weapon event needs MIN_HITS detections among the last WINDOW sampled frames
WEAPON_WINDOW = env_int("RASID_WEAPON_WINDOW", 4)
WEAPON_MIN_HITS = env_int("RASID_WEAPON_MIN_HITS", 2)
# ... except a clear sighting: from this confidence the first frame already raises the event (no wait)
WEAPON_INSTANT_CONF = env_float("RASID_WEAPON_INSTANT_CONF", 0.70)

# ---- gunshot audio (Audio Spectrogram Transformer, AudioSet ontology) ----
AUDIO_MODEL = env_str("RASID_AUDIO_MODEL", "MIT/ast-finetuned-audioset-10-10-0.4593")
AUDIO_WINDOW_S = env_float("RASID_AUDIO_WINDOW_S", 1.0)       # classified around each impulsive sound
ONSET_RATIO = env_float("RASID_ONSET_RATIO", 4.0)              # energy jump vs the previous 300 ms
ONSET_MIN_LEVEL = env_float("RASID_ONSET_MIN_LEVEL", 0.15)     # ignore sounds quieter than this share of the loudest
ONSET_MAX_PER_S = env_float("RASID_ONSET_MAX_PER_S", 2.0)      # cap on classified sounds per second of audio
# AudioSet sigmoid scores are low in absolute terms (a clear shot scores ≈0.2–0.3): a hit needs this
# score AND the class among the window's top-3 labels
GUNSHOT_THRESHOLD = env_float("RASID_GUNSHOT_THRESHOLD", 0.15)
EXPLOSION_THRESHOLD = env_float("RASID_EXPLOSION_THRESHOLD", 0.25)

# ---- abnormal behaviour ----
VIOLENCE_MODEL = env_str("RASID_VIOLENCE_MODEL", "cliffer1/videomae-base-finetuned-kinetics-violence-nonviolence-tuned")
VIOLENCE_THRESHOLD = env_float("RASID_VIOLENCE_THRESHOLD", 0.85)
VIOLENCE_MIN_HITS = env_int("RASID_VIOLENCE_MIN_HITS", 2)   # consecutive clips above threshold
VIOLENCE_CLIP_S = env_float("RASID_VIOLENCE_CLIP_S", 2.0)    # 16 frames spread over this many seconds
VIOLENCE_STRIDE_S = env_float("RASID_VIOLENCE_STRIDE_S", 2.0)
VIOLENCE_MIN_PEOPLE = env_int("RASID_VIOLENCE_MIN_PEOPLE", 2)
# people tracking (separate YOLO instance of the existing COCO weights, nearest-neighbour matching)
TRACK_WEIGHTS = env_str("RASID_TRACK_WEIGHTS", env_str("RASID_COCO_WEIGHTS", "yolo26s.pt"))
TRACK_CONF = env_float("RASID_TRACK_CONF", 0.30)
TRACK_IMGSZ = env_int("RASID_TRACK_IMGSZ", 640)
# running: speed in body-heights per second across the image (measured: walking ≈ 0.7, running ≈ 2–3.5).
# Meant for fixed cameras; motion towards/away from the camera reads slower.
RUN_SPEED = env_float("RASID_RUN_SPEED", 1.6)
RUN_MIN_S = env_float("RASID_RUN_MIN_S", 0.5)
RUN_WINDOW_S = env_float("RASID_RUN_WINDOW_S", 0.5)
RUN_CALM_SPEED = env_float("RASID_RUN_CALM_SPEED", 1.0)
RUN_MIN_BOX_PX = env_int("RASID_RUN_MIN_BOX_PX", 40)
INTRUSION_MIN_S = env_float("RASID_INTRUSION_MIN_S", 0.5)

# ---- pipeline ----
SAMPLE_FPS = env_float("RASID_THREAT_SAMPLE_FPS", 8.0)       # frames buffered for VideoMAE
DETECT_EVERY = env_int("RASID_THREAT_DETECT_EVERY", 2)        # weapons + tracking on every Nth sample (4 fps)
EVENT_GAP_S = env_float("RASID_THREAT_EVENT_GAP_S", 3.0)      # an event ends after this long without a hit
MAX_DETECTIONS = env_int("RASID_THREAT_MAX_DETECTIONS", 600)  # per kind kept in the job result

# ---- live cameras ----
# cameras whose live frames also go through threat detection ("*" = every video camera).
# Default: the dedicated threat camera CAM-TH.
LIVE_CAMERAS = env_str("RASID_THREAT_LIVE_CAMERAS", "CAM-TH")
LIVE_FPS = env_float("RASID_THREAT_LIVE_FPS", 8.0)            # threat analysis rate per live camera (weapons + tracking ≈ 110 ms/frame on CPU)
LIVE_VIOLENCE = env_bool("RASID_THREAT_LIVE_VIOLENCE", True)   # VideoMAE on live video (CPU-heavy)
# a violence clip needs LIVE_CLIP_MIN_FRAMES frames within LIVE_CLIP_MAX_S seconds. Measured: at ~1 frame/s
# VideoMAE scores people running (marathon) as high as real fights, so slower sources are not classified.
LIVE_CLIP_MAX_S = env_float("RASID_THREAT_LIVE_CLIP_MAX_S", 4.5)  # a browser camera sends ~2 fps: 8 frames need 4 s
LIVE_CLIP_MIN_FRAMES = env_int("RASID_THREAT_LIVE_CLIP_MIN_FRAMES", 8)

LIVE_AUDIO_MAX_MB = env_int("RASID_THREAT_LIVE_AUDIO_MAX_MB", 300)  # video files attached to a live camera

TEAM = "security"
# Telegram group of the security team (falls back to TELEGRAM_CHAT_ID like the other teams)
config.TELEGRAM_CHAT_BY_TEAM.setdefault("security", env_str("TELEGRAM_CHAT_ID_SECURITY"))
