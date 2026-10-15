// AI Threat & Abnormal Behavior Detection add-on: client for /api/threat/* (server/threat).
import { apiUrl } from './apiBase';

export type ThreatKind = 'weapon' | 'gunshot' | 'violence' | 'running' | 'intrusion';
export type Box = [number, number, number, number];
export interface ThreatBox { label: string; score: number; box: Box; speed?: number | null }
export interface ThreatEvent {
  id: string; category: string; phase: string; labels: string[]; peak_score: number; snapshot_url: string | null; offset_sec: number | null;
  threat: { kind: ThreatKind; start_offset_sec: number; end_offset_sec: number; peak_offset_sec: number; boxes: ThreatBox[]; hits: number; zone_name?: string; audio_top?: [string, number][] };
}
export interface ThreatAlert {
  event_id: string; category: string; kind: ThreatKind; labels: string[]; severity: 'low' | 'medium' | 'high' | 'critical';
  start_sec: number | null; end_sec: number | null; confidence: number; zone_name?: string | null; snapshot_url: string | null; ongoing: boolean;
}
export interface Zone { id: string; name: string; polygon: [number, number][] }
export interface ThreatJob {
  id: string; state: 'queued' | 'running' | 'done' | 'failed'; progress: number; stage: string; file_name: string; camera_id: string;
  video_url: string; duration_sec: number | null; frame_size: [number, number] | null; zones: Zone[]; models: Record<string, string>;
  stages: { audio: { state: string; has_audio: boolean | null; error: string }; video: { state: string; error: string } };
  events: ThreatEvent[]; alerts: ThreatAlert[];
  detections: {
    weapons: ({ t: number } & ThreatBox)[];
    gunshot: { start: number; end: number; peak_t: number; gunshot: number; explosion: number; kind: string; detected: boolean; top: [string, number][] }[];
    behavior: { t: number; kind: string; boxes: ThreatBox[]; score?: number; zone_name?: string }[];
  };
  audio_timeline: { t: number; gunshot: number; explosion: number }[];
  violence_timeline: { t: number; score: number; people: number }[];
  max_people: number; error: string;
}

/** null when the server has no threat analysis for this job (feature off, or an older server). */
export async function fetchThreatJob(jobId: string): Promise<ThreatJob | null> {
  const r = await fetch(`/api/threat/jobs/${encodeURIComponent(jobId)}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

export async function fetchZones(cameraId: string): Promise<Zone[]> {
  const r = await fetch(`/api/threat/zones/${encodeURIComponent(cameraId)}`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()).zones;
}

export async function saveZones(cameraId: string, zones: Zone[]): Promise<Zone[]> {
  const r = await fetch(`/api/threat/zones/${encodeURIComponent(cameraId)}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ zones }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()).zones;
}

export async function rerunZones(jobId: string): Promise<void> {
  const r = await fetch(`/api/threat/jobs/${encodeURIComponent(jobId)}/rerun-zones`, { method: 'POST' });
  if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.detail ?? `HTTP ${r.status}`);
}

export const reportUrl = (jobId: string) => apiUrl(`/api/threat/jobs/${encodeURIComponent(jobId)}/report`);
