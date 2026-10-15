import { useState } from 'react';
import { useStore, useUI } from '../state/store';
import {
  empNotInZone, empStatus, employeeById, incidentsForEmployee, inScope, isOpenIncident, permitStatus, responseTimeMs,
} from '../model/selectors';
import type { EmpStatus } from '../model/selectors';
import { fmtDuration } from '../model/config';
import { can } from '../services/permissions';
import { LABELS } from '../ui/labels';
import { Card, Chip, ELink, Empty, EmpStatusBadge, Field, IncidentStatusBadge, Ltr, Restricted, SevBadge, Time, useFocusOnOpen } from '../ui/primitives';
import { TeamBadge } from '../ui/teams';
import { Icon } from '../ui/icons';

type Filter = EmpStatus | 'access' | 'not_in_zone' | 'all';

export function Employees() {
  const { ui } = useUI();
  if (!can(ui.role, 'view_employees')) return <div className="page"><Restricted /></div>;
  return <div className="page"><EmployeesWorkspace admin={ui.role === 'access_admin'} /></div>;
}

export function EmployeesWorkspace({ admin }: { admin?: boolean }) {
  const { s } = useStore();
  const { T, tl, ui, set, openIncident } = useUI();
  const [f, setF] = useState<Filter>('all');
  const [team, setTeam] = useState('all');
  const [q, setQ] = useState('');
  const [scoped, setScoped] = useState(false);
  const counts: Record<string, number> = {};
  s.employees.forEach((e) => { counts[empStatus(s, e)] = (counts[empStatus(s, e)] ?? 0) + 1; });
  counts.access = s.employees.filter((e) => e.accessIssue).length;
  counts.not_in_zone = s.employees.filter(empNotInZone).length;
  const list = s.employees.filter((e) => {
    if (scoped && !(inScope(s, e.assignedZoneId, ui.scope) || (e.currentZoneId && inScope(s, e.currentZoneId, ui.scope)))) return false;
    if (team !== 'all' && e.team !== team) return false;
    if (f === 'access' && !e.accessIssue) return false;
    if (f === 'not_in_zone' && !empNotInZone(e)) return false;
    if (f !== 'all' && f !== 'access' && f !== 'not_in_zone' && empStatus(s, e) !== f) return false;
    if (q.trim()) { const qq = q.trim().toLowerCase(); if (![e.id, e.badgeId, e.name.ar, e.name.en].some((x) => x.toLowerCase().includes(qq))) return false; }
    return true;
  });
  // details open only after the operator picks an employee (no default selection)
  const selId = ui.employeeId && s.employees.some((e) => e.id === ui.employeeId) ? ui.employeeId : null;
  const pick = (id: string) => set({ employeeId: selId === id ? null : id });
  const focusRef = useFocusOnOpen(selId);
  const chips: { id: Filter; l: string }[] = [
    { id: 'all', l: T('الكل', 'All') }, { id: 'available', l: T('متاح', 'Available') }, { id: 'responding', l: T('يستجيب', 'Responding') },
    { id: 'on_task', l: T('في مهمة', 'On Task') }, { id: 'unseen', l: T('لم يُرصد مؤخراً', 'Not seen recently') }, { id: 'access', l: T('مشكلة دخول', 'Access Issue') },
    { id: 'off_duty', l: T('خارج الدوام', 'Off Duty') }, { id: 'not_in_zone', l: T('خارج المنطقة المخصصة', 'Not in assigned zone') },
  ];
  const accessIncidents = s.incidents.filter((i) => i.kind === 'employee' && ['badge_problem', 'access_problem', 'not_in_zone'].includes(i.category)).sort((a, b) => Number(isOpenIncident(b)) - Number(isOpenIncident(a)) || b.detectedAt - a.detectedAt);
  return (
    <div className="emp-layout full">
      {/* an opened employee takes the whole page; the list comes back with the back button */}
      {selId ? (
        <div className="emp-focus" ref={focusRef} tabIndex={-1} aria-label={T('معلومات الموظف', 'Employee details')}>
          <div className="pane-close"><button type="button" className="btn b-default sm" onClick={() => set({ employeeId: null })}><Icon name="back" size={14} className="flip" />{T('العودة إلى الموظفين', 'Back to employees')}</button></div>
          <EmployeeProfile id={selId} />
        </div>
      ) : (
      <div className="emp-main">
        <Card title={T('الموظفون', 'Employees')} icon="employees" sub={<><Ltr>{list.length}</Ltr> / <Ltr>{s.employees.length}</Ltr></>}>
          <div className="filters" role="group" aria-label={T('تصفية الحالة', 'Status filter')}>
            {chips.map((c) => (
              <button key={c.id} type="button" className={`fchip${f === c.id ? ' on' : ''}`} onClick={() => setF(c.id)} aria-pressed={f === c.id}>
                {c.l}{c.id !== 'all' && <span className="tab-n"><Ltr>{counts[c.id] ?? 0}</Ltr></span>}
              </button>
            ))}
          </div>
          <div className="filters grid">
            <label className="search-in"><Icon name="search" size={15} /><input value={q} onChange={(e: { target: { value: string } }) => setQ(e.target.value)} placeholder={T('بحث بالمعرف أو الاسم أو البطاقة', 'Search ID, name or badge')} aria-label={T('بحث في الموظفين', 'Search employees')} /></label>
            <select className="sel" value={team} onChange={(e: { target: { value: string } }) => setTeam(e.target.value)} aria-label={T('الفريق', 'Team')}>
              <option value="all">{T('كل الفرق', 'All teams')}</option>
              {Object.entries(LABELS.team).map(([k, v]) => <option key={k} value={k}>{tl(v)}</option>)}
            </select>
            <label className="check"><input type="checkbox" checked={scoped} onChange={() => setScoped(!scoped)} />{T('ضمن النطاق', 'Within scope')} <Ltr>{ui.scope === 'ALL' ? T('كامل الموقع', 'site-wide') : ui.scope}</Ltr></label>
          </div>
          {list.length ? (
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr>
                  <th>{T('المعرف', 'ID')}</th><th>{T('الاسم', 'Name')}</th><th>{T('الفريق / الدور', 'Team / role')}</th><th>{T('البطاقة', 'Badge ID')}</th>
                  <th>{T('المخصصة', 'Assigned')}</th><th>{T('الحالية', 'Current')}</th><th>{T('الحضور', 'Presence')}</th><th>{T('الحالة', 'Status')}</th><th>{T('الدخول', 'Access')}</th>
                </tr></thead>
                <tbody>
                  {list.map((e) => (
                    <tr key={e.id} className={`clickable${e.id === selId ? ' sel' : ''}`} onClick={() => pick(e.id)} tabIndex={0} aria-selected={e.id === selId}
                      onKeyDown={(ev: KeyboardEvent) => { if (ev.key === 'Enter') pick(e.id); }}>
                      <td><Ltr>{e.id}</Ltr></td>
                      <td><button type="button" className="elink" onClick={(ev: MouseEvent) => { ev.stopPropagation(); pick(e.id); }}>{tl(e.name)}</button></td>
                      <td><TeamBadge team={e.team} size="sm" /><small className="block muted">{tl(e.jobRole)}</small></td>
                      <td><Ltr>{e.badgeId}</Ltr></td>
                      <td><Ltr>{e.assignedZoneId}</Ltr></td>
                      <td>{e.currentZoneId ? <Ltr>{e.currentZoneId}</Ltr> : <span className="muted">{T('غير معروفة', 'Unknown')}</span>}{empNotInZone(e) && <Chip tone="warn">{T('خارج المخصصة', 'Not in assigned')}</Chip>}</td>
                      <td>{e.onSite ? T('في الموقع', 'On site') : T('خارج الموقع', 'Off site')}</td>
                      <td><EmpStatusBadge status={empStatus(s, e)} /></td>
                      <td>{e.accessIssue ? <Chip tone="warn">{T('مشكلة دخول', 'Access Issue')}</Chip> : <span className="muted">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <Empty title={T('لا يوجد موظفون مطابقون', 'No matching employees')} />}
        </Card>
        {admin && (
          <Card title={T('حوادث البطاقات والدخول', 'Badge & access incidents')} icon="lock">
            {accessIncidents.length ? (
              <ul className="plain">{accessIncidents.map((i) => (
                <li key={i.id} className="row wrap">
                  <button type="button" className="elink" onClick={() => openIncident(i.id, 'employee')}><Ltr>{i.id}</Ltr></button>
                  <span>{tl(LABELS.category[i.category])} · <Ltr>{i.employeeId}</Ltr></span><SevBadge sev={i.severity} /><IncidentStatusBadge status={i.status} /><Time t={i.detectedAt} />
                </li>
              ))}</ul>
            ) : <Empty title={T('لا توجد حوادث دخول', 'No access incidents')} />}
            <p className="fine">{T('لا توجد واجهة لإدارة الصلاحيات في المشروع، ولم تُضف إجراءات منح أو سحب.', 'No permission-management UI exists in the project, so no grant or revoke actions were added.')}</p>
          </Card>
        )}
      </div>
      )}
    </div>
  );
}

export function EmployeeProfile({ id }: { id: string }) {
  const { s } = useStore();
  const { T, tl, ui, showOnMap } = useUI();
  const e = employeeById(s, id);
  if (!e) return <Empty title={T('غير موجود', 'Not found')} />;
  const incs = incidentsForEmployee(s, e.id);
  const current = incs.filter((i) => i.assignment?.employeeId === e.id && isOpenIncident(i));
  const handled = incs.filter((i) => i.assignment?.employeeId === e.id && !isOpenIncident(i));
  const related = incs.filter((i) => i.kind === 'employee');
  return (
    <Card title={<>{tl(e.name)} <Ltr>{e.id}</Ltr></>} icon="user" className="profile">
      <div className="chips">
        <EmpStatusBadge status={empStatus(s, e)} />
        <Chip tone="neutral">{e.onSite ? T('في الموقع', 'On site') : T('خارج الموقع', 'Off site')}</Chip>
        {e.accessIssue && <Chip tone="warn">{T('مشكلة دخول', 'Access Issue')}</Chip>}
        {empNotInZone(e) && <Chip tone="warn">{T('خارج المنطقة المخصصة', 'Not in assigned zone')}</Chip>}
      </div>
      <dl className="facts">
        <Field k={T('الفريق', 'Team')}><TeamBadge team={e.team} size="sm" /></Field>
        <Field k={T('الدور', 'Role')}>{tl(e.jobRole)}</Field>
        <Field k={T('البطاقة', 'Badge')}><Ltr>{e.badgeId}</Ltr></Field>
        <Field k={T('المنطقة المخصصة', 'Assigned zone')}><ELink r={{ kind: 'zone', id: e.assignedZoneId }} /></Field>
        <Field k={T('الموقع الحالي', 'Current location')}>{e.currentZoneId ? <><Ltr>{e.currentZoneId}</Ltr> <span className="muted">{T('(على مستوى المنطقة من قارئات البطاقات)', '(zone level, from badge readers)')}</span> <button type="button" className="elink" onClick={() => showOnMap({ kind: 'zone', id: e.currentZoneId! })}><Icon name="pin" size={13} /></button></> : <span className="muted">{T('غير معروف', 'Unknown')}</span>}</Field>
        <Field k={T('حضور / انصراف', 'Check-in / out')}><Time t={e.checkIn} short /> {e.checkOut ? <>→ <Time t={e.checkOut} short /></> : ''}</Field>
        {e.accessIssue && <Field k={T('مشكلة الدخول', 'Access issue')}>{tl(e.accessIssue)}</Field>}
      </dl>
      <PermissionsPanel id={e.id} />
      <h4>{T('المهام الحالية', 'Current tasks')}</h4>
      {current.length ? <ul className="plain">{current.map((i) => <li key={i.id}><ELink r={{ kind: 'incident', id: i.id }} /> {tl(LABELS.category[i.category])} · {tl(LABELS.responder[i.assignment!.current])}</li>)}</ul> : <p className="muted">{T('لا توجد', 'None')}</p>}
      <h4>{T('الحوادث المعالجة سابقاً', 'Previously handled incidents')}</h4>
      {handled.length ? (
        <ul className="plain">{handled.map((i) => { const rt = responseTimeMs(i); return (
          <li key={i.id}><ELink r={{ kind: 'incident', id: i.id }} /> {tl(LABELS.category[i.category])} · {T('زمن الاستجابة', 'response')} {rt != null ? <Ltr>{fmtDuration(rt, ui.lang)}</Ltr> : T('قيد الانتظار', 'pending')}</li>
        ); })}</ul>
      ) : <p className="muted">{T('لا توجد', 'None')}</p>}
      <p className="fine">{T('زمن الاستجابة = من الرصد حتى وصول المستجيب.', 'Response time = detection to responder arrival.')}</p>
      {related.length > 0 && <><h4>{T('حوادث متعلقة بالموظف', 'Employee incidents')}</h4><ul className="plain">{related.map((i) => <li key={i.id}><ELink r={{ kind: 'incident', id: i.id }} /> {tl(LABELS.category[i.category])} <IncidentStatusBadge status={i.status} /></li>)}</ul></>}
      <h4>{T('سجل النشاط', 'Activity history')}</h4>
      <ol className="timeline compact">
        {[...e.activity].sort((a, b) => a.t - b.t).map((a, k) => (
          <li key={k} className="done"><span className="tl-dot" aria-hidden="true" /><span className="tl-t"><Time t={a.t} short /></span><span className="tl-l">{tl(a.text)}{a.incidentId && <> · <ELink r={{ kind: 'incident', id: a.incidentId }} /></>}</span></li>
        ))}
      </ol>
    </Card>
  );
}

/** Role, permissions, permanent zones and temporary permits. Visible to Access Administrator and Operator only. */
function PermissionsPanel({ id }: { id: string }) {
  const { s } = useStore();
  const { T, tl, ui } = useUI();
  const e = employeeById(s, id);
  if (!e) return null;
  if (!can(ui.role, 'view_permissions')) {
    return <p className="fine"><Icon name="lock" size={13} /> {T('الصلاحيات والمناطق المسموحة متاحة لمدير الصلاحيات ومشغل مركز القيادة فقط.', 'Permissions and allowed zones are visible to the Access Administrator and Command Centre Operator only.')}</p>;
  }
  return (
    <section className="perm">
      <div className="perm-h"><h4>{T('الصلاحيات والدخول', 'Permissions & access')}</h4><span className="simtag">{T('بيانات نموذجية', 'Sample data')}</span></div>
      <dl className="facts">
        <Field k={T('الدور', 'Role')}>{tl(e.jobRole)}</Field>
        <Field k={T('الصلاحيات المسندة', 'Assigned permissions')}><ul className="plain tight">{e.permissions.map((p, i) => <li key={i}>{tl(p)}</li>)}</ul></Field>
        <Field k={T('دخول دائم', 'Permanent access')}><span className="chips">{e.allowedZones.map((z) => <Chip key={z} tone="brand" icon={<Icon name="pin" size={12} />}><Ltr>{z}</Ltr></Chip>)}</span></Field>
      </dl>
      <h4>{T('تصاريح دخول مؤقتة', 'Temporary entry permits')}</h4>
      {e.permits.length ? (
        <ul className="permits">{e.permits.map((p) => {
          const st = permitStatus(s, p);
          return (
            <li key={p.id} className={`permit st-${st}`}>
              <div className="permit-h"><Ltr>{p.id}</Ltr><Chip tone={st === 'active' ? 'ok' : st === 'upcoming' ? 'info' : 'neutral'} dashed={st !== 'active'}>{tl(LABELS.permit[st])}</Chip></div>
              <div><span className="muted">{T('المناطق', 'Zones')}</span> <Ltr>{p.zones.join(', ')}</Ltr></div>
              <div><span className="muted">{T('من', 'Valid from')}</span> <Time t={p.validFrom} date short /></div>
              <div><span className="muted">{T('حتى', 'Valid until')}</span> <Time t={p.validUntil} date short /></div>
            </li>
          );
        })}</ul>
      ) : <p className="muted">{T('لا توجد تصاريح مؤقتة', 'No temporary permits')}</p>}
      <p className="fine">{T('عرض فقط: لا توجد إجراءات منح أو سحب أو اعتماد في هذا النموذج.', 'View only: no grant, revoke or approval actions exist in this prototype.')}</p>
    </section>
  );
}
