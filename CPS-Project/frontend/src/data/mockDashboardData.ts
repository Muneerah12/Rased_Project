import type {
  ActivityRow,
  DashboardHeartbeat,
  DashboardNode,
  DashboardReading,
} from '../types/dashboard'

// Design-only fixtures copied/adapted from the supplied HTML preview.
// These are not live project records and must be replaced by API responses later.
export const mockNodes: DashboardNode[] = [
  { node_id: 'NODE-01', status: 'ACTIVE', connection_status: 'ONLINE', last_seen: '2026-09-29T10:14:02Z', provisioned_at: '2026-09-20T09:00:00Z', revoked_at: null },
  { node_id: 'NODE-02', status: 'ACTIVE', connection_status: 'STALE', last_seen: '2026-09-29T10:12:40Z', provisioned_at: '2026-09-21T09:00:00Z', revoked_at: null },
  { node_id: 'NODE-03', status: 'REVOKED', connection_status: 'OFFLINE', last_seen: '2026-09-27T18:02:11Z', provisioned_at: '2026-09-18T09:00:00Z', revoked_at: '2026-09-28T08:00:00Z' },
]

export const mockReadings: DashboardReading[] = [
  { id: 301, node_id: 'NODE-01', sensor_id: 'TEMP-01', sensor_type: 'temperature', value: 24.2, unit: 'C', timestamp: '2026-09-29T10:14:00Z', validation_status: 'NORMAL', confidence: 0.8, validation_reason: 'same-node peers agree' },
  { id: 302, node_id: 'NODE-01', sensor_id: 'TEMP-02', sensor_type: 'temperature', value: 24.4, unit: 'C', timestamp: '2026-09-29T10:14:00Z', validation_status: 'NORMAL', confidence: 0.8, validation_reason: 'same-node peers agree' },
  { id: 303, node_id: 'NODE-01', sensor_id: 'TEMP-03', sensor_type: 'temperature', value: 32.0, unit: 'C', timestamp: '2026-09-29T10:14:00Z', validation_status: 'SUSPICIOUS', confidence: 0.3, validation_reason: 'same-node peer deviation' },
  { id: 304, node_id: 'NODE-01', sensor_id: 'BME280-01', sensor_type: 'humidity', value: 48.2, unit: '%', timestamp: '2026-09-29T10:14:00Z', validation_status: 'NORMAL', confidence: 0.7, validation_reason: 'same-node peers agree' },
  { id: 305, node_id: 'NODE-02', sensor_id: 'BME280-01', sensor_type: 'pressure', value: 1008.4, unit: 'hPa', timestamp: '2026-09-29T10:12:40Z', validation_status: 'UNKNOWN', confidence: 0.5, validation_reason: 'insufficient comparable peers' },
]

export const mockHeartbeats: DashboardHeartbeat[] = [
  { id: 901, node_id: 'NODE-01', timestamp: '2026-09-29T10:14:02Z', received_at: '2026-09-29T10:14:02Z' },
  { id: 900, node_id: 'NODE-02', timestamp: '2026-09-29T10:12:40Z', received_at: '2026-09-29T10:12:41Z' },
]

// Synthetic interval buckets for visual layout only; not calculated from
// historical backend records. Empty cells deliberately depict no-data states.
export const mockActivityRows: ActivityRow[] = [
  { node_id: 'NODE-01', sensor_id: 'TEMP-01', cells: [{ count: 2, status: 'NORMAL' }, { count: 1, status: 'NORMAL' }, { count: 3, status: 'NORMAL' }, { count: 0, status: null }, { count: 2, status: 'NORMAL' }, { count: 1, status: 'NORMAL' }, { count: 2, status: 'NORMAL' }, { count: 3, status: 'NORMAL' }, { count: 1, status: 'NORMAL' }, { count: 2, status: 'NORMAL' }, { count: 1, status: 'NORMAL' }, { count: 2, status: 'NORMAL' }] },
  { node_id: 'NODE-01', sensor_id: 'TEMP-03', cells: [{ count: 2, status: 'SUSPICIOUS' }, { count: 1, status: 'SUSPICIOUS' }, { count: 3, status: 'SUSPICIOUS' }, { count: 0, status: null }, { count: 2, status: 'SUSPICIOUS' }, { count: 1, status: 'UNKNOWN' }, { count: 2, status: 'SUSPICIOUS' }, { count: 3, status: 'SUSPICIOUS' }, { count: 0, status: null }, { count: 2, status: 'SUSPICIOUS' }, { count: 1, status: 'SUSPICIOUS' }, { count: 2, status: 'SUSPICIOUS' }] },
  { node_id: 'NODE-01', sensor_id: 'BME280-01', cells: [{ count: 2, status: 'NORMAL' }, { count: 2, status: 'NORMAL' }, { count: 0, status: null }, { count: 2, status: 'NORMAL' }, { count: 3, status: 'NORMAL' }, { count: 1, status: 'NORMAL' }, { count: 2, status: 'NORMAL' }, { count: 1, status: 'NORMAL' }, { count: 2, status: 'NORMAL' }, { count: 0, status: null }, { count: 2, status: 'NORMAL' }, { count: 1, status: 'NORMAL' }] },
  { node_id: 'NODE-02', sensor_id: 'BME280-01', cells: [{ count: 0, status: null }, { count: 1, status: 'UNKNOWN' }, { count: 0, status: null }, { count: 1, status: 'UNKNOWN' }, { count: 0, status: null }, { count: 0, status: null }, { count: 1, status: 'UNKNOWN' }, { count: 0, status: null }, { count: 1, status: 'UNKNOWN' }, { count: 0, status: null }, { count: 1, status: 'UNKNOWN' }, { count: 0, status: null }] },
  { node_id: 'NODE-03', sensor_id: 'BME280-01', cells: Array.from({ length: 12 }, () => ({ count: 0, status: null })) },
]
