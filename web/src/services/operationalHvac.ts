/** Same-origin, monitor-only client for the operational HVAC evidence snapshot. */

export type EvidenceFreshness = 'FRESH' | 'STALE' | 'MISSING' | 'INVALID';
export type OperationalHvacStatus =
  | 'VENTILATION_RECOMMENDED'
  | 'ANTICIPATED_VENTILATION_DEMAND'
  | 'PREEMPTIVE_VENTILATION_RECOMMENDED'
  | 'NO_RECOMMENDATION'
  | 'INSUFFICIENT_EVIDENCE'
  | 'POLICY_NOT_CONFIGURED';
export type ObservedTrendDirection = 'INCREASING' | 'STABLE' | 'DECREASING' | 'UNKNOWN';

export interface OperationalTrend {
  direction: ObservedTrendDirection;
  delta: number | null;
  previous_observed_at: string | null;
  current_observed_at: string | null;
  reason_code: string;
}

/** Approved policy thresholds; null until a policy is approved. */
export interface OperationalHvacThresholds {
  reactive_temperature_c: number;
  normal_temperature_max_c: number;
  minimum_temperature_rise_c: number;
  minimum_crowd_increase: number;
}

export interface OperationalTemperatureEvidence {
  sensor_id: string | null;
  value_c: number | null;
  observed_at: string | null;
  validation_status: string | null;
  freshness: EvidenceFreshness;
  issues: string[];
}

export interface OperationalCpsEvidence {
  source: 'cps_node_state';
  node_id: 'NODE-04' | null;
  location_id: string | null;
  zone_id: string | null;
  status: string | null;
  connection_status: string | null;
  as_of: string | null;
  snapshot_freshness: EvidenceFreshness;
  last_heartbeat_received_at: string | null;
  issues: string[];
  temperature: OperationalTemperatureEvidence;
}

export interface OperationalAiPeopleEvidence {
  source: 'live_ai';
  camera_id: string | null;
  zone_id: string | null;
  observed_at: string | null;
  freshness: EvidenceFreshness;
  people_count: number | null;
  people_smoothed: number | null;
  derived_detection_confidence: number | null;
  confidence_note: string;
  issues: string[];
}

export interface OperationalHvacRecommendation {
  schema_version: 'operational-hvac-recommendation-api-v1';
  context: 'real_operations';
  monitor_only: true;
  evaluation: {
    status: OperationalHvacStatus;
    reason_code: string;
    explanation: string;
    policy_version: string;
    evaluated_at: string;
    zone_id: string | null;
    sources: string[];
    evidence_issues: string[];
    temperature_trend: OperationalTrend;
    crowd_trend: OperationalTrend;
    thresholds: OperationalHvacThresholds | null;
  };
  evidence: { cps: OperationalCpsEvidence; ai_people: OperationalAiPeopleEvidence };
}

const ROOT_FIELDS = new Set(['schema_version', 'context', 'monitor_only', 'evaluation', 'evidence']);
const EVALUATION_FIELDS = new Set(['status', 'reason_code', 'explanation', 'policy_version', 'evaluated_at', 'zone_id', 'sources', 'evidence_issues', 'temperature_trend', 'crowd_trend', 'thresholds']);
const THRESHOLD_FIELDS = new Set(['reactive_temperature_c', 'normal_temperature_max_c', 'minimum_temperature_rise_c', 'minimum_crowd_increase']);
const EVIDENCE_FIELDS = new Set(['cps', 'ai_people']);
const CPS_FIELDS = new Set(['source', 'node_id', 'location_id', 'zone_id', 'status', 'connection_status', 'as_of', 'snapshot_freshness', 'last_heartbeat_received_at', 'issues', 'temperature']);
const TEMPERATURE_FIELDS = new Set(['sensor_id', 'value_c', 'observed_at', 'validation_status', 'freshness', 'issues']);
const AI_FIELDS = new Set(['source', 'camera_id', 'zone_id', 'observed_at', 'freshness', 'people_count', 'people_smoothed', 'derived_detection_confidence', 'confidence_note', 'issues']);
const TREND_FIELDS = new Set(['direction', 'delta', 'previous_observed_at', 'current_observed_at', 'reason_code']);
const FRESHNESS = new Set<EvidenceFreshness>(['FRESH', 'STALE', 'MISSING', 'INVALID']);
const STATUSES = new Set<OperationalHvacStatus>(['VENTILATION_RECOMMENDED', 'ANTICIPATED_VENTILATION_DEMAND', 'PREEMPTIVE_VENTILATION_RECOMMENDED', 'NO_RECOMMENDATION', 'INSUFFICIENT_EVIDENCE', 'POLICY_NOT_CONFIGURED']);
const DIRECTIONS = new Set<ObservedTrendDirection>(['INCREASING', 'STABLE', 'DECREASING', 'UNKNOWN']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function hasExactFields(value: Record<string, unknown>, fields: Set<string>): boolean {
  const keys = Object.keys(value);
  return keys.length === fields.size && keys.every((key) => fields.has(key));
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function nullableFiniteNumber(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value));
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/i.test(value) && Number.isFinite(Date.parse(value));
}

function nullableTimestamp(value: unknown): value is string | null {
  return value === null || isTimestamp(value);
}

function stringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function parseTrend(value: unknown): OperationalTrend | null {
  if (!isRecord(value) || !hasExactFields(value, TREND_FIELDS)
    || !DIRECTIONS.has(value.direction as ObservedTrendDirection)
    || !nullableFiniteNumber(value.delta)
    || !nullableTimestamp(value.previous_observed_at)
    || !nullableTimestamp(value.current_observed_at)
    || typeof value.reason_code !== 'string') return null;
  return value as unknown as OperationalTrend;
}

function validThresholds(value: unknown): boolean {
  if (value === null) return true;
  return isRecord(value) && hasExactFields(value, THRESHOLD_FIELDS)
    && [...THRESHOLD_FIELDS].every((field) => typeof value[field] === 'number' && Number.isFinite(value[field]));
}

/** Strictly parse the public-safe, explicitly allowlisted monitor-only contract. */
export function parseOperationalHvacRecommendation(value: unknown): OperationalHvacRecommendation | null {
  if (!isRecord(value) || !hasExactFields(value, ROOT_FIELDS)
    || value.schema_version !== 'operational-hvac-recommendation-api-v1'
    || value.context !== 'real_operations' || value.monitor_only !== true
    || !isRecord(value.evaluation) || !isRecord(value.evidence)) return null;
  const evaluation = value.evaluation;
  const evidence = value.evidence;
  if (!hasExactFields(evaluation, EVALUATION_FIELDS) || !hasExactFields(evidence, EVIDENCE_FIELDS)
    || !STATUSES.has(evaluation.status as OperationalHvacStatus)
    || !['reason_code', 'explanation', 'policy_version'].every((field) => typeof evaluation[field] === 'string')
    || !isTimestamp(evaluation.evaluated_at) || !nullableString(evaluation.zone_id)
    || !stringList(evaluation.sources) || !stringList(evaluation.evidence_issues)
    || !parseTrend(evaluation.temperature_trend) || !parseTrend(evaluation.crowd_trend)
    || !validThresholds(evaluation.thresholds)) return null;

  const cps = evidence.cps;
  const ai = evidence.ai_people;
  if (!isRecord(cps) || !isRecord(ai) || !hasExactFields(cps, CPS_FIELDS) || !hasExactFields(ai, AI_FIELDS)) return null;
  const temperature = cps.temperature;
  if (cps.source !== 'cps_node_state' || !(cps.node_id === 'NODE-04' || cps.node_id === null)
    || !['location_id', 'zone_id', 'status', 'connection_status'].every((field) => nullableString(cps[field]))
    || !nullableTimestamp(cps.as_of) || !FRESHNESS.has(cps.snapshot_freshness as EvidenceFreshness)
    || !nullableTimestamp(cps.last_heartbeat_received_at) || !stringList(cps.issues)
    || !isRecord(temperature) || !hasExactFields(temperature, TEMPERATURE_FIELDS)
    || !nullableString(temperature.sensor_id) || !nullableFiniteNumber(temperature.value_c)
    || !nullableTimestamp(temperature.observed_at) || !nullableString(temperature.validation_status)
    || !FRESHNESS.has(temperature.freshness as EvidenceFreshness) || !stringList(temperature.issues)) return null;
  if (ai.source !== 'live_ai' || !['camera_id', 'zone_id'].every((field) => nullableString(ai[field]))
    || !nullableTimestamp(ai.observed_at) || !FRESHNESS.has(ai.freshness as EvidenceFreshness)
    || !nullableFiniteNumber(ai.people_count) || !nullableFiniteNumber(ai.people_smoothed)
    || !nullableFiniteNumber(ai.derived_detection_confidence) || typeof ai.confidence_note !== 'string' || !stringList(ai.issues)) return null;
  return value as unknown as OperationalHvacRecommendation;
}

export async function fetchOperationalHvacRecommendation(signal?: AbortSignal): Promise<OperationalHvacRecommendation> {
  const response = await fetch('/api/operational/hvac/recommendation', { signal });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body?.detail === 'string' ? body.detail : `HTTP ${response.status}`);
  const recommendation = parseOperationalHvacRecommendation(body);
  if (!recommendation) throw new Error('Operational HVAC intelligence returned an invalid response');
  return recommendation;
}
