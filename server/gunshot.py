"""Threat audio classification via OpenRouter (pistol / machine gun / bomb)."""

from __future__ import annotations

import base64
import json
import re
from typing import Any, Dict, Optional, Tuple

import requests

import config

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

KINDS = ("pistol", "machine_gun", "bomb", "none")

LABELS = {
    "pistol": ("صوت مسدس", "Pistol / gunshot"),
    "machine_gun": ("صوت رشاش", "Machine gun"),
    "bomb": ("صوت قنبلة / انفجار", "Bomb / explosion"),
    "none": ("لا يوجد تهديد صوتي", "No acoustic threat"),
}

PROMPT = (
    "You are an acoustic safety classifier for a public-event command centre.\n"
    "Listen to this short audio clip and choose ONE primary class:\n"
    '- "pistol": single or few sharp firearm gunshots (handgun / rifle single fire)\n'
    '- "machine_gun": rapid automatic fire / burst / machine-gun rattling\n'
    '- "bomb": bomb blast, grenade, large explosion, heavy detonation boom\n'
    '- "none": speech, crowd, music, doors, claps, vehicles, fireworks that are clearly not weapons, silence, or other non-threat sounds\n'
    "If unsure between weapon classes, pick the closest match. Prefer \"none\" when evidence is weak.\n"
    "Respond with ONLY a JSON object (no markdown), using this exact shape:\n"
    "{"
    '"kind": "pistol"|"machine_gun"|"bomb"|"none", '
    '"confidence": 0.0-1.0, '
    '"label_ar": "نص عربي قصير", '
    '"label_en": "short English label", '
    '"reason_ar": "جملة قصيرة بالعربية", '
    '"reason_en": "short English reason"'
    "}"
)


def _audio_format(filename: str, content_type: str) -> str:
    name = (filename or "").lower()
    ct = (content_type or "").lower()
    for fmt in ("wav", "mp3", "webm", "ogg", "m4a", "aac", "flac", "aiff"):
        if name.endswith(f".{fmt}") or fmt in ct:
            return fmt
    return "webm"


def _extract_json(text: str) -> Optional[Dict[str, Any]]:
    text = (text or "").strip()
    if not text:
        return None
    try:
        data = json.loads(text)
        if isinstance(data, dict):
            return data
    except json.JSONDecodeError:
        pass
    m = re.search(r"\{[\s\S]*\}", text)
    if not m:
        return None
    try:
        data = json.loads(m.group(0))
        return data if isinstance(data, dict) else None
    except json.JSONDecodeError:
        return None


def _normalize_kind(parsed: Dict[str, Any]) -> str:
    raw = str(parsed.get("kind") or "").strip().lower().replace("-", "_").replace(" ", "_")
    aliases = {
        "gunshot": "pistol",
        "gun": "pistol",
        "handgun": "pistol",
        "rifle": "pistol",
        "shot": "pistol",
        "مسجل": "pistol",
        "مسدس": "pistol",
        "machinegun": "machine_gun",
        "automatic": "machine_gun",
        "auto": "machine_gun",
        "رشاش": "machine_gun",
        "explosion": "bomb",
        "blast": "bomb",
        "grenade": "bomb",
        "قنبلة": "bomb",
        "انفجار": "bomb",
        "safe": "none",
        "other": "none",
        "no": "none",
        "not_threat": "none",
    }
    if raw in KINDS:
        return raw
    if raw in aliases:
        return aliases[raw]
    # legacy boolean fallback
    if "gunshot" in parsed and parsed.get("gunshot") is True:
        return "pistol"
    if "gunshot" in parsed and parsed.get("gunshot") is False:
        return "none"
    return "none"


def classify_audio(raw: bytes, filename: str = "clip.webm", content_type: str = "") -> Dict[str, Any]:
    key = config.OPENROUTER_API_KEY
    if not key:
        raise RuntimeError("OPENROUTER_API_KEY is not configured in server/.env")
    if not raw:
        raise ValueError("empty audio")
    if len(raw) > 8 * (1 << 20):
        raise ValueError("audio larger than 8 MB")

    fmt = _audio_format(filename, content_type)
    b64 = base64.b64encode(raw).decode("ascii")
    payload = {
        "model": config.OPENROUTER_GUNSHOT_MODEL,
        "temperature": 0.1,
        "messages": [{
            "role": "user",
            "content": [
                {"type": "text", "text": PROMPT},
                {"type": "input_audio", "input_audio": {"data": b64, "format": fmt}},
            ],
        }],
    }
    headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://rasid.local",
        "X-Title": "Rasid Threat Mic",
    }
    r = requests.post(OPENROUTER_URL, headers=headers, json=payload, timeout=90)
    if r.status_code >= 400:
        detail = r.text[:400]
        try:
            detail = r.json().get("error", {}).get("message") or detail
        except Exception:  # noqa: BLE001
            pass
        raise RuntimeError(f"OpenRouter error {r.status_code}: {detail}")

    body = r.json()
    content = (((body.get("choices") or [{}])[0].get("message") or {}).get("content")) or ""
    if isinstance(content, list):
        content = "".join(
            part.get("text", "") if isinstance(part, dict) else str(part)
            for part in content
        )
    parsed = _extract_json(str(content))
    if not parsed:
        raise RuntimeError(f"model returned unparsable response: {str(content)[:300]}")

    kind = _normalize_kind(parsed)
    threat = kind != "none"
    try:
        confidence = float(parsed.get("confidence", 0.5))
    except (TypeError, ValueError):
        confidence = 0.5
    confidence = max(0.0, min(1.0, confidence))

    default_ar, default_en = LABELS[kind]
    label_ar = str(parsed.get("label_ar") or default_ar).strip() or default_ar
    label_en = str(parsed.get("label_en") or default_en).strip() or default_en
    reason_ar = str(parsed.get("reason_ar") or "")
    reason_en = str(parsed.get("reason_en") or "")

    return {
        "ok": True,
        "kind": kind,
        "threat": threat,
        # keep legacy flag for older UI clients
        "gunshot": threat,
        "confidence": round(confidence, 3),
        "label_ar": label_ar,
        "label_en": label_en,
        "reason_ar": reason_ar,
        "reason_en": reason_en,
        "model": config.OPENROUTER_GUNSHOT_MODEL,
    }


def configured() -> Tuple[bool, str]:
    return bool(config.OPENROUTER_API_KEY), config.OPENROUTER_GUNSHOT_MODEL
