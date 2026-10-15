import { useEffect } from 'react';
import { useStore, useUI } from '../state/store';
import { cameraLabel, droneDurationMs, employeeById, inScope, responseTimeMs, timelineOrderValid } from '../model/selectors';
import { fmtDuration, fmtTime } from '../model/config';
import { canSee, incidentVisible } from '../services/permissions';
import { templateSummaryService } from '../services/summary';
import { LABELS } from '../ui/labels';
import { Btn, Card, Chip, ELink, Empty, Field, IncidentStatusBadge, Ltr, Restricted, SevBadge, SimTag, Time, useFocusOnOpen } from '../ui/primitives';
import { Icon } from '../ui/icons';
import { EvidenceList, Timeline } from '../ui/incident';

export function Reports() {
  const { s } = useStore();
  const { ui, set, T } = useUI();
  if (!canSee(ui.role, 'reports')) return <div className="page"><Restricted /></div>;
  const list = s.incidents.filter((i) => i.kind === 'expo');
  // all reports first; a report opens full width only after its number is clicked
  const sel = ui.reportId && list.some((i) => i.id === ui.reportId) ? ui.reportId : null;
  const focusRef = useFocusOnOpen(sel);
  return (
    <div className="page">
      {sel ? (
        <div className="rep-pane" ref={focusRef} tabIndex={-1} aria-label={T('التقرير', 'Report')}>
          <div className="pane-close">
            <button type="button" className="btn b-default sm" onClick={() => set({ reportId: null })}><Icon name="back" size={14} className="flip" />{T('العودة إلى كل التقارير', 'Back to all reports')}</button>
          </div>
          <ReportDetail id={sel} />
        </div>
      ) : (
        <Card title={T('كل التقارير', 'All reports')} icon="reports"><ReportsTable onSelect={(id) => set({ reportId: id })} /></Card>
      )}
    </div>
  );
}

/** Full-width table of every report in scope (Reports page). */
function ReportsTable({ onSelect }: { onSelect: (id: string) => void }) {
  const { s } = useStore();
  const { T, tl, ui, persona } = useUI();
  const list = s.incidents.filter((i) => i.kind === 'expo' && incidentVisible(ui.role, persona.userId, i) && (ui.scope === 'ALL' || inScope(s, i.zoneId, ui.scope)))
    .sort((a, b) => b.detectedAt - a.detectedAt);
  if (!list.length) return <Empty title={T('لا توجد تقارير في هذا النطاق', 'No reports in this scope')} />;
  return (
    <div className="tbl-wrap">
      <table className="tbl">
        <thead><tr>
          <th>{T('رقم التقرير', 'Report no.')}</th><th>{T('النوع', 'Type')}</th><th>{T('المنطقة', 'Zone')}</th><th>{T('المصدر', 'Source')}</th>
          <th>{T('الخطورة', 'Severity')}</th><th>{T('حالة الحادثة', 'Incident status')}</th><th>{T('التقرير', 'Report')}</th><th>{T('زمن الاستجابة', 'Response time')}</th><th>{T('الرصد', 'Detected')}</th>
        </tr></thead>
        <tbody>
          {list.map((i) => {
            const rt = responseTimeMs(i);
            const cam = cameraLabel(s, i.sourceDeviceId);
            return (
              <tr key={i.id} className="clickable" onClick={() => onSelect(i.id)} tabIndex={0} onKeyDown={(e: KeyboardEvent) => { if (e.key === 'Enter') onSelect(i.id); }}>
                <td className="nowrap"><button type="button" className="elink" onClick={(e: MouseEvent) => { e.stopPropagation(); onSelect(i.id); }}><Ltr>{i.id}</Ltr></button></td>
                <td>{tl(LABELS.category[i.category])}</td>
                <td><Ltr>{i.zoneId}</Ltr></td>
                <td>{cam ? tl(cam) : <>{tl(LABELS.source[i.source])} <Ltr>{i.sourceDeviceId}</Ltr></>}</td>
                <td><SevBadge sev={i.severity} /></td>
                <td><IncidentStatusBadge status={i.status} /></td>
                <td><Chip tone={i.status === 'closed' ? 'ok' : 'neutral'}>{i.status === 'closed' ? T('نهائي', 'Final') : T('قيد التحديث', 'In progress')}</Chip></td>
                <td className="nowrap">{rt != null ? <Ltr>{fmtDuration(rt, ui.lang)}</Ltr> : <span className="muted">{T('بانتظار الوصول', 'Pending arrival')}</span>}</td>
                <td className="nowrap"><Time t={i.detectedAt} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function ReportsList({ selected, onSelect }: { selected: string | null; onSelect: (id: string) => void }) {
  const { s } = useStore();
  const { T, tl, ui, persona } = useUI();
  const list = s.incidents.filter((i) => i.kind === 'expo' && incidentVisible(ui.role, persona.userId, i) && (ui.scope === 'ALL' || inScope(s, i.zoneId, ui.scope)))
    .sort((a, b) => b.detectedAt - a.detectedAt);
  if (!list.length) return <Empty title={T('لا توجد تقارير في هذا النطاق', 'No reports in this scope')} />;
  return (
    <ul className="plain sel-list">
      {list.map((i) => {
        const rt = responseTimeMs(i);
        return (
          <li key={i.id}>
            <button type="button" className={i.id === selected ? 'on' : ''} onClick={() => onSelect(i.id)} aria-pressed={i.id === selected}>
              <span><Ltr>{i.id}</Ltr><small>{tl(LABELS.category[i.category])} · <Ltr>{i.zoneId}</Ltr> · <Time t={i.detectedAt} short /></small></span>
              <span className="chips">
                <Chip tone={i.status === 'closed' ? 'ok' : 'neutral'}>{i.status === 'closed' ? T('نهائي', 'Final') : T('قيد التحديث', 'In progress')}</Chip>
                <span className="muted small">{rt != null ? <Ltr>{fmtDuration(rt, ui.lang)}</Ltr> : T('بانتظار الوصول', 'Pending arrival')}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Printing is blocked when the page runs inside an embedding frame (e.g. an artifact preview). */
const inFrame = (() => { try { return window.self !== window.top; } catch { return true; } })();

function Sec({ n, title, children }: { n: number; title: string; children: unknown }) {
  return <section className="rsec"><h3><span className="rsec-n"><Ltr>{n}</Ltr></span>{title}</h3>{children as never}</section>;
}

export function ReportDetail({ id, compact, print }: { id: string; compact?: boolean; print?: boolean }) {
  const { s } = useStore();
  const { T, tl, ui, persona, openIncident, set } = useUI();
  const inc = s.incidents.find((i) => i.id === id);
  if (!inc) return <Empty title={T('غير موجود', 'Not found')} />;
  if (!incidentVisible(ui.role, persona.userId, inc)) return <Restricted />;
  const a = inc.assignment;
  const emp = a ? employeeById(s, a.employeeId) : undefined;
  const rt = responseTimeMs(inc);
  const dd = droneDurationMs(inc);
  const fieldActions = inc.actions.filter((x) => x.field).sort((p, q) => p.t - q.t);
  const summary = templateSummaryService.summarize(s, inc);
  return (
    <article className={`report${compact ? ' compact' : ''}${print ? ' print' : ''}`}>
      {print && (
        <div className="print-head">
          <span className="wordmark" lang="ar">راصد</span>
          <span>{T('تقرير حادثة — إكسبو 2030 الرياض', 'Incident report — Expo 2030 Riyadh')}</span>
          <span><Ltr>{inc.id}</Ltr></span>
          <span>{T('تاريخ الحادثة', 'Incident date')} <Time t={inc.detectedAt} date short /> · {T('وقت الطباعة (وقت المحاكاة)', 'Printed at (simulation time)')} <Time t={s.now} date /></span>
        </div>
      )}
      <header className="report-h">
        <div>
          <div className="eyebrow">{T('تقرير حادثة', 'Incident report')}</div>
          <h2><Ltr>{inc.id}</Ltr> · {tl(LABELS.category[inc.category])}</h2>
        </div>
        <div className="chips">
          <Chip tone={inc.status === 'closed' ? 'ok' : 'warn'}>{inc.status === 'closed' ? T('سجل نهائي', 'Final record') : T('قيد التحديث مع تطور الحادثة', 'Updating as the incident evolves')}</Chip>
          {inc.fixture && <span className="simtag">{T('بيانات تجريبية', 'Fixture data')}</span>}
          {!compact && !print && <Btn small kind="ghost" icon="incidents" onClick={() => openIncident(inc.id)}>{T('فتح الحادثة', 'Open incident')}</Btn>}
          {!print && <Btn small kind="primary" icon="print" disabled={inFrame} onClick={() => { set({ printId: inc.id }); setTimeout(() => window.print(), 80); }}>{T('طباعة التقرير', 'Print Report')}</Btn>}
        </div>
        {!print && inFrame && <p className="fine">{T('المعاينة المضمنة تمنع الطباعة. افتح ملف rasid.html المستقل للطباعة أو الحفظ PDF.', 'This embedded preview blocks printing. Open the standalone rasid.html file to print or save as PDF.')}</p>}
      </header>

      <Sec n={1} title={T('معلومات الحادثة', 'Incident information')}>
        <dl className="facts two">
          <Field k={T('المعرف', 'ID')}><Ltr>{inc.id}</Ltr></Field>
          <Field k={T('التاريخ', 'Date')}><Time t={inc.detectedAt} date short /></Field>
          <Field k={T('المنطقة', 'Zone')}><ELink r={{ kind: 'zone', id: inc.zoneId }} /></Field>
          <Field k={T('النوع', 'Type')}>{tl(LABELS.category[inc.category])}</Field>
          <Field k={T('الخطورة', 'Severity')}><SevBadge sev={inc.severity} /></Field>
          <Field k={T('مصدر الرصد', 'Detection source')}>{cameraLabel(s, inc.sourceDeviceId) ? <>{tl(LABELS.source[inc.source])} · {tl(cameraLabel(s, inc.sourceDeviceId))}</> : <>{tl(LABELS.source[inc.source])} <Ltr>{inc.sourceDeviceId}</Ltr></>}</Field>
        </dl>
      </Sec>
      <Sec n={2} title={T('الرصد', 'Detection')}>
        <dl className="facts two"><Field k={T('وقت الرصد', 'Detected at')}><Time t={inc.detectedAt} /></Field><Field k={T('إنشاء التنبيه', 'Alert created')}><Time t={inc.alertAt} /></Field></dl>
      </Sec>
      <Sec n={3} title={T('الاستجابة', 'Response')}>
        {a ? (
          <dl className="facts two">
            <Field k={T('الموظف المكلف', 'Assigned employee')}><Ltr>{a.employeeId}</Ltr>{emp && <> · {tl(emp.name)}</>}</Field>
            <Field k={T('الفريق', 'Team')}>{tl(LABELS.team[a.team])}</Field>
            <Field k={T('وقت التكليف', 'Assigned at')}><Time t={a.steps.assigned} /></Field>
            <Field k={T('وقت القبول', 'Accepted at')}><Time t={a.steps.accepted} /></Field>
            <Field k={T('وقت الوصول', 'Arrived at')}><Time t={a.steps.arrived} /></Field>
            <Field k={T('حالة المستجيب', 'Responder status')}>{tl(LABELS.responder[a.current])}</Field>
          </dl>
        ) : <p className="muted">{T('لم يُكلَّف مستجيب بعد.', 'No responder assigned yet.')}</p>}
      </Sec>
      <Sec n={4} title={T('زمن الاستجابة', 'Response time')}>
        <p className="fine">{T('التعريف: من وقت الرصد حتى وصول المستجيب.', 'Definition: from detection time to responder arrival.')}</p>
        {rt != null ? (
          <div className="calc"><Ltr>{fmtTime(a!.steps.arrived!)} − {fmtTime(inc.detectedAt)} = </Ltr><strong><Ltr>{fmtDuration(rt, ui.lang)}</Ltr></strong></div>
        ) : <div className="calc"><strong>{T('قيد الانتظار', 'Pending')}</strong> <span className="muted">{T('لم يُسجّل وصول بعد', 'no arrival recorded yet')}</span></div>}
        {!timelineOrderValid(inc) && <p className="warnline">{T('ترتيب الطوابع الزمنية غير صالح', 'Timestamp order is invalid')}</p>}
      </Sec>
      <Sec n={5} title={T('الإجراءات المتخذة', 'Actions taken')}>
        {fieldActions.length ? <ul className="actlog">{fieldActions.map((x, k) => <li key={k}><Time t={x.t} /><span className="act-who"><Ltr>{x.actor}</Ltr></span><span>{tl(x.text)}</span></li>)}</ul> : <p className="muted">{T('لا توجد إجراءات ميدانية مسجلة.', 'No field actions recorded.')}</p>}
      </Sec>
      <Sec n={6} title={T('أدلة الطائرة المسيرة', 'Drone evidence')}>
        {inc.drone ? (
          <dl className="facts two">
            <Field k={T('استُخدمت طائرة', 'Drone used')}>{T('نعم', 'Yes')}</Field>
            <Field k={T('الطائرة', 'Drone')}><Ltr>{inc.drone.droneId}</Ltr></Field>
            <Field k={T('الإطلاق', 'Dispatched')}><Time t={inc.drone.dispatchedAt} /></Field>
            <Field k={T('الوصول', 'Arrived')}><Time t={inc.drone.arrivedAt} /></Field>
            <Field k={T('مدة المهمة', 'Mission duration')}>{dd != null ? <Ltr>{fmtDuration(dd, ui.lang)}</Ltr> : T('جارية', 'Ongoing')} {inc.drone.fixture ? <span className="simtag">{T('بيانات نموذجية', 'Sample data')}</span> : <SimTag />}</Field>
            <Field k={T('اللقطات المرتبطة', 'Linked footage')}>{inc.evidence.some((e) => e.kind === 'drone_feed') ? T('دليل بث محاكى مرفق؛ لا يوجد ملف فيديو فعلي.', 'Simulated feed evidence attached; no real footage file.') : T('غير متوفرة', 'Not available')}</Field>
          </dl>
        ) : <p><strong>{T('استُخدمت طائرة: لا', 'Drone used: No')}</strong></p>}
      </Sec>
      <Sec n={7} title={T('الحل', 'Resolution')}>
        <dl className="facts two">
          <Field k={T('وقت المعالجة', 'Resolved at')}><Time t={inc.resolvedAt} /></Field>
          <Field k={T('وقت الإغلاق', 'Closed at')}><Time t={inc.closedAt} /></Field>
          <Field k={T('الحالة النهائية', 'Final status')}>{inc.status === 'closed' ? <IncidentStatusBadge status="closed" /> : <span className="muted">{T('لم تُغلق بعد', 'Not closed yet')} · <IncidentStatusBadge status={inc.status} /></span>}</Field>
        </dl>
      </Sec>
      <Sec n={8} title={T('ملخص الحادثة', 'Incident summary')}>
        <p className="summary">{tl(summary.text)}</p>
        <p className="fine"><SimTag>{T('قالب مولّد', 'Generated template')}</SimTag> {T('لا توجد خدمة ذكاء اصطناعي متصلة. الملخص مبني فقط من الحقائق المسجلة في الحادثة.', 'No AI service is connected. This summary is built only from the recorded incident facts.')}</p>
      </Sec>
      {(compact || print) && <Sec n={9} title={T('الجدول الزمني', 'Timeline')}><Timeline inc={inc} /></Sec>}
      {!compact && !print && <section className="rsec"><h3>{T('الأدلة المرتبطة', 'Linked evidence')}</h3><EvidenceList inc={inc} /></section>}
      {print && <section className="rsec"><h3>{T('الأدلة المرتبطة', 'Linked evidence')}</h3><ul className="plain">{inc.evidence.map((e) => <li key={e.id}><Time t={e.t} /> · {tl(e.label)}{e.simulated ? T(' (محاكاة)', ' (simulated)') : ''}</li>)}</ul></section>}
    </article>
  );
}


/** Print-only copy of a report, rendered outside the app chrome. Respects report access. */
export function PrintRoot() {
  const { ui, set, persona } = useUI();
  const { s } = useStore();
  useEffect(() => {
    const done = () => set({ printId: null });
    window.addEventListener('afterprint', done);
    return () => window.removeEventListener('afterprint', done);
  }, []);
  if (!ui.printId || !canSee(ui.role, 'reports')) return null;
  const inc = s.incidents.find((i) => i.id === ui.printId);
  if (!inc || !incidentVisible(ui.role, persona.userId, inc)) return null;
  return <div className="print-root" dir={ui.lang === 'ar' ? 'rtl' : 'ltr'} lang={ui.lang}><ReportDetail id={inc.id} print /></div>;
}
