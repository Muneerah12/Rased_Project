import { demoCpsResponse } from '../src/services/demoCps';
import { parseCpsNodeState, parseCpsHeartbeatHistory } from '../src/services/cps';
import { parseCpsReadingHistory } from '../src/cps-workspace/readOnlyCps';
import { parseOperationalHvacRecommendation } from '../src/services/operationalHvac';

let failures = 0;
const ok = (condition: boolean, label: string) => { console.log(`${condition ? 'PASS' : 'FAIL'} ${label}`); if (!condition) failures++; };

const now = Date.parse('2026-10-16T09:30:04.250Z');

const state = parseCpsNodeState(demoCpsResponse('/api/cps/node-state', now));
ok(!!state, 'demo node state passes the strict NODE-04 parser');
ok(state?.connection_status === 'ONLINE', 'demo node is online');
ok(!!state && now - Date.parse(state.last_heartbeat_received_at ?? '') <= 10_000, 'demo heartbeat is at most 10 s old');
ok(!!state && ['temperature', 'humidity', 'pressure'].every((kind) => state.readings.some((reading) => reading.sensor_type === kind)), 'demo state carries all three sensors');
ok(!!state && state.network_observation.reported_ip === null && state.network_observation.reported_mac === null && state.network_observation.reported_ssid === null, 'demo state exposes no network identifiers');

const beats = parseCpsHeartbeatHistory(demoCpsResponse('/api/cps/node-heartbeats', now));
ok(beats?.items.length === 50, 'demo heartbeat history passes the parser with 50 receipts');

const start = '2026-10-16T08:30:04.250Z';
const end = '2026-10-16T09:30:04.250Z';
const page1 = parseCpsReadingHistory(demoCpsResponse(`/api/cps/node-readings?sensor_id=TEMP-01&start=${start}&end=${end}&limit=200`, now));
ok(page1?.items.length === 200 && !!page1.next_cursor, 'demo history fills a 200-reading page with a cursor');
const page2 = parseCpsReadingHistory(demoCpsResponse(`/api/cps/node-readings?sensor_id=TEMP-01&start=${start}&end=${end}&limit=200&cursor=${page1?.next_cursor}`, now));
ok(!!page1 && !!page2 && Date.parse(page2.items[0].timestamp) < Date.parse(page1.items.at(-1)!.timestamp), 'the next page continues strictly before the previous one');
ok(!!page2 && page2.items.every((item) => Date.parse(item.timestamp) >= Date.parse(start)), 'paged history stays inside the requested window');
const last = parseCpsReadingHistory(demoCpsResponse(`/api/cps/node-readings?sensor_id=HUM-01&start=2026-10-16T09:25:00Z&end=${end}&limit=200`, now));
ok(!!last && last.items.length === 30 && last.next_cursor === null, 'a short window returns every reading and no cursor');
ok(demoCpsResponse('/api/cps/node-readings?sensor_id=CO2-01&start=2026-10-16T09:25:00Z&end=2026-10-16T09:30:00Z&limit=5', now) === null, 'an unknown sensor is not answered by the demo');

const hvac = parseOperationalHvacRecommendation(demoCpsResponse('/api/operational/hvac/recommendation', now));
ok(!!hvac, 'demo HVAC recommendation passes the strict monitor-only parser');
ok(!!hvac && hvac.evaluation.status !== 'INSUFFICIENT_EVIDENCE' && hvac.evaluation.evidence_issues.length === 0, 'demo HVAC evidence is complete');

ok(demoCpsResponse('/api/cameras', now) === null && demoCpsResponse('/api/detect', now) === null, 'other server routes are left to the real server');
ok(JSON.stringify(demoCpsResponse('/api/cps/node-state', now)) === JSON.stringify(demoCpsResponse('/api/cps/node-state', now)), 'the same instant always gives the same demo data');

if (failures) { console.error(`${failures} demo CPS test(s) failed`); process.exit(1); }
console.log('demo CPS tests passed');
