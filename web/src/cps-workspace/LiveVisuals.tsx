import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Icon } from '../ui/icons';
import type { IconName } from '../ui/icons';

type T = (ar: string, en: string) => string;

function useNow(stepMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), stepMs); return () => clearInterval(id); }, [stepMs]);
  return now;
}

/** Tween a number to its new value so a fresh reading visibly "lands". */
function useTweened(target: number | null, ms = 700): number | null {
  const [shown, setShown] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    if (target === null) { setShown(null); from.current = null; return undefined; }
    const start = from.current ?? target; const t0 = performance.now(); let raf = 0;
    const step = (t: number) => { const k = Math.min(1, (t - t0) / ms); const eased = 1 - (1 - k) ** 3; setShown(start + (target - start) * eased); if (k < 1) raf = requestAnimationFrame(step); else from.current = target; };
    raf = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(raf); from.current = target; };
  }, [target, ms]);
  return shown;
}

/* ------------------------------------------------------------------ Riyadh sky */

export type SkyKind = 'clear' | 'partly' | 'cloudy' | 'fog' | 'rain' | 'storm';

export function skyKind(code: number): SkyKind {
  if (code === 0) return 'clear';
  if (code === 1 || code === 2) return 'partly';
  if (code === 3) return 'cloudy';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 95) return 'storm';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  return 'partly';
}

function Cloud({ top, scale, duration, delay, shade }: { top: number; scale: number; duration: number; delay: number; shade: string }) {
  return <span className="wx-cloud" style={{ top: `${top}%`, animationDuration: `${duration}s`, animationDelay: `-${delay}s`, transform: `scale(${scale})` }}>
    <svg viewBox="0 0 120 60" width="120" height="60"><path d="M22 52h76a18 18 0 0 0 2-36 26 26 0 0 0-49-6 20 20 0 0 0-29 18 14 14 0 0 0 0 24z" fill={shade} /></svg>
  </span>;
}

/** Animated sky for the real Open-Meteo condition; cloud speed follows the real wind. */
export function RiyadhSky({ code, isDay, temperature, windKmh, children }: { code: number; isDay: boolean; temperature: number; windKmh: number; children: ReactNode }) {
  const kind = skyKind(code);
  const clouds = { clear: 0, partly: 2, cloudy: 4, fog: 3, rain: 4, storm: 5 }[kind];
  const speed = Math.max(16, Math.min(70, 70 - windKmh * 2.4));
  const shade = kind === 'rain' || kind === 'storm' ? '#9aa7b3' : isDay ? '#ffffff' : '#c9d2e6';
  const layout = [[8, 1.0, 0], [34, 0.7, 0.45], [18, 0.85, 0.2], [48, 0.6, 0.7], [4, 0.75, 0.85]] as const;
  return <div className={`wx-sky wx-${kind} ${isDay ? 'day' : 'night'}`}>
    {isDay && (kind === 'clear' || kind === 'partly') && <span className="wx-sun"><i /></span>}
    {!isDay && <><span className="wx-moon" />{kind === 'clear' || kind === 'partly' ? [12, 28, 46, 63, 80, 22, 70].map((left, i) => <span key={i} className="wx-star" style={{ left: `${left}%`, top: `${8 + (i * 13) % 40}%`, animationDelay: `${i * 0.4}s` }} />) : null}</>}
    {layout.slice(0, clouds).map(([top, scale, offset], i) => <Cloud key={i} top={top} scale={scale} duration={speed * (1 + i * 0.18)} delay={speed * offset} shade={shade} />)}
    {(kind === 'rain' || kind === 'storm') && <span className="wx-rain">{Array.from({ length: 24 }, (_, i) => <i key={i} style={{ left: `${(i * 4.2) % 100}%`, animationDelay: `${(i % 8) * 0.12}s` }} />)}</span>}
    {kind === 'storm' && <span className="wx-flash" />}
    {kind === 'fog' && <span className="wx-fog"><i /><i /></span>}
    {temperature >= 35 && isDay && <span className="wx-haze" />}
    <div className="wx-content">{children}</div>
  </div>;
}

/* ------------------------------------------------------------------ sensor tiles */

export type SensorKind = 'temperature' | 'humidity' | 'pressure';
const SENSOR_META: Record<SensorKind, { icon: IconName; unit: string; min: number; max: number; okLow: number; okHigh: number; digits: number; color: string }> = {
  temperature: { icon: 'temperature', unit: '°C', min: 10, max: 45, okLow: 20, okHigh: 26, digits: 2, color: 'var(--high)' },
  humidity: { icon: 'droplet', unit: '%', min: 0, max: 100, okLow: 30, okHigh: 60, digits: 2, color: 'var(--info)' },
  pressure: { icon: 'gauge', unit: 'hPa', min: 920, max: 970, okLow: 930, okHigh: 960, digits: 2, color: 'var(--emp)' },
};

function Sparkline({ values, color }: { values: number[]; color: string }) {
  if (values.length < 2) return <svg className="sn-spark" viewBox="0 0 100 28" preserveAspectRatio="none"><line x1="0" x2="100" y1="14" y2="14" className="sn-spark-wait" vectorEffect="non-scaling-stroke" /></svg>;
  const lo = Math.min(...values), hi = Math.max(...values), span = Math.max(hi - lo, 0.01);
  const p = values.map((v, i) => `${(i / (values.length - 1)) * 100},${(26 - ((v - lo) / span) * 22).toFixed(2)}`);
  return <svg className="sn-spark" viewBox="0 0 100 28" preserveAspectRatio="none">
    <polygon points={`0,28 ${p.join(' ')} 100,28`} style={{ fill: color }} className="sn-spark-fill" />
    <polyline points={p.join(' ')} style={{ stroke: color }} className="sn-spark-line" vectorEffect="non-scaling-stroke" />
  </svg>;
}

/** Live weather-like background behind a sensor tile: sun/snow, falling drops, rushing air. */
function SensorScene({ kind, value }: { kind: SensorKind; value: number | null }) {
  if (value === null) return null;
  if (kind === 'temperature') {
    if (value <= 18) {
      return <span className="sn-bg sbg-cold" aria-hidden="true">{[8, 24, 40, 58, 74, 88].map((left, i) => <svg key={left} className="flake" style={{ left: `${left}%`, animationDelay: `${i * 0.9}s`, animationDuration: `${6 + (i % 3)}s` }} viewBox="0 0 20 20"><path d="M10 1v18M2.2 5.5l15.6 9M2.2 14.5l15.6-9M7 2.5l3 2.5 3-2.5M7 17.5l3-2.5 3 2.5" /></svg>)}</span>;
    }
    const level = value >= 28 ? 'hot' : value >= 24 ? 'warm' : 'mild';
    return <span className={`sn-bg sbg-sun ${level}`} aria-hidden="true">
      <span className="sun"><i className="rays" /><i className="disc" /></span>
      {level === 'hot' && [20, 45, 70].map((left, i) => <svg key={left} className="shimmer" style={{ left: `${left}%`, animationDelay: `${i * 0.6}s` }} viewBox="0 0 12 40"><path d="M6 40 C0 32 12 26 6 18 C0 10 12 6 6 0" /></svg>)}
    </span>;
  }
  if (kind === 'humidity') {
    const drops = Math.max(2, Math.min(12, Math.round(value / 8)));
    return <span className="sn-bg sbg-rain" aria-hidden="true">{Array.from({ length: drops }, (_, i) => <svg key={i} className="rdrop" style={{ left: `${(i * 37 + 9) % 94}%`, animationDelay: `${(i * 0.47) % 2.6}s`, animationDuration: `${1.9 + (i % 4) * 0.35}s` }} viewBox="0 0 10 14"><path d="M5 0 C5 0 0 7 0 9.5 A5 5 0 0 0 10 9.5 C10 7 5 0 5 0 Z" /></svg>)}</span>;
  }
  return <span className="sn-bg sbg-wind" aria-hidden="true">
    {[14, 30, 46, 62, 78].map((top, i) => <i key={top} className="streak" style={{ top: `${top}%`, animationDelay: `${i * 0.35}s`, animationDuration: `${1.1 + (i % 3) * 0.3}s`, width: `${30 + (i % 3) * 14}%` }} />)}
    <svg className="gust" viewBox="0 0 120 30"><path d="M0 18 H70 C88 18 92 4 80 4 C70 4 72 16 82 16" /></svg>
  </span>;
}

/** A live-feeling sensor tile: ripple on each new reading, tweened value, change, sparkline, range bar. */
export function SensorTile({ kind, label, value, timestamp, history, live, T }: {
  kind: SensorKind; label: string; value: number | null; timestamp: string | null; history: { t: number; v: number }[]; live: boolean; T: T;
}) {
  const meta = SENSOR_META[kind];
  const now = useNow();
  const shown = useTweened(value);
  const prev = history.length > 1 ? history[history.length - 2].v : null;
  const delta = value !== null && prev !== null ? value - prev : null;
  const age = timestamp ? Math.max(0, Math.round((now - Date.parse(timestamp)) / 1000)) : null;
  const pos = (v: number) => Math.min(100, Math.max(0, ((v - meta.min) / (meta.max - meta.min)) * 100));
  const inRange = value !== null && value >= meta.okLow && value <= meta.okHigh;
  return <div className={`sn-tile sn-${kind} ${live ? 'live' : 'stale'}`}>
    <SensorScene kind={kind} value={value} />
    <span className="sn-scan" aria-hidden="true" />
    <div className="sn-head">
      <span className="sn-icon" style={{ color: meta.color }}><Icon name={meta.icon} size={17} /></span>
      <span className="sn-label">{label}</span>
      <span className={`sn-live ${live ? 'on' : ''}`}><i key={timestamp ?? 'none'} />{live ? T('يستشعر', 'Sensing') : T('متوقف', 'Paused')}</span>
    </div>
    <div className="sn-value" dir="ltr"><strong>{shown === null ? '—' : shown.toFixed(meta.digits)}</strong><span>{meta.unit}</span>
      {delta !== null && Math.abs(delta) >= 0.005 && <em className={delta > 0 ? 'up' : 'down'}>{delta > 0 ? '↑' : '↓'} {Math.abs(delta).toFixed(2)}</em>}
    </div>
    <Sparkline values={history.map((h) => h.v)} color={meta.color} />
    <div className="sn-range" dir="ltr" aria-hidden="true">
      <span className="sn-ok" style={{ left: `${pos(meta.okLow)}%`, width: `${pos(meta.okHigh) - pos(meta.okLow)}%` }} />
      {value !== null && <span className="sn-mark" style={{ left: `${pos(value)}%`, background: meta.color }} />}
    </div>
    <div className="sn-foot"><span>{value === null ? '' : inRange ? T('ضمن النطاق المريح', 'Within comfort range') : T('خارج النطاق المريح', 'Outside comfort range')}</span><span>{age === null ? '—' : age < 60 ? T(`قبل ${age} ث`, `${age}s ago`) : T(`قبل ${Math.floor(age / 60)} د`, `${Math.floor(age / 60)} min ago`)}</span></div>
  </div>;
}
