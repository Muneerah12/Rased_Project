// Checks the live-AI path of the reducer: journal → event/alert/incident, notifications,
// re-detection merge, and that two screens replaying the same journal agree exactly.
import { initialState } from '../src/model/fixtures';
import { reducer } from '../src/model/reducer';
import type { JournalEntry, ServerEvent } from '../src/model/reducer';
import type { AppState } from '../src/model/types';
import { setTimeBase } from '../src/model/config';

let fails = 0;
const ok = (c: boolean, m: string) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

const base = Date.UTC(2026, 9, 1, 8, 0, 0);
setTimeBase(base);
const live = (): AppState => ({ ...initialState(), connection: 'live', baseMode: 'live', occupancy: {}, occupancyUpdatedAt: {}, analysisRunning: {} });

const ev = (id: string, phase: ServerEvent['phase'], cat: ServerEvent['category'], t: number, extra: Partial<ServerEvent> = {}): ServerEvent => ({
  id, phase, camera_id: 'CAM-2', zone_id: 'A1.1', category: cat, source: 'live', started_at: t, last_seen: t, ended_at: phase === 'end' ? t + 9000 : null,
  peak_score: 0.87, peak_count: null, capacity: null, labels: cat === 'fire_smoke' ? ['fire', 'smoke'] : ['fall'], team: 'civil_defense',
  snapshot_url: `/api/snapshots/${id}.jpg`, video_url: null, file_name: null, offset_sec: null, models: ['YOLOv8n fire/smoke (D-Fire)'], ...extra,
});
let seq = 0;
const J = (at: number, action: any): JournalEntry => ({ seq: ++seq, at, action });

const t0 = base + 60_000;
const journal: JournalEntry[] = [
  J(t0, { type: 'AI_EVENT', ev: ev('AIE-1', 'start', 'fire_smoke', t0) }),
  J(t0 + 300, { type: 'AI_NOTIFY', eventId: 'AIE-1', results: [
    { channel: 'dashboard', team: 'civil_defense', ok: true, detail: 'ok', t: t0 + 300 },
    { channel: 'telegram', team: 'civil_defense', target: 'chat 1', ok: true, detail: 'sent', t: t0 + 300 },
  ] }),
  J(t0 + 10_000, { type: 'AI_EVENT', ev: ev('AIE-1', 'end', 'fire_smoke', t0) }),
  // re-detection while the incident is still open → no second incident
  J(t0 + 40_000, { type: 'AI_EVENT', ev: ev('AIE-2', 'start', 'fire_smoke', t0 + 40_000) }),
  J(t0 + 50_000, { type: 'AI_EVENT', ev: ev('AIE-3', 'start', 'fall', t0 + 50_000, { team: 'medical' }) }),
  J(t0 + 60_000, { type: 'ASSIGN', incidentId: 'INC-2026-0145', employeeId: 'E014', by: 'OP-01' }),
  J(t0 + 70_000, { type: 'STEP', incidentId: 'INC-2026-0145', step: 'accepted', by: 'E014' }),
];

let a = reducer(live(), { type: 'JOURNAL', entries: journal });
const fireInc = a.incidents.find((i) => i.id === 'INC-2026-0144')!;
ok(!!fireInc && fireInc.category === 'fire_smoke' && fireInc.source === 'ai_camera', 'AI fire event → INC-2026-0144');
ok(fireInc.severity === 'critical', 'fire label → critical severity');
ok(fireInc.evidence[0].mediaUrl === '/api/snapshots/AIE-1.jpg' && !fireInc.evidence[0].simulated, 'snapshot evidence, not simulated');
ok(a.alerts.some((x) => x.id === fireInc.alertId && x.titleKey === 'fire'), 'fire alert created');
ok((fireInc.notifications ?? []).length === 2 && fireInc.actions.some((x) => x.actor === 'NOTIFY'), 'notifications recorded on incident');
ok(a.events.find((e) => e.aiId === 'AIE-1')!.endedAt != null, 'event end applied');
ok(a.incidents.filter((i) => i.category === 'fire_smoke' && i.source === 'ai_camera' && !i.fixture).length === 1, 're-detection merged into open incident');
ok(fireInc.evidence.length === 2 && fireInc.actions.some((x) => x.text.en.startsWith('AI re-detection')), 're-detection evidence + action appended');
const fall = a.incidents.find((i) => i.id === 'INC-2026-0145')!;
ok(fall?.category === 'fall' && fall.assignment?.employeeId === 'E014' && fall.assignment.current === 'accepted', 'relayed ASSIGN/STEP applied in order');
ok(fall.assignment!.steps.assigned === t0 + 60_000, 'action uses the journal timestamp');
ok(a.journalSeq === journal.length, 'journalSeq advanced');

// a second screen joining later, receiving the journal in two parts, must match exactly
let b = reducer(live(), { type: 'JOURNAL', entries: journal.slice(0, 3) });
for (let i = 0; i < 5; i++) b = reducer(b, { type: 'TICK', now: t0 + 20_000 + i * 1000 });
b = reducer(b, { type: 'JOURNAL', entries: journal });
const pick = (s: AppState) => JSON.stringify(s.incidents.map((i) => [i.id, i.status, i.evidence.map((e) => e.id), i.assignment?.current]));
ok(pick(a) === pick(b), 'two screens agree on incidents, IDs and evidence');
ok(reducer(b, { type: 'JOURNAL', entries: journal }) .journalSeq === b.journalSeq, 'duplicate entries ignored');

// live count drives occupancy; no simulated occupancy in live mode
let c = reducer(live(), { type: 'AI_COUNT', cameraId: 'CAM-C', count: 12, at: t0 });
for (let i = 0; i < 5; i++) c = reducer(c, { type: 'TICK', now: t0 + i * 1000 });
ok(c.occupancy['A1.1'] === 12, `occupancy from AI count (${c.occupancy['A1.1']})`);
c = reducer(c, { type: 'AI_CAMERA', cam: { id: 'CAM-C', source: 'none', active: false, fps: 0, people: null, peopleSmoothed: null, alerts: [], inferMs: null, error: '', streamUrl: '', models: [], direction: 'down', capacity: 40, autostart: false } });
ok(c.occupancy['A1.1'] == null, 'no stale count when the source stops');
ok(c.zones.find((z) => z.id === 'A1.1')!.capacity === 40, 'server capacity synced to zone');

// crowding event carries count/capacity into the alert
const d = reducer(live(), { type: 'AI_EVENT', ev: { ...ev('AIE-9', 'start', 'crowding', t0), camera_id: 'CAM-C', peak_count: 55, capacity: 51, labels: ['people'] } });
const cAlert = d.alerts.find((x) => x.titleKey === 'crowd_limit' && x.params.count === 55);
ok(!!cAlert, 'crowding alert with count 55/51');


// new detections become new incidents unless they are clearly the same occurrence
const count = (st: AppState, cat: string) => st.incidents.filter((i) => i.category === cat && i.source === 'ai_camera' && !i.fixture).length;
let st2 = reducer(live(), { type: 'JOURNAL', entries: journal });
st2 = reducer(st2, { type: 'JOURNAL', entries: [J(t0 + 4 * 60_000, { type: 'SHIFT_START' })] }); // platform (re)start with the current rules
const fallsBefore = count(st2, 'fall');
const t1 = t0 + 5 * 60_000;
// the fall incident INC-2026-0145 is assigned → a new fall detection is a NEW incident
st2 = reducer(st2, { type: 'JOURNAL', entries: [J(t1, { type: 'AI_EVENT', ev: ev('AIE-4', 'start', 'fall', t1, { team: 'medical' }) })] });
ok(count(st2, 'fall') === fallsBefore + 1, 'fall detected while the previous fall is assigned → new incident');
// the fire incident is still unassigned but was last seen minutes ago → new incident
const firesBefore = count(st2, 'fire_smoke');
const t2 = t1 + 60_000;
st2 = reducer(st2, { type: 'JOURNAL', entries: [J(t2, { type: 'AI_EVENT', ev: ev('AIE-5', 'start', 'fire_smoke', t2) })] });
ok(count(st2, 'fire_smoke') === firesBefore + 1, 'fire detected minutes after the last one → new incident');
// …but a repeat within a minute of that one, still unassigned, is merged
st2 = reducer(st2, { type: 'JOURNAL', entries: [J(t2 + 20_000, { type: 'AI_EVENT', ev: ev('AIE-6', 'start', 'fire_smoke', t2 + 20_000) })] });
ok(count(st2, 'fire_smoke') === firesBefore + 1, 'repeat within a minute (unassigned) → merged, no duplicate');
const newest = st2.incidents.filter((i) => i.category === 'fall' && !i.fixture).sort((x, y) => y.detectedAt - x.detectedAt)[0];
ok(newest.status === 'open' && !newest.assignment, 'new incident is open and can be assigned');

// platform start: staff and drones available again, active drone missions ended
// (assign E014 again so there is someone to release)
st2 = reducer(st2, { type: 'JOURNAL', entries: [J(t2 + 25_000, { type: 'ASSIGN', incidentId: st2.incidents.filter((i) => i.category === 'fire_smoke' && !i.fixture).sort((x, y) => y.detectedAt - x.detectedAt)[0].id, employeeId: 'E014', by: 'OP-01' })] });
st2 = reducer(st2, { type: 'JOURNAL', entries: [J(t2 + 30_000, { type: 'DRONE_DEPLOY', incidentId: newest.id, droneId: 'D-01', by: 'OP-01' })] });
ok(st2.drones.find((d) => d.id === 'D-01')!.status === 'deployed', 'drone D-01 deployed');
ok(st2.employees.find((e) => e.id === 'E014')!.availability === 'responding', 'E014 responding before restart');
st2 = reducer(st2, { type: 'JOURNAL', entries: [J(t2 + 60_000, { type: 'SHIFT_START' })] });
ok(st2.employees.every((e) => e.availability !== 'responding' && e.availability !== 'on_task'), 'shift start: no employee left responding / on task');
ok(st2.employees.find((e) => e.id === 'E014')!.availability === 'available', 'E014 available after restart');
ok(st2.drones.every((d) => d.status === 'available'), 'shift start: all drones available');
ok(st2.incidents.find((i) => i.id === newest.id)!.drone?.endedAt != null, 'active drone mission ended at shift start');
for (let i = 1; i <= 3; i++) st2 = reducer(st2, { type: 'TICK', now: t2 + 60_000 + i * 30_000 });
ok(st2.drones.every((d) => d.status === 'available'), 'ended mission does not bring the drone back on later ticks');
st2 = reducer(st2, { type: 'JOURNAL', entries: [J(t2 + 70_000, { type: 'ASSIGN', incidentId: newest.id, employeeId: 'E009', by: 'OP-01' })] });
ok(st2.incidents.find((i) => i.id === newest.id)!.assignment?.employeeId === 'E009', 'new incident can be assigned after restart');
// cameras spread over the site: each live incident is placed inside its camera's zone
{
  const { insidePolygon } = await import('../src/model/geo');
  let sp = live();
  const zoneOf = (id: string) => sp.zones.find((z) => z.id === id)!;
  const cases: [string, string, ServerEvent['category']][] = [['CAM-1', 'D2', 'fire_smoke'], ['CAM-2', 'D3', 'fall'], ['CAM-3', 'D4', 'wrong_way'], ['CAM-TH', 'A1', 'gunshot' as ServerEvent['category']], ['CAM-1', 'A1.1', 'fall']];
  cases.forEach(([cam, zone, cat], k) => { sp = reducer(sp, { type: 'AI_EVENT', ev: ev(`AIE-SP${k}`, 'start', cat, t0 + 500_000 + k * 1000, { camera_id: cam, zone_id: zone }) }); });
  const placed = sp.incidents.filter((i) => !i.fixture).slice(-cases.length);
  cases.forEach(([cam, zone], k) => {
    const inc = placed[k];
    ok(!!inc && inc.zoneId === zone && !!inc.pos && insidePolygon(inc.pos, zoneOf(zone).polygon), `${cam} → incident inside ${zone}${k === 4 ? ' (an older A1.1 event of a camera since moved)' : ''}`);
  });
}

console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
if (fails) process.exit(1);
