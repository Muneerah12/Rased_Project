import { useState } from 'react';
import { useStore, useUI } from '../state/store';
import { fmtTime } from '../model/config';
import { Ltr } from './primitives';
import { crowdStatus } from '../model/config';
import { LABELS } from './labels';

/** Visitor count over time for a zone, with the capacity line. Time runs left→right in both languages. */
export function CrowdChart({ zoneId }: { zoneId: string }) {
  const { s } = useStore();
  const { T, tl, ui } = useUI();
  const [hover, setHover] = useState<number | null>(null);
  const zone = s.zones.find((z) => z.id === zoneId);
  const hist = (s.crowdHistory[zoneId] ?? []).filter((p) => p.t >= s.now - 12 * 3600_000);
  if (!zone || !zone.capacity || !hist.length) {
    return <div className="chart-empty">{T('لا توجد بيانات إشغال لهذا النطاق. بيانات الإشغال متاحة للمنطقة A1.1 فقط في النموذج الأولي.', 'No occupancy data for this scope. Occupancy is available for A1.1 only in this prototype.')}</div>;
  }
  const cap = zone.capacity;
  const liveV = s.occupancy[zoneId];
  const hasLive = liveV != null;
  const live = liveV ?? 0;
  const pts = hasLive ? [...hist.filter((p) => p.t < s.now - 500), { t: s.now, v: live, fixture: false }] : hist;
  const W = 640; const H = 230; const L = 40; const R = 16; const Tp = 16; const B = 30;
  const t0 = hist[0].t;
  const t1 = Math.max(s.now + 20 * 60_000, t0 + 6 * 3600_000);
  const vMax = Math.ceil(Math.max(60, cap * 1.2, ...pts.map((p) => p.v)) / 20) * 20;
  const gridVals = Array.from({ length: vMax / 20 + 1 }, (_, i) => i * 20).filter((g, i, arr) => arr.length <= 6 || i % 2 === 0 || g === vMax);
  const x = (t: number) => L + ((t - t0) / (t1 - t0)) * (W - L - R);
  const y = (v: number) => Tp + (1 - v / vMax) * (H - Tp - B);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  const area = `${line} L${x(pts[pts.length - 1].t).toFixed(1)},${y(0)} L${x(pts[0].t).toFixed(1)},${y(0)} Z`;
  const hours: number[] = [];
  for (let h = t0; h <= t1; h += 3600_000) hours.push(h);
  const peak = hist.reduce((m, p) => (p.v > m.v ? p : m), hist[0]);
  const hp = hover != null ? pts[hover] : null;
  const onMove = (e: PointerEvent) => {
    const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    let best = 0;
    pts.forEach((p, i) => { if (Math.abs(x(p.t) - px) < Math.abs(x(pts[best].t) - px)) best = i; });
    setHover(best);
  };
  return (
    <div className="crowd-chart">
      <div className="chart-meta">
        <div><span className="muted">{T('الآن', 'Live')}</span> {hasLive ? <><strong><Ltr>{live}/{cap}</Ltr></strong> <span className={`dot-l st-${crowdStatus(live, cap)}`}>{tl(LABELS.crowd[crowdStatus(live, cap)])}</span></> : <span className="muted">{T('لا يوجد عدّ مباشر', 'No live count')}</span>}</div>
        <div><span className="muted">{T('ذروة اليوم (سجل)', 'Today’s peak (history)')}</span> <strong><Ltr>{peak.v}</Ltr></strong> <span className="muted"><Ltr>@ {fmtTime(peak.t, false)}</Ltr></span></div>
        <div className="muted">{T('المدى', 'Range')} <Ltr>{fmtTime(t0, false)}–{fmtTime(t1, false)}</Ltr> · {T('الوحدة: أشخاص', 'Unit: people')}</div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="chart" dir="ltr" role="img" onPointerMove={onMove} onPointerLeave={() => setHover(null)}
        aria-label={T(`عدد الزوار في ${zoneId} عبر الوقت. السعة ${cap}. الآن ${live}.`, `Visitors in ${zoneId} over time. Capacity ${cap}. Now ${live}.`)}>
        {gridVals.map((g) => <g key={g}><line x1={L} x2={W - R} y1={y(g)} y2={y(g)} className="grid" /><text x={L - 6} y={y(g) + 4} className="axis" textAnchor="end">{g}</text></g>)}
        {hours.map((h) => <text key={h} x={x(h)} y={H - 10} className="axis" textAnchor="middle">{fmtTime(h, false)}</text>)}
        <path d={area} className="area" />
        <path d={line} className="line" />
        <line x1={L} x2={W - R} y1={y(cap)} y2={y(cap)} className="cap" />
        <text x={W - R} y={y(cap) - 5} className="cap-l" direction={ui.lang === 'ar' ? 'rtl' : 'ltr'} textAnchor={ui.lang === 'ar' ? 'start' : 'end'}>{T(`السعة ${cap}`, `Capacity ${cap}`)}</text>
        {pts.map((p, i) => (p.fixture || i === pts.length - 1) && (
          <circle key={i} cx={x(p.t)} cy={y(p.v)} r={i === pts.length - 1 ? 5 : 3.2} className={`pt${p.v > cap ? ' over' : ''}${i === pts.length - 1 ? ' live' : ''}`} tabIndex={0}
            onFocus={() => setHover(i)} onBlur={() => setHover(null)} aria-label={`${fmtTime(p.t, false)}: ${p.v}`} />
        ))}
        {hp && (
          <g className="tip" transform={`translate(${Math.min(W - 130, Math.max(L, x(hp.t) - 60))}, ${Math.max(4, y(hp.v) - 50)})`}>
            <rect width="124" height="40" rx="6" />
            <text x="10" y="17">{fmtTime(hp.t, false)}{hp === pts[pts.length - 1] ? (T(' · الآن', ' · live')) : hp.fixture ? T(' · سجل', ' · history') : ''}</text>
            <text x="10" y="32" className="tip-v">{`${hp.v} / ${cap}${hp.v > cap ? T(' · فوق السعة', ' · over') : ''}`}</text>
          </g>
        )}
      </svg>
      <p className="fine">{T('العينات بالساعة من 10:00 إلى 15:00 بيانات تجريبية؛ النقاط اللاحقة من المحاكاة الحية.', 'Hourly samples 10:00–15:00 are fixture history; later points come from the live simulation.')}</p>
    </div>
  );
}

export function Sparkline({ data, unit, label }: { data: { t: number; v: number }[]; unit: string; label: string }) {
  const [hover, setHover] = useState<number | null>(null);
  if (data.length < 2) return <div className="chart-empty">—</div>;
  const W = 320; const H = 90; const P = 8;
  const vs = data.map((d) => d.v);
  const min = Math.min(...vs); const max = Math.max(...vs);
  const span = max - min || 1;
  const x = (i: number) => P + (i / (data.length - 1)) * (W - 2 * P);
  const y = (v: number) => P + (1 - (v - min) / span) * (H - 2 * P - 12);
  const d = data.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  const hp = hover != null ? data[hover] : null;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart spark" dir="ltr" role="img" aria-label={label}
      onPointerMove={(e: PointerEvent) => { const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect(); setHover(Math.round((((e.clientX - r.left) / r.width) * W - P) / (W - 2 * P) * (data.length - 1))); }}
      onPointerLeave={() => setHover(null)}>
      <path d={`${d} L${x(data.length - 1)},${H - 12} L${x(0)},${H - 12} Z`} className="area" />
      <path d={d} className="line" />
      <circle cx={x(data.length - 1)} cy={y(data[data.length - 1].v)} r={3.5} className="pt live" />
      <text x={P} y={H - 1} className="axis">{fmtTime(data[0].t, false)}</text>
      <text x={W - P} y={H - 1} className="axis" textAnchor="end">{fmtTime(data[data.length - 1].t, false)}</text>
      <text x={W - P} y={10} className="axis" textAnchor="end">{`${min}–${max} ${unit}`}</text>
      {hp && <g className="tip" transform={`translate(${Math.min(W - 110, Math.max(0, x(hover!) - 50))}, 4)`}><rect width="104" height="22" rx="5" /><text x="8" y="15">{`${fmtTime(hp.t, false)} · ${hp.v} ${unit}`}</text></g>}
    </svg>
  );
}

/** Heartbeat ticks over five minutes; gaps are shown only after confirmed history. */
export function HeartbeatStrip({ beats, now, timeoutMs, label, knownFrom }: { beats: number[]; now: number; timeoutMs: number; label: string; knownFrom?: number | null }) {
  const W = 360; const H = 26; const span = 300_000;
  const x = (t: number) => ((t - (now - span)) / span) * W;
  const vis = beats.filter((b) => b >= now - span);
  const last = beats[beats.length - 1];
  const coverageStart = Math.max(now - span, knownFrom ?? now);
  const gapStart = last != null && last >= coverageStart && now - last > timeoutMs ? Math.max(coverageStart, last) : null;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="hb-strip" dir="ltr" role="img" aria-label={label} preserveAspectRatio="none">
      <line x1="0" x2={W} y1={H / 2} y2={H / 2} className="grid" />
      {gapStart != null && <rect x={x(gapStart)} y="2" width={W - x(gapStart)} height={H - 4} className="gap" />}
      {vis.map((b) => <line key={b} x1={x(b)} x2={x(b)} y1="5" y2={H - 5} className="beat" />)}
    </svg>
  );
}
