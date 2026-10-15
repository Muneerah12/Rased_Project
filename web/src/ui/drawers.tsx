import { useCallback, useEffect, useState } from 'react';
import ground from '../assets/expo-ground.webp';
import pavilions from '../assets/expo-pavilions.webp';
import walkway from '../assets/expo-walkway.webp';
import { useStore, useUI } from '../state/store';
import type { EntityRef } from '../state/store';
import {
  alertStatus, cameraState, empNotInZone, empStatus, employeeById, findNode, isOpenIncident, lastHeartbeat,
  nodeState, responseTimeMs, scopeStats, sensorHealth, sensorLast, zoneById, zoneDeviceState,
} from '../model/selectors';
import { fmtDuration } from '../model/config';
import { can, incidentVisible } from '../services/permissions';
import { alertTitle, LABELS } from './labels';
import {
  AlertStatusBadge, Btn, Chip, CrowdBadge, ELink, Empty, EmpStatusBadge, Field, HealthBadge, IncidentStatusBadge, Ltr, Restricted, SevBadge, SimTag, StateBadge, Time,
} from './primitives';
import { Icon } from './icons';
import { HeartbeatStrip } from './charts';
import { BmeHistory, BmeReadings } from './bme';
import { TeamBadge } from './teams';
import { HeartbeatAgo } from './panels';
import { ExpoMap } from './ExpoMap';
import { IncidentFacts, IncidentHeader, Timeline } from './incident';
import { CONFIG } from '../model/config';
import { fetchCpsNodeState, latestNode04Readings, relayReportAge } from '../services/cps';
import type { CpsNodeState, CpsRelayReportAge } from '../services/cps';
import { mapTargetForCpsLocation } from '../services/cpsLocationMap';

const KIND_ICON = { zone: 'pin', camera: 'camera', node: 'node', sensor: 'sensor', employee: 'user', alert: 'bell', incident: 'incidents', event: 'signal' } as const;

export function Drawer() {
  const { ui, closeDrawer, backDrawer, T } = useUI();
  const top = ui.drawer[ui.drawer.length - 1];
  if (!top) return null;
  return (
    <>
      <div className="scrim" onClick={closeDrawer} aria-hidden="true" />
      <aside className="drawer" role="dialog" aria-modal="false" aria-label={T('تفاصيل', 'Details')}>
        <header className="drawer-h">
          {ui.drawer.length > 1 && <button type="button" className="ibtn" onClick={backDrawer} aria-label={T('رجوع', 'Back')}><Icon name="back" className="flip" /></button>}
          <Icon name={KIND_ICON[top.kind]} size={18} />
          <span className="drawer-k"><Ltr>{top.id}</Ltr></span>
          <button type="button" className="ibtn end" onClick={closeDrawer} aria-label={T('إغلاق', 'Close')}><Icon name="close" /></button>
        </header>
        <div className="drawer-b"><DrawerBody r={top} /></div>
      </aside>
    </>
  );
}

function MapLink({ r }: { r: EntityRef }) {
  const { showOnMap, T } = useUI();
  return <Btn small kind="ghost" icon="pin" onClick={() => showOnMap(r)}>{T('إظهار على الخريطة', 'Show on map')}</Btn>;
}

type CpsNodeLoad = { state: CpsNodeState | null; loading: boolean; error: string | null; refresh: () => void };
type CpsSensorFilter = 'all' | 'temperature' | 'humidity' | 'pressure';

function useCpsNodeDetails(): CpsNodeLoad {
  const [state, setState] = useState<CpsNodeState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void fetchCpsNodeState(controller.signal)
      .then(setState)
      .catch((err: unknown) => {
        if ((err as { name?: string })?.name !== 'AbortError') {
          setState(null);
          setError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);
  useEffect(() => refresh(), [refresh]);
  return { state, loading, error, refresh };
}

function cpsTimestamp(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString('en-GB', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

function connectionTone(connectionStatus: string): 'ok' | 'warn' | 'off' | 'neutral' {
  if (connectionStatus === 'ONLINE') return 'ok';
  if (connectionStatus === 'STALE') return 'warn';
  if (connectionStatus === 'OFFLINE') return 'off';
  return 'neutral';
}

function relayAgeLabel(age: CpsRelayReportAge, T: (ar: string, en: string) => string): string {
  switch (age) {
    case 'latest': return T('أحدث حالة مرحّل أبلغ عنها الجهاز', 'Latest device-reported relay state');
    case 'stale': return T('حالة مرحّل قديمة أبلغ عنها الجهاز', 'Stale device-reported relay state');
    case 'historical': return T('حالة مرحّل تاريخية أبلغ عنها الجهاز', 'Historical device-reported relay state');
    case 'reported': return T('حالة مرحّل أبلغ عنها الجهاز', 'Device-reported relay state');
    default: return T('حالة المرحّل غير متاحة', 'Relay state unavailable');
  }
}

function readingAgeLabel(connectionStatus: string, T: (ar: string, en: string) => string): string {
  if (connectionStatus === 'STALE') return T('قراءة CPS قديمة', 'Stale CPS reading');
  if (connectionStatus === 'OFFLINE') return T('قراءة CPS محفوظة تاريخياً', 'Historical stored CPS reading');
  return T('قراءة CPS الحالية', 'Current CPS reading');
}

function CpsNodeDetails() {
  const { T } = useUI();
  const cps = useCpsNodeDetails();
  const [filter, setFilter] = useState<CpsSensorFilter>('all');
  const [query, setQuery] = useState('');
  if (cps.loading) return <Empty icon="router" title={T('جارٍ تحميل تفاصيل CPS', 'Loading CPS details')} />;
  if (!cps.state) return <Empty icon="router" title={T('تفاصيل CPS غير متاحة', 'CPS details unavailable')}><p className="fine">{cps.error}</p><Btn small onClick={cps.refresh}>{T('إعادة المحاولة', 'Retry')}</Btn></Empty>;

  const state = cps.state;
  const readings = latestNode04Readings(state.readings).filter((reading) => (
    (filter === 'all' || reading.sensor_type.toLowerCase() === filter)
    && (!query.trim() || reading.sensor_id.toLowerCase().includes(query.trim().toLowerCase()))
  ));
  const relayAge = relayReportAge(state.connection_status, state.reported_relay_state);
  const mapTarget = mapTargetForCpsLocation(state.location_id);
  const stateTone = state.status === 'ACTIVE' ? 'ok' : state.status === 'REVOKED' ? 'off' : 'neutral';
  const historical = state.connection_status === 'STALE' || state.connection_status === 'OFFLINE';
  const filterLabel: Record<CpsSensorFilter, string> = {
    all: T('الكل', 'All'), temperature: T('الحرارة', 'Temperature'), humidity: T('الرطوبة', 'Humidity'), pressure: T('الضغط', 'Pressure'),
  };
  return <div className="dstack">
    <div className="d-title"><h3><Ltr>{state.node_id}</Ltr></h3><Chip tone={stateTone}><Ltr>{state.status}</Ltr></Chip><Chip tone={connectionTone(state.connection_status)}><Ltr>{state.connection_status}</Ltr></Chip></div>
    <dl className="facts">
      <Field k={T('الموقع', 'Location')}><Ltr>{state.location_id ?? '—'}</Ltr></Field>
      <Field k={T('آخر نبضة', 'Last heartbeat')}><Ltr>{cpsTimestamp(state.last_heartbeat_received_at)}</Ltr></Field>
    </dl>
    {mapTarget
      ? <MapLink r={mapTarget} />
      : <p className="warnline">{T('موقع الخريطة غير مُهيأ.', 'Map location not configured.')}</p>}

    <div>
      <h4>{T('الحساس الفعلي', 'Physical sensor')}</h4>
      <div className="row wrap"><strong>BME280</strong><span className="muted">{T('حساس واحد · 3 قنوات قياس', 'One sensor · 3 measurement channels')}</span></div>
      <div className="filters" role="group" aria-label={T('تصفية القنوات', 'Filter channels')}>
        {(Object.keys(filterLabel) as CpsSensorFilter[]).map((item) => <button key={item} type="button" className={`fchip${filter === item ? ' on' : ''}`} aria-pressed={filter === item} onClick={() => setFilter(item)}>{filterLabel[item]}</button>)}
        <label className="search-in"><Icon name="search" size={15} /><input value={query} onChange={(event: { target: { value: string } }) => setQuery(event.target.value)} placeholder={T('بحث بمعرف الحساس', 'Search sensor ID')} aria-label={T('بحث بمعرف الحساس', 'Search sensor ID')} /></label>
      </div>
      {readings.length ? <ul className="plain">
        {readings.map((reading) => <li key={reading.sensor_id}><strong><Ltr>{reading.sensor_id}</Ltr></strong> · <Ltr>{String(reading.value)} {reading.unit}</Ltr><small className="block muted">{readingAgeLabel(state.connection_status, T)} · <Ltr>{cpsTimestamp(reading.timestamp)}</Ltr></small></li>)}
      </ul> : <Empty title={T('لا توجد قنوات قياس مطابقة', 'No matching measurement channels')} />}
    </div>

    <div>
      <h4>{T('وحدة التكييف / المروحة', 'HVAC / fan unit')}</h4>
      <dl className="facts">
        <Field k={T('حالة المرحّل المبلّغ عنها', 'Reported relay state')}>{state.reported_relay_state === null ? <span className="muted">{relayAgeLabel(relayAge, T)}</span> : <><strong><Ltr>{state.reported_relay_state}</Ltr></strong><small className="block muted">{relayAgeLabel(relayAge, T)}</small></>}</Field>
        <Field k={T('وقت تقرير المرحّل', 'Relay report time')}><Ltr>{cpsTimestamp(state.relay_reported_at)}</Ltr></Field>
      </dl>
      {historical && <p className="warnline">{T('اتصال العقدة ليس مباشراً؛ القيم المعروضة قديمة أو تاريخية وليست حالة حية.', 'The node is not currently live; displayed values are stale or historical, not live state.')}</p>}
      <p className="fine">{T('حالة المرحّل أبلغ عنها الجهاز ولا تؤكد تشغيل المروحة أو أي فعل مادي. مراقبة فقط — لا تحكم عن بُعد.', 'The relay state is device-reported and does not confirm fan operation or physical actuation. Monitoring only — no remote control.')}</p>
    </div>
  </div>;
}

function DrawerBody({ r }: { r: EntityRef }) {
  const { s } = useStore();
  const { T, tl, ui, persona, openIncident, openEmployee, openCamera, set, openDrawer } = useUI();
  const devicesOk = can(ui.role, 'view_devices');

  if (r.kind === 'zone') {
    const z = zoneById(s, r.id);
    if (!z) return <Empty title={T('غير موجود', 'Not found')} />;
    const st = scopeStats(s, z.id);
    const incs = s.incidents.filter((i) => i.kind === 'expo' && isOpenIncident(i) && (i.zoneId === z.id || zoneById(s, i.zoneId)?.parentId === z.id) && incidentVisible(ui.role, persona.userId, i));
    return (
      <div className="dstack">
        <div className="d-title"><h3>{tl(z.name)}</h3>{z.hasOccupancy ? <StateBadge state={zoneDeviceState(st.crowd)} /> : null}{z.illustrative && <span className="simtag">{T('حدود توضيحية', 'Illustrative outline')}</span>}</div>
        {z.hasOccupancy ? (
          <dl className="bigfacts">
            <Field k={T('الأشخاص', 'People')}><strong><Ltr>{st.people} / {st.capacity}</Ltr></strong></Field>
            <Field k={T('حالة الحشود', 'Crowd status')}><CrowdBadge status={st.crowd} /></Field>
            <Field k={T('الموظفون', 'Employees')}><Ltr>{st.employeesPresent}</Ltr></Field>
            <Field k={T('حوادث مفتوحة', 'Open incidents')}><Ltr>{st.openIncidents}</Ltr></Field>
            <Field k={T('الكاميرات', 'Cameras')}><Ltr>{st.cameras[0]}</Ltr> {T('متصلة', 'online')} <span className="muted"><Ltr>/ {st.cameras[1]}</Ltr></span></Field>
            <Field k={T('الحساسات', 'Sensors')}><Ltr>{st.sensors[0]}</Ltr> {T('متصلة', 'online')} <span className="muted"><Ltr>/ {st.sensors[1]}</Ltr></span></Field>
          </dl>
        ) : (
          <>
            <p className="muted">{T('لم تُزوَّد بيانات إشغال أو حدود رسمية لهذه المنطقة. تُعرض السجلات المتوفرة فقط.', 'No occupancy data or official geometry was supplied for this area. Only the supplied records are shown.')}</p>
            <dl className="bigfacts">
              <Field k={T('الكاميرات', 'Cameras')}><Ltr>{st.cameras[0]}/{st.cameras[1]}</Ltr></Field>
              <Field k={T('العقد', 'Nodes')}><Ltr>{st.nodes[0]}/{st.nodes[1]}</Ltr></Field>
              <Field k={T('الحساسات', 'Sensors')}><Ltr>{st.sensors[0]}/{st.sensors[1]}</Ltr></Field>
              <Field k={T('الموظفون', 'Employees')}><Ltr>{st.employeesPresent}</Ltr></Field>
            </dl>
          </>
        )}
        <div className="row wrap">
          <Btn small kind="primary" onClick={() => set({ scope: z.id, drawer: [] })}>{T(`تصفية اللوحة على ${z.id}`, `Filter dashboard to ${z.id}`)}</Btn>
          <MapLink r={{ kind: 'zone', id: z.id }} />
        </div>
        {incs.length > 0 && <div><h4>{T('الحوادث المفتوحة', 'Open incidents')}</h4><ul className="plain">{incs.map((i) => <li key={i.id}><ELink r={{ kind: 'incident', id: i.id }} /> {tl(LABELS.category[i.category])} <SevBadge sev={i.severity} /></li>)}</ul></div>}
        {devicesOk && <div><h4>{T('الأجهزة', 'Devices')}</h4><ul className="plain cols">
          {s.cameras.filter((c) => c.zoneId === z.id).map((c) => <li key={c.id}><ELink r={{ kind: 'camera', id: c.id }} /> <StateBadge state={cameraState(s, c)} /></li>)}
          {s.nodes.filter((n) => n.zoneId === z.id).map((n) => <li key={n.id}><ELink r={{ kind: 'node', id: n.id }} /> <StateBadge state={nodeState(s, n)} /></li>)}
        </ul></div>}
        {z.id === 'A1.1' && (
          <figure className="ctx">
            <div className="ctx-imgs"><img src={pavilions} alt={T('صورة تصورية للأجنحة', 'Pavilion concept rendering')} /><img src={walkway} alt={T('صورة تصورية للممشى', 'Walkway concept rendering')} /><img src={ground} alt={T('صورة تصورية على مستوى الأرض', 'Ground-level concept rendering')} /></div>
            <figcaption>{T('صور مرجعية تصورية لإكسبو 2030 الرياض — للسياق فقط، ليست بثاً حياً من المنطقة.', 'Expo 2030 Riyadh concept references — context only, not live views of this zone.')}</figcaption>
          </figure>
        )}
      </div>
    );
  }

  if (r.kind === 'camera') {
    if (!devicesOk) return <Restricted />;
    const c = s.cameras.find((x) => x.id === r.id);
    if (!c) return <Empty title={T('غير موجود', 'Not found')} />;
    const occ = c.countsZone ? scopeStats(s, c.zoneId) : null;
    const related = s.incidents.filter((i) => i.sourceDeviceId === c.id);
    return (
      <div className="dstack">
        <div className="d-title"><h3>{tl(c.label)}</h3><StateBadge state={cameraState(s, c)} /></div>
        <dl className="facts">
          <Field k={T('المنطقة', 'Zone')}><ELink r={{ kind: 'zone', id: c.zoneId }} /></Field>
          <Field k={T('حالة التحليل', 'AI status')}>{!c.online ? T('غير متصلة', 'Offline') : s.analysisRunning[c.id] ? <>{T('قيد التحليل', 'Analyzing')} <SimTag /></> : T('متوقف', 'Paused')}</Field>
          {occ && <Field k={T('الأشخاص', 'Persons')}><Ltr>{occ.people} / {occ.capacity}</Ltr></Field>}
        </dl>
        <div className="row wrap"><Btn small kind="primary" icon="cameras" onClick={() => openCamera(c.id)}>{T('فتح في الكاميرات', 'Open in Cameras & AI')}</Btn><MapLink r={{ kind: 'camera', id: c.id }} /></div>
        <h4>{T('الحوادث المرتبطة', 'Related incidents')}</h4>
        {related.length ? <ul className="plain">{related.map((i) => <li key={i.id}><ELink r={{ kind: 'incident', id: i.id }} /> {tl(LABELS.category[i.category])} <IncidentStatusBadge status={i.status} /></li>)}</ul> : <p className="muted">{T('لا يوجد', 'None')}</p>}
      </div>
    );
  }

  if (r.kind === 'node') {
    if (!devicesOk) return <Restricted />;
    if (r.id === 'NODE-04') return <CpsNodeDetails />;
    const n = findNode(s, r.id);
    if (!n) return <Empty title={T('غير موجود', 'Not found')} />;
    const sens = s.sensors.filter((x) => x.nodeId === n.id);
    const alerts = s.alerts.filter((a) => a.nodeId === n.id);
    return (
      <div className="dstack">
        <div className="d-title"><h3><Ltr>{n.id}</Ltr></h3><StateBadge state={nodeState(s, n)} /></div>
        <dl className="facts">
          <Field k={T('معرفات بديلة', 'Aliases')}><Ltr>{n.aliases.join(', ')}</Ltr> <span className="muted">{T('(نفس السجل)', '(same record)')}</span></Field>
          <Field k={T('المنطقة', 'Zone')}><ELink r={{ kind: 'zone', id: n.zoneId }} /></Field>
          <Field k={T('الاتصال', 'Connection')}>{n.link} · {nodeState(s, n) === 'offline' ? T('منقطع', 'Disconnected') : T('متصل', 'Connected')}</Field>
          <Field k={T('آخر نبضة', 'Last heartbeat')}><HeartbeatAgo t={lastHeartbeat(n)} /> · <Time t={lastHeartbeat(n)} /></Field>
        </dl>
        <div><h4>{T('النبضات — آخر 3 دقائق', 'Heartbeats — last 3 minutes')}</h4><HeartbeatStrip beats={n.heartbeats} now={s.now} timeoutMs={CONFIG.heartbeatTimeoutMs} label={T('سجل النبضات', 'Heartbeat history')} /></div>
        <MapLink r={{ kind: 'node', id: n.id }} />
        <h4>{T('الحساسات المتصلة', 'Connected sensors')} <span className="muted"><Ltr>({sens.length})</Ltr></span></h4>
        {sens.length ? <ul className="plain">{sens.map((x) => <li key={x.id}><ELink r={{ kind: 'sensor', id: x.id }} /> BME280 <HealthBadge h={sensorHealth(s, x)} /></li>)}</ul> : <p className="muted">{T('لا توجد حساسات متصلة بهذه العقدة', 'No sensors attached to this node')}</p>}
        <h4>{T('التنبيهات', 'Alerts')}</h4>
        {alerts.length ? <ul className="plain">{alerts.map((a) => <li key={a.id}><ELink r={{ kind: 'alert', id: a.id }} /> <AlertStatusBadge status={alertStatus(s, a)} /> <Time t={a.t} /></li>)}</ul> : <p className="muted">{T('لا يوجد', 'None')}</p>}
      </div>
    );
  }

  if (r.kind === 'sensor') {
    if (!devicesOk) return <Restricted />;
    const x = s.sensors.find((y) => y.id === r.id);
    if (!x) return <Empty title={T('غير موجود', 'Not found')} />;
    const h = sensorHealth(s, x);
    const last = sensorLast(x);
    const node = findNode(s, x.nodeId);
    const alerts = s.alerts.filter((a) => a.nodeId === x.nodeId);
    return (
      <div className="dstack">
        <div className="d-title"><h3><Ltr>{x.id}</Ltr></h3><span className="muted">BME280</span><HealthBadge h={h} /></div>
        {h === 'offline' && <p className="warnline">{T('الجهاز غير متصل. القيم المعروضة آخر قيم معروفة وليست قراءات حية.', 'This device is offline. Values shown are last known values, not live readings.')}</p>}
        <BmeReadings se={x} />
        <dl className="facts">
          <Field k={T('آخر تحديث', 'Last update')}><HeartbeatAgo t={last?.t ?? null} /> · <Time t={last?.t} /></Field>
          <Field k={T('المنطقة', 'Zone')}><ELink r={{ kind: 'zone', id: x.zoneId }} /></Field>
          <Field k={T('العقدة المتصلة', 'Connected node')}>{node ? <><ELink r={{ kind: 'node', id: node.id }} /> <StateBadge state={nodeState(s, node)} /></> : <Ltr>{x.nodeId}</Ltr>}</Field>
          <Field k={T('الموقع', 'Position')}>{T('موضع توضيحي على الخريطة', 'Illustrative map position')}</Field>
        </dl>
        <h4>{T('القراءات السابقة', 'Previous readings')}</h4>
        <BmeHistory se={x} />
        <MapLink r={{ kind: 'sensor', id: x.id }} />
        <h4>{T('التنبيهات المرتبطة', 'Related alerts')}</h4>
        {alerts.length ? <ul className="plain">{alerts.map((a) => <li key={a.id}><ELink r={{ kind: 'alert', id: a.id }} /> {tl(alertTitle(a))}</li>)}</ul> : <p className="muted">{T('لا يوجد', 'None')}</p>}
      </div>
    );
  }

  if (r.kind === 'employee') {
    if (!can(ui.role, 'view_employees')) return <Restricted what={T('سجلات الموظفين خارج صلاحيات هذا الدور.', 'Employee records are outside this role’s access.')} />;
    const e = employeeById(s, r.id);
    if (!e) return <Empty title={T('غير موجود', 'Not found')} />;
    const cur = s.incidents.filter((i) => i.assignment?.employeeId === e.id && isOpenIncident(i));
    return (
      <div className="dstack">
        <div className="d-title"><h3>{tl(e.name)}</h3><EmpStatusBadge status={empStatus(s, e)} />{e.accessIssue && <Chip tone="warn">{T('مشكلة دخول', 'Access issue')}</Chip>}</div>
        <dl className="facts">
          <Field k={T('الفريق', 'Team')}><TeamBadge team={e.team} size="sm" /></Field>
          <Field k={T('الدور', 'Role')}>{tl(e.jobRole)}</Field>
          <Field k={T('البطاقة', 'Badge')}><Ltr>{e.badgeId}</Ltr></Field>
          <Field k={T('الحضور', 'Presence')}>{e.onSite ? T('في الموقع', 'On site') : T('خارج الموقع', 'Off site')}</Field>
          <Field k={T('المنطقة المخصصة / الحالية', 'Assigned / current zone')}><Ltr>{e.assignedZoneId}</Ltr> / {e.currentZoneId ? <Ltr>{e.currentZoneId}</Ltr> : T('غير معروفة', 'unknown')} {empNotInZone(e) && <Chip tone="warn">{T('خارج المخصصة', 'Not in assigned')}</Chip>}</Field>
          {e.accessIssue && <Field k={T('مشكلة الدخول', 'Access issue')}>{tl(e.accessIssue)}</Field>}
          <Field k={T('المهام الحالية', 'Current tasks')}>{cur.length ? cur.map((i) => <ELink key={i.id} r={{ kind: 'incident', id: i.id }} />) : <span className="muted">—</span>}</Field>
        </dl>
        <div className="row wrap"><Btn small kind="primary" icon="employees" onClick={() => openEmployee(e.id)}>{T('فتح الملف الكامل', 'Open full profile')}</Btn>{e.currentZoneId && <MapLink r={{ kind: 'employee', id: e.id }} />}</div>
      </div>
    );
  }

  if (r.kind === 'alert') {
    const a = s.alerts.find((x) => x.id === r.id);
    if (!a) return <Empty title={T('غير موجود', 'Not found')} />;
    const inc = a.incidentId ? s.incidents.find((i) => i.id === a.incidentId) : undefined;
    const ev = a.eventId ? s.events.find((e) => e.id === a.eventId) : undefined;
    const incOk = inc && incidentVisible(ui.role, persona.userId, inc);
    return (
      <div className="dstack">
        <div className="d-title"><h3>{tl(alertTitle(a))}</h3></div>
        <div className="chips"><SevBadge sev={a.severity} /><AlertStatusBadge status={alertStatus(s, a)} /></div>
        <dl className="facts">
          <Field k={T('المصدر', 'Source')}><Ltr>{a.sourceLabel}</Ltr></Field>
          <Field k={T('المنطقة', 'Zone')}><ELink r={{ kind: 'zone', id: a.zoneId }} /></Field>
          <Field k={T('الوقت', 'Time')}><Time t={a.t} date /></Field>
          {a.clearedAt && <Field k={T('زال في', 'Cleared at')}><Time t={a.clearedAt} /></Field>}
          {ev && <Field k={T('الحدث المصدر', 'Source event')}><Ltr>{ev.id}</Ltr> · {tl(LABELS.category[ev.category])} {ev.simulated && <SimTag />}</Field>}
          {a.nodeId && <Field k={T('العقدة', 'Node')}><ELink r={{ kind: 'node', id: a.nodeId }} /></Field>}
          {a.employeeId && <Field k={T('الموظف', 'Employee')}>{can(ui.role, 'view_employees') ? <ELink r={{ kind: 'employee', id: a.employeeId }} /> : <Ltr>{a.employeeId}</Ltr>}</Field>}
        </dl>
        {inc && incOk && (
          <div className="linked">
            <h4>{T('الحادثة المرتبطة', 'Linked incident')}</h4>
            <IncidentHeader inc={inc} />
            <IncidentFacts inc={inc} />
            <div className="row wrap">
              <Btn kind="primary" icon="incidents" onClick={() => openIncident(inc.id)}>{T('فتح الحادثة', 'Open incident')}</Btn>
              {inc.pos && <MapLink r={{ kind: 'incident', id: inc.id }} />}
            </div>
          </div>
        )}
        {inc && !incOk && <p className="muted">{T('الحادثة المرتبطة غير مكلف بها لك.', 'The linked incident is not assigned to you.')}</p>}
        {!inc && a.nodeId && <Btn icon="iot" onClick={() => { if (can(ui.role, 'view_devices')) { set({ section: 'iot', iotTab: 'ot', drawer: [] }); openDrawer({ kind: 'node', id: a.nodeId! }); } }} disabled={!can(ui.role, 'view_devices')}>{T('فتح في إنترنت الأشياء', 'Open in IoT / CPS')}</Btn>}
      </div>
    );
  }

  if (r.kind === 'incident') {
    const inc = s.incidents.find((i) => i.id === r.id);
    if (!inc) return <Empty title={T('غير موجود', 'Not found')} />;
    if (!incidentVisible(ui.role, persona.userId, inc)) return <Restricted what={T('يرى المستجيب الميداني الحوادث المكلف بها فقط.', 'Field responders only see incidents assigned to them.')} />;
    const rt = responseTimeMs(inc);
    return (
      <div className="dstack">
        <IncidentHeader inc={inc} />
        <IncidentFacts inc={inc} />
        {inc.assignment && <p><span className="muted">{T('المستجيب', 'Responder')}</span> <Ltr>{inc.assignment.employeeId}</Ltr> · {T('زمن الاستجابة', 'Response time')} {rt != null ? <Ltr>{fmtDuration(rt, ui.lang)}</Ltr> : T('قيد الانتظار', 'Pending')}</p>}
        <Timeline inc={inc} />
        <div className="row wrap"><Btn kind="primary" icon="incidents" onClick={() => openIncident(inc.id)}>{T('فتح الحادثة', 'Open incident')}</Btn>{inc.pos && <MapLink r={{ kind: 'incident', id: inc.id }} />}</div>
      </div>
    );
  }
  return null;
}

/** Map sheet opened from any "show on map" link; keeps the current page underneath. */
export function MapModal() {
  const { ui, set, T } = useUI();
  if (!ui.mapModal) return null;
  return (
    <>
      <div className="scrim top" onClick={() => set({ mapModal: null })} aria-hidden="true" />
      <div className="map-modal" role="dialog" aria-label={T('الخريطة', 'Map')}>
        <header className="drawer-h">
          <Icon name="pin" size={18} /><span className="drawer-k"><Ltr>{ui.mapModal.id}</Ltr></span>
          <button type="button" className="ibtn end" onClick={() => set({ mapModal: null })} aria-label={T('إغلاق', 'Close')}><Icon name="close" /></button>
        </header>
        <ExpoMap height="100%" focus={{ ref: ui.map.focus, nonce: ui.map.nonce }} layers={['cameras', 'devices', 'employees', 'incidents']} />
      </div>
    </>
  );
}
