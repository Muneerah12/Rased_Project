/** Strict, same-origin client for the three server-side CPS bridge routes. */
export const CPS_SENSOR_IDS = ['TEMP-01', 'HUM-01', 'PRESS-01'] as const;
export type CpsSensorId = typeof CPS_SENSOR_IDS[number];
export type CpsReading = { sensor_id: CpsSensorId; sensor_type: string; value: number | string; unit: string; timestamp: string; validation_status: string };
export type CpsHeartbeatHistory = { node_id: 'NODE-04'; as_of: string; items: { received_at: string }[] };
export type CpsReadingHistory = { node_id: 'NODE-04'; sensor_id: CpsSensorId; sensor_type: string; start: string; end: string; as_of: string; items: CpsReading[]; next_cursor: string | null };

const HISTORY_FIELDS = new Set(['node_id', 'sensor_id', 'sensor_type', 'start', 'end', 'as_of', 'items', 'next_cursor']);
const HEARTBEAT_FIELDS = new Set(['node_id', 'as_of', 'items']);
const READING_FIELDS = new Set(['sensor_id', 'sensor_type', 'value', 'unit', 'timestamp', 'validation_status']);
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function exact(value: Record<string, unknown>, fields: Set<string>): boolean { const keys = Object.keys(value); return keys.length === fields.size && keys.every((key) => fields.has(key)); }
function utc(value: unknown): value is string { return typeof value === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/i.test(value) && Number.isFinite(Date.parse(value)); }
function sameUtcInstant(first: string, second: string): boolean { return Date.parse(first) === Date.parse(second); }
function reading(value: unknown, sensorId?: CpsSensorId, sensorType?: string): CpsReading | null {
  if (!record(value) || !exact(value, READING_FIELDS) || !CPS_SENSOR_IDS.includes(value.sensor_id as CpsSensorId) || typeof value.sensor_type !== 'string' || typeof value.unit !== 'string' || !utc(value.timestamp) || (typeof value.value !== 'number' && typeof value.value !== 'string') || typeof value.value === 'boolean' || typeof value.validation_status !== 'string') return null;
  if ((sensorId && value.sensor_id !== sensorId) || (sensorType && value.sensor_type !== sensorType)) return null;
  return value as CpsReading;
}

export function parseCpsHeartbeatHistory(value: unknown): CpsHeartbeatHistory | null {
  if (!record(value) || !exact(value, HEARTBEAT_FIELDS) || value.node_id !== 'NODE-04' || !utc(value.as_of) || !Array.isArray(value.items) || value.items.length > 50) return null;
  let previous = Number.POSITIVE_INFINITY; const items: { received_at: string }[] = [];
  for (const item of value.items) {
    if (!record(item) || Object.keys(item).length !== 1 || !utc(item.received_at)) return null;
    const receivedAt = Date.parse(item.received_at);
    if (receivedAt > Date.parse(value.as_of) || receivedAt > previous) return null;
    previous = receivedAt; items.push({ received_at: item.received_at });
  }
  return { node_id: 'NODE-04', as_of: value.as_of, items };
}

/** A stored receipt is historical whenever the node is not currently confirmed online. */
export function heartbeatHistoryIsHistorical(connectionStatus: string | undefined): boolean {
  return connectionStatus !== 'ONLINE';
}

export function parseCpsReadingHistory(value: unknown): CpsReadingHistory | null {
  if (!record(value) || !exact(value, HISTORY_FIELDS) || value.node_id !== 'NODE-04' || !CPS_SENSOR_IDS.includes(value.sensor_id as CpsSensorId) || typeof value.sensor_type !== 'string' || !utc(value.start) || !utc(value.end) || !utc(value.as_of) || Date.parse(value.start) >= Date.parse(value.end) || !Array.isArray(value.items) || value.items.length > 200 || !(value.next_cursor === null || (typeof value.next_cursor === 'string' && value.next_cursor.length <= 1024))) return null;
  const items: CpsReading[] = []; let previous = Number.POSITIVE_INFINITY;
  for (const candidate of value.items) {
    const parsed = reading(candidate, value.sensor_id as CpsSensorId, value.sensor_type);
    if (!parsed) return null;
    const observedAt = Date.parse(parsed.timestamp);
    if (observedAt < Date.parse(value.start) || observedAt >= Date.parse(value.end) || observedAt > previous) return null;
    previous = observedAt; items.push(parsed);
  }
  return { node_id: 'NODE-04', sensor_id: value.sensor_id as CpsSensorId, sensor_type: value.sensor_type, start: value.start, end: value.end, as_of: value.as_of, items, next_cursor: value.next_cursor as string | null };
}

export function hasFullHeartbeatWindowCoverage(history: CpsHeartbeatHistory, windowMs = 5 * 60_000): boolean { const oldest = history.items.at(-1)?.received_at; return !!oldest && Date.parse(oldest) <= Date.parse(history.as_of) - windowMs; }
export async function fetchCpsWorkspaceHeartbeats(signal?: AbortSignal): Promise<CpsHeartbeatHistory> {
  const response = await fetch('/api/cps/node-heartbeats', { signal }); const body: unknown = await response.json().catch(() => null); const parsed = response.ok ? parseCpsHeartbeatHistory(body) : null;
  if (!parsed) throw new Error('CPS heartbeat history unavailable'); return parsed;
}
export async function fetchCpsWorkspaceReadings({ sensorId, start, end, limit = 100, cursor, signal }: { sensorId: CpsSensorId; start: string; end: string; limit?: number; cursor?: string | null; signal?: AbortSignal }): Promise<CpsReadingHistory> {
  if (!CPS_SENSOR_IDS.includes(sensorId) || !utc(start) || !utc(end) || Date.parse(start) >= Date.parse(end) || Date.parse(end) - Date.parse(start) > 7 * 24 * 60 * 60_000 || !Number.isInteger(limit) || limit < 1 || limit > 200 || (cursor != null && (typeof cursor !== 'string' || cursor.length > 1024))) throw new Error('Invalid CPS history request');
  const query = new URLSearchParams({ sensor_id: sensorId, start, end, limit: String(limit) }); if (cursor) query.set('cursor', cursor);
  const response = await fetch(`/api/cps/node-readings?${query.toString()}`, { signal }); const body: unknown = await response.json().catch(() => null); const parsed = response.ok ? parseCpsReadingHistory(body) : null;
  if (!parsed || parsed.sensor_id !== sensorId || !sameUtcInstant(parsed.start, start) || !sameUtcInstant(parsed.end, end)) throw new Error('CPS reading history unavailable'); return parsed;
}
