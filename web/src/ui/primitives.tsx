import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { useStore, useUI } from '../state/store';
import type { EntityRef } from '../state/store';
import { fmtDate, fmtTime } from '../model/config';
import type { CrowdStatus, DeviceState, Severity } from '../model/types';
import { LABELS } from './labels';
import { Icon } from './icons';
import type { IconName } from './icons';
import type { EmpStatus, AlertStatus, SensorHealth } from '../model/selectors';

/** IDs, times and units keep their own left-to-right direction inside Arabic text. */
export const Ltr = ({ children }: { children: ReactNode }) => <bdi dir="ltr" className="ltr">{children}</bdi>;
export const Time = ({ t, date, short }: { t: number | null | undefined; date?: boolean; short?: boolean }) =>
  t == null ? <span className="muted">—</span> : <Ltr>{date ? `${fmtDate(t)} ` : ''}{fmtTime(t, !short)}</Ltr>;

type Tone = 'ok' | 'warn' | 'crit' | 'off' | 'info' | 'brand' | 'neutral' | 'high';

export function Chip({ tone, children, icon, title, pulse, dashed }: { tone: Tone; children: ReactNode; icon?: ReactNode; title?: string; pulse?: boolean; dashed?: boolean }) {
  return <span className={`chip t-${tone}${pulse ? ' pulse' : ''}${dashed ? ' dashed' : ''}`} title={title}>{icon}{children}</span>;
}

// Shape + label + color for each device state, so color is never the only cue.
function StateGlyph({ state }: { state: DeviceState }) {
  if (state === 'normal') return <svg className="glyph" viewBox="0 0 10 10" aria-hidden="true"><circle cx="5" cy="5" r="3.6" fill="currentColor" /></svg>;
  if (state === 'warning') return <svg className="glyph" viewBox="0 0 10 10" aria-hidden="true"><path d="M5 1 9.3 8.8H.7z" fill="currentColor" /></svg>;
  if (state === 'critical') return <svg className="glyph" viewBox="0 0 10 10" aria-hidden="true"><path d="M5 .6 9.4 5 5 9.4.6 5z" fill="currentColor" /></svg>;
  return <svg className="glyph" viewBox="0 0 10 10" aria-hidden="true"><circle cx="5" cy="5" r="3.6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeDasharray="2 1.4" /><path d="M1.5 8.5 8.5 1.5" stroke="currentColor" strokeWidth="1.3" /></svg>;
}
const STATE_TONE: Record<DeviceState, Tone> = { normal: 'ok', warning: 'warn', critical: 'crit', offline: 'off' };
export function StateBadge({ state, label }: { state: DeviceState; label?: string }) {
  const { tl } = useUI();
  return <Chip tone={STATE_TONE[state]} icon={<StateGlyph state={state} />} pulse={state === 'critical'} dashed={state === 'offline'}>{label ?? tl(LABELS.deviceState[state])}</Chip>;
}

const SEV_TONE: Record<Severity, Tone> = { low: 'info', medium: 'warn', high: 'high', critical: 'crit' };
export function SevBadge({ sev }: { sev: Severity }) {
  const { tl, T } = useUI();
  const bars = { low: 1, medium: 2, high: 3, critical: 4 }[sev];
  return (
    <Chip tone={SEV_TONE[sev]} pulse={sev === 'critical'} title={T('الخطورة', 'Severity')}
      icon={<svg className="glyph sev" viewBox="0 0 16 10" aria-hidden="true">{[0, 1, 2, 3].map((k) => <rect key={k} x={k * 4} y={8 - k * 2.4} width="3" height={2 + k * 2.4} rx=".6" fill="currentColor" opacity={k < bars ? 1 : 0.22} />)}</svg>}>
      {tl(LABELS.severity[sev])}
    </Chip>
  );
}
export function CrowdBadge({ status }: { status: CrowdStatus | null }) {
  const { tl, T } = useUI();
  if (!status) return <Chip tone="neutral">{T('لا توجد بيانات', 'No data')}</Chip>;
  const tone: Tone = status === 'crowded' ? 'crit' : status === 'medium' ? 'warn' : 'ok';
  return <Chip tone={tone} pulse={status === 'crowded'} icon={<Icon name="crowd" size={14} />}>{tl(LABELS.crowd[status])}</Chip>;
}
const EMP_TONE: Record<EmpStatus, Tone> = { available: 'ok', responding: 'high', on_task: 'info', unseen: 'off', off_duty: 'neutral' };
export function EmpStatusBadge({ status }: { status: EmpStatus }) {
  const { tl } = useUI();
  return <Chip tone={EMP_TONE[status]} dashed={status === 'unseen'}>{tl(LABELS.empStatus[status])}</Chip>;
}
const ALERT_TONE: Record<AlertStatus, Tone> = { active: 'crit', in_response: 'high', resolved: 'ok', cleared: 'neutral' };
export function AlertStatusBadge({ status }: { status: AlertStatus }) {
  const { tl, T } = useUI();
  return <Chip tone={ALERT_TONE[status]} title={T('حالة التنبيه', 'Alert status')}>{tl(LABELS.alertStatus[status])}</Chip>;
}
export function IncidentStatusBadge({ status }: { status: keyof typeof LABELS.incidentStatus }) {
  const { tl, T } = useUI();
  const tone: Tone = status === 'open' ? 'crit' : status === 'closed' ? 'neutral' : status === 'resolved' ? 'ok' : 'high';
  return <Chip tone={tone} title={T('حالة الحادثة', 'Incident status')}>{tl(LABELS.incidentStatus[status])}</Chip>;
}
export function HealthBadge({ h }: { h: SensorHealth }) {
  const { tl } = useUI();
  return <StateBadge state={h === 'online' ? 'normal' : 'offline'} label={tl(LABELS.sensorHealth[h])} />;
}
export function SimTag({ children }: { children?: ReactNode }) {
  const { T } = useUI();
  return <span className="simtag" title={T('بيانات محاكاة للنموذج الأولي', 'Prototype simulated data')}>{children ?? T('محاكاة', 'Simulated')}</span>;
}

export function Card({ title, icon, actions, children, className, sub, id }: {
  title?: ReactNode; icon?: IconName; actions?: ReactNode; children: ReactNode; className?: string; sub?: ReactNode; id?: string;
}) {
  return (
    <section className={`card ${className ?? ''}`} aria-labelledby={id}>
      {(title || actions) && (
        <header className="card-h">
          <div className="card-t">
            {icon && <Icon name={icon} size={16} />}
            <h2 id={id}>{title}</h2>
            {sub && <span className="card-sub">{sub}</span>}
          </div>
          {actions && <div className="card-a">{actions}</div>}
        </header>
      )}
      <div className="card-b">{children}</div>
    </section>
  );
}

export function Btn({ children, onClick, kind = 'default', disabled, icon, title, type = 'button', small, ariaLabel }: {
  children?: ReactNode; onClick?: () => void; kind?: 'default' | 'primary' | 'ghost' | 'danger'; disabled?: boolean; icon?: IconName;
  title?: string; type?: 'button' | 'submit'; small?: boolean; ariaLabel?: string;
}) {
  return (
    <button type={type} className={`btn b-${kind}${small ? ' sm' : ''}`} onClick={onClick} disabled={disabled} title={title} aria-label={ariaLabel}>
      {icon && <Icon name={icon} size={small ? 14 : 16} />}{children}
    </button>
  );
}

/** A link to an entity; opens its details drawer without leaving the current view. */
export function ELink({ r, children }: { r: EntityRef; children?: ReactNode }) {
  const { openDrawer, tl } = useUI();
  const { s } = useStore();
  const cam = r.kind === 'camera' ? s.cameras.find((c) => c.id === r.id) : undefined;
  return <button type="button" className="elink" onClick={(e: { stopPropagation(): void }) => { e.stopPropagation(); openDrawer(r); }}>{children ?? (cam ? tl(cam.label) : <Ltr>{r.id}</Ltr>)}</button>;
}

export function Tabs<T extends string>({ tabs, value, onChange, label }: { tabs: { id: T; label: ReactNode; count?: number }[]; value: T; onChange: (t: T) => void; label: string }) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map((t) => (
        <button key={t.id} role="tab" type="button" aria-selected={value === t.id} className={value === t.id ? 'on' : ''} onClick={() => onChange(t.id)}>
          {t.label}{t.count != null && <span className="tab-n"><Ltr>{t.count}</Ltr></span>}
        </button>
      ))}
    </div>
  );
}

export function Field({ k, children }: { k: ReactNode; children: ReactNode }) {
  return <div className="field"><dt>{k}</dt><dd>{children}</dd></div>;
}

export function Empty({ icon = 'check', title, children }: { icon?: IconName; title: ReactNode; children?: ReactNode }) {
  return <div className="empty"><Icon name={icon} size={22} /><strong>{title}</strong>{children && <p>{children}</p>}</div>;
}

export function Kpi({ label, value, sub, tone, onClick, scope, glyph, art }: {
  label: ReactNode; value: ReactNode; sub?: ReactNode; tone?: Tone; onClick?: () => void; scope?: ReactNode; glyph?: IconName; art?: ReactNode;
}) {
  const inner = (
    <>
      {art && <span className="kpi-art" aria-hidden="true">{art}</span>}
      <div className="kpi-top"><span className="kpi-l">{label}</span>{glyph && <Icon name={glyph} size={16} />}</div>
      <div className="kpi-v"><Ltr>{value}</Ltr></div>
      {sub && <div className="kpi-s">{sub}</div>}
      {scope && <div className="kpi-scope">{scope}</div>}
    </>
  );
  return onClick
    ? <button type="button" className={`kpi t-${tone ?? 'neutral'} clickable${art ? ' has-art' : ''}`} onClick={onClick}>{inner}</button>
    : <div className={`kpi t-${tone ?? 'neutral'}${art ? ' has-art' : ''}`}>{inner}</div>;
}

export function Restricted({ what }: { what?: ReactNode }) {
  const { T } = useUI();
  return (
    <Empty icon="lock" title={T('غير متاح لهذا الدور', 'Not available for this role')}>
      {what ?? T('هذا القسم خارج صلاحيات الدور الحالي في مصفوفة النموذج الأولي.', 'This section is outside the current role in the prototype permission matrix.')}
    </Empty>
  );
}

/** When a detail view opens (key changes), scroll it to the top of the page and give it keyboard focus. */
export function useFocusOnOpen(key: string | null | undefined) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!key || !el) return;
    el.scrollIntoView({ block: 'start' });
    el.focus({ preventScroll: true });
  }, [key]);
  return ref;
}
