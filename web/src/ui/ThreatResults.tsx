// AI Threat & Abnormal Behavior Detection add-on: a card on the Cameras & AI page to upload a video,
// and the results of its threat analysis. The upload goes to /api/analyze-video, so the existing
// detectors analyze the same file too (same job id) and their events become incidents as before.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAi, useStore, useUI } from '../state/store';
import { can } from '../services/permissions';
import type { JobResult } from '../services/ai';
import type { ThreatAlert, ThreatBox, ThreatJob, ThreatKind, Zone } from '../services/threat';
import { fetchThreatJob, reportUrl, rerunZones, saveZones } from '../services/threat';
import { LABELS } from './labels';
import { Btn, Card, Chip, Empty, Ltr, Restricted } from './primitives';
import { Icon } from './icons';
import './threat.css';

const KIND: Record<ThreatKind, [string, string, string]> = {
  weapon: ['سلاح', 'Weapon', '#c62828'],
  gunshot: ['صوت إطلاق نار / انفجار', 'Gunshot / explosion sound', '#8e24aa'],
  violence: ['عنف (شجار / اعتداء)', 'Violence (fight / assault)', '#ad1457'],
  running: ['ركض / ركض مفاجئ', 'Running / sudden running', '#ef6c00'],
  intrusion: ['دخول منطقة ممنوعة', 'Restricted-area entry', '#d81b60'],
};
const LABEL: Record<string, [string, string]> = {
  gun: ['سلاح ناري', 'Gun'], knife: ['سكين', 'Knife'], gunshot: ['طلق ناري', 'Gunshot'], machine_gun: ['رشاش', 'Automatic fire'],
  explosion: ['انفجار', 'Explosion'], violence: ['عنف', 'Violence'], running: ['ركض', 'Running'], sudden_running: ['ركض مفاجئ', 'Sudden'],
  crowd_running: ['ركض جماعي', 'Crowd running'], intrusion: ['دخول منطقة ممنوعة', 'Restricted area'],
};
const SEV: Record<string, [string, string, 'crit' | 'high' | 'warn' | 'neutral']> = {
  critical: ['حرجة', 'Critical', 'crit'], high: ['عالية', 'High', 'high'], medium: ['متوسطة', 'Medium', 'warn'], low: ['منخفضة', 'Low', 'neutral'],
};
const BOX_COLOR: Record<string, string> = { gun: '#ef4444', knife: '#f97316', violence: '#d946ef', running: '#fb923c', intrusion: '#ec4899' };
const fmt = (s: number | null | undefined) => (s == null ? '—' : `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`);

export function ThreatResults({ jobId }: { jobId: string }) {
  const { s } = useStore();
  const { T, openIncident } = useUI();
  const [job, setJob] = useState<ThreatJob | null>(null);
  const [missing, setMissing] = useState(false);
  const [err, setErr] = useState('');
  const [poll, setPoll] = useState(0);
  const [cur, setCur] = useState(0);
  const [drawing, setDrawing] = useState(false);
  const [pts, setPts] = useState<[number, number][]>([]);
  const [zoneName, setZoneName] = useState('');
  const [busy, setBusy] = useState(false);
  const video = useRef<HTMLVideoElement | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);

  // poll until the analysis finishes (and again after a zone re-check)
  useEffect(() => {
    let stop = false;
    let misses = 0;
    (async () => {
      for (;;) {
        try {
          const j = await fetchThreatJob(jobId);
          if (stop) return;
          if (j == null) {
            if (++misses >= 3) { setMissing(true); return; }
          } else {
            setJob(j); setErr('');
            if (j.state === 'done' || j.state === 'failed') return;
          }
        } catch (e) { if (!stop) setErr(String((e as Error).message || e)); }
        await new Promise((r) => setTimeout(r, 1500));
        if (stop) return;
      }
    })();
    return () => { stop = true; };
  }, [jobId, poll]);

  const duration = useMemo(() => {
    if (!job) return 0;
    const ends = job.alerts.map((a) => a.end_sec ?? 0);
    return Math.max(job.duration_sec ?? 0, ...ends, 1);
  }, [job]);

  // boxes visible at the current playback time
  const visible = useMemo((): ThreatBox[] => {
    if (!job) return [];
    // only the analyzed moment closest to the playback position (within 0.3 s)
    const closest = (ts: number[]) => ts.reduce<number | null>((b, t) => (Math.abs(t - cur) <= 0.3 && (b == null || Math.abs(t - cur) < Math.abs(b - cur)) ? t : b), null);
    const tw = closest(job.detections.weapons.map((d) => d.t));
    const tb = closest(job.detections.behavior.map((d) => d.t));
    return [
      ...job.detections.weapons.filter((d) => d.t === tw),
      ...job.detections.behavior.filter((d) => d.t === tb).flatMap((d) => d.boxes),
    ];
  }, [job, cur]);

  // overlay: zones, boxes and the polygon being drawn, mapped onto the letterboxed video picture
  useEffect(() => {
    const c = canvas.current; const v = video.current;
    if (!c || !v || !job) return;
    const cw = c.clientWidth; const ch = c.clientHeight;
    c.width = cw; c.height = ch;
    const g = c.getContext('2d'); if (!g) return;
    g.clearRect(0, 0, cw, ch);
    const [fw, fh] = job.frame_size ?? [v.videoWidth || cw, v.videoHeight || ch];
    const sc = Math.min(cw / fw, ch / fh); const ox = (cw - fw * sc) / 2; const oy = (ch - fh * sc) / 2;
    const nx = (x: number) => ox + x * fw * sc; const ny = (y: number) => oy + y * fh * sc;
    const poly = (p: [number, number][], color: string, fill: boolean) => {
      if (!p.length) return;
      g.beginPath(); p.forEach(([x, y], i) => (i ? g.lineTo(nx(x), ny(y)) : g.moveTo(nx(x), ny(y))));
      if (fill) { g.closePath(); g.fillStyle = `${color}33`; g.fill(); }
      g.strokeStyle = color; g.lineWidth = 2; g.stroke();
      p.forEach(([x, y]) => { g.fillStyle = color; g.fillRect(nx(x) - 3, ny(y) - 3, 6, 6); });
    };
    job.zones.forEach((z) => poly(z.polygon, '#ec4899', true));
    if (pts.length) poly(pts, '#facc15', pts.length >= 3);
    g.font = '12px system-ui, sans-serif';
    g.direction = 'ltr'; g.textAlign = 'left'; // the page is RTL; box labels are drawn from their left edge
    visible.forEach((b) => {
      const [x1, y1, x2, y2] = b.box; const col = BOX_COLOR[b.label] ?? '#ef4444';
      g.strokeStyle = col; g.lineWidth = 3; g.strokeRect(ox + x1 * sc, oy + y1 * sc, (x2 - x1) * sc, (y2 - y1) * sc);
      const text = `${(LABEL[b.label] ?? [b.label, b.label])[1]} ${Math.round(b.score * 100)}%`;
      const w = g.measureText(text).width + 8;
      g.fillStyle = col; g.fillRect(ox + x1 * sc, oy + y1 * sc - 18, w, 18);
      g.fillStyle = '#fff'; g.fillText(text, ox + x1 * sc + 4, oy + y1 * sc - 5);
    });
  }, [job, visible, pts]);

  if (missing) return null;
  if (!job) return <div className="loading"><span className="spinner" aria-hidden="true" />{T('تحليل التهديدات: بانتظار البدء…', 'Threat analysis: waiting to start…')}</div>;

  const running = job.state === 'queued' || job.state === 'running';
  const seek = (t: number) => { const v = video.current; if (v) { v.currentTime = Math.max(0, t - 0.5); setCur(v.currentTime); } };
  const linked = (a: ThreatAlert) => s.events.find((e) => e.aiId === a.event_id);
  const onCanvasClick = (e: { clientX: number; clientY: number }) => {
    const c = canvas.current; if (!c || !drawing) return;
    const r = c.getBoundingClientRect();
    const [fw, fh] = job.frame_size ?? [r.width, r.height];
    const sc = Math.min(r.width / fw, r.height / fh); const ox = (r.width - fw * sc) / 2; const oy = (r.height - fh * sc) / 2;
    const x = (e.clientX - r.left - ox) / (fw * sc); const y = (e.clientY - r.top - oy) / (fh * sc);
    if (x < 0 || y < 0 || x > 1 || y > 1) return;
    setPts((p) => [...p, [Math.round(x * 1e4) / 1e4, Math.round(y * 1e4) / 1e4]]);
  };
  const applyZones = async (zones: Zone[]) => {
    setBusy(true); setErr('');
    try {
      await saveZones(job.camera_id, zones);
      await rerunZones(job.id);
      setDrawing(false); setPts([]); setZoneName(''); setPoll((n) => n + 1);
    } catch (e) { setErr(String((e as Error).message || e)); } finally { setBusy(false); }
  };
  const counts = (Object.keys(KIND) as ThreatKind[]).map((k) => [k, job.alerts.filter((a) => a.kind === k).length] as const);
  const stageChip = (label: string, st: string, extra?: string) => (
    <Chip tone={st === 'done' ? 'ok' : st === 'failed' ? 'crit' : st === 'partial' ? 'warn' : 'neutral'}>{label}: {st}{extra ? ` · ${extra}` : ''}</Chip>
  );

  return (
    <div className="dstack thr">
      <h3 className="row wrap"><Icon name="gun" size={18} /> {T('رصد التهديدات والسلوك غير الطبيعي', 'Threat & abnormal behavior detection')}</h3>
      <div className="thr-stages">
        {stageChip(T('الصوت', 'Audio'), job.stages.audio.state, job.stages.audio.has_audio === false ? T('لا يوجد مسار صوتي', 'no audio track') : undefined)}
        {stageChip(T('الفيديو (سلاح + سلوك)', 'Video (weapons + behavior)'), job.stages.video.state)}
      </div>
      {(job.stages.audio.error || job.stages.video.error || job.error) && <p className="warnline" role="alert">{[job.stages.audio.error, job.stages.video.error, job.error].filter(Boolean).join(' · ')}</p>}
      {running && (
        <div className="dstack" role="status">
          <div className="loading"><span className="spinner" aria-hidden="true" />{T(`جارٍ تحليل التهديدات… ${Math.round(job.progress * 100)}%`, `Analyzing threats… ${Math.round(job.progress * 100)}%`)}</div>
          <div className="progress"><span style={{ width: `${Math.round(job.progress * 100)}%` }} /></div>
        </div>
      )}
      {err && <p className="warnline" role="alert">{err}</p>}

      <div className="chips">
        {counts.map(([k, n]) => <Chip key={k} tone={n ? 'crit' : 'neutral'}><span className="thr-dot" style={{ background: KIND[k][2] }} />{T(KIND[k][0], KIND[k][1])} <Ltr>{n}</Ltr></Chip>)}
      </div>

      <div className={`thr-player${drawing ? ' drawing' : ''}`}>
        <video ref={video} src={job.video_url} controls preload="metadata" onTimeUpdate={(e: { currentTarget: HTMLVideoElement }) => setCur(e.currentTarget.currentTime)} onSeeked={(e: { currentTarget: HTMLVideoElement }) => setCur(e.currentTarget.currentTime)} />
        <canvas ref={canvas} onClick={onCanvasClick} aria-hidden="true" />
      </div>

      <div className="thr-tl" role="group" aria-label={T('الخط الزمني للتهديدات', 'Threat timeline')}>
        {job.alerts.map((a) => (
          <button key={a.event_id} type="button" className={`band k-${a.kind}`} title={`${T(KIND[a.kind][0], KIND[a.kind][1])} ${fmt(a.start_sec)}–${fmt(a.end_sec)}`}
            style={{ left: `${((a.start_sec ?? 0) / duration) * 100}%`, width: `${Math.max(0.8, (((a.end_sec ?? 0) - (a.start_sec ?? 0)) / duration) * 100)}%` }}
            onClick={() => seek(a.start_sec ?? 0)} />
        ))}
        <span className="head" style={{ left: `${(cur / duration) * 100}%` }} />
        {[0, 0.25, 0.5, 0.75].map((f) => <span key={f} className="tick" style={{ left: `${f * 100 + 2}%` }}>{fmt(f * duration)}</span>)}
      </div>
      <div className="thr-legend">{(Object.keys(KIND) as ThreatKind[]).map((k) => <span key={k}><span className="thr-dot" style={{ background: KIND[k][2] }} />{T(KIND[k][0], KIND[k][1])}</span>)}</div>

      {job.alerts.length ? job.alerts.map((a) => {
        const ev = linked(a);
        const sev = SEV[a.severity] ?? SEV.high;
        return (
          <div key={a.event_id} className={`thr-ev sev-${a.severity}`}>
            {a.snapshot_url && <a href={a.snapshot_url} target="_blank" rel="noreferrer"><img src={a.snapshot_url} alt={T('لقطة الرصد', 'Detection snapshot')} /></a>}
            <div className="dstack">
              <span><strong>{T(KIND[a.kind][0], KIND[a.kind][1])}</strong> <Chip tone={sev[2]}>{T(sev[0], sev[1])}</Chip></span>
              <span className="muted">{a.labels.map((l) => T((LABEL[l] ?? [l, l])[0], (LABEL[l] ?? [l, l])[1])).join(T('، ', ', '))}{a.zone_name ? ` · ${a.zone_name}` : ''}</span>
              <span className="muted">{a.end_sec != null && a.start_sec != null && a.end_sec - a.start_sec >= 0.1
                ? <>{T('من', 'From')} <Ltr>{fmt(a.start_sec)}</Ltr> {T('إلى', 'to')} <Ltr>{fmt(a.end_sec)}</Ltr></>
                : <>{T('عند', 'At')} <Ltr>{fmt(a.start_sec)}</Ltr></>} · {T('الثقة', 'confidence')} <Ltr>{Math.round(a.confidence * 100)}%</Ltr></span>
              <div className="row wrap">
                <Btn small icon="play" onClick={() => seek(a.start_sec ?? 0)}>{T('عرض في الفيديو', 'Show in video')}</Btn>
                {ev?.incidentId && <Btn small kind="primary" icon="incidents" onClick={() => openIncident(ev.incidentId!)}>{T('فتح الحادثة', 'Open incident')} <Ltr>{ev.incidentId}</Ltr></Btn>}
              </div>
            </div>
          </div>
        );
      }) : !running && <Empty icon="check" title={T('لم تُرصد تهديدات في هذا الفيديو', 'No threats detected in this video')}>{T('لا أسلحة ولا أصوات إطلاق نار ولا سلوك غير طبيعي فوق حدود الثقة.', 'No weapons, gunshot sounds or abnormal behavior above the confidence thresholds.')}</Empty>}

      <div className="row wrap">
        <a className="btn b-default" href={reportUrl(job.id)} target="_blank" rel="noreferrer"><Icon name="print" size={16} />{T('تقرير الحادثة', 'Incident report')}</a>
        <Btn icon="lock" kind={drawing ? 'primary' : 'default'} disabled={running || busy} onClick={() => { setDrawing(!drawing); setPts([]); }}>
          {drawing ? T('إلغاء الرسم', 'Cancel drawing') : T('تحديد منطقة ممنوعة', 'Define a restricted area')}
        </Btn>
      </div>
      {drawing && (
        <div className="thr-zone-form">
          <span className="fine">{T('اضغط على الفيديو لرسم حدود المنطقة (3 نقاط على الأقل).', 'Click on the video to draw the area outline (at least 3 points).')} <Ltr>{pts.length}</Ltr></span>
          <input value={zoneName} placeholder={T('اسم المنطقة', 'Area name')} aria-label={T('اسم المنطقة', 'Area name')} onChange={(e: { target: { value: string } }) => setZoneName(e.target.value)} />
          <Btn small onClick={() => setPts((p) => p.slice(0, -1))} disabled={!pts.length}>{T('تراجع', 'Undo')}</Btn>
          <Btn small kind="primary" disabled={pts.length < 3 || busy}
            onClick={() => applyZones([...job.zones, { id: `RZ-${Date.now().toString(36)}`, name: zoneName.trim() || T('منطقة ممنوعة', 'Restricted area'), polygon: pts }])}>
            {T('حفظ وإعادة الفحص', 'Save & re-check')}
          </Btn>
        </div>
      )}
      {job.zones.length > 0 && (
        <ul className="plain thr-zones">
          {job.zones.map((z) => (
            <li key={z.id}><span><span className="thr-dot k-intrusion" />{z.name} <span className="muted">({job.camera_id})</span></span>
              <Btn small kind="ghost" disabled={running || busy} onClick={() => applyZones(job.zones.filter((x) => x.id !== z.id))}>{T('حذف', 'Remove')}</Btn></li>
          ))}
        </ul>
      )}
      <p className="fine">{T('النتائج من تحليل ذكاء اصطناعي فعلي للملف وتحتاج تحققاً بشرياً. المودلات:', 'Results come from real AI analysis of this file and need human verification. Models:')} <Ltr>{Object.values(job.models).join(' · ')}</Ltr></p>
    </div>
  );
}

/** Upload a video for threat analysis. Defaults to the dedicated threat camera (CAM-TH). */
export function ThreatVideoCard() {
  const { s } = useStore();
  const eng = useAi();
  const { T, tl, ui } = useUI();
  const cams = s.cameras.filter((c) => !c.thermal);
  const [file, setFile] = useState<File | null>(null);
  const [camId, setCamId] = useState(cams.some((c) => c.id === 'CAM-TH') ? 'CAM-TH' : (cams[0]?.id ?? ''));
  const [st, setSt] = useState<'idle' | 'uploading' | 'running' | 'done' | 'failed'>('idle');
  const [job, setJob] = useState<JobResult | null>(null);
  const [err, setErr] = useState('');
  const analyze = async () => {
    if (!file) return;
    setSt('uploading'); setErr(''); setJob(null);
    try {
      const j = await eng.analyzeVideo(file, camId, (p) => { setSt('running'); setJob(p); });
      setJob(j);
      setSt(j.state === 'done' ? 'done' : 'failed');
      if (j.state === 'failed') setErr(j.error);
    } catch (e) { setSt('failed'); setErr(String((e as Error).message || e)); }
  };
  const existing = (job?.events ?? []).filter((e) => e.phase !== 'end');
  return (
    <Card title={T('رصد التهديدات في فيديو', 'Threat detection in a video')} icon="upload" sub={T('سلاح · إطلاق نار · سلوك غير طبيعي', 'Weapons · gunshots · abnormal behavior')}>
      {!can(ui.role, 'run_analysis') ? <Restricted what={T('تحليل الفيديو من صلاحيات المشغل والمحلل.', 'Video analysis is available to the Operator and Analyst.')} /> : (
        <div className="dstack">
          <div className="thr-upload">
            <label className="drop" htmlFor="thr-file">
              <Icon name="upload" size={20} />
              <span>{file ? file.name : T('اختر ملف فيديو (MP4 أو AVI أو MOV أو MKV أو WEBM)', 'Choose a video file (MP4, AVI, MOV, MKV or WEBM)')}</span>
              <input id="thr-file" type="file" accept="video/*,.mkv,.avi" onChange={(e: { target: { files: FileList | null } }) => { setFile(e.target.files?.[0] ?? null); setSt('idle'); setJob(null); }} />
            </label>
            <div className="f">
              <label className="field-l" htmlFor="thr-cam">{T('ينسب إلى', 'Attribute to')}</label>
              <select id="thr-cam" className="sel" value={camId} onChange={(e: { target: { value: string } }) => setCamId(e.target.value)}>
                {cams.map((c) => <option key={c.id} value={c.id}>{tl(c.label)} · {c.zoneId}</option>)}
              </select>
            </div>
          </div>
          <p className="fine">{T('يُحلَّل الملف بموديلات التهديدات (سلاح، صوت إطلاق نار، شجار، ركض مفاجئ، دخول منطقة ممنوعة) وبموديلات الكاميرا المختارة معاً. كل رصد يتحول إلى حادثة لفريق الأمن مع لقطة وتوقيت.', 'The file is analyzed by the threat models (weapon, gunshot sound, fight, sudden running, restricted-area entry) together with the selected camera’s detectors. Each detection becomes an incident for the security team, with a snapshot and its time.')}</p>
          <Btn kind="primary" icon="play" onClick={analyze} disabled={!file || st === 'uploading'}>{T('تحليل بالذكاء الاصطناعي', 'Analyze with AI')}</Btn>
          {st === 'uploading' && <div className="loading" role="status"><span className="spinner" aria-hidden="true" />{T('جارٍ رفع الملف…', 'Uploading…')}</div>}
          {err && <p className="warnline" role="alert">{err}</p>}
          {st === 'done' && job && (
            <p className="fine result">{T('موديلات الكاميرا:', 'Camera detectors:')} {existing.length
              ? existing.map((e) => tl(LABELS.category[e.category] ?? { ar: e.category, en: e.category })).join(T('، ', ', '))
              : T('لا اكتشافات', 'no detections')} · <Ltr>{job.frames_analyzed}</Ltr> {T('إطاراً', 'frames')}</p>
          )}
          {job && <ThreatResults jobId={job.id} />}
        </div>
      )}
    </Card>
  );
}
