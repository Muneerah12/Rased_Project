// Crowd heat map over a live camera picture: where people stood over the last few seconds.
// Built from the person boxes the server returns for each analyzed frame; drawn on the same canvas
// as the picture, so it lines up with the boxes. Blue = few people, yellow → red = dense.
import type { Det } from '../services/ai';

const GW = 64; // grid cells across (height follows the frame aspect)
const DECAY = 0.86; // per analyzed frame: older positions fade within ~5–10 s
const FULL = 3.5; // grid value drawn as fully "hot"

interface Heat { grid: Float32Array; gw: number; gh: number; last: unknown; img: HTMLCanvasElement }
const maps = new Map<string, Heat>();
const off = new Set<string>();

export const heatOn = (cameraId: string) => !off.has(cameraId);
export function toggleHeat(cameraId: string) { if (off.has(cameraId)) off.delete(cameraId); else off.add(cameraId); }

/** Person boxes from any detector that sees people (count, walking direction). */
function isPerson(d: Det): boolean {
  const m = String(d.model ?? '');
  return m === 'people' || m === 'ok_way' || m === 'wrong_way' || m === 'tracking' || String(d.label).toLowerCase() === 'person';
}

/** Fold one analyzed frame into the camera's heat grid (once per frame). */
export function updateHeat(cameraId: string, frame: { detections?: Det[]; frameSize?: [number, number] }) {
  if (!frame.detections || !frame.frameSize) return;
  const [fw, fh] = frame.frameSize;
  const gh = Math.max(4, Math.round((GW * fh) / fw));
  let h = maps.get(cameraId);
  if (!h || h.gh !== gh) {
    const img = document.createElement('canvas');
    img.width = GW; img.height = gh;
    h = { grid: new Float32Array(GW * gh), gw: GW, gh, last: null, img };
    maps.set(cameraId, h);
  }
  if (h.last === frame) return;
  h.last = frame;
  const g = h.grid;
  for (let i = 0; i < g.length; i++) g[i] *= DECAY;
  for (const d of frame.detections) {
    if (!isPerson(d)) continue;
    const [x1, y1, x2, y2] = d.box;
    // the ground position (feet) is where a person stands; spread ~half a body height
    const cx = ((x1 + x2) / 2 / fw) * GW;
    const cy = ((y2 - (y2 - y1) * 0.15) / fh) * gh;
    const sig = Math.max(1.2, (((y2 - y1) / fh) * gh) * 0.45);
    const r = Math.ceil(sig * 2.5);
    for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(gh - 1, Math.ceil(cy + r)); y++) {
      for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(GW - 1, Math.ceil(cx + r)); x++) {
        const dd = ((x - cx) ** 2 + (y - cy) ** 2) / (2 * sig * sig);
        g[y * GW + x] += Math.exp(-dd) * (1 - DECAY) * 2.2;
      }
    }
  }
}

/** blue → cyan → yellow → red */
function color(v: number): [number, number, number] {
  const stops: [number, [number, number, number]][] = [[0, [40, 90, 255]], [0.35, [0, 220, 220]], [0.65, [255, 230, 0]], [1, [255, 40, 20]]];
  for (let i = 1; i < stops.length; i++) {
    if (v <= stops[i][0]) {
      const [a, ca] = stops[i - 1]; const [b, cb] = stops[i];
      const k = (v - a) / (b - a);
      return [ca[0] + (cb[0] - ca[0]) * k, ca[1] + (cb[1] - ca[1]) * k, ca[2] + (cb[2] - ca[2]) * k];
    }
  }
  return stops[stops.length - 1][1];
}

/** Paint the heat grid over the picture already drawn on ctx (w × h). */
export function drawHeat(ctx: CanvasRenderingContext2D, cameraId: string, w: number, h: number) {
  const m = maps.get(cameraId);
  if (!m) return;
  const g = m.img.getContext('2d');
  if (!g) return;
  const data = g.createImageData(m.gw, m.gh);
  let any = false;
  for (let i = 0; i < m.grid.length; i++) {
    const v = Math.min(1, m.grid[i] / FULL);
    if (v < 0.04) continue;
    any = true;
    const [r, gg, b] = color(v);
    data.data[i * 4] = r; data.data[i * 4 + 1] = gg; data.data[i * 4 + 2] = b;
    data.data[i * 4 + 3] = Math.round(70 + 120 * v);
  }
  if (!any) return;
  g.putImageData(data, 0, 0);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.globalAlpha = 0.75;
  ctx.drawImage(m.img, 0, 0, w, h);
  ctx.restore();
}
