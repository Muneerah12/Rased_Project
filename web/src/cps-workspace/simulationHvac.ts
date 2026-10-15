/**
 * Canonical HVAC policy, deliberately browser-local and simulation-only.
 * It consumes the Twin snapshot supplied by the caller and never fetches,
 * stores, or controls an operational system.
 */
import type { TwinActuatorState, TwinHvacRecommendation, TwinSimulationEvaluation, TwinSimulationEvaluationRequest, TwinState } from './contracts';

const POLICY_VERSION = 'sim-hvac-v1' as const;
const ON_THRESHOLD_C = 26;
const OFF_THRESHOLD_C = 24;
const FRESHNESS_MS = 30_000;
const MINIMUM_DWELL_MS = 60_000;
const ENGINEERING_MIN_C = -40;
const ENGINEERING_MAX_C = 85;

type SimulatedFanState = Exclude<TwinActuatorState, 'UNAVAILABLE'>;
type EvaluationFields = TwinSimulationEvaluation['evaluation'];

function timestamp(value: string | null, name: string, nullable: boolean): number | null {
  if (value === null && nullable) return null;
  if (typeof value !== 'string' || !/(?:Z|[+-]\d{2}:\d{2})$/i.test(value) || !Number.isFinite(Date.parse(value))) throw new Error(`${name} must be a timezone-aware ISO 8601 timestamp`);
  return Date.parse(value);
}

function canonicalTimestamp(value: string | null, name: string, nullable: boolean): string | null {
  const parsed = timestamp(value, name, nullable);
  return parsed === null ? null : new Date(parsed).toISOString();
}

function hasExactKeys(value: object, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function validateRequest(request: TwinSimulationEvaluationRequest): void {
  const candidate = request as unknown as Record<string, unknown>;
  if (!candidate || typeof candidate !== 'object' || !hasExactKeys(candidate, ['schema_version', 'context', 'simulated', 'sensor', 'simulation_context'])) throw new Error('request contains unsupported or missing fields');
  if (request.schema_version !== 'simulation-hvac-evaluate-request-v1') throw new Error('schema_version is invalid');
  if (request.context !== 'simulation' || request.simulated !== true) throw new Error('request must be explicitly simulated');
  if (!request.sensor || typeof request.sensor !== 'object' || !hasExactKeys(request.sensor, ['temperature_c', 'observed_at', 'validation_status'])) throw new Error('sensor contains unsupported or missing fields');
  if (!request.simulation_context || typeof request.simulation_context !== 'object' || !hasExactKeys(request.simulation_context, ['connection_status', 'previous_simulated_state', 'last_simulated_state_change_at', 'evaluated_at'])) throw new Error('simulation_context contains unsupported or missing fields');
  if (!(request.sensor.temperature_c === null || (typeof request.sensor.temperature_c === 'number' && Number.isFinite(request.sensor.temperature_c)))) throw new Error('temperature_c must be a finite number or null');
  if (!(request.sensor.validation_status === null || ['NORMAL', 'UNKNOWN', 'SUSPICIOUS', 'INVALID'].includes(request.sensor.validation_status))) throw new Error('validation_status is invalid');
  if (!(request.simulation_context.connection_status === null || ['ONLINE', 'STALE', 'OFFLINE'].includes(request.simulation_context.connection_status))) throw new Error('connection_status is invalid');
  if (!(request.simulation_context.previous_simulated_state === null || ['ON', 'OFF'].includes(request.simulation_context.previous_simulated_state))) throw new Error('previous_simulated_state is invalid');
  timestamp(request.sensor.observed_at, 'observed_at', true);
  timestamp(request.simulation_context.last_simulated_state_change_at, 'last_simulated_state_change_at', true);
  timestamp(request.simulation_context.evaluated_at, 'evaluated_at', false);
}

function evaluation(request: TwinSimulationEvaluationRequest, recommendation: TwinHvacRecommendation, reasonCode: string, reason: string, proposed: SimulatedFanState | null): TwinSimulationEvaluation {
  const fields: EvaluationFields = {
    recommendation, reason_code: reasonCode, reason, policy_version: POLICY_VERSION,
    evaluated_at: canonicalTimestamp(request.simulation_context.evaluated_at, 'evaluated_at', false)!, input_timestamp: canonicalTimestamp(request.sensor.observed_at, 'observed_at', true),
    connection_status: request.simulation_context.connection_status,
    previous_simulated_state: request.simulation_context.previous_simulated_state,
    proposed_simulated_state: proposed,
  };
  return { schema_version: 'simulation-hvac-evaluation-api-v1', context: 'simulation', simulated: true, evaluation: fields };
}

/** Deterministic port of the canonical Python decision_engine.evaluate_hvac_simulation. */
export function evaluateSimulationHvac(request: TwinSimulationEvaluationRequest): TwinSimulationEvaluation {
  validateRequest(request);
  const sensor = request.sensor; const context = request.simulation_context;
  const evaluatedAt = timestamp(context.evaluated_at, 'evaluated_at', false)!;
  const observedAt = timestamp(sensor.observed_at, 'observed_at', true);
  const lastChangedAt = timestamp(context.last_simulated_state_change_at, 'last_simulated_state_change_at', true);
  const temperature = sensor.temperature_c;

  if (temperature === null) return evaluation(request, 'INSUFFICIENT_DATA', 'MISSING_TEMPERATURE', 'A numeric temperature reading is required.', null);
  if (!Number.isFinite(temperature)) return evaluation(request, 'INSUFFICIENT_DATA', 'NONFINITE_TEMPERATURE', 'Temperature must be finite.', null);
  if (temperature < ENGINEERING_MIN_C || temperature > ENGINEERING_MAX_C) return evaluation(request, 'INSUFFICIENT_DATA', 'OUT_OF_RANGE_TEMPERATURE', 'Temperature is outside the simulation engineering range.', null);
  if (sensor.validation_status !== 'NORMAL') return evaluation(request, 'INSUFFICIENT_DATA', 'UNTRUSTED_SENSOR_STATUS', 'Only NORMAL sensor integrity status is eligible for simulation.', null);
  if (context.connection_status !== 'ONLINE') return evaluation(request, 'INSUFFICIENT_DATA', 'NODE_NOT_ONLINE', 'The CPS node must be ONLINE for a simulation recommendation.', null);
  if (observedAt === null) return evaluation(request, 'INSUFFICIENT_DATA', 'MISSING_INPUT_TIMESTAMP', 'A sensor timestamp is required.', null);

  const inputAge = evaluatedAt - observedAt;
  if (inputAge < 0) return evaluation(request, 'INSUFFICIENT_DATA', 'FUTURE_INPUT_TIMESTAMP', 'A future sensor timestamp is not eligible for simulation.', null);
  if (inputAge > FRESHNESS_MS) return evaluation(request, 'INSUFFICIENT_DATA', 'STALE_INPUT_TIMESTAMP', 'The sensor reading exceeds the simulation freshness limit.', null);
  const previous = context.previous_simulated_state;
  if (previous === null || lastChangedAt === null) return evaluation(request, 'INSUFFICIENT_DATA', 'UNKNOWN_SIMULATED_STATE', 'Previous simulated fan state and state-change time are required.', null);

  const dwellAge = evaluatedAt - lastChangedAt;
  if (dwellAge < 0) return evaluation(request, 'INSUFFICIENT_DATA', 'FUTURE_STATE_CHANGE_TIMESTAMP', 'The previous simulated state-change time cannot be in the future.', null);
  if (dwellAge < MINIMUM_DWELL_MS) return evaluation(request, 'HOLD', 'MINIMUM_DWELL_ACTIVE', 'The minimum simulated state-change interval has not elapsed.', previous);
  if (previous === 'OFF' && temperature >= ON_THRESHOLD_C) return evaluation(request, 'TURN_FAN_ON', 'TEMPERATURE_AT_OR_ABOVE_ON_THRESHOLD', 'Temperature reached the simulated fan-on threshold.', 'ON');
  if (previous === 'ON' && temperature <= OFF_THRESHOLD_C) return evaluation(request, 'TURN_FAN_OFF', 'TEMPERATURE_AT_OR_BELOW_OFF_THRESHOLD', 'Temperature reached the simulated fan-off threshold.', 'OFF');
  return evaluation(request, 'HOLD', 'HYSTERESIS_OR_STATE_ALREADY_SATISFIED', 'Temperature is within the hysteresis band or the simulated fan already matches the policy.', previous);
}

export const SIMULATION_HVAC_POLICY = { version: POLICY_VERSION, fanOnTemperatureC: ON_THRESHOLD_C, fanOffTemperatureC: OFF_THRESHOLD_C, freshnessMs: FRESHNESS_MS, minimumDwellMs: MINIMUM_DWELL_MS } as const;

/** Browser-local exhaust rule: crowd density stands in for air quality (no CO2 sensor yet). */
export const SIMULATION_EXHAUST_POLICY = { onAtVisitors: 16, offAtVisitors: 8 } as const;
export type TwinExhaustRecommendation = 'TURN_EXHAUST_ON' | 'TURN_EXHAUST_OFF' | 'HOLD' | 'INSUFFICIENT_DATA';
export function exhaustFanState(state: TwinState): 'ON' | 'OFF' { return state.actuators.some((item) => item.id.startsWith('SIM-ACTUATOR-EXH-') && item.state === 'ON') ? 'ON' : 'OFF'; }
export function evaluateSimulationExhaust(state: TwinState): { recommendation: TwinExhaustRecommendation; proposed: 'ON' | 'OFF' | null; reasonCode: string } {
  if (state.nodes[0]?.connectionStatus !== 'ONLINE') return { recommendation: 'INSUFFICIENT_DATA', proposed: null, reasonCode: 'NODE_NOT_ONLINE' };
  const visitors = state.scenarioInputs.simulatedPeopleCount; const current = exhaustFanState(state);
  if (current === 'OFF' && visitors >= SIMULATION_EXHAUST_POLICY.onAtVisitors) return { recommendation: 'TURN_EXHAUST_ON', proposed: 'ON', reasonCode: 'CROWD_AT_OR_ABOVE_EXHAUST_THRESHOLD' };
  if (current === 'ON' && visitors <= SIMULATION_EXHAUST_POLICY.offAtVisitors) return { recommendation: 'TURN_EXHAUST_OFF', proposed: 'OFF', reasonCode: 'CROWD_AT_OR_BELOW_EXHAUST_OFF_THRESHOLD' };
  return { recommendation: 'HOLD', proposed: current, reasonCode: 'EXHAUST_STATE_ALREADY_SATISFIED' };
}
