import type { ReactNode } from 'react'
import type { ConnectionStatus, IntegrityStatus, LifecycleStatus } from '../types/dashboard'

export function PageHeader({ title, action }: { title: string; action?: ReactNode }) {
  return <div className="page-header"><h1>{title}</h1>{action}</div>
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="section-label">{children}</div>
}

export function Notice({ children }: { children: ReactNode }) {
  return <div className="notice">{children}</div>
}

export function Badge({ kind, children }: { kind: 'online' | 'stale' | 'offline' | 'active' | 'revoked'; children: ReactNode }) {
  const glyph = kind === 'online' ? '●' : kind === 'stale' ? '●' : kind === 'offline' ? '●' : '■'
  return <span className={`badge badge-${kind}`}><span className="badge-glyph">{glyph}</span>{children}</span>
}

export function LifecycleBadge({ status }: { status: LifecycleStatus }) {
  return <Badge kind={status === 'ACTIVE' ? 'active' : 'revoked'}>{status}</Badge>
}

export function ConnectionBadge({ status }: { status: ConnectionStatus }) {
  const kind = status.toLowerCase() as 'online' | 'stale' | 'offline'
  return <Badge kind={kind}>{status}</Badge>
}

export function IntegrityBadge({ status }: { status: IntegrityStatus }) {
  const kind = status === 'NORMAL' ? 'online' : status === 'SUSPICIOUS' ? 'stale' : status === 'INVALID' ? 'offline' : 'revoked'
  return <Badge kind={kind}>{status === 'UNKNOWN' ? 'Not assessed' : status}</Badge>
}

export function MetricCard({ label, value, caption, tone }: { label: string; value: ReactNode; caption?: string; tone?: string }) {
  return <div className="metric-card">
    {caption && <div className="metric-caption">{caption}</div>}
    <div className="metric-label">{label}</div>
    <div className={`metric-value ${tone ? `tone-${tone}` : ''}`}>{value}</div>
  </div>
}

export function DataTable({ headers, children, className = '' }: { headers: string[]; children: ReactNode; className?: string }) {
  return <div className={`table-wrap ${className}`}><table>
    <thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead>
    <tbody>{children}</tbody>
  </table></div>
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="empty-state">{children}</div>
}

export function formatAgo(timestamp: string | null): string {
  if (!timestamp) return '—'
  const seconds = Math.max(0, Math.round((Date.now() - new Date(timestamp).getTime()) / 1000))
  if (!Number.isFinite(seconds)) return '—'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h${minutes % 60 ? ` ${minutes % 60}m` : ''} ago`
  return `${Math.floor(hours / 24)}d${hours % 24 ? ` ${hours % 24}h` : ''} ago`
}

export function formatDate(timestamp: string | null): string {
  if (!timestamp) return '—'
  return new Date(timestamp).toISOString().slice(0, 10)
}
