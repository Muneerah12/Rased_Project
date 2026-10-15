import type { ReactNode } from 'react';
import { useStore, useUI } from '../state/store';
import {
  alertStatus, cameraLabel, empNotInZone, empStatus, inScope, isOpenIncident, scopeStats,
} from '../model/selectors';
import { fmtAgo } from '../model/config';
import { can, incidentVisible } from '../services/permissions';
import { alertTitle, LABELS } from './labels';
import {
  AlertStatusBadge, Chip, CrowdBadge, ELink, Empty, EmpStatusBadge, IncidentStatusBadge, Ltr, SevBadge, Time,
} from './primitives';
import { Icon, IncidentIcon } from './icons';
import type { IconName } from './icons';
import { KpiDonut, KpiGauge, KpiRings } from './dashCharts';

const SEV_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };
const STATUS_ORDER = { active: 0, in_response: 1, resolved: 2, cleared: 3 };

export function scopeLabel(scope: string, T: (a: string, e: string) => string) {
  return scope === 'ALL' ? T('كامل الموقع', 'Site-wide') : scope;
}

export function KpiRow({ compact }: { compact?: boolean }) {
  const { s } = useStore();
  const { T, tl, ui, go, set } = useUI();
  const st = scopeStats(s, ui.scope);
  const sc = scopeLabel(ui.scope, T);
  const canEmp = can(ui.role, 'view_employees');
  const pct = st.people != null && st.capacity ? Math.round((st.people / st.capacity) * 100) : null;
  const tone = st.crowd === 'crowded' ? 'crit' : st.crowd === 'medium' ? 'warn' : st.crowd ? 'ok' : 'neutral';
  const free = s.employees.filter((e) => empStatus(s, e) === 'available' && e.currentZoneId && inScope(s, e.currentZoneId, ui.scope)).length;
  // same filters as scopeStats, so each donut adds up to its KPI number
  const openInc = s.incidents.filter((i) => i.kind === 'expo' && isOpenIncident(i) && inScope(s, i.zoneId, ui.scope));
  const presentEmp = s.employees.filter((e) => e.onSite && e.availability !== 'off_duty' && e.currentZoneId && inScope(s, e.currentZoneId, ui.scope));
  const activeAlr = s.alerts.filter((a) => alertStatus(s, a) === 'active' && inScope(s, a.zoneId, ui.scope));
  return (
    <div className={`kpis main${compact ? ' compact' : ''}`}>
      {/* people, capacity and crowd level in one tile */}
      <div className={`kpi kpi-people t-${tone}`}>
        <div className="kpi-top"><span className="kpi-l">{T('الأشخاص الآن', 'People now')}</span><Icon name="crowd" size={16} /></div>
        <div className="kpi-gauge-wrap" role="img" aria-label={st.people != null ? T(`${st.people} من ${st.capacity} (${pct}% من السعة)`, `${st.people} of ${st.capacity} (${pct}% of capacity)`) : T('لا توجد بيانات إشغال', 'No occupancy data')}>
          <KpiGauge value={st.people} max={st.capacity} />
        </div>
        <div className="kpi-s">
          {pct != null
            ? <><CrowdBadge status={st.crowd} /> <Ltr>{pct}%</Ltr> {T('من السعة', 'of capacity')}</>
            : T('لا توجد بيانات إشغال — شغّل كاميرا العدّ', 'No occupancy data — start the counting camera')}
        </div>
        <div className="kpi-scope">{sc}</div>
      </div>
      <DonutKpi label={T('حوادث مفتوحة', 'Open incidents')} glyph="incidents" tone={st.openIncidents ? 'high' : 'neutral'} scope={sc}
        aria={T(`${st.openIncidents} حوادث مفتوحة`, `${st.openIncidents} open incidents`)} caption={T('مفتوحة', 'open')}
        parts={(['open', 'assigned', 'responding'] as const).map((k) => ({ key: k, label: tl(LABELS.incidentStatus[k]), n: openInc.filter((i) => i.status === k).length, color: INC_COLOR[k] }))}
        onClick={can(ui.role, 'view_all_incidents') ? () => set({ section: 'incidents', incidentTab: 'expo', incidentId: null, drawer: [] }) : undefined} />
      <DonutKpi label={T('تنبيهات نشطة', 'Active alerts')} glyph="bell" tone={st.activeAlerts ? 'crit' : 'neutral'} scope={sc}
        aria={T(`${st.activeAlerts} تنبيهات نشطة`, `${st.activeAlerts} active alerts`)} caption={T('نشطة', 'active')}
        parts={[
          { key: 'high', label: T('حرجة وعالية', 'Critical & high'), n: activeAlr.filter((a) => a.severity === 'critical' || a.severity === 'high').length, color: 'var(--crit)' },
          { key: 'medium', label: tl(LABELS.severity.medium), n: activeAlr.filter((a) => a.severity === 'medium').length, color: 'var(--warn)' },
          { key: 'low', label: tl(LABELS.severity.low), n: activeAlr.filter((a) => a.severity === 'low').length, color: 'var(--ok)' },
        ]}
        onClick={() => set({ alertsOpen: true })} />
      <RingsKpi label={T('الموظفون الحاضرون', 'Employees present')} glyph="employees" tone={free ? 'neutral' : 'warn'} scope={sc}
        aria={T(`${st.employeesPresent} موظفون حاضرون، ${free} متاح للتكليف`, `${st.employeesPresent} employees present, ${free} available to assign`)}
        parts={(['available', 'responding', 'on_task'] as const).map((k) => ({ key: k, label: tl(LABELS.empStatus[k]), n: presentEmp.filter((e) => empStatus(s, e) === k).length, color: EMP_COLOR[k], icon: EMP_ICON[k] }))}
        total={st.employeesPresent} totalLabel={T('الحاضرون', 'Present')}
        extra={{ label: T('خارج المنطقة المخصصة', 'Outside assigned zone'), n: st.notInZone }}
        onClick={canEmp ? () => go('employees') : undefined} />
    </div>
  );
}

const INC_COLOR = { open: 'var(--crit)', assigned: 'var(--warn)', responding: 'var(--info)' };

function DonutKpi({ label, glyph, tone, scope, aria, parts, caption, onClick }: {
  label: string; glyph: IconName; tone: string; scope: ReactNode; aria: string; caption?: string;
  parts: { key: string; label: string; n: number; color: string }[]; onClick?: () => void;
}) {
  const inner = (
    <>
      <div className="kpi-top"><span className="kpi-l">{label}</span><Icon name={glyph} size={16} /></div>
      <div className="kpi-donut-mid" role="img" aria-label={aria}><KpiDonut parts={parts} caption={caption} /></div>
      <div className="kpi-scope">{scope}</div>
    </>
  );
  return onClick
    ? <button type="button" className={`kpi kpi-donut-tile t-${tone} clickable`} onClick={onClick}>{inner}</button>
    : <div className={`kpi kpi-donut-tile t-${tone}`}>{inner}</div>;
}

const EMP_COLOR = { available: 'var(--ok)', responding: 'var(--high)', on_task: 'var(--info)' };
const EMP_ICON: Record<keyof typeof EMP_COLOR, IconName> = { available: 'user_ok', responding: 'user_go', on_task: 'user_task' };

function RingsKpi({ label, glyph, tone, scope, aria, onClick, ...rings }: {
  label: string; glyph: IconName; tone: string; scope: ReactNode; aria: string; onClick?: () => void;
} & Parameters<typeof KpiRings>[0]) {
  const inner = (
    <>
      <div className="kpi-top"><span className="kpi-l">{label}</span><Icon name={glyph} size={16} /></div>
      <div role="img" aria-label={aria}><KpiRings {...rings} /></div>
      <div className="kpi-scope">{scope}</div>
    </>
  );
  return onClick
    ? <button type="button" className={`kpi t-${tone} clickable`} onClick={onClick}>{inner}</button>
    : <div className={`kpi t-${tone}`}>{inner}</div>;
}

export function AlertsList({ limit, activeFirst = true }: { limit?: number; activeFirst?: boolean }) {
  const { s } = useStore();
  const { T, tl, ui, openDrawer, persona } = useUI();
  let list = s.alerts.filter((a) => inScope(s, a.zoneId, ui.scope));
  if (ui.role === 'responder') list = list.filter((a) => { const i = s.incidents.find((x) => x.id === a.incidentId); return i && incidentVisible(ui.role, persona.userId, i); });
  list = [...list].sort((a, b) => {
    const sa = alertStatus(s, a); const sb = alertStatus(s, b);
    if (activeFirst && STATUS_ORDER[sa] !== STATUS_ORDER[sb]) return STATUS_ORDER[sa] - STATUS_ORDER[sb];
    if (SEV_ORDER[a.severity] !== SEV_ORDER[b.severity]) return SEV_ORDER[a.severity] - SEV_ORDER[b.severity];
    return b.t - a.t;
  });
  const shown = limit ? list.slice(0, limit) : list;
  if (!shown.length) return <Empty title={T('لا توجد تنبيهات في هذا النطاق', 'No alerts in this scope')} />;
  return (
    <ul className="alist">
      {shown.map((a) => {
        const st = alertStatus(s, a);
        return (
          <li key={a.id}>
            <button type="button" className={`arow sev-${a.severity} ast-${st}`} onClick={() => openDrawer({ kind: 'alert', id: a.id })}>
              <span className="arow-bar" aria-hidden="true" />
              <span className="arow-main">
                <span className="arow-t">{tl(alertTitle(a))}</span>
                <span className="arow-m"><Ltr>{a.sourceLabel}</Ltr> · <Ltr>{a.zoneId}</Ltr> · <Time t={a.t} /></span>
              </span>
              <span className="arow-b"><SevBadge sev={a.severity} /><AlertStatusBadge status={st} /></span>
            </button>
          </li>
        );
      })}
      {limit && list.length > limit && <li className="more muted">{T(`+${list.length - limit} تنبيهات أخرى`, `+${list.length - limit} more alerts`)}</li>}
    </ul>
  );
}

export function OpenIncidentsList({ showClosed }: { showClosed?: boolean }) {
  const { s } = useStore();
  const { T, tl, ui, openIncident, persona } = useUI();
  const list = s.incidents
    .filter((i) => i.kind === 'expo' && (showClosed || isOpenIncident(i)) && inScope(s, i.zoneId, ui.scope) && incidentVisible(ui.role, persona.userId, i))
    .sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity] || b.detectedAt - a.detectedAt);
  if (!list.length) return <Empty title={T('لا توجد حوادث مفتوحة', 'No open incidents')} />;
  return (
    <ul className="ilist">
      {list.map((i) => (
        <li key={i.id}>
          <button type="button" className={`irow sev-${i.severity}`} onClick={() => openIncident(i.id)}>
            <span className="irow-id"><IncidentIcon category={i.category} size={18} /><Ltr>{i.id}</Ltr></span>
            <span className="irow-t">{tl(LABELS.category[i.category])}</span>
            <span className="irow-m"><Ltr>{i.zoneId}</Ltr> · {cameraLabel(s, i.sourceDeviceId) ? tl(cameraLabel(s, i.sourceDeviceId)) : <>{tl(LABELS.source[i.source])} <Ltr>{i.sourceDeviceId}</Ltr></>} · <Time t={i.detectedAt} /></span>
            <span className="irow-b">
              <SevBadge sev={i.severity} /><IncidentStatusBadge status={i.status} />
              {i.assignment ? <Chip tone="info" icon={<Icon name="user" size={13} />}><Ltr>{i.assignment.employeeId}</Ltr> · {tl(LABELS.responder[i.assignment.current])}</Chip>
                : can(ui.role, 'assign') ? <Chip tone="brand">{T('بانتظار التكليف', 'Needs assignment')}</Chip> : null}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function EmployeeActivityPanel({ limit }: { limit?: number }) {
  const { s } = useStore();
  const { T, tl, ui, openDrawer } = useUI();
  const list = s.employees.filter((e) => inScope(s, e.assignedZoneId, ui.scope) || (e.currentZoneId && inScope(s, e.currentZoneId, ui.scope)));
  const order = { responding: 0, unseen: 1, on_task: 2, available: 3, off_duty: 4 };
  const sorted = [...list].sort((a, b) => order[empStatus(s, a)] - order[empStatus(s, b)]);
  const shown = limit ? sorted.slice(0, limit) : sorted;
  if (!shown.length) return <Empty title={T('لا يوجد موظفون في هذا النطاق', 'No employees in this scope')} />;
  return (
    <div className="tbl-wrap">
      <table className="tbl compact">
        <thead><tr><th>{T('الموظف', 'Employee')}</th><th>{T('الحالة', 'Status')}</th><th>{T('المنطقة الحالية', 'Current zone')}</th><th>{T('الحادثة المكلف بها', 'Assigned incident')}</th><th>{T('حضور / انصراف', 'In / out')}</th></tr></thead>
        <tbody>
          {shown.map((e) => {
            const inc = s.incidents.find((i) => i.assignment?.employeeId === e.id && isOpenIncident(i));
            return (
              <tr key={e.id} className="clickable" onClick={() => openDrawer({ kind: 'employee', id: e.id })}>
                <td><button type="button" className="elink" onClick={(ev: { stopPropagation(): void }) => { ev.stopPropagation(); openDrawer({ kind: 'employee', id: e.id }); }}><Ltr>{e.id}</Ltr></button> {tl(e.name)}</td>
                <td><EmpStatusBadge status={empStatus(s, e)} />{e.accessIssue && <Chip tone="warn">{T('مشكلة دخول', 'Access issue')}</Chip>}</td>
                <td>{e.currentZoneId ? <Ltr>{e.currentZoneId}</Ltr> : <span className="muted">{T('غير معروفة', 'Unknown')}</span>}{empNotInZone(e) && <Chip tone="warn">{T('خارج المخصصة', 'Not in assigned')}</Chip>}</td>
                <td>{inc ? <ELink r={{ kind: 'incident', id: inc.id }} /> : <span className="muted">—</span>}</td>
                <td className="nowrap"><Time t={e.checkIn} short /> {e.checkOut ? <>→ <Time t={e.checkOut} short /></> : ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function HeartbeatAgo({ t }: { t: number | null }) {
  const { s } = useStore();
  const { ui } = useUI();
  return <span className="nowrap">{fmtAgo(s.now, t, ui.lang)}</span>;
}
