import { useEffect, useMemo, useState } from 'react'
import type { DashboardNode, DashboardReading } from '../types/dashboard'
import { dashboardApi } from '../services/dashboardApi'

type RangeHours = 1 | 2 | 6 | 24
type SensorChoice = { key: string; sensorType: string; sensorId: string }
type NodeSeries = { nodeId: string; readings: DashboardReading[] }

const allNodesOption = '__ALL_NODES__'
const nodeLineColors = ['#57b8e8', '#77c99c', '#b69ae8', '#e5b765', '#6fc7c3', '#e78e83', '#9dafc1', '#df87bc', '#88b66d', '#d28d5c', '#67a6c7', '#bd9e68']
function nodeLineColor(index: number) {
  return nodeLineColors[index] ?? `hsl(${(index * 137.508) % 360} 55% 67%)`
}

const ranges: { value: RangeHours; label: string }[] = [
  { value: 1, label: '1 hour' }, { value: 2, label: '2 hours' },
  { value: 6, label: '6 hours' }, { value: 24, label: '24 hours' },
]
const ignoreRowsChange = () => undefined

function metricLabel(sensorType: string) {
  return sensorType ? `${sensorType[0].toUpperCase()}${sensorType.slice(1)}` : sensorType
}

const plot = { left: 58, right: 820, top: 30, bottom: 230 }

const temperatureThresholds = [16, 20, 25, 30, 40]
const temperatureDeadband = 0.5

function temperatureCategory(value: number) {
  if (value < 16) return 'Cold'
  if (value <= 20) return 'Cool'
  if (value <= 25) return 'Normal'
  if (value <= 30) return 'Medium / Warm'
  if (value <= 40) return 'High'
  return 'Extreme'
}

function yFor(value: number, min: number, max: number) {
  const bounded = Math.min(max, Math.max(min, value))
  return plot.top + (max - bounded) / (max - min) * (plot.bottom - plot.top)
}

function pointFor(reading: DashboardReading, min: number, max: number, start: number, end: number) {
  const time = new Date(reading.timestamp).getTime()
  const fraction = end > start ? Math.min(1, Math.max(0, (time - start) / (end - start))) : 0.5
  const x = plot.left + fraction * (plot.right - plot.left)
  return {
    x,
    y: yFor(reading.value, min, max),
    outside: reading.value < min || reading.value > max,
  }
}

function crossesTemperatureThreshold(previous: number, current: number) {
  return temperatureThresholds.some((threshold) =>
    (previous < threshold && current >= threshold) || (previous >= threshold && current < threshold))
}

function reduceDisplayJitter(segment: DashboardReading[], temperature: boolean) {
  if (!temperature || segment.length <= 2) return segment
  const displayed = [segment[0]]
  for (let index = 1; index < segment.length - 1; index += 1) {
    const candidate = segment[index]
    const previous = displayed[displayed.length - 1]
    if (Math.abs(candidate.value - previous.value) >= temperatureDeadband
      || crossesTemperatureThreshold(previous.value, candidate.value)) displayed.push(candidate)
  }
  const last = segment[segment.length - 1]
  if (displayed[displayed.length - 1] !== last) displayed.push(last)
  return displayed
}

function timeLabel(time: number, range: RangeHours) {
  const date = new Date(time)
  return new Intl.DateTimeFormat('en-GB', range === 24
    ? { timeZone: 'Asia/Riyadh', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }
    : { timeZone: 'Asia/Riyadh', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date)
}

function timestampLabel(time: string) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Riyadh', dateStyle: 'medium', timeStyle: 'medium', hourCycle: 'h23' }).format(new Date(time))
}

function gapThresholdFor(readings: DashboardReading[]) {
  const intervals = readings.slice(1).map((reading, index) => new Date(reading.timestamp).getTime() - new Date(readings[index].timestamp).getTime())
    .filter((interval) => interval > 0).sort((a, b) => a - b)
  const median = intervals.length ? intervals[Math.floor((intervals.length - 1) / 2)] : 0
  return median ? median * 3 : 60_000
}

function splitAtGaps(readings: DashboardReading[], gapThreshold: number) {
  const result: DashboardReading[][] = []
  readings.forEach((reading) => {
    const current = result[result.length - 1]
    const previous = current?.[current.length - 1]
    if (!previous || new Date(reading.timestamp).getTime() - new Date(previous.timestamp).getTime() > gapThreshold) result.push([reading])
    else current.push(reading)
  })
  return result
}

export function HistoricalTrend({ adminToken, nodes, onRowsChange = ignoreRowsChange, initialNodeId = 'NODE-03', fixedNode = false }: {
  adminToken: string
  nodes: DashboardNode[]
  onRowsChange?: (nodeId: string, rows: DashboardReading[]) => void
  initialNodeId?: string
  fixedNode?: boolean
}) {
  const [nodeId, setNodeId] = useState(initialNodeId)
  const [sensorKey, setSensorKey] = useState('temperature')
  const [sensorLabel, setSensorLabel] = useState('Temperature')
  const [range, setRange] = useState<RangeHours>(1)
  const [rows, setRows] = useState<DashboardReading[]>([])
  const [seriesEndTime, setSeriesEndTime] = useState(0)
  const [loadedFor, setLoadedFor] = useState('')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let inFlight = false
    let initial = true
    const controller = new AbortController()
    const refreshSeries = async () => {
      if (inFlight) return
      inFlight = true
      if (!initial) setRefreshing(true)
      const end = new Date()
      const start = new Date(end.getTime() - range * 60 * 60_000)
      try {
        const result = await dashboardApi.getAllReadings(adminToken, {
          nodeId: nodeId === allNodesOption ? undefined : nodeId, start: start.toISOString(), end: end.toISOString(),
        }, controller.signal)
        if (controller.signal.aborted) return
        setRows(result)
        setLoadedFor(`${nodeId}/${range}`)
        setSeriesEndTime(end.getTime())
        const initialTemperature = result.filter((reading) => reading.sensor_type.toLowerCase() === 'temperature')
          .sort((a, b) => a.sensor_id.localeCompare(b.sensor_id))[0]
        if (initialTemperature) {
          const initialKey = `${initialTemperature.sensor_type}::${initialTemperature.sensor_id}`
          setSensorKey((current) => current === 'temperature' ? initialKey : current)
          setSensorLabel((current) => current === 'Temperature' ? `${metricLabel(initialTemperature.sensor_type)} · ${initialTemperature.sensor_id}` : current)
        }
        setError('')
        if (nodeId !== allNodesOption) onRowsChange(nodeId, result)
      } catch (reason) {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Historical readings could not be refreshed.')
      } finally {
        inFlight = false
        initial = false
        if (!controller.signal.aborted) { setLoading(false); setRefreshing(false) }
      }
    }
    void refreshSeries()
    const timer = window.setInterval(() => void refreshSeries(), 30_000)
    return () => { window.clearInterval(timer); controller.abort() }
  }, [adminToken, nodeId, range, onRowsChange])

  const choices = useMemo(() => {
    const unique = new Map<string, SensorChoice>()
    ;(loadedFor === `${nodeId}/${range}` ? rows : []).forEach((reading) => {
      const key = `${reading.sensor_type}::${reading.sensor_id}`
      unique.set(key, { key, sensorType: reading.sensor_type, sensorId: reading.sensor_id })
    })
    return [...unique.values()].sort((a, b) => a.sensorType.localeCompare(b.sensorType) || a.sensorId.localeCompare(b.sensorId))
  }, [rows, loadedFor, nodeId, range])
  const selectedChoice = choices.find((choice) => choice.key === sensorKey)
    ?? (sensorKey === 'temperature' ? choices.find((choice) => choice.sensorType.toLowerCase() === 'temperature') : undefined)
  const endTime = seriesEndTime
  const startTime = endTime - range * 60 * 60_000
  const series = useMemo(() => selectedChoice && loadedFor === `${nodeId}/${range}`
    ? rows.filter((reading) => reading.sensor_type === selectedChoice.sensorType && reading.sensor_id === selectedChoice.sensorId
      && new Date(reading.timestamp).getTime() >= startTime && new Date(reading.timestamp).getTime() <= endTime)
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.id - b.id)
    : [], [selectedChoice, loadedFor, nodeId, range, rows, startTime, endTime])
  const nodeSeries = useMemo<NodeSeries[]>(() => {
    const groups = new Map<string, DashboardReading[]>()
    series.forEach((reading) => {
      const group = groups.get(reading.node_id) ?? []
      group.push(reading)
      groups.set(reading.node_id, group)
    })
    return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right))
      .map(([nodeId, readings]) => ({ nodeId, readings }))
  }, [series])
  const values = series.map((reading) => reading.value).filter(Number.isFinite)
  const isCelsiusTemperature = (selectedChoice?.sensorType ?? 'temperature').toLowerCase() === 'temperature'
    && ['c', '°c'].includes((series[0]?.unit ?? '').trim().toLowerCase())
  const dataMin = values.length ? Math.min(...values) : 0
  const dataMax = values.length ? Math.max(...values) : 1
  const padding = Math.max((dataMax - dataMin) * 0.12, Math.abs(dataMax || dataMin) * 0.015, 0.5)
  const min = isCelsiusTemperature ? 16 : dataMin - padding
  const max = isCelsiusTemperature ? 40 : dataMax + padding
  const tickValues = isCelsiusTemperature ? [40, 30, 20, 16] : Array.from({ length: 5 }, (_, index) => max - (max - min) * index / 4)
  const axisDecimals = isCelsiusTemperature ? 0 : (max - min) / 4 < 0.1 ? 2 : 1
  const validationCounts = useMemo(() => series.reduce((counts, reading) => {
    counts[reading.validation_status] = (counts[reading.validation_status] ?? 0) + 1
    return counts
  }, {} as Record<string, number>), [series])
  const coldCount = isCelsiusTemperature ? values.filter((value) => value < 16).length : 0
  const extremeCount = isCelsiusTemperature ? values.filter((value) => value > 40).length : 0
  const latestByNode = nodeSeries.map((node) => ({ nodeId: node.nodeId, reading: node.readings[node.readings.length - 1] }))
  const latestReading = latestByNode.find((item) => item.nodeId === nodeId)?.reading ?? series[series.length - 1]
  const lineSeries = useMemo(() => nodeSeries.map((node) => {
    const gapThreshold = gapThresholdFor(node.readings)
    const rawSegments = splitAtGaps(node.readings, gapThreshold)
    const displaySegments = rawSegments.flatMap((segment) => {
      // Out-of-focus values and invalid readings remain available as anomalies, but do not bend the operational trend line.
      const usable: DashboardReading[][] = []
      segment.forEach((reading) => {
        const outOfFocus = isCelsiusTemperature && (reading.value < 16 || reading.value > 40)
        if (outOfFocus || reading.validation_status === 'INVALID') usable.push([])
        else {
          if (!usable.length || usable[usable.length - 1].length === 0) usable.push([])
          usable[usable.length - 1].push(reading)
        }
      })
      return usable.filter((part) => part.length > 0).map((part) => reduceDisplayJitter(part, isCelsiusTemperature))
    })
    const outsideEvents: { readings: DashboardReading[]; above: boolean }[] = []
    let currentEvent: { readings: DashboardReading[]; above: boolean } | undefined
    if (isCelsiusTemperature) node.readings.forEach((reading) => {
      if (reading.value >= 16 && reading.value <= 40) { currentEvent = undefined; return }
      const above = reading.value > 40
      const previousTime = currentEvent?.readings[currentEvent.readings.length - 1].timestamp
      const withinGap = previousTime && new Date(reading.timestamp).getTime() - new Date(previousTime).getTime() <= gapThreshold
      if (currentEvent && currentEvent.above === above && withinGap) currentEvent.readings.push(reading)
      else {
        currentEvent = { readings: [reading], above }
        outsideEvents.push(currentEvent)
      }
    })
    return { ...node, gapThreshold, rawSegments, displaySegments, outsideEvents }
  }), [nodeSeries, isCelsiusTemperature])
  const hasGap = lineSeries.some((node) => node.rawSegments.length > 1)
  const validationMarkerIds = useMemo(() => {
    const buckets = new Map<string, number>()
    series.forEach((reading) => {
      if (reading.validation_status !== 'SUSPICIOUS' && reading.validation_status !== 'INVALID') return
      const bucket = Math.floor(new Date(reading.timestamp).getTime() / 300_000)
      const key = `${reading.node_id}/${reading.validation_status}/${bucket}`
      if (!buckets.has(key)) buckets.set(key, reading.id)
    })
    return new Set(buckets.values())
  }, [series])
  const currentNode = nodes.find((node) => node.node_id === nodeId)
  const currentType = selectedChoice?.sensorType ?? 'temperature'
  const currentSensor = selectedChoice?.sensorId
  const timezone = 'Asia/Riyadh'
  const timeTicks = Array.from({ length: 3 }, (_, index) => startTime + (endTime - startTime) * index / 2)

  return <section className="trend-panel" aria-label="Historical sensor readings">
    <div className="trend-heading"><div><h2>Sensor history</h2><p>{nodeId === allNodesOption ? 'Compare matching sensor readings across nodes' : 'Timestamped readings from the selected node'} · refreshed every 30 seconds</p></div><span className={`trend-node-status ${nodeId === allNodesOption ? 'status-neutral' : currentNode?.status === 'ACTIVE' ? `status-${currentNode.connection_status.toLowerCase()}` : 'status-neutral'}`}>{nodeId === allNodesOption ? 'COMPARISON' : currentNode?.status === 'ACTIVE' ? currentNode.connection_status : currentNode ? currentNode.status : 'Node data unavailable'}</span></div>
    <div className="trend-controls">
      <label>Node<select value={nodeId} disabled={fixedNode} onChange={(event) => {
        const nextNodeId = event.target.value
        setLoading(true); setNodeId(nextNodeId); setSensorKey('temperature'); setSensorLabel('Temperature')
        if (nextNodeId !== allNodesOption) onRowsChange(nextNodeId, [])
      }}>
        <option value={allNodesOption}>All Nodes</option>
        {!nodes.some((node) => node.node_id === 'NODE-03') && <option value="NODE-03">NODE-03 · default</option>}
        {!nodes.some((node) => node.node_id === nodeId) && nodeId !== 'NODE-03' && nodeId !== allNodesOption && <option value={nodeId}>{nodeId} · not in node list</option>}
        {nodes.map((node) => <option key={node.node_id} value={node.node_id}>{node.node_id}</option>)}
      </select></label>
      <label>Sensor<select aria-label="Select sensor series" value={selectedChoice?.key ?? sensorKey} onChange={(event) => {
        const choice = choices.find((item) => item.key === event.target.value)
        setSensorKey(event.target.value)
        if (choice) setSensorLabel(`${metricLabel(choice.sensorType)} · ${choice.sensorId}`)
      }}>
        {!selectedChoice && <option value={sensorKey} disabled>{loading ? 'Loading available sensors…' : `${sensorLabel} · no readings`}</option>}
        {choices.map((choice) => <option key={choice.key} value={choice.key}>{metricLabel(choice.sensorType)} · {choice.sensorId}</option>)}
      </select></label>
      <label>Range<select value={range} onChange={(event) => { setLoading(true); setRange(Number(event.target.value) as RangeHours) }}>
        {ranges.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select></label>
    </div>
    {error && <div className="trend-error" role="status">Refresh issue · last successful readings are retained for this selection where available.</div>}
    {series.length > 0 && nodeId === allNodesOption && <div className="trend-multinode-summary">
      <div className="trend-multinode-heading"><strong>{metricLabel(currentType)} · {currentSensor ?? 'selected sensor'}</strong><span>Latest in range · Asia/Riyadh</span></div>
      <div className="trend-node-latest">{latestByNode.map(({ nodeId: latestNodeId, reading }) => <div className="trend-node-latest-item" key={latestNodeId}>
        <span>{latestNodeId}</span><strong>{reading.value} {reading.unit}</strong>{isCelsiusTemperature && <em>{temperatureCategory(reading.value)}</em>}
      </div>)}</div>
    </div>}
    {series.length > 0 && nodeId !== allNodesOption && <div className="trend-summary-row">
      <div className="trend-latest"><span>Latest</span><strong>{latestReading?.value} {latestReading?.unit}</strong>{isCelsiusTemperature && latestReading && <em>{temperatureCategory(latestReading.value)}</em>}<small>{latestReading ? timestampLabel(latestReading.timestamp) : ''} · Asia/Riyadh</small></div>
      <div className="trend-counts" aria-label="Reading summary">
        <span>{series.length} readings</span>
        {(validationCounts.SUSPICIOUS ?? 0) > 0 && <span className="count-questionable">{validationCounts.SUSPICIOUS} suspicious</span>}
        {(validationCounts.INVALID ?? 0) > 0 && <span className="count-invalid">{validationCounts.INVALID} invalid</span>}
        {coldCount > 0 && <span>{coldCount} below 16°</span>}{extremeCount > 0 && <span className="count-invalid">{extremeCount} above 40°</span>}
      </div>
    </div>}
    <div className="trend-chart" aria-busy={loading || refreshing}>
      {series.length > 0 ? <>
        <div className="trend-value-axis" aria-hidden="true">{tickValues.map((value, index) => <span key={index}>{value.toFixed(axisDecimals)}{isCelsiusTemperature ? '°' : ''}</span>)}</div>
        <svg viewBox="0 0 840 260" preserveAspectRatio="none" role="img" aria-label={`${metricLabel(currentType)} history for ${currentSensor ?? nodeId}, ${range} hours, timestamps in ${timezone}.` }>
          <defs><clipPath id="trend-plot-area"><rect x={plot.left} y={plot.top} width={plot.right - plot.left} height={plot.bottom - plot.top} /></clipPath></defs>
          {tickValues.map((_, index) => {
            const y = plot.top + (plot.bottom - plot.top) * index / 4
            return <line key={index} x1={plot.left} y1={y} x2={plot.right} y2={y} className="chart-grid-line" />
          })}
          {isCelsiusTemperature && temperatureThresholds.map((value) => <line key={value} x1={plot.left} y1={yFor(value, min, max)} x2={plot.right} y2={yFor(value, min, max)} className={`temperature-threshold threshold-${value}`} />)}
          {lineSeries.flatMap((node, nodeIndex) => node.outsideEvents.map((event, index) => {
            const first = pointFor(event.readings[0], min, max, startTime, endTime)
            const last = pointFor(event.readings[event.readings.length - 1], min, max, startTime, endTime)
            const y = event.above ? plot.top : plot.bottom
            const eventValues = event.readings.map((reading) => reading.value)
            const title = `${node.nodeId}: ${event.readings.length} ${event.above ? 'readings above 40°C' : 'readings below 16°C'}, ${Math.min(...eventValues)}–${Math.max(...eventValues)}°C; ${timestampLabel(event.readings[0].timestamp)} to ${timestampLabel(event.readings[event.readings.length - 1].timestamp)} Asia/Riyadh`
            return <line key={`outside-${node.nodeId}-${index}`} x1={first.x} y1={y} x2={Math.max(first.x + 2, last.x)} y2={y} className={`trend-edge-anomaly ${event.above ? 'anomaly-high' : 'anomaly-low'}`} style={{ stroke: nodeLineColor(nodeIndex) }}><title>{title}</title></line>
          }))}
          <g clipPath="url(#trend-plot-area)">
            {lineSeries.flatMap((node, nodeIndex) => node.displaySegments.map((segment, segmentIndex) => segment.length > 1 && <polyline key={`${node.nodeId}/${segmentIndex}`} points={segment.map((reading) => {
              const point = pointFor(reading, min, max, startTime, endTime)
              return `${point.x.toFixed(1)},${point.y.toFixed(1)}`
            }).join(' ')} className="trend-line" style={{ stroke: nodeLineColor(nodeIndex) }} />))}
          </g>
          {series.map((reading) => {
            const point = pointFor(reading, min, max, startTime, endTime)
            const category = isCelsiusTemperature ? ` · ${temperatureCategory(reading.value)}` : ''
            const title = `${nodeId === allNodesOption ? `${reading.node_id} · ` : ''}${reading.value} ${reading.unit}${category} · ${reading.validation_status}${point.outside ? ` · ${reading.value > max ? 'above 40°C' : 'below 16°C'}; actual value retained` : ''} · ${timestampLabel(reading.timestamp)} Asia/Riyadh`
            const markerClass = `trend-marker marker-${reading.validation_status.toLowerCase()}${point.outside ? ' marker-outlier' : ''}`
            const rawTooltip = <circle key={`raw-${reading.id}`} cx={point.x} cy={point.y} r="7" className="raw-reading-hit"><title>{title}</title></circle>
            if (point.outside || reading.validation_status === 'NORMAL' || reading.validation_status === 'UNKNOWN'
              || !validationMarkerIds.has(reading.id)) return rawTooltip
            if (reading.validation_status === 'SUSPICIOUS') return <g key={reading.id}>{rawTooltip}<polygon points={`${point.x},${point.y - 3.5} ${point.x + 3.5},${point.y} ${point.x},${point.y + 3.5} ${point.x - 3.5},${point.y}`} className={markerClass} /></g>
            if (reading.validation_status === 'INVALID') return <g key={reading.id}>{rawTooltip}<path d={`M${point.x - 3} ${point.y - 3} L${point.x + 3} ${point.y + 3} M${point.x + 3} ${point.y - 3} L${point.x - 3} ${point.y + 3}`} className={markerClass} /></g>
            return rawTooltip
          })}
        </svg>
        <div className="trend-time-axis" aria-label={`Time axis, ${timezone}`}>
          {timeTicks.map((time, index) => <span className={`trend-time-tick trend-time-tick-${index}`} key={index}>{timeLabel(time, range)}</span>)}
        </div>
      </> : <div className="trend-empty">{loading ? 'Loading the selected time range…' : nodeId === allNodesOption ? 'No readings available for the selected sensor and time range.' : `No ${metricLabel(currentType).toLowerCase()} readings for this node in the last ${range} ${range === 1 ? 'hour' : 'hours'}.`}</div>}
    </div>
    {series.length > 0 && nodeId === allNodesOption && <div className="trend-node-legend" aria-label="Node line legend">{lineSeries.map((node, index) => <span key={node.nodeId}><i style={{ backgroundColor: nodeLineColor(index) }} />{node.nodeId}</span>)}</div>}
    {series.length > 0 && <p className="trend-note">{isCelsiusTemperature ? `16–40°C view · ${temperatureDeadband.toFixed(1)}° display deadband · edge bars mark out-of-range readings. ` : ''}{hasGap ? 'Line breaks mark missing intervals. ' : ''}Hover the line for raw values.</p>}
  </section>
}
