import { useEffect, useState } from 'react'
import type { DashboardHeartbeat } from '../types/dashboard'
import { EmptyState } from './Primitives'

type TimelineRange = '15m' | '1h' | '24h' | '7d' | 'all'

const durationByRange: Partial<Record<TimelineRange, number>> = {
  '15m': 15 * 60_000, '1h': 60 * 60_000,
  '24h': 24 * 60 * 60_000, '7d': 7 * 24 * 60 * 60_000,
}

export function HeartbeatTimeline({ heartbeats, range }: { heartbeats: DashboardHeartbeat[]; range: TimelineRange }) {
  const [now, setNow] = useState(0)
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 10_000)
    return () => window.clearInterval(timer)
  }, [])
  const received = heartbeats.map((heartbeat) => new Date(heartbeat.received_at).getTime())
    .filter(Number.isFinite).sort((left, right) => left - right)
  if (received.length === 0) return <EmptyState>No heartbeat records are available in this range.</EmptyState>

  const currentTime = now || received[received.length - 1]
  const windowDuration = durationByRange[range]
  const start = windowDuration ? currentTime - windowDuration : Math.min(received[0], currentTime - 60 * 60_000)
  const end = currentTime
  const span = Math.max(1, end - start)
  const events = received.filter((timestamp) => timestamp >= start && timestamp <= end)
  const gapMarkers = events.slice(1).flatMap((timestamp, index) => {
    const previous = events[index]
    return timestamp - previous > 30_000
      ? [{ x: ((previous + timestamp) / 2 - start) / span * 100, seconds: Math.round((timestamp - previous) / 1000) }]
      : []
  })
  const ticks = Array.from({ length: 5 }, (_, index) => start + span * index / 4)

  return <section className="heartbeat-timeline panel" aria-label="Heartbeat timeline">
    <div className="heartbeat-timeline-track" role="img" aria-label={`${events.length} actual heartbeat receipt events. Marked intervals are gaps in received heartbeat records, not measured packet loss.`}>
      {gapMarkers.map((gap, index) => <div key={`gap-${index}`} className="heartbeat-gap" style={{ left: `${gap.x}%` }} title={`${gap.seconds} seconds between recorded heartbeats`} />)}
      {events.map((timestamp, index) => <div key={`${timestamp}-${index}`} className="heartbeat-event" style={{ left: `${(timestamp - start) / span * 100}%` }} title={`Heartbeat received ${new Date(timestamp).toLocaleString()}`} />)}
    </div>
    <div className="heartbeat-timeline-ticks">{ticks.map((tick, index) => <span key={index}>{new Date(tick).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>)}</div>
    <div className="heartbeat-timeline-caption">Dots are stored heartbeat receipts. Gap markers show intervals over 30 seconds between recorded receipts; they do not identify packet loss. Showing {events.length} record(s).</div>
  </section>
}
