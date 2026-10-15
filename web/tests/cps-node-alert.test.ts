import { reducer } from '../src/model/reducer.ts';
import { initialState } from '../src/model/fixtures.ts';
import { alertStatus } from '../src/model/selectors.ts';

let failures = 0;
const ok = (condition: boolean, label: string) => { if (!condition) { failures += 1; console.error(`FAIL ${label}`); } };

const t0 = 1_800_000_000_000;
let s = { ...initialState(), now: t0 };
const base = s.alerts.length;
const offline = { type: 'CPS_NODE_STATUS', node_id: 'NODE-04', status: 'OFFLINE', reason: 'NODE_OFFLINE', location_id: 'A1-1', last_heartbeat_received_at: null } as const;

s = reducer(s, offline);
const alert = s.alerts[s.alerts.length - 1];
ok(s.alerts.length === base + 1 && alert.titleKey === 'node_offline' && alert.params.node === 'NODE-04' && alert.zoneId === 'A1.1' && alert.severity === 'high', 'OFFLINE raises one high-severity node alert in zone A1.1');
ok(alertStatus(s, alert) === 'active', 'the alert is active');
const inc = s.incidents.find((i) => i.id === alert.incidentId)!;
ok(!!inc && inc.category === 'node_offline' && inc.source === 'iot_sensor' && inc.sourceDeviceId === 'NODE-04' && inc.status === 'open' && inc.alertId === alert.id, 'OFFLINE also opens an IoT Sensor incident linked to the alert');
s = reducer({ ...s, now: t0 + 10_000 }, offline);
ok(s.alerts.length === base + 1, 'a repeated OFFLINE does not duplicate the alert');
s = reducer({ ...s, now: t0 + 60_000 }, { type: 'CPS_NODE_STATUS', node_id: 'NODE-04', status: 'ONLINE' });
const cleared = s.alerts.find((a) => a.id === alert.id)!;
ok(cleared.clearedAt === t0 + 60_000 && alertStatus(s, cleared) === 'cleared', 'ONLINE clears it');
ok(s.incidents.find((i) => i.id === inc.id)!.status === 'resolved', 'ONLINE resolves the incident');
s = reducer({ ...s, now: t0 + 120_000 }, offline);
ok(s.alerts.length === base + 2, 'a new outage raises a new alert');

if (failures) process.exit(1);
console.log('CPS node alert tests passed');
