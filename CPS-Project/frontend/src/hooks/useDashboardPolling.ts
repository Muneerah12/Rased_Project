import { useCallback, useEffect, useRef, useState } from 'react'
import { dashboardApi } from '../services/dashboardApi'
import type { DashboardHeartbeat, DashboardLocation, DashboardNode, DashboardReading } from '../types/dashboard'

const POLL_INTERVAL_MS = 5_000

interface DashboardData {
  nodes: DashboardNode[]
  readings: DashboardReading[]
  heartbeats: DashboardHeartbeat[]
  locations: DashboardLocation[]
}

type ResourceName = keyof DashboardData
type ResourceErrors = Partial<Record<ResourceName, string>>

const emptyData: DashboardData = { nodes: [], readings: [], heartbeats: [], locations: [] }

function errorMessage(reason: unknown): string {
  if (reason instanceof Error && reason.message) return reason.message
  return 'Request failed.'
}

export function useDashboardPolling(adminToken: string) {
  const [data, setData] = useState<DashboardData>(emptyData)
  const [errors, setErrors] = useState<ResourceErrors>({})
  const [lastUpdated, setLastUpdated] = useState<string | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const inFlightRef = useRef(false)
  const refreshQueuedRef = useRef(false)
  const controllerRef = useRef<AbortController | null>(null)
  const mountedRef = useRef(false)
  const refreshRef = useRef<() => Promise<void>>(async () => undefined)

  const refreshNow = useCallback(async () => {
    if (!adminToken || !mountedRef.current) return
    if (inFlightRef.current) {
      refreshQueuedRef.current = true
      return
    }

    inFlightRef.current = true
    const controller = new AbortController()
    controllerRef.current = controller
    setIsRefreshing(true)

    try {
      const results = await Promise.allSettled([
        dashboardApi.getNodes(adminToken, controller.signal),
        dashboardApi.getReadingsPage(adminToken, { limit: 200 }, controller.signal),
        dashboardApi.getHeartbeatsPage(adminToken, { limit: 200 }, controller.signal),
        dashboardApi.getLocations(adminToken, controller.signal),
      ] as const)

      if (controller.signal.aborted || !mountedRef.current) return

      const allSucceeded = results.every((result) => result.status === 'fulfilled')
      setData((previous) => ({
        nodes: results[0].status === 'fulfilled' ? results[0].value : previous.nodes,
        readings: results[1].status === 'fulfilled' ? results[1].value.items : previous.readings,
        heartbeats: results[2].status === 'fulfilled' ? results[2].value.items : previous.heartbeats,
        locations: results[3].status === 'fulfilled' ? results[3].value : previous.locations,
      }))

      setErrors((previous) => {
        const next = { ...previous }
        const names: ResourceName[] = ['nodes', 'readings', 'heartbeats', 'locations']
        results.forEach((result, index) => {
          const name = names[index]
          if (result.status === 'fulfilled') delete next[name]
          else next[name] = errorMessage(result.reason)
        })
        return next
      })

      if (allSucceeded) setLastUpdated(new Date().toISOString())
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null
        inFlightRef.current = false
        if (mountedRef.current) setIsRefreshing(false)
        if (mountedRef.current && refreshQueuedRef.current) {
          refreshQueuedRef.current = false
          queueMicrotask(() => void refreshRef.current())
        }
      }
    }
  }, [adminToken])

  refreshRef.current = refreshNow

  useEffect(() => {
    if (!adminToken) {
      setData(emptyData)
      setErrors({})
      setLastUpdated(null)
      setIsRefreshing(false)
      return
    }

    mountedRef.current = true
    void refreshRef.current()
    const timer = window.setInterval(() => {
      void refreshRef.current()
    }, POLL_INTERVAL_MS)

    return () => {
      mountedRef.current = false
      window.clearInterval(timer)
      controllerRef.current?.abort()
      controllerRef.current = null
      inFlightRef.current = false
      refreshQueuedRef.current = false
    }
  }, [adminToken])

  return { ...data, errors, lastUpdated, isRefreshing, refreshNow }
}
