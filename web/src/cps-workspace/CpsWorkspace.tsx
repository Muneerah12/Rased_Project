import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useStore, useUI } from '../state/store';
import { Btn, Card, Chip, Empty, Kpi, Ltr, SimTag, StateBadge, Tabs } from '../ui/primitives';
import { Icon } from '../ui/icons';
import { fetchCpsNodeState, latestReading } from '../services/cps';
import type { CpsNodeState, CpsReading, CpsReadingType } from '../services/cps';
import { activeApplicationCaptureCount, cameraCaptureLabel, cameraRegistryFromHost, canApplySimulationRecommendation, createInitialTwinState, CPS_SENSOR_IDS, evaluateSimulationExhaust, evaluateSimulationHvac, exhaustFanState, fetchCpsWorkspaceHeartbeats, fetchCpsWorkspaceReadings, heartbeatHistoryIsHistorical, historyCoverage, nocInventoryItems, SIMULATION_EXHAUST_POLICY, SIMULATION_HVAC_POLICY, simulatedFreshness, simulationEvaluationRequest, timestampedNumericPoints, twinReducer } from '.';
import type { CpsHeartbeatHistory, CpsReadingHistory, CpsSensorId, CpsWorkspaceTab } from '.';
import type { CpsWorkspaceCamera } from './cameraRegistry';
import { CPS_WORKSPACE_TABS } from './contracts';
import { CpsSimulationHall, visitorDisplayCount } from './CpsSimulationHall';
import { ReadingChart } from './ReadingChart';
import { CameraArt, DroneArt, NodeArt } from './KpiArt';
import { RiyadhSky, SensorTile } from './LiveVisuals';
import type { SensorKind } from './LiveVisuals';
import { HeartbeatAge, HeartbeatBadge, HeartbeatPulse } from './HeartbeatPulse';
import { HvacIntelligence } from '../pages/IoT';
import './cpsWorkspace.css';

export { CPS_WORKSPACE_TABS };

type CpsLoad = { value: CpsNodeState | null; loading: boolean; error: string | null; refresh: () => void };
function useCpsState(): CpsLoad {
  const [value, setValue] = useState<CpsNodeState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refresh = (silent = false) => {
    const controller = new AbortController(); if (!silent) { setLoading(true); setError(null); }
    void fetchCpsNodeState(controller.signal).then((next) => { setValue(next); setError(null); }).catch((cause: unknown) => { if (!controller.signal.aborted && !silent) { setValue(null); setError(cause instanceof Error ? cause.message : 'CPS data unavailable'); } }).finally(() => { if (!controller.signal.aborted && !silent) setLoading(false); });
    return () => controller.abort();
  };
  useEffect(() => refresh(), []);
  // Quiet refresh every 5 s keeps sensor readings and connection status live.
  useEffect(() => { const id = setInterval(() => { if (!document.hidden) refresh(true); }, 5_000); return () => clearInterval(id); }, []);
  return { value, loading, error, refresh: () => { refresh(); } };
}

function useHeartbeats(): { value: CpsHeartbeatHistory | null; loading: boolean; error: string | null; refresh: () => void } {
  const [value, setValue] = useState<CpsHeartbeatHistory | null>(null); const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null);
  const refresh = (silent = false) => { const controller = new AbortController(); if (!silent) { setLoading(true); setError(null); } void fetchCpsWorkspaceHeartbeats(controller.signal).then((next) => { setValue(next); setError(null); }).catch((cause: unknown) => { if (!controller.signal.aborted && !silent) { setValue(null); setError(cause instanceof Error ? cause.message : 'Heartbeat history unavailable'); } }).finally(() => { if (!controller.signal.aborted && !silent) setLoading(false); }); return () => controller.abort(); };
  useEffect(() => refresh(), []);
  // Quiet refresh every 5 s so the heart beats when a new heartbeat is received.
  useEffect(() => { const id = setInterval(() => { if (!document.hidden) refresh(true); }, 5_000); return () => clearInterval(id); }, []);
  return { value, loading, error, refresh: () => { refresh(); } };
}

const westernNumber = new Intl.NumberFormat('en-US', { useGrouping: false, maximumFractionDigits: 12 });
function formatNumber(value: number): string { return westernNumber.format(value); }
function formatCpsValue(value: number | string): string { const numeric = typeof value === 'number' ? value : Number(value); return Number.isFinite(numeric) ? formatNumber(numeric) : String(value); }
function formatTime(value: string | null, _lang: 'ar' | 'en'): string {
  if (!value) return '—';
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? '—' : new Intl.DateTimeFormat('en-GB', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'Asia/Riyadh',
  }).format(timestamp);
}
function connectionTone(status: CpsNodeState['connection_status'] | undefined): 'ok' | 'warn' | 'crit' | 'neutral' { return status === 'ONLINE' ? 'ok' : status === 'STALE' ? 'warn' : status === 'OFFLINE' ? 'crit' : 'neutral'; }
function latest(state: CpsNodeState, kind: CpsReadingType): CpsReading | null { return latestReading(state, kind); }

/** Unmounted CPS workspace. Its state and tabs never write to the host UI store. */
export function CpsWorkspace() {
  const { T, ui } = useUI();
  const { s } = useStore();
  const [tab, setTab] = useState<CpsWorkspaceTab>('overview');
  const cps = useCpsState();
  const heartbeats = useHeartbeats();
  const registry = useMemo(() => cameraRegistryFromHost(s.ai.connected, s.ai.cameras), [s.ai.connected, s.ai.cameras]);
  const tabs = CPS_WORKSPACE_TABS.map((item) => ({ id: item.id, label: T(item.label.ar, item.label.en) }));
  return <section className="cps-workspace" dir={ui.lang === 'ar' ? 'rtl' : 'ltr'} aria-label={T('مساحة عمليات CPS', 'CPS Operations workspace')}>
    <Tabs label={T('أنظمة CPS', 'CPS systems')} value={tab} onChange={setTab} tabs={tabs} />
    {tab === 'overview' && <CpsOverview cps={cps} registry={registry} lang={ui.lang} />}
    {tab === 'ot' && <CpsOt cps={cps} heartbeats={heartbeats} lang={ui.lang} />}
    {tab === 'iot' && <CpsIot registry={registry} />}
    {tab === 'noc' && <CpsNoc cps={cps} heartbeats={heartbeats} registry={registry} lang={ui.lang} />}
  </section>;
}

function CpsOverview({ cps, registry, lang }: { cps: CpsLoad; registry: ReturnType<typeof cameraRegistryFromHost>; lang: 'ar' | 'en' }) {
  const { T } = useUI(); const active = activeApplicationCaptureCount(registry); const state = cps.value;
  return <div className="cpsw-overview">
    <div className="kpis cpsw-kpis">
      <Kpi label={T('العقد المادية CPS', 'Physical CPS nodes')} glyph="router" value={state ? formatNumber(1) : T('غير متاح', 'Unavailable')} sub={state ? <><Ltr>NODE-04</Ltr> · {state.connection_status}</> : T('لا توجد بيانات CPS موثقة', 'No verified CPS data')} tone={connectionTone(state?.connection_status)} art={<NodeArt online={state?.connection_status === 'ONLINE'} />} />
      <Kpi label={T('كاميرات مسجلة', 'Registered cameras')} art={<CameraArt active={!!active && active > 0} />} glyph="cameras" value={registry.available ? formatNumber(registry.cameras.length) : T('غير متاح', 'Unavailable')} sub={active === null ? T('سجل الكاميرات غير متاح', 'Camera registry unavailable') : <><Ltr>{formatNumber(active)}</Ltr> {T('التقاط نشط', 'active capture')}</>} tone={active && active > 0 ? 'ok' : registry.available ? 'warn' : 'neutral'} />
      <Kpi label={T('الطائرات التشغيلية', 'Operational drones')} art={<DroneArt />} glyph="drone" value={<span className="kpi-word">{T('خارج الخدمة', 'Out of service')}</span>} sub={T('لا يوجد جرد تشغيلي موثّق للطائرات', 'No verified operational drone inventory')} tone="neutral" />
    </div>
     <CpsSensorSummary cps={cps} lang={lang} withWeather />
     <div className="cpsw-overview-secondary">
       <CpsCoverage state={state} />
       <OverviewCameraSummary registry={registry} />
     </div>
   </div>;
}

function CpsSensorSummary({ cps, lang, nodeScoped = false, withWeather = false }: { cps: CpsLoad; lang: 'ar' | 'en'; nodeScoped?: boolean; withWeather?: boolean }) {
  const { T } = useUI(); const state = cps.value; const history = useReadingHistory(state); const outside = useRiyadhWeather(withWeather);
  const [pressed, setPressed] = useState(false);
  const refreshing = pressed && (cps.loading || outside.loading);
  // Manual refresh pulls new sensor readings and, on the overview, new weather (it otherwise updates every 10 min).
  const refreshAll = () => { setPressed(true); cps.refresh(); if (withWeather) outside.refresh(); setTimeout(() => setPressed(false), 1200); };
  if (cps.loading && !state) return <Card title={T('ملخص حساس CPS', 'CPS sensor summary')} icon="thermo"><Empty icon="thermo" title={T('جارٍ التحميل', 'Loading')} /></Card>;
  if (!state) return <Card title={T('ملخص حساس CPS', 'CPS sensor summary')} icon="thermo" actions={<Btn small onClick={cps.refresh}>{T('إعادة المحاولة', 'Retry')}</Btn>}><Empty icon="thermo" title={T('بيانات CPS غير متاحة', 'CPS data unavailable')}><p className="fine">{cps.error}</p></Empty></Card>;
  const historical = state.connection_status !== 'ONLINE';
  return <Card className={`cpsw-sensor-summary${withWeather ? ' with-weather' : ''}`} title={withWeather ? T('الداخل والخارج', 'Inside & outside') : T('ملخص حساس CPS', 'CPS sensor summary')} icon="thermo" sub={nodeScoped ? undefined : <Ltr>NODE-04</Ltr>} actions={<button type="button" className={`btn b-default sm sn-refresh${refreshing ? ' spinning' : ''}`} onClick={refreshAll} disabled={refreshing} title={withWeather ? T('تحديث قراءات الحساس والطقس', 'Refresh sensor readings and weather') : T('تحديث قراءات الحساس', 'Refresh sensor readings')}><Icon name="refresh" size={14} />{refreshing ? T('جارٍ التحديث', 'Refreshing') : T('تحديث', 'Refresh')}</button>}>
    <p className={historical ? 'warnline' : 'fine'}>{!nodeScoped && <><Chip tone={connectionTone(state.connection_status)}>{state.connection_status}</Chip> </>}{historical ? T('قراءات محفوظة تاريخياً وليست مباشرة.', 'Stored historical readings — not live.') : T('قراءات CPS موثقة.', 'Verified CPS readings.')}</p>
    <div className="sn-grid">
      {(['temperature', 'humidity', 'pressure'] as const).map((kind) => { const reading = latest(state, kind); return <SensorTile key={kind} kind={kind} T={T} live={!historical}
        label={kind === 'temperature' ? T('درجة الحرارة', 'Temperature') : kind === 'humidity' ? T('الرطوبة', 'Humidity') : T('الضغط', 'Pressure')}
        value={reading ? Number(reading.value) : null} timestamp={reading?.timestamp ?? null} history={history[kind]} />; })}
      {withWeather && <OutsideWeatherTile weather={outside.weather} failed={outside.failed} />}
    </div>
    {withWeather && <InsideOutside inside={latest(state, 'temperature') ? Number(latest(state, 'temperature')!.value) : null} insideHumidity={latest(state, 'humidity') ? Number(latest(state, 'humidity')!.value) : null} weather={outside.weather} />}
    {!nodeScoped && <p className="fine">{T('آخر نبضة', 'Last heartbeat')}: <Ltr>{formatTime(state.last_heartbeat_received_at, lang)}</Ltr></p>}
  </Card>;
}

/** Keeps the readings seen while the page is open (seeded from the node state) for sparklines. */
function useReadingHistory(state: CpsNodeState | null): Record<SensorKind, { t: number; v: number }[]> {
  const [history, setHistory] = useState<Record<SensorKind, { t: number; v: number }[]>>({ temperature: [], humidity: [], pressure: [] });
  useEffect(() => {
    if (!state) return;
    setHistory((current) => {
      const next = { ...current };
      (['temperature', 'humidity', 'pressure'] as const).forEach((kind) => {
        const seen = new Map(current[kind].map((point) => [point.t, point]));
        state.readings.filter((reading) => reading.sensor_type === kind).forEach((reading) => { const t = Date.parse(reading.timestamp); const v = Number(reading.value); if (Number.isFinite(t) && Number.isFinite(v)) seen.set(t, { t, v }); });
        next[kind] = [...seen.values()].sort((a, b) => a.t - b.t).slice(-40);
      });
      return next;
    });
  }, [state]);
  return history;
}

type CurrentWeather = { temperature: number; humidity: number; windSpeed: number; weatherCode: number; isDay: boolean };
type WeatherCondition = { icon: string; ar: string; en: string };

function weatherCondition(code: number): WeatherCondition {
  if (code === 0) return { icon: '☀️', ar: 'صحو', en: 'Clear sky' };
  if ([1, 2].includes(code)) return { icon: '⛅', ar: 'غائم جزئياً', en: 'Partly cloudy' };
  if (code === 3) return { icon: '☁️', ar: 'غائم', en: 'Overcast' };
  if ([45, 48].includes(code)) return { icon: '🌫️', ar: 'ضباب', en: 'Fog' };
  if ([51, 53, 55, 56, 57].includes(code)) return { icon: '🌦️', ar: 'رذاذ', en: 'Drizzle' };
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return { icon: '🌧️', ar: 'أمطار', en: 'Rain' };
  if ([71, 73, 75, 77, 85, 86].includes(code)) return { icon: '❄️', ar: 'ثلوج', en: 'Snow' };
  if ([95, 96, 99].includes(code)) return { icon: '⛈️', ar: 'عواصف رعدية', en: 'Thunderstorm' };
  return { icon: '🌤️', ar: 'حالة الطقس غير متاحة', en: 'Condition unavailable' };
}

/** Live Riyadh weather from Open-Meteo: refreshed every 10 min, retried 30 s after a failure. */
function useRiyadhWeather(enabled = true): { weather: CurrentWeather | null; failed: boolean; loading: boolean; refresh: () => void } {
  const [weather, setWeather] = useState<CurrentWeather | null>(null); const [failed, setFailed] = useState(false); const [tick, setTick] = useState(0); const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!enabled) return undefined;
    const controller = new AbortController(); setLoading(true);
    void fetch('https://api.open-meteo.com/v1/forecast?latitude=24.7136&longitude=46.6753&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code,is_day', { signal: controller.signal })
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((body: { current?: { temperature_2m?: number; relative_humidity_2m?: number; wind_speed_10m?: number; weather_code?: number; is_day?: number } }) => {
        const current = body.current;
        if (typeof current?.temperature_2m === 'number' && typeof current.relative_humidity_2m === 'number' && typeof current.wind_speed_10m === 'number' && typeof current.weather_code === 'number') { setWeather({ temperature: current.temperature_2m, humidity: current.relative_humidity_2m, windSpeed: current.wind_speed_10m, weatherCode: current.weather_code, isDay: current.is_day !== 0 }); setFailed(false); }
        else setFailed(true);
      })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [tick, enabled]);
  useEffect(() => { if (!failed) return undefined; const id = setTimeout(() => setTick((n) => n + 1), 30_000); return () => clearTimeout(id); }, [failed, tick]);
  useEffect(() => { if (!enabled) return undefined; const id = setInterval(() => setTick((n) => n + 1), 600_000); return () => clearInterval(id); }, [enabled]);
  return { weather, failed, loading, refresh: () => setTick((n) => n + 1) };
}

/** Outside conditions as a fourth tile beside the indoor sensors, with the live sky behind it. */
function OutsideWeatherTile({ weather, failed }: { weather: CurrentWeather | null; failed: boolean }) {
  const { T, ui } = useUI();
  const condition = weather ? weatherCondition(weather.weatherCode) : null;
  if (!weather || !condition) return <div className="sn-tile sn-outside empty"><div className="sn-head"><span className="sn-icon"><Icon name="weather" size={17} /></span><span className="sn-label">{T('الخارج · الرياض', 'Outside · Riyadh')}</span></div><p className="fine">{failed ? T('الطقس غير متاح — إعادة المحاولة خلال 30 ث', 'Weather unavailable — retrying in 30 s') : T('جارٍ تحميل الطقس', 'Loading weather')}</p></div>;
  return <div className="sn-tile sn-outside">
    <RiyadhSky code={weather.weatherCode} isDay={weather.isDay} temperature={weather.temperature} windKmh={weather.windSpeed}>
      <div className="sno-body">
        <div className="sn-head"><span className="sn-label">{T('الخارج · الرياض', 'Outside · Riyadh')}</span><span className="sno-src">Open-Meteo</span></div>
        <div className="sn-value" dir="ltr"><strong>{weather.temperature.toFixed(1)}</strong><span>°C</span></div>
        <span className="sno-cond">{ui.lang === 'ar' ? condition.ar : condition.en}{weather.isDay ? '' : T(' · ليلاً', ' · night')}</span>
        <div className="sno-stats"><span>{T('الرطوبة', 'Humidity')} <Ltr>{formatNumber(weather.humidity)}%</Ltr></span><span>{T('الرياح', 'Wind')} <Ltr>{formatNumber(weather.windSpeed)} km/h</Ltr></span></div>
      </div>
    </RiyadhSky>
  </div>;
}

/** One-line inside vs outside comparison. */
function InsideOutside({ inside, insideHumidity, weather }: { inside: number | null; insideHumidity: number | null; weather: CurrentWeather | null }) {
  const { T } = useUI();
  if (inside === null || !weather) return null;
  const diff = weather.temperature - inside;
  const temp = Math.abs(diff) < 0.5 ? T('الداخل والخارج بنفس الحرارة تقريباً', 'Inside and outside are about the same temperature')
    : diff > 0 ? T(`الداخل أبرد بـ ${diff.toFixed(1)}° من الخارج`, `Inside is ${diff.toFixed(1)}° cooler than outside`)
    : T(`الداخل أدفأ بـ ${Math.abs(diff).toFixed(1)}° من الخارج`, `Inside is ${Math.abs(diff).toFixed(1)}° warmer than outside`);
  return <div className="sn-compare">
    <span className={`sn-compare-temp ${diff > 0 ? 'cooler' : 'warmer'}`}><Icon name="temperature" size={15} />{temp}</span>
    {insideHumidity !== null && <span><Icon name="droplet" size={15} />{T('الرطوبة', 'Humidity')}: {T('داخل', 'inside')} <Ltr>{insideHumidity.toFixed(0)}%</Ltr> · {T('خارج', 'outside')} <Ltr>{formatNumber(weather.humidity)}%</Ltr></span>}
  </div>;
}

/** Sub-zones of the node's hall. The CPS location model has 4 per hall (e.g. A1-1 … A1-4). */
function hallSubzones(locationId: string | null): { hall: string; subzones: string[] } | null {
  const match = locationId?.match(/^([A-Z]\d+)-\d+$/);
  return match ? { hall: match[1], subzones: [1, 2, 3, 4].map((n) => `${match[1]}-${n}`) } : null;
}

function CpsCoverage({ state }: { state: CpsNodeState | null }) {
  const { T } = useUI();
  const layout = hallSubzones(state?.location_id ?? null);
  if (!state || !layout) return <Card className="cpsw-coverage-card" title={T('تغطية الحساسات', 'Sensor coverage')} icon="pin"><div className="cpsw-lower-unavailable"><Icon name="offline" size={18} /><span>{T('لا توجد تغطية موثقة متاحة.', 'No verified coverage available.')}</span></div></Card>;
  const online = state.connection_status === 'ONLINE';
  const covered = 1; const pct = Math.round((covered / layout.subzones.length) * 100);
  return <Card className="cpsw-coverage-card ov-card" title={T('تغطية الحساسات', 'Sensor coverage')} icon="pin" sub={<Chip tone={connectionTone(state.connection_status)}>{state.connection_status}</Chip>}>
    <div className="ov-coverage">
      <div className="ov-cov-stat">
        <strong><Ltr>{covered} / {layout.subzones.length}</Ltr></strong>
        <span>{T(`مناطق فرعية مغطاة في القاعة ${layout.hall}`, `sub-zones covered in hall ${layout.hall}`)}</span>
        <i className="ov-bar"><i style={{ width: `${pct}%` }} /></i>
        <small><Ltr>{pct}%</Ltr> {T('تغطية', 'coverage')}</small>
      </div>
      <div className="ov-hall" role="img" aria-label={T(`القاعة ${layout.hall}: ${state.location_id} مغطاة بـ NODE-04`, `Hall ${layout.hall}: ${state.location_id} covered by NODE-04`)}>
        {layout.subzones.map((code) => { const here = code === state.location_id;
          return <div key={code} className={`ov-sub ${here ? 'covered' : ''} ${here && online ? 'online' : ''}`}>
            <span className="ov-sub-code"><Ltr>{code}</Ltr></span>
            {here ? <><span className="ov-radar" aria-hidden="true"><i /><i /></span><span className="ov-node"><Icon name="router" size={14} /><Ltr>NODE-04</Ltr></span></> : <span className="ov-empty">{T('بدون حساس', 'No sensor')}</span>}
          </div>; })}
      </div>
    </div>
  </Card>;
}

function OverviewCameraSummary({ registry }: { registry: ReturnType<typeof cameraRegistryFromHost> }) {
  const { T } = useUI();
  if (!registry.available) return <Card className="cpsw-camera-summary-card" title={T('ملخص الكاميرات', 'Camera summary')} icon="cameras"><div className="cpsw-lower-unavailable"><Icon name="offline" size={18} /><span>{T('سجل الكاميرات غير متاح', 'Camera registry unavailable')}</span></div></Card>;
  const total = registry.cameras.length;
  const active = registry.cameras.filter((camera) => camera.active).length;
  const errors = registry.cameras.filter((camera) => !camera.active && camera.error).length;
  const inactive = total - active - errors;
  // Donut: circumference of r=15.9 is ~100, so each segment length is its share in percent.
  const share = (n: number) => (total ? (n / total) * 100 : 0);
  const segs = [{ n: active, cls: 'ok' }, { n: errors, cls: 'err' }, { n: inactive, cls: 'idle' }];
  let offset = 0;
  return <Card className="cpsw-camera-summary-card ov-card" title={T('ملخص الكاميرات', 'Camera summary')} icon="cameras" sub={<><Ltr>{formatNumber(total)}</Ltr> {T('مسجّلة', 'registered')}</>}>
    <div className="ov-cams">
      <svg className="ov-donut" viewBox="0 0 42 42" role="img" aria-label={T(`${active} تعمل من ${total}`, `${active} of ${total} running`)}>
        <circle className="track" cx="21" cy="21" r="15.9" />
        {segs.map((s) => { const len = share(s.n); const el = len > 0 ? <circle key={s.cls} className={`seg ${s.cls}`} cx="21" cy="21" r="15.9" strokeDasharray={`${len} ${100 - len}`} strokeDashoffset={25 - offset} /> : null; offset += len; return el; })}
        <text x="21" y="21.5" textAnchor="middle" className="num">{active}/{total}</text>
        <text x="21" y="27" textAnchor="middle" className="cap">{T('تعمل', 'running')}</text>
      </svg>
      <div className="ov-cam-side">
        <div className="ov-legend">
          <span><i className="ok" />{T('تعمل', 'Running')} <b><Ltr>{formatNumber(active)}</Ltr></b></span>
          <span><i className="idle" />{T('متوقفة', 'Stopped')} <b><Ltr>{formatNumber(inactive)}</Ltr></b></span>
          {errors > 0 && <span><i className="err" />{T('خطأ', 'Error')} <b><Ltr>{formatNumber(errors)}</Ltr></b></span>}
        </div>
        <div className="ov-chips">{registry.cameras.map((camera) => <span key={camera.id} className={`ov-chip ${camera.active ? 'ok' : camera.error ? 'err' : 'idle'}`} title={camera.active ? T('تعمل', 'Running') : camera.error ? T('خطأ', 'Error') : T('متوقفة', 'Stopped')}><i /><Ltr>{camera.id}</Ltr></span>)}</div>
      </div>
    </div>
  </Card>;
}

function CameraCard({ registry }: { registry: ReturnType<typeof cameraRegistryFromHost> }) {
  const { T } = useUI(); if (!registry.available) return <Card title={T('كاميرات وطائرات راصد', 'RASID cameras and drones')} icon="cameras"><Empty icon="cameras" title={T('سجل الكاميرات غير متاح', 'Camera registry unavailable')} /></Card>;
  return <Card title={T('كاميرات وطائرات راصد', 'RASID cameras and drones')} icon="cameras" sub={<><Ltr>{formatNumber(registry.cameras.length)}</Ltr> {T('كاميرات مسجلة', 'registered cameras')}</>}><p className="fine">{T('نشاط الإطار يثبت وصوله للتطبيق فقط، وليس صحة الكاميرا أو اتصال الشبكة.', 'Frame activity only proves arrival at the application, not camera health or network connectivity.')}</p><ul className="cpsw-camera-list">{registry.cameras.map((camera) => <li key={camera.id}><Ltr>{camera.id}</Ltr><Chip tone={camera.active ? 'ok' : camera.error ? 'crit' : 'neutral'}>{camera.active ? T('التقاط نشط', 'Active capture') : camera.error ? T('خطأ تطبيق', 'Application error') : T('غير نشطة', 'Not active')}</Chip></li>)}</ul><p className="fine"><SimTag /> {T('الطائرات المحاكاة مستبعدة من الجرد التشغيلي.', 'Simulated drones are excluded from operational inventory.')}</p></Card>;
}

function CpsOt({ cps, heartbeats, lang }: { cps: CpsLoad; heartbeats: ReturnType<typeof useHeartbeats>; lang: 'ar' | 'en' }) {
  const { T } = useUI(); const [area, setArea] = useState<'real' | 'simulation'>('real');
  return <div className="cpsw-stack">
    <Tabs label={T('مساحة التشغيل التقني', 'OT workspace')} value={area} onChange={setArea} tabs={[
      { id: 'real', label: T('التشغيل الفعلي', 'Real Operations') },
      { id: 'simulation', label: T('مركز المحاكاة', 'Simulation Center') },
    ]} />
    {area === 'real' ? <CpsRealOperations cps={cps} heartbeats={heartbeats} lang={lang} /> : <CpsSimulationCenter />}
  </div>;
}

function CpsRealOperations({ cps, heartbeats, lang }: { cps: CpsLoad; heartbeats: ReturnType<typeof useHeartbeats>; lang: 'ar' | 'en' }) {
  const { T } = useUI();
  return <div className="cpsw-stack">
    <p className="fine"><Chip tone="info">{T('بيانات CPS فعلية', 'Real CPS data')}</Chip> {T('تُعرض البيانات الموثقة فقط؛ حالة المرحل للمراقبة ولا يوجد تحكم.', 'Only verified CPS data is shown; relay state is monitoring-only and has no control.')}</p>
    <HvacIntelligence />
    <CpsTechnicalDetails cps={cps} heartbeats={heartbeats} lang={lang} />
  </div>;
}

function CpsSimulationCenter() {
  const { T } = useUI(); const [twin, dispatch] = useReducer(twinReducer, createInitialTwinState());
  const temperature = twin.sensors.find((sensor) => sensor.id === 'SIM-SENSOR-TEMP-01');
  const humidity = twin.sensors.find((sensor) => sensor.id === 'SIM-SENSOR-HUM-01');
  const node = twin.nodes[0]; const fan = twin.actuators.find((item) => item.id === 'SIM-ACTUATOR-FAN-01'); const fanState = fan?.state ?? 'UNAVAILABLE';
  const exhaustState = exhaustFanState(twin); const exhaust = evaluateSimulationExhaust(twin);
  const people = twin.scenarioInputs.simulatedPeopleCount; const tempC = temperature?.value ?? 0; const online = node?.connectionStatus === 'ONLINE';
  const renderedVisitors = visitorDisplayCount(people);
  const freshness = simulatedFreshness(temperature?.observedAt, twin.simulatedNow);
  const evaluation = twin.latestEvaluation?.response.evaluation;
  const canApply = canApplySimulationRecommendation(twin);
  const canApplyExhaust = exhaust.recommendation === 'TURN_EXHAUST_ON' || exhaust.recommendation === 'TURN_EXHAUST_OFF';
  const setTemp = (value: number) => dispatch({ type: 'SET_SIMULATED_TEMPERATURE', value: Math.round(Math.min(36, Math.max(16, value)) * 10) / 10 });
  const setPeople = (value: number) => dispatch({ type: 'SET_SIMULATED_PEOPLE_COUNT', value: Math.min(40, Math.max(0, value)) });
  // One run = one simulated minute passes and the sensor reports again, so the
  // 60 s minimum between fan changes can elapse and the reading stays fresh.
  const runSimulation = () => {
    let next = twinReducer(twin, { type: 'ADVANCE_SIMULATED_TIME', seconds: 60 });
    next = twinReducer(next, { type: 'SET_SIMULATED_TEMPERATURE', value: tempC });
    const request = simulationEvaluationRequest(next); const generation = next.evaluationGeneration + 1;
    dispatch({ type: 'ADVANCE_SIMULATED_TIME', seconds: 60 });
    dispatch({ type: 'SET_SIMULATED_TEMPERATURE', value: tempC });
    dispatch({ type: 'BEGIN_SIMULATION_EVALUATION' });
    dispatch({ type: 'SET_SIMULATION_EVALUATION', value: evaluateSimulationHvac(request), request, generation });
  };
  const threat = twin.simulatedThreat;
  const fireProtocolDone = threat?.kind === 'fire' && exhaustState === 'ON' && fanState === 'OFF';
  const threatText = threat?.kind === 'fire'
    ? { title: T('حريق', 'Fire'), detail: T(`رصدت ${threat.cameraId} لهباً ودخاناً قرب الجناح 1.`, `${threat.cameraId} detected flames and smoke near pavilion 1.`), steps: [T('أبلغ الدفاع المدني وفرق الطوارئ', 'Notify civil defense and emergency teams'), T('أخلِ الزوار عبر المدخل الرئيسي', 'Evacuate visitors through the main entrance'), T('شغّل مراوح الشفط لطرد الدخان وأوقف مراوح التدوير حتى لا ينتشر', 'Turn exhaust fans on to clear smoke and circulation fans off so it does not spread')] }
    : threat?.kind === 'weapon'
      ? { title: T('شخص مسلح', 'Armed person'), detail: T(`رصدت ${threat.cameraId} شخصاً يحمل سلاحاً في الساحة الوسطى.`, `${threat.cameraId} detected a person carrying a weapon in the central plaza.`), steps: [T('أرسل فريق الأمن فوراً وأبلغ الشرطة', 'Dispatch security now and notify police'), T('أبعد الزوار عن الساحة الوسطى', 'Move visitors away from the central plaza'), T('تابع الشخص عبر الكاميرات', 'Track the person on camera')] }
      : threat
        ? { title: T('شجار', 'Fight'), detail: T(`رصدت ${threat.cameraId} شجاراً بين شخصين في الممر.`, `${threat.cameraId} detected two people fighting in the aisle.`), steps: [T('أرسل فريق الأمن إلى الموقع', 'Send security to the location'), T('أبعد الزوار المحيطين', 'Clear nearby visitors'), T('احفظ اللقطة كدليل', 'Save the footage as evidence')] }
        : { title: '', detail: '', steps: [] as string[] };
  const onC = SIMULATION_HVAC_POLICY.fanOnTemperatureC, offC = SIMULATION_HVAC_POLICY.fanOffTemperatureC;
  const exOn = SIMULATION_EXHAUST_POLICY.onAtVisitors, exOff = SIMULATION_EXHAUST_POLICY.offAtVisitors;
  const decisionText = evaluation?.recommendation === 'TURN_FAN_ON'
    ? T(`الحرارة ${formatNumber(tempC)}° وصلت حد التشغيل (${onC}°) — شغّل مراوح التدوير.`, `Temperature ${formatNumber(tempC)}° reached the on limit (${onC}°) — turn the circulation fans on.`)
    : evaluation?.recommendation === 'TURN_FAN_OFF'
      ? T(`الحرارة انخفضت إلى ${formatNumber(tempC)}° (حد الإيقاف ${offC}°) — أوقف مراوح التدوير.`, `Temperature fell to ${formatNumber(tempC)}° (off limit ${offC}°) — turn the circulation fans off.`)
      : evaluation?.recommendation === 'HOLD'
        ? T('لا تغيير: مراوح التدوير على الحالة المناسبة.', 'No change: the circulation fans are already right.')
        : evaluation?.recommendation === 'INSUFFICIENT_DATA'
          ? T('لا توصية: العقدة غير متصلة أو القراءة غير صالحة.', 'No recommendation: the node is offline or the reading is not valid.')
          : fanState === 'ON' ? T('مراوح التدوير تعمل. اضغط «تشغيل المحاكاة» لإعادة التقييم.', 'The circulation fans are running. Press "Run simulation" to re-evaluate.')
          : T('غيّر حالة المنطقة ثم اضغط «تشغيل المحاكاة».', 'Change the zone, then press "Run simulation".');
  const exhaustText = exhaust.recommendation === 'TURN_EXHAUST_ON'
    ? T(`${formatNumber(people)} زائر (الحد ${exOn}) — شغّل مراوح الشفط لتجديد الهواء.`, `${formatNumber(people)} visitors (limit ${exOn}) — turn the exhaust fans on to refresh the air.`)
    : exhaust.recommendation === 'TURN_EXHAUST_OFF'
      ? T(`انخفض العدد إلى ${formatNumber(people)} زائر — يمكن إيقاف مراوح الشفط.`, `Visitors dropped to ${formatNumber(people)} — the exhaust fans can be turned off.`)
      : exhaust.recommendation === 'INSUFFICIENT_DATA'
        ? T('لا توصية: العقدة غير متصلة.', 'No recommendation: the node is offline.')
        : exhaustState === 'ON' ? T('مراوح الشفط تعمل والزحام ما زال مرتفعاً.', 'The exhaust fans are on and the crowd is still high.') : T(`الزحام أقل من ${exOn} زائر — لا حاجة للشفط.`, `Fewer than ${exOn} visitors — no exhaust needed.`);
  return <div className="cpsw-simulation-center">
    <p className="fine"><SimTag /> {T('محاكاة محلية فقط — لا توجد أجهزة أو أوامر فعلية.', 'Simulation only — no real devices or commands.')}</p>
    <section className="cpsw-sim-experience" aria-label={T('تجربة المحاكاة', 'Simulation experience')}>
      <Card title={T('منطقة إكسبو A1.1 الافتراضية', 'Virtual Expo zone A1.1')} icon="iot" sub={<SimTag>{T('اصطناعية', 'Synthetic')}</SimTag>}>
        <CpsSimulationHall temperatureC={tempC} peopleCount={people} connectionStatus={node?.connectionStatus ?? 'OFFLINE'} fanState={fanState} exhaustState={exhaustState} threat={twin.simulatedThreat} />
        <div className="xz-statuses">
          <div className="xz-status"><span>{T('الزوار', 'Visitors')}</span><strong><Ltr>{formatNumber(people)}</Ltr></strong><small>{renderedVisitors < people ? T(`يظهر ${formatNumber(renderedVisitors)}`, `Showing ${formatNumber(renderedVisitors)}`) : T('في المنطقة', 'In the zone')}</small></div>
          <div className={`xz-status ${tempC >= onC ? 'hot' : tempC <= 22 ? 'cool' : ''}`}><span>{T('الحرارة', 'Temperature')}</span><strong><Ltr>{formatNumber(tempC)} °C</Ltr></strong><small>{T('حساس العقدة', 'Node sensor')}</small></div>
          <div className={`xz-status ${fanState === 'ON' ? 'on' : ''}`}><span>{T('مراوح التدوير', 'Circulation fans')}</span><strong><Ltr>2 × {fanState}</Ltr></strong><small>{fanState === 'ON' ? T('تحرك الهواء داخل المنطقة', 'Moving air inside the zone') : T('متوقفة', 'Off')}</small></div>
          <div className={`xz-status ${exhaustState === 'ON' ? 'on' : ''}`}><span>{T('مراوح الشفط', 'Exhaust fans')}</span><strong><Ltr>2 × {exhaustState}</Ltr></strong><small>{exhaustState === 'ON' ? T('تسحب الهواء للخارج', 'Pulling air outside') : T('متوقفة', 'Off')}</small></div>
          <div className={`xz-status ${threat ? 'alarm' : people > 0 ? 'watch' : ''}`}><span>{T('كاميرات CCTV', 'CCTV cameras')}</span><strong><Ltr>{threat ? threat.cameraId : '3'}</Ltr></strong><small>{threat ? threatText.title : people > 0 ? T('ترصد الزوار', 'Watching visitors') : T('لا حركة', 'No movement')}</small></div>
        </div>
      </Card>
      <div className="xz-controls">
        <button type="button" className="cpsw-sim-control warm" onClick={() => setTemp(tempC + 2)}><Icon name="thermo" size={24} /><strong>{T('رفع الحرارة +2°', 'Heat +2°')}</strong></button>
        <button type="button" className="cpsw-sim-control cool" onClick={() => setTemp(tempC - 2)}><Icon name="thermo" size={24} /><strong>{T('خفض الحرارة −2°', 'Cool −2°')}</strong></button>
        <button type="button" className="cpsw-sim-control crowd" onClick={() => setPeople(people + 6)}><Icon name="crowd" size={24} /><strong>{T('إضافة 6 زوار', 'Add 6 visitors')}</strong></button>
        <button type="button" className="cpsw-sim-control leave" onClick={() => setPeople(people - 6)}><Icon name="crowd" size={24} /><strong>{T('خروج 6 زوار', '6 visitors leave')}</strong></button>
        {online
          ? <button type="button" className="cpsw-sim-control failure" onClick={() => dispatch({ type: 'SET_SIMULATED_CONNECTION', value: 'OFFLINE' })}><Icon name="offline" size={24} /><strong>{T('قطع اتصال العقدة', 'Disconnect node')}</strong></button>
          : <button type="button" className="cpsw-sim-control reconnect" onClick={() => dispatch({ type: 'SET_SIMULATED_CONNECTION', value: 'ONLINE' })}><Icon name="router" size={24} /><strong>{T('إعادة اتصال العقدة', 'Reconnect node')}</strong></button>}
        <button type="button" className="cpsw-sim-control reset" onClick={() => dispatch({ type: 'RESET_SIMULATION' })}><Icon name="arrow" size={24} /><strong>{T('إعادة ضبط', 'Reset')}</strong></button>
      </div>
      <div className="xa-controls" role="group" aria-label={T('سيناريوهات كشف الذكاء الاصطناعي', 'AI detection scenarios')}>
        <span className="xa-controls-title"><Icon name="cameras" size={16} />{T('سيناريوهات كشف الذكاء الاصطناعي', 'AI detection scenarios')} <SimTag /></span>
        <button type="button" className={`xa-btn fire ${threat?.kind === 'fire' ? 'on' : ''}`} onClick={() => dispatch({ type: 'SIMULATE_THREAT', kind: 'fire' })}><Icon name="flame" size={18} />{T('حريق', 'Fire')}</button>
        <button type="button" className={`xa-btn weapon ${threat?.kind === 'weapon' ? 'on' : ''}`} onClick={() => dispatch({ type: 'SIMULATE_THREAT', kind: 'weapon' })}><Icon name="gun" size={18} />{T('شخص مسلح', 'Armed person')}</button>
        <button type="button" className={`xa-btn fight ${threat?.kind === 'fight' ? 'on' : ''}`} onClick={() => dispatch({ type: 'SIMULATE_THREAT', kind: 'fight' })}><Icon name="crowd" size={18} />{T('شجار', 'Fight')}</button>
        <button type="button" className="xa-btn clear" disabled={!threat} onClick={() => dispatch({ type: 'CLEAR_THREAT' })}><Icon name="check" size={18} />{T('مسح الحادثة', 'Clear incident')}</button>
      </div>
      <Card className="cpsw-sim-decision" title={T('قرار RASID', 'RASID Decision')} icon="hvac" actions={<Btn kind="primary" icon="thermo" onClick={runSimulation}>{T('تشغيل المحاكاة', 'Run simulation')}</Btn>}>
        {threat && <section className={`xa-decision ${threat.kind}`}>
          <h4><Icon name={threat.kind === 'fire' ? 'flame' : threat.kind === 'weapon' ? 'gun' : 'crowd'} size={18} />{T('كشف الذكاء الاصطناعي', 'AI detection')}: {threatText.title} <small><Ltr>{threat.cameraId} · {Math.round(threat.confidence * 100)}%</Ltr> <SimTag /></small></h4>
          <p>{threatText.detail}</p>
          <ul>{threatText.steps.map((step) => <li key={step}>{step}</li>)}</ul>
          {threat.kind === 'fire' && <Btn kind="danger" icon="hvac" disabled={fireProtocolDone} onClick={() => dispatch({ type: 'APPLY_FIRE_PROTOCOL' })}>{fireProtocolDone ? T('تم تطبيق التحكم بالدخان', 'Smoke control applied') : T('طبّق التحكم بالدخان: شفط ON · تدوير OFF', 'Apply smoke control: exhaust ON · circulation OFF')}</Btn>}
        </section>}
        <div className="xz-decisions">
          <section className={`xz-decision ${evaluation?.recommendation === 'TURN_FAN_ON' || evaluation?.recommendation === 'TURN_FAN_OFF' ? 'act' : ''}`}>
            <h4><Icon name="hvac" size={16} />{T('مراوح التدوير', 'Circulation fans')} <small>{T(`تعمل من ${onC}° وتتوقف عند ${offC}°`, `On from ${onC}°, off at ${offC}°`)}</small></h4>
            <p>{decisionText}</p>
            {canApply && <Btn kind="primary" icon="check" onClick={() => dispatch({ type: 'APPLY_SIMULATION_RECOMMENDATION' })}>{evaluation?.recommendation === 'TURN_FAN_ON' ? T('شغّل مراوح التدوير', 'Turn circulation fans ON') : T('أوقف مراوح التدوير', 'Turn circulation fans OFF')}</Btn>}
          </section>
          <section className={`xz-decision ${canApplyExhaust ? 'act' : ''}`}>
            <h4><Icon name="crowd" size={16} />{T('مراوح الشفط', 'Exhaust fans')} <small>{T(`تعمل من ${exOn} زائر وتتوقف عند ${exOff}`, `On from ${exOn} visitors, off at ${exOff}`)}</small></h4>
            <p>{exhaustText}</p>
            {canApplyExhaust && <Btn kind="primary" icon="check" onClick={() => dispatch({ type: 'APPLY_EXHAUST_RECOMMENDATION' })}>{exhaust.recommendation === 'TURN_EXHAUST_ON' ? T('شغّل مراوح الشفط', 'Turn exhaust fans ON') : T('أوقف مراوح الشفط', 'Turn exhaust fans OFF')}</Btn>}
          </section>
        </div>
        <p className="fine"><SimTag /> {T('كل تشغيل يمثّل دقيقة محاكاة. لا يُطبّق أي قرار تلقائياً أو على جهاز فعلي.', 'Each run is one simulated minute. No decision is applied automatically or to a physical device.')} <Ltr>{twin.simulatedNow.slice(11, 16)}</Ltr></p>
      </Card>
    </section>
    <details className="cpsw-sim-advanced"><summary>{T('تفاصيل تقنية اختيارية', 'Technical details (optional)')}</summary><p className="fine"><SimTag /> {T('كل القيم والمعرفات التالية اصطناعية ومحلية للتشخيص فقط.', 'All following values and identifiers are synthetic and browser-local for diagnostics only.')}</p>
      <div className="cpsw-grid">
        <Card title={T('بيئة التوأم الافتراضية', 'Virtual twin environment')} icon="iot" sub={<SimTag>{T('محلي فقط', 'Browser-local only')}</SimTag>}><dl className="cpsw-network"><div><dt>{T('السياق', 'Context')}</dt><dd><Ltr>{twin.context}</Ltr></dd></div><div><dt>{T('التحكم الفعلي', 'Physical control')}</dt><dd>{T('غير متاح', 'Unavailable')}</dd></div></dl></Card>
        <Card title={T('العقدة الافتراضية', 'Virtual node')} icon="router" sub={<SimTag>{T('اصطناعية', 'Synthetic')}</SimTag>}><p><Ltr>{node?.id ?? '—'}</Ltr></p><Chip tone={node?.connectionStatus === 'ONLINE' ? 'ok' : node?.connectionStatus === 'STALE' ? 'warn' : 'crit'}>{node?.connectionStatus ?? 'OFFLINE'}</Chip></Card>
        <Card title={T('مدخلات HVAC الاصطناعية', 'Synthetic HVAC inputs')} icon="thermo" sub={<SimTag>{T('محلي فقط', 'Browser-local only')}</SimTag>}><div className="cpsw-sim-fields"><label>{T('الحرارة الافتراضية', 'Virtual temperature')}<input dir="ltr" type="number" step="0.1" value={temperature?.value ?? ''} onChange={(event: { currentTarget: HTMLInputElement }) => dispatch({ type: 'SET_SIMULATED_TEMPERATURE', value: event.currentTarget.valueAsNumber })} /></label><label>{T('الرطوبة الافتراضية', 'Virtual humidity')}<input dir="ltr" type="number" step="0.1" value={humidity?.value ?? ''} onChange={(event: { currentTarget: HTMLInputElement }) => dispatch({ type: 'SET_SIMULATED_HUMIDITY', value: event.currentTarget.valueAsNumber })} /></label><label>{T('عدد الزوار الافتراضي', 'Virtual visitor count')}<input dir="ltr" type="number" min="0" step="1" value={twin.scenarioInputs.simulatedPeopleCount} onChange={(event: { currentTarget: HTMLInputElement }) => dispatch({ type: 'SET_SIMULATED_PEOPLE_COUNT', value: event.currentTarget.valueAsNumber })} /></label><label>{T('اتصال العقدة الافتراضية', 'Virtual node connection')}<select value={node?.connectionStatus ?? 'OFFLINE'} onChange={(event: { currentTarget: HTMLSelectElement }) => dispatch({ type: 'SET_SIMULATED_CONNECTION', value: event.currentTarget.value as 'ONLINE' | 'STALE' | 'OFFLINE' })}><option value="ONLINE">ONLINE</option><option value="STALE">STALE</option><option value="OFFLINE">OFFLINE</option></select></label></div></Card>
        <Card title={T('وقت المحاكاة', 'Simulation time')} icon="clock" sub={<SimTag>{T('لا تحكم فعلي', 'No physical control')}</SimTag>}><p><Ltr>{twin.simulatedNow}</Ltr></p><p className="fine">{T('حداثة الحرارة', 'Temperature freshness')}: <Chip tone={freshness === 'FRESH' ? 'ok' : freshness === 'STALE' ? 'warn' : 'neutral'}><Ltr>{freshness}</Ltr></Chip></p><div className="cpsw-actions"><Btn small onClick={() => dispatch({ type: 'ADVANCE_SIMULATED_TIME', seconds: 10 })}><Ltr>+10s</Ltr></Btn><Btn small onClick={() => dispatch({ type: 'ADVANCE_SIMULATED_TIME', seconds: 60 })}><Ltr>+60s</Ltr></Btn></div><p className="fine">{T('السياسة محلية وتستخدم المدخلات الاصطناعية فقط.', 'The policy is local and uses synthetic inputs only.')}</p></Card>
      </div>
    </details>
  </div>;
}

function CpsIot({ registry }: { registry: ReturnType<typeof cameraRegistryFromHost> }) {
  const { T } = useUI();
  return <div className="cpsw-stack">
    <CameraCard registry={registry} />
    <Card title={T('أجهزة إنترنت الأشياء الأخرى', 'Other IoT devices')} icon="sensor"><Empty icon="sensor" title={T('لا يوجد جرد موثق لأجهزة IoT أخرى', 'No verified inventory of other IoT devices')} /></Card>
  </div>;
}

function CpsTechnicalDetails({ cps, heartbeats, lang }: { cps: CpsLoad; heartbeats: ReturnType<typeof useHeartbeats>; lang: 'ar' | 'en' }) {
  return <NodeDetailsWorkspace cps={cps} heartbeats={heartbeats} lang={lang} />;
}

function NodeDetailsWorkspace({ cps, heartbeats, lang }: { cps: CpsLoad; heartbeats: ReturnType<typeof useHeartbeats>; lang: 'ar' | 'en' }) {
  const { T } = useUI(); const state = cps.value;
  if (!state) return <Card title={<Ltr>NODE-04</Ltr>} icon="router"><Empty icon="router" title={T('تفاصيل العقدة غير متاحة', 'Node details unavailable')} /></Card>;
  return <div className="cpsw-node-workspace">
    <Card className={`cpsw-node-identity cpsw-node-${connectionTone(state.connection_status)}`} title={<Ltr>NODE-04</Ltr>} icon="router" sub={T('تفاصيل العقدة الفعلية', 'Real node details')}>
      <div className="cpsw-node-identity-fields">
        <div><span>{T('المنطقة', 'Zone')}</span><strong><Ltr>{state.location_id ?? '—'}</Ltr></strong></div>
        <div><span>{T('الاتصال', 'Connection')}</span><Chip tone={connectionTone(state.connection_status)}>{state.connection_status}</Chip></div>
        <div><span>{T('آخر تقرير CPS', 'Last CPS report')}</span><strong><Ltr>{formatTime(state.as_of, lang)}</Ltr></strong></div>
      </div>
    </Card>
    <div className="cpsw-node-details">
      <CpsSensorSummary cps={cps} lang={lang} nodeScoped />
      <HistoryPanel state={state} lang={lang} />
      <HeartbeatHistoryCard heartbeats={heartbeats} state={state} lang={lang} />
      <NetworkObservationCard state={state} lang={lang} />
      <ActuatorCard state={state} lang={lang} />
    </div>
  </div>;
}

const HISTORY_SENSORS: Record<CpsSensorId, { ar: string; en: string; unit: string; color: string }> = {
  'TEMP-01': { ar: 'الحرارة', en: 'Temperature', unit: '°C', color: 'var(--high)' },
  'HUM-01': { ar: 'الرطوبة', en: 'Humidity', unit: '%', color: 'var(--info)' },
  'PRESS-01': { ar: 'الضغط', en: 'Pressure', unit: 'hPa', color: 'var(--emp)' },
};
const HISTORY_RANGES = [{ hours: 6, ar: 'آخر 6 ساعات', en: 'Last 6 hours' }, { hours: 24, ar: 'آخر 24 ساعة', en: 'Last 24 hours' }, { hours: 168, ar: 'آخر 7 أيام', en: 'Last 7 days' }] as const;
/** Pages of 200 readings loaded per range; readings arrive about every 20 s per sensor. */
const HISTORY_MAX_PAGES: Record<6 | 24 | 168, number> = { 6: 10, 24: 30, 168: 40 };

function HistoryPanel({ state, lang }: { state: CpsNodeState; lang: 'ar' | 'en' }) {
  const { T } = useUI(); const [sensorId, setSensorId] = useState<CpsSensorId>('TEMP-01'); const [range, setRange] = useState<6 | 24 | 168>(6); const [history, setHistory] = useState<CpsReadingHistory | null>(null); const [error, setError] = useState<string | null>(null); const [loading, setLoading] = useState(false); const [capped, setCapped] = useState(false);
  const window = useMemo(() => { const end = Date.parse(state.as_of); return Number.isFinite(end) ? { start: new Date(end - range * 60 * 60_000).toISOString(), end: new Date(end).toISOString() } : null; }, [state.as_of, range]);
  useEffect(() => {
    if (!window) return; const controller = new AbortController(); setError(null); setHistory(null); setLoading(true); setCapped(false);
    // Readings come newest first; keep paging until the window start is reached or the page cap is hit.
    void (async () => {
      let acc: CpsReadingHistory | null = null; let cursor: string | null = null;
      for (let page = 0; page < HISTORY_MAX_PAGES[range]; page += 1) {
        const next = await fetchCpsWorkspaceReadings({ sensorId, start: window.start, end: window.end, limit: 200, cursor, signal: controller.signal });
        acc = acc ? { ...next, items: [...acc.items, ...next.items] } : next;
        if (controller.signal.aborted) return;
        setHistory(acc); cursor = next.next_cursor;
        if (!cursor) break;
      }
      if (cursor && !controller.signal.aborted) setCapped(true);
    })().catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'History unavailable'); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [sensorId, range, window?.start, window?.end]);
  const points = timestampedNumericPoints(history?.items ?? []); const coverage = historyCoverage(history?.items ?? null, window?.start ?? '');
  const sensor = HISTORY_SENSORS[sensorId];
  const earliest = points.length ? formatTime(points[0].timestamp, lang) : null;
  return <Card title={T('سجل القراءات', 'Reading history')} icon="thermo"><section className="cpsw-history">
    <div className="rc-controls">
      <div className="rc-seg" role="tablist">{CPS_SENSOR_IDS.map((id) => <button key={id} type="button" role="tab" aria-selected={id === sensorId} className={id === sensorId ? 'on' : ''} onClick={() => setSensorId(id)}>{T(HISTORY_SENSORS[id].ar, HISTORY_SENSORS[id].en)} <small dir="ltr">{HISTORY_SENSORS[id].unit}</small></button>)}</div>
      <div className="rc-seg">{HISTORY_RANGES.map((r) => <button key={r.hours} type="button" className={r.hours === range ? 'on' : ''} onClick={() => setRange(r.hours)}>{T(r.ar, r.en)}</button>)}</div>
    </div>
    {state.connection_status !== 'ONLINE' && <p className="warnline"><Chip tone={connectionTone(state.connection_status)}>{state.connection_status}</Chip> {T('الحساس غير متصل الآن؛ هذه قراءات سابقة.', 'The sensor is offline now; these are past readings.')}</p>}
    {error ? <p className="warnline">{error}</p>
      : !history ? <p className="fine">{T('جارٍ تحميل القراءات…', 'Loading readings…')}</p>
      : !points.length ? <p className="fine">{T('لا توجد قراءات في هذه الفترة.', 'No readings in this period.')}</p>
      : <>
        <ReadingChart points={points} unit={sensor.unit} color={sensor.color} startMs={Date.parse(window!.start)} endMs={Date.parse(window!.end)} lang={lang} T={T} />
        <p className="fine">{loading ? T('جارٍ تحميل باقي الفترة…', 'Loading the rest of the period…')
          : capped ? <>{T('عدد القراءات كبير؛ يعرض المخطط أحدثها بدءاً من', 'Too many readings; the chart shows the latest, starting from')} <Ltr>{earliest}</Ltr></>
          : coverage === 'PARTIAL' ? <>{T('أقدم قراءة متوفرة في هذه الفترة:', 'Earliest reading available in this period:')} <Ltr>{earliest}</Ltr></>
          : T('تغطي القراءات الفترة كاملة.', 'Readings cover the whole period.')}</p>
        <details className="rc-table"><summary>{T('جدول القراءات (آخر 100)', 'Readings table (latest 100)')}</summary><div className="cpsw-history-table-wrap"><table className="cpsw-history-table"><thead><tr><th>{T('الوقت', 'Time')}</th><th>{T('القيمة', 'Value')}</th><th>{T('التحقق', 'Validation')}</th></tr></thead><tbody>{history.items.slice(0, 100).map((reading) => <tr key={`${reading.timestamp}-${reading.value}`}><td><Ltr>{formatTime(reading.timestamp, lang)}</Ltr></td><td><Ltr>{formatCpsValue(reading.value)} {reading.unit}</Ltr></td><td>{reading.validation_status}</td></tr>)}</tbody></table></div></details>
      </>}
  </section></Card>;
}

function NetworkObservationCard({ state, lang }: { state: CpsNodeState; lang: 'ar' | 'en' }) {
  const { T } = useUI(); const network = state.network_observation;
  return <Card title={T('آخر ملاحظات الشبكة', 'Latest network observation')} icon="signal"><p className={state.connection_status === 'ONLINE' ? 'fine' : 'warnline'}><Chip tone={connectionTone(state.connection_status)}>{state.connection_status}</Chip> {network?.reported_at ? T('قيم مُبلّغ عنها من الجهاز وليست فحصاً مباشراً للشبكة.', 'Device-reported values, not a live network probe.') : T('لا يوجد تقرير شبكة موثق.', 'No verified network report.')}</p><dl className="cpsw-network">{[['IP', network?.reported_ip], ['MAC', network?.reported_mac], ['RSSI', network?.reported_rssi_dbm == null ? null : `${formatNumber(network.reported_rssi_dbm)} dBm`], ['SSID', network?.reported_ssid], ['BSSID', network?.reported_bssid], [T('القناة', 'Channel'), network?.reported_wifi_channel == null ? null : formatNumber(network.reported_wifi_channel)], [T('البوابة', 'Gateway'), network?.reported_gateway], [T('قناع الشبكة', 'Subnet mask'), network?.reported_subnet_mask]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd data-cps-network-identifier><Ltr>{value ?? '—'}</Ltr></dd></div>)}</dl><p className="fine">{T('وقت التقرير', 'Report time')}: <Ltr>{formatTime(network?.reported_at ?? null, lang)}</Ltr></p></Card>;
}

function ActuatorCard({ state, lang }: { state: CpsNodeState | null; lang: 'ar' | 'en' }) { const { T } = useUI(); return <Card title={T('وحدة التكييف / المروحة', 'HVAC / fan unit')} icon="hvac">{state?.reported_relay_state ? <><StateBadge state={state.reported_relay_state === 'ON' ? 'normal' : 'offline'} label={state.reported_relay_state} /><p className="fine">{T('حالة المرحل مُبلّغ عنها من الجهاز ولا تثبت تشغيل المروحة فعلياً.', 'Relay state is device-reported and does not prove physical fan operation.')}</p><p className="fine"><Ltr>{formatTime(state.relay_reported_at, lang)}</Ltr></p></> : <Empty icon="hvac" title={T('لا توجد حالة مرحل مُبلّغ عنها', 'No reported relay state')} />}</Card>; }
type HeartbeatTimeFilter = 'all' | '1h' | '6h' | '24h';
const HEARTBEAT_LIMITS = [5, 10, 20, 50] as const;
const HEARTBEAT_WINDOWS: Record<Exclude<HeartbeatTimeFilter, 'all'>, number> = { '1h': 60 * 60_000, '6h': 6 * 60 * 60_000, '24h': 24 * 60 * 60_000 };

function HeartbeatHistoryCard({ heartbeats, state, lang }: { heartbeats: ReturnType<typeof useHeartbeats>; state: CpsNodeState; lang: 'ar' | 'en' }) {
  const { T } = useUI(); const [expanded, setExpanded] = useState(false); const [limit, setLimit] = useState<typeof HEARTBEAT_LIMITS[number]>(10); const [timeFilter, setTimeFilter] = useState<HeartbeatTimeFilter>('all'); const [filterNow, setFilterNow] = useState(() => Date.now());
  const refresh = () => { setFilterNow(Date.now()); heartbeats.refresh(); };
  if (heartbeats.loading) return <Card className="cpsw-heartbeat-history" title={T('سجل النبضات', 'Heartbeat history')} icon="signal"><p className="fine">{T('جارٍ تحميل سجل استلام نبضات NODE-04', 'Loading NODE-04 heartbeat receipt history')}</p></Card>;
  if (!heartbeats.value) return <Card className="cpsw-heartbeat-history" title={T('سجل النبضات', 'Heartbeat history')} icon="signal" actions={<Btn small onClick={refresh}>{T('إعادة المحاولة', 'Retry')}</Btn>}><Empty icon="signal" title={T('سجل النبضات غير متاح', 'Heartbeat history unavailable')}><p className="fine">{heartbeats.error}</p></Empty></Card>;
  const history = heartbeats.value; const historical = heartbeatHistoryIsHistorical(state.connection_status); const cutoff = timeFilter === 'all' ? null : filterNow - HEARTBEAT_WINDOWS[timeFilter]; const filtered = cutoff === null ? history.items : history.items.filter((item) => Date.parse(item.received_at) >= cutoff); const visible = filtered.slice(0, limit);
  return <Card className="cpsw-heartbeat-history" title={T('سجل النبضات', 'Heartbeat history')} icon="signal" actions={<Btn small onClick={refresh}>{T('تحديث', 'Refresh')}</Btn>}>
    {history.items.length > 0 && <HeartbeatPulse receipts={history.items} T={T} />}
    <p className={historical ? 'warnline' : 'fine'}>{historical ? T('سجل الاستلام أدناه تاريخي ولا يثبت اتصال العقدة الحالي.', 'The receipt history below is historical and does not prove current node connectivity.') : T('سجل استلام مؤرخ؛ الاستلام يثبت التسليم في وقته فقط.', 'Timestamped receipt history; a receipt proves delivery only at that time.')}</p>
    {!history.items.length ? <Empty icon="signal" title={T('لا توجد نبضات ضمن السجل المعاد', 'No heartbeat receipts in the returned history')} /> : <>
      <div className="cpsw-heartbeat-summary"><span>{T('آخر استلام', 'Last receipt')}: <Ltr>{formatTime(history.items[0]?.received_at ?? null, lang)}</Ltr></span><span><Ltr>{formatNumber(history.items.length)}</Ltr> {T('سجل متاح', 'available records')}</span><Btn small kind="ghost" onClick={() => { setFilterNow(Date.now()); setExpanded((current) => !current); }}>{expanded ? T('طي السجل', 'Collapse') : T('توسيع السجل', 'Expand')}</Btn></div>
      {expanded && <div className="cpsw-heartbeat-expanded"><div className="cpsw-heartbeat-filters"><label>{T('عدد السجلات', 'Records')}<select dir="ltr" value={limit} onChange={(event: { currentTarget: HTMLSelectElement }) => setLimit(Number(event.currentTarget.value) as typeof HEARTBEAT_LIMITS[number])}>{HEARTBEAT_LIMITS.map((item) => <option key={item} value={item}>{formatNumber(item)}</option>)}</select></label><label>{T('الفترة الزمنية', 'Time range')}<select value={timeFilter} onChange={(event: { currentTarget: HTMLSelectElement }) => { setFilterNow(Date.now()); setTimeFilter(event.currentTarget.value as HeartbeatTimeFilter); }}><option value="all">{T('كل المتاح', 'All available')}</option><option value="1h">{T('آخر ساعة', 'Last 1 hour')}</option><option value="6h">{T('آخر 6 ساعات', 'Last 6 hours')}</option><option value="24h">{T('آخر 24 ساعة', 'Last 24 hours')}</option></select></label></div><p className="fine">{T('تُطبّق الفلاتر على السجلات المعادة حالياً فقط (حتى 50)، وليس على كامل قاعدة البيانات التاريخية.', 'Filters apply only to currently returned records (up to 50), not necessarily the complete historical database.')}</p>{!visible.length ? <Empty icon="signal" title={T('لا توجد نبضات ضمن الفترة المحددة', 'No heartbeat receipts in the selected period')} /> : <div className="cpsw-heartbeat-receipts"><div className="cpsw-heartbeat-receipts-head"><strong>{T('طوابع الاستلام', 'Receipt timestamps')}</strong><span><Ltr>{formatNumber(visible.length)}</Ltr> / <Ltr>{formatNumber(filtered.length)}</Ltr> {T('سجل · الأحدث أولاً', 'records · newest first')}</span></div><div className="cpsw-heartbeat-receipts-scroll"><table><thead><tr><th>{T('وقت الاستلام', 'Receipt time')}</th></tr></thead><tbody>{visible.map((item) => <tr key={item.received_at}><td><Ltr>{formatTime(item.received_at, lang)}</Ltr></td></tr>)}</tbody></table></div></div>}</div>}
    </>}
  </Card>;
}

type NocSelection = { kind: 'node' } | { kind: 'camera'; id: string };

function CpsNoc({ cps, heartbeats, registry, lang }: { cps: CpsLoad; heartbeats: ReturnType<typeof useHeartbeats>; registry: ReturnType<typeof cameraRegistryFromHost>; lang: 'ar' | 'en' }) {
  const { T } = useUI(); const state = cps.value; const [selection, setSelection] = useState<NocSelection | null>(null); const closeRef = useRef<HTMLButtonElement | null>(null);
  const selectedCamera = selection?.kind === 'camera' && registry.available ? registry.cameras.find((camera) => camera.id === selection.id) ?? null : null;
  useEffect(() => { if ((selection?.kind === 'camera' && !selectedCamera) || (selection?.kind === 'node' && !state)) setSelection(null); }, [selection, selectedCamera, state]);
  useEffect(() => {
    if (!selection) return undefined;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setSelection(null); };
    window.addEventListener('keydown', onKeyDown); return () => window.removeEventListener('keydown', onKeyDown);
  }, [selection]);
  const active = activeApplicationCaptureCount(registry);
  const inventory = useMemo(() => nocInventoryItems(state, registry), [state, registry]);
  const node = inventory.find((item) => item.kind === 'node');
  const cameras = inventory.filter((item) => item.kind === 'camera');
  const receipts = heartbeats.value?.items ?? [];
  const rssi = state?.network_observation.reported_rssi_dbm ?? null;
  const signal = rssiQuality(rssi, T);
  return <div className="cpsw-noc">
    <div className="noc-status">
      <div className={`noc-tile ${state?.connection_status === 'ONLINE' ? 'ok' : state ? 'crit' : ''}`}><Icon name="router" size={20} /><div><span>{T('الأجهزة المتصلة', 'Connected devices')}</span><strong dir="ltr">{state ? `${state.connection_status === 'ONLINE' ? 1 : 0} / 1` : '—'}</strong><small>{state ? <><Ltr>NODE-04</Ltr> · <Ltr>{state.connection_status}</Ltr></> : T('حالة CPS غير متاحة', 'CPS state unavailable')}</small></div></div>
      <div className="noc-tile"><HeartbeatBadge receipts={receipts} T={T} text={false} /><div><span>{T('آخر نبضة', 'Last heartbeat')}</span><strong>{receipts.length ? <HeartbeatAge receipts={receipts} T={T} /> : '—'}</strong><small>{T('تحديث كل 5 ثوانٍ', 'Updates every 5 s')}</small></div></div>
      <div className={`noc-tile ${signal.tone}`}><SignalBars level={signal.level} /><div><span>{T('إشارة Wi-Fi', 'Wi-Fi signal')}</span><strong>{signal.label}</strong><small dir="ltr">{rssi === null ? '—' : `${formatNumber(rssi)} dBm`}{state?.network_observation.reported_ssid ? ` · ${state.network_observation.reported_ssid}` : ''}</small></div></div>
      <div className="noc-tile"><Icon name="cameras" size={20} /><div><span>{T('الكاميرات', 'Cameras')}</span><strong dir="ltr">{registry.available ? `${formatNumber(active ?? 0)} / ${formatNumber(registry.cameras.length)}` : '—'}</strong><small>{registry.available ? T('تعمل الآن / مسجلة', 'running / registered') : T('سجل الكاميرات غير متاح', 'Camera registry unavailable')}</small></div></div>
    </div>

    <div className="noc-panels">
      <Card title={<Ltr>NODE-04</Ltr>} icon="router" sub={state ? <Chip tone={connectionTone(state.connection_status)}><Ltr>{state.connection_status}</Ltr></Chip> : undefined}
        actions={node ? <Btn small onClick={() => setSelection({ kind: 'node' })}>{T('التفاصيل', 'Details')}</Btn> : undefined}>
        {!state ? <Empty icon="offline" title={T('حالة NODE-04 غير متاحة', 'NODE-04 state is unavailable')}><p className="fine">{cps.loading ? T('جارٍ تحميل حالة NODE-04.', 'Loading NODE-04 state.') : cps.error}</p></Empty> : <>
          {receipts.length > 0 ? <HeartbeatPulse receipts={receipts} T={T} bare /> : <p className="fine">{T('لا توجد سجلات نبض بعد.', 'No heartbeat records yet.')}</p>}
          <dl className="noc-facts">
            <div><dt>{T('المنطقة', 'Zone')}</dt><dd><Ltr>{state.location_id ?? '—'}</Ltr></dd></div>
            <div><dt>{T('عنوان IP', 'IP address')}</dt><dd><Ltr>{state.network_observation.reported_ip ?? '—'}</Ltr></dd></div>
            <div><dt>{T('الشبكة', 'Network')}</dt><dd><Ltr>{state.network_observation.reported_ssid ?? '—'}</Ltr></dd></div>
            <div><dt>MAC</dt><dd><Ltr>{state.network_observation.reported_mac ?? '—'}</Ltr></dd></div>
          </dl>
          <p className="fine">{T('قيم الشبكة يُبلّغ عنها الجهاز نفسه.', 'Network values are reported by the device itself.')}</p>
        </>}
      </Card>

      <Card title={T('الكاميرات', 'Cameras')} icon="cameras" sub={registry.available ? <Chip tone="neutral"><Ltr>{formatNumber(registry.cameras.length)}</Ltr> {T('مسجلة', 'registered')}</Chip> : undefined}>
        {!registry.available ? <p className="fine">{T('سجل الكاميرات غير متاح حالياً؛ لا يعرض هذا جرداً صفرياً.', 'The camera registry is currently unavailable; this is not shown as a zero inventory.')}</p>
          : !cameras.length ? <p className="fine">{T('لا توجد كاميرات مسجلة في سجل التطبيق الحالي.', 'No cameras are registered in the current application registry.')}</p>
          : <div className="noc-cams" role="list" aria-label={T('جرد الكاميرات', 'Camera inventory')}>
            {cameras.map((item) => { const label = item.kind === 'camera' ? cameraCaptureLabel(item.camera) : 'idle'; return <button key={item.id} type="button" role="listitem" className={`noc-cam ${label}`} onClick={() => setSelection({ kind: 'camera', id: item.id })} aria-haspopup="dialog">
              <Icon name="camera" size={18} /><strong><Ltr>{item.id}</Ltr></strong>
              <span><i />{label === 'active' ? T('تعمل', 'Running') : label === 'error' ? T('خطأ', 'Error') : T('متوقفة', 'Stopped')}</span>
            </button>; })}
          </div>}
        <p className="fine">{T('«تعمل» تعني أن التطبيق يحلل إطاراتها؛ لا يثبت ذلك وصول الكاميرا عبر الشبكة.', '"Running" means the app is analysing its frames; it does not prove network reachability.')}</p>
      </Card>
    </div>
    {selection?.kind === 'node' && state && <NocDeviceDetails selection={selection} state={state} heartbeats={heartbeats} lang={lang} closeRef={closeRef} onClose={() => setSelection(null)} />}
    {selection?.kind === 'camera' && selectedCamera && <NocDeviceDetails selection={selection} camera={selectedCamera} closeRef={closeRef} onClose={() => setSelection(null)} />}
  </div>;
}

/** Plain-language Wi-Fi strength from RSSI (dBm). */
function rssiQuality(rssi: number | null, T: (ar: string, en: string) => string): { level: number; label: string; tone: string } {
  if (rssi === null) return { level: 0, label: '—', tone: '' };
  if (rssi >= -60) return { level: 4, label: T('ممتازة', 'Excellent'), tone: 'ok' };
  if (rssi >= -70) return { level: 3, label: T('جيدة', 'Good'), tone: 'ok' };
  if (rssi >= -80) return { level: 2, label: T('متوسطة', 'Fair'), tone: 'warn' };
  return { level: 1, label: T('ضعيفة', 'Weak'), tone: 'crit' };
}

function SignalBars({ level }: { level: number }) {
  return <span className="noc-bars" aria-hidden="true">{[1, 2, 3, 4].map((bar) => <i key={bar} className={bar <= level ? 'on' : ''} style={{ height: `${bar * 25}%` }} />)}</span>;
}

function NocDeviceDetails({ selection, state, camera, heartbeats, lang, closeRef, onClose }: { selection: NocSelection; state?: CpsNodeState; camera?: CpsWorkspaceCamera; heartbeats?: ReturnType<typeof useHeartbeats>; lang?: 'ar' | 'en'; closeRef: { current: HTMLButtonElement | null }; onClose: () => void }) {
  const { T } = useUI(); const isNode = selection.kind === 'node' && !!state;
  return <aside className="cpsw-noc-drawer" role="dialog" aria-modal="false" aria-labelledby="cpsw-noc-details-title">
    <header><div><span>{T('تفاصيل الجهاز', 'Device details')}</span><strong id="cpsw-noc-details-title"><Ltr>{isNode ? 'NODE-04' : camera?.id ?? ''}</Ltr></strong></div><button ref={closeRef} type="button" className="btn b-ghost sm" onClick={onClose} aria-label={T('إغلاق تفاصيل الجهاز', 'Close device details')}>{T('إغلاق', 'Close')}</button></header>
    {isNode && state && <div className="cpsw-noc-drawer-body">
      <p className={state.connection_status === 'ONLINE' ? 'fine' : 'warnline'}><Chip tone={connectionTone(state.connection_status)}><Ltr>{state.connection_status}</Ltr></Chip> {T('حالة الاتصال من CPS هي المرجع الحالي للعقدة.', 'The CPS connection status is authoritative for the current node state.')}</p>
      <dl className="cpsw-noc-details-grid"><div><dt>{T('العقدة', 'Node')}</dt><dd><Ltr>NODE-04</Ltr></dd></div><div><dt>{T('المنطقة', 'Zone')}</dt><dd><Ltr>{state.location_id ?? '—'}</Ltr></dd></div><div><dt>{T('آخر استلام نبضة', 'Last heartbeat receipt')}</dt><dd><Ltr>{formatTime(state.last_heartbeat_received_at, lang ?? 'en')}</Ltr></dd></div><div><dt>{T('لقطة حالة CPS', 'CPS state snapshot')}</dt><dd><Ltr>{formatTime(state.as_of, lang ?? 'en')}</Ltr></dd></div></dl>
      <section className="cpsw-noc-network-details"><h4>{T('ملاحظات شبكة NODE-04', 'NODE-04 network observations')}</h4><p className="fine">{T('القيم أدناه مُبلّغ عنها من الجهاز وليست فحصاً مباشراً للشبكة.', 'The values below are device-reported, not an active network verification.')}</p><dl className="cpsw-network">{[['IP', state.network_observation.reported_ip], ['MAC', state.network_observation.reported_mac], ['RSSI', state.network_observation.reported_rssi_dbm == null ? null : `${formatNumber(state.network_observation.reported_rssi_dbm)} dBm`], ['SSID', state.network_observation.reported_ssid], ['BSSID', state.network_observation.reported_bssid], [T('القناة', 'Channel'), state.network_observation.reported_wifi_channel == null ? null : formatNumber(state.network_observation.reported_wifi_channel)], [T('البوابة', 'Gateway'), state.network_observation.reported_gateway], [T('قناع الشبكة', 'Subnet mask'), state.network_observation.reported_subnet_mask]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd data-cps-network-identifier><Ltr>{value ?? '—'}</Ltr></dd></div>)}</dl><p className="fine">{T('وقت تقرير الشبكة', 'Network report time')}: <Ltr>{formatTime(state.network_observation.reported_at, lang ?? 'en')}</Ltr></p></section>
      {heartbeats && <HeartbeatHistoryCard heartbeats={heartbeats} state={state} lang={lang ?? 'en'} />}
    </div>}
    {!isNode && camera && <div className="cpsw-noc-drawer-body"><p className="fine">{T('هذه معلومات تطبيق راصد المتاحة؛ لا تثبت اتصال الكاميرا بالشبكة.', 'This is available RASID application information; it does not prove camera network connectivity.')}</p><dl className="cpsw-noc-details-grid"><div><dt>{T('الكاميرا', 'Camera')}</dt><dd><Ltr>{camera.id}</Ltr></dd></div><div><dt>{T('المصدر', 'Source')}</dt><dd><Ltr>{camera.source}</Ltr></dd></div><div><dt>{T('التقاط التطبيق', 'Application capture')}</dt><dd>{camera.active ? T('نشط', 'Active') : T('غير نشط', 'Not active')}</dd></div><div><dt>{T('معدل الإطارات', 'FPS')}</dt><dd><Ltr>{formatNumber(camera.fps)}</Ltr></dd></div><div><dt>{T('الوصول للشبكة', 'Network reachability')}</dt><dd>{T('غير متاح — لا يوجد عقد موثوق', 'Unavailable — no trusted contract')}</dd></div></dl>{camera.error && <p className="warnline">{T('خطأ التطبيق', 'Application error')}: <Ltr>{camera.error}</Ltr></p>}{camera.alerts.length > 0 && <section className="cpsw-noc-camera-alerts"><h4>{T('تنبيهات التطبيق', 'Application alerts')}</h4><ul>{camera.alerts.map((alert) => <li key={alert}><Ltr>{alert}</Ltr></li>)}</ul></section>}{camera.alerts.length === 0 && <p className="fine">{T('لا توجد تنبيهات تطبيق مُبلّغ عنها.', 'No application alerts are reported.')}</p>}</div>}
  </aside>;
}
