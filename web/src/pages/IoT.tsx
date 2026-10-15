import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { useStore, useUI } from '../state/store';
import { droneZone } from '../model/selectors';
import { CONFIG } from '../model/config';
import { can } from '../services/permissions';
import { LABELS } from '../ui/labels';
import { Btn, Card, Chip, Empty, Kpi, Ltr, Restricted, SimTag, StateBadge, Tabs } from '../ui/primitives';
import { TempLimitsControl } from '../ui/bme';
import { HeartbeatStrip } from '../ui/charts';
import { ExpoMap } from '../ui/ExpoMap';
import { Icon } from '../ui/icons';
import { fetchCpsHeartbeatHistory, fetchCpsNodeState, hasFullHeartbeatWindowCoverage, latestNode04Readings, networkObservationAge, relayReportAge } from '../services/cps';
import type { CpsHeartbeatHistory, CpsNodeState, CpsReading, CpsRelayReportAge } from '../services/cps';
import { mapTargetForCpsLocation } from '../services/cpsLocationMap';
import { operationalCpsMapDevice } from '../services/cpsOperationalMap';
import { fetchRiyadhWeather, riyadhWeatherVisual } from '../services/weather';
import type { RiyadhWeather, RiyadhWeatherVisual } from '../services/weather';
import { fetchOperationalHvacRecommendation } from '../services/operationalHvac';
import type { OperationalHvacRecommendation } from '../services/operationalHvac';
import { verifiedCpsPhysicalNodeCount } from '../services/operationalOverview';
import { SimulationHall, visitorDisplayCount } from '../ui/SimulationHall';
import { HvacSummary } from '../ui/HvacSummary';
import { createInitialTwinState, simulatedFreshness, simulationEvaluationRequest } from '../model/twin';
import { canApplySimulationRecommendation, twinReducer } from '../model/twinReducer';
import { evaluateSimulationHvac } from '../services/simulationHvac';

type ThreatKind = 'pistol' | 'machine_gun' | 'bomb' | 'none';

type GunshotResult = {
  kind?: ThreatKind;
  threat?: boolean;
  gunshot: boolean;
  confidence: number;
  label_ar: string;
  label_en: string;
  reason_ar: string;
  reason_en: string;
  model?: string;
};

function threatKind(r: GunshotResult): ThreatKind {
  if (r.kind === 'pistol' || r.kind === 'machine_gun' || r.kind === 'bomb' || r.kind === 'none') return r.kind;
  return r.gunshot || r.threat ? 'pistol' : 'none';
}

function isThreat(r: GunshotResult): boolean {
  return threatKind(r) !== 'none';
}

type MicPhase = 'idle' | 'listening' | 'analyzing' | 'done';

const LISTEN_MS = 5000;

function pickMime(): string {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
  for (const t of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) return t;
  }
  return '';
}

/** Shared intact by the legacy page and the isolated CPS workspace. Capture begins only after a user click. */
export function GunshotMic() {
  const { T, ui } = useUI();
  const ar = ui.lang === 'ar';
  const [phase, setPhase] = useState<MicPhase>('idle');
  const [result, setResult] = useState<GunshotResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const recRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const stopTimerRef = useRef<number | null>(null);
  const tickRef = useRef<number | null>(null);
  const startedAtRef = useRef(0);
  const analyzingRef = useRef(false);

  function cleanupStream() {
    if (stopTimerRef.current != null) { window.clearTimeout(stopTimerRef.current); stopTimerRef.current = null; }
    if (tickRef.current != null) { window.clearInterval(tickRef.current); tickRef.current = null; }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recRef.current = null;
  }

  useEffect(() => () => cleanupStream(), []);

  async function analyze(blob: Blob) {
    if (analyzingRef.current) return;
    analyzingRef.current = true;
    setPhase('analyzing');
    setError(null);
    try {
      const form = new FormData();
      const ext = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm';
      form.append('audio', blob, `clip.${ext}`);
      const r = await fetch('/api/gunshot', { method: 'POST', body: form });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(typeof data?.detail === 'string' ? data.detail : T('فشل التحليل', 'Analysis failed'));
      setResult(data as GunshotResult);
      setPhase('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase('idle');
    } finally {
      analyzingRef.current = false;
    }
  }

  function finishRecording() {
    const rec = recRef.current;
    if (!rec || rec.state === 'inactive') return;
    rec.onstop = () => {
      const type = rec.mimeType || 'audio/webm';
      const blob = new Blob(chunksRef.current, { type });
      chunksRef.current = [];
      cleanupStream();
      if (blob.size < 200) {
        setError(T('التسجيل قصير جداً — أعد المحاولة', 'Recording too short — try again'));
        setPhase('idle');
        return;
      }
      void analyze(blob);
    };
    try { rec.stop(); } catch { cleanupStream(); setPhase('idle'); }
  }

  async function startListening() {
    setError(null);
    setResult(null);
    setElapsed(0);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError(T('المتصفح لا يدعم الميكروفون', 'Browser does not support the microphone'));
      return;
    }
    try {
      // raw sound: the browser's voice-call processing (noise suppression, echo cancellation, auto gain)
      // treats a gunshot's short loud burst as noise and flattens it
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { noiseSuppression: false, echoCancellation: false, autoGainControl: false } });
      streamRef.current = stream;
      chunksRef.current = [];
      const mime = pickMime();
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      recRef.current = rec;
      rec.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
      rec.start(200);
      startedAtRef.current = Date.now();
      setPhase('listening');
      tickRef.current = window.setInterval(() => {
        setElapsed(Math.min(LISTEN_MS, Date.now() - startedAtRef.current));
      }, 100);
      stopTimerRef.current = window.setTimeout(() => finishRecording(), LISTEN_MS);
    } catch {
      cleanupStream();
      setError(T('لم يُسمح بالوصول للميكروفون', 'Microphone permission denied'));
      setPhase('idle');
    }
  }

  function onMicClick() {
    if (phase === 'listening') { finishRecording(); return; }
    if (phase === 'analyzing') return;
    void startListening();
  }

  const pct = Math.round((elapsed / LISTEN_MS) * 100);
  const statusText =
    phase === 'listening' ? T('يستمع… اضغط للإيقاف والتحليل', 'Listening… tap to stop & analyze')
      : phase === 'analyzing' ? T('يحلل الصوت عبر OpenRouter…', 'Analyzing audio via OpenRouter…')
        : phase === 'done' && result
          ? (ar ? result.label_ar : result.label_en)
          : T('اضغط على المايك للاستماع', 'Tap the mic to listen');

  const kind = result ? threatKind(result) : null;
  const threat = result ? isThreat(result) : false;
  const kindHint = T('مسدس · رشاش · قنبلة', 'Pistol · machine gun · bomb');

  return (
    <Card
      title={T('مايك كشف التهديدات الصوتية', 'Acoustic threat mic')}
      icon="mic"
      sub={T('يسجّل من الميكروفون ويصنّف: مسدس، رشاش، أو قنبلة عبر OpenRouter', 'Records from the mic and classifies pistol, machine gun, or bomb via OpenRouter')}
      className="gunshot-card"
    >
      <div className="gunshot-mic">
        <button
          type="button"
          className={`gunshot-btn${phase === 'listening' ? ' listening' : ''}${phase === 'analyzing' ? ' busy' : ''}${threat ? ` hit kind-${kind}` : ''}${result && !threat ? ' clear' : ''}`}
          onClick={onMicClick}
          disabled={phase === 'analyzing'}
          aria-label={T('مايك كشف المسدس والرشاش والقنبلة', 'Mic for pistol, machine gun and bomb detection')}
        >
          <Icon name="mic" size={36} />
          {phase === 'listening' && <span className="gunshot-ring" aria-hidden="true" />}
        </button>
        <div className="gunshot-meta">
          <p className="gunshot-status">{statusText}</p>
          <p className="fine">{kindHint}</p>
          {phase === 'listening' && (
            <div className="gunshot-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
              <span style={{ width: `${pct}%` }} />
            </div>
          )}
          {phase === 'analyzing' && <p className="fine">{T('قد يستغرق بضع ثوانٍ', 'This may take a few seconds')}</p>}
          {error && <p className="warnline">{error}</p>}
          {result && phase === 'done' && (
            <div className="gunshot-result">
              <Chip tone={threat ? 'crit' : 'ok'} pulse={threat}>
                {ar ? result.label_ar : result.label_en}
              </Chip>
              {kind && kind !== 'none' && (
                <Chip tone="high">
                  {kind === 'pistol' ? T('مسدس', 'Pistol')
                    : kind === 'machine_gun' ? T('رشاش', 'Machine gun')
                      : T('قنبلة', 'Bomb')}
                </Chip>
              )}
              <span className="muted"><Ltr>{Math.round(result.confidence * 100)}%</Ltr> {T('ثقة', 'confidence')}</span>
              <p className="fine">{ar ? result.reason_ar : result.reason_en}</p>
              <button type="button" className="btn sm" onClick={() => void startListening()}>{T('استمع مرة أخرى', 'Listen again')}</button>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

export function IoT() {
  const { T, ui, set } = useUI();
  if (!can(ui.role, 'view_devices')) return <div className="page"><Restricted /></div>;
  return (
    <div className="page">
      <Tabs label={T('الأنظمة المادية والرقمية', 'Physical and digital systems')} value={ui.iotTab} onChange={(v) => set({ iotTab: v })} tabs={[
        { id: 'overview', label: T('نظرة عامة', 'Overview') },
        { id: 'ot', label: T('التشغيل التقني', 'OT') },
        { id: 'iot', label: T('إنترنت الأشياء', 'IoT') },
        { id: 'noc', label: T('مركز عمليات الشبكة', 'NOC') },
      ]} />
      {ui.iotTab === 'overview' && <SystemsOverview />}
      {ui.iotTab === 'ot' && <OtWorkspace />}
      {ui.iotTab === 'iot' && <IotWorkspace />}
      {ui.iotTab === 'noc' && <NocUnavailable />}
    </div>
  );
}

function SystemsOverview() {
  const { T, set } = useUI();
  const cps = useCpsNodeState();
  const physicalNodes = verifiedCpsPhysicalNodeCount(cps.state);
  const cpsSummary = cps.loading
    ? T('جارٍ التحميل', 'Loading')
    : cps.state?.connection_status ?? T('غير متاح', 'Unavailable');
  const cpsSub = cps.state
    ? <><Ltr>{cps.state.node_id}</Ltr> · <Ltr>{cps.state.status}</Ltr></>
    : cps.error ?? T('لم يُربط مصدر بيانات', 'No data source connected');
  return <>
    <div className="kpis iot-k">
      <Kpi label={T('العقد المادية CPS', 'Physical CPS nodes')} glyph="router" value={physicalNodes ?? T('غير متاح', 'Unavailable')}
        sub={cps.state ? <><Ltr>{cps.state.node_id}</Ltr> · <Ltr>{cps.state.connection_status}</Ltr></> : T('لا توجد بيانات CPS موثقة', 'No verified CPS data')} tone={cps.state?.connection_status === 'ONLINE' ? 'ok' : cps.state?.connection_status === 'STALE' ? 'warn' : cps.state?.connection_status === 'OFFLINE' ? 'off' : 'neutral'} />
      <Kpi label={T('كاميرات التشغيل', 'Operational cameras')} glyph="cameras" value={T('غير مدعوم', 'Unsupported')} sub={T('لا توجد واجهة جرد كاميرات موثقة', 'No verified camera-inventory source')} tone="neutral" />
      <Kpi label={T('الطائرات التشغيلية', 'Operational drones')} glyph="drone" value={T('غير مدعوم', 'Unsupported')} sub={T('لا توجد واجهة جرد طائرات موثقة', 'No verified drone-inventory source')} tone="neutral" />
      <Kpi label={T('حالة تكامل CPS', 'CPS integration')} glyph="signal" value={cpsSummary} sub={cpsSub} tone={cps.state?.connection_status === 'ONLINE' ? 'ok' : cps.state ? 'warn' : 'neutral'} />
    </div>
    <GunshotMic />
    <div className="grid2">
      <CpsNodeOverview cps={cps} />
      <RiyadhWeatherCard />
      <CpsCoverageCard cps={cps} />
      <Card title={T('كاميرات وطائرات راصد', 'RASID cameras and drones')} icon="iot" actions={<Btn small kind="primary" icon="cameras" onClick={() => set({ iotTab: 'iot' })}>{T('فتح IoT', 'Open IoT')}</Btn>}>
        <span className="sr">{T('اختصار لمسارات كاميرات وطائرات راصد الحالية', 'Shortcut to existing RASID camera and drone workflows')}</span>
      </Card>
    </div>
  </>;
}

type CpsLoad = { state: CpsNodeState | null; loading: boolean; error: string | null; refresh: () => void };
type CpsHeartbeatLoad = { history: CpsHeartbeatHistory | null; loading: boolean; error: string | null; refresh: () => void };
type WeatherLoad = { weather: RiyadhWeather | null; loading: boolean; error: boolean; refresh: () => void };
type OperationalHvacLoad = { recommendation: OperationalHvacRecommendation | null; loading: boolean; error: string | null; refresh: () => void };

function useCpsNodeState(): CpsLoad {
  const [state, setState] = useState<CpsNodeState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void fetchCpsNodeState(controller.signal)
      .then((next) => setState(next))
      .catch((err: unknown) => {
        if ((err as { name?: string })?.name !== 'AbortError') {
          setState(null);
          setError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);
  useEffect(() => refresh(), [refresh]);
  return { state, loading, error, refresh };
}

function useCpsHeartbeatHistory(): CpsHeartbeatLoad {
  const [history, setHistory] = useState<CpsHeartbeatHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void fetchCpsHeartbeatHistory(controller.signal)
      .then(setHistory)
      .catch((err: unknown) => {
        if ((err as { name?: string })?.name !== 'AbortError') {
          setHistory(null);
          setError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);
  useEffect(() => refresh(), [refresh]);
  return { history, loading, error, refresh };
}

/** One explicit page-load/read action only: no client polling or recommendation history. */
function useOperationalHvacRecommendation(): OperationalHvacLoad {
  const [recommendation, setRecommendation] = useState<OperationalHvacRecommendation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void fetchOperationalHvacRecommendation(controller.signal)
      .then(setRecommendation)
      .catch((err: unknown) => {
        if ((err as { name?: string })?.name !== 'AbortError') {
          setRecommendation(null);
          setError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);
  useEffect(() => refresh(), [refresh]);
  return { recommendation, loading, error, refresh };
}

function useRiyadhWeather(): WeatherLoad {
  const [weather, setWeather] = useState<RiyadhWeather | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const inFlight = useRef(false);
  const refresh = useCallback(() => {
    if (inFlight.current) return () => undefined;
    inFlight.current = true;
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    void fetchRiyadhWeather(controller.signal)
      .then((next) => setWeather(next))
      .catch((err: unknown) => {
        if ((err as { name?: string })?.name !== 'AbortError') {
          setWeather(null);
          setError(true);
        }
      })
      .finally(() => { inFlight.current = false; setLoading(false); });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const cancel = refresh();
    const timer = window.setInterval(() => { void refresh(); }, 10 * 60_000);
    return () => { cancel(); window.clearInterval(timer); };
  }, [refresh]);
  return { weather, loading, error, refresh };
}

function riyadhTime(value: string): string {
  const date = new Date(`${value}+03:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString('en-GB', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

function weatherValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function weatherConditionLabel(visual: RiyadhWeatherVisual, T: (ar: string, en: string) => string): string {
  switch (visual) {
    case 'sunny': return T('مشمس', 'Sunny');
    case 'partly-cloudy': return T('غائم جزئياً', 'Partly cloudy');
    case 'cloudy': return T('غائم', 'Cloudy');
    case 'rainy': return T('ممطر', 'Rainy');
    case 'clear-night': return T('صحو ليلاً', 'Clear night');
    case 'cloudy-night': return T('غائم ليلاً', 'Cloudy night');
    default: return T('الحالة غير متاحة', 'Condition unavailable');
  }
}

function WeatherGlyph({ visual }: { visual: RiyadhWeatherVisual }) {
  return <svg className="weather-glyph" viewBox="0 0 96 72" aria-hidden="true" focusable="false">
    {(visual === 'sunny' || visual === 'partly-cloudy') && <g className="weather-sun">
      <circle cx="38" cy="31" r="12" />
      <path d="M38 5v7M38 50v7M12 31h7M57 31h7M20 13l5 5M51 44l5 5M56 13l-5 5M25 44l-5 5" />
    </g>}
    {(visual === 'clear-night' || visual === 'cloudy-night') && <path className="weather-moon" d="M53 10a22 22 0 1 0 22 30A25 25 0 1 1 53 10Z" />}
    {(visual === 'partly-cloudy' || visual === 'cloudy' || visual === 'cloudy-night' || visual === 'rainy') && <path className="weather-cloud" d="M23 57h46a13 13 0 0 0 1-26 19 19 0 0 0-36 4A11 11 0 0 0 23 57Z" />}
    {visual === 'rainy' && <g className="weather-rain"><path d="M35 61l-3 8M48 61l-3 8M61 61l-3 8" /></g>}
    {visual === 'unavailable' && <g className="weather-unavailable"><circle cx="48" cy="35" r="20" /><path d="m34 49 28-28" /></g>}
  </svg>;
}

function RiyadhWeatherCard() {
  const { T } = useUI();
  const weather = useRiyadhWeather();
  if (weather.loading) {
    return <Card title={T('طقس الرياض', 'Riyadh weather')} icon="thermo" sub="Open-Meteo"><Empty icon="thermo" title={T('جارٍ تحميل الطقس', 'Loading weather')} /></Card>;
  }
  if (!weather.weather) {
    return <Card title={T('طقس الرياض', 'Riyadh weather')} icon="thermo" sub="Open-Meteo" actions={<Btn small onClick={weather.refresh}>{T('إعادة المحاولة', 'Retry')}</Btn>}>
      <Empty icon="thermo" title={T('الطقس غير متاح', 'Weather unavailable')}><p className="fine">{weather.error ? T('تعذر الوصول إلى Open-Meteo.', 'Open-Meteo could not be reached.') : null}</p></Empty>
    </Card>;
  }
  const visual = riyadhWeatherVisual(weather.weather.weatherCode, weather.weather.isDay);
  const condition = weatherConditionLabel(visual, T);
  return <Card title={T('طقس الرياض', 'Riyadh weather')} icon="thermo" sub="Open-Meteo" actions={<Btn small onClick={weather.refresh}>{T('تحديث', 'Refresh')}</Btn>}>
    <div className={`weather-hero weather-${visual}`} role="img" aria-label={T(`طقس الرياض: ${condition}`, `Riyadh weather: ${condition}`)}>
      <WeatherGlyph visual={visual} />
      <div><strong>{condition}</strong><small>{T('الحالة من Open-Meteo', 'Condition from Open-Meteo')}</small></div>
    </div>
    <div className="weather-reading-grid">
      <div className="weather-reading"><span>{T('الحرارة', 'Temperature')}</span><strong><Ltr>{weatherValue(weather.weather.temperature)} °C</Ltr></strong></div>
      <div className="weather-reading"><span>{T('الرطوبة', 'Humidity')}</span><strong><Ltr>{weatherValue(weather.weather.humidity)}%</Ltr></strong></div>
    </div>
    <p className="fine">{T('آخر تحديث: ', 'Last update: ')}<Ltr>{riyadhTime(weather.weather.observedAt)}</Ltr></p>
  </Card>;
}

function CpsCoverageCard({ cps }: { cps: CpsLoad }) {
  const { T } = useUI();
  if (cps.loading) return <Card title={T('تغطية حساسات المنشأة', 'Facility sensor coverage')} icon="pin"><Empty icon="pin" title={T('جارٍ التحقق من تغطية CPS', 'Checking CPS coverage')} /></Card>;
  if (!cps.state) return <Card title={T('تغطية حساسات المنشأة', 'Facility sensor coverage')} icon="pin"><Empty icon="pin" title={T('التغطية غير متاحة', 'Coverage unavailable')} /></Card>;
  return <Card title={T('تغطية حساسات المنشأة', 'Facility sensor coverage')} icon="pin" sub={T('تغطية تم التحقق منها من CPS', 'Verified CPS coverage')}>
    <div className="coverage-node">
      <Icon name="router" size={18} />
      <div><strong><Ltr>{cps.state.node_id}</Ltr></strong><small>{T('عقدة CPS موثقة', 'Verified CPS node')}</small></div>
      <span className="coverage-location"><Ltr>{cps.state.location_id ?? '—'}</Ltr></span>
    </div>
  </Card>;
}

function latestReading(readings: CpsReading[], sensorType: string): CpsReading | undefined {
  return readings.find((reading) => reading.sensor_type.trim().toLowerCase() === sensorType);
}

/** CPS timestamps and all values in this OT surface use Western digits in both languages. */
function cpsTime(value: string | null, lang: 'ar' | 'en'): string {
  if (!value) return lang === 'ar' ? 'غير متاح' : 'Unavailable';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString('en-GB', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

function cpsAge(value: string | null): string | null {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return null;
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h`;
}

function receiptAge(receivedAt: string, asOf: string): string | null {
  const receipt = Date.parse(receivedAt);
  const snapshot = Date.parse(asOf);
  if (!Number.isFinite(receipt) || !Number.isFinite(snapshot) || receipt > snapshot) return null;
  const ageAtSnapshot = snapshot - receipt;
  const snapshotAge = Math.max(0, Date.now() - snapshot);
  const seconds = Math.floor((ageAtSnapshot + snapshotAge) / 1000);
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h`;
}

function CpsMetric({ label, reading, T }: { label: string; reading?: CpsReading; T: (ar: string, en: string) => string }) {
  return <div className="cps-reading">
    <span>{label}</span>
    {reading
      ? <strong><Ltr>{String(reading.value)} {reading.unit}</Ltr></strong>
      : <small className="muted">{T('غير متاح', 'Unavailable')}</small>}
  </div>;
}

function CpsNodeOverview({ cps }: { cps: CpsLoad }) {
  const { T, ui } = useUI();
  if (cps.loading) {
    return <Card title={T('ملخص حساسات CPS', 'CPS sensor summary')} icon="sensor" sub={T('NODE-04', 'NODE-04')}><Empty icon="sensor" title={T('جارٍ تحميل بيانات CPS', 'Loading CPS data')} /></Card>;
  }
  if (!cps.state) {
    return <Card title={T('ملخص حساسات CPS', 'CPS sensor summary')} icon="sensor" sub={T('NODE-04', 'NODE-04')} actions={<Btn small onClick={cps.refresh}>{T('إعادة المحاولة', 'Retry')}</Btn>}>
      <Empty icon="sensor" title={T('بيانات CPS غير متاحة', 'CPS data unavailable')}><p className="fine">{cps.error}</p></Empty>
    </Card>;
  }
  const state = cps.state;
  const offline = state.connection_status === 'OFFLINE';
  const stale = state.connection_status === 'STALE';
  const online = state.connection_status === 'ONLINE';
  const heartbeatAge = cpsAge(state.last_heartbeat_received_at);
  const connectionTone = online ? 'ok' : stale ? 'warn' : 'off';
  const dataLabel = offline
    ? T('قراءات محفوظة تاريخياً — العقدة غير متصلة', 'Historical stored readings — node is offline')
    : stale
      ? T('بيانات CPS قديمة', 'CPS data is stale')
      : T('قراءات CPS الحالية', 'Current CPS readings');
  return <Card title={T('ملخص حساسات CPS', 'CPS sensor summary')} icon="sensor" sub={<Ltr>{state.node_id}</Ltr>} actions={<Btn small onClick={cps.refresh}>{T('تحديث', 'Refresh')}</Btn>}>
    <div className="cps-status-row">
      <Chip tone={connectionTone}><Ltr>{state.connection_status}</Ltr></Chip>
      <span>{dataLabel}</span>
    </div>
    <div className="cps-reading-grid">
      <CpsMetric label={T('درجة الحرارة', 'Temperature')} reading={latestReading(state.readings, 'temperature')} T={T} />
      <CpsMetric label={T('الرطوبة', 'Humidity')} reading={latestReading(state.readings, 'humidity')} T={T} />
      <CpsMetric label={T('الضغط', 'Pressure')} reading={latestReading(state.readings, 'pressure')} T={T} />
    </div>
    <div className="cps-heartbeat">
      <span>{T('آخر نبضة', 'Last heartbeat')}</span>
      <strong><Ltr>{heartbeatAge ?? '—'}</Ltr></strong>
      <small>{heartbeatAge ? T('قبل وقت لقطة CPS', 'before CPS snapshot') : T('غير متاحة من CPS', 'not reported by CPS')}</small>
    </div>
    <details className="cps-details">
      <summary>{T('تفاصيل CPS والأوقات', 'CPS details and timestamps')}</summary>
      <dl className="facts">
        <div className="field"><dt>{T('حالة العقدة', 'Node status')}</dt><dd><Ltr>{state.status}</Ltr></dd></div>
        <div className="field"><dt>{T('وقت لقطة CPS', 'CPS as of')}</dt><dd><Ltr>{cpsTime(state.as_of, ui.lang)}</Ltr></dd></div>
        <div className="field"><dt>{T('وقت آخر نبضة', 'Last heartbeat time')}</dt><dd><Ltr>{cpsTime(state.last_heartbeat_received_at, ui.lang)}</Ltr></dd></div>
        {['temperature', 'humidity', 'pressure'].map((sensorType) => {
          const reading = latestReading(state.readings, sensorType);
          return reading ? <div className="field" key={sensorType}><dt><Ltr>{reading.sensor_id}</Ltr></dt><dd><Ltr>{cpsTime(reading.timestamp, ui.lang)}</Ltr></dd></div> : null;
        })}
      </dl>
    </details>
  </Card>;
}

function operationalTone(status: OperationalHvacRecommendation['evaluation']['status']): 'ok' | 'warn' | 'neutral' | 'off' {
  if (status === 'POLICY_NOT_CONFIGURED') return 'warn';
  if (status === 'INSUFFICIENT_EVIDENCE') return 'off';
  if (status === 'VENTILATION_RECOMMENDED' || status === 'PREEMPTIVE_VENTILATION_RECOMMENDED') return 'ok';
  return 'neutral';
}

function freshnessLabel(value: string, T: (ar: string, en: string) => string): string {
  if (value === 'FRESH') return T('حديث', 'Fresh');
  if (value === 'STALE') return T('قديم', 'Stale');
  if (value === 'INVALID') return T('غير صالح', 'Invalid');
  return T('غير متاح', 'Missing');
}

/** Displays a current monitor-only evaluation; it never creates a command or history. */
export function HvacIntelligence() {
  const { T, ui } = useUI();
  const hvac = useOperationalHvacRecommendation();
  if (hvac.loading) return <Card title={T('ذكاء التكييف', 'HVAC Intelligence')} icon="thermo" sub={T('مراقبة فقط', 'Monitor only')}><Empty icon="thermo" title={T('جارٍ تقييم الأدلة التشغيلية', 'Evaluating operational evidence')} /></Card>;
  if (!hvac.recommendation) return <Card title={T('ذكاء التكييف', 'HVAC Intelligence')} icon="thermo" sub={T('مراقبة فقط', 'Monitor only')} actions={<Btn small onClick={hvac.refresh}>{T('إعادة المحاولة', 'Retry')}</Btn>}>
    <Empty icon="thermo" title={T('أدلة التكييف التشغيلية غير متاحة', 'Operational HVAC evidence unavailable')}><p className="fine">{hvac.error}</p></Empty>
  </Card>;

  const result = hvac.recommendation;
  const cps = result.evidence.cps;
  const ai = result.evidence.ai_people;
  const temperature = cps.temperature;
  const shownPeople = ai.people_smoothed ?? ai.people_count;
  return <Card title={T('ذكاء التكييف', 'HVAC Intelligence')} icon="thermo"
    sub={<Chip tone="neutral">{T('مراقبة فقط', 'Monitor only')}</Chip>}
    actions={<Btn small onClick={hvac.refresh}>{T('تحديث', 'Refresh')}</Btn>}>
    <HvacSummary result={result} updatedAt={cpsTime(result.evaluation.evaluated_at, ui.lang)} />
    <details className="cps-details hvs-tech">
    <summary>{T('التفاصيل التقنية', 'Technical details')}</summary>
    <div className="cps-status-row">
      <Chip tone={operationalTone(result.evaluation.status)}><Ltr>{result.evaluation.status}</Ltr></Chip>
      <span>{result.evaluation.explanation}</span>
    </div>
    <div className="grid2">
      <dl className="facts">
        <div className="field"><dt>{T('المنطقة', 'Zone')}</dt><dd><Ltr>{result.evaluation.zone_id ?? '—'}</Ltr></dd></div>
        <div className="field"><dt>{T('عقدة CPS', 'CPS node')}</dt><dd><Ltr>{cps.node_id ?? '—'}</Ltr></dd></div>
        <div className="field"><dt>{T('حالة الاتصال', 'Connection status')}</dt><dd><Ltr>{cps.connection_status ?? '—'}</Ltr></dd></div>
        <div className="field"><dt>{T('مصدر CPS', 'CPS source')}</dt><dd><Ltr>{cps.source}</Ltr></dd></div>
      </dl>
      <dl className="facts">
        <div className="field"><dt>{T('درجة الحرارة', 'Temperature')}</dt><dd>{temperature.value_c === null ? T('غير متاحة', 'Unavailable') : <Ltr>{temperature.value_c} °C</Ltr>}</dd></div>
        <div className="field"><dt>{T('وقت القراءة', 'Reading time')}</dt><dd><Ltr>{cpsTime(temperature.observed_at, ui.lang)}</Ltr></dd></div>
        <div className="field"><dt>{T('التحقق', 'Validation')}</dt><dd><Ltr>{temperature.validation_status ?? '—'}</Ltr></dd></div>
        <div className="field"><dt>{T('حداثة القراءة', 'Reading freshness')}</dt><dd>{freshnessLabel(temperature.freshness, T)}</dd></div>
      </dl>
      <dl className="facts">
        <div className="field"><dt>{T('عدد الأشخاص', 'People count')}</dt><dd>{shownPeople === null ? T('غير متاح', 'Unavailable') : <Ltr>{shownPeople}</Ltr>}</dd></div>
        <div className="field"><dt>{T('مصدر AI', 'AI source')}</dt><dd><Ltr>{ai.source}{ai.camera_id ? ` · ${ai.camera_id}` : ''}</Ltr></dd></div>
        <div className="field"><dt>{T('وقت الملاحظة', 'Observation time')}</dt><dd><Ltr>{cpsTime(ai.observed_at, ui.lang)}</Ltr></dd></div>
        <div className="field"><dt>{T('حداثة AI', 'AI freshness')}</dt><dd>{freshnessLabel(ai.freshness, T)}</dd></div>
      </dl>
      <dl className="facts">
        <div className="field"><dt>{T('تقييم السياسة', 'Policy evaluation')}</dt><dd><Ltr>{result.evaluation.reason_code}</Ltr></dd></div>
        <div className="field"><dt>{T('وقت التقييم', 'Evaluated at')}</dt><dd><Ltr>{cpsTime(result.evaluation.evaluated_at, ui.lang)}</Ltr></dd></div>
        <div className="field"><dt>{T('نسخة السياسة', 'Policy version')}</dt><dd><Ltr>{result.evaluation.policy_version}</Ltr></dd></div>
        <div className="field"><dt>{T('ثقة الكشف', 'Detection confidence')}</dt><dd>{ai.derived_detection_confidence === null ? T('غير متاحة', 'Unavailable') : <Ltr>{(ai.derived_detection_confidence * 100).toFixed(1)}%</Ltr>}</dd></div>
      </dl>
    </div>
    <dl className="facts">
      <div className="field"><dt>{T('لقطة CPS', 'CPS snapshot')}</dt><dd>{freshnessLabel(cps.snapshot_freshness, T)} · <Ltr>{cpsTime(cps.as_of, ui.lang)}</Ltr></dd></div>
      <div className="field"><dt>{T('آخر نبضة', 'Last heartbeat')}</dt><dd><Ltr>{cpsTime(cps.last_heartbeat_received_at, ui.lang)}</Ltr></dd></div>
      <div className="field"><dt>{T('مشكلات CPS', 'CPS issues')}</dt><dd><Ltr>{cps.issues.join(', ') || '—'}</Ltr></dd></div>
      <div className="field"><dt>{T('مشكلات AI', 'AI issues')}</dt><dd><Ltr>{ai.issues.join(', ') || '—'}</Ltr></dd></div>
      <div className="field"><dt>{T('مشكلات التقييم', 'Evaluation issues')}</dt><dd><Ltr>{result.evaluation.evidence_issues.join(', ') || '—'}</Ltr></dd></div>
    </dl>
    <p className="fine">{T('ثقة الكشف مشتقة من نتائج كشف الأشخاص الحالية فقط، وليست مقياسًا لدقة عدد الأشخاص. الاتجاهات تقارن القراءة الحالية بقراءة فعلية قبل 5 دقائق.', 'Detection confidence is derived from current person detections only; it is not count accuracy. Trends compare the current reading with a real reading from 5 minutes earlier.')}</p>
    </details>
  </Card>;
}

function SimulationCenter() {
  const { T } = useUI();
  const [twin, dispatch] = useReducer(twinReducer, createInitialTwinState());
  const [evaluating, setEvaluating] = useState(false);
  const [evaluationError, setEvaluationError] = useState<string | null>(null);
  const temperature = twin.sensors.find((sensor) => sensor.id === 'SIM-SENSOR-TEMP-01');
  const humidity = twin.sensors.find((sensor) => sensor.id === 'SIM-SENSOR-HUM-01');
  const node = twin.nodes[0];
  const actuator = twin.actuators[0];
  const storedEvaluation = twin.latestEvaluation;
  const evaluation = storedEvaluation?.response.evaluation;
  const canApply = canApplySimulationRecommendation(twin);

  async function evaluate() {
    const request = simulationEvaluationRequest(twin);
    const generation = twin.evaluationGeneration + 1;
    setEvaluating(true);
    setEvaluationError(null);
    dispatch({ type: 'BEGIN_SIMULATION_EVALUATION' });
    try {
      const result = await evaluateSimulationHvac(request);
      dispatch({ type: 'SET_SIMULATION_EVALUATION', value: result, request, generation });
    } catch (error) {
      setEvaluationError(error instanceof Error ? error.message : T('تعذر تقييم المحاكاة', 'Simulation evaluation is unavailable'));
    } finally {
      setEvaluating(false);
    }
  }

  function updateSimulation(action: Parameters<typeof dispatch>[0]) {
    setEvaluationError(null);
    dispatch(action);
  }

  const fanState = actuator?.state ?? 'UNAVAILABLE';
  const renderedVisitors = visitorDisplayCount(twin.scenarioInputs.simulatedPeopleCount);
  const temperatureFreshness = simulatedFreshness(temperature?.observedAt, twin.simulatedNow);
  const fanStatusText = fanState === 'ON'
    ? T('تعمل محلياً', 'Running locally')
    : fanState === 'OFF'
      ? T('متوقفة محلياً', 'Off locally')
      : T('غير متاحة', 'Unavailable');
  const plainDecisionText = evaluation?.recommendation === 'TURN_FAN_ON'
    ? T('قرّر RASID أن القاعة دافئة؛ يمكن تشغيل المروحة الافتراضية بعد التأكيد.', 'RASID found the hall warm. You may turn on the virtual fan after confirming.')
    : evaluation?.recommendation === 'TURN_FAN_OFF'
      ? T('قرّر RASID أن القاعة باردة بما يكفي؛ يمكن إيقاف المروحة الافتراضية بعد التأكيد.', 'RASID found the hall cool enough. You may turn off the virtual fan after confirming.')
      : evaluation?.recommendation === 'HOLD'
        ? T('يحافظ RASID على حالة المروحة الحالية وفق قواعد الأمان.', 'RASID is keeping the current fan state under the safety rules.')
        : evaluation?.reason_code === 'NODE_NOT_ONLINE'
          ? T('لا يستطيع RASID اتخاذ قرار أثناء انقطاع العقدة الافتراضية.', 'RASID cannot make a decision while the virtual node is disconnected.')
          : evaluation?.recommendation === 'INSUFFICIENT_DATA'
            ? T('يحتاج RASID إلى قراءة افتراضية حديثة قبل اتخاذ قرار.', 'RASID needs a current virtual reading before making a decision.')
            : T('غيّر حالة القاعة ثم شغّل المحاكاة.', 'Change the hall, then run the simulation.');
  const applyLabel = evaluation?.recommendation === 'TURN_FAN_ON'
    ? T('شغّل المروحة الافتراضية', 'Turn Virtual Fan ON')
    : T('أوقف المروحة الافتراضية', 'Turn Virtual Fan OFF');
  const needsFreshEvaluation = !!evaluation
    && (evaluation.recommendation === 'TURN_FAN_ON' || evaluation.recommendation === 'TURN_FAN_OFF')
    && !canApply;

  return <>
    <p className="fine"><SimTag /> {T('محاكاة محلية فقط — لا توجد أجهزة أو أوامر فعلية.', 'Simulation only — no real devices or commands.')}</p>
    <section className="sim-judge-experience" aria-label={T('تجربة المحاكاة المبسطة', 'Simple simulation experience')}>
      <Card title={T('قاعة A1 الافتراضية', 'Virtual Hall A1')} icon="iot">
        <SimulationHall temperatureC={temperature?.value ?? 0} peopleCount={twin.scenarioInputs.simulatedPeopleCount} connectionStatus={node?.connectionStatus ?? 'OFFLINE'} fanState={fanState} />
        <div className="sim-status-indicators" aria-label={T('حالة القاعة الافتراضية', 'Virtual hall status')}>
          <div className="sim-status-card visitors"><span>{T('الزوار', 'Visitors')}</span><strong><Ltr>{twin.scenarioInputs.simulatedPeopleCount}</Ltr></strong><small>{renderedVisitors < twin.scenarioInputs.simulatedPeopleCount ? T(`يظهر ${renderedVisitors}`, `Showing ${renderedVisitors}`) : T('في القاعة', 'In the hall')}</small></div>
          <div className="sim-status-card temperature"><span>{T('الحرارة', 'Temperature')}</span><strong><Ltr>{(temperature?.value ?? 0).toFixed(1)} °C</Ltr></strong><small>{T('قاعة A1', 'Hall A1')}</small></div>
          <div className={`sim-status-card fan ${fanState === 'ON' ? 'on' : ''}`}><span>{T('المروحة', 'Virtual Fan')}</span><strong><Ltr>{fanState}</Ltr></strong><small>{fanStatusText}</small></div>
        </div>
      </Card>

      <div className="sim-simple-controls" aria-label={T('عناصر تحكم المحاكاة', 'Simulation controls')}>
        <button type="button" className="sim-game-control heat" onClick={() => updateSimulation({ type: 'SET_SIMULATED_TEMPERATURE', value: 28 })}><Icon name="thermo" size={28} /><strong>{T('زيادة الحرارة', 'Increase Heat')}</strong><span>{T('تدفئة القاعة الافتراضية', 'Warm the virtual hall')}</span></button>
        <button type="button" className="sim-game-control crowd" onClick={() => updateSimulation({ type: 'SET_SIMULATED_PEOPLE_COUNT', value: Math.min(24, twin.scenarioInputs.simulatedPeopleCount + 8) })}><Icon name="crowd" size={28} /><strong>{T('إضافة زوار', 'Add Visitors')}</strong><span>{T('تغيير بصري فقط', 'Visual change only')}</span></button>
        <button type="button" className="sim-game-control failure" onClick={() => updateSimulation({ type: 'SET_SIMULATED_CONNECTION', value: 'OFFLINE' })}><Icon name="offline" size={28} /><strong>{T('قطع اتصال العقدة', 'Disconnect Node')}</strong><span>{T('محاكاة انقطاع العقدة', 'Simulate node loss')}</span></button>
      </div>
      <p className="fine sim-crowd-note"><SimTag /> {T('عدد الزوار يغيّر مشهد القاعة فقط ولا يؤثر في قرار المروحة.', 'Visitors change the hall scene only; they do not affect the fan decision.')}</p>
      <div className="sim-decision-panel"><Card title={T('قرار RASID', 'RASID Decision')} icon="hvac">
        <p className="sim-simple-result">{plainDecisionText}</p>
        {evaluationError && <p className="warnline">{T('تعذر تشغيل المحاكاة الآن. حاول مرة أخرى.', 'The simulation is unavailable right now. Please try again.')}</p>}
        {needsFreshEvaluation && <p className="fine">{T('تغيّرت حالة القاعة؛ شغّل المحاكاة مرة أخرى قبل التطبيق.', 'The hall changed. Run the simulation again before applying a decision.')}</p>}
        <div className="sim-simple-actions">
          <Btn kind="primary" icon="thermo" onClick={evaluate} disabled={evaluating}>{evaluating ? T('جارٍ تشغيل المحاكاة', 'Running Simulation') : T('شغّل المحاكاة', 'Run Simulation')}</Btn>
          {canApply && <Btn kind="primary" icon="check" onClick={() => dispatch({ type: 'APPLY_SIMULATION_RECOMMENDATION' })}>{applyLabel}</Btn>}
          <Btn small icon="refresh" onClick={() => { setEvaluationError(null); dispatch({ type: 'RESET_SIMULATION' }); }}>{T('إعادة ضبط', 'Reset')}</Btn>
        </div>
        {twin.lastVirtualActuation && <p className="sim-applied"><Chip tone="ok">{T('تم التطبيق محلياً', 'Applied locally')}</Chip> {T('المروحة الافتراضية الآن', 'The virtual fan is now')} <Ltr>{twin.lastVirtualActuation.state}</Ltr>. {twin.lastVirtualActuation.reason}</p>}
      </Card></div>

    </section>
    <details className="sim-advanced">
      <summary>{T('تفاصيل تقنية (اختيارية)', 'Technical Details (Optional)')}</summary>
      <p className="fine"><SimTag /> {T('قيم تقنية اصطناعية ومعرّفات افتراضية للتشخيص فقط.', 'Synthetic technical values and virtual identifiers for diagnostics only.')}</p>
    <div className="grid2">
      <Card title={T('بيئة التوأم الافتراضي', 'Virtual twin environment')} icon="iot" sub={<SimTag>{T('محلي فقط', 'Browser-local only')}</SimTag>}>
        <dl className="facts">
          <div className="field"><dt>{T('السياق', 'Context')}</dt><dd><Ltr>{twin.context}</Ltr></dd></div>
          <div className="field"><dt>{T('المصدر', 'Provenance')}</dt><dd><SimTag>{T('اصطناعي', 'Synthetic')}</SimTag></dd></div>
          <div className="field"><dt>{T('التشغيل الفعلي', 'Physical control')}</dt><dd>{T('غير متاح', 'Unavailable')}</dd></div>
        </dl>
        <p className="fine">{T('تستخدم هذه المحاكاة سياسة HVAC اصطناعية وسيناريوهات محلية. لا توجد حقن أعطال للحساسات أو سجل تدقيق دائم أو تحكم فعلي.', 'This simulation uses a synthetic HVAC policy and browser-local scenarios. Sensor fault injection, persistent audit history, and physical control are unavailable.')}</p>
      </Card>
      <Card title={T('العقد الافتراضية', 'Virtual nodes')} icon="router" sub={<SimTag>{T('اصطناعية', 'Synthetic')}</SimTag>}>
        <div className="table-wrap"><table><thead><tr><th>{T('الوصف', 'Description')}</th><th>{T('الحالة', 'State')}</th></tr></thead><tbody>
          {twin.nodes.map((node) => <tr key={node.id}><td>{T('عقدة بيئية افتراضية', 'Virtual environmental node')}</td><td><Chip tone={node.connectionStatus === 'ONLINE' ? 'ok' : node.connectionStatus === 'STALE' ? 'warn' : 'off'}><Ltr>{node.connectionStatus}</Ltr></Chip></td></tr>)}
        </tbody></table></div>
      </Card>
      <Card title={T('الحساسات الافتراضية', 'Virtual sensors')} icon="sensors" sub={<SimTag>{T('قيم أولية اصطناعية', 'Synthetic starter values')}</SimTag>}>
        <div className="table-wrap"><table><thead><tr><th>{T('الحساس', 'Sensor')}</th><th>{T('القراءة', 'Reading')}</th></tr></thead><tbody>
          {twin.sensors.map((sensor) => <tr key={sensor.id}><td>{sensor.label}</td><td><Ltr>{sensor.value} {sensor.unit}</Ltr></td></tr>)}
        </tbody></table></div>
      </Card>
      <Card title={T('المشغّل الافتراضي', 'Virtual actuator')} icon="hvac" sub={<SimTag>{T('لا يوجد جهاز فعلي', 'No physical device')}</SimTag>}>
        <div className="table-wrap"><table><thead><tr><th>{T('المشغّل', 'Actuator')}</th><th>{T('الحالة', 'State')}</th></tr></thead><tbody>
          {twin.actuators.map((actuator) => <tr key={actuator.id}><td>{actuator.label}</td><td><Chip tone={actuator.state === 'ON' ? 'ok' : actuator.state === 'OFF' ? 'neutral' : 'off'}><Ltr>{actuator.state}</Ltr></Chip></td></tr>)}
        </tbody></table></div>
      </Card>
      <details className="sim-developer-details"><summary>{T('معرّفات المطور', 'Developer identifiers')}</summary><ul className="plain"><li>{twin.nodes.map((item) => <Ltr key={item.id}>{item.id} </Ltr>)}</li><li>{twin.sensors.map((item) => <Ltr key={item.id}>{item.id} </Ltr>)}</li><li>{twin.actuators.map((item) => <Ltr key={item.id}>{item.id} </Ltr>)}</li></ul></details>
      <Card title={T('مدخلات HVAC الاصطناعية', 'Synthetic HVAC inputs')} icon="thermo" sub={<SimTag>{T('محلي فقط', 'Browser-local only')}</SimTag>}>
        <div className="form">
          <label>{T('درجة الحرارة الافتراضية', 'Virtual temperature')}<input dir="ltr" type="number" step="0.1" value={temperature?.value ?? ''} onChange={(event: { currentTarget: HTMLInputElement }) => { setEvaluationError(null); dispatch({ type: 'SET_SIMULATED_TEMPERATURE', value: event.currentTarget.valueAsNumber }); }} /></label>
          <label>{T('الرطوبة الافتراضية', 'Virtual humidity')}<input dir="ltr" type="number" step="0.1" value={humidity?.value ?? ''} onChange={(event: { currentTarget: HTMLInputElement }) => { setEvaluationError(null); dispatch({ type: 'SET_SIMULATED_HUMIDITY', value: event.currentTarget.valueAsNumber }); }} /></label>
          <label>{T('عدد الأشخاص الافتراضي', 'Virtual people count')}<input dir="ltr" type="number" min="0" step="1" value={twin.scenarioInputs.simulatedPeopleCount} onChange={(event: { currentTarget: HTMLInputElement }) => { setEvaluationError(null); dispatch({ type: 'SET_SIMULATED_PEOPLE_COUNT', value: event.currentTarget.valueAsNumber }); }} /></label>
          <label>{T('اتصال العقدة الافتراضية', 'Virtual node connection')}<select className="sel" value={node?.connectionStatus ?? 'OFFLINE'} onChange={(event: { currentTarget: HTMLSelectElement }) => { setEvaluationError(null); dispatch({ type: 'SET_SIMULATED_CONNECTION', value: event.currentTarget.value as 'ONLINE' | 'STALE' | 'OFFLINE' }); }}><option value="ONLINE">ONLINE</option><option value="STALE">STALE</option><option value="OFFLINE">OFFLINE</option></select></label>
        </div>
        <p className="fine"><SimTag /> {T('الرطوبة وعدد الأشخاص مدخلات مستقبلية للسيناريو فقط؛ لا يستخدمهما sim-hvac-v1 في التقييم.', 'Humidity and people count are future scenario inputs only; sim-hvac-v1 does not use them for evaluation.')}</p>
      </Card>
      <Card title={T('وقت المحاكاة والتقييم', 'Simulation time and evaluation')} icon="clock" sub={<SimTag>{T('لا يوجد تحكم فعلي', 'No physical control')}</SimTag>}>
        <dl className="facts">
          <div className="field"><dt>{T('وقت المحاكاة', 'Simulated time')}</dt><dd><Ltr>{twin.simulatedNow}</Ltr></dd></div>
          <div className="field"><dt>{T('قراءة الحرارة', 'Temperature observed at')}</dt><dd><Ltr>{temperature?.observedAt ?? '—'}</Ltr></dd></div>
          <div className="field"><dt>{T('حداثة الحرارة', 'Temperature freshness')}</dt><dd><Chip tone={temperatureFreshness === 'FRESH' ? 'ok' : temperatureFreshness === 'STALE' ? 'warn' : 'off'}><Ltr>{temperatureFreshness}</Ltr></Chip></dd></div>
          <div className="field"><dt>{T('آخر تغيير افتراضي للمروحة', 'Last virtual fan change')}</dt><dd><Ltr>{twin.lastSimulatedFanStateChangeAt ?? '—'}</Ltr></dd></div>
        </dl>
        <div className="filters"><Btn small onClick={() => { setEvaluationError(null); dispatch({ type: 'ADVANCE_SIMULATED_TIME', seconds: 10 }); }}>+10s</Btn><Btn small onClick={() => { setEvaluationError(null); dispatch({ type: 'ADVANCE_SIMULATED_TIME', seconds: 60 }); }}>+60s</Btn></div>
        <p className="fine">{T('يتطلب التقييم اتصالاً افتراضياً ONLINE وقراءة حديثة وحالة مروحة افتراضية معروفة. حالة المروحة لا تتغير إلا من زر تطبيق توصية مؤهلة. لا يتم تطبيق أي توصية تلقائياً.', 'Evaluation requires a virtual ONLINE connection, a fresh reading, and known virtual fan state. The fan changes only through applying an eligible recommendation. No recommendation is applied automatically.')}</p>
      </Card>
      <Card title={T('نتيجة محاكاة HVAC', 'HVAC simulation result')} icon="hvac" sub={<SimTag>{T('تقييم فقط', 'Evaluation only')}</SimTag>}>
        {evaluationError ? <Empty icon="incidents" title={T('تعذر تقييم محاكاة HVAC', 'HVAC simulation evaluation unavailable')}><p className="fine"><Ltr>{evaluationError}</Ltr></p></Empty>
          : !evaluation ? <Empty icon="thermo" title={T('لم يتم التقييم بعد', 'Not evaluated yet')}>{T('أدخل قيماً اصطناعية ثم قيّم السياسة. لا توجد أوامر أو تغييرات على أجهزة فعلية.', 'Enter synthetic values and evaluate the policy. No commands or changes are made to physical devices.')}</Empty>
          : <><dl className="facts">
            <div className="field"><dt>{T('التوصية', 'Recommendation')}</dt><dd><Chip tone={evaluation.recommendation === 'INSUFFICIENT_DATA' ? 'warn' : 'info'}><Ltr>{evaluation.recommendation}</Ltr></Chip></dd></div>
            <div className="field"><dt>{T('التفسير', 'Explanation')}</dt><dd>{evaluation.reason}</dd></div>
            <div className="field"><dt>{T('الحالة المقترحة', 'Proposed virtual state')}</dt><dd><Ltr>{evaluation.proposed_simulated_state ?? '—'}</Ltr></dd></div>
          </dl><details className="sim-developer-details"><summary>{T('تفاصيل المطور', 'Developer details')}</summary><dl className="facts"><div className="field"><dt>{T('رمز السبب', 'Reason code')}</dt><dd><Ltr>{evaluation.reason_code}</Ltr></dd></div><div className="field"><dt>{T('السياسة', 'Policy')}</dt><dd><Ltr>{evaluation.policy_version}</Ltr></dd></div><div className="field"><dt>{T('وقت التقييم', 'Evaluated at')}</dt><dd><Ltr>{evaluation.evaluated_at}</Ltr></dd></div></dl></details></>}
        {twin.lastVirtualActuation && <p className="fine"><Chip tone="ok">{T('آخر قرار مطبق محلياً', 'Last locally applied decision')}</Chip> <Ltr>{twin.lastVirtualActuation.recommendation} → {twin.lastVirtualActuation.state} · {twin.lastVirtualActuation.appliedAt}</Ltr><br />{twin.lastVirtualActuation.reason}</p>}
      </Card>
    </div>
    </details>
  </>;
}

function OtWorkspace() {
  const { T } = useUI();
  const [area, setArea] = useState<'real' | 'simulation'>('real');
  const [tab, setTab] = useState<'sensors' | 'nodes' | 'actuators' | 'heartbeat' | 'heatmaps'>('sensors');
  return <>
    <Tabs label={T('مساحة التشغيل التقني', 'OT workspace')} value={area} onChange={setArea} tabs={[
      { id: 'real', label: T('التشغيل الفعلي', 'Real Operations') },
      { id: 'simulation', label: T('مركز المحاكاة', 'Simulation Center') },
    ]} />
    {area === 'simulation' ? <SimulationCenter /> : <>
    <p className="fine"><Chip tone="info">{T('بيانات CPS فعلية', 'Real CPS Data')}</Chip> {T('تعرض الأقسام التالية بيانات CPS الموثقة فقط؛ وتبقى حالة المرحّل مراقبة فقط دون أوامر تحكم.', 'The following sections display verified CPS data only; relay state remains monitoring-only with no control commands.')}</p>
    <HvacIntelligence />
    <Tabs label={T('تفاصيل التشغيل الفعلي', 'Real operations details')} value={tab} onChange={setTab} tabs={[
      { id: 'sensors', label: T('الحساسات', 'Sensors') },
      { id: 'nodes', label: T('العقد', 'Nodes') },
      { id: 'actuators', label: T('المشغلات والتكييف', 'Actuators & HVAC') },
      { id: 'heartbeat', label: T('النبضات', 'Heartbeats') },
      { id: 'heatmaps', label: T('الخرائط', 'Maps') },
    ]} />
    {tab === 'nodes' && <NodesTable />}
    {tab === 'sensors' && <SensorsTable />}
    {tab === 'actuators' && <ActuatorsTable />}
    {tab === 'heartbeat' && <Heartbeats />}
    {tab === 'heatmaps' && <Heatmaps />}
    </>}
  </>;
}

function IotWorkspace() {
  const { T, ui, openCamera, set } = useUI();
  return <>
    <div className="grid2">
      <Card title={T('كاميرات وتحليلات راصد', 'RASID cameras and AI')} icon="cameras" sub={T('المسار الحالي للكاميرات والذكاء الاصطناعي', 'Existing camera and AI workflow')} actions={<Btn small kind="primary" icon="cameras" onClick={() => openCamera(ui.cameraId)}>{T('فتح الكاميرات', 'Open cameras')}</Btn>}>
        <p className="fine">{T('تُدار مصادر الكاميرا والبث والتحليلات والحوادث من صفحة الكاميرات في راصد.', 'Camera sources, streams, analysis, and incidents are managed on RASID’s Cameras page.')}</p>
      </Card>
      <Card title={T('الطائرات المسيرة', 'Drones')} icon="drone" sub={T('مسار الاستجابة الميدانية الحالي', 'Existing field-response workflow')} actions={<Btn small icon="incidents" onClick={() => set({ section: 'incidents', incidentTab: 'response' })}>{T('فتح الاستجابة', 'Open response')}</Btn>}>
        <p className="fine"><SimTag /> {T('تظل بيانات وحركات الطائرات الحالية محاكاة، وتُستخدم من خلال الحوادث والاستجابة الميدانية.', 'Current drone records and movement remain simulated and are used through incidents and field response.')}</p>
      </Card>
    </div>
    <DronesTable />
  </>;
}

function NocUnavailable() {
  const { T, ui } = useUI();
  const cps = useCpsNodeState();
  if (cps.loading) return <>
    <div className="kpis iot-k">
      <Kpi label={T('أجهزة متصلة', 'Connected devices')} glyph="router" value="—" sub={T('جارٍ تحميل CPS', 'Loading CPS')} tone="neutral" />
      <Kpi label={T('عناوين IP / MAC', 'IP / MAC observations')} glyph="signal" value="—" sub={T('جارٍ تحميل CPS', 'Loading CPS')} tone="neutral" />
      <Kpi label={T('تشخيص الاتصال', 'Connectivity diagnostics')} glyph="heart" value="—" sub={<Ltr>NODE-04</Ltr>} tone="neutral" />
    </div>
    <Card title={T('مراقبة الشبكة', 'Network monitoring')} icon="signal" sub={<Ltr>NODE-04</Ltr>}><Empty icon="signal" title={T('جارٍ تحميل ملاحظات الشبكة', 'Loading network observations')} /></Card>
  </>;
  if (!cps.state) return <>
    <div className="kpis iot-k">
      <Kpi label={T('أجهزة متصلة', 'Connected devices')} glyph="router" value="—" sub={T('مصدر CPS غير متاح', 'CPS source unavailable')} tone="neutral" />
      <Kpi label={T('عناوين IP / MAC', 'IP / MAC observations')} glyph="signal" value="—" sub={T('غير متاحة', 'Unavailable')} tone="neutral" />
      <Kpi label={T('تشخيص الاتصال', 'Connectivity diagnostics')} glyph="heart" value="—" sub={T('غير متاح', 'Unavailable')} tone="neutral" />
    </div>
    <Card title={T('مراقبة الشبكة', 'Network monitoring')} icon="signal" sub={<Ltr>NODE-04</Ltr>} actions={<Btn small onClick={cps.refresh}>{T('إعادة المحاولة', 'Retry')}</Btn>}>
      <Empty icon="signal" title={T('ملاحظات الشبكة غير متاحة', 'Network observations unavailable')}><p className="fine">{cps.error}</p></Empty>
    </Card>
  </>;

  const state = cps.state;
  const observation = state.network_observation;
  const age = networkObservationAge(state.connection_status, observation);
  const connectionTone = state.connection_status === 'ONLINE' ? 'ok' : state.connection_status === 'STALE' ? 'warn' : state.connection_status === 'OFFLINE' ? 'off' : 'neutral';
  const observationLabel = age === 'latest'
    ? T('أحدث تقرير من الجهاز', 'Latest device report')
    : age === 'stale'
      ? T('تقرير جهاز قديم', 'Stale device report')
      : age === 'historical'
        ? T('تقرير جهاز محفوظ تاريخياً', 'Historical device report')
        : age === 'unavailable'
          ? T('لا توجد ملاحظة شبكة متاحة', 'No network observation available')
          : T('تقرير من الجهاز', 'Device report');
  const hasIpOrMac = observation.reported_ip !== null || observation.reported_mac !== null;
  return <>
    <div className="kpis iot-k">
      <Kpi label={T('أجهزة متصلة', 'Connected devices')} glyph="router" value={state.connection_status === 'ONLINE' ? 1 : 0} sub={<><Ltr>NODE-04</Ltr> · <Ltr>{state.connection_status}</Ltr></>} tone={connectionTone} />
      <Kpi label={T('عناوين IP / MAC', 'IP / MAC observations')} glyph="signal" value={hasIpOrMac ? 1 : '—'} sub={hasIpOrMac ? T('تقرير جهاز فقط', 'Device-reported only') : T('غير متاحة', 'Unavailable')} tone={hasIpOrMac ? connectionTone : 'neutral'} />
      <Kpi label={T('تشخيص الاتصال', 'Connectivity diagnostics')} glyph="heart" value={<Ltr>{state.connection_status}</Ltr>} sub={<><Ltr>NODE-04</Ltr> · {T('آخر نبضة: ', 'Last heartbeat: ')}<Ltr>{cpsTime(state.last_heartbeat_received_at, ui.lang)}</Ltr></>} tone={connectionTone} />
    </div>
    <Card title={T('مراقبة الشبكة', 'Network monitoring')} icon="signal" sub={<><Ltr>NODE-04</Ltr> · {T('مراقبة فقط', 'Monitoring only')}</>} actions={<Btn small onClick={cps.refresh}>{T('تحديث', 'Refresh')}</Btn>}>
      <div className="cps-status-row"><Chip tone={connectionTone}><Ltr>{state.connection_status}</Ltr></Chip><span>{observationLabel}</span></div>
      <p className="fine">{T('قيم شبكة أبلغ عنها الجهاز وليست متحققة بشكل مستقل. لا تعرض هذه الصفحة كلمات مرور Wi-Fi أو أسراراً.', 'Network values are device-reported and not independently verified. This view never displays Wi-Fi passwords or secrets.')}</p>
      <dl className="facts">
        <NocField label={T('IP', 'IP')} value={observation.reported_ip} />
        <NocField label={T('MAC', 'MAC')} value={observation.reported_mac} />
        <NocField label={T('RSSI', 'RSSI')} value={observation.reported_rssi_dbm === null ? null : `${observation.reported_rssi_dbm} dBm`} />
        <NocField label={T('SSID', 'SSID')} value={observation.reported_ssid} />
        <NocField label={T('BSSID', 'BSSID')} value={observation.reported_bssid} />
        <NocField label={T('قناة Wi-Fi', 'Wi-Fi channel')} value={observation.reported_wifi_channel === null ? null : String(observation.reported_wifi_channel)} />
        <NocField label={T('البوابة', 'Gateway')} value={observation.reported_gateway} />
        <NocField label={T('قناع الشبكة', 'Subnet mask')} value={observation.reported_subnet_mask} />
        <NocField label={T('وقت تقرير الشبكة', 'Network report time')} value={observation.reported_at ? cpsTime(observation.reported_at, ui.lang) : null} />
        <NocField label={T('آخر نبضة', 'Last heartbeat')} value={state.last_heartbeat_received_at ? cpsTime(state.last_heartbeat_received_at, ui.lang) : null} />
      </dl>
    </Card>
  </>;
}

function NocField({ label, value }: { label: string; value: string | null }) {
  return <div className="field"><dt>{label}</dt><dd><Ltr>{value ?? '—'}</Ltr></dd></div>;
}

function useScopeFilter() {
  const [scoped, setScoped] = useState(false);
  const [q, setQ] = useState('');
  return { scoped, setScoped, q, setQ };
}

function TableTools({ f, placeholder }: { f: ReturnType<typeof useScopeFilter>; placeholder: string }) {
  const { T, ui } = useUI();
  return (
    <div className="filters grid">
      <label className="search-in"><Icon name="search" size={15} /><input value={f.q} onChange={(e: { target: { value: string } }) => f.setQ(e.target.value)} placeholder={placeholder} aria-label={placeholder} /></label>
      <label className="check"><input type="checkbox" checked={f.scoped} onChange={() => f.setScoped(!f.scoped)} />{T('ضمن النطاق', 'Within scope')} <Ltr>{ui.scope === 'ALL' ? T('كامل الموقع', 'site-wide') : ui.scope}</Ltr></label>
    </div>
  );
}

function NodesTable() {
  const { T, ui, openDrawer } = useUI();
  const cps = useCpsNodeState();
  const f = useScopeFilter();
  const qq = f.q.trim().toLowerCase();
  if (cps.loading) return <Card title={T('عقد CPS', 'CPS nodes')} icon="router" sub={<Ltr>NODE-04</Ltr>}><Empty icon="router" title={T('جارٍ تحميل بيانات CPS', 'Loading CPS data')} /></Card>;
  if (!cps.state) return <Card title={T('عقد CPS', 'CPS nodes')} icon="router" sub={<Ltr>NODE-04</Ltr>} actions={<Btn small onClick={cps.refresh}>{T('إعادة المحاولة', 'Retry')}</Btn>}>
    <Empty icon="router" title={T('بيانات عقد CPS غير متاحة', 'CPS node data unavailable')}><p className="fine">{cps.error}</p></Empty>
  </Card>;
  const state = cps.state;
  const inSelectedScope = !f.scoped || ui.scope === 'ALL' || state.location_id === ui.scope;
  const matchesSearch = !qq || [state.node_id, state.location_id ?? ''].some((value) => value.toLowerCase().includes(qq));
  const showNode = inSelectedScope && matchesSearch;
  const statusTone = state.status === 'ACTIVE' ? 'ok' : state.status === 'REVOKED' ? 'off' : 'neutral';
  const connectionTone = state.connection_status === 'ONLINE' ? 'ok' : state.connection_status === 'STALE' ? 'warn' : state.connection_status === 'OFFLINE' ? 'off' : 'neutral';
  return (
    <Card title={T('عقد CPS', 'CPS nodes')} icon="router" sub={T('عقدة CPS موثقة', 'Verified CPS node')} actions={<Btn small onClick={cps.refresh}>{T('تحديث', 'Refresh')}</Btn>}>
      <TableTools f={f} placeholder={T('بحث بمعرف العقدة أو الموقع', 'Search node ID or location')} />
      {showNode ? (
        <div className="tbl-wrap"><table className="tbl">
          <thead><tr><th>{T('العقدة', 'Node')}</th><th>{T('الموقع', 'Location')}</th><th>{T('الحالة', 'Status')}</th><th>{T('الاتصال', 'Connection')}</th><th>{T('آخر نبضة', 'Last heartbeat')}</th></tr></thead>
          <tbody><tr className="clickable" onClick={() => openDrawer({ kind: 'node', id: state.node_id })}>
            <td><Ltr>{state.node_id}</Ltr></td>
            <td><Ltr>{state.location_id ?? '—'}</Ltr></td>
            <td><Chip tone={statusTone}><Ltr>{state.status}</Ltr></Chip></td>
            <td><Chip tone={connectionTone}><Ltr>{state.connection_status}</Ltr></Chip></td>
            <td className="nowrap"><Ltr>{state.last_heartbeat_received_at ? cpsTime(state.last_heartbeat_received_at, ui.lang) : '—'}</Ltr></td>
          </tr></tbody>
        </table></div>
      ) : <Empty title={T('لا توجد عقد CPS مطابقة للفلتر', 'No CPS nodes match the filter')} />}
    </Card>
  );
}

function SensorsTable() {
  const { T, ui } = useUI();
  const cps = useCpsNodeState();
  const f = useScopeFilter();
  const qq = f.q.trim().toLowerCase();
  if (cps.loading) return <Card title={T('حساسات CPS', 'CPS sensors')} icon="thermo" sub={<Ltr>NODE-04</Ltr>}><Empty icon="thermo" title={T('جارٍ تحميل قراءات CPS', 'Loading CPS readings')} /></Card>;
  if (!cps.state) return <Card title={T('حساسات CPS', 'CPS sensors')} icon="thermo" sub={<Ltr>NODE-04</Ltr>} actions={<Btn small onClick={cps.refresh}>{T('إعادة المحاولة', 'Retry')}</Btn>}>
    <Empty icon="thermo" title={T('قراءات CPS غير متاحة', 'CPS readings unavailable')}><p className="fine">{cps.error}</p></Empty>
  </Card>;
  const state = cps.state;
  const allReadings = latestNode04Readings(state.readings);
  const readings = allReadings.filter((reading) => {
    const inSelectedScope = !f.scoped || ui.scope === 'ALL' || state.location_id === ui.scope;
    const matchesSearch = !qq || [reading.sensor_id, state.node_id, state.location_id ?? ''].some((value) => value.toLowerCase().includes(qq));
    return inSelectedScope && matchesSearch;
  });
  const historical = state.connection_status === 'OFFLINE' || state.connection_status === 'STALE';
  return (
    <Card title={T('حساسات CPS', 'CPS sensors')} icon="thermo" sub={<><Ltr>{state.node_id}</Ltr> · <Ltr>{state.location_id ?? '—'}</Ltr></>} actions={<Btn small onClick={cps.refresh}>{T('تحديث', 'Refresh')}</Btn>}>
      <TableTools f={f} placeholder={T('بحث بمعرف الحساس أو العقدة أو الموقع', 'Search sensor, node, or location')} />
      <TempLimitsControl />
      {readings.length ? (
        <div className="tbl-wrap"><table className="tbl">
          <thead><tr><th>{T('الحساس', 'Sensor')}</th><th>{T('الموقع', 'Location')}</th><th>{T('العقدة', 'Node')}</th><th>{T('الاتصال', 'Connection')}</th><th>{T('القراءة', 'Reading')}</th><th>{T('وقت القراءة', 'Reading time')}</th></tr></thead>
          <tbody>{readings.map((reading) => <tr key={reading.sensor_id}>
            <td><Ltr>{reading.sensor_id}</Ltr></td>
            <td><Ltr>{state.location_id ?? '—'}</Ltr></td>
            <td><Ltr>{state.node_id}</Ltr></td>
            <td><Chip tone={state.connection_status === 'ONLINE' ? 'ok' : state.connection_status === 'STALE' ? 'warn' : state.connection_status === 'OFFLINE' ? 'off' : 'neutral'}><Ltr>{state.connection_status}</Ltr></Chip></td>
            <td><Ltr>{String(reading.value)} {reading.unit}</Ltr>{historical && <small className="block muted">{state.connection_status === 'OFFLINE' ? T('قراءة محفوظة تاريخياً', 'Historical stored reading') : T('قراءة قديمة', 'Stale reading')}</small>}</td>
            <td className="nowrap"><Ltr>{cpsTime(reading.timestamp, ui.lang)}</Ltr></td>
          </tr>)}</tbody>
        </table></div>
      ) : <Empty title={allReadings.length ? T('لا توجد قراءات مطابقة للفلتر', 'No readings match the filter') : T('لا توجد قراءات CPS متاحة', 'No CPS readings are available')} />}
      <p className="fine">{T('تُعرض فقط أحدث قراءة أبلغ عنها CPS لكل حساس، دون افتراض نموذج جهاز أو هوية مادية إضافية.', 'Only the latest CPS-reported reading for each sensor is shown; no device model or physical identity is inferred.')}</p>
    </Card>
  );
}

function relayReportLabel(age: CpsRelayReportAge, T: (ar: string, en: string) => string): string {
  switch (age) {
    case 'latest': return T('أحدث حالة مرحّل أبلغ عنها الجهاز', 'Latest device-reported relay state');
    case 'stale': return T('حالة مرحّل قديمة أبلغ عنها الجهاز', 'Stale device-reported relay state');
    case 'historical': return T('حالة مرحّل تاريخية أبلغ عنها الجهاز', 'Historical device-reported relay state');
    case 'reported': return T('حالة مرحّل أبلغ عنها الجهاز', 'Device-reported relay state');
    default: return T('حالة المرحّل غير متاحة', 'Relay state unavailable');
  }
}

function ActuatorsTable() {
  const { T, ui, openDrawer, showOnMap } = useUI();
  const cps = useCpsNodeState();
  if (cps.loading) return <Card title={T('مراقبة مرحّل CPS', 'CPS relay monitoring')} icon="hvac" sub={<Ltr>NODE-04</Ltr>}><Empty icon="hvac" title={T('جارٍ تحميل حالة المرحّل', 'Loading relay state')} /></Card>;
  if (!cps.state) return <Card title={T('مراقبة مرحّل CPS', 'CPS relay monitoring')} icon="hvac" sub={<Ltr>NODE-04</Ltr>} actions={<Btn small onClick={cps.refresh}>{T('إعادة المحاولة', 'Retry')}</Btn>}>
    <Empty icon="hvac" title={T('حالة مرحّل CPS غير متاحة', 'CPS relay state unavailable')}><p className="fine">{cps.error}</p></Empty>
  </Card>;
  const state = cps.state;
  const mapTarget = mapTargetForCpsLocation(state.location_id);
  const age = relayReportAge(state.connection_status, state.reported_relay_state);
  const connectionTone = state.connection_status === 'ONLINE' ? 'ok' : state.connection_status === 'STALE' ? 'warn' : state.connection_status === 'OFFLINE' ? 'off' : 'neutral';
  return <Card title={T('مراقبة مرحّل CPS', 'CPS relay monitoring')} icon="hvac" sub={T('مراقبة فقط — لا تحكم عن بُعد', 'Monitoring only — no remote control')} actions={<Btn small onClick={cps.refresh}>{T('تحديث', 'Refresh')}</Btn>}>
    <div className="tbl-wrap"><table className="tbl">
      <thead><tr><th>{T('العقدة', 'Node')}</th><th>{T('الموقع', 'Location')}</th><th>{T('الاتصال', 'Connection')}</th><th>{T('حالة المرحّل المبلّغ عنها', 'Reported relay state')}</th><th>{T('وقت التقرير', 'Report time')}</th><th>{T('النطاق', 'Mode')}</th><th>{T('التفاصيل', 'Details')}</th></tr></thead>
      <tbody><tr className="clickable" onClick={() => mapTarget ? showOnMap(mapTarget) : openDrawer({ kind: 'node', id: state.node_id })}>
        <td><Ltr>{state.node_id}</Ltr></td>
        <td><Ltr>{state.location_id ?? '—'}</Ltr></td>
        <td><Chip tone={connectionTone}><Ltr>{state.connection_status}</Ltr></Chip></td>
        <td>{state.reported_relay_state === null
          ? <span className="muted">{relayReportLabel(age, T)}</span>
          : <><strong><Ltr>{state.reported_relay_state}</Ltr></strong><small className="block muted">{relayReportLabel(age, T)}</small></>}</td>
        <td className="nowrap"><Ltr>{state.relay_reported_at ? cpsTime(state.relay_reported_at, ui.lang) : '—'}</Ltr></td>
        <td><Chip tone="neutral">{T('مراقبة فقط', 'Monitoring only')}</Chip></td>
        <td><button type="button" className="elink" onClick={(event: MouseEvent) => { event.stopPropagation(); openDrawer({ kind: 'node', id: state.node_id }); }}>{T('تفاصيل العقدة', 'Node details')}</button></td>
      </tr></tbody>
    </table></div>
    <p className="fine">{T('هذه حالة مرحّل أبلغ عنها الجهاز ولا تؤكد تشغيل المروحة أو أي فعل مادي. لا توجد أوامر أو أتمتة تحكم في هذا العرض.', 'This is a device-reported relay state; it does not confirm fan operation or physical actuation. This view has no commands or control automation.')}</p>
  </Card>;
}

function DronesTable() {
  const { s } = useStore();
  const { T, tl, openIncident } = useUI();
  return (
    <Card title={T('حالة الطائرات المسيرة', 'Drone status')} icon="drone" sub={T('نفس سجل الاستجابة الميدانية', 'Same record as Field Response')}>
      <div className="tbl-wrap"><table className="tbl">
        <thead><tr><th>{T('الطائرة', 'Drone')}</th><th>{T('التوفر / المهمة', 'Availability / mission')}</th><th>{T('الاتصال', 'Connection')}</th><th>{T('البطارية', 'Battery')}</th><th>{T('المنطقة الحالية', 'Current zone')}</th><th>{T('الحادثة المرتبطة', 'Related incident')}</th></tr></thead>
        <tbody>{s.drones.map((d) => {
          const zone = droneZone(s, d);
          return (
            <tr key={d.id}>
              <td><Ltr>{d.id}</Ltr></td>
              <td>{tl(LABELS.drone[d.status])}</td>
              <td><StateBadge state={d.link === 'connected' ? 'normal' : 'offline'} label={tl(LABELS.droneLink[d.link])} /> <SimTag /></td>
              <td><span className={`batt${d.battery < 40 ? ' low' : ''}`}><span style={{ width: `${d.battery}%` }} /></span> <Ltr>{d.battery}%</Ltr></td>
              <td>{zone ? <Ltr>{zone}</Ltr> : <span className="muted">{d.status === 'deployed' ? T('في الطريق', 'In transit') : T('غير معروفة', 'Unknown')}</span>}</td>
              <td>{d.incidentId ? <button type="button" className="elink" onClick={() => openIncident(d.incidentId!)}><Ltr>{d.incidentId}</Ltr></button> : <span className="muted">—</span>}</td>
            </tr>
          );
        })}</tbody>
      </table></div>
      <p className="fine">{T('الإطلاق ودعم الحوادث يتمان من الاستجابة الميدانية داخل الحادثة. الانتقالات محاكاة.', 'Deployment and incident support are done from Field Response inside the incident. Transitions are simulated.')}</p>
    </Card>
  );
}

function Heartbeats() {
  const { T, openDrawer, ui } = useUI();
  const state = useCpsNodeState();
  const history = useCpsHeartbeatHistory();
  const refresh = () => { state.refresh(); history.refresh(); };
  const title = T('مراقبة النبضات — آخر 5 دقائق', 'Heartbeat monitoring — last 5 minutes');
  if (state.loading || history.loading) return <Card title={title} icon="heart" sub={<Ltr>NODE-04</Ltr>}><Empty icon="heart" title={T('جارٍ تحميل سجل نبضات CPS', 'Loading CPS heartbeat history')} /></Card>;
  if (!state.state || !history.history) return <Card title={title} icon="heart" sub={<Ltr>NODE-04</Ltr>} actions={<Btn small onClick={refresh}>{T('إعادة المحاولة', 'Retry')}</Btn>}>
    <Empty icon="heart" title={T('سجل نبضات CPS غير متاح', 'CPS heartbeat history unavailable')}><p className="fine">{history.error ?? state.error}</p></Empty>
  </Card>;

  const snapshotMs = Date.parse(history.history.as_of);
  const beats = [...history.history.items].reverse().map((item) => Date.parse(item.received_at));
  const lastReceipt = history.history.items[0]?.received_at ?? null;
  const fullWindow = hasFullHeartbeatWindowCoverage(history.history);
  const knownFrom = fullWindow ? snapshotMs - 5 * 60_000 : beats[0] ?? null;
  const connectionTone = state.state.connection_status === 'ONLINE' ? 'ok' : state.state.connection_status === 'STALE' ? 'warn' : state.state.connection_status === 'OFFLINE' ? 'off' : 'neutral';
  return <Card title={title} icon="heart"
    sub={T(`تُعرض الحالة الحالية من CPS؛ نافذة الرسم ${5} دقائق`, `Current status from CPS; ${5}-minute visualization window`)}
    actions={<Btn small onClick={refresh}>{T('تحديث', 'Refresh')}</Btn>}>
    {history.history.items.length ? <ul className="hb-list">
      <li>
        <button type="button" className="elink" onClick={() => openDrawer({ kind: 'node', id: state.state!.node_id })}><Ltr>{state.state.node_id}</Ltr></button>
        <span className="muted"><Ltr>{state.state.location_id ?? '—'}</Ltr></span>
        <HeartbeatStrip beats={beats} now={snapshotMs} knownFrom={knownFrom} timeoutMs={CONFIG.heartbeatTimeoutMs} label={T('نبضات NODE-04', 'NODE-04 heartbeats')} />
        <Chip tone={connectionTone}><Ltr>{state.state.connection_status}</Ltr></Chip>
        <span className="hb-ago"><Ltr>{lastReceipt ? receiptAge(lastReceipt, history.history.as_of) ?? '—' : '—'}</Ltr></span>
      </li>
    </ul> : <Empty icon="heart" title={T('لا يوجد سجل نبضات CPS', 'No CPS heartbeat history')}><p className="fine">{T('لا يعني غياب السجل انقطاعاً مؤكداً.', 'An empty history does not confirm an outage.')}</p></Empty>}
    <div className="hb-legend"><span><i className="beat" /> {T('نبضة', 'heartbeat')}</span><span><i className="gap" /> {T('فجوة مؤكدة بعد آخر نبضة ضمن السجل', 'confirmed gap after the latest recorded heartbeat')}</span></div>
    <p className="fine">{fullWindow
      ? T('يغطي السجل نافذة الخمس دقائق كاملة.', 'The returned history covers the full five-minute window.')
      : T('السجل قبل أقدم نبضة معروضة غير معروف؛ لا تُعرض الفترة غير المتاحة كفقد أو انقطاع.', 'History before the oldest returned heartbeat is unknown; unavailable coverage is not shown as loss or an outage.')}<br />
      {T('لقطة CPS: ', 'CPS snapshot: ')}<Ltr>{cpsTime(history.history.as_of, ui.lang)}</Ltr>
    </p>
  </Card>;
}

function Heatmaps() {
  const { T, ui, openDrawer, set } = useUI();
  const cps = useCpsNodeState();
  if (cps.loading) return <Card title={T('خريطة أجهزة CPS', 'CPS device map')} icon="pin" sub={<Ltr>NODE-04</Ltr>}><Empty icon="pin" title={T('جارٍ تحميل أجهزة CPS', 'Loading CPS devices')} /></Card>;
  if (!cps.state) return <Card title={T('خريطة أجهزة CPS', 'CPS device map')} icon="pin" sub={<Ltr>NODE-04</Ltr>} actions={<Btn small onClick={cps.refresh}>{T('إعادة المحاولة', 'Retry')}</Btn>}>
    <Empty icon="pin" title={T('أجهزة CPS غير متاحة', 'CPS devices unavailable')}><p className="fine">{cps.error}</p></Empty>
  </Card>;

  const device = operationalCpsMapDevice(cps.state);
  if (!device) return <Card title={T('خريطة أجهزة CPS', 'CPS device map')} icon="pin" sub={<Ltr>{cps.state.node_id}</Ltr>} actions={<Btn small onClick={cps.refresh}>{T('تحديث', 'Refresh')}</Btn>}>
    <Empty icon="pin" title={T('موقع الخريطة غير مُهيأ', 'Map location not configured')}><p className="fine"><Ltr>{cps.state.location_id ?? '—'}</Ltr></p></Empty>
  </Card>;

  const connectionTone = device.connectionStatus === 'ONLINE' ? 'ok' : device.connectionStatus === 'STALE' ? 'warn' : device.connectionStatus === 'OFFLINE' ? 'off' : 'neutral';
  const historical = device.connectionStatus === 'STALE' || device.connectionStatus === 'OFFLINE';
  const relayAge = relayReportAge(device.connectionStatus, device.reportedRelayState);
  const selectOnMap = (r: { kind: 'zone' | 'camera' | 'node' | 'sensor' | 'employee' | 'alert' | 'incident' | 'event'; id: string }) => {
    if (r.kind === 'zone') set({ scope: r.id });
    if (r.kind === 'zone' && r.id === device.rasidZoneId) openDrawer({ kind: 'node', id: device.nodeId });
    else openDrawer(r);
  };
  return <div className="grid2">
    <Card title={T('خريطة أجهزة CPS', 'CPS device map')} icon="pin" sub={<>{T('بيانات CPS فعلية · هندسة توضيحية', 'Real CPS Data · Illustrative geometry')} · <Ltr>{device.cpsLocationId}</Ltr>{' / '}<Ltr>{device.rasidZoneId}</Ltr></>}>
      <ExpoMap height={420} controls={false} legend={false} layers={[]} focus={{ ref: { kind: 'zone', id: device.rasidZoneId }, nonce: 1 }} onSelect={selectOnMap} />
      <p className="fine">{T('تحديد المنطقة على الخريطة يفتح تفاصيل NODE-04. لا يوجد موضع دقيق للجهاز ضمن المنطقة.', 'Selecting the zone opens NODE-04 details. No precise device position is claimed within the zone.')}</p>
    </Card>
    <Card title={T('أجهزة CPS في المنطقة', 'CPS devices in zone')} icon="sensor" sub={<><Ltr>{device.rasidZoneId}</Ltr> · <Ltr>{device.nodeId}</Ltr></>} actions={<Btn small onClick={() => openDrawer({ kind: 'node', id: device.nodeId })}>{T('تفاصيل العقدة', 'Node details')}</Btn>}>
      <div className="cps-status-row"><Chip tone={connectionTone}><Ltr>{device.connectionStatus}</Ltr></Chip><span>{historical ? (device.connectionStatus === 'OFFLINE' ? T('بيانات محفوظة تاريخياً', 'Historical stored data') : T('بيانات CPS قديمة', 'Stale CPS data')) : T('بيانات CPS المبلّغ عنها', 'CPS-reported data')}</span></div>
      <dl className="facts">
        <div className="field"><dt>{T('العقدة', 'Node')}</dt><dd><Ltr>{device.nodeId}</Ltr></dd></div>
        <div className="field"><dt>{T('آخر نبضة', 'Last heartbeat')}</dt><dd><Ltr>{cpsTime(device.lastHeartbeatReceivedAt, ui.lang)}</Ltr></dd></div>
      </dl>
      <h4>{T('حساس فعلي واحد', 'One physical sensor')}</h4>
      <div className="row wrap"><strong>BME280</strong><span className="muted">{T('3 قنوات قياس', '3 measurement channels')}</span></div>
      {device.readings.length ? <ul className="plain">{device.readings.map((reading) => <li key={reading.sensor_id}><strong><Ltr>{reading.sensor_id}</Ltr></strong> · <Ltr>{String(reading.value)} {reading.unit}</Ltr><small className="block muted">{historical ? (device.connectionStatus === 'OFFLINE' ? T('قراءة محفوظة تاريخياً', 'Historical stored reading') : T('قراءة قديمة', 'Stale reading')) : T('قراءة CPS المبلّغ عنها', 'CPS-reported reading')} · <Ltr>{cpsTime(reading.timestamp, ui.lang)}</Ltr></small></li>)}</ul> : <Empty title={T('لا توجد قراءات CPS متاحة', 'No CPS readings available')} />}
      <h4>{T('وحدة التكييف / المروحة', 'HVAC / fan unit')}</h4>
      <dl className="facts">
        <div className="field"><dt>{T('حالة المرحّل المبلّغ عنها', 'Reported relay state')}</dt><dd>{device.reportedRelayState === null ? <span className="muted">{relayReportLabel(relayAge, T)}</span> : <><strong><Ltr>{device.reportedRelayState}</Ltr></strong><small className="block muted">{relayReportLabel(relayAge, T)}</small></>}</dd></div>
        <div className="field"><dt>{T('وقت تقرير المرحّل', 'Relay report time')}</dt><dd><Ltr>{cpsTime(device.relayReportedAt, ui.lang)}</Ltr></dd></div>
      </dl>
      <p className="fine">{T('حالة المرحّل أبلغ عنها الجهاز ولا تؤكد تشغيل المروحة أو موضعاً دقيقاً لها على الخريطة. مراقبة فقط.', 'The relay state is device-reported; it does not confirm fan operation or a precise map position. Monitoring only.')}</p>
    </Card>
  </div>;
}
