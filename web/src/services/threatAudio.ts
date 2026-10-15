// Gunshot sound of a video file attached to a live camera (threat add-on, /api/threat/live-audio).
// The attached file plays muted and only pictures reach the server, so the file's soundtrack is
// analyzed on attach. The analysis runs in the background in time order and is polled, so a shot
// near the start is known within a second; while the file plays, each shot is reported when
// playback reaches it and the server raises it as a live event of that camera.
import { useEffect, useState } from 'react';

export interface Shot { i: number; t: number; t_end?: number; labels: string[]; score: number }
export interface AudioState { status: 'analyzing' | 'ready' | 'no_audio' | 'error'; shots: Shot[]; heard: number; error?: string }

const states = new Map<string, AudioState>();
const listeners = new Set<() => void>();
const runs = new Map<string, number>(); // camera → token of the file currently watched
const emit = () => listeners.forEach((f) => f());
const set = (camId: string, st: AudioState | null) => { if (st) states.set(camId, st); else states.delete(camId); emit(); };
const POLL_MS = 300;
const LATE_S = 3; // a shot found just after playback passed it is still raised now, not a loop later

export function useThreatAudio(camId: string): AudioState | undefined {
  const [, setV] = useState(0);
  useEffect(() => { const f = () => setV((v) => v + 1); listeners.add(f); return () => { listeners.delete(f); }; }, []);
  return states.get(camId);
}

interface Res { monitored?: boolean; id?: string; has_audio?: boolean; done?: boolean; error?: string; shots?: Shot[] }

/** Analyze the attached file's sound and watch its playback on `getVideo()` (stops when the camera's video changes). */
export async function attachAudio(camId: string, file: File, getVideo: () => HTMLVideoElement | undefined): Promise<void> {
  const token = (runs.get(camId) ?? 0) + 1;
  runs.set(camId, token);
  const live = () => runs.get(camId) === token;
  const video = getVideo();
  set(camId, { status: 'analyzing', shots: [], heard: 0 });
  let res: Res;
  try {
    const form = new FormData();
    form.append('file', file, file.name);
    form.append('camera_id', camId);
    const r = await fetch('/api/threat/live-audio', { method: 'POST', body: form });
    if (r.status === 404) { set(camId, null); return; } // threat add-on not on this server
    if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.detail ?? `HTTP ${r.status}`);
    res = await r.json();
  } catch (e) {
    if (live()) set(camId, { status: 'error', shots: [], heard: 0, error: String((e as Error).message || e) });
    return;
  }
  if (!live()) return; // another file was attached meanwhile
  if (!res.monitored) { set(camId, null); return; }
  if (!res.has_audio) { set(camId, { status: 'no_audio', shots: [], heard: 0 }); return; }
  const id = res.id!;
  const st: AudioState = { status: 'analyzing', shots: [], heard: 0 };
  const fired = new Set<number>(); // shots raised during the current pass of the file
  const fire = (s: Shot) => {
    fired.add(s.i);
    void fetch(`/api/threat/live-audio/${id}/shot/${s.i}`, { method: 'POST' }).catch(() => null);
    st.heard += 1;
  };
  const update = (r: Res) => {
    const cur = video?.currentTime ?? 0;
    for (const s of r.shots ?? []) {
      if (!st.shots.some((x) => x.i === s.i) && video && s.t <= cur && cur - s.t <= LATE_S && !fired.has(s.i)) fire(s);
    }
    st.shots = r.shots ?? [];
    if (r.done) st.status = r.error && !st.shots.length ? 'error' : 'ready';
    if (r.error) st.error = r.error;
    set(camId, { ...st });
  };
  update(res);
  // results arrive in time order while the file already plays
  void (async () => {
    while (live() && st.status === 'analyzing') {
      await new Promise((ok) => window.setTimeout(ok, POLL_MS));
      if (!live()) return;
      const r = await fetch(`/api/threat/live-audio/${id}`).then((x) => (x.ok ? x.json() : null)).catch(() => null);
      if (!r) { if (live()) set(camId, { ...st, status: 'error', error: 'analysis lost' }); return; }
      if (live()) update(r);
    }
  })();
  if (!video) return;
  let prev = video.currentTime;
  const timer = window.setInterval(() => {
    if (!live() || getVideo() !== video) { window.clearInterval(timer); return; }
    const cur = video.currentTime;
    if (cur + 0.5 < prev) { prev = -0.01; fired.clear(); } // the file looped back to the start
    let changed = false;
    for (const s of st.shots) {
      if (prev < s.t && s.t <= cur && !fired.has(s.i)) { fire(s); changed = true; }
    }
    prev = cur;
    if (changed) set(camId, { ...st });
  }, 120);
}

/** Forget a camera's file (source stopped or replaced). */
export function detachAudio(camId: string) { runs.set(camId, (runs.get(camId) ?? 0) + 1); set(camId, null); }
