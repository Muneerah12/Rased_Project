import { heartbeatHistoryIsHistorical, parseCpsHeartbeatHistory } from '../src/cps-workspace/readOnlyCps';

let failures = 0;
const ok = (condition: boolean, label: string) => { console.log(`${condition ? 'PASS' : 'FAIL'} ${label}`); if (!condition) failures++; };

const valid = {
  node_id: 'NODE-04', as_of: '2026-10-13T08:00:00Z',
  items: [{ received_at: '2026-10-13T07:59:00Z' }, { received_at: '2026-10-13T07:58:00+00:00' }],
};

ok(parseCpsHeartbeatHistory(valid)?.items.length === 2, 'accepts verified descending heartbeat receipts');
ok(parseCpsHeartbeatHistory({ ...valid, items: [] })?.items.length === 0, 'accepts an empty bounded heartbeat history for the empty state');
ok(parseCpsHeartbeatHistory({ ...valid, items: [{ received_at: '2026-10-13T07:58:00Z' }, { received_at: '2026-10-13T07:59:00Z' }] }) === null, 'rejects ascending heartbeat receipts');
ok(parseCpsHeartbeatHistory({ ...valid, items: [{ received_at: '2026-10-13T07:59:00Z', status: 'ONLINE' }] }) === null, 'rejects unverified heartbeat fields');
ok(heartbeatHistoryIsHistorical('OFFLINE'), 'labels offline heartbeat receipts as historical');
ok(heartbeatHistoryIsHistorical('STALE'), 'labels stale heartbeat receipts as historical');
ok(!heartbeatHistoryIsHistorical('ONLINE'), 'does not label current online state as historical');

if (failures) throw new Error(`${failures} CPS heartbeat history regression test(s) failed`);
