import { hasFullHeartbeatWindowCoverage, latestNode04Readings, networkObservationAge, parseCpsHeartbeatHistory, parseCpsNodeState, relayReportAge } from '../src/services/cps';
import type { CpsReading } from '../src/services/cps';
import { operationalCpsMapDevice } from '../src/services/cpsOperationalMap';

function equal(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) throw new Error(`${message}: expected ${String(expected)}, received ${String(actual)}`);
}

const readings: CpsReading[] = [
  { sensor_id: 'TEMP-01', sensor_type: 'temperature', value: 27.1, unit: '°C', timestamp: '2026-10-08T09:00:00Z', validation_status: 'VALID' },
  { sensor_id: 'HUM-01', sensor_type: 'humidity', value: 39, unit: '%', timestamp: '2026-10-08T09:01:00Z', validation_status: 'VALID' },
  { sensor_id: 'TEMP-01', sensor_type: 'temperature', value: 28.2, unit: '°C', timestamp: '2026-10-08T09:02:00Z', validation_status: 'VALID' },
  { sensor_id: 'PRESS-01', sensor_type: 'pressure', value: 1009.4, unit: 'hPa', timestamp: '2026-10-08T09:03:00Z', validation_status: 'VALID' },
  { sensor_id: 'UNREPORTED-01', sensor_type: 'other', value: 1, unit: '', timestamp: '2026-10-08T09:04:00Z', validation_status: 'VALID' },
];

const networkObservation = {
  reported_ip: '192.0.2.10', reported_mac: 'AA:BB:CC:DD:EE:FF', reported_rssi_dbm: -55,
  reported_ssid: 'CPS-Lab', reported_bssid: '11:22:33:44:55:66', reported_wifi_channel: 6,
  reported_gateway: '192.0.2.1', reported_subnet_mask: '255.255.255.0',
  reported_at: '2026-10-08T10:00:00+00:00',
};

const latest = latestNode04Readings(readings);
equal(latest.length, 3, 'Only NODE-04 integration sensor identities are shown');
equal(latest.map((reading) => reading.sensor_id).join(','), 'TEMP-01,HUM-01,PRESS-01', 'Sensors retain operational order');
equal(latest[0].value, 28.2, 'Newest reading is selected per sensor ID');
equal(relayReportAge('ONLINE', 'ON'), 'latest', 'Online ON relay report is latest');
equal(relayReportAge('ONLINE', 'OFF'), 'latest', 'Online OFF relay report is latest');
equal(relayReportAge('ONLINE', null), 'unavailable', 'Missing relay report is unavailable');
equal(relayReportAge('STALE', 'ON'), 'stale', 'Stale node relay report is stale');
equal(relayReportAge('OFFLINE', 'OFF'), 'historical', 'Offline node relay report is historical');
equal(networkObservationAge('ONLINE', networkObservation), 'latest', 'Online network observation is the latest device report');
equal(networkObservationAge('STALE', networkObservation), 'stale', 'Stale node network observation is not current');
equal(networkObservationAge('OFFLINE', networkObservation), 'historical', 'Offline node network observation is historical');
equal(networkObservationAge('ONLINE', { ...networkObservation, reported_at: null, reported_ip: null, reported_mac: null, reported_rssi_dbm: null, reported_ssid: null, reported_bssid: null, reported_wifi_channel: null, reported_gateway: null, reported_subnet_mask: null }), 'unavailable', 'Missing network report is unavailable');

const validNodeState = {
  node_id: 'NODE-04' as const, status: 'ACTIVE', connection_status: 'ONLINE', location_id: 'A1-1',
  last_heartbeat_received_at: '2026-10-08T10:00:00+00:00', reported_relay_state: 'ON' as const,
  relay_reported_at: '2026-10-08T10:00:00+00:00', network_observation: networkObservation,
  as_of: '2026-10-08T10:00:01+00:00', readings,
};
if (!parseCpsNodeState(validNodeState)) throw new Error('Valid NODE-04 network observation was rejected');
equal(parseCpsNodeState({ ...validNodeState, unexpected: 'not allowed' }), null, 'Unknown state fields are rejected');
equal(parseCpsNodeState({ ...validNodeState, network_observation: { ...networkObservation, credential_hash: 'not allowed' } }), null, 'Unapproved network fields are rejected');
equal(parseCpsNodeState({ ...validNodeState, network_observation: { ...networkObservation, reported_at: null } }), null, 'Network values without their receipt time are rejected');

const fullHistory = parseCpsHeartbeatHistory({
  node_id: 'NODE-04', as_of: '2026-10-08T10:05:00+00:00',
  items: [
    { received_at: '2026-10-08T10:04:55+00:00' },
    { received_at: '2026-10-08T10:00:00+00:00' },
  ],
});
if (!fullHistory) throw new Error('Valid CPS heartbeat history was rejected');
equal(hasFullHeartbeatWindowCoverage(fullHistory), true, 'History reaching the five-minute start has complete coverage');

const partialHistory = parseCpsHeartbeatHistory({
  node_id: 'NODE-04', as_of: '2026-10-08T10:05:00+00:00',
  items: [{ received_at: '2026-10-08T10:04:55+00:00' }],
});
if (!partialHistory) throw new Error('Partial CPS heartbeat history was rejected');
equal(hasFullHeartbeatWindowCoverage(partialHistory), false, 'Bounded history does not fabricate coverage before its oldest receipt');

equal(parseCpsHeartbeatHistory({ node_id: 'NODE-OTHER', as_of: '2026-10-08T10:05:00+00:00', items: [] }), null, 'Unexpected node history is rejected');
equal(parseCpsHeartbeatHistory({ node_id: 'NODE-04', as_of: 'invalid', items: [] }), null, 'Invalid snapshot timestamp is rejected');
equal(parseCpsHeartbeatHistory({ node_id: 'NODE-04', as_of: '2026-10-08T10:05:00+00:00', items: [{ received_at: '2026-10-08T10:06:00+00:00' }] }), null, 'Receipt after snapshot is rejected');
equal(parseCpsHeartbeatHistory({ node_id: 'NODE-04', as_of: '2026-10-08T10:05:00+00:00', items: [{ received_at: '2026-10-08T10:03:00+00:00', reported_ip: '192.0.2.1' }] }), null, 'Sensitive extra heartbeat fields are rejected');
equal(parseCpsHeartbeatHistory({ node_id: 'NODE-04', as_of: '2026-10-08T10:05:00+00:00', items: Array.from({ length: 51 }, () => ({ received_at: '2026-10-08T10:00:00+00:00' })) }), null, 'More than 50 heartbeat records are rejected');

const mapDevice = operationalCpsMapDevice({
  node_id: 'NODE-04', status: 'ACTIVE', connection_status: 'ONLINE', location_id: 'A1-1',
  last_heartbeat_received_at: '2026-10-08T10:00:00+00:00', reported_relay_state: 'ON', relay_reported_at: '2026-10-08T10:00:00+00:00', network_observation: networkObservation, as_of: '2026-10-08T10:00:01+00:00', readings,
});
if (!mapDevice) throw new Error('Confirmed CPS map location was not accepted');
equal(mapDevice.rasidZoneId, 'A1.1', 'Real NODE-04 maps to the approved RASID zone');
equal(mapDevice.nodeId, 'NODE-04', 'Operational map contains real NODE-04 only');
equal(mapDevice.readings.map((reading) => reading.sensor_id).join(','), 'TEMP-01,HUM-01,PRESS-01', 'Operational map excludes fixture or unreported sensor rows');
equal(mapDevice.reportedRelayState, 'ON', 'Operational map preserves the device-reported relay state');
equal(operationalCpsMapDevice(null), null, 'Unavailable CPS data has no operational map device');
equal(operationalCpsMapDevice({
  node_id: 'NODE-04', status: 'ACTIVE', connection_status: 'OFFLINE', location_id: 'UNKNOWN-1',
  last_heartbeat_received_at: null, reported_relay_state: null, relay_reported_at: null, network_observation: { reported_ip: null, reported_mac: null, reported_rssi_dbm: null, reported_ssid: null, reported_bssid: null, reported_wifi_channel: null, reported_gateway: null, reported_subnet_mask: null, reported_at: null }, as_of: '2026-10-08T10:00:01+00:00', readings: [],
}), null, 'Unknown CPS location does not guess a RASID map zone');

console.log('cps tests passed');
