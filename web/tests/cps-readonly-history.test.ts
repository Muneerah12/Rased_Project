import { fetchCpsWorkspaceReadings } from '../src/cps-workspace/readOnlyCps';

let failures = 0;
const ok = (condition: boolean, label: string) => { console.log(`${condition ? 'PASS' : 'FAIL'} ${label}`); if (!condition) failures++; };

const start = '2026-10-12T09:00:00.000Z';
const end = '2026-10-12T10:00:00.000Z';
const payload = (responseStart: string, responseEnd: string) => ({
  node_id: 'NODE-04', sensor_id: 'TEMP-01', sensor_type: 'temperature', start: responseStart, end: responseEnd,
  as_of: '2026-10-12T10:00:05+00:00', items: [{ sensor_id: 'TEMP-01', sensor_type: 'temperature', value: 24.5, unit: 'C', timestamp: '2026-10-12T09:30:00+00:00', validation_status: 'NORMAL' }], next_cursor: null,
});

const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = (async () => new Response(JSON.stringify(payload('2026-10-12T09:00:00+00:00', '2026-10-12T10:00:00+00:00')), { status: 200 })) as typeof fetch;
  const equivalent = await fetchCpsWorkspaceReadings({ sensorId: 'TEMP-01', start, end });
  ok(equivalent.items.length === 1, 'accepts equivalent Z and +00:00 range boundaries');

  globalThis.fetch = (async () => new Response(JSON.stringify(payload('2026-10-12T08:59:59+00:00', '2026-10-12T10:00:00+00:00')), { status: 200 })) as typeof fetch;
  await fetchCpsWorkspaceReadings({ sensorId: 'TEMP-01', start, end }).then(() => ok(false, 'rejects genuinely mismatched range boundaries')).catch(() => ok(true, 'rejects genuinely mismatched range boundaries'));
} finally {
  globalThis.fetch = originalFetch;
}

if (failures) throw new Error(`${failures} CPS read-only history regression test(s) failed`);
