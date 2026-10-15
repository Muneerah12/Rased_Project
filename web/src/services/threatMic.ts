// Gunshot sound from the microphone of a live device camera (threat add-on, /api/threat/live-mic).
// A live camera sends the server only pictures, so for a threat-monitored camera the device
// microphone is streamed too: 16 kHz mono 16-bit PCM every CHUNK_MS. The server classifies it and
// raises a gunshot as a live event of that camera within about a second of the sound.
import { useEffect, useState } from 'react';

export interface MicState { status: 'listening' | 'denied' | 'error'; lastHit?: { at: number; labels: string[]; score: number } | null; error?: string }

const RATE = 16000;
const CHUNK_MS = 250;
const states = new Map<string, MicState>();
const listeners = new Set<() => void>();
const runs = new Map<string, { stop: () => void }>();
const emit = () => listeners.forEach((f) => f());
const set = (camId: string, st: MicState | null) => { if (st) states.set(camId, st); else states.delete(camId); emit(); };

export function useThreatMic(camId: string): MicState | undefined {
  const [, setV] = useState(0);
  useEffect(() => { const f = () => setV((v) => v + 1); listeners.add(f); return () => { listeners.delete(f); }; }, []);
  return states.get(camId);
}

const post = (camId: string, body: ArrayBuffer | null) =>
  fetch(`/api/threat/live-mic/${camId}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: body ?? new ArrayBuffer(0) })
    .then((r) => (r.ok ? r.json() : null)).catch(() => null);

/** Float samples at `rate` → 16 kHz int16 (box filter over each output sample's input span). */
function toPcm16(input: Float32Array, rate: number): ArrayBuffer {
  const ratio = rate / RATE;
  const n = Math.floor(input.length / ratio);
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.floor(i * ratio), b = Math.max(a + 1, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let k = a; k < b; k++) sum += input[k];
    const v = Math.max(-1, Math.min(1, sum / (b - a)));
    out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  return out.buffer;
}

/** Stream this device's microphone for `camId` when the server watches that camera for threats. */
export async function startMic(camId: string): Promise<void> {
  stopMic(camId);
  const probe = await post(camId, null);
  if (!probe?.monitored) return; // not a threat camera, or the add-on is off
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { noiseSuppression: false, echoCancellation: false, autoGainControl: false } });
  } catch {
    set(camId, { status: 'denied' });
    return;
  }
  const ctx = new AudioContext();
  void ctx.resume();
  const src = ctx.createMediaStreamSource(stream);
  const proc = ctx.createScriptProcessor(4096, 1, 1);
  let pending: Float32Array[] = [];
  let busy = false;
  let stopped = false;
  proc.onaudioprocess = (e) => { if (!stopped) pending.push(new Float32Array(e.inputBuffer.getChannelData(0))); };
  src.connect(proc);
  proc.connect(ctx.destination); // silent output; needed for the processor to run
  const st: MicState = { status: 'listening', lastHit: null };
  set(camId, st);
  const timer = window.setInterval(async () => {
    if (busy || stopped || !pending.length) return;
    const parts = pending; pending = [];
    const all = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0; for (const p of parts) { all.set(p, o); o += p.length; }
    busy = true;
    const r = await post(camId, toPcm16(all, ctx.sampleRate));
    busy = false;
    if (stopped) return;
    if (r && r.monitored === false) { stop(); return; }
    const next: MicState = r ? { status: r.error ? 'error' : 'listening', lastHit: r.last_hit ?? null, error: r.error || undefined } : st;
    if (next.status !== states.get(camId)?.status || next.lastHit?.at !== states.get(camId)?.lastHit?.at) set(camId, next);
  }, CHUNK_MS);
  const stop = () => {
    stopped = true;
    window.clearInterval(timer);
    proc.disconnect(); src.disconnect();
    stream.getTracks().forEach((t) => t.stop());
    void ctx.close().catch(() => undefined);
    set(camId, null);
  };
  runs.set(camId, { stop });
}

/** Stop streaming a camera's microphone (source stopped or replaced). */
export function stopMic(camId: string) {
  const r = runs.get(camId);
  if (r) { runs.delete(camId); r.stop(); }
}
