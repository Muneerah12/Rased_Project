import { useEffect, useState } from 'react';
import { useAi, useStore, useUI } from '../state/store';
import { cameraState, zoneOccupancy } from '../model/selectors';
import type { EventCategory } from '../model/types';
import { THREAT_CATEGORIES } from '../model/types';
import { can } from '../services/permissions';
import type { CameraAccessError } from '../services/ai';
import { LABELS } from '../ui/labels';
import { Btn, Card, Chip, ELink, Empty, Field, IncidentStatusBadge, Ltr, StateBadge, Time } from '../ui/primitives';
import { CameraView, boxColor, detLabel } from '../ui/feeds';
import { Icon, IncidentIcon } from '../ui/icons';
import { EventsTable } from './Cameras';
import { ThreatVideoCard } from '../ui/ThreatResults';
import { attachAudio, detachAudio, useThreatAudio } from '../services/threatAudio';
import { startMic, stopMic, useThreatMic } from '../services/threatMic';

export type CameraTab = 'cameras' | 'ai' | 'notify';
/** every category the camera models feed; the AI tab shows them together */
/** cameras kept in the source list but without a screen in the Cameras grid (the thermal camera is left out too) */
const NO_TILE = ['CAM-4'];
export const CAMERA_CATS: EventCategory[] = ['fire_smoke', 'fall', 'crowding', 'wrong_way', ...THREAT_CATEGORIES];
/** Server detectors (same ids as lama-main) and what they feed in Rasid. */
const DETECTORS: { id: string; ar: string; en: string; color: string }[] = [
  { id: 'people', ar: 'عدّ الأشخاص', en: 'People count', color: '#2dd4bf' },
  { id: 'smoke', ar: 'كشف الدخان', en: 'Smoke', color: '#94a3b8' },
  { id: 'fire', ar: 'كشف الحريق', en: 'Fire', color: '#f97316' },
  { id: 'fall', ar: 'سقوط / طوارئ', en: 'Fall / emergency', color: '#ef4444' },
  { id: 'wrong_way', ar: 'اتجاه المشي', en: 'Walking direction', color: '#eab308' },
];
const DIRS: { id: string; arrow: string; ar: string; en: string }[] = [
  { id: 'up', arrow: '↑', ar: 'أعلى', en: 'Up' }, { id: 'down', arrow: '↓', ar: 'أسفل', en: 'Down' },
  { id: 'left', arrow: '←', ar: 'يسار', en: 'Left' }, { id: 'right', arrow: '→', ar: 'يمين', en: 'Right' },
];
const MODEL_STATE: Record<string, [string, string, 'ok' | 'warn' | 'crit' | 'neutral']> = {
  ready: ['جاهز', 'Ready', 'ok'], loading: ['يُحمَّل', 'Loading', 'warn'], idle: ['لم يُحمَّل بعد', 'Not loaded yet', 'neutral'],
  failed: ['فشل — بديل OpenCV', 'Failed — OpenCV fallback', 'crit'], disabled: ['غير متاح — بديل OpenCV', 'Unavailable — OpenCV fallback', 'crit'],
};

function useSrcText() {
  const { s } = useStore();
  const eng = useAi();
  const { T } = useUI();
  return (id: string) => {
    const x = s.ai.cameras[id];
    if (eng.local[id]) return eng.local[id].kind === 'device' ? T('كاميرا هذا الجهاز', 'This device’s camera') : T('ملف فيديو', 'Video file');
    if (!x || x.source === 'none') return T('بدون مصدر', 'No source');
    return x.source === 'stream' ? T('بث من الخادم', 'Server stream') : T('متصفح آخر', 'Another browser');
  };
}

/** The server has no such camera (it still runs an older camera setup): frames for it are rejected. */
function UnknownCameraNote() {
  const { T } = useUI();
  return <p className="warnline" role="alert">{T('الخادم لا يعرف هذه الكاميرا بعد، فلن تُحلَّل إطاراتها ولن يصل عدّها للوحة القيادة. أغلق نافذة الخادم وشغّل start.bat من جديد.', 'The server does not know this camera yet, so its frames are not analyzed and its count does not reach the dashboard. Close the server window and run start.bat again.')}</p>;
}

function LiveCameraList({ engine }: { engine?: boolean }) {
  const { s } = useStore();
  const { T, tl, ui, set } = useUI();
  const srcText = useSrcText();
  const cam = s.cameras.find((c) => c.id === ui.cameraId) ?? s.cameras[0];
  return (
    <Card title={T('مصادر الكاميرا', 'Camera sources')} icon="cameras" className="cam-list">
      <ul className="plain sel-list" role="listbox" aria-label={T('اختر مصدر الكاميرا', 'Choose camera source')}>
        {s.cameras.map((c) => (
          <li key={c.id}>
            <button type="button" role="option" aria-selected={c.id === cam.id} className={c.id === cam.id ? 'on' : ''} onClick={() => set({ cameraId: c.id })}>
              <span>{tl(c.label)}<small><Ltr>{c.id}</Ltr>{c.role && <> · {tl(c.role)}</>} · {srcText(c.id)}{s.ai.cameras[c.id]?.active ? ' ●' : ''}</small></span>
              <StateBadge state={cameraState(s, c)} />
            </button>
          </li>
        ))}
      </ul>
      {engine && <AiEngineStatus />}
    </Card>
  );
}

/** One of the four camera screens: feed + a small toolbar to bind a video file, this device's camera or an RTSP link, and an info popover. */
function LiveCamTile({ camId }: { camId: string }) {
  const { s } = useStore();
  const eng = useAi();
  const { T, tl, ui } = useUI();
  const srcText = useSrcText();
  const cam = s.cameras.find((c) => c.id === camId)!;
  const st = s.ai.cameras[camId];
  const occ = cam.countsZone ? zoneOccupancy(s, cam.zoneId) : null;
  const may = can(ui.role, 'run_analysis');
  const [panel, setPanel] = useState<'none' | 'info' | 'link' | 'cap'>('none');
  const [url, setUrl] = useState(st?.streamUrl ?? '');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const active = !!eng.local[camId] || st?.source === 'stream' || !!st?.active;
  const camErr: Record<CameraAccessError, string> = {
    denied: T('تم رفض إذن الكاميرا. اسمح بالكاميرا من شريط العنوان ثم أعد المحاولة.', 'Camera permission was denied. Allow the camera from the address bar and try again.'),
    not_found: T('لم يتم العثور على كاميرا في هذا الجهاز.', 'No camera was found on this device.'),
    unavailable: T('الوصول إلى الكاميرا غير متاح في هذا المتصفح.', 'Camera access is not available in this browser.'),
    insecure: T('المتصفح يسمح بالكاميرا فقط على https أو localhost.', 'Browsers only allow the camera on https or localhost.'),
  };
  const run = async (f: () => Promise<string | null | void>) => {
    setBusy(true); setErr('');
    try { const e = await f(); if (e) setErr(e); } catch (e) { setErr(String((e as Error).message || e)); } finally { setBusy(false); }
  };
  const toggle = (p: 'info' | 'link' | 'cap') => setPanel(panel === p ? 'none' : p);
  return (
    <section className={`cam-tile${cam.central ? ' central' : ''}${active ? ' on' : ''}`} aria-label={tl(cam.label)}>
      <CameraView cameraId={cam.id} name={tl(cam.label)} online={cam.online} analyzing={false} t={s.now} count={occ?.people ?? null} capacity={occ?.capacity ?? st?.capacity ?? null} />
      <div className="cam-tools" role="toolbar" aria-label={T(`أدوات ${tl(cam.label)}`, `${tl(cam.label)} tools`)}>
        <span className="ct-name">{tl(cam.label)} <small><Ltr>{cam.id}</Ltr>{cam.role && <> · {tl(cam.role)}</>}</small></span>
        {may && <>
          <label className={`ct-btn${busy ? ' dis' : ''}`} title={T('إرفاق ملف فيديو (يُشغَّل متكرراً ويُحلَّل)', 'Attach a video file (loops and is analyzed)')}>
            <Icon name="upload" size={16} /><span className="sr">{T('إرفاق فيديو', 'Attach video')}</span>
            <input type="file" accept="video/*" disabled={busy} onChange={(e: { target: { files: FileList | null; value: string } }) => { const f = e.target.files?.[0]; if (f) void run(async () => { stopMic(camId); await eng.startFile(camId, f); void attachAudio(camId, f, () => eng.local[camId]?.video); }); e.target.value = ''; }} />
          </label>
          <button type="button" className="ct-btn" disabled={busy} title={T('تشغيل كاميرا هذا الجهاز', 'Use this device’s camera')}
            onClick={() => run(async () => { detachAudio(camId); stopMic(camId); const e = await eng.startDevice(camId); if (!e) void startMic(camId); return e ? camErr[e] : null; })}>
            <Icon name="camera" size={16} /><span className="sr">{T('كاميرا الجهاز', 'Device camera')}</span>
          </button>
          <button type="button" className={`ct-btn${panel === 'link' ? ' on' : ''}`} aria-expanded={panel === 'link'} title={T('ربط كاميرا IP / RTSP', 'Connect IP / RTSP camera')} onClick={() => toggle('link')}>
            <Icon name="link" size={16} /><span className="sr">{T('ربط كاميرا', 'Connect camera')}</span>
          </button>
          {!cam.thermal && st && (
            <button type="button" className={`ct-btn${panel === 'cap' ? ' on' : ''}`} aria-expanded={panel === 'cap'} title={T('عدّاد الأشخاص وسعة الكاميرا', 'People counter & camera capacity')} onClick={() => toggle('cap')}>
              <Icon name="crowd" size={16} /><span className="sr">{T('السعة', 'Capacity')}</span>
            </button>
          )}
          {active && (
            <button type="button" className="ct-btn stop" disabled={busy} title={T('إيقاف المصدر', 'Stop source')} onClick={() => run(() => { detachAudio(camId); stopMic(camId); return eng.stopSource(camId); })}>
              <Icon name="pause" size={16} /><span className="sr">{T('إيقاف', 'Stop')}</span>
            </button>
          )}
        </>}
        <button type="button" className={`ct-btn${panel === 'info' ? ' on' : ''}`} aria-expanded={panel === 'info'} title={T('معلومات الكاميرا', 'Camera info')} onClick={() => toggle('info')}>
          <Icon name="info" size={16} /><span className="sr">{T('معلومات الكاميرا', 'Camera info')}</span>
        </button>
      </div>
      {panel === 'info' && (
        <div className="cam-pop" role="dialog" aria-label={T('معلومات الكاميرا', 'Camera info')}>
          <dl className="facts">
            <Field k={T('الكاميرا', 'Camera')}>{tl(cam.label)} <span className="muted"><Ltr>{cam.id}</Ltr></span></Field>
            <Field k={T('المصدر', 'Source')}>{srcText(cam.id)}{st?.source === 'stream' && st.streamUrl && <> · <Ltr>{st.streamUrl}</Ltr></>}</Field>
            <Field k={T('المنطقة', 'Zone')}><ELink r={{ kind: 'zone', id: cam.zoneId }} /></Field>
            <Field k={T('النوع', 'Type')}>{cam.thermal ? T('حرارية', 'Thermal') : cam.countsZone ? T('فيديو · تعدّ أشخاص المنطقة', 'Video · counts the zone') : T('فيديو', 'Video')}</Field>
            {cam.note && <p className="fine">{tl(cam.note)}</p>}
            <Field k={T('الحالة', 'State')}><StateBadge state={cameraState(s, cam)} /> {active ? <Chip tone="brand" pulse>{T('يحلّل الآن', 'Analyzing')}</Chip> : <Chip tone="neutral">{T('متوقف', 'Idle')}</Chip>}</Field>
          </dl>
        </div>
      )}
      {panel === 'link' && may && (
        <div className="cam-pop">
          <div className="row wrap">
            <input value={url} onChange={(e: { target: { value: string } }) => setUrl(e.target.value)} dir="ltr" placeholder="rtsp://user:pass@192.168.1.64:554/…" aria-label={T('رابط الكاميرا', 'Camera URL')} />
            <Btn small icon="link" disabled={busy || !url.trim()} onClick={() => run(async () => { stopMic(camId); const e = await eng.startStream(camId, url.trim(), !!st?.autostart); if (!e) setPanel('none'); return e; })}>{T('ربط', 'Connect')}</Btn>
          </div>
          <p className="fine">{T('رابط RTSP لكاميرا مراقبة، أو 0 / 1 لكاميرا USB موصولة بجهاز الخادم.', 'An RTSP link of a CCTV camera, or 0 / 1 for a USB camera on the server machine.')}</p>
        </div>
      )}
      {panel === 'cap' && may && st && <div className="cam-pop"><CapacityControl camId={cam.id} /></div>}
      <FileAudioLine camId={cam.id} />
      <MicLine camId={cam.id} />
      {!st && <div className="cam-err"><UnknownCameraNote /></div>}
      {(err || st?.error) && <p className="warnline cam-err" role="alert">{err || st?.error}</p>}
    </section>
  );
}

export function LiveDetectionSection({ tab }: { tab: CameraTab }) {
  const { s } = useStore();
  const eng = useAi();
  const { T, tl, ui } = useUI();
  const srcText = useSrcText();
  const cats = CAMERA_CATS;
  const cam = s.cameras.find((c) => c.id === ui.cameraId) ?? s.cameras[0];
  const st = s.ai.cameras[cam.id];
  const occ = cam.countsZone ? zoneOccupancy(s, cam.zoneId) : null;
  const may = can(ui.role, 'run_analysis');
  const ongoing = s.events.filter((e) => e.sourceId === cam.id && !e.endedAt && e.sourceKind === 'camera' && e.aiId);
  const openInc = s.incidents.filter((i) => i.sourceDeviceId === cam.id && cats.includes(i.category as EventCategory) && i.status !== 'closed');
  const local = eng.local[cam.id];

  if (tab === 'notify') return <NotifyCard />;

  if (tab === 'cameras') return (
    <div className="cam-grid">
      {s.cameras.filter((c) => c.central).map((c) => <LiveCamTile key={c.id} camId={c.id} />)}
        {s.cameras.filter((c) => !c.central && !c.thermal && !NO_TILE.includes(c.id)).map((c) => <LiveCamTile key={c.id} camId={c.id} />)}
    </div>
  );

  const fr = eng.frames[cam.id];
  const analyzing = !!(st?.active || local);
  const flow = cam.thermal
    ? [T('إطار حراري', 'Thermal frame'), T('حرارة كل نقطة', 'Per-pixel temperature'), T('نقطة فوق حد الحريق (3 من 5)', 'Spot above fire limit (3 of 5)'), T('حدث حريق', 'Fire event'), T('تنبيه وحادثة', 'Alert & incident'), T('إشعار الدفاع المدني', 'Civil Defense notified')]
    : [T('فيديو', 'Video'), T('موديلات YOLO', 'YOLO models'), T('رصد متكرر (3 من 5)', 'Repeated detection (3 of 5)'), T('حدث', 'Event'), T('تنبيه وحادثة', 'Alert & incident'), T('إشعار الفريق المختص', 'Team notified')];
  return (
    <div className="dstack">
      <div className="cam-layout two">
        <LiveCameraList engine />
        <div className="dstack ai-col">
          <Card title={T('التحليل بالذكاء الاصطناعي', 'AI analysis')} icon="signal" className="ai-card" sub={tl(cam.label)}
            actions={analyzing ? <Chip tone="brand" pulse>{T('يحلّل الآن', 'Analyzing')}</Chip> : <Chip tone="neutral">{T('متوقف', 'Idle')}</Chip>}>
            <div className="ai-stats">
              <div className="ai-stat"><span className="ai-k">{T('المصدر', 'Source')}</span><span className="ai-v">{srcText(cam.id)}</span>
                {st?.source === 'stream' && st.streamUrl && <span className="ai-s"><Ltr>{st.streamUrl}</Ltr></span>}</div>
              <div className="ai-stat"><span className="ai-k">{T('الأداء', 'Performance')}</span>
                <span className="ai-v">{analyzing && fr ? <Ltr>{(fr.fps || 0).toFixed(1)} fps</Ltr> : '—'}</span>
                <span className="ai-s">{analyzing && fr ? <Ltr>{Math.round(fr.inferMs ?? 0)} ms</Ltr> : T('لا يوجد تحليل', 'Not analyzing')}</span></div>
              {cam.countsZone && <div className="ai-stat"><span className="ai-k">{T('الأشخاص الآن', 'People now')}</span>
                <span className="ai-v">{occ?.people != null ? <Ltr>{occ.people} / {occ.capacity}</Ltr> : '—'}</span>
                <span className="ai-s">{T('متوسط آخر 5 إطارات', 'median of last 5 frames')}</span></div>}
              <div className="ai-stat"><span className="ai-k">{T('المنطقة', 'Zone')}</span><span className="ai-v"><ELink r={{ kind: 'zone', id: cam.zoneId }} /></span>
                <span className="ai-s"><Time t={s.now} /></span></div>
              <div className={`ai-stat${ongoing.length ? ' alarm' : ''}`}><span className="ai-k">{T('رصد جارٍ', 'Ongoing')}</span>
                <span className="ai-v"><Ltr>{ongoing.length}</Ltr></span>
                <span className="ai-s">{ongoing.length ? ongoing.map((e) => tl(LABELS.category[e.category])).join(' · ') : T('لا يوجد', 'None')}</span></div>
            </div>
            {cam.thermal && <dl className="facts ai-sec"><ThermalReadings camId={cam.id} /></dl>}
            {!st && <UnknownCameraNote />}
            {st?.error && <p className="warnline" role="alert">{st.error}</p>}
            {may && st && <div className="ai-sec">{cam.thermal ? <ThermalSettings camId={cam.id} /> : <DetectorSettings camId={cam.id} />}</div>}
            {fr && <div className="ai-sec"><CurrentDetections camId={cam.id} /></div>}
            <div className="ai-sec">
              <h4>{T('مسار الرصد', 'Detection pipeline')}</h4>
              <ol className="ai-flow">{flow.map((x, i) => <li key={i}><span className="n"><Ltr>{i + 1}</Ltr></span>{x}</li>)}</ol>
            </div>
          </Card>
          <Card title={T('حوادث مفتوحة من هذا المصدر', 'Open incidents from this source')} icon="incidents" sub={<Ltr>{openInc.length}</Ltr>}>
            {openInc.length ? (
              <ul className="ai-inc">
                {openInc.map((i) => (
                  <li key={i.id}>
                    <IncidentIcon category={i.category} size={16} />
                    <span className="ai-inc-c">{tl(LABELS.category[i.category])}</span>
                    <ELink r={{ kind: 'incident', id: i.id }} />
                    <IncidentStatusBadge status={i.status} />
                  </li>
                ))}
              </ul>
            ) : <Empty icon="check" title={T('لا توجد حوادث مفتوحة من هذا المصدر', 'No open incidents from this source')} />}
          </Card>
        </div>
      </div>
      <Card title={T('الأحداث المرصودة', 'Detected events')} icon="signal"><EventsTable categories={cats} /></Card>
      <ThreatVideoCard />
    </div>
  );
}

function AiEngineStatus() {
  const { s } = useStore();
  const { T, ui } = useUI();
  const models = s.ai.models;
  const names: Record<string, [string, string]> = { coco: ['الأشخاص (YOLO26s)', 'People (YOLO26s)'], fire_smoke: ['الحريق والدخان', 'Fire & smoke'], fall: ['السقوط', 'Fall'] };
  return (
    <div className="dstack">
      <h4>{T('الموديلات على الخادم', 'Models on the server')} · <Ltr>{s.ai.mode === 'lite' ? 'OpenCV lite' : 'YOLO'} / {s.ai.device || '—'}</Ltr></h4>
      <ul className="plain">
        {Object.entries(models).map(([k, m]) => {
          const ms = MODEL_STATE[m.state] ?? MODEL_STATE.idle;
          return <li key={k} className="row wrap" title={m.error || m.source}><span>{names[k]?.[ui.lang === 'ar' ? 0 : 1] ?? m.name}</span> <Chip tone={ms[2] as never}>{ui.lang === 'ar' ? ms[0] : ms[1]}</Chip></li>;
        })}
      </ul>
      {Object.values(models).some((m) => m.state === 'failed' || m.state === 'disabled') && (
        <p className="fine">{T('موديل لم يُحمَّل: تأكد من الإنترنت لتنزيل الأوزان من Hugging Face أول مرة (أو ضع HF_TOKEN في server/.env). حتى ذلك الحين يعمل البديل المبني على OpenCV بدقة أقل.', 'A model did not load: make sure the internet is reachable to download the weights from Hugging Face the first time (or set HF_TOKEN in server/.env). Until then the OpenCV fallback runs with lower accuracy.')}</p>
      )}
    </div>
  );
}

/** Gunshot sound of a video file attached to this camera (threat add-on): analysis state and shots heard. */
function FileAudioLine({ camId }: { camId: string }) {
  const { T } = useUI();
  const a = useThreatAudio(camId);
  if (!a) return null;
  const text = a.status === 'analyzing' ? (a.shots.length
      ? T(`🔊 صوت إطلاق نار في الملف: ${a.shots.length} — رُصد أثناء التشغيل ${a.heard} (التحليل مستمر…)`, `🔊 Gunshot sounds in the file: ${a.shots.length} — heard during playback ${a.heard} (still analyzing…)`)
      : T('🔊 جارٍ تحليل صوت الملف…', '🔊 Analyzing the file’s sound…'))
    : a.status === 'no_audio' ? T('🔇 الملف بدون صوت', '🔇 The file has no sound')
    : a.status === 'error' ? T(`تعذّر تحليل الصوت: ${a.error}`, `Sound analysis failed: ${a.error}`)
    : a.shots.length ? T(`🔊 صوت إطلاق نار في الملف: ${a.shots.length} — رُصد أثناء التشغيل ${a.heard}`, `🔊 Gunshot sounds in the file: ${a.shots.length} — heard during playback ${a.heard}`)
    : T('🔊 لا يوجد صوت إطلاق نار في الملف', '🔊 No gunshot sound in the file');
  return <p className={`cam-audio fine${a.shots.length ? ' hit' : ''}`} role="status">{text}</p>;
}

/** Microphone of a live device camera watched for threats: listening state and the last gunshot heard. */
function MicLine({ camId }: { camId: string }) {
  const { T } = useUI();
  const m = useThreatMic(camId);
  if (!m) return null;
  const hit = m.lastHit && Date.now() - m.lastHit.at < 10_000 ? m.lastHit : null;
  const text = m.status === 'denied' ? T('🎙 لم يُسمح بالميكروفون: صوت إطلاق النار لا يُرصد مباشرة', '🎙 Microphone not allowed: gunshot sound is not detected live')
    : m.status === 'error' ? T(`🎙 تعذّر تحليل صوت الميكروفون: ${m.error}`, `🎙 Microphone sound analysis failed: ${m.error}`)
    : hit ? T(`🎙 رُصد صوت إطلاق نار الآن (${Math.round(hit.score * 100)}%)`, `🎙 Gunshot sound heard now (${Math.round(hit.score * 100)}%)`)
    : T('🎙 الميكروفون يعمل: يرصد صوت إطلاق النار مباشرة', '🎙 Microphone on: gunshot sound detected live');
  return <p className={`cam-audio fine${hit ? ' hit' : ''}`} role="status">{text}</p>;
}

/** People counter and capacity of one camera: above the capacity a crowding alert is raised (people count is turned on if needed). */
function CapacityControl({ camId }: { camId: string }) {
  const { s } = useStore();
  const eng = useAi();
  const { T } = useUI();
  const st = s.ai.cameras[camId];
  const cam = s.cameras.find((c) => c.id === camId);
  const [cap, setCap] = useState(String(st?.capacity ?? ''));
  useEffect(() => setCap(String(st?.capacity ?? '')), [camId, st?.capacity]);
  if (!st || !cam) return null;
  const counting = st.models.includes('people') || st.models.includes('wrong_way');
  const n = cap.trim() ? Math.max(1, Math.round(Number(cap))) : null;
  const people = eng.frames[camId]?.peopleSmoothed ?? eng.frames[camId]?.people ?? st.peopleSmoothed ?? st.people;
  const save = () => void eng.patchCamera(camId, { capacity: n ?? '', models: n && !counting ? [...st.models, 'people'] : st.models });
  return (
    <div className="dstack">
      <div className="cam-cap">
        <label htmlFor={`cap-${camId}`}>{cam.countsZone ? T('سعة المنطقة (حد الازدحام)', 'Zone capacity (crowding limit)') : T('سعة هذه الكاميرا (حد الازدحام)', 'Capacity of this camera (crowding limit)')}</label>
        <input id={`cap-${camId}`} type="number" min={1} inputMode="numeric" value={cap} onChange={(e: { target: { value: string } }) => setCap(e.target.value)} />
        <Btn small kind="primary" disabled={(n ?? null) === (st.capacity ?? null) || (cap.trim() !== '' && !(Number(cap) > 0))} onClick={save}>{T('حفظ', 'Save')}</Btn>
        {st.capacity != null && !cam.countsZone && <Btn small kind="ghost" onClick={() => { setCap(''); void eng.patchCamera(camId, { capacity: '' }); }}>{T('إلغاء الحد', 'Remove limit')}</Btn>}
      </div>
      <p className="fine">
        {T('الأشخاص الآن:', 'People now:')} <Ltr>{people != null ? `${people}${st.capacity ? ` / ${st.capacity}` : ''}` : '—'}</Ltr>
        {!counting && <> · {T('سيُفعَّل «عدّ الأشخاص» تلقائياً عند حفظ السعة.', '“People count” is turned on automatically when you save a capacity.')}</>}
      </p>
    </div>
  );
}

function DetectorSettings({ camId }: { camId: string }) {
  const { s } = useStore();
  const eng = useAi();
  const { T, ui } = useUI();
  const st = s.ai.cameras[camId]!;
  const cam = s.cameras.find((c) => c.id === camId)!;
  const toggle = (id: string) => {
    const next = st.models.includes(id) ? st.models.filter((m) => m !== id) : [...st.models, id];
    void eng.patchCamera(camId, { models: next });
  };
  return (
    <div className="dstack">
      <h4>{T('الكواشف المفعّلة لهذه الكاميرا', 'Detectors enabled on this camera')}</h4>
      <div className="tgl-grid" role="group">
        {DETECTORS.map((d) => (
          <button key={d.id} type="button" className={`fchip${st.models.includes(d.id) ? ' on' : ''}`} aria-pressed={st.models.includes(d.id)} onClick={() => toggle(d.id)}>
            <i style={{ width: 8, height: 8, borderRadius: 2, background: d.color, display: 'inline-block' }} />{ui.lang === 'ar' ? d.ar : d.en}
          </button>
        ))}
      </div>
      {st.models.includes('wrong_way') && (
        <>
          <h4>{T('اتجاه المشي الصحيح', 'Correct walking direction')}</h4>
          <div className="dir-grid">
            {DIRS.map((d) => <button key={d.id} type="button" className={`fchip${st.direction === d.id ? ' on' : ''}`} aria-pressed={st.direction === d.id} onClick={() => void eng.patchCamera(camId, { direction: d.id })}><strong>{d.arrow}</strong> {ui.lang === 'ar' ? d.ar : d.en}</button>)}
          </div>
          <p className="fine">{T('أخضر = صح · أحمر = عكس الاتجاه · أصفر = يتتبع', 'Green = OK · Red = wrong way · Yellow = tracking')}</p>
        </>
      )}
      {!cam.thermal && <CapacityControl camId={camId} />}
    </div>
  );
}

/** Live temperature readings of a thermal camera. */
function ThermalReadings({ camId }: { camId: string }) {
  const { s } = useStore();
  const eng = useAi();
  const { T } = useUI();
  const r = eng.frames[camId]?.thermal ?? s.ai.cameras[camId]?.thermal ?? null;
  if (!r) return <Field k={T('الحرارة', 'Temperature')}><span className="muted">{T('لا توجد قراءة — اربط الكاميرا الحرارية', 'No reading — connect the thermal camera')}</span></Field>;
  const tone = r.maxC >= r.fireC ? 'crit' : r.maxC >= r.hotC ? 'warn' : 'ok';
  return (
    <>
      <Field k={T('أعلى حرارة', 'Max temperature')}><Chip tone={tone}><Ltr>{r.maxC.toFixed(1)} °C</Ltr></Chip> <span className="muted">{T('حد الحريق', 'fire limit')} <Ltr>{r.fireC} °C</Ltr></span></Field>
      <Field k={T('المتوسط / الأدنى', 'Mean / min')}><Ltr>{r.meanC.toFixed(1)} / {r.minC.toFixed(1)} °C</Ltr></Field>
      <Field k={T('مساحة ساخنة', 'Hot area')}><Ltr>{r.hotPct.toFixed(2)}%</Ltr> <span className="muted">≥ <Ltr>{r.hotC} °C</Ltr></span></Field>
      <Field k={T('مصدر القراءة', 'Reading source')}>{r.mode === 'y16' ? T('إشعاعي Y16 (حرارة فعلية من الحساس)', 'Radiometric Y16 (sensor temperatures)') : T('رمادي بنطاق ثابت (تقديري حسب إعداد الكاميرا)', 'Fixed-range grey (estimated from the camera setting)')}</Field>
    </>
  );
}

function ThermalSettings({ camId }: { camId: string }) {
  const { s } = useStore();
  const eng = useAi();
  const { T } = useUI();
  const c = s.ai.cameras[camId]?.thermalCfg;
  const fromCfg = () => ({ mode: c?.mode ?? 'y16', lo: String(c?.rangeMinC ?? 20), hi: String(c?.rangeMaxC ?? 150), hot: String(c?.hotC ?? 50), fire: String(c?.fireC ?? 80) });
  const [f, setF] = useState(fromCfg);
  useEffect(() => setF(fromCfg()), [camId, c?.mode, c?.rangeMinC, c?.rangeMaxC, c?.hotC, c?.fireC]);
  const num = (k: 'lo' | 'hi' | 'hot' | 'fire', label: string) => (
    <label className="th-in">{label}<input type="number" value={f[k]} onChange={(e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })} dir="ltr" /> °C</label>
  );
  const save = () => void eng.patchCamera(camId, { thermal: { mode: f.mode, range_min_c: Number(f.lo), range_max_c: Number(f.hi), hot_c: Number(f.hot), fire_c: Number(f.fire) } });
  return (
    <div className="dstack">
      <h4>{T('إعدادات الكاميرا الحرارية', 'Thermal camera settings')}</h4>
      <div className="tgl-grid" role="group" aria-label={T('وضع القراءة', 'Reading mode')}>
        <button type="button" className={'fchip' + (f.mode === 'y16' ? ' on' : '')} aria-pressed={f.mode === 'y16'} onClick={() => setF({ ...f, mode: 'y16' })}>{T('إشعاعي Y16 (USB)', 'Radiometric Y16 (USB)')}</button>
        <button type="button" className={'fchip' + (f.mode === 'gray' ? ' on' : '')} aria-pressed={f.mode === 'gray'} onClick={() => setF({ ...f, mode: 'gray' })}>{T('رمادي بنطاق ثابت (RTSP)', 'Fixed-range grey (RTSP)')}</button>
      </div>
      <div className="row wrap">
        {num('hot', T('نقطة ساخنة من', 'Hot spot from'))}
        {num('fire', T('تنبيه حريق من', 'Fire alert from'))}
      </div>
      {f.mode === 'gray' && <div className="row wrap">{num('lo', T('الأسود =', 'Black ='))}{num('hi', T('الأبيض =', 'White ='))}</div>}
      <Btn small kind="primary" onClick={save}>{T('حفظ', 'Save')}</Btn>
      <p className="fine">{T('النقاط فوق حد الحريق تُنشئ حدث حريق ودخان يُوجَّه للدفاع المدني. الوضع الرمادي يتطلب ضبط الكاميرا على نطاق حرارة ثابت (بدون ضبط تلقائي)، وإلا تكون القراءات غير دقيقة.', 'Spots above the fire limit create a Fire & Smoke event routed to Civil Defense. Grey mode needs the camera set to a fixed temperature range (no auto-gain), otherwise readings are not accurate.')}</p>
    </div>
  );
}

function CurrentDetections({ camId }: { camId: string }) {
  const eng = useAi();
  const { T, ui } = useUI();
  const f = eng.frames[camId];
  if (!f) return null;
  const dets = f.detections ?? [];
  const counts = new Map<string, { n: number; col: string; d: (typeof dets)[number] }>();
  dets.forEach((d) => { const k = detLabel(d, ui.lang); const x = counts.get(k); counts.set(k, { n: (x?.n ?? 0) + 1, col: boxColor(d), d }); });
  return (
    <div className="dstack">
      <h4>{T('آخر إطار', 'Last frame')} {f.people != null && <>· {T('أشخاص', 'people')} <Ltr>{f.people}</Ltr></>}</h4>
      {dets.length ? (
        <div className="det-mini">{[...counts.entries()].map(([k, v]) => <span key={k}><i style={{ background: v.col }} />{k} <Ltr>×{v.n}</Ltr></span>)}</div>
      ) : f.alerts.length ? <div className="det-mini">{f.alerts.map((a) => <span key={a}>{a}</span>)}</div> : <p className="muted">{T('لا توجد اكتشافات في آخر إطار', 'No detections in the last frame')}</p>}
    </div>
  );
}
function NotifyCard() {
  const { s } = useStore();
  const eng = useAi();
  const { T, ui } = useUI();
  const [perm, setPerm] = useState(typeof Notification !== 'undefined' ? Notification.permission : 'unsupported');
  const [res, setRes] = useState<{ channel: string; ok: boolean; detail: string; target?: string }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const n = s.ai.notify;
  const teams: [string, string, string][] = [['medical', 'الكادر الطبي', 'Medical Team'], ['civil_defense', 'الدفاع المدني', 'Civil Defense'], ['organizers', 'المنظمين', 'Organizers']];
  return (
    <Card title={T('الإشعارات وكيف تُرسل', 'Notifications — how alerts are sent')} icon="bell">
      <div className="grid2">
        <div className="dstack">
          <p className="fine">{T('كل رصد مؤكد يُرسل فوراً إلى كل شاشات راصد المفتوحة (تنبيه + صوت + حادثة)، ثم إلى الفريق المختص عبر القنوات المفعّلة في server/.env:', 'Every confirmed detection is pushed instantly to every open Rasid screen (alert + sound + incident), then to the responsible team through the channels enabled in server/.env:')}</p>
          <ul className="plain">
            <li><IncidentIcon category="fall" size={14} /> {T('السقوط ← الكادر الطبي', 'Fall → Medical Team')}</li>
            <li><IncidentIcon category="fire_smoke" size={14} /> {T('الحريق والدخان ← الدفاع المدني', 'Fire & smoke → Civil Defense')}</li>
            <li><IncidentIcon category="crowding" size={14} /> {T('الازدحام والاتجاه الخاطئ ← المنظمين', 'Crowding & wrong way → Organizers')}</li>
          </ul>
          <div className="notif">
            <Chip tone="ok">{T('شاشات راصد', 'Rasid screens')} ✓</Chip>
            <Chip tone={n?.telegram ? 'ok' : 'neutral'}>Telegram {n?.telegram ? '✓' : T('— غير مفعّل', '— off')}</Chip>
            <Chip tone={n?.webhook ? 'ok' : 'neutral'}>Webhook {n?.webhook ? '✓' : T('— غير مفعّل', '— off')}</Chip>
          </div>
        </div>
        <div className="dstack">
          <div className="row wrap">
            <Btn small icon="bell" onClick={async () => setPerm(await eng.enableDesktopNotifications())}>{T('تفعيل الصوت وإشعارات سطح المكتب', 'Enable sound & desktop notifications')}</Btn>
            <span className="fine">{perm === 'granted' ? T('مفعّلة', 'Enabled') : perm === 'denied' ? T('مرفوضة من المتصفح', 'Blocked by the browser') : ''}</span>
          </div>
          {can(ui.role, 'assign') && (
            <div className="row wrap">
              {teams.map(([id, ar, en]) => (
                <Btn key={id} small kind="ghost" disabled={busy} onClick={async () => { setBusy(true); try { setRes(await eng.testNotify(id)); } finally { setBusy(false); } }}>
                  {T(`إشعار تجريبي: ${ar}`, `Test: ${en}`)}
                </Btn>
              ))}
            </div>
          )}
          {res && <ul className="plain">{res.map((r, i) => <li key={i}><Chip tone={r.ok ? 'ok' : 'crit'}>{r.channel}</Chip> {r.target && <Ltr>{r.target}</Ltr>} <span className="muted">{r.detail}</span></li>)}</ul>}
        </div>
      </div>
    </Card>
  );
}
