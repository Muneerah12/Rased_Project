import { useState } from 'react';
import { CAMERA_CATS, LiveDetectionSection } from './CamerasLive';
import type { CameraTab } from './CamerasLive';
import { useStore, useUI } from '../state/store';
import { cameraState, inScope, zoneOccupancy } from '../model/selectors';
import { EVENT_CATEGORIES } from '../model/types';
import type { EventCategory } from '../model/types';
import { can } from '../services/permissions';
import { LABELS } from '../ui/labels';
import { Btn, Card, Chip, ELink, Empty, Field, Ltr, Restricted, SimTag, StateBadge, Tabs, Time } from '../ui/primitives';
import { CameraView } from '../ui/feeds';
import { Icon, IncidentIcon } from '../ui/icons';

export function Cameras() {
  const { ui, set, T } = useUI();
  const { s } = useStore();
  if (!can(ui.role, 'view_devices')) return <div className="page"><Restricted /></div>;
  const ongoing = s.events.filter((e) => e.sourceKind === 'camera' && !e.endedAt).length;
  return (
    <div className="page">
      <Tabs label={T('أقسام الكاميرات', 'Camera sections')} value={ui.cameraTab} onChange={(v) => set({ cameraTab: v })} tabs={[
        { id: 'cameras', label: <><Icon name="cameras" size={15} />{T('الكاميرات', 'Cameras')}</> },
        { id: 'ai', label: <><Icon name="signal" size={15} />{T('تحليل الذكاء الاصطناعي', 'AI analysis')}</>, count: ongoing || undefined },
        { id: 'notify', label: <><Icon name="bell" size={15} />{T('الإشعارات', 'Notifications')}</> },
      ]} />
      {s.baseMode === 'live'
        ? <LiveDetectionSection key={ui.cameraTab} tab={ui.cameraTab} />
        : <>
          <p className="live-banner">{s.connection === 'reconnecting'
            ? T('انقطع الاتصال بخادم الذكاء الاصطناعي. جارٍ إعادة الاتصال…', 'Connection to the AI server lost. Reconnecting…')
            : T('خادم الذكاء الاصطناعي غير متصل، والصفحة تعرض المحاكاة الأصلية. شغّل الخادم (start.bat) وافتح راصد من http://localhost:8010 لتفعيل الموديلات الحقيقية.', 'The AI server is not connected; this page shows the original simulation. Start the server (start.bat) and open Rasid from http://localhost:8010 to use the real models.')}</p>
          <SimDetectionSection key={ui.cameraTab} tab={ui.cameraTab} />
        </>}
    </div>
  );
}

function SimDetectionSection({ tab }: { tab: CameraTab }) {
  const { s, dispatch } = useStore();
  const { T, tl, ui, set, persona } = useUI();
  const cats = CAMERA_CATS;
  const cam = s.cameras.find((c) => c.id === ui.cameraId) ?? s.cameras[0];
  const running = !!s.analysisRunning[cam.id];
  const may = can(ui.role, 'run_analysis');
  const ongoing = s.events.find((e) => e.sourceId === cam.id && cats.includes(e.category) && !e.endedAt && e.sourceKind === 'camera');
  const openInc = s.incidents.filter((i) => i.sourceDeviceId === cam.id && cats.includes(i.category as EventCategory) && i.status !== 'closed');
  const cameraList = (
    <Card title={T('مصادر الكاميرا', 'Camera sources')} icon="cameras" className="cam-list">
      <ul className="plain sel-list" role="listbox" aria-label={T('اختر مصدر الكاميرا', 'Choose camera source')}>
        {s.cameras.map((c) => (
          <li key={c.id}>
            <button type="button" role="option" aria-selected={c.id === cam.id} className={c.id === cam.id ? 'on' : ''} onClick={() => set({ cameraId: c.id })}>
              <span>{tl(c.label)}<small><Ltr>{c.id}</Ltr>{c.role && <> · {tl(c.role)}</>} · <Ltr>{c.zoneId}</Ltr></small></span>
              <StateBadge state={cameraState(s, c)} />
            </button>
          </li>
        ))}
      </ul>
      <p className="fine">{T('مصادر النموذج الأولي؛ التحليل يشمل كل الفئات على نفس المصادر.', 'Prototype sources; the analysis covers every category on the same sources.')}</p>
    </Card>
  );

  if (tab === 'notify') return <SimNotifyCard />;

  if (tab === 'cameras') return (
    <div className="dstack">
      <div className="cam-grid">
        {s.cameras.filter((c) => c.central).map((c) => <SimCamTile key={c.id} camId={c.id} />)}
        {s.cameras.filter((c) => !c.central).slice(0, 4).map((c) => <SimCamTile key={c.id} camId={c.id} />)}
      </div>
      <p className="fine">{T('إرفاق فيديو أو ربط كاميرا لكل شاشة يحتاج تشغيل خادم الذكاء الاصطناعي (start.bat).', 'Attaching a video or connecting a camera to each screen needs the AI server running (start.bat).')}</p>
    </div>
  );

  return (
    <div className="dstack">
      <div className="cam-layout two">
        {cameraList}
        <Card title={T('التحليل بالذكاء الاصطناعي', 'AI analysis')} icon="signal" className="cam-side" sub={tl(cam.label)}>
          <dl className="facts">
            <Field k={T('المصدر', 'Source')}>{tl(cam.label)} <span className="muted"><Ltr>{cam.id}</Ltr></span></Field>
            <Field k={T('المنطقة', 'Zone')}><ELink r={{ kind: 'zone', id: cam.zoneId }} /></Field>
            <Field k={T('الفئات', 'Categories')}><span className="chips">{cats.map((c) => <Chip key={c} tone="neutral" icon={<IncidentIcon category={c} size={13} />}>{tl(LABELS.category[c])}</Chip>)}</span></Field>
            <Field k={T('الوقت', 'Timestamp')}><Time t={s.now} date /></Field>
            <Field k={T('حالة الذكاء الاصطناعي', 'AI status')}>{!cam.online ? <StateBadge state="offline" /> : running ? <Chip tone="brand">{T('قيد التحليل', 'Analyzing')}</Chip> : <Chip tone="neutral">{T('متوقف', 'Paused')}</Chip>} <SimTag /></Field>
            <Field k={T('رصد جارٍ', 'Ongoing detection')}>{ongoing ? <Chip tone="crit">{tl(LABELS.category[ongoing.category])}</Chip> : <span className="muted">{T('لا يوجد', 'None')}</span>}</Field>
          </dl>
          {may && cam.online && (
            <Btn icon={running ? 'pause' : 'play'} onClick={() => dispatch({ type: 'SET_ANALYSIS', cameraId: cam.id, on: !running, by: persona.userId })}>
              {running ? T('إيقاف التحليل المحاكى', 'Pause simulated analysis') : T('تشغيل التحليل المحاكى', 'Start simulated analysis')}
            </Btn>
          )}
          <p className="fine">{T('لا توجد خدمة رؤية حاسوبية متصلة. أي مربعات أو نتائج هنا محاكاة مصنفة، وتمر عبر: فيديو ← تحليل ← رصد ← حدث ← حادثة.', 'No computer-vision service is connected. Any boxes or results here are labeled simulations and follow: video → analysis → detection → event → incident.')}</p>
          <h4>{T('حوادث مفتوحة من هذا المصدر', 'Open incidents from this source')}</h4>
          {openInc.length ? <ul className="plain">{openInc.map((i) => <li key={i.id}><IncidentIcon category={i.category} size={15} /> <ELink r={{ kind: 'incident', id: i.id }} /> {tl(LABELS.category[i.category])}</li>)}</ul> : <p className="muted">{T('لا يوجد', 'None')}</p>}
        </Card>
      </div>
      <Card title={T('الأحداث المرصودة', 'Detected events')} icon="signal"><EventsTable categories={cats} /></Card>
    </div>
  );
}

/** Simulation: the camera screen with its info popover; binding sources needs the AI server. */
function SimCamTile({ camId }: { camId: string }) {
  const { s } = useStore();
  const { T, tl } = useUI();
  const [info, setInfo] = useState(false);
  const cam = s.cameras.find((c) => c.id === camId)!;
  const occ = cam.countsZone ? zoneOccupancy(s, cam.zoneId) : null;
  const running = !!s.analysisRunning[cam.id];
  return (
    <section className={`cam-tile${cam.central ? ' central' : ''}`} aria-label={tl(cam.label)}>
      <CameraView cameraId={cam.id} name={tl(cam.label)} online={cam.online} analyzing={running} t={s.now} count={occ?.people ?? null} capacity={occ?.capacity ?? null} />
      <div className="cam-tools" role="toolbar">
        <span className="ct-name">{tl(cam.label)} <small><Ltr>{cam.id}</Ltr></small></span>
        <button type="button" className={`ct-btn${info ? ' on' : ''}`} aria-expanded={info} title={T('معلومات الكاميرا', 'Camera info')} onClick={() => setInfo(!info)}>
          <Icon name="info" size={16} /><span className="sr">{T('معلومات الكاميرا', 'Camera info')}</span>
        </button>
      </div>
      {info && (
        <div className="cam-pop" role="dialog" aria-label={T('معلومات الكاميرا', 'Camera info')}>
          <dl className="facts">
            <Field k={T('الكاميرا', 'Camera')}>{tl(cam.label)} <span className="muted"><Ltr>{cam.id}</Ltr></span></Field>
            <Field k={T('المصدر', 'Source')}>{T('محاكاة', 'Simulation')} <SimTag /></Field>
            <Field k={T('المنطقة', 'Zone')}><ELink r={{ kind: 'zone', id: cam.zoneId }} /></Field>
            <Field k={T('النوع', 'Type')}>{cam.thermal ? T('حرارية', 'Thermal') : cam.countsZone ? T('فيديو · تعدّ أشخاص المنطقة', 'Video · counts the zone') : T('فيديو', 'Video')}</Field>
            {cam.note && <p className="fine">{tl(cam.note)}</p>}
            <Field k={T('الحالة', 'State')}><StateBadge state={cameraState(s, cam)} /></Field>
          </dl>
        </div>
      )}
    </section>
  );
}

/** Without the AI server only the routing can be shown; sending needs the server and its server/.env channels. */
function SimNotifyCard() {
  const { T } = useUI();
  return (
    <Card title={T('الإشعارات وكيف تُرسل', 'Notifications — how alerts are sent')} icon="bell">
      <p className="fine">{T('كل رصد مؤكد يُرسل إلى شاشات راصد المفتوحة، ثم إلى الفريق المختص:', 'Every confirmed detection goes to the open Rasid screens, then to the responsible team:')}</p>
      <ul className="plain">
        <li><IncidentIcon category="fall" size={14} /> {T('السقوط ← الكادر الطبي', 'Fall → Medical Team')}</li>
        <li><IncidentIcon category="fire_smoke" size={14} /> {T('الحريق والدخان ← الدفاع المدني', 'Fire & smoke → Civil Defense')}</li>
        <li><IncidentIcon category="crowding" size={14} /> {T('الازدحام والاتجاه الخاطئ ← المنظمين', 'Crowding & wrong way → Organizers')}</li>
      </ul>
      <p className="warnline">{T('إرسال الإشعارات (Telegram / Webhook) والإشعارات التجريبية يحتاج تشغيل خادم الذكاء الاصطناعي (start.bat).', 'Sending notifications (Telegram / Webhook) and test notifications need the AI server running (start.bat).')}</p>
    </Card>
  );
}

export function EventsTable({ compact, categories }: { compact?: boolean; categories?: EventCategory[] }) {
  const { s } = useStore();
  const { T, tl, ui } = useUI();
  const cats = categories ?? EVENT_CATEGORIES;
  const [cat, setCat] = useState<EventCategory | 'all'>('all');
  const list = s.events.filter((e) => cats.includes(e.category) && (cat === 'all' || e.category === cat) && (inScope(s, e.zoneId, ui.scope) || ui.scope === 'ALL')).sort((a, b) => b.t - a.t);
  return (
    <div className="dstack">
      {cats.length > 1 && (
        <div className="filters" role="group" aria-label={T('تصفية حسب الفئة', 'Filter by category')}>
          <button type="button" className={`fchip${cat === 'all' ? ' on' : ''}`} onClick={() => setCat('all')} aria-pressed={cat === 'all'}>{T('الكل', 'All')}</button>
          {cats.map((c) => <button key={c} type="button" className={`fchip${cat === c ? ' on' : ''}`} onClick={() => setCat(c)} aria-pressed={cat === c}><IncidentIcon category={c} size={13} />{tl(LABELS.category[c])}</button>)}
        </div>
      )}
      {list.length ? (
        <div className="tbl-wrap">
          <table className={`tbl${compact ? ' compact' : ''}`}>
            <thead><tr><th>{T('الحدث', 'Event')}</th><th>{T('الفئة', 'Category')}</th><th>{T('المصدر', 'Source')}</th><th>{T('الرصد', 'Detected')}</th><th>{T('الحالة', 'State')}</th><th>{T('التنبيه / الحادثة', 'Alert / incident')}</th></tr></thead>
            <tbody>
              {list.map((e) => (
                <tr key={e.id}>
                  <td><Ltr>{e.id}</Ltr> {e.simulated ? <SimTag /> : e.aiId ? <Chip tone="brand">AI</Chip> : null}</td>
                  <td className="nowrap"><IncidentIcon category={e.category} size={14} /> {tl(LABELS.category[e.category])}{e.peakCount != null && <> · <Ltr>{e.peakCount}/{e.capacity}</Ltr></>}{e.score != null && e.category !== 'crowding' && <> · <Ltr>{Math.round(e.score * 100)}%</Ltr></>}</td>
                  <td>{e.sourceKind === 'recorded' && <><Icon name="upload" size={13} /> <Ltr>{e.fileName}</Ltr> · </>}<ELink r={{ kind: 'camera', id: e.sourceId }} /></td>
                  <td><Time t={e.t} /></td>
                  <td>{e.endedAt ? <Chip tone="neutral">{T('انتهى', 'Ended')}</Chip> : <Chip tone="crit">{T('مستمر', 'Ongoing')}</Chip>}</td>
                  <td>{e.alertId && <ELink r={{ kind: 'alert', id: e.alertId }} />} {e.incidentId && <ELink r={{ kind: 'incident', id: e.incidentId }} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <Empty title={T('لا توجد أحداث لهذه الفئة', 'No events for this category')} />}
    </div>
  );
}
