import type { DashboardHeartbeat, DashboardNode } from '../types/dashboard'
import { ConnectionBadge, DataTable, EmptyState, LifecycleBadge, MetricCard, Notice, PageHeader, formatAgo } from './Primitives'

function reportedValue(value: string | number | null | undefined, suffix = '') {
  return value === null || value === undefined || value === '' ? 'Not reported' : `${value}${suffix}`
}

export function NocDashboard({ nodes, heartbeats, errors, lastUpdated, isRefreshing, onNodeSelect }: {
  nodes: DashboardNode[]
  heartbeats: DashboardHeartbeat[]
  errors: Partial<Record<'nodes' | 'readings' | 'heartbeats' | 'locations', string>>
  lastUpdated: string | null
  isRefreshing: boolean
  onNodeSelect: (nodeId: string) => void
}) {
  const latestHeartbeatByNode = new Map<string, DashboardHeartbeat>()
  heartbeats.forEach((heartbeat) => {
    const current = latestHeartbeatByNode.get(heartbeat.node_id)
    if (!current || heartbeat.received_at > current.received_at) latestHeartbeatByNode.set(heartbeat.node_id, heartbeat)
  })
  const failedResources = Object.keys(errors)
  const apiStatus = failedResources.length
    ? `Request issue: ${failedResources.join(', ')}`
    : lastUpdated
      ? isRefreshing ? 'Updating' : 'Responding'
      : 'Waiting for first response'

  return <>
    <PageHeader title="CPS / OT NOC" />
    <Notice>Connectivity is based on server heartbeat receipt. Network observations are reported by the authenticated device and are not independently verified.</Notice>
    <div className="metrics-grid">
      <MetricCard label="Registered nodes" value={nodes.length} />
      <MetricCard label="Active Nodes" value={nodes.filter((node) => node.status === 'ACTIVE').length} />
      <MetricCard label="Online" value={nodes.filter((node) => node.status === 'ACTIVE' && node.connection_status === 'ONLINE').length} tone="online" />
      <MetricCard label="Stale" value={nodes.filter((node) => node.status === 'ACTIVE' && node.connection_status === 'STALE').length} tone="stale" />
      <MetricCard label="Offline" value={nodes.filter((node) => node.status === 'ACTIVE' && node.connection_status === 'OFFLINE').length} tone="offline" />
    </div>

    <div className="section-label">PER-NODE DEVICE-REPORTED NETWORK OBSERVATIONS</div>
    <p className="noc-network-note">Reported by the node; not independently verified. Expand a node to view network details.</p>
    <div className="noc-node-grid">{nodes.map((node) => {
      const heartbeat = latestHeartbeatByNode.get(node.node_id)
      return <details className="noc-network-card" key={node.node_id}>
        <summary>
          <div className="noc-node-head"><strong>{node.node_id}</strong><span className={`node-health node-health-${node.status === 'ACTIVE' ? node.connection_status.toLowerCase() : 'revoked'}`}>{node.status === 'ACTIVE' ? node.connection_status : node.status}</span></div>
          <div className="noc-network-primary">
            <span><small>LIFECYCLE</small><LifecycleBadge status={node.status} /></span>
            <span><small>SSID</small><b>{reportedValue(heartbeat?.reported_ssid)}</b></span>
            <span><small>IP ADDRESS</small><b>{reportedValue(heartbeat?.reported_ip)}</b></span>
            <span><small>RSSI</small><b>{reportedValue(heartbeat?.reported_rssi_dbm, ' dBm')}</b></span>
            <span><small>LAST HEARTBEAT RECEIVED</small><b>{node.last_heartbeat_received_at ? formatAgo(node.last_heartbeat_received_at) : 'Not reported'}</b></span>
          </div>
        </summary>
        <div className="noc-network-details">
          <div><h4>NETWORK DETAILS</h4><dl>
            <dt>SSID</dt><dd>{reportedValue(heartbeat?.reported_ssid)}</dd>
            <dt>BSSID / AP MAC</dt><dd>{reportedValue(heartbeat?.reported_bssid)}</dd>
            <dt>IP Address</dt><dd>{reportedValue(heartbeat?.reported_ip)}</dd>
            <dt>MAC Address</dt><dd>{reportedValue(heartbeat?.reported_mac)}</dd>
            <dt>Wi-Fi Channel</dt><dd>{reportedValue(heartbeat?.reported_wifi_channel)}</dd>
            <dt>RSSI</dt><dd>{reportedValue(heartbeat?.reported_rssi_dbm, ' dBm')}</dd>
            <dt>Gateway</dt><dd>{reportedValue(heartbeat?.reported_gateway)}</dd>
            <dt>Subnet Mask</dt><dd>{reportedValue(heartbeat?.reported_subnet_mask)}</dd>
          </dl></div>
          <div><h4>CONNECTION</h4><dl>
            <dt>Lifecycle</dt><dd>{node.status}</dd>
            <dt>Connection status</dt><dd>{node.status === 'ACTIVE' ? node.connection_status : 'Not active'}</dd>
            <dt>Last heartbeat received</dt><dd>{node.last_heartbeat_received_at ? new Date(node.last_heartbeat_received_at).toLocaleString() : 'Not reported'}</dd>
          </dl><button className="button noc-open-node" onClick={() => onNodeSelect(node.node_id)}>Open node details</button></div>
        </div>
      </details>
    })}</div>
    {nodes.length ? <DataTable headers={['Node', 'Lifecycle', 'Connectivity', 'SSID', 'IP Address', 'RSSI', 'Last Heartbeat']}>
      {nodes.map((node) => {
        const heartbeat = latestHeartbeatByNode.get(node.node_id)
        return <tr key={node.node_id} className="clickable-row" onClick={() => onNodeSelect(node.node_id)}>
          <td className="strong-cell">{node.node_id}</td>
          <td><LifecycleBadge status={node.status} /></td>
          <td>{node.status === 'ACTIVE' ? <ConnectionBadge status={node.connection_status} /> : 'Not active'}</td>
          <td>{reportedValue(heartbeat?.reported_ssid)}</td>
          <td>{reportedValue(heartbeat?.reported_ip)}</td>
          <td>{reportedValue(heartbeat?.reported_rssi_dbm, ' dBm')}</td>
          <td>{node.last_heartbeat_received_at ? formatAgo(node.last_heartbeat_received_at) : 'Not reported'}</td>
        </tr>
      })}
    </DataTable> : <EmptyState>No nodes are available.</EmptyState>}

    <div className="section-label">DASHBOARD / API</div>
    <Notice>
      <strong>{apiStatus}</strong>{lastUpdated ? ` · Last successful poll ${formatAgo(lastUpdated)}` : ''}
      {failedResources.map((resource) => <div key={resource}>{resource}: {errors[resource as keyof typeof errors]}</div>)}
    </Notice>
  </>
}
