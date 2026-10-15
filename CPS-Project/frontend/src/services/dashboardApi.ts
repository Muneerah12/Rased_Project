import type { DashboardHeartbeat, DashboardLocation, DashboardNode, DashboardReading } from '../types/dashboard'

export interface NodeRegistrationResponse {
  node_id: string
  status: DashboardNode['status']
  connection_status: DashboardNode['connection_status']
  registered_at: string
  credential: string
}

export interface NodeReactivationResponse {
  node_id: string
  status: DashboardNode['status']
  connection_status: DashboardNode['connection_status']
  credential: string
}

interface NodeDetailResponse extends DashboardNode {
  registered_at: string | null
}

export interface CursorPage<T> {
  items: T[]
  next_cursor: string | null
}

export interface ReadingQuery {
  nodeId?: string
  sensorType?: string
  locationId?: string
  start?: string
  end?: string
  cursor?: string
  limit?: number
}

export interface HeartbeatQuery {
  nodeId?: string
  receivedAfter?: string
  receivedBefore?: string
  cursor?: string
  limit?: number
}

async function getJson<T>(path: string, adminToken: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, {
    method: 'GET',
    headers: { Accept: 'application/json', 'X-Admin-Token': adminToken },
    signal,
  })
  let payload: unknown
  try { payload = await response.json() } catch { payload = undefined }
  if (!response.ok) {
    const detail = typeof payload === 'object' && payload !== null && 'detail' in payload
      ? String(payload.detail) : response.statusText
    throw new Error(`HTTP ${response.status}${detail ? `: ${detail}` : ''}`)
  }
  return payload as T
}

async function getPage<T>(path: string, adminToken: string, signal?: AbortSignal): Promise<CursorPage<T>> {
  const payload = await getJson<unknown>(path, adminToken, signal)
  if (typeof payload !== 'object' || payload === null || !('items' in payload) || !Array.isArray(payload.items)) {
    throw new Error('The backend response was not a paginated result.')
  }
  return payload as CursorPage<T>
}

function queryString(values: Record<string, string | number | undefined>) {
  const params = new URLSearchParams()
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== '') params.set(key, String(value))
  })
  return params.size ? `?${params.toString()}` : ''
}

type ManagementOperation = 'load node' | 'register node' | 'revoke node' | 'reactivate node'

function managementError(status: number, operation: ManagementOperation): string {
  if (status === 401) return 'The admin token is missing or invalid. Sign in again.'
  if (status === 403) return 'This operation is not allowed for the node in its current state.'
  if (status === 404) return 'The requested node was not found.'
  if (status === 409 && operation === 'register node') return 'A node with this ID is already registered.'
  if (status === 409) return 'The node state changed. Refresh the node list and try again.'
  if (status === 422) return 'The request is invalid.'
  return `Could not ${operation} (HTTP ${status}).`
}

async function adminJson<T>(
  path: string,
  adminToken: string,
  operation: ManagementOperation,
  options: { method?: 'GET' | 'POST' | 'PUT'; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, {
      method: options.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        'X-Admin-Token': adminToken,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    })
  } catch {
    throw new Error(`Could not ${operation}: the backend could not be reached.`)
  }
  if (!response.ok) throw new Error(managementError(response.status, operation))
  try { return await response.json() as T } catch {
    throw new Error(`Could not ${operation}: the backend returned an invalid response.`)
  }
}

export const dashboardApi = {
  getNodes: (adminToken: string, signal: AbortSignal) =>
    getJson<DashboardNode[]>('/nodes', adminToken, signal),
  getLocations: (adminToken: string, signal: AbortSignal) =>
    getJson<DashboardLocation[]>('/locations', adminToken, signal),
  getReadingsPage: (adminToken: string, query: ReadingQuery = {}, signal?: AbortSignal) =>
    getPage<DashboardReading>(`/readings${queryString({
      node_id: query.nodeId,
      sensor_type: query.sensorType,
      location_id: query.locationId,
      start: query.start,
      end: query.end,
      limit: query.limit ?? 200,
      cursor: query.cursor,
    })}`, adminToken, signal),
  getAllReadings: async (adminToken: string, query: ReadingQuery = {}, signal?: AbortSignal) => {
    const items: DashboardReading[] = []
    let cursor = query.cursor
    let nextCursor: string | null
    do {
      const page = await dashboardApi.getReadingsPage(adminToken, { ...query, cursor, limit: 500 }, signal)
      items.push(...page.items)
      nextCursor = page.next_cursor
      cursor = nextCursor ?? undefined
    } while (nextCursor && !signal?.aborted)
    if (signal?.aborted) throw new DOMException('Request aborted', 'AbortError')
    return items
  },
  getHeartbeatsPage: (adminToken: string, query: HeartbeatQuery = {}, signal?: AbortSignal) =>
    getPage<DashboardHeartbeat>(`/heartbeats${queryString({
      node_id: query.nodeId,
      received_after: query.receivedAfter,
      received_before: query.receivedBefore,
      limit: query.limit ?? 200,
      cursor: query.cursor,
    })}`, adminToken, signal),
  getNodeReadingsPage: (adminToken: string, nodeId: string, query: Omit<ReadingQuery, 'nodeId'> = {}, signal?: AbortSignal) =>
    getPage<DashboardReading>(`/nodes/${encodeURIComponent(nodeId)}/readings${queryString({
      sensor_type: query.sensorType,
      start: query.start,
      end: query.end,
      limit: query.limit ?? 200,
      cursor: query.cursor,
    })}`, adminToken, signal),
  getNode: (adminToken: string, nodeId: string, signal: AbortSignal) =>
    adminJson<NodeDetailResponse>(`/nodes/${encodeURIComponent(nodeId)}`, adminToken, 'load node', { signal }),
  registerNode: (adminToken: string, nodeId: string) =>
    adminJson<NodeRegistrationResponse>('/nodes', adminToken, 'register node', { method: 'POST', body: { node_id: nodeId } }),
  revokeNode: (adminToken: string, nodeId: string) =>
    adminJson<{ node_id: string; status: string }>(`/nodes/${encodeURIComponent(nodeId)}/revoke`, adminToken, 'revoke node', { method: 'POST' }),
  reactivateNode: (adminToken: string, nodeId: string) =>
    adminJson<NodeReactivationResponse>(`/nodes/${encodeURIComponent(nodeId)}/reactivate`, adminToken, 'reactivate node', { method: 'POST' }),
  assignNodeLocation: (adminToken: string, nodeId: string, locationId: string | null) =>
    adminJson<{ node_id: string; location_id: string | null }>(`/nodes/${encodeURIComponent(nodeId)}/location`, adminToken, 'load node', {
      method: 'PUT', body: { location_id: locationId },
    }),
}
