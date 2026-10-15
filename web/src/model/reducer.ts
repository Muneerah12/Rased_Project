import { CONFIG } from './config';
import { A11, SUITABLE_TEAMS, initialState } from './fixtures';
import {
  employeeById, findNode, isOpenIncident, nodeOnline, lastHeartbeat, nextStep, sensorLast, zoneById,
} from './selectors';
import { incidentSpot } from './geo';
import type {
  AppState, EventCategory, Evidence, Incident, ResponderStep, Severity, L, EmpIncidentCategory, Alert,
  AiCamera, AiStatus, Camera, ConnectionMode, NotifyResult, Pt, Zone,
} from './types';

/** An AI event as produced by the Rasid AI server (server/events.py). */
export interface ServerEvent {
  id: string;
  phase: 'start' | 'update' | 'end';
  camera_id: string;
  zone_id: string;
  category: EventCategory;
  source: 'live' | 'recorded';
  started_at: number;
  last_seen: number;
  ended_at: number | null;
  peak_score: number;
  peak_count: number | null;
  capacity: number | null;
  labels: string[];
  team?: string;
  snapshot_url: string | null;
  video_url: string | null;
  file_name: string | null;
  offset_sec: number | null;
  models?: string[];
}
/** One entry of the shared, ordered journal kept by the server. */
export interface JournalEntry { seq: number; at: number; action: Action }
/** Actions that change shared records: in live mode they go through the server journal. */
export const RELAYED_ACTIONS = new Set(['MANUAL_REPORT', 'ASSIGN', 'STEP', 'FIELD_ACTION', 'DRONE_DEPLOY', 'DRONE_END', 'CLOSE', 'COMPLETE']);

export type Action =
  | { type: 'TICK'; now: number }
  | { type: 'SET_ANALYSIS'; cameraId: string; on: boolean; by: string }
  | { type: 'SCENARIO'; kind: 'crowd_surge' | 'node_stop' | 'node_restore' | 'connection_loss' | 'connection_restore' }
  | { type: 'RESET'; now: number }
  | {
    type: 'RECORDED_DETECTION'; key: string; fileName: string; category: EventCategory; zoneId: string; cameraId: string;
    by: string; mediaUrl: string; mediaType: string; offsetSec: number;
  }
  | {
    type: 'MANUAL_REPORT'; kind: 'expo' | 'employee'; category: EventCategory | EmpIncidentCategory; zoneId: string; location: string;
    severity: Severity; description: string; by: string; employeeId?: string; mediaUrl?: string; mediaType?: string; mediaName?: string;
  }
  | { type: 'ASSIGN'; incidentId: string; employeeId: string; by: string }
  /** `onBehalf`: the operator records the step for the assigned employee (full operator authority) */
  | { type: 'STEP'; incidentId: string; step: ResponderStep; by: string; onBehalf?: boolean }
  | { type: 'FIELD_ACTION'; incidentId: string; text: string; by: string }
  | { type: 'DRONE_DEPLOY'; incidentId: string; droneId: string; by: string }
  | { type: 'DRONE_END'; incidentId: string; by: string }
  | { type: 'CLOSE'; incidentId: string; by: string }
  /** operator finishes the whole response in one go: remaining steps on the employee's behalf, then close */
  | { type: 'COMPLETE'; incidentId: string; by: string }
  /** written by the server each time the platform starts: staff and drones begin available */
  | { type: 'SHIFT_START' }
  // ---- Rasid AI server ----
  | { type: 'HYDRATE'; state: AppState }
  | { type: 'JOURNAL'; entries: JournalEntry[] }
  | { type: 'AI_EVENT'; ev: ServerEvent }
  | { type: 'CPS_NODE_STATUS'; node_id: string; status: 'ONLINE' | 'OFFLINE'; reason?: string; location_id?: string | null; last_heartbeat_received_at?: string | null }
  | { type: 'AI_NOTIFY'; eventId: string; results: NotifyResult[] }
  | { type: 'AI_STATUS'; patch: Partial<AiStatus>; connection?: ConnectionMode }
  | { type: 'AI_CAMERA'; cam: AiCamera }
  | { type: 'AI_COUNT'; cameraId: string; count: number; at: number };

const pad = (n: number, w: number) => String(n).padStart(w, '0');
const same = (text: string): L => ({ ar: text, en: text });

/** Tiny deterministic noise so the simulation is repeatable. */
function noise(t: number, salt: number): number {
  const x = Math.sin(Math.floor(t / 1000) * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

const CATEGORY_TITLE: Record<EventCategory, Alert['titleKey']> = {
  crowding: 'crowd_limit', fire_smoke: 'smoke', fall: 'fall',
  obstruction: 'event_generic', wrong_way: 'event_generic', smoking: 'event_generic', littering: 'event_generic',
  weapon: 'event_generic', gunshot: 'event_generic', abnormal_behavior: 'event_generic', node_offline: 'node_offline',
};
const CATEGORY_SEVERITY: Record<EventCategory, Severity> = {
  crowding: 'high', fall: 'high', fire_smoke: 'high', obstruction: 'medium', wrong_way: 'medium', smoking: 'low', littering: 'low',
  weapon: 'critical', gunshot: 'critical', abnormal_behavior: 'high', node_offline: 'high',
};

/** Creates event → alert → incident as one linked chain with stable IDs. */
/** Map spot of a new incident: spread around its camera inside the zone, on a spot no open incident there uses. */
function incidentPos(s: AppState, cam: Camera | undefined, z: Zone | undefined): Pt | null {
  if (!z) return cam?.pos ?? null;
  const taken = s.incidents.filter((i) => i.kind === 'expo' && i.zoneId === z.id && isOpenIncident(i) && i.pos).map((i) => i.pos!);
  return incidentSpot(cam, z, taken);
}

function createChain(s: AppState, o: {
  category: EventCategory; zoneId: string; sourceKind: 'camera' | 'recorded'; sourceId: string; t: number;
  peak?: number; capacity?: number; fileName?: string; evidence: Omit<Evidence, 'id'> | Omit<Evidence, 'id'>[]; by: string; location: L; description: L;
  simulated?: boolean; aiId?: string; score?: number; labels?: string[]; models?: string[]; severity?: Severity; titleKey?: Alert['titleKey']; offsetSec?: number;
}): AppState {
  const seq = { ...s.seq };
  const evtId = `EVT-A1-${pad(seq.evt++, 6)}`;
  const alrId = `ALR-2026-${pad(seq.alr++, 4)}`;
  const incId = `INC-2026-${pad(seq.inc++, 4)}`;
  const evList = (Array.isArray(o.evidence) ? o.evidence : [o.evidence]).map((e) => ({ ...e, id: `EV-${pad(seq.ev++, 4)}` }));
  const cam = s.cameras.find((c) => c.id === o.sourceId);
  const z = zoneById(s, o.zoneId);
  const sourceLabel = o.sourceKind === 'recorded' ? `Recorded: ${o.fileName} (${cam?.label.en ?? o.sourceId})` : (cam?.label.en ?? o.sourceId);
  const params: Record<string, string | number> = { zone: o.zoneId, cam: o.sourceId, cat: o.category };
  if (o.peak != null) { params.count = o.peak; params.capacity = o.capacity ?? 0; }
  const severity = o.severity ?? CATEGORY_SEVERITY[o.category];
  const incident: Incident = {
    id: incId, kind: 'expo', category: o.category, zoneId: o.zoneId, location: o.location,
    source: 'ai_camera', sourceDeviceId: o.sourceId, severity, status: 'open',
    detectedAt: o.t, alertAt: o.t + 1000, description: o.description, eventId: evtId, alertId: alrId,
    evidence: evList, actions: [{ t: o.t + 1000, actor: 'SYSTEM', text: { ar: `إنشاء التنبيه ${alrId} والحادثة من الحدث ${evtId}`, en: `Created alert ${alrId} and incident from event ${evtId}` }, field: false }],
    // around the camera, inside the zone, on a spot no other open incident of the zone uses
    pos: incidentPos(s, cam, z), fixture: false,
  };
  return {
    ...s, seq,
    events: [...s.events, {
      id: evtId, category: o.category, zoneId: o.zoneId, sourceKind: o.sourceKind, sourceId: o.sourceId, t: o.t, lastSeen: o.t,
      peakCount: o.peak, capacity: o.capacity, simulated: o.simulated ?? true, incidentId: incId, alertId: alrId, fileName: o.fileName,
      aiId: o.aiId, score: o.score, labels: o.labels, models: o.models, offsetSec: o.offsetSec,
    }],
    alerts: [...s.alerts, {
      id: alrId, kind: 'event', titleKey: o.titleKey ?? CATEGORY_TITLE[o.category], params, severity,
      sourceLabel, zoneId: o.zoneId, t: o.t + 1000, eventId: evtId, incidentId: incId,
    }],
    incidents: [...s.incidents, incident],
  };
}

const CAT_TEXT: Record<string, L> = {
  fire_smoke: { ar: 'حريق/دخان', en: 'fire/smoke' }, fall: { ar: 'سقوط شخص', en: 'a person fall' },
  crowding: { ar: 'تجاوز السعة', en: 'a capacity breach' }, wrong_way: { ar: 'حركة بالاتجاه الخاطئ', en: 'wrong-way movement' },
  weapon: { ar: 'سلاحاً', en: 'a weapon' }, gunshot: { ar: 'صوت إطلاق نار/انفجار', en: 'a gunshot/explosion sound' },
  abnormal_behavior: { ar: 'سلوكاً غير طبيعي', en: 'abnormal behavior' },
  node_offline: { ar: 'انقطاع عقدة CPS', en: 'a CPS node outage' },
};
const LABEL_TEXT: Record<string, L> = {
  fire: { ar: 'حريق', en: 'fire' }, smoke: { ar: 'دخان', en: 'smoke' }, fall: { ar: 'سقوط', en: 'fall' },
  wrong_way: { ar: 'اتجاه خاطئ', en: 'wrong way' }, people: { ar: 'أشخاص', en: 'people' },
  gun: { ar: 'سلاح ناري', en: 'gun' }, knife: { ar: 'سكين', en: 'knife' }, gunshot: { ar: 'طلق ناري', en: 'gunshot' },
  machine_gun: { ar: 'رشاش', en: 'automatic fire' }, explosion: { ar: 'انفجار', en: 'explosion' },
  violence: { ar: 'عنف (شجار/اعتداء)', en: 'violence (fight/assault)' }, running: { ar: 'ركض', en: 'running' },
  sudden_running: { ar: 'ركض مفاجئ', en: 'sudden running' }, crowd_running: { ar: 'ركض جماعي', en: 'crowd running' },
  intrusion: { ar: 'دخول منطقة ممنوعة', en: 'restricted-area entry' },
};
const TEAM_TEXT: Record<string, L> = {
  medical: { ar: 'الكادر الطبي', en: 'Medical Team' }, civil_defense: { ar: 'الدفاع المدني', en: 'Civil Defense' },
  organizers: { ar: 'المنظمين', en: 'Organizers' }, hvac: { ar: 'صيانة التكييف', en: 'HVAC Maintenance' },
  security: { ar: 'الأمن', en: 'Security' },
};
const CHANNEL_TEXT: Record<string, L> = {
  dashboard: { ar: 'شاشات راصد', en: 'Rasid screens' }, telegram: { ar: 'تيليجرام', en: 'Telegram' }, webhook: { ar: 'Webhook', en: 'Webhook' },
};

/** AI event from the server → event, alert and incident (or a re-detection on an open incident). */
/** a new detection within this time of the last one (same camera and kind, unassigned) is the same incident */
const MERGE_WINDOW_MS = 60_000;

function applyAiEvent(s: AppState, ev: ServerEvent): AppState {
  const existing = s.events.find((e) => e.aiId === ev.id);
  if (existing) {
    const lastSeen = Math.max(existing.lastSeen, ev.last_seen);
    const peak = ev.peak_count != null ? Math.max(existing.peakCount ?? 0, ev.peak_count) : existing.peakCount;
    let next: AppState = {
      ...s,
      events: s.events.map((e) => (e.id === existing.id ? {
        ...e, lastSeen, endedAt: ev.ended_at ?? e.endedAt, peakCount: peak, score: Math.max(e.score ?? 0, ev.peak_score), labels: ev.labels,
      } : e)),
    };
    if (ev.category === 'crowding' && peak != null && existing.alertId) {
      next = { ...next, alerts: next.alerts.map((a) => (a.id === existing.alertId ? { ...a, params: { ...a.params, count: Math.max(Number(a.params.count ?? 0), peak) } } : a)) };
    }
    return next;
  }
  const cam = s.cameras.find((c) => c.id === ev.camera_id);
  const zoneId = ev.zone_id || cam?.zoneId || A11;
  const recorded = ev.source === 'recorded';
  const t = ev.started_at;
  const pct = Math.round((ev.peak_score ?? 0) * 100);
  const labels = ev.labels ?? [];
  const lab = (lng: 'ar' | 'en') => labels.map((x) => LABEL_TEXT[x]?.[lng] ?? x).join(lng === 'ar' ? '، ' : ', ');
  const modelTxt = (ev.models ?? []).join(', ');
  const camL = cam?.label ?? same(ev.camera_id);
  const evidence: Omit<Evidence, 'id'>[] = [];
  if (ev.snapshot_url) evidence.push({
    kind: 'camera_frame', sourceId: ev.camera_id, t, simulated: false, mediaUrl: ev.snapshot_url, mediaType: 'image/jpeg',
    label: { ar: `لقطة الرصد من ${camL.ar}${recorded ? ` (التسجيل ${ev.file_name} عند ${ev.offset_sec} ث)` : ''}`, en: `Detection snapshot from ${camL.en}${recorded ? ` (recording ${ev.file_name} at ${ev.offset_sec}s)` : ''}` },
  });
  if (recorded && ev.video_url) evidence.push({
    kind: 'upload', sourceId: ev.camera_id, t, simulated: false, mediaUrl: ev.video_url, mediaType: 'video/mp4',
    label: { ar: `تسجيل مرفوع: ${ev.file_name} (عند ${ev.offset_sec} ث)`, en: `Uploaded recording: ${ev.file_name} (at ${ev.offset_sec}s)` },
  });

  // a live re-detection is attached to an existing incident only when it is clearly the same occurrence:
  // same camera and kind, nobody assigned yet, and seen within the last minute. Anything else is a new incident.
  const lastSeenOf = (incId: string, since: number) => s.events.filter((e) => e.incidentId === incId).reduce((m, e) => Math.max(m, e.endedAt ?? e.lastSeen ?? e.t), since);
  const open = !recorded && s.incidents.find((i) => !i.fixture && i.kind === 'expo' && i.source === 'ai_camera' && i.sourceDeviceId === ev.camera_id
    && i.category === ev.category && (s.strictMerge
      ? i.status === 'open' && !i.assignment && t - lastSeenOf(i.id, i.detectedAt) <= MERGE_WINDOW_MS
      : i.status !== 'resolved' && i.status !== 'closed')); // legacy rule for history recorded before the change
  if (open) {
    const seq = { ...s.seq };
    const evtId = `EVT-A1-${pad(seq.evt++, 6)}`;
    const evs = evidence.map((e) => ({ ...e, id: `EV-${pad(seq.ev++, 4)}` }));
    let next: AppState = {
      ...s, seq,
      events: [...s.events, {
        id: evtId, category: ev.category, zoneId, sourceKind: 'camera', sourceId: ev.camera_id, t, lastSeen: ev.last_seen, endedAt: ev.ended_at ?? undefined,
        peakCount: ev.peak_count ?? undefined, capacity: ev.capacity ?? undefined, simulated: false, incidentId: open.id, alertId: open.alertId,
        aiId: ev.id, score: ev.peak_score, labels, models: ev.models,
      }],
    };
    next = updIncident(next, open.id, (i) => ({
      ...i, evidence: [...i.evidence, ...evs],
      actions: [...i.actions, { t, actor: 'SYSTEM', text: { ar: `رصد متجدد بواسطة الذكاء الاصطناعي (${evtId}، ثقة ${pct}%)`, en: `AI re-detection (${evtId}, ${pct}% confidence)` }, field: false }],
    }));
    if (ev.category === 'crowding' && ev.peak_count != null && open.alertId) {
      next = { ...next, alerts: next.alerts.map((a) => (a.id === open.alertId ? { ...a, params: { ...a.params, count: Math.max(Number(a.params.count ?? 0), ev.peak_count!) } } : a)) };
    }
    return next;
  }

  const crowd = ev.category === 'crowding';
  const description: L = crowd
    ? { ar: `تجاوز عدد الأشخاص في ${zoneId} السعة المحددة: ${ev.peak_count}/${ev.capacity} (عدّ YOLO من ${camL.ar}).`, en: `People count in ${zoneId} exceeded the configured capacity: ${ev.peak_count}/${ev.capacity} (YOLO count from ${camL.en}).` }
    : {
      ar: `رصد نموذج الذكاء الاصطناعي ${CAT_TEXT[ev.category]?.ar ?? ev.category} (${lab('ar')}) بثقة ${pct}% في ${recorded ? `التسجيل ${ev.file_name}` : `البث المباشر من ${camL.ar}`}.${modelTxt ? ` النموذج: ${modelTxt}.` : ''}`,
      en: `The AI model detected ${CAT_TEXT[ev.category]?.en ?? ev.category} (${lab('en')}) with ${pct}% confidence in ${recorded ? `recording ${ev.file_name}` : `the live feed of ${camL.en}`}.${modelTxt ? ` Model: ${modelTxt}.` : ''}`,
    };
  const fire = ev.category === 'fire_smoke' && labels.includes('fire');
  return createChain(s, {
    category: ev.category, zoneId, sourceKind: recorded ? 'recorded' : 'camera', sourceId: ev.camera_id, t, by: 'AI',
    peak: ev.peak_count ?? undefined, capacity: ev.capacity ?? undefined, fileName: ev.file_name ?? undefined,
    evidence, simulated: false, aiId: ev.id, score: ev.peak_score, labels, models: ev.models, offsetSec: ev.offset_sec ?? undefined,
    severity: fire ? 'critical' : undefined, titleKey: fire ? 'fire' : undefined,
    location: recorded
      ? { ar: `مجال ${camL.ar} (تسجيل)`, en: `${camL.en} view (recording)` }
      : { ar: `مجال رؤية ${camL.ar}`, en: `${camL.en} field of view` },
    description,
  });
}

function applyAiNotify(s: AppState, eventId: string, results: NotifyResult[]): AppState {
  const evt = s.events.find((e) => e.aiId === eventId);
  if (!evt?.incidentId) return s;
  return updIncident(s, evt.incidentId, (i) => ({
    ...i,
    notifications: [...(i.notifications ?? []), ...results],
    actions: [...i.actions, ...results.map((r) => {
      const ch = CHANNEL_TEXT[r.channel] ?? same(r.channel);
      const team = TEAM_TEXT[r.team ?? ''] ?? same(r.team ?? '');
      return {
        t: r.t, actor: 'NOTIFY', field: false,
        text: r.ok
          ? { ar: `أُرسل الإشعار إلى ${team.ar} عبر ${ch.ar}${r.target ? ` (${r.target})` : ''}`, en: `Notification sent to ${team.en} via ${ch.en}${r.target ? ` (${r.target})` : ''}` }
          : { ar: `فشل إرسال الإشعار عبر ${ch.ar}: ${r.detail}`, en: `Notification via ${ch.en} failed: ${r.detail}` },
      };
    })],
  }));
}

/** Apply ordered journal entries; each runs at the server time it was recorded. */
/** Real CPS node watched by the server: OFFLINE raises one device alert, ONLINE clears it. */
function applyCpsNodeStatus(s: AppState, a: Extract<Action, { type: 'CPS_NODE_STATUS' }>): AppState {
  const open = (x: Alert) => x.titleKey === 'node_offline' && x.params.cps === 1 && x.params.node === a.node_id && !x.clearedAt;
  const openInc = (i: Incident) => i.category === 'node_offline' && i.sourceDeviceId === a.node_id && (i.status === 'open' || i.status === 'assigned' || i.status === 'responding');
  if (a.status === 'ONLINE') {
    if (!s.alerts.some(open) && !s.incidents.some(openInc)) return s;
    const back = { ar: `عادت ${a.node_id} للاتصال وتصل نبضاتها مجدداً`, en: `${a.node_id} is back online; heartbeats are arriving again` };
    return {
      ...s,
      alerts: s.alerts.map((x) => (open(x) ? { ...x, clearedAt: s.now } : x)),
      incidents: s.incidents.map((i) => (openInc(i) ? { ...i, status: 'resolved', resolvedAt: s.now, actions: [...i.actions, { t: s.now, actor: 'SYSTEM', text: back, field: false }] } : i)),
    };
  }
  if (s.alerts.some(open)) return s;
  const zoneId = a.location_id ? a.location_id.replace(/^([A-Z]\d+)-(\d+)$/, '$1.$2') : A11;
  // IDs come from the shared sequence: every screen applies the same journal entry, so all agree.
  const seq = { ...s.seq };
  const alrId = `ALR-2026-${pad(seq.alr++, 4)}`;
  const incId = `INC-2026-${pad(seq.inc++, 4)}`;
  const unreachable = a.reason === 'CPS_UNREACHABLE';
  const hb = a.last_heartbeat_received_at ? new Date(a.last_heartbeat_received_at).toISOString().slice(11, 19) + ' UTC' : '—';
  const description = unreachable
    ? { ar: `تعذّر الوصول إلى خادم CPS؛ حالة ${a.node_id} غير معروفة.`, en: `The CPS backend is unreachable; ${a.node_id} status is unknown.` }
    : { ar: `توقفت نبضات ${a.node_id} (آخر نبضة ${hb}). تحقق من تغذية الجهاز وشبكة Wi-Fi والبوابة.`, en: `${a.node_id} stopped sending heartbeats (last ${hb}). Check device power, Wi-Fi and the gateway.` };
  const incident: Incident = {
    id: incId, kind: 'expo', category: 'node_offline', zoneId, location: { ar: `${zoneId} · ${a.location_id ?? ''} · ${a.node_id}`, en: `${zoneId} · ${a.location_id ?? ''} · ${a.node_id}` },
    source: 'iot_sensor', sourceDeviceId: a.node_id, severity: 'high', status: 'open', detectedAt: s.now, alertAt: s.now,
    description, alertId: alrId, evidence: [], pos: null, fixture: false,
    actions: [{ t: s.now, actor: 'SYSTEM', text: { ar: `إنشاء التنبيه ${alrId} من مراقبة CPS`, en: `Created alert ${alrId} from CPS monitoring` }, field: false }],
  };
  return { ...s, seq, incidents: [...s.incidents, incident], alerts: [...s.alerts, {
    id: alrId, kind: 'device', titleKey: 'node_offline',
    params: { node: a.node_id, alias: a.node_id, cps: 1, reason: a.reason ?? 'NODE_OFFLINE' },
    severity: 'high', sourceLabel: `${a.node_id} · CPS`, zoneId, t: s.now, incidentId: incId,
  }] };
}

function applyJournal(s0: AppState, entries: JournalEntry[]): AppState {
  let s = s0;
  for (const e of entries) {
    if (e.seq <= s.journalSeq) continue;
    const prevNow = s.now;
    const r = reducer({ ...s, now: e.at }, e.action);
    s = { ...r, now: Math.max(prevNow, e.at), journalSeq: e.seq };
  }
  return s;
}

/** Live AI people count for a zone-counting camera: occupancy + one history sample per minute. */
function applyCount(s: AppState, cameraId: string, count: number, at: number): AppState {
  const cam = s.cameras.find((c) => c.id === cameraId);
  if (!cam || !cam.countsZone) return s;
  const z = cam.zoneId;
  const hist = s.crowdHistory[z] ?? [];
  const lastH = hist[hist.length - 1];
  const addHist = !lastH || Math.floor(at / 60_000) > Math.floor(lastH.t / 60_000);
  return {
    ...s,
    occupancy: { ...s.occupancy, [z]: count },
    occupancyUpdatedAt: { ...s.occupancyUpdatedAt, [z]: at },
    crowdHistory: addHist ? { ...s.crowdHistory, [z]: [...hist, { t: at, v: count, fixture: false }].slice(-240) } : s.crowdHistory,
  };
}

function updIncident(s: AppState, id: string, f: (i: Incident) => Incident): AppState {
  return { ...s, incidents: s.incidents.map((i) => (i.id === id ? f(i) : i)) };
}

function tick(s0: AppState, now: number): AppState {
  if (s0.connection === 'reconnecting') return { ...s0, now };
  let s: AppState = { ...s0, now, lastUpdate: now };

  // heartbeats (healthy devices every 5 s)
  s.nodes = s.nodes.map((n) => {
    if (n.heartbeatStopped) return n;
    let hb = n.heartbeats;
    let last = hb[hb.length - 1] ?? now;
    if (now - last < CONFIG.heartbeatPeriodMs) return n;
    hb = [...hb];
    while (now - last >= CONFIG.heartbeatPeriodMs) { last += CONFIG.heartbeatPeriodMs; hb.push(last); }
    return { ...n, heartbeats: hb.slice(-40) };
  });
  // simulated badge reads as on-site staff pass gates and zone readers
  s.employees = s.employees.map((e, k) => {
    if (e.badgeReadsPaused || e.availability === 'off_duty' || !e.onSite || e.lastBadgeRead == null) return e;
    if (now - e.lastBadgeRead < CONFIG.badgeReadPeriodMs + (k % 3) * 60_000) return e;
    return { ...e, lastBadgeRead: now };
  });
  // BME280 reports every 10 s while the device and its node are up; offline devices keep their last known values
  s.sensors = s.sensors.map((se, k) => {
    const last = sensorLast(se);
    const node = findNode(s, se.nodeId);
    if (!last || se.stopped || !node || !nodeOnline(s, node) || now - last.t < 10_000) return se;
    const d = (salt: number, amp: number) => (noise(now, k * 7 + salt) - 0.5) * amp;
    const r = {
      t: now,
      temperature: +(last.temperature + d(1, 0.2)).toFixed(1),
      humidity: +(last.humidity + d(2, 0.4)).toFixed(1),
      pressure: +(last.pressure + d(3, 0.1)).toFixed(1),
    };
    return { ...se, readings: [...se.readings.slice(-89), r] };
  });

  // A1.1 occupancy from the simulated central camera analysis
  const cam = s.cameras.find((c) => c.countsZone && c.zoneId === A11);
  // With the Rasid AI server connected, occupancy comes only from real YOLO counts (AI_COUNT).
  if (cam && cam.online && s.analysisRunning[cam.id] && s.baseMode !== 'live') {
    const cur = s.occupancy[A11] ?? 138;
    const surging = (s.scenario.surgeUntil ?? 0) > now;
    const target = surging ? 158 : 138;
    let next = cur;
    if (cur < target) next = cur + 1;
    else if (cur > target + 1) next = noise(now, 3) < 0.5 ? cur - 1 : cur;
    else if (noise(now, 5) < 0.2) next = target + (noise(now, 9) < 0.5 ? -1 : 1);
    if (!surging && next > 150) next = 150; // settle after surge without re-breaching
    if (next !== cur || now - (s.occupancyUpdatedAt[A11] ?? 0) >= 2000) {
      s.occupancy = { ...s.occupancy, [A11]: next };
      s.occupancyUpdatedAt = { ...s.occupancyUpdatedAt, [A11]: now };
    }
    // one history sample per simulated minute
    const hist = s.crowdHistory[A11] ?? [];
    const lastH = hist[hist.length - 1];
    if (!lastH || Math.floor(now / 60_000) > Math.floor(lastH.t / 60_000)) {
      s.crowdHistory = { ...s.crowdHistory, [A11]: [...hist, { t: now, v: next, fixture: false }] };
    }
    // capacity breach → one event/alert/incident per episode
    const cap = zoneById(s, A11)?.capacity ?? 150;
    const openCrowd = s.incidents.find((i) => i.category === 'crowding' && i.zoneId === A11 && i.status !== 'closed' && i.eventId);
    if (next > cap) {
      if (openCrowd) {
        s.events = s.events.map((e) => (e.id === openCrowd.eventId ? { ...e, lastSeen: now, endedAt: undefined, peakCount: Math.max(e.peakCount ?? 0, next) } : e));
        s.alerts = s.alerts.map((a) => (a.id === openCrowd.alertId ? { ...a, params: { ...a.params, count: Math.max(Number(a.params.count ?? 0), next) } } : a));
      } else {
        s = createChain(s, {
          category: 'crowding', zoneId: A11, sourceKind: 'camera', sourceId: cam.id, t: now, peak: next, capacity: cap,
          by: 'SYSTEM',
          evidence: { kind: 'camera_frame', label: { ar: `إطار ${cam.label.ar} عند تجاوز السعة (${next}/${cap})`, en: `${cam.label.en} frame at capacity breach (${next}/${cap})` }, sourceId: cam.id, t: now, simulated: true },
          location: { ar: 'الساحة الرئيسية (مجال كاميرا 1)', en: 'Main plaza (Camera 1 view)' },
          description: { ar: `تجاوز عدد الأشخاص في A1.1 السعة المحددة: ${next}/${cap}.`, en: `People count in A1.1 exceeded the configured capacity: ${next}/${cap}.` },
        });
      }
    } else if (openCrowd) {
      s.events = s.events.map((e) => (e.id === openCrowd.eventId && !e.endedAt ? { ...e, endedAt: now } : e));
    }
  }

  // node offline alerts from missing heartbeats; cleared when heartbeats return
  // device alerts use their own ID namespace so locally generated records never shift
  // the IDs that the shared journal assigns (all screens must agree on INC/ALR numbers)
  const seq = { ...s.seq };
  const newAlerts: Alert[] = [];
  s.alerts = s.alerts.map((a) => {
    if (!a.nodeId || a.clearedAt) return a;
    const n = findNode(s, a.nodeId);
    return n && nodeOnline(s, n) ? { ...a, clearedAt: now } : a;
  });
  s.nodes.forEach((n) => {
    if (nodeOnline(s, n)) return;
    if (s.alerts.some((a) => a.nodeId === n.id && !a.clearedAt)) return;
    const hb = lastHeartbeat(n) ?? now;
    newAlerts.push({
      id: `ALR-DEV-${pad(seq.dev++, 4)}`, kind: 'device', titleKey: 'node_offline', params: { node: n.id, alias: n.aliases[0] ?? '' },
      severity: 'medium', sourceLabel: n.id, zoneId: n.zoneId, t: hb + CONFIG.heartbeatTimeoutMs, nodeId: n.id,
    });
  });
  if (newAlerts.length) { s.alerts = [...s.alerts, ...newAlerts]; s.seq = seq; }

  // simulated drone arrival
  s.incidents.forEach((i) => {
    const m = i.drone;
    // (a mission already ended — e.g. at platform start — never "arrives" later)
    if (m && !m.fixture && m.arrivedAt == null && m.endedAt == null && now - m.dispatchedAt >= CONFIG.droneTransitMs) {
      const evId = `EV-${i.id}-DRONE-${m.dispatchedAt % 100000}`;
      s = updIncident(s, i.id, (x) => ({
        ...x,
        drone: { ...m, arrivedAt: now },
        evidence: [...x.evidence, { id: evId, kind: 'drone_feed', label: { ar: `بث جوي محاكى من ${m.droneId}`, en: `Simulated aerial feed from ${m.droneId}` }, sourceId: m.droneId, t: now, simulated: true }],
        actions: [...x.actions, { t: now, actor: m.droneId, text: { ar: 'وصلت الطائرة (محاكاة) وبدأ البث الجوي', en: 'Drone arrived (simulated); aerial feed started' }, field: false }],
      }));
      s.drones = s.drones.map((d) => (d.id === m.droneId ? { ...d, status: 'on_scene' } : d));
    }
  });
  return s;
}

function stepIncidentStatus(step: ResponderStep): Incident['status'] {
  if (step === 'assigned') return 'assigned';
  if (step === 'resolved') return 'resolved';
  return 'responding';
}
const STEP_TEXT: Record<ResponderStep, L> = {
  assigned: { ar: 'تم التكليف', en: 'Assigned' },
  accepted: { ar: 'قبول التكليف', en: 'Accepted' },
  en_route: { ar: 'في الطريق', en: 'En route' },
  arrived: { ar: 'الوصول إلى الموقع', en: 'Arrived' },
  resolving: { ar: 'اتخاذ الإجراء / قيد المعالجة', en: 'Action taken / resolving' },
  resolved: { ar: 'تمت المعالجة', en: 'Resolved' },
};

export function reducer(s: AppState, a: Action): AppState {
  switch (a.type) {
    case 'TICK': return tick(s, a.now);
    case 'RESET': { const f = initialState(); return { ...f, ai: s.ai }; }
    case 'HYDRATE': return a.state;
    case 'JOURNAL': return applyJournal(s, a.entries);
    case 'AI_EVENT': return applyAiEvent(s, a.ev);
    case 'CPS_NODE_STATUS': return applyCpsNodeStatus(s, a);
    case 'AI_NOTIFY': return applyAiNotify(s, a.eventId, a.results);
    case 'AI_STATUS': {
      const ai = { ...s.ai, ...a.patch };
      if (!a.connection) return { ...s, ai };
      return { ...s, ai, connection: a.connection, lastUpdate: a.connection === 'live' ? s.now : s.lastUpdate };
    }
    case 'AI_CAMERA': {
      let next: AppState = {
        ...s,
        ai: { ...s.ai, cameras: { ...s.ai.cameras, [a.cam.id]: a.cam } },
        analysisRunning: s.baseMode === 'live' ? { ...s.analysisRunning, [a.cam.id]: a.cam.active } : s.analysisRunning,
      };
      // a zone-counting camera without a running source has no live count: show "no data", not a stale number
      const c = s.cameras.find((x) => x.id === a.cam.id);
      // the server's camera capacity is the crowding limit: keep the zone capacity in step
      if (c?.countsZone && a.cam.capacity && zoneById(next, c.zoneId)?.capacity !== a.cam.capacity) {
        next = { ...next, zones: next.zones.map((z) => (z.id === c.zoneId ? { ...z, capacity: a.cam.capacity } : z)) };
      }
      if (s.baseMode === 'live' && c?.countsZone && !a.cam.active && next.occupancy[c.zoneId] != null) {
        const occ = { ...next.occupancy };
        delete occ[c.zoneId];
        next = { ...next, occupancy: occ };
      }
      return next;
    }
    case 'AI_COUNT': return applyCount(s, a.cameraId, a.count, a.at);
    case 'SET_ANALYSIS': return { ...s, analysisRunning: { ...s.analysisRunning, [a.cameraId]: a.on } };
    case 'SCENARIO': {
      if (a.kind === 'crowd_surge') return { ...s, analysisRunning: { ...s.analysisRunning, 'CAM-C': true }, scenario: { ...s.scenario, surgeUntil: s.now + CONFIG.crowdSurgeMs } };
      if (a.kind === 'node_stop') return { ...s, nodes: s.nodes.map((n) => (n.id === 'NODE-A1-04' ? { ...n, heartbeatStopped: true } : n)) };
      if (a.kind === 'node_restore') return { ...s, nodes: s.nodes.map((n) => (n.id === 'NODE-A1-04' ? { ...n, heartbeatStopped: false, heartbeats: [...n.heartbeats, s.now].slice(-40) } : n)) };
      if (a.kind === 'connection_loss') return { ...s, connection: 'reconnecting' };
      if (a.kind === 'connection_restore') return { ...s, connection: s.baseMode, lastUpdate: s.now };
      return s;
    }
    case 'RECORDED_DETECTION': {
      if (s.processedRecordings.includes(a.key)) return s;
      const cap = zoneById(s, a.zoneId)?.capacity ?? undefined;
      const next = createChain(s, {
        category: a.category, zoneId: a.zoneId, sourceKind: 'recorded', sourceId: a.cameraId, t: s.now, fileName: a.fileName,
        peak: a.category === 'crowding' && cap ? cap + 8 : undefined, capacity: a.category === 'crowding' ? cap : undefined, by: a.by,
        evidence: { kind: 'upload', label: { ar: `تسجيل مرفوع: ${a.fileName} (عند ${a.offsetSec} ث)`, en: `Uploaded recording: ${a.fileName} (at ${a.offsetSec}s)` }, sourceId: a.cameraId, t: s.now, simulated: true, mediaUrl: a.mediaUrl, mediaType: a.mediaType },
        location: { ar: `مجال ${s.cameras.find((c) => c.id === a.cameraId)?.label.ar ?? a.cameraId} (تسجيل)`, en: `${s.cameras.find((c) => c.id === a.cameraId)?.label.en ?? a.cameraId} view (recording)` },
        description: { ar: `نتيجة تحليل محاكاة للتسجيل ${a.fileName}. لم يُحلل بنموذج رؤية حاسوبية حقيقي.`, en: `Simulated analysis result for recording ${a.fileName}. Not analyzed by a real computer-vision model.` },
      });
      return { ...next, processedRecordings: [...s.processedRecordings, a.key] };
    }
    case 'MANUAL_REPORT': {
      const seq = { ...s.seq };
      const id = a.kind === 'expo' ? `INC-2026-${pad(seq.inc++, 4)}` : `EI-2026-${pad(seq.ei++, 4)}`;
      const alrId = `ALR-2026-${pad(seq.alr++, 4)}`;
      const z = zoneById(s, a.zoneId);
      const evidence: Evidence[] = a.mediaUrl ? [{ id: `EV-${pad(seq.ev++, 4)}`, kind: 'manual_media', label: same(a.mediaName ?? 'media'), sourceId: a.by, t: s.now, simulated: false, mediaUrl: a.mediaUrl, mediaType: a.mediaType }] : [];
      const inc: Incident = {
        id, kind: a.kind, category: a.category, zoneId: a.zoneId, location: same(a.location), source: 'manual', sourceDeviceId: a.by,
        severity: a.severity, status: 'open', detectedAt: s.now, alertAt: s.now, description: same(a.description), alertId: alrId,
        employeeId: a.employeeId, evidence, actions: [{ t: s.now, actor: a.by, text: { ar: 'تقديم بلاغ يدوي', en: 'Submitted manual report' }, field: false }],
        pos: z?.center ?? null, fixture: false,
      };
      const alert: Alert = {
        id: alrId, kind: a.kind === 'expo' ? 'event' : 'employee', titleKey: 'manual', params: { cat: a.category, zone: a.zoneId },
        severity: a.severity, sourceLabel: `Manual report · ${a.by}`, zoneId: a.zoneId, t: s.now, incidentId: id, employeeId: a.employeeId,
      };
      return { ...s, seq, incidents: [...s.incidents, inc], alerts: [...s.alerts, alert] };
    }
    case 'ASSIGN': {
      const e = employeeById(s, a.employeeId);
      const inc = s.incidents.find((i) => i.id === a.incidentId);
      if (!e || !inc || inc.assignment || e.availability !== 'available') return s;
      const t = s.now;
      const next = updIncident(s, a.incidentId, (i) => ({
        ...i, status: 'assigned',
        assignment: { employeeId: e.id, team: e.team, by: a.by, steps: { assigned: t }, current: 'assigned' },
        actions: [...i.actions, { t, actor: a.by, text: { ar: `تكليف ${e.id} (${e.name.ar} · ${TEAM_NAMES[e.team].ar})`, en: `Assigned ${e.id} (${e.name.en} · ${TEAM_NAMES[e.team].en})` }, field: false }],
      }));
      return {
        ...next,
        employees: next.employees.map((x) => (x.id === e.id ? { ...x, availability: 'responding', activity: [...x.activity, { t, text: { ar: `تكليف بالحادثة ${inc.id}`, en: `Assigned ${inc.id}` }, incidentId: inc.id }] } : x)),
      };
    }
    case 'STEP': {
      const inc = s.incidents.find((i) => i.id === a.incidentId);
      if (!inc?.assignment || (!a.onBehalf && inc.assignment.employeeId !== a.by)) return s;
      if (inc.assignment.steps[a.step] != null) return s;
      const emp = inc.assignment.employeeId;
      const t = s.now;
      const text = a.onBehalf
        ? { ar: `${STEP_TEXT[a.step].ar} (من مركز القيادة نيابة عن ${emp})`, en: `${STEP_TEXT[a.step].en} (by the Command Centre on behalf of ${emp})` }
        : STEP_TEXT[a.step];
      let next = updIncident(s, inc.id, (i) => ({
        ...i, status: stepIncidentStatus(a.step), resolvedAt: a.step === 'resolved' ? t : i.resolvedAt,
        assignment: { ...i.assignment!, current: a.step, steps: { ...i.assignment!.steps, [a.step]: t } },
        actions: [...i.actions, { t, actor: a.by, text, field: !a.onBehalf }],
      }));
      next = {
        ...next,
        employees: next.employees.map((x) => {
          if (x.id !== emp) return x;
          const act = [...x.activity, { t, text, incidentId: inc.id }];
          if (a.step === 'arrived') return { ...x, currentZoneId: inc.zoneId, activity: act };
          if (a.step === 'resolved') return { ...x, availability: 'available', activity: act };
          return { ...x, activity: act };
        }),
      };
      return next;
    }
    case 'FIELD_ACTION': {
      const inc = s.incidents.find((i) => i.id === a.incidentId);
      if (!inc?.assignment || inc.assignment.employeeId !== a.by || !a.text.trim()) return s;
      return updIncident(s, inc.id, (i) => ({ ...i, actions: [...i.actions, { t: s.now, actor: a.by, text: same(a.text.trim()), field: true }] }));
    }
    case 'DRONE_DEPLOY': {
      const d = s.drones.find((x) => x.id === a.droneId);
      const inc = s.incidents.find((i) => i.id === a.incidentId);
      if (!d || d.status !== 'available' || !inc || inc.drone || inc.status === 'closed') return s;
      const next = updIncident(s, inc.id, (i) => ({
        ...i,
        drone: { droneId: d.id, by: a.by, dispatchedAt: s.now, mission: { ar: 'التحقق من الحادثة', en: 'Incident verification' }, targetZoneId: i.zoneId, fixture: false },
        actions: [...i.actions, { t: s.now, actor: a.by, text: { ar: `طلب دعم الطائرة ${d.id} (محاكاة)`, en: `Requested drone ${d.id} support (simulated)` }, field: false }],
      }));
      return { ...next, drones: next.drones.map((x) => (x.id === d.id ? { ...x, status: 'deployed', incidentId: inc.id } : x)) };
    }
    case 'DRONE_END': {
      const inc = s.incidents.find((i) => i.id === a.incidentId);
      if (!inc?.drone || inc.drone.endedAt != null || inc.drone.arrivedAt == null) return s;
      const m = inc.drone;
      const used = Math.max(1, Math.round((s.now - m.dispatchedAt) / 20_000));
      const next = updIncident(s, inc.id, (i) => ({
        ...i, drone: { ...m, endedAt: s.now },
        actions: [...i.actions, { t: s.now, actor: a.by, text: { ar: `إنهاء مهمة الطائرة ${m.droneId}`, en: `Ended drone ${m.droneId} mission` }, field: false }],
      }));
      return { ...next, drones: next.drones.map((d) => (d.id === m.droneId ? { ...d, status: 'available', incidentId: undefined, battery: Math.max(5, d.battery - used) } : d)) };
    }
    case 'SHIFT_START': {
      const t = s.now;
      const busy = (a: string) => a === 'responding' || a === 'on_task';
      return {
        ...s,
        strictMerge: true,
        employees: s.employees.map((e) => (busy(e.availability)
          ? { ...e, availability: 'available', activity: [...e.activity, { t, text: { ar: 'متاح مع بدء تشغيل المنصة', en: 'Available at platform start' } }] }
          : e)),
        drones: s.drones.map((d) => ({ ...d, status: 'available', incidentId: undefined, battery: 100 })),
        incidents: s.incidents.map((i) => (i.drone && i.drone.endedAt == null
          ? { ...i, drone: { ...i.drone, endedAt: t }, actions: [...i.actions, { t, actor: 'SYSTEM', text: { ar: `انتهت مهمة الطائرة ${i.drone.droneId} مع بدء تشغيل المنصة`, en: `Drone ${i.drone.droneId} mission ended at platform start` }, field: false }] }
          : i)),
      };
    }
    case 'COMPLETE': {
      const inc = s.incidents.find((i) => i.id === a.incidentId);
      if (!inc?.assignment || inc.status === 'closed') return s;
      let next = s;
      for (let st = nextStep(inc.assignment.current); st; st = nextStep(st)) {
        next = reducer(next, { type: 'STEP', incidentId: inc.id, step: st, by: a.by, onBehalf: true });
      }
      return reducer(next, { type: 'CLOSE', incidentId: inc.id, by: a.by });
    }
    case 'CLOSE': {
      const inc = s.incidents.find((i) => i.id === a.incidentId);
      if (!inc || inc.status !== 'resolved') return s;
      let next = s;
      if (inc.drone && inc.drone.endedAt == null && inc.drone.arrivedAt != null) next = reducer(next, { type: 'DRONE_END', incidentId: inc.id, by: a.by });
      next = updIncident(next, inc.id, (i) => ({
        ...i, status: 'closed', closedAt: next.now,
        actions: [...i.actions, { t: next.now, actor: a.by, text: { ar: 'إغلاق الحادثة', en: 'Closed the incident' }, field: false }],
      }));
      return { ...next, events: next.events.map((e) => (e.id === inc.eventId && !e.endedAt ? { ...e, endedAt: next.now } : e)) };
    }
  }
  return s;
}

const TEAM_NAMES: Record<string, L> = {
  medical: { ar: 'الكادر الطبي', en: 'Medical Team' }, civil_defense: { ar: 'الدفاع المدني', en: 'Civil Defense' },
  hvac: { ar: 'صيانة التكييف', en: 'HVAC Maintenance' }, organizers: { ar: 'المنظمين', en: 'Organizers' },
  security: { ar: 'الأمن', en: 'Security' },
};

export function suitableCandidates(s: AppState, inc: Incident) {
  const teams = SUITABLE_TEAMS[inc.category] ?? [];
  return s.employees
    .filter((e) => teams.includes(e.team) && e.availability !== 'off_duty' && e.onSite)
    .map((e) => ({ e, distance: inc.zoneId === A11 ? e.distanceM : null }))
    .sort((x, y) => {
      const ax = x.e.availability === 'available' ? 0 : 1;
      const ay = y.e.availability === 'available' ? 0 : 1;
      if (ax !== ay) return ax - ay;
      return (x.distance ?? 1e9) - (y.distance ?? 1e9);
    });
}
