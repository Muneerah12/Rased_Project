import { useState } from 'react';
import { useStore, useUI } from '../state/store';
import { ai } from '../services/ai';
import { cameraLabel, inScope, isOpenIncident, employeeById } from '../model/selectors';
import { DEVICE_CATEGORIES, EMP_INCIDENT_CATEGORIES, EVENT_CATEGORIES, THREAT_CATEGORIES } from '../model/types';
import type { Incident, Severity } from '../model/types';
import { can, incidentVisible } from '../services/permissions';
import { LABELS } from '../ui/labels';
import { Btn, Card, Chip, Empty, IncidentStatusBadge, Ltr, Restricted, SevBadge, Tabs, Time, useFocusOnOpen } from '../ui/primitives';
import { ActionsLog, IncidentDetail, IncidentFacts, IncidentHeader, Timeline } from '../ui/incident';
import { Icon } from '../ui/icons';

export function Incidents() {
  const { s } = useStore();
  const { ui, set, T, persona } = useUI();
  const vis = s.incidents.filter((i) => incidentVisible(ui.role, persona.userId, i));
  const tabs = [
    { id: 'expo' as const, label: T('حوادث الإكسبو', 'Expo Incidents'), count: vis.filter((i) => i.kind === 'expo' && isOpenIncident(i)).length },
    ...(ui.role !== 'responder' ? [{ id: 'employee' as const, label: T('حوادث الموظفين', 'Employee Incidents'), count: vis.filter((i) => i.kind === 'employee' && isOpenIncident(i)).length }] : []),
    ...(can(ui.role, 'manual_report') ? [{ id: 'manual' as const, label: T('بلاغ يدوي', 'Manual Report') }] : []),
    { id: 'response' as const, label: T('الاستجابة الميدانية', 'Field Response') },
  ];
  const tab = tabs.some((t) => t.id === ui.incidentTab) ? ui.incidentTab : 'expo';
  return (
    <div className="page">
      <Tabs label={T('أقسام الحوادث', 'Incident sections')} value={tab} onChange={(v) => set({ incidentTab: v })} tabs={tabs} />
      {tab === 'expo' && <IncidentBrowser kind="expo" />}
      {tab === 'employee' && <IncidentBrowser kind="employee" />}
      {tab === 'manual' && <ManualReport />}
      {tab === 'response' && <FieldResponse />}
    </div>
  );
}

function IncidentBrowser({ kind }: { kind: 'expo' | 'employee' }) {
  const { s } = useStore();
  const { T, tl, ui, set, persona } = useUI();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('all');
  const [sev, setSev] = useState('all');
  const [status, setStatus] = useState('open');
  const [source, setSource] = useState('all');
  // Show incidents from every zone by default; the "Within scope" box narrows to the selected zone.
  const [zoneOnly, setZoneOnly] = useState(false);
  const cats = kind === 'expo' ? [...EVENT_CATEGORIES, ...THREAT_CATEGORIES, ...DEVICE_CATEGORIES] : EMP_INCIDENT_CATEGORIES;
  const all = s.incidents.filter((i) => i.kind === kind && incidentVisible(ui.role, persona.userId, i));
  const list = all.filter((i) => {
    if (zoneOnly && !inScope(s, i.zoneId, ui.scope)) return false;
    if (cat !== 'all' && i.category !== cat) return false;
    if (sev !== 'all' && i.severity !== sev) return false;
    if (status === 'open' && !isOpenIncident(i)) return false;
    if (status !== 'open' && status !== 'all' && i.status !== (status === 'open_only' ? 'open' : status)) return false;
    if (source !== 'all' && i.source !== source) return false;
    if (q.trim()) {
      const qq = q.trim().toLowerCase();
      const emp = i.employeeId ? employeeById(s, i.employeeId) : undefined;
      const hay = [i.id, i.zoneId, i.sourceDeviceId, tl(i.location), tl(i.description), tl(LABELS.category[i.category]), i.employeeId ?? '', emp ? tl(emp.name) : ''].join(' ').toLowerCase();
      if (!hay.includes(qq)) return false;
    }
    return true;
  }).sort((a, b) => Number(isOpenIncident(b)) - Number(isOpenIncident(a)) || b.detectedAt - a.detectedAt);
  // details open only after the operator picks an incident (no default selection)
  const sel = ui.incidentId && all.some((i) => i.id === ui.incidentId) ? ui.incidentId : null;
  const selInc = s.incidents.find((i) => i.id === sel);
  const pick = (id: string) => set({ incidentId: sel === id ? null : id });
  const focusRef = useFocusOnOpen(selInc?.id);
  return (
    <div className="inc-split full">
      {/* the list and the details take turns on the full width: an open incident hides the list */}
      {!selInc && (
      <Card title={kind === 'expo' ? T('حوادث الإكسبو', 'Expo incidents') : T('حوادث الموظفين', 'Employee incidents')} icon="incidents" className="inc-list-card"
        sub={<><Ltr>{list.length}</Ltr> / <Ltr>{all.length}</Ltr></>}>
        <div className="filters grid">
          <label className="search-in"><Icon name="search" size={15} /><input value={q} onChange={(e: { target: { value: string } }) => setQ(e.target.value)} placeholder={T('بحث بالمعرف أو الموقع أو الوصف', 'Search ID, location, description')} aria-label={T('بحث في الحوادث', 'Search incidents')} /></label>
          <select className="sel" value={cat} onChange={(e: { target: { value: string } }) => setCat(e.target.value)} aria-label={T('النوع', 'Type')}>
            <option value="all">{T('كل الأنواع', 'All types')}</option>
            {cats.map((c) => <option key={c} value={c}>{tl(LABELS.category[c])}</option>)}
          </select>
          <select className="sel" value={sev} onChange={(e: { target: { value: string } }) => setSev(e.target.value)} aria-label={T('الخطورة', 'Severity')}>
            <option value="all">{T('كل الخطورات', 'All severities')}</option>
            {(['critical', 'high', 'medium', 'low'] as Severity[]).map((x) => <option key={x} value={x}>{tl(LABELS.severity[x])}</option>)}
          </select>
          <select className="sel" value={status} onChange={(e: { target: { value: string } }) => setStatus(e.target.value)} aria-label={T('الحالة', 'Status')}>
            <option value="open">{T('غير المعالجة', 'Not yet resolved')}</option>
            <option value="all">{T('كل الحالات', 'All statuses')}</option>
            {(['open', 'assigned', 'responding', 'resolved', 'closed'] as const).map((x) => <option key={`s-${x}`} value={x === 'open' ? 'open_only' : x}>{tl(LABELS.incidentStatus[x])}</option>)}
          </select>
          {kind === 'expo' && (
            <select className="sel" value={source} onChange={(e: { target: { value: string } }) => setSource(e.target.value)} aria-label={T('المصدر', 'Source')}>
              <option value="all">{T('كل المصادر', 'All sources')}</option>
              {(['ai_camera', 'iot_sensor', 'manual'] as const).map((x) => <option key={x} value={x}>{tl(LABELS.source[x])}</option>)}
            </select>
          )}
          <label className="check"><input type="checkbox" checked={zoneOnly} onChange={() => setZoneOnly(!zoneOnly)} />{T('ضمن النطاق', 'Within scope')} <Ltr>{ui.scope === 'ALL' ? T('كامل الموقع', 'site-wide') : ui.scope}</Ltr></label>
        </div>
        {list.length ? (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>{T('المعرف', 'ID')}</th><th>{T('النوع', 'Type')}</th><th>{T('المنطقة', 'Zone')}</th><th>{kind === 'expo' ? T('المصدر', 'Source') : T('الموظف', 'Employee')}</th><th>{T('الخطورة', 'Severity')}</th><th>{T('الحالة', 'Status')}</th><th>{T('الرصد', 'Detected')}</th></tr></thead>
              <tbody>
                {list.map((i) => (
                  <tr key={i.id} className={`clickable${i.id === sel ? ' sel' : ''}`} onClick={() => pick(i.id)} tabIndex={0} aria-selected={i.id === sel}
                    onKeyDown={(e: KeyboardEvent) => { if (e.key === 'Enter') pick(i.id); }}>
                    <td className="nowrap"><button type="button" className="elink" onClick={(e: MouseEvent) => { e.stopPropagation(); pick(i.id); }}><Ltr>{i.id}</Ltr></button></td>
                    <td>{tl(LABELS.category[i.category])}</td>
                    <td><Ltr>{i.zoneId}</Ltr></td>
                    <td>{kind === 'expo' ? cameraLabel(s, i.sourceDeviceId) ? tl(cameraLabel(s, i.sourceDeviceId)) : <>{tl(LABELS.source[i.source])} <Ltr>{i.sourceDeviceId}</Ltr></> : <Ltr>{i.employeeId}</Ltr>}</td>
                    <td><SevBadge sev={i.severity} /></td>
                    <td><IncidentStatusBadge status={i.status} /></td>
                    <td className="nowrap"><Time t={i.detectedAt} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty title={T('لا توجد حوادث مطابقة', 'No matching incidents')}>{T('غيّر عوامل التصفية أو النطاق.', 'Change the filters or the scope.')}</Empty>}
      </Card>
      )}
      {selInc && (
        <div className="inc-pane" ref={focusRef} tabIndex={-1} aria-label={T('معلومات الحادثة', 'Incident details')}>
          <div className="pane-close"><button type="button" className="btn b-default sm" onClick={() => set({ incidentId: null })}><Icon name="back" size={14} className="flip" />{kind === 'expo' ? T('العودة إلى حوادث الإكسبو', 'Back to Expo incidents') : T('العودة إلى حوادث الموظفين', 'Back to employee incidents')}</button></div>
          {kind === 'expo' ? <IncidentDetail id={selInc.id} /> : <EmployeeIncidentDetail inc={selInc} />}
        </div>
      )}
    </div>
  );
}

function EmployeeIncidentDetail({ inc }: { inc: Incident }) {
  const { T } = useUI();
  return (
    <div className="inc-detail">
      <IncidentHeader inc={inc} />
      <div className="inc-grid">
        <Card title={T('التفاصيل', 'Details')} icon="incidents"><IncidentFacts inc={inc} />
          {inc.category === 'badge_unseen' && <p className="fine">{T('عدم رصد البطاقة لا يثبت إصابة الموظف أو غيابه الفعلي؛ قد يكون في مكان لا يوجد فيه قارئ بطاقات.', 'An unseen badge does not prove the employee is injured or physically absent; they may be somewhere without a badge reader.')}</p>}
        </Card>
        <div className="inc-col">
          <Card title={T('الجدول الزمني', 'Timeline')} icon="clock"><Timeline inc={inc} /></Card>
          <Card title={T('الإجراءات المسجلة', 'Recorded actions')} icon="reports"><ActionsLog inc={inc} /></Card>
        </div>
      </div>
    </div>
  );
}

function ManualReport() {
  const { s, dispatch } = useStore();
  const { T, tl, ui, persona, openIncident, toast } = useUI();
  const [kind, setKind] = useState<'expo' | 'employee'>('expo');
  const [f, setF] = useState({ category: '', zoneId: ui.scope !== 'ALL' ? ui.scope : 'A1.1', location: '', severity: '', description: '', employeeId: '' });
  const [media, setMedia] = useState<File | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [tried, setTried] = useState(false);
  if (!can(ui.role, 'manual_report')) return <Restricted />;
  const cats = kind === 'expo' ? EVENT_CATEGORIES : EMP_INCIDENT_CATEGORIES;
  const upd = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const validate = () => {
    const er: Record<string, string> = {};
    if (!f.category) er.category = T('اختر نوع الحادثة.', 'Choose the incident type.');
    if (!f.zoneId) er.zoneId = T('اختر المنطقة.', 'Choose the zone.');
    if (!f.location.trim()) er.location = T('صف الموقع داخل المنطقة.', 'Describe the location within the zone.');
    if (!f.severity) er.severity = T('اختر الخطورة.', 'Choose the severity.');
    if (f.description.trim().length < 10) er.description = T('اكتب وصفاً من 10 أحرف على الأقل.', 'Write a description of at least 10 characters.');
    if (kind === 'employee' && !f.employeeId) er.employeeId = T('اختر الموظف المعني.', 'Choose the employee concerned.');
    if (media && !/^(image|video)\//.test(media.type)) er.media = T('المرفق يجب أن يكون صورة أو فيديو.', 'The attachment must be an image or a video.');
    return er;
  };
  const submit = async (e: { preventDefault(): void }) => {
    e.preventDefault();
    setTried(true);
    const er = validate();
    setErrors(er);
    if (Object.keys(er).length) return;
    const id = kind === 'expo' ? `INC-2026-${String(s.seq.inc).padStart(4, '0')}` : `EI-2026-${String(s.seq.ei).padStart(4, '0')}`;
    // live mode: the attachment is stored on the server so every screen can open it
    let stored: { url: string; type: string; name: string } | null = null;
    if (media && s.baseMode === 'live') {
      try { stored = await ai.uploadMedia(media); } catch { setErrors({ media: T('تعذر رفع المرفق إلى الخادم.', 'Could not upload the attachment to the server.') }); return; }
    }
    dispatch({
      type: 'MANUAL_REPORT', kind, category: f.category as never, zoneId: f.zoneId, location: f.location.trim(), severity: f.severity as Severity,
      description: f.description.trim(), by: persona.userId, employeeId: kind === 'employee' ? f.employeeId : undefined,
      mediaUrl: stored ? stored.url : media ? URL.createObjectURL(media) : undefined, mediaType: media?.type, mediaName: media?.name,
    });
    toast({ ar: `تم إنشاء ${id}`, en: `${id} created` });
    openIncident(id, kind);
  };
  const err = (k: string) => (tried && errors[k] ? <span className="ferr" id={`err-${k}`}>{errors[k]}</span> : null);
  return (
    <Card title={T('بلاغ يدوي', 'Manual report')} icon="reports" className="form-card">
      <form className="form" onSubmit={submit} noValidate>
        <fieldset className="seg" aria-label={T('نوع البلاغ', 'Report kind')}>
          <label className={kind === 'expo' ? 'on' : ''}><input type="radio" name="mk" checked={kind === 'expo'} onChange={() => { setKind('expo'); setF({ ...f, category: '' }); }} />{T('حادثة إكسبو', 'Expo incident')}</label>
          <label className={kind === 'employee' ? 'on' : ''}><input type="radio" name="mk" checked={kind === 'employee'} onChange={() => { setKind('employee'); setF({ ...f, category: '' }); }} />{T('حادثة موظف', 'Employee incident')}</label>
        </fieldset>
        <div className="fgrid">
          <div className="f"><label htmlFor="m-cat">{T('نوع الحادثة', 'Incident type')} *</label>
            <select id="m-cat" className="sel" value={f.category} onChange={upd('category')} aria-invalid={!!(tried && errors.category)} aria-describedby="err-category">
              <option value="">{T('اختر…', 'Choose…')}</option>{cats.map((c) => <option key={c} value={c}>{tl(LABELS.category[c])}</option>)}
            </select>{err('category')}</div>
          <div className="f"><label htmlFor="m-zone">{T('المنطقة', 'Zone')} *</label>
            <select id="m-zone" className="sel" value={f.zoneId} onChange={upd('zoneId')} aria-invalid={!!(tried && errors.zoneId)}>
              {s.zones.map((z) => <option key={z.id} value={z.id}>{z.id} · {tl(z.name)}</option>)}
            </select>{err('zoneId')}</div>
          <div className="f"><label htmlFor="m-sev">{T('الخطورة', 'Severity')} *</label>
            <select id="m-sev" className="sel" value={f.severity} onChange={upd('severity')} aria-invalid={!!(tried && errors.severity)}>
              <option value="">{T('اختر…', 'Choose…')}</option>{(['low', 'medium', 'high', 'critical'] as Severity[]).map((x) => <option key={x} value={x}>{tl(LABELS.severity[x])}</option>)}
            </select>{err('severity')}</div>
          <div className="f wide"><label htmlFor="m-loc">{T('الموقع', 'Location')} *</label>
            <input id="m-loc" value={f.location} onChange={upd('location')} placeholder={T('مثال: قرب البوابة الشمالية', 'e.g. By the north gate')} aria-invalid={!!(tried && errors.location)} />{err('location')}</div>
          {kind === 'employee' && (
            <div className="f wide"><label htmlFor="m-emp">{T('الموظف', 'Employee')} *</label>
              <select id="m-emp" className="sel" value={f.employeeId} onChange={upd('employeeId')} aria-invalid={!!(tried && errors.employeeId)}>
                <option value="">{T('اختر…', 'Choose…')}</option>{s.employees.map((e) => <option key={e.id} value={e.id}>{e.id} · {tl(e.name)}</option>)}
              </select>{err('employeeId')}</div>
          )}
          <div className="f full"><label htmlFor="m-desc">{T('الوصف', 'Description')} *</label>
            <textarea id="m-desc" rows={4} value={f.description} onChange={upd('description')} aria-invalid={!!(tried && errors.description)} />{err('description')}</div>
          <div className="f full"><label htmlFor="m-media">{T('صورة أو فيديو (اختياري)', 'Image or video (optional)')}</label>
            <input id="m-media" type="file" accept="image/*,video/*" onChange={(e: { target: { files: FileList | null } }) => setMedia(e.target.files?.[0] ?? null)} />{err('media')}</div>
        </div>
        <div className="row"><Btn type="submit" kind="primary" icon="check">{T('إنشاء الحادثة', 'Create incident')}</Btn><span className="fine">{T('يُنشأ تنبيه وحادثة مرتبطان يظهران في اللوحة والخريطة والتقارير.', 'Creates a linked alert and incident that appear on the dashboard, map and reports.')}</span></div>
        {tried && Object.keys(errors).length > 0 && <p className="warnline" role="alert">{T('أكمل الحقول المطلوبة.', 'Complete the required fields.')}</p>}
      </form>
    </Card>
  );
}

function FieldResponse() {
  const { s } = useStore();
  const { T, tl, ui, set, persona } = useUI();
  const list = s.incidents.filter((i) => i.kind === 'expo' && i.status !== 'closed' && incidentVisible(ui.role, persona.userId, i))
    .sort((a, b) => Number(!!a.assignment) - Number(!!b.assignment) || b.detectedAt - a.detectedAt);
  const sel = ui.incidentId && list.some((i) => i.id === ui.incidentId) ? ui.incidentId : list[0]?.id;
  return (
    <div className="inc-split">
      <Card title={T('حوادث تحتاج استجابة', 'Incidents needing response')} icon="user" className="inc-list-card">
        {list.length ? (
          <ul className="plain sel-list">
            {list.map((i) => (
              <li key={i.id}>
                <button type="button" className={i.id === sel ? 'on' : ''} onClick={() => set({ incidentId: i.id })} aria-pressed={i.id === sel}>
                  <span><Ltr>{i.id}</Ltr><small>{tl(LABELS.category[i.category])} · <Ltr>{i.zoneId}</Ltr></small></span>
                  <span className="chips">
                    <SevBadge sev={i.severity} />
                    {i.assignment ? <Chip tone="info"><Ltr>{i.assignment.employeeId}</Ltr> · {tl(LABELS.responder[i.assignment.current])}</Chip> : <Chip tone="brand">{T('بانتظار التكليف', 'Needs assignment')}</Chip>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : <Empty title={T('لا توجد حوادث تحتاج استجابة', 'No incidents need a response')} />}
      </Card>
      <div className="inc-pane">{sel ? <IncidentDetail id={sel} mode="response" /> : null}</div>
    </div>
  );
}
