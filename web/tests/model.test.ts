import { initialState } from '../src/model/fixtures';
import { reducer } from '../src/model/reducer';
import { scopeStats, alertStatus, responseTimeMs, timelineOrderValid, sensorHealth, nodeOnline, findNode, permitStatus } from '../src/model/selectors';
import { fmtDuration, SIM_START } from '../src/model/config';
import type { AppState } from '../src/model/types';
let fails = 0;
const ok = (c: boolean, m: string) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
let s: AppState = initialState();
const st = scopeStats(s, 'A1.1');
ok(st.people === 138 && st.crowd === 'medium', `A1.1 138/150 Medium (${st.people} ${st.crowd})`);
ok(st.employeesPresent === 10, `10 employees present (8 + 2 security) (${st.employeesPresent})`);
ok(st.cameras[0] === 1 && st.cameras[1] === 1 && st.sensors[0] === 2 && st.sensors[1] === 4, `A1.1: the central camera only (the others are spread over the site) / BME280 2 of 4 online (${st.cameras} ${st.sensors})`);
ok(scopeStats(s, 'ALL').cameras.join() === '7,7', `site-wide: 7 camera sources (4 job cameras + central + threat + thermal) (${scopeStats(s, 'ALL').cameras})`);
ok(s.sensors.every((x) => x.model === 'BME280'), 'all sensors are BME280');
ok(s.cameras.map((c) => c.id).join() === 'CAM-1,CAM-2,CAM-3,CAM-4,CAM-C,CAM-TH,CAM-T1' && s.cameras.filter((c) => c.central && c.countsZone).length === 1 && s.cameras.filter((c) => c.countsZone).length === 1 && s.cameras.filter((c) => c.thermal).length === 1, 'four job cameras + the central counting camera + threat camera + thermal camera');
ok(st.openIncidents === 1, `A1.1 open incidents 1 (${st.openIncidents})`);
const all = scopeStats(s, 'ALL');
ok(all.nodes[1] === 2 && all.nodes[0] === 1, `nodes 1 online of 2 (${all.nodes})`);
ok(all.sensors[1] === 4 && all.sensors[0] === 2 && s.sensors.filter(x => sensorHealth(s, x) === 'offline').length === 2, `sensors 2 online / 2 offline (${all.sensors})`);
ok(s.sensors.length === new Set(s.sensors.map(x => x.id)).size, 'sensor ids unique');
const fall = s.incidents.find(i => i.id === 'INC-2026-0142')!;
ok(fmtDuration(responseTimeMs(fall)!, 'en') === '1m 54s', `fall response time ${fmtDuration(responseTimeMs(fall)!, 'en')}`);
ok(timelineOrderValid(fall), 'fall timeline order valid');
ok(fall.drone!.endedAt! - fall.drone!.dispatchedAt === 260000, 'drone 4m20s');
// run 5s
const run = (secs: number) => { for (let i = 0; i < secs; i++) s = reducer(s, { type: 'TICK', now: s.now + 1000 }); };
run(5);
ok(findNode(s, 'A1-N04')?.id === 'NODE-A1-04', 'alias resolves to canonical node');
// surge
s = reducer(s, { type: 'SCENARIO', kind: 'crowd_surge' });
run(15);
const st2 = scopeStats(s, 'A1.1');
const crowdInc = s.incidents.filter(i => i.category === 'crowding');
ok(st2.people! > 150 && st2.crowd === 'crowded', `surge crowded (${st2.people})`);
ok(crowdInc.length === 1, `exactly 1 crowd incident after many frames (${crowdInc.length})`);
ok(s.events.filter(e => e.category === 'crowding').length === 1, 'exactly 1 crowd event');
const ci = crowdInc[0];
const alr = s.alerts.find(a => a.id === ci.alertId)!;
ok(Number(alr.params.count) > 150, `alert count ${alr.params.count}/150`);
ok(scopeStats(s, 'A1.1').openIncidents === 2, 'open incidents now 2');
// assign E014
s = reducer(s, { type: 'ASSIGN', incidentId: ci.id, employeeId: 'E014', by: 'OP-01' });
ok(s.employees.find(e => e.id === 'E014')!.availability === 'responding', 'E014 responding');
ok(alertStatus(s, s.alerts.find(a => a.id === ci.alertId)!) === 'in_response', 'alert in response');
for (const step of ['accepted', 'en_route', 'arrived', 'resolving', 'resolved'] as const) { run(3); s = reducer(s, { type: 'STEP', incidentId: ci.id, step, by: 'E014' }); }
// wrong user cannot step
const before = s; s = reducer(s, { type: 'STEP', incidentId: 'INC-2026-0143', step: 'arrived', by: 'E014' }); ok(s === before, 'non-assigned responder blocked');
let inc = s.incidents.find(i => i.id === ci.id)!;
ok(inc.status === 'resolved' && timelineOrderValid(inc), 'resolved, order valid');
// drone before close
s = reducer(s, { type: 'DRONE_DEPLOY', incidentId: ci.id, droneId: 'D-01', by: 'OP-01' });
run(11);
inc = s.incidents.find(i => i.id === ci.id)!;
ok(inc.drone?.arrivedAt != null && inc.evidence.some(e => e.kind === 'drone_feed'), 'drone arrived + evidence');
s = reducer(s, { type: 'CLOSE', incidentId: ci.id, by: 'OP-01' });
inc = s.incidents.find(i => i.id === ci.id)!;
ok(inc.status === 'closed' && inc.drone?.endedAt != null, 'closed; drone ended');
ok(s.employees.find(e => e.id === 'E014')!.availability === 'available', 'E014 available');
// node heartbeat: initially offline with an active alert; restore then stop again
ok(s.alerts.some(a => a.nodeId === 'NODE-A1-04' && alertStatus(s, a) === 'active'), 'A1-N04 offline alert active from the start');
const frozen = JSON.stringify(s.sensors.find(x => x.id === 'BME-A1-03')!.readings.slice(-1));
s = reducer(s, { type: 'SCENARIO', kind: 'node_restore' }); run(12);
ok(s.alerts.some(a => a.nodeId === 'NODE-A1-04' && alertStatus(s, a) === 'cleared'), 'node alert cleared after restore');
ok(scopeStats(s, 'A1.1').sensors[0] === 3, 'BME-A1-04 back online via its node (3/4)');
ok(JSON.stringify(s.sensors.find(x => x.id === 'BME-A1-03')!.readings.slice(-1)) === frozen, 'offline BME-A1-03 keeps last known values');
s = reducer(s, { type: 'SCENARIO', kind: 'node_stop' });
run(36);
const n4 = findNode(s, 'NODE-A1-04')!;
ok(!nodeOnline(s, n4), 'N04 offline after 30s');
ok(s.alerts.some(a => a.nodeId === 'NODE-A1-04' && alertStatus(s, a) === 'active'), 'new node offline alert active');
ok(scopeStats(s, 'A1.1').sensors[0] === 2, 'A1.1 sensors back to 2/4');
// manual report
s = reducer(s, { type: 'MANUAL_REPORT', kind: 'expo', category: 'obstruction', zoneId: 'A1.1', location: 'Gate', severity: 'medium', description: 'Cart blocking', by: 'OP-01' });
ok(s.incidents.some(i => i.source === 'manual' && i.category === 'obstruction'), 'manual incident created');
// reconnecting doesn't mark offline
s = reducer(s, { type: 'SCENARIO', kind: 'connection_loss' }); run(60);
ok(nodeOnline(s, findNode(s, 'NODE-A1-01')!), 'reconnecting: nodes not falsely offline');
const e16 = s.employees.find(e => e.id === 'E016')!;
ok(permitStatus(s, e16.permits[0]) === 'active' || s.now > e16.permits[0].validUntil, 'permit status derived from time');
ok(permitStatus(s, s.employees.find(e => e.id === 'E021')!.permits[0]) === 'expired', 'E021 permit expired');
// operator authority: accept on behalf, then complete the whole incident
s = reducer(s, { type: "MANUAL_REPORT", kind: "expo", category: "crowding", zoneId: "A1.1", location: "Gate", severity: "medium", description: "test", by: "OP-01" });
const mi = s.incidents[s.incidents.length - 1];
s = reducer(s, { type: "ASSIGN", incidentId: mi.id, employeeId: "E007", by: "OP-01" });
s = reducer(s, { type: "STEP", incidentId: mi.id, step: "accepted", by: "OP-01", onBehalf: true });
ok(s.incidents.find(i => i.id === mi.id)!.assignment!.current === "accepted", "operator accepted on behalf of E007");
run(2);
s = reducer(s, { type: "COMPLETE", incidentId: mi.id, by: "OP-01" });
const done = s.incidents.find(i => i.id === mi.id)!;
ok(done.status === "closed" && done.assignment!.steps.resolved != null && timelineOrderValid(done), "operator completed and closed the incident");
ok(s.employees.find(e => e.id === "E007")!.availability === "available", "E007 available after operator completion");
console.log(fails ? `${fails} FAILED` : 'ALL PASSED', 'elapsed', (s.now - SIM_START) / 1000);
