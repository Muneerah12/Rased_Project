/** Browser-local contracts for the isolated CPS Operations workspace. */
export type CpsWorkspaceTab = 'overview' | 'ot' | 'iot' | 'noc';

/** Canonical CPS navigation order. Kept outside the styled React entry point for testability. */
export const CPS_WORKSPACE_TABS: ReadonlyArray<{ id: CpsWorkspaceTab; label: { ar: string; en: string } }> = [
  { id: 'overview', label: { ar: 'نظرة عامة', en: 'Overview' } },
  { id: 'ot', label: { ar: 'التشغيل التقني', en: 'OT' } },
  { id: 'iot', label: { ar: 'إنترنت الأشياء', en: 'IoT' } },
  { id: 'noc', label: { ar: 'مركز عمليات الشبكة', en: 'NOC' } },
];
export type TwinConnectionStatus = 'ONLINE' | 'STALE' | 'OFFLINE';
export type TwinActuatorState = 'ON' | 'OFF' | 'UNAVAILABLE';
export type TwinValidationStatus = 'NORMAL' | 'UNKNOWN' | 'SUSPICIOUS' | 'INVALID';
export type TwinHvacRecommendation = 'TURN_FAN_ON' | 'TURN_FAN_OFF' | 'HOLD' | 'INSUFFICIENT_DATA';
export type TwinFreshness = 'FRESH' | 'STALE' | 'FUTURE' | 'UNAVAILABLE';

export interface TwinNode { id: `SIM-NODE-${string}`; label: string; connectionStatus: TwinConnectionStatus }
export interface TwinSensor { id: `SIM-SENSOR-${string}`; nodeId: TwinNode['id']; label: string; value: number; unit: string; observedAt: string; validationStatus: TwinValidationStatus; synthetic: true }
export interface TwinActuator { id: `SIM-ACTUATOR-${string}`; nodeId: TwinNode['id']; label: string; state: TwinActuatorState; synthetic: true }
export interface TwinScenarioInputs { temperatureC: number; peerHumidityPct: number; simulatedPeopleCount: number }
export interface TwinSimulationEvaluation {
  schema_version: 'simulation-hvac-evaluation-api-v1'; context: 'simulation'; simulated: true;
  evaluation: { recommendation: TwinHvacRecommendation; reason_code: string; reason: string; policy_version: 'sim-hvac-v1'; evaluated_at: string; input_timestamp: string | null; connection_status: TwinConnectionStatus | null; previous_simulated_state: Exclude<TwinActuatorState, 'UNAVAILABLE'> | null; proposed_simulated_state: Exclude<TwinActuatorState, 'UNAVAILABLE'> | null };
}
export interface TwinSimulationEvaluationRequest {
  schema_version: 'simulation-hvac-evaluate-request-v1'; context: 'simulation'; simulated: true;
  sensor: { temperature_c: number | null; observed_at: string | null; validation_status: TwinValidationStatus | null };
  simulation_context: { connection_status: TwinConnectionStatus | null; previous_simulated_state: Exclude<TwinActuatorState, 'UNAVAILABLE'> | null; last_simulated_state_change_at: string | null; evaluated_at: string };
}
export interface TwinStoredEvaluation { response: TwinSimulationEvaluation; request: TwinSimulationEvaluationRequest; generation: number }
export interface TwinVirtualActuation { state: Exclude<TwinActuatorState, 'UNAVAILABLE'>; appliedAt: string; recommendation: 'TURN_FAN_ON' | 'TURN_FAN_OFF'; reason: string; reasonCode: string }
export type SimThreatKind = 'fire' | 'weapon' | 'fight';
/** A synthetic AI detection placed in the virtual zone (no real model or camera involved). */
export interface TwinSimThreat { kind: SimThreatKind; cameraId: 'CAM-C' | 'CAM-1' | 'CAM-2'; x: number; y: number; confidence: number; detectedAt: string }
/** Where each scenario happens and which virtual camera's view covers that spot. */
export const SIM_THREAT_SCENARIOS: Record<SimThreatKind, Omit<TwinSimThreat, 'detectedAt'>> = {
  fire: { kind: 'fire', cameraId: 'CAM-2', x: 2.8, y: 3.3, confidence: 0.94 },
  weapon: { kind: 'weapon', cameraId: 'CAM-C', x: 5.0, y: 5.2, confidence: 0.91 },
  fight: { kind: 'fight', cameraId: 'CAM-1', x: 3.4, y: 4.6, confidence: 0.87 },
};
export interface TwinState {
  context: 'simulation'; simulated: true; simulatedThreat: TwinSimThreat | null; simulatedNow: string; nodes: TwinNode[]; sensors: TwinSensor[]; actuators: TwinActuator[]; scenarioInputs: TwinScenarioInputs; previousSimulatedFanState: Exclude<TwinActuatorState, 'UNAVAILABLE'> | null; lastSimulatedFanStateChangeAt: string | null; evaluationGeneration: number; latestEvaluation: TwinStoredEvaluation | null; lastVirtualActuation: TwinVirtualActuation | null;
}

/** This Twin has no bridge to host state, operational systems, or physical devices. */
export const CPS_WORKSPACE_ISOLATION = { browserLocalTwin: true, hostStoreWrites: false, operationalApiAccess: false, journalWrites: false, physicalCommands: false } as const;
const INITIAL_NOW = '2026-10-10T12:00:00Z';
const INITIAL_FAN_CHANGED_AT = '2026-10-10T11:59:00Z';

export function createInitialTwinState(): TwinState {
  const nodeId: TwinNode['id'] = 'SIM-NODE-01';
  return {
    context: 'simulation', simulated: true, simulatedThreat: null, simulatedNow: INITIAL_NOW,
    nodes: [{ id: nodeId, label: 'Virtual environmental node', connectionStatus: 'ONLINE' }],
    sensors: [
      { id: 'SIM-SENSOR-TEMP-01', nodeId, label: 'Virtual temperature', value: 24.5, unit: '°C', observedAt: INITIAL_NOW, validationStatus: 'NORMAL', synthetic: true },
      { id: 'SIM-SENSOR-HUM-01', nodeId, label: 'Virtual humidity', value: 40, unit: '%', observedAt: INITIAL_NOW, validationStatus: 'NORMAL', synthetic: true },
      { id: 'SIM-SENSOR-PRESS-01', nodeId, label: 'Virtual pressure', value: 1012, unit: 'hPa', observedAt: INITIAL_NOW, validationStatus: 'NORMAL', synthetic: true },
    ],
    actuators: [
      { id: 'SIM-ACTUATOR-FAN-01', nodeId, label: 'Virtual circulation fan 1', state: 'OFF', synthetic: true },
      { id: 'SIM-ACTUATOR-FAN-02', nodeId, label: 'Virtual circulation fan 2', state: 'OFF', synthetic: true },
      { id: 'SIM-ACTUATOR-EXH-01', nodeId, label: 'Virtual exhaust fan 1', state: 'OFF', synthetic: true },
      { id: 'SIM-ACTUATOR-EXH-02', nodeId, label: 'Virtual exhaust fan 2', state: 'OFF', synthetic: true },
    ],
    scenarioInputs: { temperatureC: 24.5, peerHumidityPct: 40, simulatedPeopleCount: 0 }, previousSimulatedFanState: 'OFF', lastSimulatedFanStateChangeAt: INITIAL_FAN_CHANGED_AT, evaluationGeneration: 0, latestEvaluation: null, lastVirtualActuation: null,
  };
}

export function simulationEvaluationRequest(state: TwinState): TwinSimulationEvaluationRequest {
  const temperature = state.sensors.find((sensor) => sensor.id === 'SIM-SENSOR-TEMP-01');
  return {
    schema_version: 'simulation-hvac-evaluate-request-v1', context: 'simulation', simulated: true,
    sensor: { temperature_c: temperature?.value ?? null, observed_at: temperature?.observedAt ?? null, validation_status: temperature?.validationStatus ?? null },
    simulation_context: { connection_status: state.nodes[0]?.connectionStatus ?? null, previous_simulated_state: state.previousSimulatedFanState, last_simulated_state_change_at: state.lastSimulatedFanStateChangeAt, evaluated_at: state.simulatedNow },
  };
}

export function simulatedFreshness(observedAt: string | undefined, simulatedNow: string): TwinFreshness {
  if (!observedAt || !Number.isFinite(Date.parse(observedAt)) || !Number.isFinite(Date.parse(simulatedNow))) return 'UNAVAILABLE';
  const ageMs = Date.parse(simulatedNow) - Date.parse(observedAt);
  return ageMs < 0 ? 'FUTURE' : ageMs > 30_000 ? 'STALE' : 'FRESH';
}
