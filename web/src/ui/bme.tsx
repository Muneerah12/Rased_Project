import { useEffect, useState } from 'react';
import { useStore, useUI } from '../state/store';
import { sensorHealth, sensorLast } from '../model/selectors';
import type { BmeMetric, Sensor } from '../model/types';
import { BME_UNITS } from '../model/types';
import { LABELS } from './labels';
import { Ltr, Time } from './primitives';
import { Sparkline } from './charts';

const METRICS: BmeMetric[] = ['temperature', 'humidity', 'pressure'];

/* ------------------------------------------------------------------ temperature levels
   The operator sets the limits on the IoT page; kept in this browser (localStorage). */
export interface TempLimits { warn: number; crit: number }
export type TempLevel = 'ok' | 'warn' | 'crit';
const LIMITS_KEY = 'rasid.tempLimits';
const DEFAULT_LIMITS: TempLimits = { warn: 35, crit: 40 };
const limitListeners = new Set<() => void>();
function readLimits(): TempLimits {
  try {
    const v = JSON.parse(localStorage.getItem(LIMITS_KEY) ?? 'null');
    if (v && Number.isFinite(v.warn) && Number.isFinite(v.crit)) return { warn: v.warn, crit: v.crit };
  } catch { /* storage unavailable */ }
  return DEFAULT_LIMITS;
}
let limits = readLimits();
export function setTempLimits(next: TempLimits) {
  limits = next;
  try { localStorage.setItem(LIMITS_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
  limitListeners.forEach((f) => f());
}
export function useTempLimits(): TempLimits {
  const [, setV] = useState(0);
  useEffect(() => { const f = () => setV((v) => v + 1); limitListeners.add(f); return () => { limitListeners.delete(f); }; }, []);
  return limits;
}
export function tempLevel(c: number, l: TempLimits): TempLevel { return c >= l.crit ? 'crit' : c >= l.warn ? 'warn' : 'ok'; }
export const TEMP_LEVEL_LABEL = { ok: ['طبيعي', 'Normal'], warn: ['تحذير', 'Warning'], crit: ['مرتفع', 'High'] } as const;

/** The three readings of one BME280 device. Offline devices show last known values with their timestamp. */
export function BmeReadings({ se, compact }: { se: Sensor; compact?: boolean }) {
  const { s } = useStore();
  const { T, tl } = useUI();
  const last = sensorLast(se);
  const online = sensorHealth(s, se) === 'online';
  const lim = useTempLimits();
  if (!last) return <span className="muted">—</span>;
  const level = tempLevel(last.temperature, lim);
  return (
    <div className={`bme${online ? '' : ' stale'}${compact ? ' compact' : ''}`}>
      {!online && <div className="bme-stale">{T('آخر قيم معروفة', 'Last known values')} · <Time t={last.t} /></div>}
      <div className="bme-vals">
        {METRICS.map((m) => (
          <span key={m} className={`bme-v${m === 'temperature' ? ` temp-${level}` : ''}`}>
            <small>{tl(LABELS.metric[m])}{m === 'temperature' && <> · {T(TEMP_LEVEL_LABEL[level][0], TEMP_LEVEL_LABEL[level][1])}</>}</small>
            <Ltr>{last[m].toFixed(1)} {BME_UNITS[m]}</Ltr>
          </span>
        ))}
      </div>
    </div>
  );
}

export function BmeHistory({ se }: { se: Sensor }) {
  const { T, tl } = useUI();
  const [m, setM] = useState<BmeMetric>('temperature');
  return (
    <div className="dstack">
      <div className="filters" role="group" aria-label={T('القراءة', 'Reading')}>
        {METRICS.map((x) => <button key={x} type="button" className={`fchip${m === x ? ' on' : ''}`} aria-pressed={m === x} onClick={() => setM(x)}>{tl(LABELS.metric[x])} <Ltr>({BME_UNITS[x]})</Ltr></button>)}
      </div>
      <Sparkline data={se.readings.slice(-30).map((r) => ({ t: r.t, v: r[m] }))} unit={BME_UNITS[m]} label={`${se.id} ${tl(LABELS.metric[m])}`} />
    </div>
  );
}

/** Temperature limits the operator sets: below `warn` normal (green), from `warn` warning (amber), from `crit` high (red). */
export function TempLimitsControl() {
  const { T } = useUI();
  const lim = useTempLimits();
  const [warn, setWarn] = useState(String(lim.warn));
  const [crit, setCrit] = useState(String(lim.crit));
  const w = Number(warn), c = Number(crit);
  const valid = warn !== '' && crit !== '' && Number.isFinite(w) && Number.isFinite(c) && w < c;
  useEffect(() => { if (valid && (w !== lim.warn || c !== lim.crit)) setTempLimits({ warn: w, crit: c }); }, [w, c, valid]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="temp-limits" role="group" aria-label={T('حدود ألوان الحرارة', 'Temperature colour limits')}>
      <span className="tl-title">{T('ألوان الحرارة (°C):', 'Temperature colours (°C):')}</span>
      <span className="tl-chip temp-ok">{T('طبيعي', 'Normal')} <Ltr>&lt; {valid ? w : lim.warn}</Ltr></span>
      <label className="tl-chip temp-warn">{T('تحذير من', 'Warning from')}
        <input type="number" step="0.5" value={warn} onChange={(e: { target: { value: string } }) => setWarn(e.target.value)} aria-label={T('بداية التحذير °C', 'Warning starts at °C')} />
      </label>
      <label className="tl-chip temp-crit">{T('مرتفع من', 'High from')}
        <input type="number" step="0.5" value={crit} onChange={(e: { target: { value: string } }) => setCrit(e.target.value)} aria-label={T('بداية الخطر °C', 'High starts at °C')} />
      </label>
      {!valid && <span className="warnline">{T('حد التحذير لازم يكون أقل من حد الخطر', 'The warning limit must be below the high limit')}</span>}
    </div>
  );
}
