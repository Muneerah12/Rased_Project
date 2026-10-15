import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import type { DashboardHeartbeat, DashboardLocation, DashboardNode, DashboardReading, SensorSummary } from '../types/dashboard'
import { dashboardApi } from '../services/dashboardApi'
import { ConnectionBadge, DataTable, EmptyState, IntegrityBadge, LifecycleBadge, MetricCard, Notice, PageHeader, formatAgo } from './Primitives'

function localDateTime(timestamp: string | null) {
  if (!timestamp) return '—'
  return new Date(timestamp).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
}

function sensorSummaries(readings: DashboardReading[]): SensorSummary[] {
  const latest = new Map<string, DashboardReading>()
  readings.forEach((reading) => {
    const key = `${reading.node_id}|${reading.sensor_id}|${reading.sensor_type}`
    const current = latest.get(key)
    if (!current || reading.timestamp > current.timestamp) latest.set(key, reading)
  })
  return [...latest.values()].map((reading) => ({
    node_id: reading.node_id,
    sensor_id: reading.sensor_id,
    sensor_type: reading.sensor_type,
    value: reading.value,
    unit: reading.unit,
    timestamp: reading.timestamp,
    validation_status: reading.validation_status,
    confidence: reading.confidence,
    validation_reason: reading.validation_reason,
  }))
}

type TimeRange = '1h' | '24h' | '7d' | 'all'

const TIME_RANGE_OPTIONS: { value: TimeRange; label: string }[] = [
  { value: '1h', label: 'Last 1 hour' },
  { value: '24h', label: 'Last 24 hours' },
  { value: '7d', label: 'Last 7 days' },
  { value: 'all', label: 'All' },
]

function timeRangeCutoff(range: TimeRange): number | null {
  if (range === 'all') return null
  const duration = range === '1h' ? 60 * 60_000 : range === '24h' ? 24 * 60 * 60_000 : 7 * 24 * 60 * 60_000
  return Date.now() - duration
}

function isAfterCutoff(timestamp: string, cutoff: number | null): boolean {
  if (cutoff === null) return true
  const value = new Date(timestamp).getTime()
  return Number.isFinite(value) && value >= cutoff
}

function ModalDialog({ open, onClose, children, labelledBy }: { open: boolean; onClose: () => void; children: ReactNode; labelledBy: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return <dialog ref={dialogRef} className="management-dialog" aria-labelledby={labelledBy} onCancel={(event) => { event.preventDefault(); onClose() }}>
    {children}
  </dialog>
}

const NODE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/

export function NodesScreen({ nodes, locations, adminToken, onSelect, onRefresh, loading, error }: {
  nodes: DashboardNode[]
  locations: DashboardLocation[]
  adminToken: string
  onSelect: (id: string) => void
  onRefresh: () => Promise<void>
  loading: boolean
  error: string
}) {
  const [registrationOpen, setRegistrationOpen] = useState(false)
  const [nodeIdInput, setNodeIdInput] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [busyNodeId, setBusyNodeId] = useState('')
  const [pageMessage, setPageMessage] = useState('')
  const [pageError, setPageError] = useState('')
  const [credentialReveal, setCredentialReveal] = useState<{ nodeId: string; credential: string; action: 'registered' | 'reactivated' }>()
  const [copyMessage, setCopyMessage] = useState('')
  const [nodeSearch, setNodeSearch] = useState('')
  const [lifecycle, setLifecycle] = useState('all')
  useEffect(() => {
    if (!pageMessage) return
    const timer = window.setTimeout(() => setPageMessage(''), 5_000)
    return () => window.clearTimeout(timer)
  }, [pageMessage])

  const visibleNodes = useMemo(() => nodes.filter((node) =>
    node.node_id.toLowerCase().includes(nodeSearch.trim().toLowerCase())
      && (lifecycle === 'all' || node.status === lifecycle),
  ), [nodes, nodeSearch, lifecycle])
  const connectionCounts = useMemo(() => {
    const activeNodes = nodes.filter((node) => node.status === 'ACTIVE')
    return {
      total: nodes.length,
      online: activeNodes.filter((node) => node.connection_status === 'ONLINE').length,
      stale: activeNodes.filter((node) => node.connection_status === 'STALE').length,
      offline: activeNodes.filter((node) => node.connection_status === 'OFFLINE').length,
      inactive: nodes.filter((node) => node.status !== 'ACTIVE').length,
    }
  }, [nodes])

  const registerNode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const nodeId = nodeIdInput.trim()
    if (!NODE_ID_PATTERN.test(nodeId)) {
      setPageError('Use 1–64 letters, numbers, hyphens, or underscores; begin with a letter or number.')
      return
    }

    setSubmitting(true)
    setPageError('')
    setPageMessage('')
    try {
      const result = await dashboardApi.registerNode(adminToken, nodeId)
      setRegistrationOpen(false)
      setNodeIdInput('')
      setCredentialReveal({ nodeId: result.node_id, credential: result.credential, action: 'registered' })
      setCopyMessage('')
      await onRefresh()
    } catch (requestError) {
      setPageError(requestError instanceof Error ? requestError.message : 'Could not register this node.')
    } finally {
      setSubmitting(false)
    }
  }

  const revokeNode = async (node: DashboardNode) => {
    if (!window.confirm(`Revoke ${node.node_id}? It will no longer be able to authenticate.`)) return
    setBusyNodeId(node.node_id)
    setPageError('')
    setPageMessage('')
    try {
      await dashboardApi.revokeNode(adminToken, node.node_id)
      setPageMessage(`${node.node_id} was revoked.`)
      await onRefresh()
    } catch (requestError) {
      setPageError(requestError instanceof Error ? requestError.message : 'Could not revoke this node.')
    } finally {
      setBusyNodeId('')
    }
  }

  const reactivateNode = async (node: DashboardNode) => {
    if (!window.confirm(`Reactivate ${node.node_id}? A new device credential will replace the old one.`)) return
    setBusyNodeId(node.node_id)
    setPageError('')
    setPageMessage('')
    try {
      const result = await dashboardApi.reactivateNode(adminToken, node.node_id)
      setCredentialReveal({ nodeId: result.node_id, credential: result.credential, action: 'reactivated' })
      setCopyMessage('')
      await onRefresh()
    } catch (requestError) {
      setPageError(requestError instanceof Error ? requestError.message : 'Could not reactivate this node.')
    } finally {
      setBusyNodeId('')
    }
  }

  const closeCredential = () => {
    setCredentialReveal(undefined)
    setCopyMessage('')
  }

  const copyCredential = async () => {
    if (!credentialReveal) return
    try {
      await navigator.clipboard.writeText(credentialReveal.credential)
      setCopyMessage('Credential copied.')
    } catch {
      setCopyMessage('Copy was unavailable. Select and copy the credential manually.')
    }
  }

  const assignLocation = async (nodeId: string, locationId: string) => {
    setBusyNodeId(nodeId)
    setPageError('')
    setPageMessage('')
    try {
      await dashboardApi.assignNodeLocation(adminToken, nodeId, locationId || null)
      setPageMessage(`${nodeId} location updated.`)
      await onRefresh()
    } catch (requestError) {
      setPageError(requestError instanceof Error ? requestError.message : 'Could not update node location.')
    } finally {
      setBusyNodeId('')
    }
  }

  const locationDescription = (locationId: string | null | undefined) => {
    const location = locations.find((item) => item.location_id === locationId)
    if (!location) return ''
    const subzoneNumber = location.subzone.match(/-(\d+)$/)?.[1]
    return [
      location.zone && `Zone ${location.zone}`,
      location.hall && `Hall ${location.hall}`,
      location.subzone && `Subzone ${subzoneNumber ?? location.subzone}`,
    ].filter(Boolean).join('\u00a0\u00b7\u00a0')
  }

  const exactHeartbeatTime = (timestamp: string) => {
    const date = new Date(timestamp)
    return Number.isFinite(date.getTime()) ? date.toLocaleString() : timestamp
  }

  return <>
    <div className="nodes-page-heading">
      <PageHeader title="Nodes" action={<button type="button" className="button button-primary" onClick={() => { setPageError(''); setRegistrationOpen(true) }}>+ Add Node</button>} />
      <p className="page-subtitle">Registered identities, connection health, and deployment location.</p>
    </div>
    <section className="node-status-summary" aria-label="Node counts; connection counts include active nodes">
      {([
        ['Total nodes', connectionCounts.total, 'total'],
        ['Online', connectionCounts.online, 'online'],
        ['Stale', connectionCounts.stale, 'stale'],
        ['Offline', connectionCounts.offline, 'offline'],
        ['Inactive', connectionCounts.inactive, 'inactive'],
      ] as const).map(([label, count, tone]) => <div className={`node-status-count node-status-count-${tone}`} key={tone}>
        <span>{label}</span><strong>{(loading || Boolean(error)) && nodes.length === 0 ? '\u2014' : count}</strong>
      </div>)}
    </section>
    {(pageMessage || pageError || error) && <div className={`nodes-feedback ${pageMessage ? 'nodes-feedback-success' : 'nodes-feedback-error'}`} role={pageMessage ? 'status' : 'alert'}>
      <Notice><strong>{pageMessage || pageError || error}</strong></Notice>
    </div>}
    <div className="filters nodes-toolbar">
      <label>Find node <input type="search" placeholder="Node ID" value={nodeSearch} onChange={(event) => setNodeSearch(event.target.value)} /></label>
      <label>Lifecycle <select value={lifecycle} onChange={(event) => setLifecycle(event.target.value)}><option value="all">All nodes</option><option value="ACTIVE">Active</option><option value="REVOKED">Revoked</option></select></label>
      <span className="result-count">{visibleNodes.length} of {nodes.length} nodes</span>
    </div>
    {loading && nodes.length === 0 ? <div className="empty-state" role="status">Loading nodes…</div> : nodes.length ? visibleNodes.length ? <DataTable className="nodes-table" headers={['Node', 'Connection', 'Lifecycle', 'Location', 'Heartbeat', 'Actions']}>
      {visibleNodes.map((node) => <tr key={node.node_id}>
        <td className="strong-cell">{node.node_id}</td><td className="node-connection-cell">{node.status === 'ACTIVE' ? <ConnectionBadge status={node.connection_status} /> : <span className="node-inactive">Inactive</span>}</td><td><LifecycleBadge status={node.status} /></td>
        <td><div className="node-location-cell">
          <div className="node-location-current">{node.location_id ? <strong>{locationDescription(node.location_id) || node.location_id}</strong> : <span>Unassigned</span>}</div>
          <select className="node-location-assignment" aria-label={`Assign location to ${node.node_id}`} value={node.location_id ?? ''} disabled={busyNodeId === node.node_id} onChange={(event) => void assignLocation(node.node_id, event.target.value)}>
          <option value="">Unassigned</option>
          {locations.filter((location) => location.deployment_status === 'DEPLOYED').map((location) => <option key={location.location_id} value={location.location_id}>{location.location_id}</option>)}
          </select>
        </div></td><td>{node.last_heartbeat_received_at ? <time className="node-heartbeat" dateTime={node.last_heartbeat_received_at} title={`Received ${exactHeartbeatTime(node.last_heartbeat_received_at)}`}>{formatAgo(node.last_heartbeat_received_at)}</time> : <span className="node-heartbeat-missing">Not reported</span>}</td>
        <td className="node-actions">
          <button type="button" className="button button-primary node-action-view" onClick={() => onSelect(node.node_id)}>View</button>
          {node.status === 'ACTIVE'
            ? <button type="button" className="button button-danger" disabled={busyNodeId === node.node_id} onClick={() => void revokeNode(node)}>{busyNodeId === node.node_id ? 'Working…' : 'Revoke'}</button>
            : <button type="button" className="button" disabled={busyNodeId === node.node_id} onClick={() => void reactivateNode(node)}>{busyNodeId === node.node_id ? 'Working…' : 'Reactivate'}</button>}
        </td>
      </tr>)}
    </DataTable> : <EmptyState>No nodes match these filters.</EmptyState> : error ? <EmptyState>Could not load nodes. Check the Dashboard / API status and try again.</EmptyState> : <EmptyState>No nodes are registered yet.</EmptyState>}

    <details className="history-disclosure node-context-disclosure">
      <summary>System context <span>Context only &middot; not a network topology</span></summary>
      <div className="node-context-flow" aria-label="CPS system context">
        <strong>CPS Backend / API</strong><span aria-hidden="true">&darr;</span><strong>CPS Nodes</strong><span aria-hidden="true">&darr;</span><strong>Sensor telemetry</strong>
      </div>
    </details>

    <ModalDialog open={registrationOpen} onClose={() => setRegistrationOpen(false)} labelledBy="register-node-title">
      <form onSubmit={(event) => void registerNode(event)}>
        <h2 id="register-node-title">Add Node</h2>
        <label htmlFor="new-node-id">Node ID</label>
        <input id="new-node-id" autoFocus required maxLength={64} pattern="[A-Za-z0-9][A-Za-z0-9_-]{0,63}" value={nodeIdInput} onChange={(event) => setNodeIdInput(event.target.value)} aria-describedby="node-id-help" />
        <p id="node-id-help">Use 1–64 letters, numbers, hyphens, or underscores; begin with a letter or number.</p>
        {pageError && <p className="dialog-error" role="alert">{pageError}</p>}
        <div className="dialog-actions">
          <button type="button" className="button" onClick={() => setRegistrationOpen(false)} disabled={submitting}>Cancel</button>
          <button type="submit" className="button button-primary" disabled={submitting}>{submitting ? 'Registering…' : 'Register Node'}</button>
        </div>
      </form>
    </ModalDialog>

    <ModalDialog open={Boolean(credentialReveal)} onClose={closeCredential} labelledBy="credential-reveal-title">
      {credentialReveal && <div>
        <h2 id="credential-reveal-title">Node {credentialReveal.action === 'registered' ? 'registered' : 'reactivated'}</h2>
        <p>{credentialReveal.action === 'reactivated' ? 'The old device credential has been replaced. Provision the node with this new credential.' : 'Save this device credential now. It will not be shown again.'}</p>
        <label htmlFor="one-time-device-credential">One-time device credential</label>
        <input id="one-time-device-credential" className="credential-value" readOnly value={credentialReveal.credential} />
        <div className="dialog-actions">
          <button type="button" className="button" onClick={() => void copyCredential()}>Copy</button>
          <button type="button" className="button button-primary" onClick={closeCredential}>I’ve saved it</button>
        </div>
        {copyMessage && <p role="status">{copyMessage}</p>}
        <p className="dialog-warning">Closing this dialog removes the credential from the page. If it is lost, reactivate the node to issue a replacement.</p>
      </div>}
    </ModalDialog>
  </>
}

export function NodeDetailsScreen({ node, readings, heartbeats, loading, error, dataError, readingsLoading, onBack }: {
  node: DashboardNode | undefined
  readings: DashboardReading[]
  heartbeats: DashboardHeartbeat[]
  loading: boolean
  error: string
  dataError: string
  readingsLoading: boolean
  onBack: () => void
}) {
  const [sensorType, setSensorType] = useState('all')
  const [timeRange, setTimeRange] = useState<TimeRange>('24h')
  if (loading) return <div className="empty-state" role="status">Loading node details…</div>
  if (error) return <><button className="back-link" onClick={onBack}>Back to Nodes</button><EmptyState>{error}</EmptyState></>
  if (!node) return <><button className="back-link" onClick={onBack}>← Back to Nodes</button><EmptyState>Node not found in the local design fixtures.</EmptyState></>
  const nodeReadings = readings.filter((reading) => reading.node_id === node.node_id).sort((a, b) => b.timestamp.localeCompare(a.timestamp))
  const sensors = sensorSummaries(nodeReadings)
  const latestHeartbeat = heartbeats.filter((heartbeat) => heartbeat.node_id === node.node_id).sort((a, b) => new Date(b.received_at).getTime() - new Date(a.received_at).getTime())[0]
  const latestReading = nodeReadings[0]
  const sensorTypes = [...new Set(nodeReadings.map((reading) => reading.sensor_type))].sort()
  const cutoff = timeRangeCutoff(timeRange)
  const historicalReadings = nodeReadings.filter((reading) =>
    (sensorType === 'all' || reading.sensor_type === sensorType) && isAfterCutoff(reading.timestamp, cutoff),
  )
  return <>
    <button className="back-link" onClick={onBack}>← Back to Nodes</button>
    <PageHeader title={node.node_id} />
    {dataError && <Notice>Reading or heartbeat request issue: {dataError}</Notice>}
    <div className="metrics-grid detail-metrics node-detail-metrics">
      <MetricCard label="Lifecycle" value={<LifecycleBadge status={node.status} />} />
      <MetricCard label="Connection" value={node.status === 'ACTIVE' ? <ConnectionBadge status={node.connection_status} /> : 'Not active'} />
      <MetricCard label="Last Seen" value={formatAgo(node.last_seen)} />
      <MetricCard label="Last Heartbeat Received" value={latestHeartbeat ? formatAgo(latestHeartbeat.received_at) : 'Never'} />
      <MetricCard label="Last Reading" value={latestReading ? formatAgo(latestReading.timestamp) : 'Never'} />
    </div>
    <div className="section-label">SENSORS ON THIS NODE · DERIVED FROM READINGS</div>
    {readingsLoading ? <div className="empty-state" role="status">Loading node telemetry…</div> : sensors.length ? <DataTable headers={['Sensor ID', 'Type', 'Last Value', 'Integrity']}>
      {sensors.map((sensor) => <tr key={`${sensor.node_id}-${sensor.sensor_id}-${sensor.sensor_type}`}>
        <td>{sensor.sensor_id}</td><td>{sensor.sensor_type}</td><td>{sensor.value} {sensor.unit}</td><td><IntegrityBadge status={sensor.validation_status} /></td>
      </tr>)}
    </DataTable> : <EmptyState>No sensor readings are available for this node.</EmptyState>}
    <div className="section-label">READINGS · NODE-SCOPED</div>
    <div className="filters">
      <label>Sensor type <select aria-label="Filter node readings by sensor type" value={sensorType} onChange={(event) => setSensorType(event.target.value)}>
        <option value="all">All Types</option>
        {sensorTypes.map((type) => <option key={type} value={type}>{type}</option>)}
      </select></label>
      <label>Time range <select aria-label="Filter node readings by time range" value={timeRange} onChange={(event) => setTimeRange(event.target.value as TimeRange)}>
        {TIME_RANGE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select></label>
    </div>
    {readingsLoading ? <div className="empty-state" role="status">Loading node readings…</div> : <>
      <DataTable headers={['Timestamp', 'Sensor', 'Value', 'Integrity']}>
        {historicalReadings.map((reading) => <tr key={reading.id}><td>{formatAgo(reading.timestamp)}</td><td>{reading.sensor_id}</td><td>{reading.value} {reading.unit}</td><td><IntegrityBadge status={reading.validation_status} /></td></tr>)}
      </DataTable>
      {historicalReadings.length === 0 && <EmptyState>No readings match these filters.</EmptyState>}
    </>}
  </>
}

export function ReadingsScreen({ readings, nodes, loading, error }: { readings: DashboardReading[]; nodes: DashboardNode[]; loading: boolean; error: string }) {
  const [nodeId, setNodeId] = useState('all')
  const [sensorType, setSensorType] = useState('all')
  const [timeRange, setTimeRange] = useState<TimeRange>('24h')
  const sensorTypes = [...new Set(readings.map((reading) => reading.sensor_type))].sort()
  const cutoff = timeRangeCutoff(timeRange)
  const filtered = useMemo(() => [...readings]
    .filter((reading) => (nodeId === 'all' || reading.node_id === nodeId)
      && (sensorType === 'all' || reading.sensor_type === sensorType)
      && isAfterCutoff(reading.timestamp, cutoff))
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp)), [readings, nodeId, sensorType, cutoff])
  return <>
    <PageHeader title="Readings" />
    {error && <Notice>Reading request issue: {error}</Notice>}
    <div className="filters">
      <label>Node <select aria-label="Filter readings by node" value={nodeId} onChange={(event) => setNodeId(event.target.value)}>
        <option value="all">All Nodes</option>
        {nodes.map((node) => <option key={node.node_id} value={node.node_id}>{node.node_id}</option>)}
      </select></label>
      <label>Sensor type <select aria-label="Filter readings by sensor type" value={sensorType} onChange={(event) => setSensorType(event.target.value)}>
        <option value="all">All Types</option>
        {sensorTypes.map((type) => <option key={type} value={type}>{type}</option>)}
      </select></label>
      <label>Time range <select aria-label="Filter readings by time range" value={timeRange} onChange={(event) => setTimeRange(event.target.value as TimeRange)}>
        {TIME_RANGE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select></label>
    </div>
    {loading ? <div className="empty-state" role="status">Loading readings…</div> : <DataTable headers={['Timestamp', 'Node', 'Sensor', 'Type', 'Value', 'Integrity', 'Confidence']}>
      {filtered.map((reading) => <tr key={reading.id}>
        <td>{formatAgo(reading.timestamp)}</td><td>{reading.node_id}</td><td>{reading.sensor_id}</td><td>{reading.sensor_type}</td><td>{reading.value} {reading.unit}</td><td><IntegrityBadge status={reading.validation_status} /></td><td>{reading.confidence ?? '—'}</td>
      </tr>)}
    </DataTable>}
    {!loading && filtered.length === 0 && <EmptyState>No readings match these filters.</EmptyState>}
  </>
}

type HeartbeatTimeRange = '15m' | '1h' | '24h' | '7d' | 'all'

const HEARTBEAT_TIME_RANGE_OPTIONS: { value: HeartbeatTimeRange; label: string }[] = [
  { value: '15m', label: 'Last 15 minutes' },
  { value: '1h', label: 'Last 1 hour' },
  { value: '24h', label: 'Last 24 hours' },
  { value: '7d', label: 'Last 7 days' },
  { value: 'all', label: 'All' },
]

function heartbeatTimeCutoff(range: HeartbeatTimeRange): number | null {
  if (range === 'all') return null
  const duration = range === '15m' ? 15 * 60_000 : range === '1h' ? 60 * 60_000 : range === '24h' ? 24 * 60 * 60_000 : 7 * 24 * 60 * 60_000
  return Date.now() - duration
}

export function HeartbeatsScreen({ heartbeats, nodes, loading, error }: { heartbeats: DashboardHeartbeat[]; nodes: DashboardNode[]; loading: boolean; error: string }) {
  const [nodeId, setNodeId] = useState('all')
  const [timeRange, setTimeRange] = useState<HeartbeatTimeRange>('1h')
  const nodeIds = [...new Set([...nodes.map((node) => node.node_id), ...heartbeats.map((heartbeat) => heartbeat.node_id)])].sort()
  const cutoff = heartbeatTimeCutoff(timeRange)
  const filtered = heartbeats
    .filter((heartbeat) => (nodeId === 'all' || heartbeat.node_id === nodeId) && isAfterCutoff(heartbeat.received_at, cutoff))
    .sort((a, b) => new Date(b.received_at).getTime() - new Date(a.received_at).getTime())
  return <>
    <PageHeader title="Heartbeats" />
    {error && <Notice>Heartbeat request issue: {error}</Notice>}
    <div className="filters">
      <label>Node <select aria-label="Filter heartbeats by node" value={nodeId} onChange={(event) => setNodeId(event.target.value)}>
        <option value="all">All Nodes</option>
        {nodeIds.map((id) => <option key={id} value={id}>{id}</option>)}
      </select></label>
      <label>Received <select aria-label="Filter heartbeats by received time" value={timeRange} onChange={(event) => setTimeRange(event.target.value as HeartbeatTimeRange)}>
        {HEARTBEAT_TIME_RANGE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select></label>
    </div>
    {loading ? <div className="empty-state" role="status">Loading heartbeats…</div> : <DataTable headers={['ID', 'Node', 'Device Timestamp', 'Received At']}>
      {filtered.map((heartbeat) => <tr key={heartbeat.id}>
        <td>{heartbeat.id}</td><td>{heartbeat.node_id}</td><td>{localDateTime(heartbeat.timestamp)}</td><td>{localDateTime(heartbeat.received_at)}</td>
      </tr>)}
    </DataTable>}
    {!loading && filtered.length === 0 && <EmptyState>No heartbeat records match these filters.</EmptyState>}
  </>
}
