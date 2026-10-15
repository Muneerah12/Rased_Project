import { latestNode04Readings } from './cps';
import type { CpsNodeState, CpsReading } from './cps';
import { mapTargetForCpsLocation } from './cpsLocationMap';

/** A zone-level CPS inventory only; it deliberately has no device coordinates. */
export interface CpsOperationalMapDevice {
  nodeId: 'NODE-04';
  cpsLocationId: string;
  rasidZoneId: string;
  connectionStatus: string;
  lastHeartbeatReceivedAt: string | null;
  readings: CpsReading[];
  reportedRelayState: CpsNodeState['reported_relay_state'];
  relayReportedAt: string | null;
}

export function operationalCpsMapDevice(state: CpsNodeState | null): CpsOperationalMapDevice | null {
  if (!state || !state.location_id) return null;
  const target = mapTargetForCpsLocation(state.location_id);
  if (!target) return null;
  return {
    nodeId: state.node_id,
    cpsLocationId: state.location_id,
    rasidZoneId: target.id,
    connectionStatus: state.connection_status,
    lastHeartbeatReceivedAt: state.last_heartbeat_received_at,
    readings: latestNode04Readings(state.readings),
    reportedRelayState: state.reported_relay_state,
    relayReportedAt: state.relay_reported_at,
  };
}
