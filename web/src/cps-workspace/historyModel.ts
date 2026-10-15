import type { CpsReading } from './readOnlyCps';
export const SIX_HOURS_MS = 6 * 60 * 60_000;
export type CpsHistoryCoverage = 'FULL' | 'PARTIAL' | 'EMPTY' | 'UNAVAILABLE';
export type CpsHistoryPoint = { timestamp: string; value: number };
export function sixHourWindow(asOf: string): { start: string; end: string } | null { const end = Date.parse(asOf); return Number.isFinite(end) ? { start: new Date(end - SIX_HOURS_MS).toISOString(), end: new Date(end).toISOString() } : null; }
export function timestampedNumericPoints(readings: CpsReading[]): CpsHistoryPoint[] { return readings.flatMap((reading) => { const value = typeof reading.value === 'number' ? reading.value : Number(reading.value); return Number.isFinite(value) && Number.isFinite(Date.parse(reading.timestamp)) ? [{ timestamp: reading.timestamp, value }] : []; }).sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp)); }
export function historyCoverage(readings: CpsReading[] | null, start: string): CpsHistoryCoverage { if (readings === null || !Number.isFinite(Date.parse(start))) return 'UNAVAILABLE'; if (!readings.length) return 'EMPTY'; return Math.min(...readings.map((reading) => Date.parse(reading.timestamp))) <= Date.parse(start) ? 'FULL' : 'PARTIAL'; }
