import { createInitialTwinState, simulationEvaluationRequest } from './twin';
import type { TwinConnectionStatus, TwinSimulationEvaluation, TwinSimulationEvaluationRequest, TwinState } from './twin';

export type TwinAction =
  | { type: 'SET_SIMULATED_TEMPERATURE'; value: number }
  | { type: 'SET_SIMULATED_HUMIDITY'; value: number }
  | { type: 'SET_SIMULATED_PEOPLE_COUNT'; value: number }
  | { type: 'SET_SIMULATED_CONNECTION'; value: TwinConnectionStatus }
  | { type: 'ADVANCE_SIMULATED_TIME'; seconds: number }
  | { type: 'BEGIN_SIMULATION_EVALUATION' }
  | { type: 'SET_SIMULATION_EVALUATION'; value: TwinSimulationEvaluation; request: TwinSimulationEvaluationRequest; generation: number }
  | { type: 'APPLY_SIMULATION_RECOMMENDATION' }
  | { type: 'RESET_SIMULATION' };

/** Every state mutation advances the local generation so delayed responses cannot become actionable. */
function invalidateEvaluation(state: TwinState): TwinState {
  return { ...state, latestEvaluation: null, evaluationGeneration: state.evaluationGeneration + 1 };
}

function setSensor(state: TwinState, id: string, value: number): TwinState {
  return {
    ...state,
    sensors: state.sensors.map((sensor) => sensor.id === id ? { ...sensor, value, observedAt: state.simulatedNow } : sensor),
  };
}

function addSeconds(timestamp: string, seconds: number): string | null {
  const milliseconds = Date.parse(timestamp);
  if (!Number.isFinite(milliseconds) || !Number.isInteger(seconds) || seconds <= 0 || seconds > 3600) return null;
  return new Date(milliseconds + seconds * 1000).toISOString();
}

function sameRequest(a: TwinSimulationEvaluationRequest, b: TwinSimulationEvaluationRequest): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * The API is permitted to serialize a UTC instant as either `Z` or `.000Z`.
 * Compare instants, not formatting; malformed timestamps fail closed.
 */
function sameUtcInstant(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  const first = Date.parse(a);
  const second = Date.parse(b);
  return Number.isFinite(first) && Number.isFinite(second) && first === second;
}

function isEligibleEvaluation(state: TwinState): boolean {
  const stored = state.latestEvaluation;
  if (!stored || stored.generation !== state.evaluationGeneration || !sameRequest(stored.request, simulationEvaluationRequest(state))) return false;
  const evaluation = stored.response.evaluation;
  const proposed = evaluation.recommendation === 'TURN_FAN_ON' ? 'ON' : evaluation.recommendation === 'TURN_FAN_OFF' ? 'OFF' : null;
  return stored.response.context === 'simulation'
    && stored.response.simulated === true
    && evaluation.policy_version === 'sim-hvac-v1'
    && proposed !== null
    && evaluation.proposed_simulated_state === proposed
    && sameUtcInstant(evaluation.evaluated_at, stored.request.simulation_context.evaluated_at)
    && sameUtcInstant(evaluation.input_timestamp, stored.request.sensor.observed_at)
    && evaluation.connection_status === stored.request.simulation_context.connection_status
    && evaluation.previous_simulated_state === stored.request.simulation_context.previous_simulated_state;
}

/** Exposed for the Simulation Center so disabled controls use the same reducer safety gate. */
export function canApplySimulationRecommendation(state: TwinState): boolean {
  return isEligibleEvaluation(state);
}

/** Browser-local reducer. It never reads shared state or applies physical commands. */
export function twinReducer(state: TwinState, action: TwinAction): TwinState {
  switch (action.type) {
    case 'SET_SIMULATED_TEMPERATURE': {
      if (!Number.isFinite(action.value)) return state;
      const next = setSensor(state, 'SIM-SENSOR-TEMP-01', action.value);
      return { ...invalidateEvaluation(next), scenarioInputs: { ...state.scenarioInputs, temperatureC: action.value } };
    }
    case 'SET_SIMULATED_HUMIDITY': {
      if (!Number.isFinite(action.value)) return state;
      const next = setSensor(state, 'SIM-SENSOR-HUM-01', action.value);
      return { ...invalidateEvaluation(next), scenarioInputs: { ...state.scenarioInputs, peerHumidityPct: action.value } };
    }
    case 'SET_SIMULATED_PEOPLE_COUNT': {
      if (!Number.isInteger(action.value) || action.value < 0) return state;
      return { ...invalidateEvaluation(state), scenarioInputs: { ...state.scenarioInputs, simulatedPeopleCount: action.value } };
    }
    case 'SET_SIMULATED_CONNECTION': {
      const first = state.nodes[0];
      if (!first || first.connectionStatus === action.value) return state;
      return { ...invalidateEvaluation(state), nodes: [{ ...first, connectionStatus: action.value }, ...state.nodes.slice(1)] };
    }
    case 'ADVANCE_SIMULATED_TIME': {
      const simulatedNow = addSeconds(state.simulatedNow, action.seconds);
      return simulatedNow === null ? state : { ...invalidateEvaluation(state), simulatedNow };
    }
    case 'BEGIN_SIMULATION_EVALUATION':
      return invalidateEvaluation(state);
    case 'SET_SIMULATION_EVALUATION':
      return action.generation === state.evaluationGeneration
        && action.value.context === 'simulation' && action.value.simulated && sameRequest(action.request, simulationEvaluationRequest(state))
        ? { ...state, latestEvaluation: { response: action.value, request: action.request, generation: action.generation } }
        : state;
    case 'APPLY_SIMULATION_RECOMMENDATION': {
      if (!isEligibleEvaluation(state)) return state;
      const stored = state.latestEvaluation;
      if (!stored) return state;
      const nextState = stored.response.evaluation.proposed_simulated_state;
      const recommendation = stored.response.evaluation.recommendation;
      const actuator = state.actuators.find((item) => item.id === 'SIM-ACTUATOR-FAN-01');
      if (!actuator || (nextState !== 'ON' && nextState !== 'OFF') || (recommendation !== 'TURN_FAN_ON' && recommendation !== 'TURN_FAN_OFF')) return state;
      return {
        ...state,
        actuators: state.actuators.map((item) => item.id === actuator.id ? { ...item, state: nextState } : item),
        previousSimulatedFanState: nextState,
        lastSimulatedFanStateChangeAt: stored.request.simulation_context.evaluated_at,
        evaluationGeneration: state.evaluationGeneration + 1,
        latestEvaluation: null,
        lastVirtualActuation: {
          state: nextState,
          appliedAt: stored.request.simulation_context.evaluated_at,
          recommendation,
          reason: stored.response.evaluation.reason,
          reasonCode: stored.response.evaluation.reason_code,
        },
      };
    }
    case 'RESET_SIMULATION': return { ...createInitialTwinState(), evaluationGeneration: state.evaluationGeneration + 1 };
    default: return state;
  }
}
