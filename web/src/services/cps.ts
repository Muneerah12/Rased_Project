/** Strict, browser-safe client for the local RASID CPS read-only bridge. */

export type CpsConnectionStatus = 'ONLINE' | 'STALE' | 'OFFLINE';
export type CpsReadingType = 'temperature' | 'humidity' | 'pressure';

export type CpsReading = {
  /** NODE-04 integration IDs are TEMP-01 | HUM-01 | PRESS-01; other IDs reported by CPS are preserved but never relabelled. */
  sensor_id: string;
  sensor_type: string;
  value: number;
  unit: string;
  timestamp: string;
  validation_status: string;
};

export type CpsNodeState = {
  node_id: 'NODE-04';
  status: 'ACTIVE' | 'REVOKED';
  connection_status: CpsConnectionStatus;
  location_id: string | null;
  last_heartbeat_received_at: string | null;
  reported_relay_state: 'ON' | 'OFF' | null;
  relay_reported_at: string | null;
  network_observation: {
    reported_ip: string | null;
    reported_mac: string | null;
    reported_rssi_dbm: number | null;
    reported_ssid: string | null;
    reported_bssid: string | null;
    reported_wifi_channel: number | null;
    reported_gateway: string | null;
    reported_subnet_mask: string | null;
    reported_at: string | null;
  };
  as_of: string;
  readings: CpsReading[];
};

export type CpsNetworkObservation = CpsNodeState['network_observation'];

export interface CpsHeartbeatHistoryItem {
  received_at: string;
}

export interface CpsHeartbeatHistory {
  node_id: 'NODE-04';
  as_of: string;
  items: CpsHeartbeatHistoryItem[];
}

export type CpsRelayReportAge = 'latest' | 'stale' | 'historical' | 'unavailable' | 'reported';
export type CpsNetworkObservationAge = 'latest' | 'stale' | 'historical' | 'unavailable' | 'reported';

/** Describes the provenance of a device-reported relay value without inferring physical actuation. */
export function relayReportAge(connectionStatus: string, relayState: CpsNodeState['reported_relay_state']): CpsRelayReportAge {
  if (relayState === null) return 'unavailable';
  if (connectionStatus === 'ONLINE') return 'latest';
  if (connectionStatus === 'STALE') return 'stale';
  if (connectionStatus === 'OFFLINE') return 'historical';
  return 'reported';
}

/** Describes snapshot provenance without treating a device report as network truth. */
export function networkObservationAge(connectionStatus: string, observation: CpsNetworkObservation): CpsNetworkObservationAge {
  if (observation.reported_at === null) return 'unavailable';
  if (connectionStatus === 'ONLINE') return 'latest';
  if (connectionStatus === 'STALE') return 'stale';
  if (connectionStatus === 'OFFLINE') return 'historical';
  return 'reported';
}

type RecordValue = Record<string, unknown>;
const STATE_KEYS = new Set([
  'node_id', 'status', 'connection_status', 'location_id', 'last_heartbeat_received_at',
  'reported_relay_state', 'relay_reported_at', 'network_observation', 'as_of', 'readings',
]);
const NETWORK_KEYS = new Set([
  'reported_ip', 'reported_mac', 'reported_rssi_dbm', 'reported_ssid', 'reported_bssid',
  'reported_wifi_channel', 'reported_gateway', 'reported_subnet_mask', 'reported_at',
]);
const READING_KEYS = new Set(['sensor_id', 'sensor_type', 'value', 'unit', 'timestamp', 'validation_status']);
const SENSOR_TYPES: Record<string, CpsReadingType> = {
  'TEMP-01': 'temperature', 'HUM-01': 'humidity', 'PRESS-01': 'pressure',
};

function record(value: unknown): value is RecordValue {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(value: RecordValue, keys: Set<string>): boolean {
  return Object.keys(value).length === keys.size && Object.keys(value).every((key) => keys.has(key));
}

function utcTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/i.test(value)) return false;
  return Number.isFinite(Date.parse(value));
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function nullableInteger(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isInteger(value));
}

function parseReading(value: unknown): CpsReading | null {
  if (!record(value) || !hasOnlyKeys(value, READING_KEYS)) return null;
  const sensorId = value.sensor_id;
  if (typeof sensorId !== 'string' || typeof value.sensor_type !== 'string'
    || (Object.prototype.hasOwnProperty.call(SENSOR_TYPES, sensorId) && value.sensor_type !== SENSOR_TYPES[sensorId])
    || typeof value.value !== 'number' || !Number.isFinite(value.value)
    || typeof value.unit !== 'string' || !utcTimestamp(value.timestamp)
    || typeof value.validation_status !== 'string') return null;
  return {
    sensor_id: sensorId, sensor_type: value.sensor_type, value: value.value, unit: value.unit,
    timestamp: value.timestamp, validation_status: value.validation_status,
  };
}

/** Reject unknown, incomplete, or inconsistent bridge responses instead of guessing. */
export function parseCpsNodeState(value: unknown): CpsNodeState | null {
  if (!record(value) || !hasOnlyKeys(value, STATE_KEYS)
    || value.node_id !== 'NODE-04'
    || (value.status !== 'ACTIVE' && value.status !== 'REVOKED')
    || (value.connection_status !== 'ONLINE' && value.connection_status !== 'STALE' && value.connection_status !== 'OFFLINE')
    || !nullableString(value.location_id) || !nullableString(value.last_heartbeat_received_at)
    || !utcTimestamp(value.as_of) || !Array.isArray(value.readings) || value.readings.length > 10) return null;
  if (value.last_heartbeat_received_at !== null && !utcTimestamp(value.last_heartbeat_received_at)) return null;
  if (!((value.reported_relay_state === null && value.relay_reported_at === null)
    || ((value.reported_relay_state === 'ON' || value.reported_relay_state === 'OFF') && utcTimestamp(value.relay_reported_at)))) return null;
  if (!record(value.network_observation) || !hasOnlyKeys(value.network_observation, NETWORK_KEYS)) return null;
  const network = value.network_observation;
  if (!nullableString(network.reported_ip) || !nullableString(network.reported_mac)
    || !nullableInteger(network.reported_rssi_dbm) || !nullableString(network.reported_ssid)
    || !nullableString(network.reported_bssid) || !nullableInteger(network.reported_wifi_channel)
    || !nullableString(network.reported_gateway) || !nullableString(network.reported_subnet_mask)
    || !nullableString(network.reported_at)
    || (network.reported_at !== null && !utcTimestamp(network.reported_at))) return null;
  if (network.reported_at === null && Object.entries(network).some(([field, entry]) => field !== 'reported_at' && entry !== null)) return null;
  const readings: CpsReading[] = [];
  for (const rawReading of value.readings) {
    const reading = parseReading(rawReading);
    if (!reading) return null;
    readings.push(reading);
  }
  return {
    node_id: 'NODE-04', status: value.status, connection_status: value.connection_status,
    location_id: value.location_id, last_heartbeat_received_at: value.last_heartbeat_received_at,
    reported_relay_state: value.reported_relay_state, relay_reported_at: value.relay_reported_at,
    network_observation: {
      reported_ip: network.reported_ip, reported_mac: network.reported_mac,
      reported_rssi_dbm: network.reported_rssi_dbm, reported_ssid: network.reported_ssid,
      reported_bssid: network.reported_bssid, reported_wifi_channel: network.reported_wifi_channel,
      reported_gateway: network.reported_gateway, reported_subnet_mask: network.reported_subnet_mask,
      reported_at: network.reported_at,
    },
    as_of: value.as_of, readings,
  };
}

export async function fetchCpsNodeState(signal?: AbortSignal): Promise<CpsNodeState> {
  const response = await fetch('/api/cps/node-state', { signal });
  const payload: unknown = await response.json().catch(() => null);
  const state = response.ok ? parseCpsNodeState(payload) : null;
  if (!state) throw new Error('CPS data unavailable');
  return state;
}

export function latestReading(state: CpsNodeState, type: CpsReadingType): CpsReading | null {
  return state.readings
    .filter((reading) => reading.sensor_type === type)
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))[0] ?? null;
}

/** The only sensor identities exposed by the NODE-04 integration contract. */
export const CPS_NODE04_SENSOR_IDS = ['TEMP-01', 'HUM-01', 'PRESS-01'] as const;

/**
 * Keeps one actual, newest reading for every known NODE-04 sensor identity.
 * No rows are synthesised for sensors CPS did not report.
 */
export function latestNode04Readings(readings: CpsReading[]): CpsReading[] {
  const latest = new Map<string, CpsReading>();
  const known = new Set<string>(CPS_NODE04_SENSOR_IDS);
  for (const reading of readings) {
    if (!known.has(reading.sensor_id)) continue;
    const previous = latest.get(reading.sensor_id);
    if (!previous || Date.parse(reading.timestamp) > Date.parse(previous.timestamp)) latest.set(reading.sensor_id, reading);
  }
  return CPS_NODE04_SENSOR_IDS.flatMap((sensorId) => {
    const reading = latest.get(sensorId);
    return reading ? [reading] : [];
  });
}

/** Validate the minimal CPS receipt-time contract before rendering it. */
export function parseCpsHeartbeatHistory(value: unknown): CpsHeartbeatHistory | null {
  if (!value || typeof value !== 'object') return null;
  const history = value as Record<string, unknown>;
  if (history.node_id !== 'NODE-04' || !utcTimestamp(history.as_of) || !Array.isArray(history.items) || history.items.length > 50) return null;
  const asOf = Date.parse(history.as_of);
  let previous = Number.POSITIVE_INFINITY;
  const items: CpsHeartbeatHistoryItem[] = [];
  for (const item of history.items) {
    if (!item || typeof item !== 'object' || Object.keys(item as Record<string, unknown>).length !== 1) return null;
    const receivedAt = (item as Record<string, unknown>).received_at;
    if (!utcTimestamp(receivedAt)) return null;
    const timestamp = Date.parse(receivedAt);
    if (timestamp > asOf || timestamp > previous) return null;
    previous = timestamp;
    items.push({ received_at: receivedAt });
  }
  return { node_id: 'NODE-04', as_of: history.as_of, items };
}

/** True only when the bounded upstream history reaches the requested window start. */
export function hasFullHeartbeatWindowCoverage(history: CpsHeartbeatHistory, windowMs = 5 * 60_000): boolean {
  if (!history.items.length) return false;
  const oldest = Date.parse(history.items[history.items.length - 1].received_at);
  return oldest <= Date.parse(history.as_of) - windowMs;
}

export async function fetchCpsHeartbeatHistory(signal?: AbortSignal): Promise<CpsHeartbeatHistory> {
  const response = await fetch('/api/cps/node-heartbeats', { signal });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof body?.detail === 'string' ? body.detail : `HTTP ${response.status}`);
  }
  const history = parseCpsHeartbeatHistory(body);
  if (!history) throw new Error('CPS returned an invalid heartbeat history response');
  return history;
}
