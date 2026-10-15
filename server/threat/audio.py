"""Gunshot / explosion detection in the audio track of an uploaded video.

Audio is decoded with PyAV (bundled FFmpeg, no system install needed) and resampled to 16 kHz
mono. Impulsive sounds (sharp energy rises) are located first; a short window around each is
classified by the Audio Spectrogram Transformer fine-tuned on AudioSet. Scores are the model's
own per-class sigmoid outputs.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

import numpy as np

from . import settings as S
from .models import get_audio_model, locks

SR = 16000
GUN_LABELS = ("Gunshot, gunfire", "Machine gun", "Fusillade", "Artillery fire", "Cap gun")
AUTO_LABELS = ("Machine gun", "Fusillade")
EXPLOSION_LABELS = ("Explosion", "Boom")
# everyday sharp sounds AST confuses with shots: a gunshot/explosion hit is dropped when one of these
# scores higher (door slams, knocks, claps, drums, hammering — the common false alarms)
CONFUSER_LABELS = ("Door", "Slam", "Knock", "Clapping", "Applause", "Hands", "Finger snapping", "Hammer",
                   "Drum", "Snare drum", "Bass drum", "Drum kit", "Thump, thud", "Whip", "Wood block",
                   "Basketball bounce", "Chopping (food)", "Cupboard open or close", "Drawer open or close")


def gun_hit(w: Dict[str, Any]) -> bool:
    """A gunshot: score over the threshold, the class among the top 3, and above every confuser."""
    return w["gunshot"] >= S.GUNSHOT_THRESHOLD and w["gunshot_top3"] and w["gunshot"] > w.get("confuser", 0.0)


def boom_hit(w: Dict[str, Any], threshold: Optional[float] = None) -> bool:
    th = S.EXPLOSION_THRESHOLD if threshold is None else threshold
    return w["explosion"] >= th and w["explosion_top3"] and w["explosion"] > w.get("confuser", 0.0)


def extract_audio(path: Path) -> Optional[np.ndarray]:
    """Mono float32 samples at 16 kHz, or None when the file has no audio track."""
    import av

    with av.open(str(path)) as container:
        if not container.streams.audio:
            return None
        stream = container.streams.audio[0]
        resampler = av.AudioResampler(format="flt", layout="mono", rate=SR)
        chunks: List[np.ndarray] = []
        for frame in container.decode(stream):
            for out in resampler.resample(frame):
                chunks.append(out.to_ndarray().reshape(-1))
        for out in resampler.resample(None):
            chunks.append(out.to_ndarray().reshape(-1))
    if not chunks:
        return None
    return np.concatenate(chunks).astype(np.float32)


def impulsive_onsets(samples: np.ndarray) -> List[float]:
    """Times (s) of sharp energy rises — the signature of shots and blasts — in time order.

    Short-time RMS (20 ms frames, 10 ms hop) compared with the median of the preceding 300 ms.
    Speech and music rise slowly; a gunshot jumps by an order of magnitude within milliseconds.
    """
    lead = int(0.3 * SR)  # silence in front, so a shot in the very first instant is still a rise
    samples = np.concatenate([np.zeros(lead, np.float32), samples])
    hop, win = SR // 100, SR // 50
    n = (len(samples) - win) // hop + 1
    if n < 10:
        return []
    frames = np.lib.stride_tricks.sliding_window_view(samples, win)[::hop][:n]
    rms = np.sqrt(np.mean(frames.astype(np.float64) ** 2, axis=1)) + 1e-6
    floor = max(1e-3, S.ONSET_MIN_LEVEL * float(np.percentile(rms, 99.5)))
    found = []
    for i in range(30, n):
        if rms[i] < floor:
            continue
        ratio = rms[i] / float(np.median(rms[i - 30 : i]))
        if ratio >= S.ONSET_RATIO and rms[i] >= rms[max(0, i - 15) : i + 15].max():
            found.append((ratio * rms[i], max(0.0, (i * hop - lead) / SR)))
    found.sort(reverse=True)
    picked: List[float] = []
    cap = max(1, int(len(samples) / SR * S.ONSET_MAX_PER_S))
    for _, t in found:
        if all(abs(t - u) >= 0.4 for u in picked):
            picked.append(t)
        if len(picked) >= cap:
            break
    return sorted(picked)


def analyze_audio(samples: np.ndarray, on_progress: Optional[Callable[[float], None]] = None, fast: bool = False,
                  onsets: Optional[List[float]] = None) -> List[Dict[str, Any]]:
    """One record per impulsive sound: its time, gunshot/explosion scores and top AudioSet labels.

    Each onset is classified in short windows (AUDIO_WINDOW_S) ending at, centred on and starting
    at the sound — the AST score depends on where a short event sits in its input — and the best
    placement counts. A long window would dilute a shot with surrounding speech or noise.

    fast=True (files attached to a live camera): every onset is first classified only in the window
    ending at the sound (the placement that scored best in testing), all onsets in batches; the two
    other placements are tried only for borderline sounds (some gun/explosion score, not yet a hit).
    onsets: classify around these times instead of the detected impulsive sounds.
    """
    import torch

    fe, model, idx = get_audio_model()
    gun_idx = {idx[l] for l in GUN_LABELS if l in idx}
    auto_idx = {idx[l] for l in AUTO_LABELS if l in idx}
    exp_idx = {idx[l] for l in EXPLOSION_LABELS if l in idx}
    conf_idx = {idx[l] for l in CONFUSER_LABELS if l in idx}
    id2label = model.config.id2label

    n = len(samples)
    w = S.AUDIO_WINDOW_S
    if onsets is None:
        onsets = impulsive_onsets(samples)

    def spans_for(t: float) -> List[Tuple[int, int]]:
        out = []
        for a, b in ((t - 1.9 * w, t + 0.1 * w), (t - 0.5 * w, t + 0.5 * w), (t - 0.1 * w, t + 0.9 * w)):
            a, b = max(0, int(a * SR)), min(n, int(b * SR))
            if b - a >= SR // 4:
                out.append((a, b))
        return out

    def classify(items: List[Tuple[float, Tuple[int, int]]]) -> List[Dict[str, Any]]:
        if not items:
            return []
        clips = [samples[a:b] / max(1.0, float(np.abs(samples[a:b]).max())) for _, (a, b) in items]
        feats = fe(clips, sampling_rate=SR, return_tensors="pt")
        with locks["audio"], torch.inference_mode():
            probs = torch.sigmoid(model(**feats).logits).cpu().numpy()
        recs = []
        for (t, (a, b)), p in zip(items, probs):
            top3 = {int(i) for i in np.argsort(-p)[:3]}
            g_i = max(gun_idx, key=lambda i: p[i]) if gun_idx else None
            recs.append({
                "start": round(a / SR, 2), "end": round(b / SR, 2), "peak_t": round(t, 2),
                "gunshot": round(float(p[g_i]), 3) if g_i is not None else 0.0,
                "gunshot_top3": bool(top3 & gun_idx),
                "explosion": round(max((float(p[i]) for i in exp_idx), default=0.0), 3),
                "explosion_top3": bool(top3 & exp_idx),
                "confuser": round(max((float(p[i]) for i in conf_idx), default=0.0), 3),
                "kind": "machine_gun" if g_i in auto_idx else "gunshot",
                "top": [[id2label[int(i)], round(float(p[i]), 3)] for i in np.argsort(-p)[:3]],
            })
        return recs

    def better(a: Optional[Dict[str, Any]], b: Dict[str, Any]) -> Dict[str, Any]:
        return b if a is None or max(b["gunshot"], b["explosion"]) > max(a["gunshot"], a["explosion"]) else a

    out: List[Dict[str, Any]] = []
    if fast:
        firsts = [(t, sp[0]) for t in onsets for sp in [spans_for(t)] if sp]
        stage1: List[Dict[str, Any]] = []
        for b in range(0, len(firsts), 6):
            stage1 += classify(firsts[b : b + 6])
            if on_progress:
                on_progress(min(0.9, 0.9 * (b + 6) / max(1, len(firsts))))
        for rec in stage1:
            hit = gun_hit(rec) or boom_hit(rec)
            if not hit and max(rec["gunshot"], rec["explosion"]) >= 0.05:
                for r in classify([(rec["peak_t"], sp) for sp in spans_for(rec["peak_t"])[1:]]):
                    rec = better(rec, r)
            out.append(rec)
        if on_progress:
            on_progress(1.0)
        return out

    for k, t in enumerate(onsets):
        best = None
        for rec in classify([(t, sp) for sp in spans_for(t)]):
            best = better(best, rec)
        if best is not None:
            out.append(best)
        if on_progress:
            on_progress(min(1.0, (k + 1) / len(onsets)))
    if on_progress:
        on_progress(1.0)
    return out


def classify_whole(samples: np.ndarray, max_s: float = 10.0) -> Dict[str, Any]:
    """The whole clip (up to max_s, AudioSet's clip length) as one input — the context the model was
    trained on. Used for short microphone clips next to the per-sound windows."""
    import torch

    fe, model, idx = get_audio_model()
    gun_idx = {idx[l] for l in GUN_LABELS if l in idx}
    auto_idx = {idx[l] for l in AUTO_LABELS if l in idx}
    exp_idx = {idx[l] for l in EXPLOSION_LABELS if l in idx}
    conf_idx = {idx[l] for l in CONFUSER_LABELS if l in idx}
    clip = samples[: int(max_s * SR)]
    clip = clip / max(1.0, float(np.abs(clip).max()))
    feats = fe([clip], sampling_rate=SR, return_tensors="pt")
    with locks["audio"], torch.inference_mode():
        p = torch.sigmoid(model(**feats).logits).cpu().numpy()[0]
    top3 = {int(i) for i in np.argsort(-p)[:3]}
    g_i = max(gun_idx, key=lambda i: p[i]) if gun_idx else None
    return {
        "start": 0.0, "end": round(len(clip) / SR, 2), "peak_t": round(float(np.argmax(np.abs(clip))) / SR, 2),
        "gunshot": round(float(p[g_i]), 3) if g_i is not None else 0.0, "gunshot_top3": bool(top3 & gun_idx),
        "explosion": round(max((float(p[i]) for i in exp_idx), default=0.0), 3), "explosion_top3": bool(top3 & exp_idx),
        "confuser": round(max((float(p[i]) for i in conf_idx), default=0.0), 3),
        "kind": "machine_gun" if g_i in auto_idx else "gunshot",
        "top": [[model.config.id2label[int(i)], round(float(p[i]), 3)] for i in np.argsort(-p)[:3]],
    }
