import { useEffect, useMemo, useState } from 'react'
import type { DashboardLocation, DashboardReading } from '../types/dashboard'
import { dashboardApi } from '../services/dashboardApi'
import { formatAgo } from './Primitives'

export function LocationHeatmap({ locations, readings: initialReadings, adminToken, locationsLoading = false, locationsUnavailable = false, compact = false }: {
  locations: DashboardLocation[]
  readings: DashboardReading[]
  adminToken: string
  locationsLoading?: boolean
  locationsUnavailable?: boolean
  compact?: boolean
}) {
  const [extraReadings, setExtraReadings] = useState<DashboardReading[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [openZones, setOpenZones] = useState<string[]>([])
  const [closedZones, setClosedZones] = useState<string[]>([])
  const [selectedMetric, setSelectedMetric] = useState('temperature')
  const deployedLocationIds = locations.filter((location) => location.deployment_status === 'DEPLOYED')
    .map((location) => location.location_id).join('|')
  useEffect(() => {
    const deployed = deployedLocationIds.split('|').filter(Boolean)
    if (!deployed.length) return
    const controller = new AbortController()
    let inFlight = false
    const refreshLocationReadings = () => {
      if (inFlight) return
      inFlight = true
      const end = new Date().toISOString()
      const start = new Date(new Date(end).getTime() - 24 * 60 * 60_000).toISOString()
      void Promise.all(deployed.map((locationId) => dashboardApi.getAllReadings(adminToken, { locationId, start, end }, controller.signal)))
        .then((items) => { setError(''); setExtraReadings(items.flat()) })
        .catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Could not load location readings.') })
        .finally(() => { inFlight = false; if (!controller.signal.aborted) setLoading(false) })
    }
    refreshLocationReadings()
    const interval = window.setInterval(refreshLocationReadings, 60_000)
    return () => { window.clearInterval(interval); controller.abort() }
  }, [adminToken, deployedLocationIds])

  const zones = useMemo(() => [...new Set(locations.map((location) => location.zone))].sort(), [locations])
  const readings = useMemo(() => {
    const byId = new Map<number, DashboardReading>()
    ;[...initialReadings, ...extraReadings].forEach((reading) => byId.set(reading.id, reading))
    return [...byId.values()]
  }, [initialReadings, extraReadings])
  const metricOptions = useMemo(() => [...new Set(readings.map((reading) => reading.sensor_type))].sort(), [readings])
  const toggle = (zone: string) => {
    if (compact) setOpenZones((current) => current.includes(zone) ? current.filter((item) => item !== zone) : [...current, zone])
    else setClosedZones((current) => current.includes(zone) ? current.filter((item) => item !== zone) : [...current, zone])
  }
  return <section className={`location-heatmap panel ${compact ? 'location-heatmap-compact' : ''}`} aria-label="Configured zone deployment and telemetry">
    <div className="heatmap-toolbar"><div><strong>Facility sensor coverage</strong><span>Real deployment locations · latest 24 hours</span></div><label>Metric <select aria-label="Heatmap metric" value={selectedMetric} onChange={(event) => setSelectedMetric(event.target.value)} disabled={!metricOptions.length}>
      {metricOptions.length > 0 && !metricOptions.includes(selectedMetric) && <option value={selectedMetric}>{selectedMetric[0]?.toUpperCase()}{selectedMetric.slice(1)} · no recent readings</option>}
      {metricOptions.length ? metricOptions.map((metric) => <option key={metric} value={metric}>{metric[0]?.toUpperCase()}{metric.slice(1)}</option>) : <option value="temperature">Waiting for readings</option>}
    </select></label></div>
    {loading && deployedLocationIds && <div className="location-loading" role="status">Loading location-tagged readings…</div>}
    {error && <div className="location-load-error">Location readings unavailable: {error}</div>}
    <div className="zone-overview-grid">
      {!locations.length && <div className="heatmap-empty" role="status">{locationsLoading ? 'Loading deployment locations…' : locationsUnavailable ? 'The location catalogue could not be refreshed.' : 'No locations are configured in the CPS catalogue.'}</div>}
      {zones.map((zone) => {
        const zoneLocations = locations.filter((location) => location.zone === zone)
        const ids = new Set(zoneLocations.map((location) => location.location_id))
        const zoneReadings = readings.filter((reading) => reading.location_id && ids.has(reading.location_id))
        const deployed = zoneLocations.filter((location) => location.deployment_status === 'DEPLOYED').length
        const deployedIds = new Set(zoneLocations.filter((location) => location.deployment_status === 'DEPLOYED').map((location) => location.location_id))
        const available = new Set(zoneReadings.filter((reading) => reading.location_id && deployedIds.has(reading.location_id) && reading.sensor_type === selectedMetric && Date.now() - new Date(reading.timestamp).getTime() <= 24 * 60 * 60_000).map((reading) => reading.location_id)).size
        const expanded = compact ? openZones.includes(zone) : !closedZones.includes(zone)
        return <section key={zone} className="zone-card">
          <button className="zone-card-toggle" aria-expanded={expanded} onClick={() => toggle(zone)}>
            <span className="zone-index">ZONE</span><strong>Zone {zone}</strong><span className="zone-count">{available} of {deployed} reporting {selectedMetric}</span><span className="zone-chevron">{expanded ? '−' : '+'}</span>
          </button>
          {expanded && <div className="zone-card-content">
            {[...new Set(zoneLocations.map((location) => location.hall))].sort().map((hall) => <section className="location-hall" key={hall}>
              <h4>Hall {hall}</h4><div className="location-grid">
                {zoneLocations.filter((location) => location.hall === hall).sort((a, b) => a.location_id.localeCompare(b.location_id, undefined, { numeric: true })).map((location) => {
                  const locationReadings = readings.filter((reading) => reading.location_id === location.location_id && Date.now() - new Date(reading.timestamp).getTime() <= 24 * 60 * 60_000)
                  const latest = new Map<string, DashboardReading>()
                  locationReadings.filter((reading) => reading.sensor_type === selectedMetric).forEach((reading) => { const prior = latest.get(reading.sensor_id); if (!prior || reading.timestamp > prior.timestamp) latest.set(reading.sensor_id, reading) })
                  const hasRecentData = locationReadings.length > 0
                  const hasMetric = location.deployment_status === 'DEPLOYED' && latest.size > 0
                  const state = location.deployment_status === 'NOT_DEPLOYED' ? 'NOT DEPLOYED' : hasMetric ? 'AVAILABLE' : hasRecentData ? 'OTHER READINGS' : 'NO RECENT DATA'
                  return <article key={location.location_id} className={`location-tile ${hasMetric ? 'has-location-data' : ''} ${location.deployment_status === 'NOT_DEPLOYED' ? 'location-not-deployed' : ''}`}>
                    <div className="location-tile-head"><strong>{location.location_id}</strong><span>{state}</span></div>
                    <small>Subzone {location.subzone}</small>
                    {hasMetric && [...latest.values()].sort((a, b) => a.sensor_id.localeCompare(b.sensor_id)).map((reading) => <div className="location-reading" key={reading.sensor_id}>
                      <span>{reading.node_id} · {reading.sensor_id} · {formatAgo(reading.timestamp)}</span><strong>{reading.value} {reading.unit}</strong>
                    </div>)}
                    {location.deployment_status === 'DEPLOYED' && !hasMetric && <small>{hasRecentData ? `No recent ${selectedMetric} reading` : 'No reading received in the last 24 hours'}</small>}
                  </article>
                })}
              </div>
            </section>)}
          </div>}
        </section>
      })}
    </div>
    <p className="heatmap-note">Location states use the backend deployment catalogue and real location-tagged readings received in the last 24 hours. No values are generated for locations without data.</p>
  </section>
}
