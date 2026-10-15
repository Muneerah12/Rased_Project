"""Server settings. Values come from server/.env (optional) or the environment."""

from __future__ import annotations

import os
from pathlib import Path

SERVER_DIR = Path(__file__).resolve().parent
ROOT_DIR = SERVER_DIR.parent


def _load_dotenv(path: Path) -> None:
    """Tiny .env reader (KEY=VALUE per line). Real environment variables win."""
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, val = line.split("=", 1)
        key, val = key.strip(), val.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = val


_load_dotenv(SERVER_DIR / ".env")


def env_str(key: str, default: str = "") -> str:
    return os.environ.get(key, default).strip()


def env_int(key: str, default: int) -> int:
    try:
        return int(os.environ.get(key, default))
    except (TypeError, ValueError):
        return default


def env_float(key: str, default: float) -> float:
    try:
        return float(os.environ.get(key, default))
    except (TypeError, ValueError):
        return default


def env_bool(key: str, default: bool) -> bool:
    v = os.environ.get(key)
    if v is None:
        return default
    return v.strip().lower() in {"1", "true", "yes", "on"}


DATA_DIR = Path(env_str("RASID_DATA_DIR", str(SERVER_DIR / "data")))
SNAP_DIR = DATA_DIR / "snapshots"
UPLOAD_DIR = DATA_DIR / "uploads"
for _d in (DATA_DIR, SNAP_DIR, UPLOAD_DIR):
    _d.mkdir(parents=True, exist_ok=True)

JOURNAL_FILE = DATA_DIR / "journal.jsonl"
EVENTS_FILE = DATA_DIR / "events.jsonl"
CAMERAS_FILE = DATA_DIR / "cameras.json"

# Built Rasid web UI (served at "/")
WEB_DIST = Path(env_str("RASID_WEB_DIST", str(ROOT_DIR / "web" / "dist")))

# ---- CPS read-only integration (server-side only) ----
# HTTP is permitted only when development mode is explicit and the upstream is
# exactly localhost/127.0.0.1. The adapter enforces that transport boundary.
CPS_INTEGRATION_BASE_URL = env_str("CPS_INTEGRATION_BASE_URL")
CPS_RASID_INTEGRATION_TOKEN = env_str("CPS_RASID_INTEGRATION_TOKEN")
CPS_INTEGRATION_DEVELOPMENT_MODE = env_bool("CPS_INTEGRATION_DEVELOPMENT_MODE", False)
CPS_INTEGRATION_TIMEOUT_S = env_float("CPS_INTEGRATION_TIMEOUT_S", 5.0)

# ---- event engine (debounce) ----
# An event starts when the condition is seen in START_HITS of the last WINDOW analyzed frames,
# and ends after END_AFTER_S seconds without it. A new event of the same kind on the same camera
# can start only COOLDOWN_S seconds after the previous one ended.
EVENT_WINDOW = env_int("RASID_EVENT_WINDOW", 5)
EVENT_START_HITS = env_int("RASID_EVENT_START_HITS", 3)
EVENT_END_AFTER_S = env_float("RASID_EVENT_END_AFTER_S", 8.0)
EVENT_COOLDOWN_S = env_float("RASID_EVENT_COOLDOWN_S", 20.0)
CROWD_SMOOTH_FRAMES = env_int("RASID_CROWD_SMOOTH_FRAMES", 5)

# ---- server-side stream workers ----
STREAM_MAX_FPS = env_float("RASID_STREAM_MAX_FPS", 4.0)   # analysis rate cap per stream
MJPEG_FPS = env_float("RASID_MJPEG_FPS", 12.0)

# ---- recorded video analysis ----
VIDEO_SAMPLE_FPS = env_float("RASID_VIDEO_SAMPLE_FPS", 2.0)
VIDEO_MAX_MB = env_int("RASID_VIDEO_MAX_MB", 500)

# ---- notifications ----
NOTIFY_WEBHOOK_URL = env_str("NOTIFY_WEBHOOK_URL")
TELEGRAM_BOT_TOKEN = env_str("TELEGRAM_BOT_TOKEN")
TELEGRAM_CHAT_ID = env_str("TELEGRAM_CHAT_ID")
TELEGRAM_CHAT_BY_TEAM = {
    "medical": env_str("TELEGRAM_CHAT_ID_MEDICAL"),
    "civil_defense": env_str("TELEGRAM_CHAT_ID_CIVIL_DEFENSE"),
    "organizers": env_str("TELEGRAM_CHAT_ID_ORGANIZERS"),
}
NOTIFY_RECORDED = env_bool("NOTIFY_RECORDED", False)
# Public base URL used inside notifications for snapshot links (e.g. http://192.168.1.10:8010)
PUBLIC_BASE_URL = env_str("RASID_PUBLIC_URL").rstrip("/")

# ---- models ----
# auto | yolo | lite  (lite = OpenCV-only fallback, no PyTorch needed)
DETECTOR_MODE = env_str("RASID_DETECTOR", "auto").lower()

# ---- OpenRouter (IoT gunshot mic) ----
OPENROUTER_API_KEY = env_str("OPENROUTER_API_KEY")
OPENROUTER_GUNSHOT_MODEL = env_str("OPENROUTER_GUNSHOT_MODEL", "google/gemini-2.5-flash")

# ---- CPS read-only integration (server-side only) ----
# HTTP is accepted only for the explicitly enabled local development case. Production
# integrations must use HTTPS, with requests' certificate and hostname verification.
CPS_INTEGRATION_BASE_URL = env_str("CPS_INTEGRATION_BASE_URL")
CPS_RASID_INTEGRATION_TOKEN = env_str("CPS_RASID_INTEGRATION_TOKEN")
CPS_INTEGRATION_DEVELOPMENT_MODE = env_bool("CPS_INTEGRATION_DEVELOPMENT_MODE", False)
CPS_INTEGRATION_TIMEOUT_S = env_float("CPS_INTEGRATION_TIMEOUT_S", 5.0)

# ---- monitor-only operational HVAC intelligence ----
# Evidence freshness affects display/evaluation only. Real HVAC action thresholds
# intentionally remain unconfigured in operational_hvac_policy.py.
OPERATIONAL_HVAC_CPS_FRESHNESS_S = env_float("OPERATIONAL_HVAC_CPS_FRESHNESS_S", 30.0)
OPERATIONAL_HVAC_AI_FRESHNESS_S = env_float("OPERATIONAL_HVAC_AI_FRESHNESS_S", 30.0)
# Camera whose people count is the crowd evidence (it must carry the CPS node's zone_id).
OPERATIONAL_HVAC_CAMERA_ID = env_str("OPERATIONAL_HVAC_CAMERA_ID", "CAM-C")
# Trends compare the current observation with the one this many seconds earlier.
OPERATIONAL_HVAC_TREND_LOOKBACK_S = env_float("OPERATIONAL_HVAC_TREND_LOOKBACK_S", 300.0)
# A node with a single temperature sensor can never be peer-validated as NORMAL;
# when true, a fresh in-range UNKNOWN ("no peers") reading is accepted as evidence.
OPERATIONAL_HVAC_ACCEPT_SINGLE_SENSOR = env_bool("OPERATIONAL_HVAC_ACCEPT_SINGLE_SENSOR", False)
# Approved policy. Without OPERATIONAL_HVAC_POLICY_APPROVED=true and all four
# thresholds, evaluation stops at POLICY_NOT_CONFIGURED.
OPERATIONAL_HVAC_POLICY_APPROVED = env_bool("OPERATIONAL_HVAC_POLICY_APPROVED", False)
OPERATIONAL_HVAC_REACTIVE_TEMPERATURE_C = env_str("OPERATIONAL_HVAC_REACTIVE_TEMPERATURE_C")
OPERATIONAL_HVAC_NORMAL_TEMPERATURE_MAX_C = env_str("OPERATIONAL_HVAC_NORMAL_TEMPERATURE_MAX_C")
OPERATIONAL_HVAC_MINIMUM_TEMPERATURE_RISE_C = env_str("OPERATIONAL_HVAC_MINIMUM_TEMPERATURE_RISE_C")
OPERATIONAL_HVAC_MINIMUM_CROWD_INCREASE = env_str("OPERATIONAL_HVAC_MINIMUM_CROWD_INCREASE")
