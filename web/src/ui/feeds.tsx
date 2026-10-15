import { useEffect, useRef, useState } from 'react';
import { useAi, useStore, useUI } from '../state/store';
import { fmtTime } from '../model/config';
import type { Pt } from '../model/types';
import type { Det } from '../services/ai';
import { ai as engine } from '../services/ai';
import { Ltr } from './primitives';
import { SiteRender } from './SiteRender';
import { drawHeat, heatOn, toggleHeat, updateHeat } from './heat';
import './crowd.css';

/** Box colours — same scheme as the lama-main dashboard. */
export function boxColor(d: Det): string {
  const l = String(d.label).toLowerCase();
  if (d.model === 'threat') return l === 'running' ? '#f97316' : l === 'intrusion' ? '#ec4899' : l === 'violence' ? '#d946ef' : '#dc2626'; // threat add-on
  if (d.status === 'ok' || d.model === 'ok_way') return '#22c55e';
  if (d.status === 'wrong' || d.model === 'wrong_way' || l === 'fallen') return '#ef4444';
  if (d.status === 'unknown' || d.model === 'tracking') return '#eab308';
  if (l === 'fire') return '#f97316';
  if (l === 'hotspot') return '#facc15';
  if (l === 'smoke') return '#94a3b8';
  if (l === 'sitting') return '#f59e0b';
  if (l === 'standing') return '#22c55e';
  return '#2dd4bf';
}
const DET_TEXT: Record<string, [string, string]> = {
  gun: ['سلاح', 'Gun'], knife: ['سكين', 'Knife'], running: ['ركض', 'Running'], intrusion: ['منطقة ممنوعة', 'Restricted area'], violence: ['عنف', 'Violence'],
  hotspot: ['نقطة ساخنة', 'Hot spot'], person: ['شخص', 'Person'], fire: ['حريق', 'Fire'], smoke: ['دخان', 'Smoke'], fallen: ['سقوط', 'Fallen'], sitting: ['جالس', 'Sitting'],
  standing: ['واقف', 'Standing'], OK: ['اتجاه صحيح', 'OK'], 'Wrong way': ['اتجاه خاطئ', 'Wrong way'], Tracking: ['تتبع', 'Tracking'],
};
export function detLabel(d: Det, lang: 'ar' | 'en'): string {
  const x = DET_TEXT[d.label] ?? DET_TEXT[String(d.label).toLowerCase()];
  const name = x ? x[lang === 'ar' ? 0 : 1] : d.label;
  return d.temp_c != null ? `${name} ${Math.round(d.temp_c)}°C` : name;
}
const ALERT_TEXT: Record<string, [string, string]> = { fire: ['حريق', 'Fire'], smoke: ['دخان', 'Smoke'], fall: ['سقوط', 'Fall'], wrong_way: ['عكس الاتجاه', 'Wrong way'] };

/**
 * Real camera view: this tab's camera/video with the server's boxes drawn on a canvas,
 * or the server's annotated MJPEG for RTSP/USB streams.
 */
export function LiveFeed({ cameraId, name, compact, capacity }: { cameraId: string; name?: string; compact?: boolean; capacity?: number | null }) {
  const eng = useAi();
  const { s } = useStore();
  const { T, ui } = useUI();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const local = eng.local[cameraId];
  const st = s.ai.cameras[cameraId];
  const fr = eng.frames[cameraId];
  useEffect(() => {
    if (!local) return;
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const c = canvasRef.current;
      const v = local.video;
      if (!c || v.readyState < 2 || !v.videoWidth) return;
      const sc = Math.min(1, 1280 / v.videoWidth);
      const w = Math.round(v.videoWidth * sc); const h = Math.round(v.videoHeight * sc);
      if (c.width !== w) c.width = w;
      if (c.height !== h) c.height = h;
      const ctx = c.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(v, 0, 0, w, h);
      const f = engine.frames[cameraId];
      if (!f?.detections || !f.frameSize) return;
      updateHeat(cameraId, f);
      if (heatOn(cameraId)) drawHeat(ctx, cameraId, w, h); // crowd heat map under the boxes
      const kx = w / f.frameSize[0]; const ky = h / f.frameSize[1];
      ctx.lineWidth = Math.max(2, w / 480);
      ctx.font = `${Math.max(11, Math.round(w / 70))}px system-ui, sans-serif`;
      for (const d of f.detections) {
        const [x1, y1, x2, y2] = d.box;
        const bx = x1 * kx; const by = y1 * ky; const bw = (x2 - x1) * kx; const bh = (y2 - y1) * ky;
        if (bw < 3 || bh < 3) continue;
        const col = boxColor(d);
        ctx.strokeStyle = col; ctx.strokeRect(bx, by, bw, bh);
        ctx.fillStyle = `${col}26`; ctx.fillRect(bx, by, bw, bh);
        const txt = `${detLabel(d, ui.lang)} ${Math.round(d.score * 100)}%`;
        const tw = ctx.measureText(txt).width + 8; const th = Math.max(14, w / 55);
        ctx.fillStyle = col; ctx.fillRect(bx, Math.max(0, by - th), tw, th);
        ctx.fillStyle = '#fff'; ctx.fillText(txt, bx + 4, Math.max(th - 4, by - 4));
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [local, ui.lang]);
  const stream = !local && st?.source === 'stream';
  const remote = !local && st?.source === 'browser' && st.active;
  const people = fr?.peopleSmoothed ?? fr?.people ?? null;
  const alerts = fr?.alerts ?? [];
  const [heat, setHeat] = useState(heatOn(cameraId));
  // people counter colour against this camera's capacity: green < 80 % ≤ yellow ≤ 100 % < red
  const load = people != null && capacity ? people / capacity : null;
  const loadCls = load == null ? '' : load > 1 ? ' cap-crit' : load >= 0.8 ? ' cap-warn' : ' cap-ok';
  return (
    <div className={`camview live-feed${compact ? ' compact' : ''}${alerts.length ? ' alarm' : ''}`}>
      {local && <canvas ref={canvasRef} aria-label={T('بث الكاميرا المباشر مع نتائج الذكاء الاصطناعي', 'Live camera feed with AI results')} />}
      {stream && <img src={eng.mjpegUrl(cameraId)} alt={T('بث الكاميرا من الخادم', 'Server camera stream')} />}
      {!local && !stream && (
        <div className="lf-msg">{remote ? T('يُحلَّل هذا المصدر من جهاز آخر الآن. تظهر الأرقام والتنبيهات هنا مباشرة.', 'This source is being analyzed from another device. Counts and alerts appear here live.') : T('لا توجد صورة', 'No picture')}</div>
      )}
      <div className="cv-top">
        <span className="cv-id">{name ?? <Ltr>{cameraId}</Ltr>}</span>
        <span className="cv-live">{T('مباشر', 'LIVE')} · {s.ai.mode === 'lite' ? 'OpenCV' : 'YOLO'}</span>
        {local?.kind === 'file' && <span className="cv-rec"><Ltr>{local.label}</Ltr></span>}
        {local && (
          <button type="button" className={`cv-heat${heat ? ' on' : ''}`} aria-pressed={heat} title={T('خريطة حرارية لتمركز الأشخاص', 'Crowd heat map')}
            onClick={() => { toggleHeat(cameraId); setHeat(heatOn(cameraId)); }}>{T('خريطة حرارية', 'Heat map')}</button>
        )}
        <span className="cv-t"><Ltr>{fmtTime(s.now)}</Ltr></span>
      </div>
      <div className="cv-bottom">
        {people != null && <span className={`cv-count${loadCls}`}>{T('الأشخاص', 'Persons')} <strong><Ltr>{people}{capacity ? ` / ${capacity}` : ''}</Ltr></strong></span>}
        {alerts.map((a) => <span key={a} className={`cv-alert a-${a}`}>{ALERT_TEXT[a]?.[ui.lang === 'ar' ? 0 : 1] ?? a}</span>)}
        {fr?.inferMs != null && <span className="muted-l"><Ltr>{Math.round(fr.inferMs)} ms</Ltr></span>}
        {local?.error && <span className="cv-alert">{local.error}</span>}
      </div>
    </div>
  );
}

/** Deterministic pseudo-random for stable simulated boxes. */
function rnd(seed: number) { const x = Math.sin(seed * 9301 + 49297) * 233280; return x - Math.floor(x); }

/**
 * Camera viewport. No video stream is connected in the prototype, so it shows a
 * "no stream" frame; any detection overlay is explicitly labeled as simulated.
 */
export function CameraView({ cameraId, name, count, capacity, level, analyzing, online, t, category, compact, live = true }: {
  cameraId: string; name?: string; count?: number | null; capacity?: number | null; level?: string; analyzing: boolean; online: boolean; t: number;
  category?: string; compact?: boolean; live?: boolean;
}) {
  const { T } = useUI();
  const eng = useAi();
  const { s } = useStore();
  const isLiveMode = s.baseMode === 'live';
  if (live && (eng.local[cameraId] || s.ai.cameras[cameraId]?.active || s.ai.cameras[cameraId]?.source === 'stream')) {
    return <LiveFeed cameraId={cameraId} name={name} compact={compact} capacity={capacity} />;
  }
  if (live && isLiveMode) { analyzing = false; }
  const n = count ?? 0;
  const boxes = Array.from({ length: Math.min(n, 60) }, (_, i) => {
    const cluster = i % 3 === 0 ? [0.3, 0.55] : i % 3 === 1 ? [0.62, 0.48] : [0.48, 0.7];
    const x = cluster[0] + (rnd(i + 1) - 0.5) * 0.42;
    const y = cluster[1] + (rnd(i + 99) - 0.5) * 0.36;
    const sc = 0.55 + y * 0.8;
    return { x: Math.min(0.95, Math.max(0.03, x)), y: Math.min(0.9, Math.max(0.18, y)), w: 0.028 * sc, h: 0.09 * sc };
  });
  return (
    <div className={`camview${compact ? ' compact' : ''}${!online ? ' off' : ''}`}>
      <svg viewBox="0 0 640 360" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <defs>
          <pattern id="cv-grid" width="32" height="32" patternUnits="userSpaceOnUse"><path d="M32 0H0V32" fill="none" className="cv-gridline" /></pattern>
          <radialGradient id="cv-hot"><stop offset="0" stopColor="var(--heat-crowd)" stopOpacity=".5" /><stop offset="1" stopColor="var(--heat-crowd)" stopOpacity="0" /></radialGradient>
        </defs>
        <rect width="640" height="360" className="cv-bg" />
        <rect width="640" height="360" fill="url(#cv-grid)" />
        <path d="M0 250 L220 170 L420 170 L640 250" className="cv-horizon" />
        {online && analyzing && n > 0 && (
          <>
            <circle cx={0.34 * 640} cy={0.56 * 360} r={120 * Math.min(1.3, n / (capacity || 150))} fill="url(#cv-hot)" />
            {boxes.map((b, i) => <rect key={i} x={b.x * 640} y={b.y * 360} width={b.w * 640} height={b.h * 360} className="cv-box" />)}
          </>
        )}
        {online && analyzing && category && <rect x={380} y={150} width={120} height={90} className="cv-box ev" />}
      </svg>
      <div className="cv-top">
        <span className="cv-id">{name ?? <Ltr>{cameraId}</Ltr>}</span>
        <span className={`cv-rec${online ? '' : ' off'}`}>{!online ? T('الكاميرا غير متصلة', 'Camera offline') : live && isLiveMode ? T('لا يوجد مصدر فيديو مربوط — اربطه من «الكاميرات والذكاء الاصطناعي»', 'No video source bound — connect one in Cameras & AI') : T('لا يوجد بث فيديو متصل', 'No video stream connected')}</span>
        <span className="cv-t"><Ltr>{fmtTime(t)}</Ltr></span>
      </div>
      {online && analyzing && (
        <div className="cv-bottom">
          <span className="cv-sim">{T('اكتشافات محاكاة — ليست تحليلاً حقيقياً', 'SIMULATED DETECTIONS — not real analysis')}</span>
          {count != null && <span>{T('الأشخاص', 'Persons')} <strong><Ltr>{count}{capacity ? ` / ${capacity}` : ''}</Ltr></strong></span>}
          {level && <span>{T('مستوى الحشد', 'Crowd level')} <strong>{level}</strong></span>}
        </div>
      )}
    </div>
  );
}

/** Simulated aerial viewpoint: the night-time aerial photo of the site, zoomed on the target. */
export function AerialFeed({ center, t, droneId }: { center: Pt; t: number; droneId: string }) {
  const { T } = useUI();
  const w = 300; const h = 169;
  return (
    <div className="aerial">
      <svg className="aerial-img" viewBox={`${center[0] - w / 2} ${center[1] - h / 2} ${w} ${h}`} preserveAspectRatio="xMidYMid slice" aria-hidden="true"><SiteRender /></svg>
      <div className="cv-top"><span className="cv-id"><Ltr>{droneId}</Ltr></span><span className="cv-rec">{T('بث محاكى — عرض توضيحي وليس تصوير طائرة', 'SIMULATED FEED — illustrative rendering, not drone footage')}</span><span className="cv-t"><Ltr>{fmtTime(t)}</Ltr></span></div>
      <div className="aerial-cross" aria-hidden="true" />
    </div>
  );
}
