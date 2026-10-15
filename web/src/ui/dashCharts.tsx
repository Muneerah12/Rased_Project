import { useState } from 'react';
import { useStore, useUI } from '../state/store';
import { fmtTime, CONFIG } from '../model/config';
import { inScope, isOpenIncident, zoneOccupancy } from '../model/selectors';
import { EVENT_CATEGORIES } from '../model/types';
import type { EventCategory } from '../model/types';
import { LABELS } from './labels';
import { Icon, IncidentIcon } from './icons';
import type { IconName } from './icons';
import { Ltr } from './primitives';

/* ------------------------------------------------------------------ people gauge */

const polar = (cx: number, cy: number, r: number, f: number) => {
  const a = Math.PI * (1 - f); // f=0 → left end, f=1 → right end of the half circle
  return [cx + r * Math.cos(a), cy - r * Math.sin(a)] as const;
};
const arc = (cx: number, cy: number, r: number, f0: number, f1: number) => {
  const [x0, y0] = polar(cx, cy, r, f0);
  const [x1, y1] = polar(cx, cy, r, f1);
  return `M ${x0} ${y0} A ${r} ${r} 0 0 1 ${x1} ${y1}`; // any part of a half circle is under 180°: small-arc, clockwise
};

/** Compact half-circle meter for a KPI tile: 0 → max, current value in the middle, needle at the value. */
export function KpiGauge({ value, max }: { value: number | null; max: number | null }) {
  const f = value != null && max ? Math.min(1, value / max) : 0;
  const [nx, ny] = polar(100, 100, 58, f);
  return (
    <svg className="kpi-gauge" viewBox="0 0 200 124" aria-hidden="true">
      <path d={arc(100, 100, 80, 0, 1)} fill="none" stroke="var(--border)" strokeWidth="26" />
      {value != null && f > 0 && <path d={arc(100, 100, 80, 0, Math.max(f, 0.005))} fill="none" stroke="var(--c)" strokeWidth="26" />}
      <text x="100" y="66" textAnchor="middle" className="kpi-gauge-v">{value ?? '—'}</text>
      {value != null && <>
        <line x1="100" y1="100" x2={nx} y2={ny} stroke="var(--text)" strokeWidth="4" strokeLinecap="round" />
        <circle cx="100" cy="100" r="6" fill="var(--text)" />
      </>}
      <text x="20" y="121" textAnchor="middle" className="kpi-gauge-t">0</text>
      <text x="180" y="121" textAnchor="middle" className="kpi-gauge-t">{max ?? '—'}</text>
    </svg>
  );
}

/** Compact donut for a KPI tile: total and caption in the middle, one row per part (dot, label, count, share) beside it. */
export function KpiDonut({ parts, caption }: { parts: { key: string; label: string; n: number; color: string }[]; caption?: string }) {
  const total = parts.reduce((a, x) => a + x.n, 0);
  const R = 40; const C = 2 * Math.PI * R;
  const shown = parts.filter((x) => x.n > 0);
  const gap = shown.length > 1 ? 3 : 0; // surface gap between segments
  let acc = 0;
  return (
    <div className="kpi-donut-body">
      <svg className="kpi-donut" viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r={R} className="kd-track" />
        {shown.map((x) => {
          const len = (x.n / total) * C;
          const el = <circle key={x.key} cx="50" cy="50" r={R} className="kd-seg" stroke={x.color}
            strokeDasharray={`${Math.max(0.5, len - gap)} ${C - Math.max(0.5, len - gap)}`} strokeDashoffset={-acc} transform="rotate(-90 50 50)" />;
          acc += len;
          return el;
        })}
        <text x="50" y={caption ? 47 : 50} textAnchor="middle" dominantBaseline="central" className="kpi-donut-v">{total}</text>
        {caption && <text x="50" y="66" textAnchor="middle" className="kpi-donut-c">{caption}</text>}
      </svg>
      <ul className="kpi-donut-legend">
        {parts.map((x) => (
          <li key={x.key} className={x.n ? '' : 'zero'}>
            <span className="kd-dot" style={{ background: x.color }} />
            <span className="kd-l">{x.label}</span>
            <span className="kd-n"><Ltr>{x.n}</Ltr></span>
            <span className="kd-p"><Ltr>{total ? Math.round((x.n / total) * 100) : 0}%</Ltr></span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** KPI rings: one ring per part showing its share of the total, an icon in the middle, then a count / share table. */
export function KpiRings({ parts, total, totalLabel, extra }: {
  parts: { key: string; label: string; n: number; color: string; icon: IconName }[];
  total: number; totalLabel: string; extra?: { label: string; n: number };
}) {
  const { T } = useUI();
  const R = 44; const C = 2 * Math.PI * R;
  const share = (n: number) => (total ? Math.round((n / total) * 100) : 0);
  return (
    <div className="kpi-rings">
      <div className="kr-row">
        {parts.map((x) => {
          const len = total ? (x.n / total) * C : 0;
          return (
            <div key={x.key} className="kr-item" style={{ ['--c' as string]: x.color }}>
              <div className="kr-ring">
                <svg className="kr-arc" viewBox="0 0 100 100" aria-hidden="true">
                  <circle cx="50" cy="50" r={R} className="kr-track" />
                  {len > 0 && <circle cx="50" cy="50" r={R} className="kr-fill" strokeDasharray={`${len} ${C - len}`} transform="rotate(-90 50 50)" />}
                </svg>
                <span className="kr-icon"><Icon name={x.icon} size={20} strokeWidth={1.8} /></span>
              </div>
              <span className="kr-l">{x.label} <b><Ltr>{x.n}</Ltr></b></span>
            </div>
          );
        })}
      </div>
      <table className="kr-tbl">
        <thead><tr><th /><th>{T('العدد', 'Count')}</th><th>{T('النسبة', 'Share')}</th></tr></thead>
        <tbody>
          {parts.map((x) => (
            <tr key={x.key}>
              <td>{x.label}</td>
              <td><span className="kr-sw" style={{ background: x.color }} /><Ltr>{x.n}</Ltr></td>
              <td><Ltr>{share(x.n)}%</Ltr></td>
            </tr>
          ))}
          <tr className="kr-total"><td>{totalLabel}</td><td><Ltr>{total}</Ltr></td><td><Ltr>100%</Ltr></td></tr>
          {extra && <tr><td>{extra.label}</td><td><Ltr>{extra.n}</Ltr></td><td>—</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

/**
 * People present in a zone against its capacity: a half-circle meter. The fill carries the crowd
 * level (normal → medium → crowded) and the track is a lighter step of the same colour.
 */
export function OccupancyGauge({ zoneId }: { zoneId: string }) {
  const { s } = useStore();
  const { T, tl, ui } = useUI();
  const rtl = ui.lang === 'ar'; // SVG text-anchor start/end follow the text direction
  const [hover, setHover] = useState(false);
  const occ = zoneOccupancy(s, zoneId);
  const cap = occ.capacity ?? 0;
  const people = occ.people;
  const max = Math.max(5, Math.ceil(Math.max(cap * 1.25, people ?? 0) / 5) * 5); // a clean scale end just above capacity
  const f = people == null ? 0 : Math.min(1, people / max);
  const capF = cap ? Math.min(1, cap / max) : null;
  const tone = occ.status === 'crowded' ? 'var(--crit)' : occ.status === 'medium' ? 'var(--warn)' : 'var(--ok)';
  const pct = people != null && cap ? Math.round((people / cap) * 100) : null;
  const updated = s.occupancyUpdatedAt[zoneId];
  const [nx, ny] = polar(110, 112, 70, f);
  const [cx0, cy0] = polar(110, 112, 80, capF ?? 0);
  const [cx1, cy1] = polar(110, 112, 104, capF ?? 0);
  return (
    <div className="gauge">
      <div className="gauge-plot" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
        <svg viewBox="-24 -14 268 146" role="img"
          aria-label={people != null ? T(`الأشخاص الآن ${people} من ${cap} (${pct}%) في ${zoneId}`, `${people} people of ${cap} (${pct}%) in ${zoneId}`) : T('لا توجد بيانات عدّ حالياً', 'No count data right now')}>
          <path d={arc(110, 112, 92, 0, 1)} fill="none" stroke={tone} strokeOpacity=".2" strokeWidth="18" strokeLinecap="round" />
          {people != null && f > 0 && <path d={arc(110, 112, 92, 0, Math.max(f, 0.01))} fill="none" stroke={tone} strokeWidth="18" strokeLinecap="round" />}
          {capF != null && <line x1={cx0} y1={cy0} x2={cx1} y2={cy1} stroke="var(--text)" strokeWidth="2" strokeLinecap="round" />}
          {people != null && <>
            <line x1="110" y1="112" x2={nx} y2={ny} stroke="var(--text)" strokeWidth="2" strokeLinecap="round" />
            <circle cx="110" cy="112" r="4.5" fill="var(--text)" />
          </>}
          <text x="18" y="126" className="gauge-tick" textAnchor="middle">0</text>
          <text x="202" y="126" className="gauge-tick" textAnchor="middle">{max}</text>
          {capF != null && <text x={polar(110, 112, 118, capF)[0]} y={polar(110, 112, 118, capF)[1] - 2} className="gauge-tick cap" direction={rtl ? 'rtl' : 'ltr'}
            textAnchor={capF > 0.6 ? (rtl ? 'end' : 'start') : capF < 0.4 ? (rtl ? 'start' : 'end') : 'middle'}>{T(`السعة ${cap}`, `capacity ${cap}`)}</text>}
        </svg>
        {hover && people != null && (
          <div className="viz-tip" role="status">
            <strong><Ltr>{people}</Ltr></strong> {T('شخص', 'people')} · {T('السعة', 'capacity')} <Ltr>{cap}</Ltr> · <Ltr>{pct}%</Ltr>
          </div>
        )}
      </div>
      <div className="gauge-read">
        {people != null ? (
          <>
            <div className="gauge-big"><Ltr>{people}</Ltr><span className="gauge-of"> / <Ltr>{cap}</Ltr></span></div>
            <div className="gauge-state" style={{ ['--tone' as string]: tone }}>
              <Icon name={occ.status === 'normal' ? 'check' : 'incidents'} size={14} />
              {tl(LABELS.crowd[occ.status!])} · <Ltr>{pct}%</Ltr> {T('من السعة', 'of capacity')}
            </div>
            <div className="gauge-sub">
              {T('المنطقة', 'Zone')} <Ltr>{zoneId}</Ltr> · {T('متوسط آخر 5 إطارات من الكاميرا', 'median of the last 5 camera frames')}
              {updated && <> · {T('آخر تحديث', 'updated')} <Ltr>{fmtTime(updated)}</Ltr></>}
            </div>
            <div className="gauge-legend">
              <span><i style={{ background: 'var(--ok)' }} />{T('طبيعي', 'Normal')} <Ltr>{`< ${Math.round(CONFIG.crowdNormalMaxRatio * 100)}%`}</Ltr></span>
              <span><i style={{ background: 'var(--warn)' }} />{T('متوسط حتى السعة', 'Medium up to capacity')}</span>
              <span><i style={{ background: 'var(--crit)' }} />{T('مزدحم فوق السعة', 'Crowded above capacity')}</span>
            </div>
          </>
        ) : (
          <div className="gauge-empty">
            <strong>{T('لا توجد بيانات عدّ حالياً', 'No count data right now')}</strong>
            <span>{T(`شغّل كاميرا العدّ للمنطقة ${zoneId} من صفحة الكاميرات. السعة: ${cap}`, `Start the counting camera for ${zoneId} on the Cameras page. Capacity: ${cap}`)}</span>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ incidents donut */

/** Fixed colour per incident type (validated categorical order) — a type keeps its colour in every view. */
const CAT_COLOR: Record<EventCategory, string> = {
  crowding: '#2a78d6', fall: '#eb6834', fire_smoke: '#1baf7a', obstruction: '#eda100',
  wrong_way: '#e87ba4', smoking: '#008300', littering: '#4a3aa7',
  // threat add-on categories are not in EVENT_CATEGORIES, so the donut does not show them
  weapon: '#c62828', gunshot: '#8e24aa', abnormal_behavior: '#ef6c00', node_offline: '#546e7a',
};
const OTHER_COLOR = '#9aa5a1';
const MAX_SLICES = 6;

/** Expo incidents in scope by type: donut + legend with counts, hover details and a table view. */
export function IncidentsDonut() {
  const { s } = useStore();
  const { T, tl, ui, set } = useUI();
  const [mode, setMode] = useState<'all' | 'open'>('all');
  const [hover, setHover] = useState<string | null>(null);
  const [table, setTable] = useState(false);
  const list = s.incidents.filter((i) => i.kind === 'expo' && (ui.scope === 'ALL' || inScope(s, i.zoneId, ui.scope)) && (mode === 'all' || isOpenIncident(i)));
  const counts = EVENT_CATEGORIES.map((c) => ({ key: c as string, label: tl(LABELS.category[c]), color: CAT_COLOR[c], n: list.filter((i) => i.category === c).length, cats: [c] }))
    .filter((x) => x.n > 0);
  // at most six slices: the smallest types fold into "Other"
  let slices = counts;
  if (counts.length > MAX_SLICES) {
    const keep = [...counts].sort((a, b) => b.n - a.n).slice(0, MAX_SLICES - 1).map((x) => x.key);
    const rest = counts.filter((x) => !keep.includes(x.key));
    slices = [...counts.filter((x) => keep.includes(x.key)), { key: 'other', label: T('أخرى', 'Other'), color: OTHER_COLOR, n: rest.reduce((a, x) => a + x.n, 0), cats: rest.flatMap((x) => x.cats) }];
  }
  const total = slices.reduce((a, x) => a + x.n, 0);
  const R = 70; const W = 22; const C = 2 * Math.PI * R;
  const gap = slices.length > 1 ? 2 : 0; // 2px surface gap between slices
  let acc = 0;
  const segs = slices.map((x) => {
    const len = (x.n / Math.max(1, total)) * C;
    const seg = { ...x, off: acc, len: Math.max(0, len - gap) };
    acc += len;
    return seg;
  });
  const hov = segs.find((x) => x.key === hover);
  const goTo = () => set({ section: 'incidents', incidentTab: 'expo', incidentId: null });
  return (
    <div className="donut">
      <div className="viz-filters" role="group" aria-label={T('نطاق الحوادث', 'Incident filter')}>
        <button type="button" className={`fchip${mode === 'all' ? ' on' : ''}`} aria-pressed={mode === 'all'} onClick={() => setMode('all')}>{T('كل الحوادث', 'All incidents')}</button>
        <button type="button" className={`fchip${mode === 'open' ? ' on' : ''}`} aria-pressed={mode === 'open'} onClick={() => setMode('open')}>{T('المفتوحة فقط', 'Open only')}</button>
        <button type="button" className="fchip" aria-pressed={table} onClick={() => setTable(!table)}><Icon name={table ? 'signal' : 'reports'} size={13} />{table ? T('عرض كمخطط', 'Show chart') : T('عرض كجدول', 'Show table')}</button>
      </div>
      {total === 0 ? <p className="muted">{mode === 'open' ? T('لا توجد حوادث مفتوحة في هذا النطاق', 'No open incidents in this scope') : T('لا توجد حوادث في هذا النطاق', 'No incidents in this scope')}</p>
        : table ? (
          <table className="tbl viz-table">
            <thead><tr><th>{T('النوع', 'Type')}</th><th>{T('العدد', 'Count')}</th><th>{T('النسبة', 'Share')}</th></tr></thead>
            <tbody>{slices.map((x) => <tr key={x.key}><td>{x.label}</td><td><Ltr>{x.n}</Ltr></td><td><Ltr>{Math.round((x.n / total) * 100)}%</Ltr></td></tr>)}
              <tr><td><strong>{T('المجموع', 'Total')}</strong></td><td><strong><Ltr>{total}</Ltr></strong></td><td><Ltr>100%</Ltr></td></tr></tbody>
          </table>
        ) : (
          <div className="donut-body">
            <div className="donut-plot">
              <svg viewBox="0 0 180 180" role="img" aria-label={T(`${total} حادثة حسب النوع`, `${total} incidents by type`)}>
                <g transform="rotate(-90 90 90)">
                  {segs.map((x) => (
                    <circle key={x.key} cx="90" cy="90" r={R} fill="none" stroke={x.color} strokeWidth={hover === x.key ? W + 6 : W}
                      strokeDasharray={`${x.len} ${C - x.len}`} strokeDashoffset={-x.off} opacity={hover && hover !== x.key ? 0.35 : 1}
                      onMouseEnter={() => setHover(x.key)} onMouseLeave={() => setHover(null)} style={{ cursor: 'pointer', transition: 'opacity .15s, stroke-width .15s' }}>
                      <title>{`${x.label}: ${x.n}`}</title>
                    </circle>
                  ))}
                </g>
                <text x="90" y="86" textAnchor="middle" className="donut-total">{hov ? hov.n : total}</text>
                <text x="90" y="106" textAnchor="middle" className="donut-cap">{hov ? hov.label : mode === 'open' ? T('حادثة مفتوحة', 'open incidents') : T('حادثة', 'incidents')}</text>
              </svg>
              {hov && <div className="viz-tip" role="status"><i style={{ background: hov.color }} />{hov.label}: <strong><Ltr>{hov.n}</Ltr></strong> · <Ltr>{Math.round((hov.n / total) * 100)}%</Ltr></div>}
            </div>
            <ul className="donut-legend">
              {slices.map((x) => (
                <li key={x.key} className={hover && hover !== x.key ? 'dim' : ''} onMouseEnter={() => setHover(x.key)} onMouseLeave={() => setHover(null)}>
                  <i style={{ background: x.color }} />
                  {x.key !== 'other' && <IncidentIcon category={x.key as EventCategory} size={14} />}
                  <span className="dl-name">{x.label}</span>
                  <span className="dl-n"><Ltr>{x.n}</Ltr></span>
                  <span className="dl-p"><Ltr>{Math.round((x.n / total) * 100)}%</Ltr></span>
                </li>
              ))}
            </ul>
          </div>
        )}
      <p className="fine">{T('حوادث الإكسبو ضمن النطاق المحدد', 'Expo incidents in the selected scope')} · <button type="button" className="elink" onClick={goTo}>{T('فتح صفحة الحوادث', 'Open the incidents page')}</button></p>
    </div>
  );
}
