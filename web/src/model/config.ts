import type { CrowdStatus } from './types';

/**
 * Prototype configuration. Values marked "user-confirmed" were confirmed for
 * this prototype; they are not production policy.
 */
export const CONFIG = {
  /** user-confirmed: node/sensor heartbeat marked offline after 30 s */
  heartbeatTimeoutMs: 30_000,
  /** simulated heartbeat cadence of healthy devices */
  heartbeatPeriodMs: 5_000,
  /** an on-duty employee whose badge no reader has read for this long is "not seen recently" */
  badgeUnseenMs: 60 * 60_000,
  /** simulated cadence of badge reads (gates, zone readers) for employees moving around */
  badgeReadPeriodMs: 8 * 60_000,
  /** crowd cutoffs for A1.1 (capacity 150): Normal ≤ 104 (below 70%), Medium 105–150, Crowded ≥ 151 */
  crowdNormalMaxRatio: 0.7,
  /** simulated drone transit time for new missions */
  droneTransitMs: 10_000,
  crowdSurgeMs: 120_000,
};

export function crowdStatus(people: number, capacity: number): CrowdStatus {
  if (people > capacity) return 'crowded';
  if (people / capacity < CONFIG.crowdNormalMaxRatio) return 'normal';
  return 'medium';
}

// ---- time: all prototype times are shown in Riyadh time (UTC+03:00) ----
const OFFSET = 3 * 3600_000;
/**
 * Sample fixture records were authored on 30/09/2026 around 15:10. At startup they are
 * shifted so that "15:10:00" equals the time base (the shared journal's start time when
 * the Rasid server is connected, otherwise page-load time). Shift 0 keeps the original
 * fixture day (used by the model tests).
 */
const FIXTURE_ANCHOR = Date.UTC(2026, 8, 30, 15, 10, 0) - OFFSET;
let SHIFT = 0;
/** Fixture day time, shifted onto the current time base. */
export function at(h: number, m: number, s = 0): number {
  return Date.UTC(2026, 8, 30, h, m, s) - OFFSET + SHIFT;
}
/** Start of the fixture timeline (15:10:00 on the fixture day, after shifting). */
export let SIM_START = FIXTURE_ANCHOR;
/** Anchor the sample records so that the fixture "now" equals `base` (ms). */
export function setTimeBase(base: number): void {
  SHIFT = base - FIXTURE_ANCHOR;
  SIM_START = FIXTURE_ANCHOR + SHIFT;
}

const p2 = (n: number) => String(n).padStart(2, '0');
export function fmtTime(ms: number, withSeconds = true): string {
  const d = new Date(ms + OFFSET);
  const base = `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;
  return withSeconds ? `${base}:${p2(d.getUTCSeconds())}` : base;
}
export function fmtDate(ms: number): string {
  const d = new Date(ms + OFFSET);
  return `${p2(d.getUTCDate())}/${p2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}
export function fmtDuration(ms: number, lang: 'ar' | 'en'): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const u = lang === 'ar' ? { h: 'س', m: 'د', s: 'ث' } : { h: 'h', m: 'm', s: 's' };
  if (h) return `${h}${u.h} ${m}${u.m}`;
  if (m) return `${m}${u.m} ${p2(s)}${u.s}`;
  return `${s}${u.s}`;
}
export function fmtAgo(now: number, t: number | null | undefined, lang: 'ar' | 'en'): string {
  if (t == null) return lang === 'ar' ? 'لا يوجد' : 'None';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (lang === 'ar') {
    if (s < 60) return `منذ ${s} ث`;
    if (s < 3600) return `منذ ${Math.floor(s / 60)} د`;
    return `منذ ${Math.floor(s / 3600)} س`;
  }
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  return `${Math.floor(s / 3600)} h ago`;
}
