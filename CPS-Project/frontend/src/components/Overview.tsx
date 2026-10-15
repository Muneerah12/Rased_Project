import { useCallback, useMemo, useState } from 'react'
import type { DragEvent } from 'react'
import type { DashboardLocation, DashboardNode, DashboardReading } from '../types/dashboard'
import { ConnectionBadge, EmptyState, formatAgo } from './Primitives'
import { HistoricalTrend } from './HistoricalTrend'
import { LocationHeatmap } from './LocationHeatmap'
import { RiyadhWeather } from './RiyadhWeather'

type ReadingSnapshot = { nodeId: string; rows: DashboardReading[] }
type OverviewSection = 'context' | 'history' | 'coverage'

// Firmware posts the sensor values sequentially in one sampling cycle; pair only within 10 seconds.
const APPARENT_PAIR_TOLERANCE_MS = 10_000
const defaultSectionOrder: OverviewSection[] = ['context', 'history', 'coverage']

function systemState(nodes: DashboardNode[]) {
  const active = nodes.filter((node) => node.status === 'ACTIVE')
  if (!active.length) return { label: 'No active nodes', kind: 'neutral' }
  if (active.some((node) => node.connection_status === 'OFFLINE')) return { label: 'Attention required', kind: 'offline' }
  if (active.some((node) => node.connection_status === 'STALE')) return { label: 'Degraded', kind: 'stale' }
  return { label: 'Operational', kind: 'online' }
}

function celsiusTemperatureCategory(value: number) {
  if (value < 16) return 'Cold'
  if (value <= 20) return 'Cool'
  if (value <= 25) return 'Normal'
  if (value <= 30) return 'Medium / Warm'
  if (value <= 40) return 'High'
  return 'Extreme'
}

// National Weather Service heat-index method (Rothfusz regression with the NWS low-range blend).
// This humidity-based estimate represents shaded conditions and does not account for wind or radiation.
function heatIndexCelsius(celsius: number, humidity: number) {
  const temperature = celsius * 9 / 5 + 32
  const simple = 0.5 * (temperature + 61 + (temperature - 68) * 1.2 + humidity * 0.094)
  const blended = (simple + temperature) / 2
  if (blended < 80) return (blended - 32) * 5 / 9
  let index = -42.379 + 2.04901523 * temperature + 10.14333127 * humidity
    - 0.22475541 * temperature * humidity - 0.00683783 * temperature ** 2
    - 0.05481717 * humidity ** 2 + 0.00122874 * temperature ** 2 * humidity
    + 0.00085282 * temperature * humidity ** 2 - 0.00000199 * temperature ** 2 * humidity ** 2
  if (humidity < 13 && temperature >= 80 && temperature <= 112) {
    index -= ((13 - humidity) / 4) * Math.sqrt((17 - Math.abs(temperature - 95)) / 17)
  } else if (humidity > 85 && temperature >= 80 && temperature <= 87) {
    index += ((humidity - 85) / 10) * ((87 - temperature) / 5)
  }
  return (index - 32) * 5 / 9
}

function latestPairedHeatIndex(readings: DashboardReading[]) {
  type TimedReading = { reading: DashboardReading; time: number }
  const groups = new Map<string, { temperatures: TimedReading[]; humidities: TimedReading[] }>()
  readings.forEach((reading) => {
    // Keep questionable observations visible in history, but do not use them to derive an estimate.
    if (!Number.isFinite(reading.value) || !['NORMAL', 'UNKNOWN'].includes(reading.validation_status)) return
    const type = reading.sensor_type.toLowerCase()
    const unit = reading.unit.trim().toLowerCase()
    const isTemperature = type === 'temperature' && ['c', '°c'].includes(unit)
    const isHumidity = type === 'humidity' && ['%', 'percent'].includes(unit) && reading.value >= 0 && reading.value <= 100
    if (!isTemperature && !isHumidity) return
    const time = Date.parse(reading.timestamp)
    if (!Number.isFinite(time)) return
    const context = `${reading.node_id}|${reading.location_id ?? ''}`
    const group = groups.get(context) ?? { temperatures: [], humidities: [] }
    ;(isTemperature ? group.temperatures : group.humidities).push({ reading, time })
    groups.set(context, group)
  })

  let latest: { temperature: DashboardReading; humidity: DashboardReading; value: number; pairedAt: number } | null = null
  for (const { temperatures, humidities } of groups.values()) {
    temperatures.sort((a, b) => a.time - b.time)
    humidities.sort((a, b) => a.time - b.time)
    let temperatureIndex = 0
    let humidityIndex = 0
    while (temperatureIndex < temperatures.length && humidityIndex < humidities.length) {
      const temperature = temperatures[temperatureIndex]
      const humidity = humidities[humidityIndex]
      const difference = temperature.time - humidity.time
      if (Math.abs(difference) <= APPARENT_PAIR_TOLERANCE_MS) {
        const pairedAt = Math.max(temperature.time, humidity.time)
        if (!latest || pairedAt > latest.pairedAt) {
          latest = {
            temperature: temperature.reading,
            humidity: humidity.reading,
            value: heatIndexCelsius(temperature.reading.value, humidity.reading.value),
            pairedAt,
          }
        }
        if (difference <= 0) temperatureIndex++
        if (difference >= 0) humidityIndex++
      } else if (difference < 0) temperatureIndex++
      else humidityIndex++
    }
  }
  return latest
}

function sectionLabel(section: OverviewSection) {
  return section === 'coverage' ? 'Facility Sensor Coverage' : section === 'history' ? 'Sensor History' : 'Current sensor summary and weather'
}

export function Overview({ nodes, readings, locations, adminToken, errors, lastUpdated, isRefreshing }: {
  nodes: DashboardNode[]
  readings: DashboardReading[]
  locations: DashboardLocation[]
  adminToken: string
  errors: Partial<Record<'nodes' | 'readings' | 'heartbeats' | 'locations', string>>
  lastUpdated: string | null
  isRefreshing: boolean
}) {
  const [readingSnapshot, setReadingSnapshot] = useState<ReadingSnapshot>({ nodeId: '', rows: [] })
  const [sectionOrder, setSectionOrder] = useState<OverviewSection[]>(defaultSectionOrder)
  const [draggedSection, setDraggedSection] = useState<OverviewSection | null>(null)
  const [reorderMessage, setReorderMessage] = useState('')
  const onRowsChange = useCallback((nodeId: string, rows: DashboardReading[]) => {
    setReadingSnapshot({ nodeId, rows })
  }, [])
  const counts = useMemo(() => ({
    online: nodes.filter((node) => node.status === 'ACTIVE' && node.connection_status === 'ONLINE').length,
    stale: nodes.filter((node) => node.status === 'ACTIVE' && node.connection_status === 'STALE').length,
    offline: nodes.filter((node) => node.status === 'ACTIVE' && node.connection_status === 'OFFLINE').length,
    deployedLocations: locations.filter((location) => location.deployment_status === 'DEPLOYED').length,
  }), [nodes, locations])
  const state = !lastUpdated && !nodes.length
    ? { label: isRefreshing ? 'Connecting' : 'Awaiting data', kind: 'neutral' }
    : systemState(nodes)
  const failedResources = Object.keys(errors)
  const currentNode = nodes.find((node) => node.node_id === readingSnapshot.nodeId)
  const currentLocation = locations.find((location) => location.location_id === currentNode?.location_id)
  const latestByType = useMemo(() => {
    const latest = new Map<string, DashboardReading>()
    readingSnapshot.rows.forEach((reading) => {
      const previous = latest.get(reading.sensor_type)
      if (!previous || reading.timestamp > previous.timestamp) latest.set(reading.sensor_type, reading)
    })
    return latest
  }, [readingSnapshot.rows])
  const currentLocationId = currentNode?.location_id ?? null
  const apparentTemperature = useMemo(() => latestPairedHeatIndex(readingSnapshot.rows.filter((reading) =>
    reading.node_id === readingSnapshot.nodeId && (reading.location_id ?? null) === currentLocationId)),
  [readingSnapshot.rows, readingSnapshot.nodeId, currentLocationId])
  const renderLiveValue = (type: string, primary: boolean) => {
    const reading = latestByType.get(type)
    const isTemperature = type.toLowerCase() === 'temperature' && reading && ['c', '°c'].includes(reading.unit.trim().toLowerCase())
    const validation = reading?.validation_status
    const ruleStatus = reading && isTemperature ? celsiusTemperatureCategory(reading.value)
      : reading && validation === 'NORMAL' ? 'Normal' : null
    const validationNote = validation === 'UNKNOWN' ? 'Unassessed'
      : validation && validation !== 'NORMAL' ? `Validation: ${validation[0]}${validation.slice(1).toLowerCase()}` : null
    return <article className={`live-value ${primary ? 'live-value-primary' : 'live-value-extra'}`} key={type}>
      <div><span>{type}</span></div>
      {reading ? <>
        <strong>{reading.value}<small>{reading.unit}</small></strong>
        {ruleStatus && <span className={`live-rule-status ${isTemperature ? `category-${ruleStatus.toLowerCase().replace(/[^a-z]+/g, '-')}` : ''}`}>{ruleStatus}</span>}
        <footer>{reading.sensor_id} · {new Date(reading.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}{validationNote && <small className={`live-validation ${validation === 'SUSPICIOUS' || validation === 'INVALID' ? `validation-${validation.toLowerCase()}` : ''}`}>{validationNote}</small>}</footer>
      </> : <div className="live-no-reading">No reading in this time range</div>}
    </article>
  }

  const moveSection = (section: OverviewSection, targetIndex: number) => {
    const currentIndex = sectionOrder.indexOf(section)
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= sectionOrder.length || currentIndex === targetIndex) return
    const next = [...sectionOrder]
    next.splice(currentIndex, 1)
    next.splice(targetIndex, 0, section)
    setSectionOrder(next)
    setReorderMessage(`${sectionLabel(section)} moved to position ${targetIndex + 1} of ${next.length}.`)
  }

  const startSectionDrag = (event: DragEvent<HTMLButtonElement>, section: OverviewSection) => {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', section)
    const card = event.currentTarget.closest('.overview-reorder-item')
    if (card) event.dataTransfer.setDragImage(card, Math.min(80, card.clientWidth / 3), 18)
    setDraggedSection(section)
  }

  return <div className="overview-dashboard">
    <header className="overview-heading">
      <div><p className="eyebrow">CPS / OT MONITORING</p><h1>Overview</h1></div>
      <div className="overview-system-state">
        <span className={`system-state-dot state-${state.kind}`} />
        <div><small>SYSTEM STATUS</small><strong>{state.label}</strong></div>
      </div>
      <div className="overview-updated"><small>LAST SUCCESSFUL UPDATE</small><strong>{lastUpdated ? new Date(lastUpdated).toLocaleString([], { dateStyle: 'medium', timeStyle: 'medium' }) : 'Waiting for data'}</strong><span>{isRefreshing ? 'Refreshing…' : 'Auto refresh · 5 sec'}</span></div>
    </header>
    {failedResources.length > 0 && <div className="overview-refresh-warning" role="status"><span className="warning-mark">!</span><span><strong>Some data could not be refreshed.</strong> Showing the last available values for: {failedResources.join(', ')}.</span></div>}

    <section className="overview-kpis" aria-label="System summary">
      <article className="overview-kpi kpi-online"><span>ONLINE NODES</span><strong>{nodes.length || lastUpdated ? counts.online : '—'}</strong><small>Active · heartbeat current</small></article>
      <article className="overview-kpi kpi-stale"><span>STALE NODES</span><strong>{nodes.length || lastUpdated ? counts.stale : '—'}</strong><small>Active · heartbeat delayed</small></article>
      <article className="overview-kpi kpi-offline"><span>OFFLINE NODES</span><strong>{nodes.length || lastUpdated ? counts.offline : '—'}</strong><small>Active · no recent heartbeat</small></article>
      <article className="overview-kpi kpi-locations"><span>DEPLOYED LOCATIONS</span><strong>{locations.length || lastUpdated ? counts.deployedLocations : '—'}</strong><small>From the CPS location catalogue</small></article>
    </section>

    <div className="overview-section-list" onDragOver={(event) => { if (draggedSection) { event.preventDefault(); event.dataTransfer.dropEffect = 'move' } }}>
      {sectionOrder.map((section, index) => <div
        className={`overview-reorder-item ${draggedSection === section ? 'is-dragging' : ''} ${draggedSection && draggedSection !== section ? 'is-drop-target' : ''}`}
        key={section}
        onDrop={(event) => {
          event.preventDefault()
          const source = event.dataTransfer.getData('text/plain') as OverviewSection
          if (sectionOrder.includes(source)) moveSection(source, index)
          setDraggedSection(null)
        }}
      >
        <div className="overview-reorder-tools" aria-label={`Reorder ${sectionLabel(section)}`}>
          <button
            className="overview-drag-handle"
            type="button"
            draggable
            aria-label={`Drag ${sectionLabel(section)} to reorder`}
            title="Drag this handle to move the whole section"
            onDragStart={(event) => startSectionDrag(event, section)}
            onDragEnd={() => setDraggedSection(null)}
          >⠿ <span>Drag section</span></button>
          <span className="overview-move-buttons">
            <button type="button" aria-label={`Move ${sectionLabel(section)} up`} disabled={index === 0} onClick={() => moveSection(section, index - 1)}>↑</button>
            <button type="button" aria-label={`Move ${sectionLabel(section)} down`} disabled={index === sectionOrder.length - 1} onClick={() => moveSection(section, index + 1)}>↓</button>
          </span>
        </div>

        {section === 'coverage' && <LocationHeatmap locations={locations} readings={readings} adminToken={adminToken} locationsLoading={isRefreshing && !locations.length && !errors.locations} locationsUnavailable={Boolean(errors.locations)} />}

        {section === 'context' && <div className="overview-context-row">
          <section className="live-summary" aria-label="Current CPS sensor summary">
            <div className="live-summary-heading"><div><p className="eyebrow">LIVE SENSOR SUMMARY</p><h2>{readingSnapshot.nodeId || 'NODE-03'}</h2></div>
              {currentNode?.status === 'ACTIVE' ? <ConnectionBadge status={currentNode.connection_status} /> : <span className="neutral-state">{currentNode ? currentNode.status : 'Waiting for node data'}</span>}
            </div>
            {currentNode && <p className="live-location">{currentLocation ? `Zone ${currentLocation.zone} · Hall ${currentLocation.hall} · Subzone ${currentLocation.subzone}` : currentNode.location_id ? `Location ${currentNode.location_id}` : 'Location unassigned'}</p>}
            {currentNode?.status === 'ACTIVE' && currentLocation?.deployment_status === 'DEPLOYED' ? <div className="live-values">
              <div className="live-primary-values">{['temperature', 'humidity', 'pressure'].map((type) => renderLiveValue(type, true))}</div>
              {[...latestByType.keys()].filter((type) => !['temperature', 'humidity', 'pressure'].includes(type.toLowerCase())).length > 0 && <div className="live-extra-values">{[...latestByType.keys()].filter((type) => !['temperature', 'humidity', 'pressure'].includes(type.toLowerCase())).sort().map((type) => renderLiveValue(type, false))}</div>}
              <article className="apparent-temperature-summary" aria-label="Humidity-adjusted apparent temperature">
                <div><span>Humidity-adjusted apparent temperature</span><small>ESTIMATE</small></div>
                {apparentTemperature ? <><strong>{apparentTemperature.value.toFixed(1)}<small>°C</small></strong><footer>{apparentTemperature.temperature.sensor_id} + {apparentTemperature.humidity.sensor_id} · paired within 10 sec · {formatAgo(new Date(apparentTemperature.pairedAt).toISOString())}</footer>{(apparentTemperature.temperature.validation_status === 'UNKNOWN' || apparentTemperature.humidity.validation_status === 'UNKNOWN') && <small className="live-validation">An input is unassessed</small>}</> : <><strong className="estimate-unavailable">Not available</strong><footer>Needs a usable same-node/location temperature + humidity pair within 10 sec</footer></>}
                <small className="estimate-method-note">Shaded estimate; excludes wind and radiation.</small>
              </article>
            </div> : <EmptyState>{!currentNode ? 'Waiting for the selected node reading series.' : currentNode.status !== 'ACTIVE' ? 'Live sensor values are unavailable because this node is not active.' : currentLocation?.deployment_status !== 'DEPLOYED' ? 'This node is not assigned to a deployed location.' : 'No readings were received for this node in the selected period.'}</EmptyState>}
            <p className="live-summary-note">Connection status reflects the node heartbeat; validation describes each reading.</p>
          </section>
          <RiyadhWeather />
        </div>}

        {section === 'history' && <HistoricalTrend adminToken={adminToken} nodes={nodes} onRowsChange={onRowsChange} />}
      </div>)}
      <span className="sr-only" aria-live="polite">{reorderMessage}</span>
    </div>
  </div>
}
