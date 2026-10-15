import { useEffect, useState } from 'react';

type T = (ar: string, en: string) => string;

/** Seconds without a heartbeat before the node is shown as silent. */
const SILENT_AFTER_S = 60;
const STRIP_MS = 5 * 60_000;
const W = 640, H = 96, BASE = 80, TOP = 10;

function useNow(stepMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), stepMs); return () => clearInterval(id); }, [stepMs]);
  return now;
}

function ago(seconds: number, T: T): string {
  if (seconds < 60) return T(`قبل ${seconds} ث`, `${seconds}s ago`);
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return T(`قبل ${minutes} د`, `${minutes} min ago`);
  return T(`قبل ${Math.floor(minutes / 60)} س`, `${Math.floor(minutes / 60)} h ago`);
}

const clock = (t: number) => new Date(t).toLocaleTimeString('en-GB', { hour12: false });

/** Node icon that sends out a ripple once per real heartbeat (keyed on the newest receipt). */
function Pulse({ beatKey, live, size }: { beatKey: string; live: boolean; size: number }) {
  return <span className={`hbp-pulse ${live ? 'live' : 'silent'}`} style={{ width: size, height: size }} aria-hidden="true">
    {live && <><i key={`a${beatKey}`} className="ring" /><i key={`b${beatKey}`} className="ring late" /></>}
    <svg viewBox="0 0 24 24" width={size * 0.5} height={size * 0.5} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <rect x="4" y="13" width="16" height="7" rx="2" /><path d="M8 16.5h.01M12 16.5h.01" /><path d="M12 13V9" /><path d="M8.5 7.5a5 5 0 0 1 7 0M6 5a8.5 8.5 0 0 1 12 0" />
    </svg>
  </span>;
}

/** Ticking "N s ago" for the newest heartbeat. */
export function HeartbeatAge({ receipts, T }: { receipts: { received_at: string }[]; T: T }) {
  const now = useNow();
  const latest = receipts[0]?.received_at;
  return <>{latest ? ago(Math.max(0, Math.round((now - Date.parse(latest)) / 1000)), T) : T('لا نبض', 'No beat')}</>;
}

/** Compact pulse icon and "last beat" age, for an inventory row or tile. */
export function HeartbeatBadge({ receipts, T, text = true }: { receipts: { received_at: string }[]; T: T; text?: boolean }) {
  const now = useNow();
  const latest = receipts[0]?.received_at;
  const age = latest ? Math.max(0, Math.round((now - Date.parse(latest)) / 1000)) : null;
  const live = age !== null && age < SILENT_AFTER_S;
  return <span className={`hbp-badge ${live ? 'live' : 'silent'}`}>
    <Pulse beatKey={latest ?? 'none'} live={live} size={24} />
    {text && <span>{age === null ? T('لا نبض', 'No beat') : ago(age, T)}</span>}
  </span>;
}

/** Heartbeat telemetry: one bar per received heartbeat, its height = gap since the previous one. */
export function HeartbeatPulse({ receipts, T, bare = false }: { receipts: { received_at: string }[]; T: T; bare?: boolean }) {
  const now = useNow();
  const times = receipts.map((item) => Date.parse(item.received_at)).filter(Number.isFinite).sort((a, b) => a - b);
  const latest = times[times.length - 1];
  const age = latest === undefined ? null : Math.max(0, Math.round((now - latest) / 1000));
  const live = age !== null && age < SILENT_AFTER_S;
  const beats = times.map((t, i) => ({ t, gapS: i ? (t - times[i - 1]) / 1000 : null }));
  const inStrip = beats.filter((b) => b.t >= now - STRIP_MS);
  const gaps = beats.map((b) => b.gapS).filter((g): g is number => g !== null && g > 0);
  const sorted = [...gaps].sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
  const longest = sorted.length ? sorted[sorted.length - 1] : null;
  const mean = gaps.length ? gaps.reduce((s, g) => s + g, 0) / gaps.length : null;
  const jitter = mean === null ? null : Math.sqrt(gaps.reduce((s, g) => s + (g - mean) ** 2, 0) / gaps.length);
  const tone = (gap: number | null) => gap === null || median === null ? 'ok' : gap >= SILENT_AFTER_S ? 'miss' : gap > median * 2 ? 'late' : 'ok';

  // Bar height = interval since the previous beat, on a scale up to 60 s (longer gaps are clipped and shown red).
  const scaleMax = Math.max(30, Math.min(SILENT_AFTER_S, Math.ceil(((longest ?? 20) + 5) / 10) * 10));
  const X = (t: number) => ((t - (now - STRIP_MS)) / STRIP_MS) * W;
  const Y = (seconds: number) => BASE - (Math.min(seconds, scaleMax) / scaleMax) * (BASE - TOP);
  const silentFrom = latest !== undefined && !live ? X(latest) : null;

  return <div className={`hbp ${live ? 'live' : 'silent'}${bare ? ' bare' : ''}`}>
    <div className="hbp-head">
      <Pulse beatKey={receipts[0]?.received_at ?? 'none'} live={live} size={48} />
      <div>
        <strong>{age === null ? T('لم تصل أي نبضة', 'No heartbeat received') : live ? T('NODE-04 يرسل نبضاته', 'NODE-04 is sending heartbeats') : T('انقطع النبض', 'Heartbeat lost')}</strong>
        <span>{age === null ? T('لا توجد سجلات نبض.', 'No heartbeat records.') : live ? T(`آخر نبضة ${ago(age, T)}`, `Last beat ${ago(age, T)}`) : T(`آخر نبضة وصلت ${ago(age, T)} — تحقق من الجهاز أو الشبكة.`, `Last beat arrived ${ago(age, T)} — check the device or network.`)}</span>
      </div>
      <div className="hbp-stats">
        <div><b dir="ltr">{inStrip.length}</b><span>{T('نبضة / 5 د', 'beats / 5 min')}</span></div>
        <div><b dir="ltr">{median === null ? '—' : `${Math.round(median)}s`}</b><span>{T('الفاصل المعتاد', 'usual interval')}</span></div>
        <div><b dir="ltr">{longest === null ? '—' : `${Math.round(longest)}s`}</b><span>{T('أطول فجوة', 'longest gap')}</span></div>
        <div><b dir="ltr">{jitter === null ? '—' : `±${jitter.toFixed(1)}s`}</b><span>{T('التذبذب', 'jitter')}</span></div>
      </div>
    </div>
    <svg className="hbp-strip" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={T(`${inStrip.length} نبضة في آخر 5 دقائق، الفاصل المعتاد ${median === null ? '—' : Math.round(median)} ثانية`, `${inStrip.length} heartbeats in the last 5 minutes, usual interval ${median === null ? '—' : Math.round(median)} s`)}>
      {[1, 2, 3, 4].map((m) => { const x = W - (m * 60_000 / STRIP_MS) * W; return <line key={m} x1={x} x2={x} y1={TOP - 6} y2={BASE} className="hbp-grid" vectorEffect="non-scaling-stroke" />; })}
      {silentFrom !== null && <rect x={silentFrom} y={TOP - 6} width={W - silentFrom} height={BASE - TOP + 6} className="hbp-silent-zone" />}
      <line x1="0" x2={W} y1={BASE} y2={BASE} className="hbp-base" vectorEffect="non-scaling-stroke" />
      {median !== null && <line x1="0" x2={W} y1={Y(median)} y2={Y(median)} className="hbp-median" vectorEffect="non-scaling-stroke" />}
      {inStrip.map((b) => { const x = X(b.t); const gap = b.gapS ?? median ?? 10; const isLatest = b.t === latest;
        return <g key={b.t} className={`hbp-bar ${tone(b.gapS)}${isLatest && live ? ' latest' : ''}`}>
          <title>{`${clock(b.t)} · ${b.gapS === null ? '—' : `${Math.round(b.gapS)}s`}`}</title>
          <rect x={x - 3} y={Y(gap)} width="6" height={BASE - Y(gap)} rx="1.5" />
        </g>; })}
    </svg>
    <div className="hbp-axis" dir="ltr"><span>{T('قبل 5 د', '5 min ago')}</span><span className="hbp-legend" dir="auto"><i className="ok" />{T('في الموعد', 'on time')}<i className="late" />{T('متأخرة', 'late')}<i className="miss" />{T('فجوة ≥ 60 ث', 'gap ≥ 60 s')}<i className="median" />{T('الفاصل المعتاد', 'usual interval')}</span><span>{T('الآن', 'now')}</span></div>
  </div>;
}
