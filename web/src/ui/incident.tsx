import { useState } from 'react';
import { useStore, useUI } from '../state/store';
import {
  alertStatus, droneDurationMs, empStatus, empUnseen, employeeById, incidentTimeline, nextStep, responseTimeMs, timelineOrderValid, zoneById,
} from '../model/selectors';
import { suitableCandidates } from '../model/reducer';
import { fmtDuration } from '../model/config';
import type { Incident } from '../model/types';
import { RESPONDER_STEPS } from '../model/types';
import { can, incidentVisible } from '../services/permissions';
import { apiUrl } from '../services/apiBase';
import { alertTitle, LABELS } from './labels';
import {
  AlertStatusBadge, Btn, Card, Chip, ELink, Empty, EmpStatusBadge, Field, IncidentStatusBadge, Ltr, Restricted, SevBadge, SimTag, Time,
} from './primitives';
import { AerialFeed, CameraView } from './feeds';
import { Icon, IncidentIcon } from './icons';
import { TeamBadge, TeamsOverview } from './teams';

export function IncidentHeader({ inc }: { inc: Incident }) {
  const { s } = useStore();
  const { T, tl } = useUI();
  const alert = s.alerts.find((a) => a.id === inc.alertId);
  const ev = s.events.find((e) => e.id === inc.eventId);
  return (
    <div className="inc-head">
      <div className="inc-title">
        <span className="inc-id"><Ltr>{inc.id}</Ltr></span>
        <h3 className={`inc-h sev-${inc.severity}`}><IncidentIcon category={inc.category} size={22} />{tl(LABELS.category[inc.category])}</h3>
        {inc.fixture && <span className="simtag">{T('بيانات تجريبية', 'Fixture data')}</span>}
      </div>
      <div className="chips">
        <SevBadge sev={inc.severity} />
        <IncidentStatusBadge status={inc.status} />
        {alert && <span className="chip-pair"><span className="muted">{T('التنبيه', 'Alert')}</span><AlertStatusBadge status={alertStatus(s, alert)} /></span>}
        {ev && <span className="chip-pair"><span className="muted">{T('الحدث', 'Event')}</span><Chip tone={ev.endedAt ? 'neutral' : 'crit'}>{ev.endedAt ? T('انتهى', 'Ended') : T('مستمر', 'Ongoing')}</Chip></span>}
        {inc.assignment && <span className="chip-pair"><span className="muted">{T('المستجيب', 'Responder')}</span><Chip tone="info">{tl(LABELS.responder[inc.assignment.current])}</Chip></span>}
      </div>
    </div>
  );
}

export function IncidentFacts({ inc }: { inc: Incident }) {
  const { s } = useStore();
  const { T, tl, showOnMap, ui } = useUI();
  const alert = s.alerts.find((a) => a.id === inc.alertId);
  const emp = inc.employeeId ? employeeById(s, inc.employeeId) : undefined;
  const srcKind = s.cameras.some((c) => c.id === inc.sourceDeviceId) ? 'camera' : s.sensors.some((x) => x.id === inc.sourceDeviceId) ? 'sensor' : s.nodes.some((n) => n.id === inc.sourceDeviceId) ? 'node' : null;
  const ev = s.events.find((e) => e.id === inc.eventId);
  return (
    <dl className="facts">
      <Field k={T('المنطقة', 'Zone')}><Ltr>{inc.zoneId}</Ltr> {zoneById(s, inc.zoneId) && <button type="button" className="elink" onClick={() => showOnMap({ kind: inc.pos ? 'incident' : 'zone', id: inc.pos ? inc.id : inc.zoneId })}><Icon name="pin" size={13} />{T('على الخريطة', 'On map')}</button>}</Field>
      <Field k={T('الموقع', 'Location')}>{tl(inc.location)}</Field>
      <Field k={T('المصدر', 'Source')}>{tl(LABELS.source[inc.source])} · {srcKind ? <ELink r={{ kind: srcKind, id: inc.sourceDeviceId }} /> : <Ltr>{inc.sourceDeviceId}</Ltr>}{ev?.sourceKind === 'recorded' && <> · <Ltr>{ev.fileName}</Ltr></>}</Field>
      <Field k={T('وقت الرصد', 'Detected')}><Time t={inc.detectedAt} date /></Field>
      {alert && <Field k={T('التنبيه', 'Alert')}><ELink r={{ kind: 'alert', id: alert.id }} /> · {tl(alertTitle(alert))}</Field>}
      {ev && <Field k={T('الحدث', 'Event')}><Ltr>{ev.id}</Ltr>{ev.peakCount != null && <> · {T('الذروة', 'peak')} <Ltr>{ev.peakCount}/{ev.capacity}</Ltr></>} {ev.simulated && <SimTag />}</Field>}
      {ev?.aiId && (
        <Field k={T('الذكاء الاصطناعي', 'AI detection')}>
          {ev.score != null && ev.category !== 'crowding' && <>{T('الثقة', 'confidence')} <Ltr>{Math.round(ev.score * 100)}%</Ltr> · </>}
          {ev.models?.join(', ')} <span className="muted">(<Ltr>{ev.aiId}</Ltr>)</span>
        </Field>
      )}
      {(inc.notifications?.length ?? 0) > 0 && (
        <Field k={T('الإشعارات المرسلة', 'Notifications sent')}>
          <span className="notif">{inc.notifications!.map((n, i) => (
            <Chip key={i} tone={n.ok ? 'ok' : 'crit'} title={`${n.detail}${n.target ? ` · ${n.target}` : ''}`}>
              {n.channel === 'dashboard' ? T('شاشات راصد', 'Rasid screens') : n.channel === 'telegram' ? 'Telegram' : n.channel === 'webhook' ? 'Webhook' : n.channel}
              {n.team ? ` → ${tl(LABELS.team[n.team as keyof typeof LABELS.team] ?? { ar: n.team, en: n.team })}` : ''} {n.ok ? '✓' : '✗'}
            </Chip>
          ))}</span>
        </Field>
      )}
      {emp && (can(ui.role, 'view_employees') ? <Field k={T('الموظف', 'Employee')}><ELink r={{ kind: 'employee', id: emp.id }} /> {tl(emp.name)}</Field> : <Field k={T('الموظف', 'Employee')}><Ltr>{emp.id}</Ltr></Field>)}
      <Field k={T('الوصف', 'Description')}>{tl(inc.description)}</Field>
    </dl>
  );
}

export function EvidenceList({ inc }: { inc: Incident }) {
  const { s } = useStore();
  const { T, tl } = useUI();
  const [open, setOpen] = useState<string | null>(null);
  if (!inc.evidence.length) return <Empty icon="camera" title={T('لا توجد أدلة مرفقة', 'No evidence attached')} />;
  return (
    <ul className="evlist">
      {inc.evidence.map((ev) => {
        const cam = s.cameras.find((c) => c.id === ev.sourceId);
        const isOpen = open === ev.id;
        return (
          <li key={ev.id}>
            <button type="button" className="evrow" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : ev.id)}>
              <Icon name={ev.kind === 'drone_feed' ? 'drone' : ev.kind === 'sensor_reading' ? 'sensor' : ev.kind === 'upload' || ev.kind === 'manual_media' ? 'upload' : 'camera'} size={16} />
              <span className="evrow-t">{tl(ev.label)}</span>
              <span className="muted"><Time t={ev.t} /></span>
              {ev.simulated && <SimTag />}
            </button>
            {isOpen && (
              <div className="evbody">
                {ev.mediaUrl && ev.mediaType?.startsWith('video') && <video src={apiUrl(ev.mediaUrl)} controls className="media" />}
                {ev.mediaUrl && ev.mediaType?.startsWith('image') && <a href={apiUrl(ev.mediaUrl)} target="_blank" rel="noreferrer"><img src={apiUrl(ev.mediaUrl)} alt={tl(ev.label)} className="media evidence-snap" /></a>}
                {!ev.mediaUrl && ev.kind === 'drone_feed' && inc.pos && <AerialFeed center={inc.pos} t={ev.t} droneId={ev.sourceId} />}
                {!ev.mediaUrl && (ev.kind === 'camera_frame' || ev.kind === 'camera_clip') && cam && (
                  <CameraView live={false} cameraId={cam.id} name={tl(cam.label)} online analyzing t={ev.t} compact count={inc.category === 'crowding' ? Number(s.events.find((e) => e.id === inc.eventId)?.peakCount ?? 0) : null}
                    capacity={inc.category === 'crowding' ? zoneById(s, inc.zoneId)?.capacity ?? null : null} category={inc.category !== 'crowding' ? inc.category : undefined} />
                )}
                <p className="fine">{ev.mediaUrl?.startsWith('/api/') ? T('محفوظ في خادم راصد ومتاح لكل الشاشات.', 'Stored on the Rasid server and available to every screen.') : ev.mediaUrl ? T('ملف محلي في هذه الجلسة فقط.', 'Local file, available in this session only.') : T('لا يوجد ملف فيديو في النموذج الأولي؛ العرض توضيحي.', 'No footage file exists in the prototype; the view is illustrative.')}</p>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function Timeline({ inc }: { inc: Incident }) {
  const { T, tl } = useUI();
  const items = inc.kind === 'expo' ? incidentTimeline(inc) : incidentTimeline(inc).filter((x) => ['detected', 'alert_created', 'resolved', 'closed'].includes(x.key));
  const valid = timelineOrderValid(inc);
  return (
    <>
      <ol className="timeline">
        {items.map((it) => (
          <li key={it.key} className={it.t != null ? 'done' : 'todo'}>
            <span className="tl-dot" aria-hidden="true" />
            <span className="tl-l">{tl(LABELS.timeline[it.key])}</span>
            <span className="tl-t">{it.t != null ? <Time t={it.t} /> : <span className="muted">{T('لم يحدث بعد', 'Not yet')}</span>}</span>
          </li>
        ))}
      </ol>
      {!valid && <p className="warnline">{T('ترتيب الطوابع الزمنية غير صالح', 'Timestamp order is invalid')}</p>}
    </>
  );
}

export function ActionsLog({ inc, fieldOnly }: { inc: Incident; fieldOnly?: boolean }) {
  const { T, tl } = useUI();
  const list = [...inc.actions].filter((a) => !fieldOnly || a.field).sort((a, b) => a.t - b.t);
  if (!list.length) return <p className="muted">{T('لا توجد إجراءات مسجلة', 'No recorded actions')}</p>;
  return (
    <ul className="actlog">
      {list.map((a, i) => (
        <li key={i}><Time t={a.t} /><span className="act-who"><Ltr>{a.actor}</Ltr></span><span>{tl(a.text)}</span>{a.field && <Chip tone="info">{T('ميداني', 'Field')}</Chip>}</li>
      ))}
    </ul>
  );
}

/** Response stepper + controls. Only the assigned responder updates progress. */
export function ResponsePanel({ inc }: { inc: Incident }) {
  const { s, dispatch } = useStore();
  const { T, tl, ui, persona, toast } = useUI();
  const [note, setNote] = useState('');
  const [confirmClose, setConfirmClose] = useState(false);
  const [confirmComplete, setConfirmComplete] = useState(false);
  const a = inc.assignment;
  if (inc.kind !== 'expo') return <p className="muted">{T('لا توجد إجراءات استجابة ميدانية معتمدة لحوادث الموظفين في هذا النموذج.', 'No field-response actions are authorized for employee incidents in this prototype.')}</p>;
  if (!a) {
    if (inc.status === 'closed') return <p className="muted">{T('أغلقت دون تكليف.', 'Closed without assignment.')}</p>;
    return can(ui.role, 'assign') ? <CandidateList inc={inc} /> : <p className="muted">{T('بانتظار التكليف من مركز القيادة.', 'Awaiting assignment by the Command Centre.')}</p>;
  }
  const emp = employeeById(s, a.employeeId);
  const isMe = ui.role === 'responder' && persona.userId === a.employeeId;
  const nx = nextStep(a.current);
  const curIdx = RESPONDER_STEPS.indexOf(a.current);
  return (
    <div className="resp">
      <div className="resp-who">
        <Icon name="user" size={18} />
        <div><strong><Ltr>{a.employeeId}</Ltr> — {emp ? tl(emp.name) : ''}</strong><div className="resp-team"><TeamBadge team={a.team} size="sm" /><span className="muted">{T('كلّفه', 'assigned by')} <Ltr>{a.by}</Ltr></span></div></div>
        {emp && <EmpStatusBadge status={empStatus(s, emp)} />}
      </div>
      <ol className="stepper" aria-label={T('تقدم الاستجابة', 'Response progress')}>
        {RESPONDER_STEPS.map((st, i) => (
          <li key={st} className={i < curIdx ? 'done' : i === curIdx ? 'cur' : 'todo'}>
            <span className="st-dot">{i <= curIdx ? <Icon name="check" size={12} /> : i + 1}</span>
            <span className="st-l">{tl(LABELS.responder[st])}</span>
            <span className="st-t">{a.steps[st] != null ? <Time t={a.steps[st]} /> : <span className="muted">—</span>}</span>
          </li>
        ))}
      </ol>
      {isMe && nx && (
        <div className="resp-ctl">
          <Btn kind="primary" icon="arrow" onClick={() => { dispatch({ type: 'STEP', incidentId: inc.id, step: nx, by: persona.userId }); toast(LABELS.responder[nx]); }}>
            {tl(LABELS.stepAction[nx])}
          </Btn>
          {(a.current === 'arrived' || a.current === 'resolving') && (
            <form className="note-form" onSubmit={(e: { preventDefault(): void }) => { e.preventDefault(); if (note.trim()) { dispatch({ type: 'FIELD_ACTION', incidentId: inc.id, text: note, by: persona.userId }); setNote(''); } }}>
              <label htmlFor={`note-${inc.id}`}>{T('تسجيل إجراء متخذ', 'Record action taken')}</label>
              <div className="row">
                <input id={`note-${inc.id}`} value={note} onChange={(e: { target: { value: string } }) => setNote(e.target.value)} placeholder={T('مثال: تم إبعاد الزوار عن الممر', 'e.g. Visitors redirected away from the walkway')} />
                <Btn type="submit" disabled={!note.trim()}>{T('تسجيل', 'Record')}</Btn>
              </div>
            </form>
          )}
        </div>
      )}
      {!isMe && nx && (can(ui.role, 'assign') ? (
        <div className="resp-ctl op-override">
          <p className="fine">{T(`صلاحية المشغل: يمكنك تحديث المراحل نيابة عن ${a.employeeId} دون انتظار قبوله.`, `Operator authority: you can update the steps on behalf of ${a.employeeId} without waiting for them.`)}</p>
          <div className="row">
            <Btn kind="primary" icon="arrow" onClick={() => { dispatch({ type: 'STEP', incidentId: inc.id, step: nx, by: persona.userId, onBehalf: true }); toast(LABELS.responder[nx]); }}>
              {nx === 'accepted' ? T('قبول نيابة عن الموظف', 'Accept on behalf of employee') : `${tl(LABELS.responder[nx])} — ${T('نيابة عن الموظف', 'on behalf')}`}
            </Btn>
            {confirmComplete ? (
              <span className="confirm">
                <span>{T(`إنهاء ${inc.id} بالكامل؟ ستُسجَّل المراحل المتبقية باسمك ثم تُغلق الحادثة.`, `Complete ${inc.id}? Remaining steps are recorded under your name, then the incident is closed.`)}</span>
                <Btn kind="primary" onClick={() => { dispatch({ type: 'COMPLETE', incidentId: inc.id, by: persona.userId }); setConfirmComplete(false); toast({ ar: `اكتملت ${inc.id} وأُغلقت`, en: `${inc.id} completed and closed` }); }}>{T('تأكيد الإنهاء', 'Confirm')}</Btn>
                <Btn kind="ghost" onClick={() => setConfirmComplete(false)}>{T('إلغاء', 'Cancel')}</Btn>
              </span>
            ) : <Btn icon="check" onClick={() => setConfirmComplete(true)}>{T('إنهاء الحدث بالكامل', 'Complete incident')}</Btn>}
          </div>
        </div>
      ) : <p className="fine">{T('يحدّث المستجيب المكلف فقط مراحل التقدم.', 'Only the assigned responder updates progress.')}</p>)}
      {inc.status === 'resolved' && (can(ui.role, 'close') ? (
        confirmClose ? (
          <div className="confirm">
            <span>{T(`إغلاق ${inc.id}؟ سيصبح التقرير سجلاً نهائياً.`, `Close ${inc.id}? The report becomes the final record.`)}</span>
            <Btn kind="primary" onClick={() => { dispatch({ type: 'CLOSE', incidentId: inc.id, by: persona.userId }); setConfirmClose(false); toast({ ar: `أُغلقت ${inc.id}`, en: `${inc.id} closed` }); }}>{T('تأكيد الإغلاق', 'Confirm close')}</Btn>
            <Btn kind="ghost" onClick={() => setConfirmClose(false)}>{T('إلغاء', 'Cancel')}</Btn>
          </div>
        ) : <Btn kind="primary" icon="check" onClick={() => setConfirmClose(true)}>{T('إغلاق الحادثة', 'Close incident')}</Btn>
      ) : <p className="fine">{T('تمت المعالجة؛ الإغلاق يتم من مركز القيادة.', 'Resolved; closing is done by the Command Centre.')}</p>)}
    </div>
  );
}

function CandidateList({ inc }: { inc: Incident }) {
  const { s, dispatch } = useStore();
  const { T, tl, persona, toast } = useUI();
  const list = suitableCandidates(s, inc);
  return (
    <div className="dstack">
      <div>
        <h4>{T('فرق الاستجابة', 'Response teams')}</h4>
        <TeamsOverview inc={inc} />
        <p className="fine">{T('قاعدة الملاءمة معتمدة للنموذج الأولي: السقوط ← الكادر الطبي؛ الحريق والدخان ← الدفاع المدني؛ الازدحام والعوائق والحركة الخاطئة والتدخين والنفايات ← المنظمين. لا يوجد نوع حادثة لصيانة التكييف حالياً.', 'Prototype suitability rule (confirmed): Fall → Medical Team; Fire & Smoke → Civil Defense; Crowding, Obstruction, Wrong-Way, Smoking, Littering → Organizers. HVAC Maintenance has no incident type yet.')}</p>
      </div>
      {!list.length ? <Empty title={T('لا يوجد موظفون من الفريق المناسب في الموقع', 'No members of the suitable team are on site')} /> : <>
      <h4>{T('المرشحون من الفريق المناسب', 'Candidates from the suitable team')}</h4>
      <p className="fine">{T('الترتيب: التوفر ثم القرب. المسافات قيم توضيحية للنموذج الأولي وليست من تحديد مواقع فعلي.', 'Order: availability, then proximity. Distances are illustrative prototype values, not real positioning.')}</p>
      <ul className="cands">
        {list.map(({ e, distance }) => {
          const unseen = empUnseen(s, e);
          const ok = e.availability === 'available' && !unseen;
          return (
            <li key={e.id} className={ok ? '' : 'dim'}>
              <span className="cand-id"><Ltr>{e.id}</Ltr></span>
              <span className="cand-n">{tl(e.name)}<TeamBadge team={e.team} size="sm" /></span>
              <span className="cand-d">{distance != null ? <Ltr>{distance} m</Ltr> : <span className="muted">—</span>}</span>
              <EmpStatusBadge status={empStatus(s, e)} />
              <Btn small kind={ok ? 'primary' : 'default'} disabled={!ok} onClick={() => { dispatch({ type: 'ASSIGN', incidentId: inc.id, employeeId: e.id, by: persona.userId }); toast({ ar: `تم تكليف ${e.id}`, en: `${e.id} assigned` }); }}
                ariaLabel={T(`تكليف ${e.id}`, `Assign ${e.id}`)}>{T('تكليف', 'Assign')}</Btn>
            </li>
          );
        })}
      </ul></>}
    </div>
  );
}

export function DronePanel({ inc }: { inc: Incident }) {
  const { s, dispatch } = useStore();
  const { T, tl, ui, persona, toast } = useUI();
  const [pick, setPick] = useState('D-01');
  // default to a drone that is actually free (the picked one may be busy or charging)
  const freeDrones = s.drones.filter((d) => d.status === 'available');
  const chosen = freeDrones.some((d) => d.id === pick) ? pick : freeDrones[0]?.id ?? pick;
  const m = inc.drone;
  const may = can(ui.role, 'drone');
  if (inc.kind !== 'expo') return null;
  if (!m) {
    if (inc.status === 'closed') return <p className="muted">{T('لم تُستخدم طائرة.', 'No drone was used.')}</p>;
    return (
      <div className="drone">
        <p className="fine">{T('دعم اختياري عند الحاجة لزاوية إضافية: ازدحام شديد، سقوط وسط حشد، عائق، دخان/حريق، أو رؤية أوسع للموقع. الانتقالات محاكاة ولا تتحكم بطائرة فعلية.', 'Optional, on request, when an additional viewpoint is needed: severe crowding, a fall within crowds, obstruction, smoke/fire, or wider site visibility. Transitions are simulated; no physical aircraft is controlled.')}</p>
        <div className="drone-list" role="radiogroup" aria-label={T('الطائرات', 'Drones')}>
          {s.drones.map((d) => (
            <label key={d.id} className={`drone-opt${d.status !== 'available' ? ' dim' : ''}`}>
              <input type="radio" name={`drone-${inc.id}`} checked={chosen === d.id} disabled={d.status !== 'available'} onChange={() => setPick(d.id)} />
              <Icon name="drone" size={18} />
              <span><strong><Ltr>{d.id}</Ltr></strong> · {tl(LABELS.drone[d.status])}</span>
              <span className="muted">{T('البطارية', 'Battery')} <Ltr>{d.battery}%</Ltr></span>
              <span className="muted">{T('الهدف', 'Target')} <Ltr>{inc.zoneId}</Ltr> · {T('المهمة: التحقق من الحادثة', 'Mission: incident verification')}</span>
            </label>
          ))}
        </div>
        {may ? <Btn icon="drone" onClick={() => { dispatch({ type: 'DRONE_DEPLOY', incidentId: inc.id, droneId: chosen, by: persona.userId }); toast({ ar: `أُطلقت ${chosen} (محاكاة)`, en: `${chosen} deployed (simulated)` }); }}
          disabled={!freeDrones.length}>{freeDrones.length ? T(`إطلاق ${chosen} إلى ${inc.zoneId} (محاكاة)`, `Deploy ${chosen} to ${inc.zoneId} (simulated)`) : T('لا توجد طائرة متاحة الآن', 'No drone available right now')}</Btn>
          : <p className="fine">{T('طلب الطائرة من صلاحيات مشغل مركز القيادة.', 'Drone requests are made by the Command Centre Operator.')}</p>}
      </div>
    );
  }
  const phase = m.endedAt ? 'ended' : m.arrivedAt ? 'on_scene' : 'transit';
  const dur = droneDurationMs(inc);
  return (
    <div className="drone">
      <div className="drone-steps">
        <span className="done"><Icon name="check" size={12} />{T('إطلاق', 'Deploy')} <Time t={m.dispatchedAt} /></span>
        <span className={m.arrivedAt ? 'done' : 'cur'}>{m.arrivedAt ? <Icon name="check" size={12} /> : null}{T('وصول الطائرة', 'Drone arrives')} {m.arrivedAt ? <Time t={m.arrivedAt} /> : <span className="muted">{T('في الطريق…', 'In transit…')}</span>}</span>
        <span className={m.endedAt ? 'done' : m.arrivedAt ? 'cur' : 'todo'}>{T('بث جوي', 'Live aerial feed')}{m.endedAt ? <> · {T('انتهت', 'ended')} <Time t={m.endedAt} /></> : null}</span>
      </div>
      <div className="muted"><Ltr>{m.droneId}</Ltr> · {tl(m.mission)} · <Ltr>{m.targetZoneId}</Ltr> · {T('طلبها', 'requested by')} <Ltr>{m.by}</Ltr>{dur != null && <> · {T('مدة المهمة', 'mission')} <Ltr>{fmtDuration(dur, ui.lang)}</Ltr></>} {m.fixture ? <span className="simtag">{T('طوابع زمنية تجريبية', 'Sample timestamps')}</span> : <SimTag />}</div>
      {phase === 'on_scene' && inc.pos && <AerialFeed center={inc.pos} t={s.now} droneId={m.droneId} />}
      {phase === 'on_scene' && may && <Btn onClick={() => dispatch({ type: 'DRONE_END', incidentId: inc.id, by: persona.userId })}>{T('إنهاء المهمة وإرفاق الدليل', 'End mission & keep evidence')}</Btn>}
    </div>
  );
}

/** Full incident workspace used in Incidents and on role dashboards. */
export function IncidentDetail({ id, mode = 'full' }: { id: string; mode?: 'full' | 'response' }) {
  const { s } = useStore();
  const { T, ui, persona, openReport } = useUI();
  const inc = s.incidents.find((i) => i.id === id);
  if (!inc) return <Empty icon="incidents" title={T('لم يتم العثور على الحادثة', 'Incident not found')} />;
  if (!incidentVisible(ui.role, persona.userId, inc)) return <Restricted what={T('يرى المستجيب الميداني الحوادث المكلف بها فقط.', 'Field responders only see incidents assigned to them.')} />;
  const rt = responseTimeMs(inc);
  return (
    <div className="inc-detail">
      <IncidentHeader inc={inc} />
      <div className="inc-grid">
        <div className="inc-col">
          {mode === 'full' && <Card title={T('التفاصيل', 'Details')} icon="incidents"><IncidentFacts inc={inc} /></Card>}
          {inc.kind === 'expo' && (
            <Card title={T('الاستجابة الميدانية', 'Field response')} icon="user"
              sub={<>{T('زمن الاستجابة (الرصد ← الوصول)', 'Response time (detection → arrival)')}: {rt != null ? <Ltr>{fmtDuration(rt, ui.lang)}</Ltr> : T('قيد الانتظار', 'Pending')}</>}>
              <ResponsePanel inc={inc} />
            </Card>
          )}
          {inc.kind === 'expo' && <Card title={T('دعم الطائرة المسيرة', 'Drone support')} icon="drone"><DronePanel inc={inc} /></Card>}
          {mode === 'response' && <Card title={T('التفاصيل', 'Details')} icon="incidents"><IncidentFacts inc={inc} /></Card>}
        </div>
        <div className="inc-col">
          <Card title={T('الأدلة', 'Evidence')} icon="camera"><EvidenceList inc={inc} /></Card>
          <Card title={T('الجدول الزمني', 'Timeline')} icon="clock"><Timeline inc={inc} /></Card>
          <Card title={T('الإجراءات المسجلة', 'Recorded actions')} icon="reports"
            actions={ui.role !== 'responder' && ui.role !== 'access_admin' ? <Btn small kind="ghost" icon="reports" onClick={() => openReport(inc.id)}>{T('التقرير', 'Report')}</Btn> : undefined}>
            <ActionsLog inc={inc} />
          </Card>
        </div>
      </div>
    </div>
  );
}
