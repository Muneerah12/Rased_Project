/** Browser-local contracts for the isolated OT Simulation Center. */

export type TwinConnectionStatus = 'ONLINE' | 'STALE' | 'OFFLINE';
export type TwinActuatorState = 'ON' | 'OFF' | 'UNAVAILABLE';
export type TwinValidationStatus = 'NORMAL' | 'UNKNOWN' | 'SUSPICIOUS' | 'INVALID';
export type TwinHvacRecommendation = 'TURN_FAN_ON' | 'TURN_FAN_OFF' | 'HOLD' | 'INSUFFICIENT_DATA';
export type TwinFreshness = 'FRESH' | 'STALE' | 'FUTURE' | 'UNAVAILABLE';

export interface TwinNode {
  id: `SIM-NODE-${string}`;
  label: string;
  connectionStatus: TwinConnectionStatus;
}

export interface TwinSensor {
  id: `SIM-SENSOR-${string}`;
  nodeId: TwinNode['id'];
  label: string;
  value: number;
  unit: string;
  observedAt: string;
  validationStatus: TwinValidationStatus;
  synthetic: true;
}

export interface TwinActuator {
  id: `SIM-ACTUATOR-${string}`;
  nodeId: TwinNode['id'];
  label: string;
  state: TwinActuatorState;
  synthetic: true;
}

export interface TwinScenarioInputs {
  temperatureC: number;
  peerHumidityPct: number;
  simulatedPeopleCount: number;
}

export interface TwinSimulationEvaluation {
  schema_version: 'simulation-hvac-evaluation-api-v1';
  context: 'simulation';
  simulated: true;
  evaluation: {
    recommendation: TwinHvacRecommendation;
    reason_code: string;
    reason: string;
    policy_version: 'sim-hvac-v1';
    evaluated_at: string;
    input_timestamp: string | null;
    connection_status: TwinConnectionStatus | null;
    previous_simulated_state: Exclude<TwinActuatorState, 'UNAVAILABLE'> | null;
    proposed_simulated_state: Exclude<TwinActuatorState, 'UNAVAILABLE'> | null;
  };
}

export interface TwinSimulationEvaluationRequest {
  schema_version: 'simulation-hvac-evaluate-request-v1';
  context: 'simulation';
  simulated: true;
  sensor: {
    temperature_c: number | null;
    observed_at: string | null;
    validation_status: TwinValidationStatus | null;
  };
  simulation_context: {
    connection_status: TwinConnectionStatus | null;
    previous_simulated_state: Exclude<TwinActuatorState, 'UNAVAILABLE'> | null;
    last_simulated_state_change_at: string | null;
    evaluated_at: string;
  };
}

/** A response is only actionable while its exact synthetic input snapshot still matches. */
export interface TwinStoredEvaluation {
  response: TwinSimulationEvaluation;
  request: TwinSimulationEvaluationRequest;
  generation: number;
}

export interface TwinVirtualActuation {
  state: Exclude<TwinActuatorState, 'UNAVAILABLE'>;
  appliedAt: string;
  recommendation: 'TURN_FAN_ON' | 'TURN_FAN_OFF';
  reason: string;
  reasonCode: string;
}

export interface TwinState {
  context: 'simulation';
  simulated: true;
  simulatedNow: string;
  nodes: TwinNode[];
  sensors: TwinSensor[];
  actuators: TwinActuator[];
  scenarioInputs: TwinScenarioInputs;
  previousSimulatedFanState: Exclude<TwinActuatorState, 'UNAVAILABLE'> | null;
  lastSimulatedFanStateChangeAt: string | null;
  /** Local-only revision used to reject responses from superseded evaluations. */
  evaluationGeneration: number;
  latestEvaluation: TwinStoredEvaluation | null;
  lastVirtualActuation: TwinVirtualActuation | null;
}

/** Explicitly documents that the Twin is browser-local and has no operational bridge. */
export const TWIN_ISOLATION = {
  browserLocal: true,
  operationalApiAccess: false,
  sharedStoreAccess: false,
  journalWrites: false,
  physicalCommands: false,
} as const;

const INITIAL_SIMULATED_NOW = '2026-10-10T12:00:00Z';
const INITIAL_FAN_CHANGED_AT = '2026-10-10T11:59:00Z';

/** Synthetic starter values only; they do not represent any real observation. */
export function createInitialTwinState(): TwinState {
  const nodeId: TwinNode['id'] = 'SIM-NODE-01';
  return {
    context: 'simulation',
    simulated: true,
    simulatedNow: INITIAL_SIMULATED_NOW,
    nodes: [{ id: nodeId, label: 'Virtual environmental node', connectionStatus: 'ONLINE' }],
    sensors: [
      { id: 'SIM-SENSOR-TEMP-01', nodeId, label: 'Virtual temperature', value: 24.5, unit: '°C', observedAt: INITIAL_SIMULATED_NOW, validationStatus: 'NORMAL', synthetic: true },
      { id: 'SIM-SENSOR-HUM-01', nodeId, label: 'Virtual humidity', value: 40, unit: '%', observedAt: INITIAL_SIMULATED_NOW, validationStatus: 'NORMAL', synthetic: true },
      { id: 'SIM-SENSOR-PRESS-01', nodeId, label: 'Virtual pressure', value: 1012, unit: 'hPa', observedAt: INITIAL_SIMULATED_NOW, validationStatus: 'NORMAL', synthetic: true },
    ],
    actuators: [{ id: 'SIM-ACTUATOR-FAN-01', nodeId, label: 'Virtual fan relay', state: 'OFF', synthetic: true }],
    scenarioInputs: { temperatureC: 24.5, peerHumidityPct: 40, simulatedPeopleCount: 0 },
    previousSimulatedFanState: 'OFF',
    lastSimulatedFanStateChangeAt: INITIAL_FAN_CHANGED_AT,
    evaluationGeneration: 0,
    latestEvaluation: null,
    lastVirtualActuation: null,
  };
}

export function simulationEvaluationRequest(state: TwinState): TwinSimulationEvaluationRequest {
  const temperature = state.sensors.find((sensor) => sensor.id === 'SIM-SENSOR-TEMP-01');
  const node = state.nodes[0];
  return {
    schema_version: 'simulation-hvac-evaluate-request-v1',
    context: 'simulation',
    simulated: true,
    sensor: {
      temperature_c: temperature?.value ?? null,
      observed_at: temperature?.observedAt ?? null,
      validation_status: temperature?.validationStatus ?? null,
    },
    simulation_context: {
      connection_status: node?.connectionStatus ?? null,
      previous_simulated_state: state.previousSimulatedFanState,
      last_simulated_state_change_at: state.lastSimulatedFanStateChangeAt,
      evaluated_at: state.simulatedNow,
    },
  };
}

/** Display-only classification using the same 30-second boundary as sim-hvac-v1. */
export function simulatedFreshness(observedAt: string | undefined, simulatedNow: string): TwinFreshness {
  if (!observedAt || !Number.isFinite(Date.parse(observedAt)) || !Number.isFinite(Date.parse(simulatedNow))) return 'UNAVAILABLE';
  const ageMs = Date.parse(simulatedNow) - Date.parse(observedAt);
  if (ageMs < 0) return 'FUTURE';
  return ageMs > 30_000 ? 'STALE' : 'FRESH';
}
