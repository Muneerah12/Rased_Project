"""Local classifier for the IoT gunshot microphone, used when OpenRouter is not configured.

Same response shape as gunshot.classify_audio (kind pistol | machine_gun | bomb | none, confidence,
Arabic/English label and reason), so the IoT page works unchanged. Runs the AST AudioSet model of
the threat add-on on this machine: no API key, no internet.
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path
from typing import Any, Dict, List

import numpy as np

from . import settings as S
from .audio import SR, analyze_audio, boom_hit, classify_whole, extract_audio, gun_hit, impulsive_onsets

MODEL_NAME = "AST AudioSet (local)"
MIC_GUN_LABELS = {"Gunshot, gunfire", "Machine gun", "Fusillade", "Artillery fire", "Cap gun", "Burst, pop"}
MIC_BOOM_LABELS = {"Explosion", "Boom"}
_SUFFIX = {"webm": ".webm", "ogg": ".ogg", "mp4": ".m4a", "m4a": ".m4a", "mpeg": ".mp3", "mp3": ".mp3", "wav": ".wav", "flac": ".flac", "aac": ".aac"}


def _suffix(filename: str, content_type: str) -> str:
    name = (filename or "").lower()
    for k, v in _SUFFIX.items():
        if name.endswith("." + k) or k in (content_type or "").lower():
            return v
    return ".webm"


def _decode(raw: bytes, filename: str, content_type: str) -> np.ndarray:
    fd, tmp = tempfile.mkstemp(suffix=_suffix(filename, content_type), prefix="rasid-mic-")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(raw)
        samples = extract_audio(Path(tmp))
    except Exception as exc:  # noqa: BLE001 — unreadable container / codec
        raise ValueError(f"could not decode the audio clip: {exc}") from exc
    finally:
        try:
            os.unlink(tmp)
        except OSError:
            pass
    if samples is None or len(samples) < SR // 4:
        raise ValueError("the clip has no audio")
    return samples


def widen_mic_family(w: Dict[str, Any]) -> Dict[str, Any]:
    """A microphone hears a shot as "Burst, pop" more often than as "Gunshot": count the mic families
    among the window's top 3 labels (see classify_clip). Updates and returns the window record."""
    fam = {name: p for name, p in w["top"] if name in MIC_GUN_LABELS or name in MIC_BOOM_LABELS}
    g = max((p for n, p in fam.items() if n in MIC_GUN_LABELS), default=0.0)
    b = max((p for n, p in fam.items() if n in MIC_BOOM_LABELS), default=0.0)
    if g > w["gunshot"] or (g and not w["gunshot_top3"]):
        w["gunshot"], w["gunshot_top3"] = round(max(g, w["gunshot"] if w["gunshot_top3"] else 0.0), 3), True
    if b > w["explosion"] or (b and not w["explosion_top3"]):
        w["explosion"], w["explosion_top3"] = round(max(b, w["explosion"] if w["explosion_top3"] else 0.0), 3), True
    return w


def classify_clip(raw: bytes, filename: str = "clip.webm", content_type: str = "") -> Dict[str, Any]:
    from gunshot import LABELS  # same Arabic/English labels as the OpenRouter path (read only)

    if not raw:
        raise ValueError("empty audio")
    if len(raw) > 8 * (1 << 20):
        raise ValueError("audio larger than 8 MB")
    samples = _decode(raw, filename, content_type)
    no_onset = not impulsive_onsets(samples)
    try:
        sounds: List[Dict[str, Any]] = analyze_audio(samples)
        if not sounds:  # no sharp rise (a muffled or processed recording): classify the clip second by second
            dur = len(samples) / SR
            sounds = analyze_audio(samples, onsets=[t for t in np.arange(1.0, dur + 0.01, 1.0)] or [dur / 2])
        # the whole clip too: AST is trained on whole clips, and a short window can lose a shot's context
        sounds.append(classify_whole(samples))
    except Exception as exc:  # noqa: BLE001 — model unavailable
        raise RuntimeError(f"local audio model unavailable: {exc}") from exc

    # AudioSet puts gunshot, burst and explosion side by side under "Explosion", and a single short shot
    # is often scored as "Burst, pop". The mic (pressed on purpose) counts that family among the window's
    # top 3 labels: burst → gunshot, explosion/boom → bomb. Firecracker and Bang (doors) are left out.
    for w in sounds:
        widen_mic_family(w)
    guns = [w for w in sounds if gun_hit(w)]
    booms = [w for w in sounds if boom_hit(w, S.GUNSHOT_THRESHOLD)]
    best_gun = max(guns, key=lambda w: w["gunshot"], default=None)
    best_boom = max(booms, key=lambda w: w["explosion"], default=None)

    if best_boom is not None and (best_gun is None or best_boom["explosion"] >= best_gun["gunshot"]):
        kind, hit, score = "bomb", best_boom, best_boom["explosion"]
    elif best_gun is not None:
        # automatic fire: the model says so, or 3+ shots within 1.5 s
        times = sorted(w["peak_t"] for w in guns)
        burst = any(times[i + 2] - times[i] <= 1.5 for i in range(len(times) - 2))
        kind = "machine_gun" if best_gun["kind"] == "machine_gun" or burst else "pistol"
        hit, score = best_gun, best_gun["gunshot"]
    else:
        kind, hit = "none", None
        score = 1.0 - max([max(w["gunshot"], w["explosion"]) for w in sounds] or [0.0])

    label_ar, label_en = LABELS[kind]
    if hit is not None:
        fam = MIC_BOOM_LABELS if kind == "bomb" else MIC_GUN_LABELS
        top = max((x for x in hit["top"] if x[0] in fam), key=lambda x: x[1], default=[("Explosion" if kind == "bomb" else "Gunshot, gunfire"), score])
        n = len(guns) if kind != "bomb" else len(booms)
        reason_ar = (f"صنّف نموذج AST الصوت الاندفاعي عند {hit['peak_t']} ث كـ «{top[0]}» "
                     f"({round(top[1] * 100)}%)، وعدد الأصوات المطابقة {n}.")
        reason_en = f"AST classified the impulsive sound at {hit['peak_t']}s as \"{top[0]}\" ({round(top[1] * 100)}%); {n} matching sound(s)."
    elif no_onset:
        tops = ", ".join(dict.fromkeys(w["top"][0][0] for w in sounds)) or "—"
        reason_ar = f"لا يوجد صوت اندفاعي حاد في المقطع، والمقطع كاملاً صُنّف كـ: {tops}."
        reason_en = f"No sharp impulsive sound in the clip; the whole clip was classified as: {tops}."
    else:
        tops = ", ".join(w["top"][0][0] for w in sounds[:3])
        reason_ar = f"الأصوات الحادة في المقطع صُنّفت كأصوات أخرى ({tops})."
        reason_en = f"The sharp sounds in the clip were classified as other sounds ({tops})."

    threat = kind != "none"
    return {
        "ok": True, "kind": kind, "threat": threat, "gunshot": threat,
        "confidence": round(max(0.0, min(1.0, float(score))), 3),
        "label_ar": label_ar, "label_en": label_en, "reason_ar": reason_ar, "reason_en": reason_en,
        "model": MODEL_NAME,
    }
