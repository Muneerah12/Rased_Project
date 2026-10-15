import type { Pt } from './types';

/** Ray casting: is `p` inside the polygon? */
export function insidePolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const STEP = 12;                             // map px between neighbouring slots
const GOLDEN = Math.PI * (3 - Math.sqrt(5));  // golden angle: slots fill a disc evenly
const MIN_GAP = 11;                          // a slot this close to a taken spot (or the camera icon) is skipped
const MAX_SLOTS = 200;

/**
 * Where an incident seen by a camera at `origin` goes on the map: the first free slot of a
 * golden-angle spiral around the camera (slot k at STEP·√(k+1) px), pulled towards the zone
 * `center` until it lies inside the zone polygon. `taken` are the spots of the zone's open
 * incidents (any camera), so a spot freed by a closed incident is used again. Depends only on its inputs:
 * every screen replaying the same journal puts each incident at the same spot.
 */
export function spreadPos(origin: Pt, poly: Pt[], center: Pt, taken: Pt[]): Pt {
  const far = (p: Pt, q: Pt) => Math.hypot(p[0] - q[0], p[1] - q[1]) >= MIN_GAP;
  let last: Pt = origin;
  for (let k = 0; k < MAX_SLOTS; k++) {
    const r = STEP * Math.sqrt(k + 1);
    let p: Pt = [origin[0] + r * Math.cos(k * GOLDEN), origin[1] + r * Math.sin(k * GOLDEN)];
    for (let i = 0; i < 12 && poly.length >= 3 && !insidePolygon(p, poly); i++) p = [p[0] + (center[0] - p[0]) * 0.2, p[1] + (center[1] - p[1]) * 0.2];
    p = [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10];
    last = p;
    if (far(p, origin) && taken.every((t) => far(p, t))) return p;
  }
  return last;
}

/**
 * Map spot of a new incident in `zone`: around its camera when the camera belongs to that zone,
 * otherwise (an older incident of a camera since moved, or no camera) around the zone centre.
 */
export function incidentSpot(cam: { pos?: Pt | null; zoneId: string } | undefined, zone: { id: string; polygon: Pt[]; center: Pt }, taken: Pt[]): Pt {
  const origin = cam?.pos && cam.zoneId === zone.id ? cam.pos : zone.center;
  return spreadPos(origin, zone.polygon, zone.center, taken);
}
