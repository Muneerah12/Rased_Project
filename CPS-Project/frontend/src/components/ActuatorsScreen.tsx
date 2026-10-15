import { ConnectionBadge, formatAgo, PageHeader } from './Primitives'
import type { DashboardHeartbeat, DashboardNode } from '../types/dashboard'

export function ActuatorsScreen({ heartbeats, node, heartbeatError }: {
  heartbeats: DashboardHeartbeat[]
  node?: DashboardNode
  heartbeatError?: string
}) {
  const latestHeartbeat = [...heartbeats].sort((left, right) =>
    new Date(right.received_at).getTime() - new Date(left.received_at).getTime()
  )[0]
  const reportedState = latestHeartbeat?.reported_relay_state
  const relayState = reportedState === 'ON' || reportedState === 'OFF' ? reportedState : null
  const stateLabel = relayState ?? 'Not reported'

  return <div className="actuators-page">
    <PageHeader title="Actuators" />
    <p className="page-subtitle actuator-page-subtitle">Configured HVAC hardware and local control logic. State is the relay output reported by NODE-03.</p>
    {heartbeatError && <p className="actuator-data-warning" role="status">Heartbeat data could not be refreshed. Showing the latest data already received.</p>}

    <article className="panel actuator-primary">
      <header className="actuator-primary-header">
        <div>
          <p className="eyebrow">ACTUATOR GROUP</p>
          <h2>HVAC-01</h2>
          <span className="actuator-type">HVAC / Fan Group</span>
        </div>
        <div className="actuator-live-state">
          <span>Reported relay output</span>
          <strong className={`actuator-reported-state ${relayState ? `state-${relayState.toLowerCase()}` : 'state-unknown'}`}>{stateLabel}</strong>
          <small>{latestHeartbeat ? `Received ${formatAgo(latestHeartbeat.received_at)}` : 'No heartbeat report available'}</small>
        </div>
      </header>
      <div className="actuator-connection-line">
        <span>NODE-03 connection</span>
        {node ? <ConnectionBadge status={node.connection_status} /> : <span className="actuator-connection-unknown">Not available</span>}
      </div>
      <p className="actuator-state-semantics">Commanded output only; this does not confirm relay contact or individual fan operation.</p>

      <dl className="actuator-config-grid">
        <div><dt>Controlled by</dt><dd>RELAY-01</dd></div>
        <div><dt>Connected fans</dt><dd>3</dd></div>
        <div><dt>Control mode</dt><dd>Local Auto</dd></div>
        <div><dt>Temperature setpoint</dt><dd>25.0°C</dd></div>
        <div><dt>ON threshold</dt><dd>26.0°C</dd></div>
        <div><dt>OFF threshold</dt><dd>24.0°C</dd></div>
      </dl>

      <section className="actuator-control-logic" aria-labelledby="actuator-logic-title">
        <h3 id="actuator-logic-title">Temperature control logic</h3>
        <div className="actuator-logic-rules">
          <div><strong>≥ 26°C</strong><span>ON</span></div>
          <div><strong>≤ 24°C</strong><span>OFF</span></div>
          <div><strong>24–26°C</strong><span>Hold current state</span></div>
        </div>
      </section>

      <div className="actuator-safety-info" aria-label="HVAC safety behavior">
        <strong>Minimum ON time: 60s</strong>
        <strong>Minimum OFF time: 60s</strong>
        <span>Invalid temperature → HVAC OFF</span>
      </div>
    </article>

    <div className="actuator-components-grid">
      <section className="panel actuator-component-panel" aria-labelledby="relay-heading">
        <div className="actuator-section-heading">
          <div><p className="eyebrow">RELAY</p><h2 id="relay-heading">RELAY-01</h2></div>
          <span className="actuator-live-state actuator-live-state-compact"><span>Commanded state</span><strong className={`actuator-reported-state ${relayState ? `state-${relayState.toLowerCase()}` : 'state-unknown'}`}>{stateLabel}</strong></span>
        </div>
        <dl className="actuator-relay-details">
          <div><dt>GPIO</dt><dd>25</dd></div>
          <div><dt>Controls</dt><dd>HVAC-01</dd></div>
        </dl>
      </section>

      <section className="panel actuator-component-panel" aria-labelledby="fans-heading">
        <div className="actuator-section-heading">
          <div><p className="eyebrow">OUTPUT GROUP</p><h2 id="fans-heading">Connected fans</h2></div>
          <span className="actuator-fan-count">3 fans</span>
        </div>
        <ul className="actuator-fan-list">
          <li>FAN-01</li>
          <li>FAN-02</li>
          <li>FAN-03</li>
        </ul>
        <p className="actuator-monitoring-note">Individual fan status not monitored. All three fans are controlled together by RELAY-01.</p>
      </section>
    </div>
  </div>
}
