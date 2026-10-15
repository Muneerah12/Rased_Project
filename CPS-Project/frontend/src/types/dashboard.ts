export type ConnectionStatus = 'ONLINE' | 'STALE' | 'OFFLINE'
export type LifecycleStatus = 'ACTIVE' | 'REVOKED'
export type IntegrityStatus = 'NORMAL' | 'SUSPICIOUS' | 'INVALID' | 'UNKNOWN'

export interface DashboardNode {
  node_id: string
  status: LifecycleStatus
  connection_status: ConnectionStatus
  last_seen: string | null
  last_heartbeat_received_at?: string | null
  location_id?: string | null
  provisioned_at: string | null
  revoked_at: string | null
}

export interface DashboardReading {
  id: number
  node_id: string
  location_id?: string | null
  sensor_id: string
  sensor_type: string
  value: number
  unit: string
  timestamp: string
  validation_status: IntegrityStatus
  confidence: number | null
  validation_reason: string | null
}

export interface DashboardHeartbeat {
  id: number
  node_id: string
  timestamp: string
  received_at: string
  reported_ip?: string | null
  reported_mac?: string | null
  reported_rssi_dbm?: number | null
  reported_ssid?: string | null
  reported_bssid?: string | null
  reported_wifi_channel?: number | null
  reported_gateway?: string | null
  reported_subnet_mask?: string | null
  reported_relay_state?: 'ON' | 'OFF' | null
}

export type DeploymentStatus = 'DEPLOYED' | 'NOT_DEPLOYED'

export interface DashboardLocation {
  location_id: string
  zone: string
  hall: string
  subzone: string
  deployment_status: DeploymentStatus
}

export interface ActivityCell {
  count: number
  status: IntegrityStatus | null
}

export interface ActivityRow {
  node_id: string
  sensor_id: string
  cells: ActivityCell[]
}

export type ScreenName =
  | 'overview'
  | 'otNodes'
  | 'actuators'
  | 'cctv'
  | 'drones'
  | 'otherIot'
  | 'noc'
  | 'nodeDetails'
  | 'readings'
  | 'heartbeats'

export interface SensorSummary {
  node_id: string
  sensor_id: string
  sensor_type: string
  value: number
  unit: string
  timestamp: string
  validation_status: IntegrityStatus
  confidence: number | null
  validation_reason: string | null
}
