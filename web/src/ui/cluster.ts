import type { Severity } from '../model/types';

const RANK: Record<Severity, number> = { critical: 3, high: 2, medium: 1, low: 0 };

export interface Cluster<T> { key: string; x: number; y: number; severity: Severity; items: T[] }

/**
 * Groups map points that would overlap on screen. Points are taken most severe first (then by id,
 * so the result does not depend on input order); each joins the first cluster whose anchor lies
 * within `radius`, otherwise it starts a new one. A cluster sits at its most severe point and
 * lists its items most severe first. Coordinates and radius are in the same (screen) units.
 */
export function clusterPoints<T extends { id: string; x: number; y: number; severity: Severity }>(points: T[], radius: number): Cluster<T>[] {
  const sorted = [...points].sort((a, b) => RANK[b.severity] - RANK[a.severity] || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const out: Cluster<T>[] = [];
  const r2 = radius * radius;
  for (const p of sorted) {
    const c = out.find((k) => (k.x - p.x) ** 2 + (k.y - p.y) ** 2 <= r2);
    if (c) c.items.push(p);
    else out.push({ key: p.id, x: p.x, y: p.y, severity: p.severity, items: [p] });
  }
  return out;
}
