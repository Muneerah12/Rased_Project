import { useMemo, useState } from 'react';
import type { CpsHistoryPoint } from './historyModel';

type T = (ar: string, en: string) => string;

const W = 640, H = 240, PAD_L = 48, PAD_R = 16, PAD_T = 26, PAD_B = 30;
const PLOT_W = W - PAD_L - PAD_R, PLOT_H = H - PAD_T - PAD_B;

/** A gap longer than this between two readings breaks the line: the sensor sent nothing. */
const GAP_MS = 5 * 60_000;

function niceStep(span: number, count: number): number {
  const raw = span / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const unit = raw / pow;
  return (unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 2.5 ? 2.5 : unit <= 5 ? 5 : 10) * pow;
}

function decimals(step: number): number {
  return step >= 1 ? 0 : Math.min(2, Math.ceil(-Math.log10(step)));
}

const timeFmt = (lang: 'ar' | 'en', opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat(lang === 'ar' ? 'ar-SA-u-nu-latn-ca-gregory' : 'en-GB', opts);

/** Time-scaled line chart with labelled axes, gaps for missing data, and a hover readout. */
export function ReadingChart({ points, unit, color, startMs, endMs, lang, T }: {
  points: CpsHistoryPoint[]; unit: string; color: string; startMs: number; endMs: number; lang: 'ar' | 'en'; T: T;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const data = useMemo(() => points.map((p) => ({ t: Date.parse(p.timestamp), v: p.value })), [points]);
  const values = data.map((d) => d.v);
  const min = Math.min(...values), max = Math.max(...values);
  const avg = values.reduce((sum, v) => sum + v, 0) / values.length;
  const last = data[data.length - 1];
  const step = niceStep(Math.max(max - min, Math.abs(max) * 0.01, 0.4), 4);
  const lo = Math.floor(min / step) * step, hi = Math.max(Math.ceil(max / step) * step, lo + step);
  const yTicks = Array.from({ length: Math.round((hi - lo) / step) + 1 }, (_, i) => lo + i * step);
  const dp = decimals(step);
  const X = (t: number) => PAD_L + ((t - startMs) / (endMs - startMs)) * PLOT_W;
  const Y = (v: number) => PAD_T + (1 - (v - lo) / (hi - lo)) * PLOT_H;

  const spanH = (endMs - startMs) / 3_600_000;
  const tickEvery = (spanH <= 6 ? 1 : spanH <= 24 ? 4 : 24) * 3_600_000;
  const firstTick = Math.ceil(startMs / tickEvery) * tickEvery;
  const xTicks = Array.from({ length: Math.floor((endMs - firstTick) / tickEvery) + 1 }, (_, i) => firstTick + i * tickEvery);
  const xLabel = spanH > 24 ? timeFmt(lang, { weekday: 'short', day: 'numeric' }) : timeFmt(lang, { hour: '2-digit', minute: '2-digit', hour12: false });
  const fullTime = timeFmt(lang, { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false });

  const segments: { t: number; v: number }[][] = [];
  data.forEach((d, i) => {
    if (i === 0 || d.t - data[i - 1].t > GAP_MS) segments.push([]);
    segments[segments.length - 1].push(d);
  });
  const hasGaps = segments.length > 1;
  const line = (seg: { t: number; v: number }[]) => seg.map((d, i) => `${i ? 'L' : 'M'}${X(d.t).toFixed(1)} ${Y(d.v).toFixed(1)}`).join('');
  const area = (seg: { t: number; v: number }[]) => `${line(seg)}L${X(seg[seg.length - 1].t).toFixed(1)} ${PAD_T + PLOT_H}L${X(seg[0].t).toFixed(1)} ${PAD_T + PLOT_H}Z`;

  const onMove = (event: PointerEvent) => {
    const box = (event.currentTarget as SVGSVGElement).getBoundingClientRect();
    const t = startMs + (((event.clientX - box.left) / box.width) * W - PAD_L) / PLOT_W * (endMs - startMs);
    let best = 0;
    for (let i = 1; i < data.length; i += 1) if (Math.abs(data[i].t - t) < Math.abs(data[best].t - t)) best = i;
    setHover(best);
  };
  const h = hover === null ? null : data[hover];
  const fmt = (v: number) => v.toFixed(dp === 0 ? 1 : dp);
  const gradientId = `rc-fill-${unit.replace(/\W/g, '') || 'v'}`;

  return <div className="rc">
    <div className="rc-stats">
      <div className="rc-now"><span>{T('الآن', 'Now')}</span><strong dir="ltr">{fmt(last.v)} {unit}</strong></div>
      <div><span>{T('الأعلى', 'Highest')}</span><b dir="ltr">{fmt(max)} {unit}</b></div>
      <div><span>{T('الأدنى', 'Lowest')}</span><b dir="ltr">{fmt(min)} {unit}</b></div>
      <div><span>{T('المتوسط', 'Average')}</span><b dir="ltr">{fmt(avg)} {unit}</b></div>
    </div>
    <svg className="rc-chart" viewBox={`0 0 ${W} ${H}`} dir="ltr" role="img"
      aria-label={T(`الآن ${fmt(last.v)} ${unit}، الأعلى ${fmt(max)}، الأدنى ${fmt(min)}`, `Now ${fmt(last.v)} ${unit}, highest ${fmt(max)}, lowest ${fmt(min)}`)}
      onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
      <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={color} stopOpacity="0.28" /><stop offset="1" stopColor={color} stopOpacity="0.02" /></linearGradient></defs>
      {yTicks.map((v) => <g key={v}>
        <line x1={PAD_L} x2={W - PAD_R} y1={Y(v)} y2={Y(v)} className="rc-grid" />
        <text x={PAD_L - 8} y={Y(v) + 4} textAnchor="end" className="rc-axis">{v.toFixed(dp)}</text>
      </g>)}
      <text x={PAD_L - 8} y={12} textAnchor="end" className="rc-axis rc-unit">{unit}</text>
      {xTicks.map((t) => <g key={t}>
        <line x1={X(t)} x2={X(t)} y1={PAD_T + PLOT_H} y2={PAD_T + PLOT_H + 5} className="rc-tick" />
        <text x={X(t)} y={H - 8} textAnchor="middle" className="rc-axis">{xLabel.format(t)}</text>
      </g>)}
      <line x1={PAD_L} x2={W - PAD_R} y1={PAD_T + PLOT_H} y2={PAD_T + PLOT_H} className="rc-baseline" />
      {data[0].t - startMs > GAP_MS && X(data[0].t) - PAD_L > 90 && <text x={(PAD_L + X(data[0].t)) / 2} y={PAD_T + PLOT_H / 2} textAnchor="middle" className="rc-empty">{T('لا توجد قراءات', 'No readings')}</text>}
      {segments.map((seg) => <g key={seg[0].t}>
        {seg.length > 1 && <path d={area(seg)} fill={`url(#${gradientId})`} />}
        {seg.length > 1 ? <path d={line(seg)} fill="none" stroke={color} strokeWidth="2.25" strokeLinejoin="round" strokeLinecap="round" />
          : <circle cx={X(seg[0].t)} cy={Y(seg[0].v)} r="2.5" fill={color} />}
      </g>)}
      <circle cx={X(last.t)} cy={Y(last.v)} r="5" fill={color} stroke="var(--surface)" strokeWidth="2" />
      {h && <g pointerEvents="none">
        <line x1={X(h.t)} x2={X(h.t)} y1={PAD_T} y2={PAD_T + PLOT_H} className="rc-hover-line" />
        <circle cx={X(h.t)} cy={Y(h.v)} r="5" fill="var(--surface)" stroke={color} strokeWidth="2.5" />
        {(() => {
          const boxW = 132, left = Math.min(Math.max(X(h.t) - boxW / 2, PAD_L), W - PAD_R - boxW);
          return <g transform={`translate(${left} ${PAD_T})`}>
            <rect width={boxW} height="40" rx="6" className="rc-tip" />
            <text x={boxW / 2} y="17" textAnchor="middle" className="rc-tip-value">{fmt(h.v)} {unit}</text>
            <text x={boxW / 2} y="32" textAnchor="middle" className="rc-tip-time">{fullTime.format(h.t)}</text>
          </g>;
        })()}
      </g>}
    </svg>
    <p className="rc-note">
      {T('مرّر المؤشر فوق الخط لمعرفة القيمة والوقت.', 'Hover over the line to see the value and time.')}
      {hasGaps && <> {T('الانقطاع في الخط يعني أن الحساس لم يرسل بيانات في تلك الفترة.', 'A break in the line means the sensor sent no data then.')}</>}
    </p>
  </div>;
}
