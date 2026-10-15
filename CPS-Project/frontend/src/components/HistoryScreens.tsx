import { useEffect, useMemo, useState } from 'react'
import type { DashboardHeartbeat, DashboardLocation, DashboardNode, DashboardReading, SensorSummary } from '../types/dashboard'
import { dashboardApi } from '../services/dashboardApi'
import { HeartbeatTimeline } from './HeartbeatTimeline'
import { HistoricalTrend } from './HistoricalTrend'
import { ConnectionBadge, DataTable, EmptyState, IntegrityBadge, LifecycleBadge, MetricCard, Notice, PageHeader, formatAgo } from './Primitives'

type ReadingRange = '1h' | '24h' | '7d' | 'all'
type HeartbeatRange = '15m' | '1h' | '24h' | '7d' | 'all'

const readingRangeOptions: { value: ReadingRange; label: string }[] = [
  { value: '1h', label: 'Last 1 hour' }, { value: '24h', label: 'Last 24 hours' },
  { value: '7d', label: 'Last 7 days' }, { value: 'all', label: 'All' },
]
const heartbeatRangeOptions: { value: HeartbeatRange; label: string }[] = [
  { value: '15m', label: 'Last 15 minutes' }, { value: '1h', label: 'Last 1 hour' },
  { value: '24h', label: 'Last 24 hours' }, { value: '7d', label: 'Last 7 days' },
  { value: 'all', label: 'All' },
]

function rangeStart(range: ReadingRange | HeartbeatRange): string | undefined {
  const milliseconds = range === '15m' ? 15 * 60_000
    : range === '1h' ? 60 * 60_000
      : range === '24h' ? 24 * 60 * 60_000
        : range === '7d' ? 7 * 24 * 60 * 60_000 : undefined
  return milliseconds === undefined ? undefined : new Date(Date.now() - milliseconds).toISOString()
}

function makeSensorSummaries(readings: DashboardReading[]): SensorSummary[] {
  const latest = new Map<string, DashboardReading>()
  readings.forEach((reading) => {
    const current = latest.get(reading.sensor_id)
    if (!current || reading.timestamp > current.timestamp) latest.set(reading.sensor_id, reading)
  })
  return [...latest.values()].map((reading) => ({
    node_id: reading.node_id, sensor_id: reading.sensor_id, sensor_type: reading.sensor_type,
    value: reading.value, unit: reading.unit, timestamp: reading.timestamp,
    validation_status: reading.validation_status, confidence: reading.confidence,
    validation_reason: reading.validation_reason,
  }))
}

function getMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

export function NodeDetailsScreen({ adminToken, node, locations, locationsUnavailable, loading, error, onBack }: {
  adminToken: string
  node: DashboardNode | undefined
  locations: DashboardLocation[]
  locationsUnavailable: boolean
  loading: boolean
  error: string
  onBack: () => void
}) {
  const [latestReadings, setLatestReadings] = useState<DashboardReading[]>([])
  const [readingRows, setReadingRows] = useState<DashboardReading[]>([])
  const [heartbeatRows, setHeartbeatRows] = useState<DashboardHeartbeat[]>([])
  const [sensorType, setSensorType] = useState('all')
  const [timeRange, setTimeRange] = useState<ReadingRange>('24h')
  const [sensorSearch, setSensorSearch] = useState('')
  const [integrity, setIntegrity] = useState('all')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [heartbeatRange, setHeartbeatRange] = useState<HeartbeatRange>('1h')
  const [readingCursor, setReadingCursor] = useState<string | null>(null)
  const [heartbeatCursor, setHeartbeatCursor] = useState<string | null>(null)
  const [readingLoading, setReadingLoading] = useState(true)
  const [heartbeatLoading, setHeartbeatLoading] = useState(true)
  const [historyError, setHistoryError] = useState('')
  const [timelineError, setTimelineError] = useState('')

  useEffect(() => {
    if (!node) return
    const controller = new AbortController()
    void dashboardApi.getNodeReadingsPage(adminToken, node.node_id, { limit: 200 }, controller.signal)
      .then((page) => setLatestReadings(page.items))
      .catch((reason: unknown) => { if (!controller.signal.aborted) setHistoryError(getMessage(reason, 'Could not load node readings.')) })
    return () => controller.abort()
  }, [adminToken, node])

  useEffect(() => {
    if (!node || !historyOpen) return
    const controller = new AbortController()
    void dashboardApi.getNodeReadingsPage(adminToken, node.node_id, {
      sensorType: sensorType === 'all' ? undefined : sensorType,
      start: rangeStart(timeRange), limit: 200,
    }, controller.signal)
      .then((page) => { setReadingRows(page.items); setReadingCursor(page.next_cursor) })
      .catch((reason: unknown) => { if (!controller.signal.aborted) setHistoryError(getMessage(reason, 'Could not load node readings.')) })
      .finally(() => { if (!controller.signal.aborted) setReadingLoading(false) })
    return () => controller.abort()
  }, [adminToken, node, sensorType, timeRange, historyOpen])

  useEffect(() => {
    if (!node) return
    const controller = new AbortController()
    void dashboardApi.getHeartbeatsPage(adminToken, {
      nodeId: node.node_id, receivedAfter: rangeStart(heartbeatRange), limit: 500,
    }, controller.signal)
      .then((page) => { setHeartbeatRows(page.items); setHeartbeatCursor(page.next_cursor) })
      .catch((reason: unknown) => { if (!controller.signal.aborted) setTimelineError(getMessage(reason, 'Could not load heartbeat history.')) })
      .finally(() => { if (!controller.signal.aborted) setHeartbeatLoading(false) })
    return () => controller.abort()
  }, [adminToken, node, heartbeatRange])

  const summaries = useMemo(() => makeSensorSummaries(latestReadings), [latestReadings])
  const sensorTypes = [...new Set(latestReadings.map((reading) => reading.sensor_type))].sort()
  const loadMoreReadings = async () => {
    if (!node || !readingCursor) return
    setReadingLoading(true)
    try {
      const page = await dashboardApi.getNodeReadingsPage(adminToken, node.node_id, {
        sensorType: sensorType === 'all' ? undefined : sensorType,
        start: rangeStart(timeRange), cursor: readingCursor, limit: 200,
      })
      setReadingRows((rows) => [...rows, ...page.items])
      setReadingCursor(page.next_cursor)
    } catch (reason) { setHistoryError(getMessage(reason, 'Could not load more readings.')) }
    finally { setReadingLoading(false) }
  }
  const loadMoreHeartbeats = async () => {
    if (!node || !heartbeatCursor) return
    setHeartbeatLoading(true)
    try {
      const page = await dashboardApi.getHeartbeatsPage(adminToken, {
        nodeId: node.node_id, receivedAfter: rangeStart(heartbeatRange), cursor: heartbeatCursor, limit: 500,
      })
      setHeartbeatRows((rows) => [...rows, ...page.items])
      setHeartbeatCursor(page.next_cursor)
    } catch (reason) { setTimelineError(getMessage(reason, 'Could not load more heartbeats.')) }
    finally { setHeartbeatLoading(false) }
  }

  if (loading) return <div className="empty-state" role="status">Loading node details…</div>
  if (error) return <><button className="back-link" onClick={onBack}>Back to Nodes</button><EmptyState>{error}</EmptyState></>
  if (!node) return <><button className="back-link" onClick={onBack}>Back to Nodes</button><EmptyState>Node details are unavailable.</EmptyState></>

  const location = locations.find((item) => item.location_id === node.location_id)
  const locationValue = node.location_id === null || node.location_id === undefined
    ? 'Unassigned'
    : locationsUnavailable
      ? `${node.location_id} · catalogue unavailable`
      : location?.location_id ?? `${node.location_id} · not in catalogue`
  const latestReading = latestReadings[0]
  return <>
    <button className="back-link" onClick={onBack}>Back to Nodes</button>
    <PageHeader title={node.node_id} />
    <div className="metrics-grid detail-metrics node-detail-metrics">
      <MetricCard label="Lifecycle" value={<LifecycleBadge status={node.status} />} />
      <MetricCard label="Connection" value={node.status === 'ACTIVE' ? <ConnectionBadge status={node.connection_status} /> : 'Not active'} />
      <MetricCard label="Location" value={locationValue} />
      <MetricCard label="Device Timestamp" value={formatAgo(node.last_seen)} />
      <MetricCard label="Last Heartbeat Received" value={formatAgo(node.last_heartbeat_received_at ?? null)} />
      <MetricCard label="Last Reading" value={latestReading ? formatAgo(latestReading.timestamp) : 'Never'} />
    </div>
    <HistoricalTrend adminToken={adminToken} nodes={[node]} initialNodeId={node.node_id} fixedNode />
    <div className="section-label">LATEST VALUE BY SENSOR</div>
    {summaries.length ? <DataTable headers={['Sensor ID', 'Type', 'Last Value', 'Integrity']}>
      {summaries.map((sensor) => <tr key={`${sensor.sensor_id}-${sensor.sensor_type}`}>
        <td>{sensor.sensor_id}</td><td>{sensor.sensor_type}</td><td>{sensor.value} {sensor.unit}</td><td><IntegrityBadge status={sensor.validation_status} /></td>
      </tr>)}
    </DataTable> : <EmptyState>{historyError || 'No sensor readings are available for this node.'}</EmptyState>}

    <div className="section-label">HEARTBEAT TIMELINE · SERVER RECEIPT TIME</div>
    <div className="filters"><label>Timeline range <select value={heartbeatRange} onChange={(event) => {
      setHeartbeatRange(event.target.value as HeartbeatRange); setHeartbeatLoading(true); setTimelineError(''); setHeartbeatRows([]); setHeartbeatCursor(null)
    }}>
      {heartbeatRangeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select></label></div>
    {timelineError && <Notice>{timelineError}</Notice>}
    {heartbeatLoading && heartbeatRows.length === 0 ? <div className="empty-state" role="status">Loading heartbeat history…</div> : <HeartbeatTimeline heartbeats={heartbeatRows} range={heartbeatRange} />}
    {heartbeatCursor && <button className="button load-more" disabled={heartbeatLoading} onClick={() => void loadMoreHeartbeats()}>{heartbeatLoading ? 'Loading…' : 'Load earlier heartbeats'}</button>}

    <details className="history-disclosure" open={historyOpen} onToggle={(event) => setHistoryOpen(event.currentTarget.open)}>
      <summary>Reading history <span>{readingRows.length} loaded · newest first</span></summary>
      <div className="section-label">NODE-SCOPED HISTORY</div>
    <div className="filters">
      <label>Find sensor <input type="search" placeholder="Sensor ID" value={sensorSearch} onChange={(event) => setSensorSearch(event.target.value)} /></label>
      <label>Integrity <select value={integrity} onChange={(event) => setIntegrity(event.target.value)}>
        <option value="all">All statuses</option><option value="NORMAL">Normal</option><option value="SUSPICIOUS">Suspicious</option><option value="INVALID">Invalid</option><option value="UNKNOWN">Not assessed</option>
      </select></label>
      <label>Sensor type <select value={sensorType} onChange={(event) => {
        setSensorType(event.target.value); setReadingLoading(true); setHistoryError(''); setReadingRows([]); setReadingCursor(null)
      }}>
        <option value="all">All Types</option>
        {sensorTypes.map((type) => <option key={type} value={type}>{type}</option>)}
      </select></label>
      <label>Time range <select value={timeRange} onChange={(event) => {
        setTimeRange(event.target.value as ReadingRange); setReadingLoading(true); setHistoryError(''); setReadingRows([]); setReadingCursor(null)
      }}>
        {readingRangeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select></label>
    </div>
    {historyError && <Notice>{historyError}</Notice>}
    {readingLoading && readingRows.length === 0 ? <div className="empty-state" role="status">Loading node readings…</div> : <DataTable headers={['Timestamp', 'Sensor', 'Type', 'Value', 'Integrity']}>
      {readingRows.filter((reading) => (integrity === 'all' || reading.validation_status === integrity) && reading.sensor_id.toLowerCase().includes(sensorSearch.trim().toLowerCase())).map((reading) => <tr key={reading.id}>
        <td title={new Date(reading.timestamp).toLocaleString()}>{formatAgo(reading.timestamp)}</td><td>{reading.sensor_id}</td><td>{reading.sensor_type}</td><td>{reading.value} {reading.unit}</td><td><IntegrityBadge status={reading.validation_status} /></td>
      </tr>)}
    </DataTable>}
    {!readingLoading && readingRows.filter((reading) => (integrity === 'all' || reading.validation_status === integrity) && reading.sensor_id.toLowerCase().includes(sensorSearch.trim().toLowerCase())).length === 0 && <EmptyState>No readings match these filters.</EmptyState>}
    {readingCursor && <button className="button load-more" disabled={readingLoading} onClick={() => void loadMoreReadings()}>{readingLoading ? 'Loading…' : 'Load older readings'}</button>}
    </details>
  </>
}

export function ReadingsScreen({ adminToken, nodes }: { adminToken: string; nodes: DashboardNode[] }) {
  const [nodeId, setNodeId] = useState('all')
  const [sensorType, setSensorType] = useState('all')
  const [timeRange, setTimeRange] = useState<ReadingRange>('24h')
  const [sensorSearch, setSensorSearch] = useState('')
  const [integrity, setIntegrity] = useState('all')
  const [rows, setRows] = useState<DashboardReading[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const sensorTypes = [...new Set(rows.map((reading) => reading.sensor_type))].sort()
  const filteredRows = rows.filter((reading) => (integrity === 'all' || reading.validation_status === integrity)
    && reading.sensor_id.toLowerCase().includes(sensorSearch.trim().toLowerCase()))

  useEffect(() => {
    const controller = new AbortController()
    void dashboardApi.getReadingsPage(adminToken, {
      nodeId: nodeId === 'all' ? undefined : nodeId,
      sensorType: sensorType === 'all' ? undefined : sensorType,
      start: rangeStart(timeRange), limit: 200,
    }, controller.signal)
      .then((page) => { setRows(page.items); setCursor(page.next_cursor) })
      .catch((reason: unknown) => { if (!controller.signal.aborted) setError(getMessage(reason, 'Could not load readings.')) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [adminToken, nodeId, sensorType, timeRange])

  const loadMore = async () => {
    if (!cursor) return
    setLoading(true)
    try {
      const page = await dashboardApi.getReadingsPage(adminToken, {
        nodeId: nodeId === 'all' ? undefined : nodeId,
        sensorType: sensorType === 'all' ? undefined : sensorType,
        start: rangeStart(timeRange), cursor, limit: 200,
      })
      setRows((previous) => [...previous, ...page.items])
      setCursor(page.next_cursor)
    } catch (reason) { setError(getMessage(reason, 'Could not load more readings.')) }
    finally { setLoading(false) }
  }

  return <>
    <PageHeader title="Readings" />
    {error && <Notice>{error}</Notice>}
    <div className="filters">
      <label>Find sensor <input type="search" placeholder="Sensor ID" value={sensorSearch} onChange={(event) => setSensorSearch(event.target.value)} /></label>
      <label>Integrity <select value={integrity} onChange={(event) => setIntegrity(event.target.value)}>
        <option value="all">All statuses</option><option value="NORMAL">Normal</option><option value="SUSPICIOUS">Suspicious</option><option value="INVALID">Invalid</option><option value="UNKNOWN">Not assessed</option>
      </select></label>
      <label>Node <select value={nodeId} onChange={(event) => {
        setNodeId(event.target.value); setLoading(true); setError(''); setRows([]); setCursor(null)
      }}>
        <option value="all">All Nodes</option>{nodes.map((node) => <option key={node.node_id} value={node.node_id}>{node.node_id}</option>)}
      </select></label>
      <label>Sensor type <select value={sensorType} onChange={(event) => {
        setSensorType(event.target.value); setLoading(true); setError(''); setRows([]); setCursor(null)
      }}>
        <option value="all">All Types</option>{sensorTypes.map((type) => <option key={type} value={type}>{type}</option>)}
      </select></label>
      <label>Time range <select value={timeRange} onChange={(event) => {
        setTimeRange(event.target.value as ReadingRange); setLoading(true); setError(''); setRows([]); setCursor(null)
      }}>
        {readingRangeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select></label>
    </div>
    <div className="telemetry-summary"><span>{filteredRows.length} of {rows.length} readings loaded · newest first</span><span>Latest values summarize the readings currently loaded from the API.</span></div>
    <div className="telemetry-groups">{[...new Set(filteredRows.map((reading) => reading.sensor_type))].sort().map((type) => {
      const latestBySensor = new Map<string, DashboardReading>()
      filteredRows.filter((reading) => reading.sensor_type === type).forEach((reading) => {
        const key = `${reading.node_id}|${reading.sensor_id}`
        const current = latestBySensor.get(key)
        if (!current || reading.timestamp > current.timestamp) latestBySensor.set(key, reading)
      })
      return <section className="telemetry-group" key={type}><header><strong>{type}</strong><span>{latestBySensor.size} sensor{latestBySensor.size === 1 ? '' : 's'} · latest returned reading per sensor</span></header><div className="telemetry-card-grid">
        {[...latestBySensor.values()].map((reading) => <article className="telemetry-card" key={`${reading.node_id}-${reading.sensor_id}`}>
          <div className="telemetry-card-head"><span>{reading.sensor_id}</span><IntegrityBadge status={reading.validation_status} /></div>
          <strong className="telemetry-value">{reading.value}<small>{reading.unit}</small></strong>
          <div className="telemetry-card-meta"><span>{reading.node_id}</span><span>{reading.location_id ?? 'Location unavailable'}</span></div>
          <div className="telemetry-time" title={new Date(reading.timestamp).toLocaleString()}>{formatAgo(reading.timestamp)}</div>
        </article>)}
      </div></section>
    })}</div>
    <details className="history-disclosure">
    <summary>Detailed reading rows <span>{filteredRows.length} shown · {rows.length} loaded</span></summary>
    {loading && rows.length === 0 ? <div className="empty-state" role="status">Loading readings…</div> : <DataTable headers={['Timestamp', 'Node', 'Sensor', 'Type', 'Value', 'Integrity']}>
      {filteredRows.map((reading) => <tr key={reading.id}>
        <td title={new Date(reading.timestamp).toLocaleString()}>{formatAgo(reading.timestamp)}</td><td>{reading.node_id}</td><td>{reading.sensor_id}</td><td>{reading.sensor_type}</td><td>{reading.value} {reading.unit}</td><td><IntegrityBadge status={reading.validation_status} /></td>
      </tr>)}
    </DataTable>}
    {!loading && rows.length > 0 && filteredRows.length === 0 && <EmptyState>No readings match these filters.</EmptyState>}
    </details>
    {cursor && <button className="button load-more" disabled={loading} onClick={() => void loadMore()}>{loading ? 'Loading…' : 'Load older readings'}</button>}
  </>
}

export function HeartbeatsScreen({ adminToken, nodes }: { adminToken: string; nodes: DashboardNode[] }) {
  const [nodeId, setNodeId] = useState('all')
  const [timeRange, setTimeRange] = useState<HeartbeatRange>('1h')
  const [rows, setRows] = useState<DashboardHeartbeat[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    void dashboardApi.getHeartbeatsPage(adminToken, {
      nodeId: nodeId === 'all' ? undefined : nodeId,
      receivedAfter: rangeStart(timeRange), limit: 200,
    }, controller.signal)
      .then((page) => { setRows(page.items); setCursor(page.next_cursor) })
      .catch((reason: unknown) => { if (!controller.signal.aborted) setError(getMessage(reason, 'Could not load heartbeats.')) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [adminToken, nodeId, timeRange])

  const loadMore = async () => {
    if (!cursor) return
    setLoading(true)
    try {
      const page = await dashboardApi.getHeartbeatsPage(adminToken, {
        nodeId: nodeId === 'all' ? undefined : nodeId,
        receivedAfter: rangeStart(timeRange), cursor, limit: 200,
      })
      setRows((previous) => [...previous, ...page.items])
      setCursor(page.next_cursor)
    } catch (reason) { setError(getMessage(reason, 'Could not load more heartbeats.')) }
    finally { setLoading(false) }
  }

  return <>
    <PageHeader title="Heartbeats" />
    {error && <Notice>{error}</Notice>}
    <div className="filters">
      <label>Node <select value={nodeId} onChange={(event) => {
        setNodeId(event.target.value); setLoading(true); setError(''); setRows([]); setCursor(null)
      }}>
        <option value="all">All Nodes</option>{nodes.map((node) => <option key={node.node_id} value={node.node_id}>{node.node_id}</option>)}
      </select></label>
      <label>Received <select value={timeRange} onChange={(event) => {
        setTimeRange(event.target.value as HeartbeatRange); setLoading(true); setError(''); setRows([]); setCursor(null)
      }}>
        {heartbeatRangeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select></label>
    </div>
    <div className="heartbeat-health-grid">{(nodeId === 'all' ? nodes : nodes.filter((node) => node.node_id === nodeId)).map((node) => <article className="heartbeat-health-card" key={node.node_id}>
      <div className={`heartbeat-pulse pulse-${node.status === 'ACTIVE' ? node.connection_status.toLowerCase() : 'offline'}`} aria-label={`${node.status === 'ACTIVE' ? node.connection_status : 'REVOKED'} heartbeat freshness indicator`}><i /></div>
      <div className="heartbeat-health-info"><strong>{node.node_id}</strong><span>{node.status === 'ACTIVE' ? node.connection_status : 'REVOKED'} · received {formatAgo(node.last_heartbeat_received_at ?? null)}</span></div>
      <small>{node.last_heartbeat_received_at ? new Date(node.last_heartbeat_received_at).toLocaleString() : 'No heartbeat received'}</small>
    </article>)}</div>
    <p className="heartbeat-visual-note">Pulse animation represents backend heartbeat freshness status only. It is not a live electrical waveform and does not create heartbeat events.</p>
    {nodeId !== 'all' && <HeartbeatTimeline heartbeats={rows} range={timeRange} />}
    {loading && rows.length === 0 ? <div className="empty-state" role="status">Loading heartbeats…</div> : <DataTable headers={['ID', 'Node', 'Device Timestamp', 'Received At', 'Reported IP', 'Reported MAC', 'RSSI']}>
      {rows.map((heartbeat) => <tr key={heartbeat.id}>
        <td>{heartbeat.id}</td><td>{heartbeat.node_id}</td><td>{new Date(heartbeat.timestamp).toLocaleString()}</td><td>{new Date(heartbeat.received_at).toLocaleString()}</td>
        <td>{heartbeat.reported_ip ?? '—'}</td><td>{heartbeat.reported_mac ?? '—'}</td><td>{heartbeat.reported_rssi_dbm === null ? '—' : `${heartbeat.reported_rssi_dbm} dBm`}</td>
      </tr>)}
    </DataTable>}
    {!loading && rows.length === 0 && <EmptyState>No heartbeat records match these filters.</EmptyState>}
    {cursor && <button className="button load-more" disabled={loading} onClick={() => void loadMore()}>{loading ? 'Loading…' : 'Load older heartbeats'}</button>}
  </>
}
