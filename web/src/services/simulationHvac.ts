/** Same-origin client for the stateless, simulation-only HVAC evaluator. */

import type { TwinSimulationEvaluation, TwinSimulationEvaluationRequest } from '../model/twin';

const ROOT_FIELDS = new Set(['schema_version', 'context', 'simulated', 'evaluation']);
const EVALUATION_FIELDS = new Set(['recommendation', 'reason_code', 'reason', 'policy_version', 'evaluated_at', 'input_timestamp', 'connection_status', 'previous_simulated_state', 'proposed_simulated_state']);
const RECOMMENDATIONS = new Set(['TURN_FAN_ON', 'TURN_FAN_OFF', 'HOLD', 'INSUFFICIENT_DATA']);
const CONNECTIONS = new Set(['ONLINE', 'STALE', 'OFFLINE']);
const FAN_STATES = new Set(['ON', 'OFF']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function hasExactFields(value: Record<string, unknown>, fields: Set<string>): boolean {
  const keys = Object.keys(value);
  return keys.length === fields.size && keys.every((key) => fields.has(key));
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/i.test(value) && Number.isFinite(Date.parse(value));
}

function nullableTimestamp(value: unknown): boolean {
  return value === null || isTimestamp(value);
}

function nullableEnum(value: unknown, values: Set<string>): boolean {
  return value === null || (typeof value === 'string' && values.has(value));
}

/** Strictly parse the allowlisted simulation response; never accept operational contracts here. */
export function parseSimulationHvacEvaluation(value: unknown): TwinSimulationEvaluation | null {
  if (!isRecord(value) || !hasExactFields(value, ROOT_FIELDS)
    || value.schema_version !== 'simulation-hvac-evaluation-api-v1'
    || value.context !== 'simulation' || value.simulated !== true || !isRecord(value.evaluation)) return null;
  const evaluation = value.evaluation;
  if (!hasExactFields(evaluation, EVALUATION_FIELDS)
    || typeof evaluation.recommendation !== 'string' || !RECOMMENDATIONS.has(evaluation.recommendation)
    || !['reason_code', 'reason'].every((field) => typeof evaluation[field] === 'string')
    || evaluation.policy_version !== 'sim-hvac-v1'
    || !isTimestamp(evaluation.evaluated_at) || !nullableTimestamp(evaluation.input_timestamp)
    || !nullableEnum(evaluation.connection_status, CONNECTIONS)
    || !nullableEnum(evaluation.previous_simulated_state, FAN_STATES)
    || !nullableEnum(evaluation.proposed_simulated_state, FAN_STATES)) return null;
  return value as unknown as TwinSimulationEvaluation;
}

export async function evaluateSimulationHvac(
  request: TwinSimulationEvaluationRequest,
  signal?: AbortSignal,
): Promise<TwinSimulationEvaluation> {
  const response = await fetch('/api/simulation/hvac/evaluate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    signal,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body?.detail === 'string' ? body.detail : `HTTP ${response.status}`);
  const evaluation = parseSimulationHvacEvaluation(body);
  if (!evaluation) throw new Error('Simulation HVAC evaluator returned an invalid response');
  return evaluation;
}
