import { incidentSpot, insidePolygon, spreadPos } from '../src/model/geo';
import { initialState } from '../src/model/fixtures';
import type { Pt } from '../src/model/types';

let failed = 0;
const ok = (c: boolean, m: string) => { console.log(`${c ? 'PASS' : 'FAIL'} ${m}`); if (!c) failed++; };

// zone A1.1 and two of its cameras (fixtures)
const A11: Pt[] = [[771, 457], [794, 445], [828, 441], [864, 456], [888, 469], [886, 488], [852, 490], [812, 490], [788, 484], [776, 472]];
const CENTER: Pt = [830, 468];
const THREAT_CAM: Pt = [858, 452];
const FIRE_CAM: Pt = [784, 461];

ok(insidePolygon(CENTER, A11), 'zone centre is inside A1.1');
ok(!insidePolygon([700, 400], A11), 'a far point is outside A1.1');

for (const [name, cam] of [['threat camera', THREAT_CAM], ['fire camera (near the edge)', FIRE_CAM]] as const) {
  const placed: Pt[] = [];
  for (let n = 0; n < 12; n++) placed.push(spreadPos(cam, A11, CENTER, placed));
  ok(placed.every((p) => insidePolygon(p, A11)), `${name}: every incident is inside A1.1`);
  const minGap = Math.min(...placed.flatMap((a, i) => placed.slice(i + 1).map((b) => Math.hypot(a[0] - b[0], a[1] - b[1]))));
  ok(minGap >= 10, `${name}: no two incidents share a spot (closest ${minGap.toFixed(1)} px)`);
  ok(placed.every((p) => Math.hypot(p[0] - cam[0], p[1] - cam[1]) > 2), `${name}: no incident sits on the camera icon itself`);
}

const a = spreadPos(THREAT_CAM, A11, CENTER, []);
const b = spreadPos(THREAT_CAM, A11, CENTER, []);
ok(a[0] === b[0] && a[1] === b[1], 'same input → same position (all screens agree)');

const first = spreadPos(THREAT_CAM, A11, CENTER, []);
const reused = spreadPos(THREAT_CAM, A11, CENTER, [spreadPos(THREAT_CAM, A11, CENTER, [first])]);
ok(reused[0] === first[0] && reused[1] === first[1], 'a slot freed by a closed incident is used again');

// both cameras together: 14 open incidents in one zone, none on top of another
const all: Pt[] = [];
for (let n = 0; n < 7; n++) { all.push(spreadPos(THREAT_CAM, A11, CENTER, all)); all.push(spreadPos(FIRE_CAM, A11, CENTER, all)); }
const gapAll = Math.min(...all.flatMap((a, i) => all.slice(i + 1).map((b) => Math.hypot(a[0] - b[0], a[1] - b[1]))));
ok(all.every((p) => insidePolygon(p, A11)) && gapAll >= 10, `two cameras, 14 incidents: all inside, closest ${gapAll.toFixed(1)} px`);

// cameras spread over the site: an incident goes to its camera's zone; old A1.1 incidents stay in A1.1
const st = initialState();
const zone = (id: string) => st.zones.find((z) => z.id === id)!;
const cam = (id: string) => st.cameras.find((c) => c.id === id)!;
const homes: Record<string, string> = { 'CAM-1': 'D2', 'CAM-2': 'D3', 'CAM-3': 'D4', 'CAM-4': 'D5', 'CAM-T1': 'D5', 'CAM-TH': 'A1', 'CAM-C': 'A1.1' };
for (const [id, home] of Object.entries(homes)) {
  const c = cam(id);
  ok(c.zoneId === home && !!c.pos && insidePolygon(c.pos, zone(home).polygon), `${id} sits in ${home}`);
  const spot = incidentSpot(c, zone(home), []);
  ok(insidePolygon(spot, zone(home).polygon), `${id}: a new incident lands in ${home}`);
}
ok(!insidePolygon(cam('CAM-TH').pos!, zone('A1.1').polygon), 'the threat camera is in A1 but outside A1.1');
const old = incidentSpot(cam('CAM-1'), zone('A1.1'), []);
ok(insidePolygon(old, zone('A1.1').polygon), 'an old A1.1 incident of a camera that moved stays inside A1.1');

if (failed) { console.log(`${failed} FAILED`); process.exit(1); } else console.log('ALL PASSED');
