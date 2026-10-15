/**
 * Connection to the Rasid AI server (server/main.py).
 *
 *   WebSocket /api/ws ── journal entries (AI events, notifications, operator actions)
 *                     ── per-frame camera results (people count, alerts)
 *                     ── camera status
 *
 * It also runs browser camera sources: this device's camera or a looping video file is
 * captured here and each frame is posted to /api/detect with the camera id. The server
 * runs the YOLO models, debounces detections into events and publishes them back.
 *
 * Without a reachable server the app keeps working in its original simulated mode.
 */
import type { Action, JournalEntry } from '../model/reducer';
import type { AiCamera, AiStatus, AppState } from '../model/types';
import { initialState } from '../model/fixtures';
import { reducer } from '../model/reducer';
import { setTimeBase } from '../model/config';
import { apiUrl, apiWsUrl } from './apiBase';
import type { ThermalReading } from '../model/types';

export interface Det { model: string; label: string; score: number; box: [number, number, number, number]; status?: string; temp_c?: number }
export interface FrameInfo {
  t: number; people: number | null; peopleSmoothed: number | null; alerts: string[]; inferMs: number | null; fps: number;
  /** boxes are only known for frames this tab sent (browser sources) */
  detections?: Det[]; frameSize?: [number, number];
  thermal?: ThermalReading | null;
}
interface LocalSource {
  kind: 'device' | 'file';
  label: string;
  video: HTMLVideoElement;
  stream?: MediaStream;
  url?: string;
  running: boolean;
  error: string;
}
export interface JobResult {
  id: string; state: 'queued' | 'running' | 'done' | 'failed'; progress: number; file_name: string; camera_id: string;
  events: { id: string; category: string; offset_sec: number | null; peak_score: number; labels: string[]; snapshot_url: string | null; phase: string }[];
  frames_analyzed: number; duration_sec: number | null; error: string; max_people: number; video_url: string;
}
export type CameraAccessError = 'denied' | 'not_found' | 'unavailable' | 'insecure';

type Dispatch = (a: Action) => void;
type Listener = () => void;

const CLIENT_ID = `web-${Math.random().toString(36).slice(2, 10)}`;
const MAX_UPLOAD_W = 960;

function thermalFromServer(t: Record<string, any> | null | undefined): ThermalReading | null {
  if (!t) return null;
  return { mode: t.mode, maxC: t.max_c, minC: t.min_c, meanC: t.mean_c, hotPct: t.hot_pct, hotC: t.hot_c, fireC: t.fire_c };
}

function camFromServer(c: Record<string, any>): AiCamera {
  const cfg = c.config ?? {};
  const tc = cfg.thermal;
  return {
    kind: (c.kind ?? cfg.kind) === 'thermal' ? 'thermal' : 'video', thermal: thermalFromServer(c.thermal),
    thermalCfg: tc ? { mode: tc.mode, rangeMinC: tc.range_min_c, rangeMaxC: tc.range_max_c, hotC: tc.hot_c, fireC: tc.fire_c } : null,
    id: c.id, source: c.source, active: !!c.active, fps: c.fps ?? 0, people: c.people ?? null, peopleSmoothed: c.people_smoothed ?? null,
    alerts: c.alerts ?? [], inferMs: c.infer_ms ?? null, error: c.error ?? '', streamUrl: c.stream_url ?? cfg.stream_url ?? '',
    models: cfg.models ?? [], direction: cfg.direction ?? 'down', capacity: cfg.capacity ?? null, autostart: !!cfg.autostart,
  };
}

class AiEngine {
  private dispatch: Dispatch | null = null;
  private ws: WebSocket | null = null;
  private retry = 0;
  private hydrated = false;
  private epoch = 0;
  private lastSeq = 0;
  private syncing = false;
  private connectedAt = 0;
  private lastCountAt: Record<string, number> = {};
  private listeners = new Set<Listener>();
  private alarmListeners = new Set<(e: { category: string; cameraId: string; incidentHint: string }) => void>();
  private audio: AudioContext | null = null;
  /** ms to add to Date.now() to get server time */
  offset = 0;
  connected = false;
  everConnected = false;
  frames: Record<string, FrameInfo> = {};
  local: Record<string, LocalSource> = {};
  soundOn = true;
  version = 0;

  /** the configured server (same origin by default) unless the page is opened from disk */
  get available(): boolean {
    return typeof location !== 'undefined' && /^https?:$/.test(location.protocol);
  }
  now(): number { return Date.now() + this.offset; }
  api(path: string): string { return path; }

  attach(dispatch: Dispatch): void {
    this.dispatch = dispatch;
    if (this.available && !this.ws) this.connect();
  }
  subscribe(fn: Listener): () => void { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  onAlarm(fn: (e: { category: string; cameraId: string; incidentHint: string }) => void): () => void { this.alarmListeners.add(fn); return () => { this.alarmListeners.delete(fn); }; }
  private emit(): void { this.version++; this.listeners.forEach((f) => f()); }

  // ------------------------------------------------------------------ connection
  private connect(): void {
    let ws: WebSocket;
    try { ws = new WebSocket(apiWsUrl('/api/ws')); } catch { this.scheduleReconnect(); return; }
    this.ws = ws;
    ws.onmessage = (m) => {
      let msg: any;
      try { msg = JSON.parse(m.data as string); } catch { return; }
      this.onMessage(msg);
    };
    ws.onclose = () => {
      this.ws = null;
      if (this.connected) {
        this.connected = false;
        this.dispatch?.({ type: 'AI_STATUS', patch: { connected: false }, connection: this.hydrated ? 'reconnecting' : 'simulated' });
        this.emit();
      }
      this.scheduleReconnect();
    };
    ws.onerror = () => { try { ws.close(); } catch { /* ignore */ } };
  }
  private scheduleReconnect(): void {
    const wait = Math.min(10_000, 1000 * 2 ** this.retry++);
    setTimeout(() => this.connect(), wait);
  }
  private keepAlive?: ReturnType<typeof setInterval>;

  private async onMessage(msg: any): Promise<void> {
    const d = this.dispatch;
    if (!d) return;
    switch (msg.type) {
      case 'hello': {
        this.retry = 0;
        this.offset = msg.now - Date.now();
        this.connected = true;
        this.everConnected = true;
        this.connectedAt = msg.now;
        const status = this.statusFrom(msg);
        this.lastStatus = status;
        if (!this.hydrated || msg.epoch !== this.epoch) await this.hydrate(msg.epoch, status);
        else {
          d({ type: 'AI_STATUS', patch: status, connection: 'live' });
          await this.resync();
        }
        (msg.cameras ?? []).forEach((c: any) => { const cam = camFromServer(c); this.lastCams[cam.id] = cam; d({ type: 'AI_CAMERA', cam }); });
        clearInterval(this.keepAlive);
        this.keepAlive = setInterval(() => { try { this.ws?.send('ping'); } catch { /* ignore */ } }, 20_000);
        this.emit();
        break;
      }
      case 'journal': {
        const entries: JournalEntry[] = msg.entries ?? [];
        if (!entries.length || this.syncing) return;
        if (entries[0].seq > this.lastSeq + 1) { await this.resync(); return; }
        this.applyEntries(entries, true);
        break;
      }
      case 'reset': await this.hydrate(msg.epoch, {}); break;
      case 'camera': { const cam = camFromServer(msg.camera); this.lastCams[cam.id] = cam; d({ type: 'AI_CAMERA', cam }); this.emit(); break; }
      case 'frame': {
        const id: string = msg.camera_id;
        const prev = this.frames[id];
        this.frames[id] = {
          ...(prev?.frameSize && this.local[id] ? { detections: prev.detections, frameSize: prev.frameSize } : {}),
          t: msg.t, people: msg.people ?? null, peopleSmoothed: msg.people_smoothed ?? null, alerts: msg.alerts ?? [], inferMs: msg.infer_ms ?? null, fps: msg.fps ?? 0,
          thermal: thermalFromServer(msg.thermal),
        };
        if (msg.counts_zone && msg.people_smoothed != null && Date.now() - (this.lastCountAt[id] ?? 0) > 900) {
          this.lastCountAt[id] = Date.now();
          d({ type: 'AI_COUNT', cameraId: id, count: msg.people_smoothed, at: msg.t });
        }
        this.emit();
        break;
      }
    }
  }

  private statusFrom(msg: any): Partial<AiStatus> {
    return { connected: true, mode: msg.ai?.mode ?? null, device: msg.ai?.device ?? '', models: msg.ai?.models ?? {}, notify: msg.notify ?? null };
  }

  /** Build the shared state: fixtures anchored at the journal epoch + every journal entry. */
  private lastStatus: Partial<AiStatus> = {};
  private lastCams: Record<string, AiCamera> = {};
  private async hydrate(epoch: number, status: Partial<AiStatus>): Promise<void> {
    if (Object.keys(status).length) this.lastStatus = status; else status = this.lastStatus;
    this.syncing = true;
    try {
      const r = await fetch('/api/journal?since=0').then((x) => x.json());
      setTimeBase(epoch);
      let st: AppState = initialState();
      st = { ...st, connection: 'live', baseMode: 'live', occupancy: {}, occupancyUpdatedAt: {}, analysisRunning: {} };
      st = reducer(st, { type: 'JOURNAL', entries: r.entries });
      st = { ...st, now: this.now(), lastUpdate: this.now(), ai: { ...st.ai, ...status, connected: true } };
      this.epoch = epoch;
      this.lastSeq = r.entries.length ? r.entries[r.entries.length - 1].seq : 0;
      this.hydrated = true;
      this.dispatch?.({ type: 'HYDRATE', state: st });
      Object.values(this.lastCams).forEach((cam) => this.dispatch?.({ type: 'AI_CAMERA', cam }));
    } catch (e) {
      console.warn('[rasid] hydrate failed', e);
    } finally { this.syncing = false; }
  }
  private async resync(): Promise<void> {
    this.syncing = true;
    try {
      const r = await fetch(`/api/journal?since=${this.lastSeq}`).then((x) => x.json());
      if (r.epoch !== this.epoch) { this.syncing = false; await this.hydrate(r.epoch, {}); return; }
      this.applyEntries(r.entries, false);
    } catch { /* next message retries */ } finally { this.syncing = false; }
  }
  private applyEntries(entries: JournalEntry[], live: boolean): void {
    const fresh = entries.filter((e) => e.seq > this.lastSeq);
    if (!fresh.length) return;
    this.lastSeq = fresh[fresh.length - 1].seq;
    this.dispatch?.({ type: 'JOURNAL', entries: fresh });
    if (!live) return;
    for (const e of fresh) {
      const a = e.action as any;
      if (a.type === 'AI_EVENT' && a.ev.phase === 'start' && e.at >= this.connectedAt - 2000) {
        this.alarm(a.ev.category, a.ev.camera_id, a.ev.source === 'recorded');
      }
    }
  }

  /** Send a shared-record action to the server journal (applied when it comes back). */
  async relay(a: Action): Promise<boolean> {
    try {
      const r = await fetch('/api/journal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(a) });
      return r.ok;
    } catch { return false; }
  }
  async resetShared(): Promise<void> { await fetch('/api/journal/reset', { method: 'POST' }); }

  // ------------------------------------------------------------------ alarm (sound + browser notification)
  unlockAudio(): void {
    try {
      if (!this.audio) this.audio = new (window.AudioContext || (window as any).webkitAudioContext)();
      if (this.audio.state === 'suspended') void this.audio.resume();
    } catch { /* no audio */ }
  }
  async enableDesktopNotifications(): Promise<string> {
    this.unlockAudio();
    if (typeof Notification === 'undefined') return 'unsupported';
    if (Notification.permission === 'granted') return 'granted';
    return Notification.requestPermission();
  }
  private beep(urgent: boolean): void {
    const ctx = this.audio;
    if (!ctx || !this.soundOn || ctx.state !== 'running') return;
    const n = urgent ? 3 : 2;
    for (let i = 0; i < n; i++) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'square';
      o.frequency.value = urgent ? 880 : 660;
      g.gain.value = 0.06;
      o.connect(g); g.connect(ctx.destination);
      const t0 = ctx.currentTime + i * 0.32;
      o.start(t0); o.stop(t0 + 0.18);
    }
  }
  private alarm(category: string, cameraId: string, recorded: boolean): void {
    const urgent = category === 'fire_smoke' || category === 'fall' || category === 'weapon' || category === 'gunshot' || category === 'abnormal_behavior';
    if (!recorded) this.beep(urgent);
    const names: Record<string, string> = { fire_smoke: 'حريق / دخان', fall: 'سقوط شخص', crowding: 'تجاوز سعة الحشود', wrong_way: 'حركة بالاتجاه الخاطئ',
      weapon: 'رصد سلاح', gunshot: 'صوت إطلاق نار', abnormal_behavior: 'سلوك غير طبيعي' };
    try {
      if (!recorded && typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.visibilityState !== 'visible') {
        new Notification(`راصد — ${names[category] ?? category}`, { body: `${cameraId}: رصد جديد بالذكاء الاصطناعي`, tag: `${category}-${cameraId}` });
      }
    } catch { /* ignore */ }
    this.alarmListeners.forEach((f) => f({ category, cameraId, incidentHint: names[category] ?? category }));
  }

  // ------------------------------------------------------------------ camera config / server streams
  async patchCamera(id: string, patch: Record<string, unknown>): Promise<void> {
    const r = await fetch(`/api/cameras/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
    if (r.ok) this.dispatch?.({ type: 'AI_CAMERA', cam: camFromServer(await r.json()) });
  }
  async startStream(id: string, url: string, autostart: boolean): Promise<string | null> {
    this.stopLocal(id, false);
    const r = await fetch(`/api/cameras/${id}/stream`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, autostart }) });
    if (!r.ok) return (await r.json().catch(() => ({})))?.detail ?? `HTTP ${r.status}`;
    this.dispatch?.({ type: 'AI_CAMERA', cam: camFromServer(await r.json()) });
    this.emit();
    return null;
  }
  async stopSource(id: string): Promise<void> {
    this.stopLocal(id, false);
    const r = await fetch(`/api/cameras/${id}/source`, { method: 'DELETE' }).catch(() => null);
    if (r?.ok) {
      this.dispatch?.({ type: 'AI_CAMERA', cam: camFromServer(await r.json()) });
      if (r.ok) await this.patchCamera(id, { autostart: false });
    }
    delete this.frames[id];
    this.emit();
  }
  mjpegUrl(id: string): string { return apiUrl(`/api/cameras/${id}/mjpeg?c=${CLIENT_ID}`); }

  // ------------------------------------------------------------------ browser sources
  async listCameras(): Promise<MediaDeviceInfo[]> {
    try { return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput'); } catch { return []; }
  }
  async startDevice(id: string, deviceId?: string): Promise<CameraAccessError | null> {
    const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
    if (!window.isSecureContext) return 'insecure';
    if (!md?.getUserMedia) return 'unavailable';
    let stream: MediaStream;
    try {
      stream = await md.getUserMedia({ video: deviceId ? { deviceId: { exact: deviceId }, width: { ideal: 1280 } } : { width: { ideal: 1280 }, facingMode: 'environment' }, audio: false });
    } catch (e: unknown) {
      const name = (e as { name?: string })?.name;
      if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
      if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'not_found';
      return 'unavailable';
    }
    await this.stopServerStreamIfAny(id);
    this.stopLocal(id, false);
    const video = this.makeVideo();
    video.srcObject = stream;
    const label = stream.getVideoTracks()[0]?.label || 'camera';
    this.local[id] = { kind: 'device', label, video, stream, running: true, error: '' };
    await video.play().catch(() => undefined);
    this.loop(id);
    this.emit();
    return null;
  }
  async startFile(id: string, file: File): Promise<void> {
    await this.stopServerStreamIfAny(id);
    this.stopLocal(id, false);
    const video = this.makeVideo();
    const url = URL.createObjectURL(file);
    video.src = url;
    video.loop = true;
    this.local[id] = { kind: 'file', label: file.name, video, url, running: true, error: '' };
    await video.play().catch(() => undefined);
    this.loop(id);
    this.emit();
  }
  private async stopServerStreamIfAny(id: string): Promise<void> {
    await fetch(`/api/cameras/${id}/source`, { method: 'DELETE' }).catch(() => null);
  }
  private makeVideo(): HTMLVideoElement {
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.autoplay = true;
    v.setAttribute('playsinline', '');
    return v;
  }
  stopLocal(id: string, notify = true): void {
    const src = this.local[id];
    if (!src) return;
    src.running = false;
    src.stream?.getTracks().forEach((t) => t.stop());
    src.video.pause();
    if (src.url) URL.revokeObjectURL(src.url);
    delete this.local[id];
    delete this.frames[id];
    if (notify) this.emit();
  }
  private async loop(id: string): Promise<void> {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    while (this.local[id]?.running) {
      const src = this.local[id];
      const v = src.video;
      if (!this.connected || v.readyState < 2 || !v.videoWidth || !ctx) { await sleep(300); continue; }
      const scale = Math.min(1, MAX_UPLOAD_W / v.videoWidth);
      canvas.width = Math.round(v.videoWidth * scale);
      canvas.height = Math.round(v.videoHeight * scale);
      ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
      const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.85));
      if (!blob) { await sleep(300); continue; }
      const form = new FormData();
      form.append('image', blob, 'frame.jpg');
      form.append('camera_id', id);
      form.append('client_id', CLIENT_ID);
      const t0 = performance.now();
      try {
        const r = await fetch('/api/detect', { method: 'POST', body: form });
        if (r.status === 409) { src.error = (await r.json()).detail; src.running = false; this.emit(); break; }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = await r.json();
        if (!this.local[id]) break;
        src.error = '';
        const prev = this.frames[id];
        this.frames[id] = {
          t: this.now(), people: data.people_count ?? null, peopleSmoothed: data.people_smoothed ?? null, alerts: data.alerts ?? [],
          inferMs: data.infer_ms ?? null, fps: prev?.fps ?? 0, detections: data.detections ?? [], frameSize: data.frame_size ?? [canvas.width, canvas.height],
          thermal: thermalFromServer(data.thermal),
        };
        this.emit();
      } catch (e) {
        src.error = String((e as Error).message || e);
        this.emit();
        await sleep(2000);
      }
      const spent = performance.now() - t0;
      if (spent < 150) await sleep(150 - spent);
    }
  }

  // ------------------------------------------------------------------ recorded video / media
  async analyzeVideo(file: File, cameraId: string, onProgress: (j: JobResult) => void): Promise<JobResult> {
    const form = new FormData();
    form.append('video', file, file.name);
    form.append('camera_id', cameraId);
    const r = await fetch('/api/analyze-video', { method: 'POST', body: form });
    if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.detail ?? `HTTP ${r.status}`);
    const { job_id } = await r.json();
    for (;;) {
      await sleep(1000);
      const j: JobResult = await fetch(`/api/jobs/${job_id}`).then((x) => x.json());
      onProgress(j);
      if (j.state === 'done' || j.state === 'failed') return j;
    }
  }
  async uploadMedia(file: File): Promise<{ url: string; type: string; name: string }> {
    const form = new FormData();
    form.append('file', file, file.name);
    const r = await fetch('/api/uploads', { method: 'POST', body: form });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }
  async testNotify(team: string): Promise<{ channel: string; ok: boolean; detail: string; target?: string }[]> {
    const r = await fetch('/api/notify/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ team }) });
    return (await r.json()).results;
  }
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

export const ai = new AiEngine();
