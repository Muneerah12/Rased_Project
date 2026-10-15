import { createInitialTwinState, SIM_THREAT_SCENARIOS, simulationEvaluationRequest } from './contracts';
import { evaluateSimulationExhaust } from './simulationHvac';
import type { SimThreatKind, TwinConnectionStatus, TwinSimulationEvaluation, TwinSimulationEvaluationRequest, TwinState } from './contracts';

export type TwinAction =
  | { type: 'SET_SIMULATED_TEMPERATURE'; value: number } | { type: 'SET_SIMULATED_HUMIDITY'; value: number }
  | { type: 'SET_SIMULATED_PEOPLE_COUNT'; value: number } | { type: 'SET_SIMULATED_CONNECTION'; value: TwinConnectionStatus }
  | { type: 'ADVANCE_SIMULATED_TIME'; seconds: number } | { type: 'BEGIN_SIMULATION_EVALUATION' }
  | { type: 'SET_SIMULATION_EVALUATION'; value: TwinSimulationEvaluation; request: TwinSimulationEvaluationRequest; generation: number }
  | { type: 'APPLY_SIMULATION_RECOMMENDATION' } | { type: 'APPLY_EXHAUST_RECOMMENDATION' } | { type: 'RESET_SIMULATION' }
  | { type: 'SIMULATE_THREAT'; kind: SimThreatKind } | { type: 'CLEAR_THREAT' } | { type: 'APPLY_FIRE_PROTOCOL' };

function invalidate(state: TwinState): TwinState { return { ...state, latestEvaluation: null, evaluationGeneration: state.evaluationGeneration + 1 }; }
function setSensor(state: TwinState, id: string, value: number): TwinState { return { ...state, sensors: state.sensors.map((sensor) => sensor.id === id ? { ...sensor, value, observedAt: state.simulatedNow } : sensor) }; }
function addSeconds(timestamp: string, seconds: number): string | null { const at = Date.parse(timestamp); return !Number.isFinite(at) || !Number.isInteger(seconds) || seconds <= 0 || seconds > 3600 ? null : new Date(at + seconds * 1000).toISOString(); }
function sameRequest(a: TwinSimulationEvaluationRequest, b: TwinSimulationEvaluationRequest): boolean { return JSON.stringify(a) === JSON.stringify(b); }
function sameInstant(a: string | null, b: string | null): boolean { if (a === null || b === null) return a === b; const first = Date.parse(a); const second = Date.parse(b); return Number.isFinite(first) && Number.isFinite(second) && first === second; }

function eligible(state: TwinState): boolean {
  const stored = state.latestEvaluation;
  if (!stored || stored.generation !== state.evaluationGeneration || !sameRequest(stored.request, simulationEvaluationRequest(state))) return false;
  const evaluation = stored.response.evaluation;
  const proposed = evaluation.recommendation === 'TURN_FAN_ON' ? 'ON' : evaluation.recommendation === 'TURN_FAN_OFF' ? 'OFF' : null;
  return stored.response.context === 'simulation' && stored.response.simulated && evaluation.policy_version === 'sim-hvac-v1' && proposed !== null && evaluation.proposed_simulated_state === proposed && sameInstant(evaluation.evaluated_at, stored.request.simulation_context.evaluated_at) && sameInstant(evaluation.input_timestamp, stored.request.sensor.observed_at) && evaluation.connection_status === stored.request.simulation_context.connection_status && evaluation.previous_simulated_state === stored.request.simulation_context.previous_simulated_state;
}
export function canApplySimulationRecommendation(state: TwinState): boolean { return eligible(state); }

/** Pure reducer: no host store writes, API calls, journal events, or physical actions. */
export function twinReducer(state: TwinState, action: TwinAction): TwinState {
  switch (action.type) {
    case 'SET_SIMULATED_TEMPERATURE': { if (!Number.isFinite(action.value)) return state; const next = setSensor(state, 'SIM-SENSOR-TEMP-01', action.value); return { ...invalidate(next), scenarioInputs: { ...state.scenarioInputs, temperatureC: action.value } }; }
    case 'SET_SIMULATED_HUMIDITY': { if (!Number.isFinite(action.value)) return state; const next = setSensor(state, 'SIM-SENSOR-HUM-01', action.value); return { ...invalidate(next), scenarioInputs: { ...state.scenarioInputs, peerHumidityPct: action.value } }; }
    case 'SET_SIMULATED_PEOPLE_COUNT': return !Number.isInteger(action.value) || action.value < 0 ? state : { ...invalidate(state), scenarioInputs: { ...state.scenarioInputs, simulatedPeopleCount: action.value } };
    case 'SET_SIMULATED_CONNECTION': { const first = state.nodes[0]; return !first || first.connectionStatus === action.value ? state : { ...invalidate(state), nodes: [{ ...first, connectionStatus: action.value }, ...state.nodes.slice(1)] }; }
    case 'ADVANCE_SIMULATED_TIME': { const simulatedNow = addSeconds(state.simulatedNow, action.seconds); return simulatedNow === null ? state : { ...invalidate(state), simulatedNow }; }
    case 'BEGIN_SIMULATION_EVALUATION': return invalidate(state);
    case 'SET_SIMULATION_EVALUATION': return action.generation === state.evaluationGeneration && action.value.context === 'simulation' && action.value.simulated && sameRequest(action.request, simulationEvaluationRequest(state)) ? { ...state, latestEvaluation: { response: action.value, request: action.request, generation: action.generation } } : state;
    case 'APPLY_SIMULATION_RECOMMENDATION': {
      if (!eligible(state) || !state.latestEvaluation) return state;
      const stored = state.latestEvaluation; const next = stored.response.evaluation.proposed_simulated_state; const recommendation = stored.response.evaluation.recommendation;
      if ((next !== 'ON' && next !== 'OFF') || (recommendation !== 'TURN_FAN_ON' && recommendation !== 'TURN_FAN_OFF')) return state;
      return { ...state, actuators: state.actuators.map((item) => item.id.startsWith('SIM-ACTUATOR-FAN-') ? { ...item, state: next } : item), previousSimulatedFanState: next, lastSimulatedFanStateChangeAt: stored.request.simulation_context.evaluated_at, evaluationGeneration: state.evaluationGeneration + 1, latestEvaluation: null, lastVirtualActuation: { state: next, appliedAt: stored.request.simulation_context.evaluated_at, recommendation, reason: stored.response.evaluation.reason, reasonCode: stored.response.evaluation.reason_code } };
    }
    case 'APPLY_EXHAUST_RECOMMENDATION': {
      const exhaust = evaluateSimulationExhaust(state);
      if (exhaust.recommendation !== 'TURN_EXHAUST_ON' && exhaust.recommendation !== 'TURN_EXHAUST_OFF') return state;
      return { ...state, actuators: state.actuators.map((item) => item.id.startsWith('SIM-ACTUATOR-EXH-') ? { ...item, state: exhaust.proposed ?? item.state } : item) };
    }
    case 'SIMULATE_THREAT': { const scenario = SIM_THREAT_SCENARIOS[action.kind]; return scenario ? { ...state, simulatedThreat: { ...scenario, detectedAt: state.simulatedNow } } : state; }
    case 'CLEAR_THREAT': return state.simulatedThreat ? { ...state, simulatedThreat: null } : state;
    case 'APPLY_FIRE_PROTOCOL': {
      // Smoke control: exhaust fans pull smoke out, circulation fans stop so smoke is not spread.
      if (state.simulatedThreat?.kind !== 'fire') return state;
      return { ...invalidate(state), actuators: state.actuators.map((item) => item.id.startsWith('SIM-ACTUATOR-EXH-') ? { ...item, state: 'ON' } : item.id.startsWith('SIM-ACTUATOR-FAN-') ? { ...item, state: 'OFF' } : item), previousSimulatedFanState: 'OFF', lastSimulatedFanStateChangeAt: state.simulatedNow };
    }
    case 'RESET_SIMULATION': return { ...createInitialTwinState(), evaluationGeneration: state.evaluationGeneration + 1 };
    default: return state;
  }
}
