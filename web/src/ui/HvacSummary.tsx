import { useUI } from '../state/store';
import { Icon } from './icons';
import type { IconName } from './icons';
import { Ltr } from './primitives';
import type { OperationalHvacRecommendation, OperationalTrend } from '../services/operationalHvac';

type T = (ar: string, en: string) => string;
type Tone = 'ok' | 'warn' | 'high' | 'off';

/** Plain-language verdict for each monitor-only status. */
function verdict(result: OperationalHvacRecommendation, T: T): { tone: Tone; icon: IconName; title: string; why: string } {
  const e = result.evaluation;
  const th = e.thresholds;
  switch (e.status) {
    case 'VENTILATION_RECOMMENDED':
      return e.reason_code === 'COMBINED_OBSERVED_TEMPERATURE_AND_CROWD_RISE'
        ? { tone: 'high', icon: 'hvac', title: T('يُنصح بتشغيل التهوية', 'Ventilation recommended'), why: T('الحرارة وعدد الأشخاص يرتفعان معاً.', 'Temperature and crowd are both rising.') }
        : { tone: 'high', icon: 'hvac', title: T('يُنصح بتشغيل التهوية', 'Ventilation recommended'), why: th ? T(`الحرارة وصلت ${th.reactive_temperature_c}° أو أكثر.`, `Temperature reached ${th.reactive_temperature_c}° or more.`) : T('الحرارة مرتفعة.', 'Temperature is high.') };
    case 'PREEMPTIVE_VENTILATION_RECOMMENDED':
      return { tone: 'warn', icon: 'hvac', title: T('تهوية استباقية', 'Pre-emptive ventilation'), why: T('عدد الأشخاص يزداد والحرارة ما زالت طبيعية.', 'The crowd is growing while temperature is still normal.') };
    case 'ANTICIPATED_VENTILATION_DEMAND':
      return { tone: 'warn', icon: 'crowd', title: T('قد تحتاج تهوية قريباً', 'Ventilation may be needed soon'), why: T('عدد الأشخاص يزداد والحرارة ما زالت طبيعية.', 'The crowd is growing while temperature is still normal.') };
    case 'NO_RECOMMENDATION':
      return { tone: 'ok', icon: 'check', title: T('لا حاجة للتهوية الآن', 'No ventilation needed now'), why: T('الحرارة وعدد الأشخاص ضمن الحدود الطبيعية.', 'Temperature and crowd are within normal limits.') };
    case 'POLICY_NOT_CONFIGURED':
      return { tone: 'warn', icon: 'lock', title: T('حدود التكييف غير معتمدة', 'HVAC limits not approved'), why: T('يجب اعتماد حدود الحرارة والزحام قبل إصدار أي توصية.', 'Temperature and crowd limits must be approved before any recommendation.') };
    default:
      return { tone: 'off', icon: 'info', title: T('لا يمكن التقييم الآن', 'Cannot evaluate right now'), why: T('بعض البيانات المطلوبة غير متوفرة:', 'Some required data is missing:') };
  }
}

/** Turn evidence issue codes into short reasons anyone can act on. */
function plainIssues(result: OperationalHvacRecommendation, T: T): string[] {
  const issues = new Set(result.evaluation.evidence_issues);
  const camera = result.evidence.ai_people.camera_id;
  const out: string[] = [];
  const aiMissing = ['AI_SNAPSHOT_MISSING', 'AI_PEOPLE_EVIDENCE_NOT_FRESH', 'AI_SNAPSHOT_STALE', 'AI_SNAPSHOT_INVALID'].some((code) => issues.has(code));
  if (aiMissing) out.push(T(`كاميرا عدّ الأشخاص${camera ? ` (${camera})` : ''} لا ترسل بيانات — شغّل «كاميرا 1».`, `The people-counting camera${camera ? ` (${camera})` : ''} is not sending data — start "Camera 1".`));
  if (issues.has('CPS_NODE_NOT_ONLINE')) out.push(T('حساس NODE-04 غير متصل.', 'Sensor NODE-04 is offline.'));
  if (['TEMPERATURE_NOT_FRESH', 'TEMPERATURE_STALE', 'CPS_SNAPSHOT_NOT_FRESH', 'CPS_SNAPSHOT_STALE'].some((code) => issues.has(code))) out.push(T('قراءة الحرارة قديمة.', 'The temperature reading is out of date.'));
  if (['TEMPERATURE_MISSING', 'TEMPERATURE_MISSING_OR_INVALID'].some((code) => issues.has(code))) out.push(T('لا توجد قراءة حرارة.', 'There is no temperature reading.'));
  if (issues.has('TEMPERATURE_NOT_NORMAL')) out.push(T('قراءة الحرارة غير مؤكدة.', 'The temperature reading is not confirmed.'));
  if (!aiMissing && issues.has('EVIDENCE_ZONE_CONFLICT')) out.push(T('الكاميرا والحساس ليسا في نفس المنطقة.', 'The camera and the sensor are not in the same zone.'));
  if (out.length === 0) result.evaluation.evidence_issues.forEach((code) => out.push(code));
  return out;
}

function TrendPill({ trend, unit, T }: { trend: OperationalTrend; unit: string; T: T }) {
  if (trend.direction === 'UNKNOWN' || trend.delta === null) return <span className="hvs-trend unknown">{T('الاتجاه يظهر بعد 5 دقائق', 'Trend shows after 5 minutes')}</span>;
  const delta = Math.abs(trend.delta) < 0.05 ? 0 : trend.delta;
  const arrow = delta > 0 ? '↑' : delta < 0 ? '↓' : '→';
  const word = delta > 0 ? T('يرتفع', 'Rising') : delta < 0 ? T('ينخفض', 'Falling') : T('مستقر', 'Steady');
  const amount = unit === '°' ? Math.abs(delta).toFixed(1) : String(Math.round(Math.abs(delta)));
  return <span className={`hvs-trend ${delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat'}`}>
    <Ltr>{arrow}</Ltr> {word}{delta !== 0 && <> <Ltr>{amount}{unit}</Ltr></>} {T('خلال 5 دقائق', 'in 5 min')}
  </span>;
}

/** Low-to-high temperature bar: green up to normal, amber to the ventilation limit, red beyond. */
function TemperatureScale({ value, normalMax, reactive, T }: { value: number; normalMax: number; reactive: number; T: T }) {
  const lo = Math.min(15, normalMax - 10);
  const hi = Math.max(35, reactive + 9);
  const pos = (v: number) => Math.min(100, Math.max(0, ((v - lo) / (hi - lo)) * 100));
  return <div className="hvs-scale" dir="ltr" aria-hidden="true">
    <div className="hvs-scale-bar">
      <span className="zone ok" style={{ left: 0, width: `${pos(normalMax)}%` }} />
      <span className="zone warn" style={{ left: `${pos(normalMax)}%`, width: `${pos(reactive) - pos(normalMax)}%` }} />
      <span className="zone high" style={{ left: `${pos(reactive)}%`, right: 0 }} />
      <span className="marker" style={{ left: `${pos(value)}%` }} />
    </div>
    <div className="hvs-scale-labels">
      <span style={{ left: `${pos(normalMax)}%` }}>{normalMax}°</span>
      <span style={{ left: `${pos(reactive)}%` }}>{reactive}°</span>
    </div>
    <div className="hvs-scale-key" dir="auto">
      <span><i className="ok" />{T('طبيعي', 'Normal')}</span>
      <span><i className="warn" />{T('قريب من الحد', 'Near limit')}</span>
      <span><i className="high" />{T('تهوية', 'Ventilate')}</span>
    </div>
  </div>;
}

/** The visual summary: verdict, temperature and people at a glance. */
export function HvacSummary({ result, updatedAt }: { result: OperationalHvacRecommendation; updatedAt: string }) {
  const { T } = useUI();
  const v = verdict(result, T);
  const th = result.evaluation.thresholds;
  const temp = result.evidence.cps.temperature.value_c;
  const ai = result.evidence.ai_people;
  const people = ai.people_smoothed ?? ai.people_count;
  const issues = result.evaluation.status === 'INSUFFICIENT_EVIDENCE' ? plainIssues(result, T) : [];
  const tempTone = temp === null || !th ? '' : temp >= th.reactive_temperature_c ? 'high' : temp > th.normal_temperature_max_c ? 'warn' : 'ok';

  return <div className="hvs">
    <div className={`hvs-verdict ${v.tone}`}>
      <span className="hvs-verdict-icon"><Icon name={v.icon} size={26} /></span>
      <div>
        <strong>{v.title}</strong>
        <p>{v.why}</p>
        {issues.length > 0 && <ul>{issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>}
      </div>
    </div>

    <div className="hvs-tiles">
      <div className={`hvs-tile ${tempTone}`}>
        <div className="hvs-tile-head"><Icon name="thermo" size={16} />{T('الحرارة', 'Temperature')}<small><Ltr>NODE-04</Ltr></small></div>
        <div className="hvs-big"><Ltr>{temp === null ? '—' : `${temp.toFixed(1)}°C`}</Ltr></div>
        <TrendPill trend={result.evaluation.temperature_trend} unit="°" T={T} />
        {temp !== null && th && <TemperatureScale value={temp} normalMax={th.normal_temperature_max_c} reactive={th.reactive_temperature_c} T={T} />}
      </div>
      <div className="hvs-tile">
        <div className="hvs-tile-head"><Icon name="crowd" size={16} />{T('عدد الأشخاص', 'People')}<small><Ltr>{ai.camera_id ?? '—'}</Ltr></small></div>
        <div className="hvs-big"><Ltr>{people === null ? '—' : people}</Ltr></div>
        {people === null
          ? <span className="hvs-trend unknown">{T('الكاميرا لا تعمل', 'Camera not running')}</span>
          : <TrendPill trend={result.evaluation.crowd_trend} unit="" T={T} />}
        {th && <p className="hvs-hint">{T(`زيادة ${th.minimum_crowd_increase} أشخاص أو أكثر تعني ازدحاماً متزايداً.`, `${th.minimum_crowd_increase} or more extra people means a growing crowd.`)}</p>}
      </div>
    </div>

    <p className="hvs-foot">
      <Icon name="info" size={14} />
      {T('توصية فقط — لا يرسل أي أمر للمروحة.', 'Recommendation only — never sends a command to the fan.')}
      {' '}{T('المنطقة', 'Zone')} <Ltr>{result.evaluation.zone_id ?? '—'}</Ltr> · {T('آخر تحديث', 'Updated')} <Ltr>{updatedAt}</Ltr>
    </p>
  </div>;
}
