import { clusterPoints } from '../src/ui/cluster';

let failed = 0;
const ok = (c: boolean, m: string) => { console.log(`${c ? 'PASS' : 'FAIL'} ${m}`); if (!c) failed++; };

const p = (id: string, x: number, y: number, severity: 'low' | 'medium' | 'high' | 'critical' = 'medium') => ({ id, x, y, severity });

ok(clusterPoints([], 20).length === 0, 'no points → no clusters');

const near = clusterPoints([p('a', 0, 0), p('b', 5, 5)], 20);
ok(near.length === 1 && near[0].items.length === 2, 'points closer than the radius merge');

const far = clusterPoints([p('a', 0, 0), p('b', 100, 0)], 20);
ok(far.length === 2 && far.every((c) => c.items.length === 1), 'points farther than the radius stay apart');

const same = clusterPoints(['1', '2', '3', '4', '5', '6'].map((id) => p(id, 858, 452)), 20);
ok(same.length === 1 && same[0].items.length === 6, 'six incidents of one camera become one cluster of 6');

const sev = clusterPoints([p('a', 0, 0, 'medium'), p('b', 3, 0, 'critical'), p('c', 6, 0, 'low')], 20);
ok(sev.length === 1 && sev[0].severity === 'critical', 'a cluster takes its most severe item');
ok(sev[0].x === 3 && sev[0].y === 0, 'a cluster sits at its most severe item');
ok(sev[0].items[0].id === 'b', 'the most severe item is listed first');

const a = clusterPoints([p('a', 0, 0), p('b', 10, 0), p('c', 200, 0, 'high')], 20);
const b = clusterPoints([p('c', 200, 0, 'high'), p('b', 10, 0), p('a', 0, 0)], 20);
const sig = (cs: typeof a) => cs.map((c) => c.items.map((i) => i.id).sort().join('+')).sort().join(' | ');
ok(sig(a) === sig(b), 'input order does not change the clusters');
ok(new Set(a.map((c) => c.key)).size === a.length, 'cluster keys are unique');

if (failed) { console.log(`${failed} FAILED`); process.exit(1); } else console.log('ALL PASSED');
