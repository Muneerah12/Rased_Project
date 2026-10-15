// Demo CPS data for the hosted showcase, built in only with VITE_DEMO_CPS=1 (the Vercel build). The hosted server
// answers its CPS bridge to loopback clients only, so these generated NODE-04 responses stand in for /api/cps/* and
// the operational HVAC recommendation. They follow the server contracts exactly, and the CPS workspace labels them as
// demo data. Values are a pure function of time, so every screen and every refetch agree.
export const DEMO_CPS = import.meta.env?.VITE_DEMO_CPS === '1';

const STEP_MS = 10_000; // NODE-04 reports every 10 s
const BEAT_OFFSET_MS = 9_500;
const TREND_LOOKBACK_MS = 5 * 60_000; // OPERATIONAL_HVAC_TREND_LOOKBACK_S
const SENSORS = {
  'TEMP-01': { type: 'temperature', unit: 'C', offset: 1_000 },
  'HUM-01': { type: 'humidity', unit: '%', offset: 4_000 },
  'PRESS-01': { type: 'pressure', unit: 'hPa', offset: 7_000 },
} as const;
type SensorId = keyof typeof SENSORS;
const SENSOR_IDS = Object.keys(SENSORS) as SensorId[];
// The approved thresholds of server/.env.example (ESP32 fan: setpoint 25 C, on at 26 C)
const THRESHOLDS = { reactive_temperature_c: 26, normal_temperature_max_c: 25, minimum_temperature_rise_c: 0.5, minimum_crowd_increase: 3 };

const iso = (ms: number) => new Date(ms).toISOString().replace('Z', '+00:00');
const round = (value: number, digits = 2) => Number(value.toFixed(digits));
const wave = (t: number, periodMin: number, phase = 0) => Math.sin((2 * Math.PI * t) / (periodMin * 60_000) + phase);
/** Repeatable noise in [-0.5, 0.5) for an instant. */
const noise = (t: number) => { const x = Math.sin(t * 0.0129898) * 43758.5453; return x - Math.floor(x) - 0.5; };

function value(sensor: SensorId, t: number): number {
  // slow drift + a crowd-driven swell of changing strength + small fast ripple, so the curve never looks periodic
  const temperature = 24.9 + 0.6 * wave(t, 173, 1.3) + (0.6 + 0.35 * wave(t, 97, 0.4)) * wave(t, 41) + 0.2 * wave(t, 7, 1) + 0.08 * noise(t);
  if (sensor === 'TEMP-01') return round(temperature);
  if (sensor === 'HUM-01') return round(47 - 1.1 * (temperature - 25.1) + 1.4 * wave(t, 60, 2) + 0.1 * noise(t + 1));
  return round(944.2 + 0.35 * wave(t, 180, 0.5) + 0.03 * noise(t + 2));
}
const people = (t: number) => Math.max(0, Math.round(24 + 9 * wave(t, 30, 0.7) + 2 * noise(t + 3)));

/** Latest report time of a sensor at or before `t`. */
const reportAt = (sensor: SensorId, t: number) => Math.floor((t - SENSORS[sensor].offset) / STEP_MS) * STEP_MS + SENSORS[sensor].offset;
const beatAt = (now: number) => Math.floor((now - BEAT_OFFSET_MS) / STEP_MS) * STEP_MS + BEAT_OFFSET_MS;
const reading = (sensor: SensorId, t: number) => ({ sensor_id: sensor, sensor_type: SENSORS[sensor].type, value: value(sensor, t), unit: SENSORS[sensor].unit, timestamp: iso(t), validation_status: 'UNKNOWN' });
/** A report becomes visible one second after it is taken. */
const latest = (sensor: SensorId, now: number) => reportAt(sensor, now - 1_000);

function nodeState(now: number) {
  const beat = beatAt(now);
  const readings = [0, 1].flatMap((cycle) => SENSOR_IDS.map((sensor) => reading(sensor, latest(sensor, now) - cycle * STEP_MS)))
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  const temperature = value('TEMP-01', latest('TEMP-01', now));
  return {
    node_id: 'NODE-04', status: 'ACTIVE', connection_status: 'ONLINE', location_id: 'A1-1',
    last_heartbeat_received_at: iso(beat), reported_relay_state: temperature >= 25.5 ? 'ON' : 'OFF', relay_reported_at: iso(beat),
    network_observation: {
      reported_ip: null, reported_mac: null, reported_rssi_dbm: -50 + Math.round(4 * noise(beat)), reported_ssid: null,
      reported_bssid: null, reported_wifi_channel: 6, reported_gateway: null, reported_subnet_mask: null, reported_at: iso(beat),
    },
    as_of: iso(now), readings,
  };
}

function heartbeats(now: number) {
  const beat = beatAt(now);
  return { node_id: 'NODE-04', as_of: iso(now), items: Array.from({ length: 50 }, (_, i) => ({ received_at: iso(beat - i * STEP_MS) })) };
}

function readingHistory(query: URLSearchParams, now: number) {
  const sensor = query.get('sensor_id') as SensorId;
  const start = query.get('start') ?? ''; const end = query.get('end') ?? '';
  const from = Date.parse(start); const to = Date.parse(end);
  const limit = Math.min(200, Math.max(1, Number(query.get('limit')) || 100));
  const cursor = query.get('cursor');
  if (!(sensor in SENSORS) || !Number.isFinite(from) || !Number.isFinite(to) || from >= to) return null;
  // newest first, inside [start, end), never in the future; a cursor resumes before the last item returned
  let t = reportAt(sensor, Math.min(to - 1, now - 1_000));
  if (cursor) t = Math.min(t, Number(cursor.replace('demo-', '')) - STEP_MS);
  const items = [];
  for (; t >= from && items.length < limit; t -= STEP_MS) items.push(reading(sensor, t));
  return {
    node_id: 'NODE-04', sensor_id: sensor, sensor_type: SENSORS[sensor].type, start, end, as_of: iso(now), items,
    next_cursor: t >= from && items.length === limit ? `demo-${t + STEP_MS}` : null,
  };
}

function trend(previous: number, current: number, previousAt: number, currentAt: number) {
  const delta = round(current - previous);
  return { direction: delta > 0 ? 'INCREASING' : delta < 0 ? 'DECREASING' : 'STABLE', delta, previous_observed_at: iso(previousAt), current_observed_at: iso(currentAt), reason_code: 'OBSERVED_DELTA' };
}

/** Same decision order as server/operational_hvac_policy.py (pre-emptive activation not enabled). */
function decide(temperature: number, temperatureTrend: ReturnType<typeof trend>, crowdTrend: ReturnType<typeof trend>): [string, string, string] {
  const rising = temperatureTrend.direction === 'INCREASING' && temperatureTrend.delta >= THRESHOLDS.minimum_temperature_rise_c;
  const crowding = crowdTrend.direction === 'INCREASING' && crowdTrend.delta >= THRESHOLDS.minimum_crowd_increase;
  if (rising && crowding) return ['VENTILATION_RECOMMENDED', 'COMBINED_OBSERVED_TEMPERATURE_AND_CROWD_RISE', 'Observed temperature and crowd count both increased; this is a monitor-only ventilation recommendation, not a forecast or command.'];
  if (temperature >= THRESHOLDS.reactive_temperature_c && crowdTrend.direction === 'STABLE') return ['VENTILATION_RECOMMENDED', 'REACTIVE_ELEVATED_TEMPERATURE_STABLE_CROWD', 'Observed temperature meets the approved reactive threshold while the observed crowd count is stable.'];
  if (crowding && temperature <= THRESHOLDS.normal_temperature_max_c) return ['ANTICIPATED_VENTILATION_DEMAND', 'OBSERVED_CROWD_INCREASE_NO_FORECAST_MODEL', 'Observed crowd count increased while temperature is normal. This indicates anticipated demand only; no forecast model or pre-emptive activation policy is enabled.'];
  return ['NO_RECOMMENDATION', 'OBSERVED_CONDITIONS_DO_NOT_MATCH_POLICY', 'Available observations do not match an approved monitor-only ventilation condition.'];
}

function hvacRecommendation(now: number) {
  const tempAt = latest('TEMP-01', now); const temperature = value('TEMP-01', tempAt);
  const aiAt = Math.floor((now - 1_000) / 1_000) * 1_000; const crowd = people(aiAt);
  const temperatureTrend = trend(value('TEMP-01', tempAt - TREND_LOOKBACK_MS), temperature, tempAt - TREND_LOOKBACK_MS, tempAt);
  const crowdTrend = trend(people(aiAt - TREND_LOOKBACK_MS), crowd, aiAt - TREND_LOOKBACK_MS, aiAt);
  const [status, reason, explanation] = decide(temperature, temperatureTrend, crowdTrend);
  const single = ['TEMPERATURE_VALIDATION_NOT_NORMAL']; // one temperature sensor: accepted by policy, still reported
  return {
    schema_version: 'operational-hvac-recommendation-api-v1', context: 'real_operations', monitor_only: true,
    evaluation: {
      status, reason_code: reason, explanation, policy_version: 'real-hvac-v1-approved', evaluated_at: iso(now), zone_id: 'A1.1',
      sources: ['cps_node_state', 'live_ai'], evidence_issues: [], temperature_trend: temperatureTrend, crowd_trend: crowdTrend, thresholds: THRESHOLDS,
    },
    evidence: {
      cps: {
        source: 'cps_node_state', node_id: 'NODE-04', location_id: 'A1-1', zone_id: 'A1.1', status: 'ACTIVE', connection_status: 'ONLINE',
        as_of: iso(now), snapshot_freshness: 'FRESH', last_heartbeat_received_at: iso(beatAt(now)), issues: single,
        temperature: { sensor_id: 'TEMP-01', value_c: temperature, observed_at: iso(tempAt), validation_status: 'UNKNOWN', freshness: 'FRESH', issues: single },
      },
      ai_people: {
        source: 'live_ai', camera_id: 'CAM-C', zone_id: 'A1.1', observed_at: iso(aiAt), freshness: 'FRESH', people_count: crowd, people_smoothed: crowd,
        derived_detection_confidence: 0.82, confidence_note: 'Derived detection confidence is not count accuracy.', issues: [],
      },
    },
  };
}

/** The demo body for a server path, or null when the real server should answer it. */
export function demoCpsResponse(url: string, now: number): unknown {
  const [path, query = ''] = url.split('?');
  switch (path) {
    case '/api/cps/node-state': return nodeState(now);
    case '/api/cps/node-heartbeats': return heartbeats(now);
    case '/api/cps/node-readings': return readingHistory(new URLSearchParams(query), now);
    case '/api/operational/hvac/recommendation': return hvacRecommendation(now);
    default: return null;
  }
}

/** Answers the CPS and operational HVAC fetches with demo data when the build enables it. */
export function serveDemoCps(): void {
  if (!DEMO_CPS || typeof window === 'undefined') return;
  const send = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const body = typeof input === 'string' ? demoCpsResponse(input, Date.now()) : null;
    return body === null ? send(input, init) : Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  };
}
