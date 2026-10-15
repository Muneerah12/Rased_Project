import { useCallback, useEffect, useRef, useState } from 'react';
import type { CpsConnectionStatus, CpsNodeState, CpsReadingType } from '../services/cps';
import { fetchCpsNodeState, latestReading } from '../services/cps';
import { useStore, useUI } from '../state/store';
import { Card, Chip, Empty, Ltr } from './primitives';
import { Icon } from './icons';

const POLL_MS = 15_000;

type CpsLoad = {
  state: CpsNodeState | null;
  loading: boolean;
  unavailable: boolean;
  refresh: () => void;
};

function useCpsNodeState(): CpsLoad {
  const [state, setState] = useState<CpsNodeState | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [generation, setGeneration] = useState(0);
  const inFlight = useRef(false);
  const refresh = useCallback(() => setGeneration((value) => value + 1), []);

  useEffect(() => {
    let disposed = false;
    let controller: AbortController | null = null;
    const load = async () => {
      if (disposed || inFlight.current) return;
      inFlight.current = true;
      controller = new AbortController();
      try {
        const next = await fetchCpsNodeState(controller.signal);
        if (!disposed) { setState(next); setUnavailable(false); }
      } catch (error) {
        if (!disposed && !(error instanceof DOMException && error.name === 'AbortError')) {
          setState(null);
          setUnavailable(true);
        }
      } finally {
        inFlight.current = false;
        controller = null;
        if (!disposed) setLoading(false);
      }
    };
    void load();
    const timer = window.setInterval(() => { void load(); }, POLL_MS);
    return () => { disposed = true; window.clearInterval(timer); controller?.abort(); };
  }, [generation]);

  return { state, loading, unavailable, refresh };
}

function connectionTone(status: CpsConnectionStatus): 'ok' | 'warn' | 'off' {
  return status === 'ONLINE' ? 'ok' : status === 'STALE' ? 'warn' : 'off';
}

function statusLabel(status: CpsConnectionStatus, T: (ar: string, en: string) => string): string {
  if (status === 'ONLINE') return T('قراءات CPS الحالية', 'Current CPS readings');
  if (status === 'STALE') return T('بيانات CPS قديمة', 'CPS data is stale');
  return T('قراءات محفوظة تاريخياً — العقدة غير متصلة', 'Historical stored readings — node is offline');
}

function timeText(timestamp: string, lang: 'ar' | 'en'): string {
  return new Date(timestamp).toLocaleString(lang === 'ar' ? 'en-GB' : 'en-US', {
    year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'UTC', timeZoneName: 'short',
  });
}

function CpsMetric({ type, icon, state }: { type: CpsReadingType; icon: 'thermo' | 'sensor' | 'signal'; state: CpsNodeState }) {
  const { T, ui } = useUI();
  const label: Record<CpsReadingType, string> = {
    temperature: T('درجة الحرارة', 'Temperature'), humidity: T('الرطوبة', 'Humidity'), pressure: T('الضغط', 'Pressure'),
  };
  const reading = latestReading(state, type);
  return <div className="operational-overview-reading">
    <span><Icon name={icon} size={15} />{label[type]}</span>
    {reading ? <>
      <strong><Ltr>{reading.value} {reading.unit}</Ltr></strong>
      <small><Ltr>{timeText(reading.timestamp, ui.lang)}</Ltr></small>
      <small>{T('التحقق', 'Validation')}: <Ltr>{reading.validation_status}</Ltr></small>
    </> : <small className="muted">{T('غير متاح', 'Unavailable')}</small>}
  </div>;
}

function CpsNodeCard() {
  const { T } = useUI();
  const cps = useCpsNodeState();
  if (cps.loading) return <Card title={T('ملخص حساسات CPS', 'CPS sensor summary')} icon="sensor" sub="NODE-04"><Empty icon="sensor" title={T('جارٍ تحميل بيانات CPS', 'Loading CPS data')} /></Card>;
  if (!cps.state || cps.unavailable) return <Card title={T('ملخص حساسات CPS', 'CPS sensor summary')} icon="sensor" sub="NODE-04"><Empty icon="sensor" title={T('بيانات CPS غير متاحة', 'CPS data unavailable')}><span>{T('لم يتم استبدالها بقراءات تجريبية.', 'It is not replaced with fixture readings.')}</span></Empty></Card>;
  const state = cps.state;
  return <Card title={T('ملخص حساسات CPS', 'CPS sensor summary')} icon="sensor" sub={<Ltr>{state.node_id}</Ltr>}>
    <div className="operational-overview-status"><Chip tone={connectionTone(state.connection_status)}><Ltr>{state.connection_status}</Ltr></Chip><span>{statusLabel(state.connection_status, T)}</span></div>
    <div className="operational-overview-readings">
      <CpsMetric type="temperature" icon="thermo" state={state} />
      <CpsMetric type="humidity" icon="sensor" state={state} />
      <CpsMetric type="pressure" icon="signal" state={state} />
    </div>
    <p className="operational-overview-asof">{T('وقت لقطة CPS', 'CPS snapshot')}: <Ltr>{timeText(state.as_of, 'en')}</Ltr></p>
  </Card>;
}

function CameraRegistryCard() {
  const { s } = useStore();
  const { T } = useUI();
  const cameras = Object.values(s.ai.cameras);
  const registryAvailable = s.ai.connected && cameras.length > 0;
  if (!registryAvailable) return <Card title={T('كاميرات راصد', 'RASID cameras')} icon="cameras"><Empty icon="cameras" title={T('سجل الكاميرات غير متاح', 'Camera registry unavailable')}><span>{T('لا يتم عرض عدد افتراضي أو بيانات تجريبية.', 'No fixture count or simulated inventory is shown.')}</span></Empty></Card>;
  const active = cameras.filter((camera) => camera.active).length;
  const errors = cameras.filter((camera) => !!camera.error).length;
  return <Card title={T('كاميرات راصد', 'RASID cameras')} icon="cameras" sub={<><Ltr>{cameras.length}</Ltr> {T('كاميرات مسجلة', 'registered cameras')}</>}>
    <div className="operational-overview-camera-stats">
      <span><strong><Ltr>{active}</Ltr></strong> {T('التقاط نشط', 'active capture')}</span>
      {errors > 0 && <Chip tone="warn"><Ltr>{errors}</Ltr> {T('أخطاء تطبيق مُبلّغ عنها', 'reported application errors')}</Chip>}
    </div>
    <p className="operational-overview-note">{T('نشاط الإطار يثبت وصوله للتطبيق فقط، ولا يثبت صحة الكاميرا أو اتصال الشبكة.', 'Frame activity shows arrival at the application only; it does not prove camera health or network connectivity.')}</p>
  </Card>;
}

/** Operator-only, read-only view of verified camera registry state and CPS NODE-04. */
export function OperationalOverviewRow() {
  return <div className="operational-overview"><CpsNodeCard /><CameraRegistryCard /></div>;
}
