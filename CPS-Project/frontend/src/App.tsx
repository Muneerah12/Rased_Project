import { useEffect, useState } from 'react'
import './App.css'
import { Overview } from './components/Overview'
import { NodesScreen } from './components/DataScreens'
import { HeartbeatsScreen, NodeDetailsScreen, ReadingsScreen } from './components/HistoryScreens'
import { NocDashboard } from './components/NocDashboard'
import { ActuatorsScreen } from './components/ActuatorsScreen'
import { PendingIntegrationScreen } from './components/PendingIntegrationScreen'
import { useDashboardPolling } from './hooks/useDashboardPolling'
import { dashboardApi } from './services/dashboardApi'
import type { DashboardNode, ScreenName } from './types/dashboard'

const screenLabels: Record<ScreenName, string> = {
  overview: 'Overview', otNodes: 'OT / Nodes', actuators: 'OT / Actuators',
  cctv: 'IoT / CCTV', drones: 'IoT / Drones', otherIot: 'IoT / Other IoT',
  noc: 'Mini NOC / Network', nodeDetails: 'Node Details', readings: 'Readings', heartbeats: 'Heartbeats',
}

function App() {
  const [adminToken, setAdminToken] = useState('')
  const [tokenInput, setTokenInput] = useState('')
  const [screen, setScreen] = useState<ScreenName>('overview')
  const [selectedNodeId, setSelectedNodeId] = useState('')
  const [selectedNode, setSelectedNode] = useState<DashboardNode>()
  const [nodeDetailsLoading, setNodeDetailsLoading] = useState(false)
  const [nodeDetailsError, setNodeDetailsError] = useState('')
  const [tokenError, setTokenError] = useState('')
  const { nodes, readings, heartbeats, locations, errors, lastUpdated, isRefreshing, refreshNow } = useDashboardPolling(adminToken)

  const enterDashboard = () => {
    const token = tokenInput.trim()
    if (!token) {
      setTokenError('Enter the admin token to load dashboard data.')
      return
    }
    setTokenError('')
    setAdminToken(token)
    setScreen('overview')
  }

  const signOut = () => {
    setAdminToken('')
    setTokenInput('')
  }

  const openNode = (nodeId: string) => {
    setSelectedNode(undefined)
    setNodeDetailsError('')
    setNodeDetailsLoading(true)
    setSelectedNodeId(nodeId)
    setScreen('nodeDetails')
  }

  useEffect(() => {
    if (screen !== 'nodeDetails' || !adminToken || !selectedNodeId) return
    const controller = new AbortController()
    void dashboardApi.getNode(adminToken, selectedNodeId, controller.signal)
      .then((node) => setSelectedNode({ ...node, provisioned_at: node.registered_at }))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setNodeDetailsError(error instanceof Error ? error.message : 'Could not load node details.')
      })
      .finally(() => { if (!controller.signal.aborted) setNodeDetailsLoading(false) })
    return () => controller.abort()
  }, [adminToken, screen, selectedNodeId])

  if (adminToken === '') {
    return <main className="gate-page">
      <form className="gate-card" onSubmit={(event) => { event.preventDefault(); enterDashboard() }}>
        <div className="gate-mark">CPS</div>
        <div className="gate-title">CPS Management Dashboard</div>
        <label className="sr-only" htmlFor="admin-token">Admin Token (X-Admin-Token)</label>
        <input id="admin-token" type="password" autoComplete="off" placeholder="Admin Token (X-Admin-Token)" value={tokenInput} onChange={(event) => setTokenInput(event.target.value)} />
        <button className="button button-primary gate-submit" type="submit">Enter</button>
        {tokenError && <p className="gate-error" role="alert">{tokenError}</p>}
        <p>The token is kept in this browser session's memory and sent as <code>X-Admin-Token</code> for protected dashboard requests.</p>
      </form>
    </main>
  }

  const activeNav = screen === 'nodeDetails' ? 'otNodes' : screen
  const failed = Object.keys(errors)
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-icon">C</span><span>CPS MANAGEMENT</span></div>
      <nav aria-label="Dashboard navigation">
        <button className={`nav-item ${activeNav === 'overview' ? 'selected' : ''}`} onClick={() => setScreen('overview')}>Overview</button>
        <div className="nav-caption">OT</div>
        <button className={`nav-item ${activeNav === 'otNodes' ? 'selected' : ''}`} onClick={() => setScreen('otNodes')}>Nodes</button>
        <button className={`nav-item ${activeNav === 'actuators' ? 'selected' : ''}`} onClick={() => setScreen('actuators')}>Actuators</button>
        <div className="nav-caption">IoT</div>
        <button className={`nav-item ${activeNav === 'cctv' ? 'selected' : ''}`} onClick={() => setScreen('cctv')}>CCTV</button>
        <button className={`nav-item ${activeNav === 'drones' ? 'selected' : ''}`} onClick={() => setScreen('drones')}>Drones</button>
        <button className={`nav-item ${activeNav === 'otherIot' ? 'selected' : ''}`} onClick={() => setScreen('otherIot')}>Other IoT</button>
        <div className="nav-caption">MINI NOC</div>
        <button className={`nav-item ${activeNav === 'noc' ? 'selected' : ''}`} onClick={() => setScreen('noc')}>Network</button>
        <div className="nav-caption">TELEMETRY</div>
        <button className={`nav-item ${activeNav === 'readings' ? 'selected' : ''}`} onClick={() => setScreen('readings')}>Readings</button>
        <button className={`nav-item ${activeNav === 'heartbeats' ? 'selected' : ''}`} onClick={() => setScreen('heartbeats')}>Heartbeats</button>
      </nav>
      <div className="sidebar-footer"><span className={`connection-indicator ${failed.length ? 'indicator-error' : lastUpdated ? 'indicator-connected' : ''}`} />Polling every 5 seconds</div>
    </aside>
    <div className="workspace">
      <header className="topbar">
        <div className="breadcrumb"><span>Workspace</span><span className="crumb-divider">/</span><strong>{screen === 'nodeDetails' ? selectedNodeId : screenLabels[screen]}</strong></div>
        <div className="topbar-actions">
          <div className={`connection-status ${failed.length ? 'has-error' : lastUpdated ? 'is-connected' : ''}`} title={failed.length ? 'One or more dashboard requests failed.' : 'Dashboard API connection status'}>
            <span className="connection-indicator" />
            <span>{failed.length ? `Connection issue · ${failed.join(', ')}` : isRefreshing ? 'Updating' : lastUpdated ? 'Connected' : 'Connecting'}</span>
          </div>
          <div className="last-updated">Last updated <strong>{lastUpdated ? new Date(lastUpdated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'}</strong></div>
          <button className="refresh-button" onClick={() => void refreshNow()} disabled={isRefreshing}>{isRefreshing ? 'Refreshing' : 'Refresh now'}</button>
          <button className="session-button" onClick={signOut}>Sign out</button>
        </div>
      </header>
      <main className="main-content">
        {screen === 'overview' && <Overview nodes={nodes} readings={readings} locations={locations} adminToken={adminToken} errors={errors} lastUpdated={lastUpdated} isRefreshing={isRefreshing} />}
        {screen === 'otNodes' && <NodesScreen nodes={nodes} locations={locations} adminToken={adminToken} onSelect={openNode} onRefresh={refreshNow} loading={isRefreshing && nodes.length === 0 && !errors.nodes} error={errors.nodes ?? ''} />}
        {screen === 'nodeDetails' && <NodeDetailsScreen key={selectedNodeId} adminToken={adminToken} node={selectedNode} locations={locations} locationsUnavailable={Boolean(errors.locations)} loading={nodeDetailsLoading} error={nodeDetailsError} onBack={() => setScreen('otNodes')} />}
        {screen === 'noc' && <NocDashboard nodes={nodes} heartbeats={heartbeats} errors={errors} lastUpdated={lastUpdated} isRefreshing={isRefreshing} onNodeSelect={openNode} />}
        {screen === 'readings' && <ReadingsScreen adminToken={adminToken} nodes={nodes} />}
        {screen === 'heartbeats' && <HeartbeatsScreen adminToken={adminToken} nodes={nodes} />}
        {screen === 'actuators' && <ActuatorsScreen
          heartbeats={heartbeats.filter((heartbeat) => heartbeat.node_id === 'NODE-03')}
          node={nodes.find((item) => item.node_id === 'NODE-03')}
          heartbeatError={errors.heartbeats}
        />}
        {screen === 'cctv' && <PendingIntegrationScreen title="IoT / CCTV" message="Camera integration is pending the teammate-owned API and authentication contract. No cameras, streams, or credentials are shown here." />}
        {screen === 'drones' && <PendingIntegrationScreen title="IoT / Drones" message="No drone inventory or telemetry API is connected. This section remains pending a real integration contract." />}
        {screen === 'otherIot' && <PendingIntegrationScreen title="IoT / Other IoT" message="No other IoT device integrations are connected. Devices will appear here only after a real data contract is available." />}
      </main>
    </div>
  </div>
}

export default App
