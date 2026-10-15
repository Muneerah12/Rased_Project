import { useState } from 'react';
import { useAi, useStore, useUI } from '../state/store';
import type { EntityRef } from '../state/store';
import {
  cameraState, inScope, isOpenIncident, nodeState, sensorHealth, zoneOccupancy,
} from '../model/selectors';
import { incidentVisible } from '../services/permissions';
import { LABELS } from '../ui/labels';
import { Card, Chip, ELink, Empty, HealthBadge, Ltr, SimTag, StateBadge, Time, Btn } from '../ui/primitives';
import { AlertsList, EmployeeActivityPanel, KpiRow, scopeLabel } from '../ui/panels';
import { IncidentsDonut } from '../ui/dashCharts';
import { ExpoMap } from '../ui/ExpoMap';
import { CrowdChart } from '../ui/charts';
import { BmeHistory, BmeReadings } from '../ui/bme';
import { CameraView } from '../ui/feeds';
import { ActionsLog, EvidenceList, IncidentFacts, IncidentHeader, ResponsePanel, Timeline, DronePanel } from '../ui/incident';
import { EmployeesWorkspace } from './Employees';
import { ReportsList, ReportDetail } from './Reports';
import { EventsTable } from './Cameras';
import { Icon } from '../ui/icons';
import {
  isVerifiedOperationalAlert, isVerifiedOperationalIncident, operationalPeopleObservation,
} from '../services/operationalOverview';

export function Dashboard() {
  const { ui } = useUI();
  switch (ui.role) {
    case 'operator': return <OperatorDash />;
    case 'analyst': return <AnalystDash />;
    case 'privacy': return <PrivacyDash />;
    case 'access_admin': return <AccessDash />;
    case 'responder': return <ResponderDash />;
  }
}

function operationalTimestamp(value: string | null, lang: 'ar' | 'en'): string {
  if (!value) return lang === 'ar' ? 'غير متاح' : 'Unavailable';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('en-GB', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
}

function OperatorDash() {
  const { T, ui, set, openDrawer, openCamera } = useUI();
  const onSelect = (r: EntityRef) => {
    if (r.kind === 'zone') set({ scope: r.id });
    openDrawer(r);
  };
  const chartZone = ui.scope === 'A1' || ui.scope === 'ALL' ? 'A1.1' : ui.scope;
  return (
    <div className="page dash op">
      <KpiRow />
      <div className="op-main">
        <Card className="map-card" title={T('خريطة إكسبو', 'Expo map')} icon="pin" sub={scopeLabel(ui.scope, T)}
          actions={<Btn small kind="ghost" icon="cameras" onClick={() => openCamera('CAM-C')}>{T('كاميرا 1 (المركزية)', 'Camera 1 (central)')}</Btn>}>
          <ExpoMap height="100%" onSelect={onSelect} focus={{ ref: ui.map.focus, nonce: ui.map.nonce }} />
        </Card>
      </div>
      <div className="dash-viz">
        <Card title={T('الحوادث حسب النوع', 'Incidents by type')} icon="incidents" sub={scopeLabel(ui.scope, T)}><IncidentsDonut /></Card>
      </div>
      <VerifiedOperationalPanel />
      <div className="grid2">
        <Card title={T('تحليلات الحشود', 'Crowd analytics')} icon="crowd" sub={<Ltr>{chartZone}</Ltr>}><CrowdChart zoneId={chartZone} /></Card>
        <Card title={T('نشاط وتوفر الموظفين', 'Employee activity & availability')} icon="employees" sub={scopeLabel(ui.scope, T)} className="scroll-card"><EmployeeActivityPanel /></Card>
      </div>
    </div>
  );
}

/** Provenance-verified live AI observations (no simulated or fixture data). */
function VerifiedOperationalPanel() {
  const { s } = useStore();
  const ai = useAi();
  const { T, ui } = useUI();
  const people = operationalPeopleObservation(ai.connected, ai.frames['CAM-1'], ai.now());
  const realIncidents = s.incidents.filter((incident) => isVerifiedOperationalIncident(incident, s.events));
  const realAlerts = s.alerts.filter((alert) => isVerifiedOperationalAlert(alert, s.incidents, s.events));
  const openIncidents = realIncidents.filter((incident) => isOpenIncident(incident));
  const activeAlerts = realAlerts.filter((alert) => !alert.clearedAt);
  const peopleTone = people.freshness === 'FRESH' ? 'ok' : people.freshness === 'STALE' ? 'warn' : 'neutral';
  return <div className="grid2">
      <Card title={T('ملاحظة الأشخاص الحية', 'Live people observation')} icon="crowd" sub={<Chip tone={peopleTone}>{people.freshness === 'FRESH' ? T('AI حي', 'Live AI') : people.freshness === 'STALE' ? T('قديمة', 'Stale') : T('غير متاح', 'Unavailable')}</Chip>}>
        {people.value === null ? <Empty icon="crowd" title={people.freshness === 'STALE' ? T('ملاحظة AI قديمة', 'AI observation is stale') : T('لا توجد ملاحظة AI حية موثقة', 'No verified live AI observation')}>
          {people.observedAt !== null && <p className="fine"><Ltr>{operationalTimestamp(new Date(people.observedAt).toISOString(), ui.lang)}</Ltr></p>}
        </Empty> : <dl className="facts">
          <div className="field"><dt>{T('عدد الأشخاص', 'People count')}</dt><dd><strong><Ltr>{people.value}</Ltr></strong></dd></div>
          <div className="field"><dt>{T('المصدر', 'Source')}</dt><dd><Ltr>CAM-1 · live_ai</Ltr></dd></div>
          <div className="field"><dt>{T('وقت الملاحظة', 'Observed at')}</dt><dd><Ltr>{operationalTimestamp(new Date(people.observedAt!).toISOString(), ui.lang)}</Ltr></dd></div>
        </dl>}
        <p className="fine">{T('لا تُعرض سعة المنطقة أو سجل الحشود لأنهما لا يملكان مصدراً تشغيلياً موثقاً.', 'Zone capacity and crowd history are not shown because no verified operational source exists.')}</p>
      </Card>
      <Card title={T('الحوادث والتنبيهات التشغيلية', 'Operational incidents and alerts')} icon="incidents" sub={T('أحداث AI موثقة فقط', 'Verified AI events only')}>
        {openIncidents.length || activeAlerts.length ? <ul className="plain">
          {openIncidents.map((incident) => <li key={incident.id}><strong><Ltr>{incident.id}</Ltr></strong> · <Ltr>{incident.sourceDeviceId}</Ltr> · <Time t={incident.detectedAt} /></li>)}
          {activeAlerts.map((alert) => <li key={alert.id}><strong><Ltr>{alert.id}</Ltr></strong> · <Ltr>{alert.sourceLabel}</Ltr> · <Time t={alert.t} /></li>)}
        </ul> : <Empty icon="incidents" title={T('لا توجد سجلات تشغيلية موثقة', 'No verified operational records')} />}
        <p className="fine">{T('تُستبعد سجلات المحاكاة والسجلات ذات المصدر غير الواضح من هذا العرض.', 'Simulation records and records with ambiguous provenance are excluded from this view.')}</p>
      </Card>
  </div>;
}

function AnalystDash() {
  const { s } = useStore();
  const { T, tl, ui, openDrawer } = useUI();
  const [sel, setSel] = useState<EntityRef>({ kind: 'camera', id: 'CAM-1' });
  const [sensorId, setSensorId] = useState('BME-A1-01');
  const cams = s.cameras.filter((c) => inScope(s, c.zoneId, ui.scope));
  const nodes = s.nodes.filter((n) => inScope(s, n.zoneId, ui.scope));
  const cam = sel.kind === 'camera' ? s.cameras.find((c) => c.id === sel.id) : undefined;
  const node = sel.kind === 'node' ? s.nodes.find((n) => n.id === sel.id) : undefined;
  const devId = cam?.id ?? node?.id ?? '';
  const byRecency = (a: { detectedAt: number }, b: { detectedAt: number }) => b.detectedAt - a.detectedAt;
  const fromSource = s.incidents.filter((i) => i.kind === 'expo' && i.sourceDeviceId === devId)
    .sort((a, b) => Number(isOpenIncident(b)) - Number(isOpenIncident(a)) || byRecency(a, b))[0];
  const inScopeOpen = s.incidents.filter((i) => i.kind === 'expo' && isOpenIncident(i) && inScope(s, i.zoneId, ui.scope)).sort(byRecency)[0];
  const related = fromSource ?? inScopeOpen;
  const occ = cam?.countsZone ? zoneOccupancy(s, cam.zoneId) : null;
  const sensor = s.sensors.find((x) => x.id === sensorId);
  const sensorsInScope = s.sensors.filter((x) => inScope(s, x.zoneId, ui.scope));
  return (
    <div className="page dash an">
      <div className="an-top">
        <Card title={T('التنبيهات', 'Alerts')} icon="bell" sub={scopeLabel(ui.scope, T)} className="scroll-card"><AlertsList limit={5} /></Card>
        <Card title={T('حالة الكاميرات وإنترنت الأشياء', 'Camera & IoT status')} icon="signal" sub={scopeLabel(ui.scope, T)} className="scroll-card">
          <div className="devgrid">
            {cams.map((c) => (
              <button key={c.id} type="button" className={`devtile${sel.id === c.id ? ' on' : ''}`} onClick={() => setSel({ kind: 'camera', id: c.id })} aria-pressed={sel.id === c.id}>
                <Icon name="camera" size={16} /><span>{tl(c.label)}</span><StateBadge state={cameraState(s, c)} />
              </button>
            ))}
            {nodes.map((n) => (
              <button key={n.id} type="button" className={`devtile${sel.id === n.id ? ' on' : ''}`} onClick={() => setSel({ kind: 'node', id: n.id })} aria-pressed={sel.id === n.id}>
                <Icon name="router" size={16} /><Ltr>{n.aliases[0] ?? n.id}</Ltr><StateBadge state={nodeState(s, n)} />
              </button>
            ))}
            {!cams.length && !nodes.length && <Empty title={T('لا توجد أجهزة في هذا النطاق', 'No devices in this scope')} />}
          </div>
        </Card>
      </div>
      <div className="an-main">
        <Card className="evidence-card" title={T('الدليل المحدد', 'Selected evidence')} icon={cam ? 'camera' : 'node'} sub={cam ? tl(cam.label) : <Ltr>{devId}</Ltr>}
          actions={<Btn small kind="ghost" onClick={() => openDrawer(sel)}>{T('تفاصيل الجهاز', 'Device details')}</Btn>}>
          {cam && (
            <>
              <CameraView cameraId={cam.id} name={tl(cam.label)} online={cam.online} analyzing={!!s.analysisRunning[cam.id]} t={s.now}
                count={occ?.people ?? null} capacity={occ?.capacity ?? null} level={occ?.status ? tl(LABELS.crowd[occ.status]) : undefined} />
              <div className="cam-meta">
                <span>{T('المنطقة', 'Zone')} <Ltr>{cam.zoneId}</Ltr></span>
                <span>{T('حالة التحليل', 'AI status')} {!cam.online ? T('غير متصلة', 'Offline') : s.analysisRunning[cam.id] ? T('قيد التحليل', 'Analyzing') : T('متوقف', 'Paused')} {s.baseMode !== 'live' && <SimTag />}</span>
                {!cam.countsZone && <span className="muted">{T('هذه الكاميرا لرصد الأحداث ولا تنتج عدّاً للأشخاص.', 'This camera detects events and does not produce a person count.')}</span>}
              </div>
            </>
          )}
          {node && (
            <div className="dstack">
              <div className="chips"><StateBadge state={nodeState(s, node)} /><Chip tone="neutral"><Ltr>{node.aliases.join(', ')}</Ltr></Chip></div>
              <ul className="plain">{s.sensors.filter((x) => x.nodeId === node.id).map((x) => (
                <li key={x.id} className="dstack"><span className="row wrap"><ELink r={{ kind: 'sensor', id: x.id }} /> BME280 <HealthBadge h={sensorHealth(s, x)} /></span><BmeReadings se={x} compact /></li>
              ))}</ul>
            </div>
          )}
        </Card>
        <Card title={T('الحادثة المرتبطة', 'Related incident')} icon="incidents" className="scroll-card">
          {related ? (
            <div className="dstack">
              {!fromSource && <p className="fine">{T('لا توجد حوادث من هذا المصدر؛ يُعرض أحدث حادثة مفتوحة في النطاق.', 'No incidents from this source; showing the latest open incident in scope.')}</p>}
              <IncidentHeader inc={related} /><IncidentFacts inc={related} /><Timeline inc={related} />
            </div>
          ) : <Empty title={T('لا توجد حوادث من هذا المصدر', 'No incidents from this source')} />}
        </Card>
      </div>
      <div className="grid2">
        <Card title={T('سجل الأحداث', 'Event history')} icon="signal" className="scroll-card"><EventsTable compact /></Card>
        <Card title={T('سجل القراءات', 'Reading history')} icon="sensor"
          actions={
            <select className="sel" value={sensorId} onChange={(e: { target: { value: string } }) => setSensorId(e.target.value)} aria-label={T('اختر الحساس', 'Choose sensor')}>
              {sensorsInScope.map((x) => <option key={x.id} value={x.id}>{x.id}</option>)}
            </select>
          }>
          {sensor ? (
            <div className="dstack">
              <div className="chips"><strong><Ltr>{sensor.id}</Ltr></strong><span className="muted">BME280</span><HealthBadge h={sensorHealth(s, sensor)} /></div>
              <BmeReadings se={sensor} />
              <BmeHistory se={sensor} />
            </div>
          ) : <Empty title={T('لا توجد حساسات في هذا النطاق', 'No sensors in this scope')} />}
        </Card>
      </div>
    </div>
  );
}

function PrivacyDash() {
  const { s } = useStore();
  const { T, ui, set } = useUI();
  const list = s.incidents.filter((i) => inScope(s, i.zoneId, ui.scope) || ui.scope === 'ALL');
  const selId = ui.reportId && s.incidents.some((i) => i.id === ui.reportId) ? ui.reportId : list.find((i) => i.status === 'closed')?.id ?? list[0]?.id ?? null;
  const inc = s.incidents.find((i) => i.id === selId);
  return (
    <div className="page dash pr">
      <div className="pr-main">
        <Card title={T('تقارير الحوادث', 'Incident reports')} icon="reports" sub={scopeLabel(ui.scope, T)} className="scroll-card">
          <ReportsList selected={selId} onSelect={(id) => set({ reportId: id })} />
        </Card>
        <Card title={T('التقرير والجدول الزمني', 'Report & timeline')} icon="clock" className="scroll-card">
          {selId ? <ReportDetail id={selId} compact /> : <Empty title={T('اختر تقريراً', 'Select a report')} />}
        </Card>
      </div>
      <div className="pr-side">
        <Card title={T('أدلة المصدر', 'Source evidence')} icon="camera">{inc ? <EvidenceList inc={inc} /> : <Empty title="—" />}</Card>
        <Card title={T('الإجراءات المسجلة', 'Recorded actions')} icon="reports" sub={T('من سجل الحادثة', 'From the incident record')}>{inc ? <ActionsLog inc={inc} /> : <Empty title="—" />}</Card>
        <p className="fine">{T('لم تُزوَّد سياسات إخفاء أو احتفاظ؛ لا تُطبق هنا قواعد جديدة. يعرض هذا الدور التقارير وسجل الإجراءات دون وصول إلى البث المباشر أو سجلات الموظفين.', 'No masking or retention policy was supplied, so none is applied here. This role sees reports and action records without access to live feeds or employee records.')}</p>
      </div>
    </div>
  );
}

function AccessDash() {
  return <div className="page dash aa"><EmployeesWorkspace admin /></div>;
}

/** Field responder: task-led, mobile-first. Shows only the incident assigned to this responder. */
function ResponderDash() {
  const { s } = useStore();
  const { T, tl, persona, ui } = useUI();
  const mine = s.incidents.filter((i) => incidentVisible(ui.role, persona.userId, i));
  const active = mine.filter((i) => i.status !== 'closed' && i.status !== 'resolved').sort((a, b) => b.detectedAt - a.detectedAt)[0];
  const recent = mine.filter((i) => i !== active).sort((a, b) => b.detectedAt - a.detectedAt);
  const me = s.employees.find((e) => e.id === persona.userId);
  return (
    <div className="page dash rs">
      <div className="rs-me"><Icon name="user" size={18} /><strong>{tl(persona.name)}</strong> <Ltr>{persona.userId}</Ltr>{me && <span className="muted">· {tl(LABELS.team[me.team])}</span>}</div>
      {active ? (
        <>
          <Card className="task-card" title={T('مهمتي الحالية', 'My assigned incident')} icon="incidents">
            <IncidentHeader inc={active} />
            <ResponsePanel inc={active} />
          </Card>
          <Card title={T('الموقع', 'Location')} icon="pin" sub={<Ltr>{active.zoneId}</Ltr>}>
            <p className="loc">{tl(active.location)}</p>
            <ExpoMap key={active.id} height={300} controls={false} legend={false} layers={['incidents', 'cameras']} focus={{ ref: { kind: active.pos ? 'incident' : 'zone', id: active.pos ? active.id : active.zoneId }, nonce: 1 }} />
          </Card>
          <Card title={T('تفاصيل الحادثة', 'Incident details')} icon="reports"><IncidentFacts inc={active} /><Timeline inc={active} /></Card>
          {active.drone && <Card title={T('دعم الطائرة المسيرة', 'Drone support')} icon="drone"><DronePanel inc={active} /></Card>}
        </>
      ) : (
        <Card title={T('مهمتي الحالية', 'My assigned incident')} icon="incidents">
          <Empty title={T('لا توجد حادثة مكلف بها حالياً', 'No incident assigned right now')}>{T('ستظهر هنا فور تكليفك من مركز القيادة.', 'It appears here as soon as the Command Centre assigns you.')}</Empty>
        </Card>
      )}
      {recent.length > 0 && (
        <Card title={T('مهامي السابقة', 'My previous incidents')} icon="clock">
          <ul className="plain">{recent.map((i) => <li key={i.id}><ELink r={{ kind: 'incident', id: i.id }} /> {tl(LABELS.category[i.category])} · <Time t={i.detectedAt} /></li>)}</ul>
        </Card>
      )}
    </div>
  );
}

