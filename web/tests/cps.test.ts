import { latestReading, parseCpsNodeState } from '../src/services/cps';

let failures = 0;
const ok = (condition: boolean, label: string) => { console.log(`${condition ? 'PASS' : 'FAIL'} ${label}`); if (!condition) failures++; };

const state = () => ({
  node_id: 'NODE-04', status: 'ACTIVE', connection_status: 'ONLINE', location_id: 'A1-1',
  last_heartbeat_received_at: '2026-10-12T10:00:00Z', reported_relay_state: null, relay_reported_at: null,
  network_observation: {
    reported_ip: null, reported_mac: null, reported_rssi_dbm: null, reported_ssid: null, reported_bssid: null,
    reported_wifi_channel: null, reported_gateway: null, reported_subnet_mask: null, reported_at: null,
  },
  as_of: '2026-10-12T10:00:05Z',
  readings: [
    { sensor_id: 'TEMP-01', sensor_type: 'temperature', value: 25.1, unit: 'C', timestamp: '2026-10-12T09:59:00Z', validation_status: 'VALID' },
    { sensor_id: 'TEMP-01', sensor_type: 'temperature', value: 25.4, unit: 'C', timestamp: '2026-10-12T10:00:00Z', validation_status: 'VALID' },
    { sensor_id: 'HUM-01', sensor_type: 'humidity', value: 49.2, unit: '%', timestamp: '2026-10-12T10:00:00Z', validation_status: 'VALID' },
    { sensor_id: 'PRESS-01', sensor_type: 'pressure', value: 945.1, unit: 'hPa', timestamp: '2026-10-12T10:00:00Z', validation_status: 'VALID' },
  ],
});

const valid = parseCpsNodeState(state());
ok(valid?.node_id === 'NODE-04', 'accepts the exact NODE-04 bridge schema');
ok(valid != null && latestReading(valid, 'temperature')?.value === 25.4, 'uses the actual newest timestamped reading');

const wrongNode = state(); wrongNode.node_id = 'NODE-03';
ok(parseCpsNodeState(wrongNode) === null, 'rejects a non-NODE-04 response');

const unknownField = { ...state(), unapproved: true };
ok(parseCpsNodeState(unknownField) === null, 'rejects unknown upstream fields');

const naiveTimestamp = state(); naiveTimestamp.readings[0].timestamp = '2026-10-12T10:00:00';
ok(parseCpsNodeState(naiveTimestamp) === null, 'rejects a timezone-naive reading timestamp');

const mismatchedSensor = state(); mismatchedSensor.readings[0].sensor_type = 'humidity';
ok(parseCpsNodeState(mismatchedSensor) === null, 'rejects mismatched sensor identifiers and types');

if (failures) process.exit(1);
