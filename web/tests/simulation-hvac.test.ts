import { canApplySimulationRecommendation, createInitialTwinState, evaluateSimulationHvac, simulationEvaluationRequest, twinReducer } from '../src/cps-workspace';

let failures = 0;
const ok = (condition: boolean, label: string) => { console.log(`${condition ? 'PASS' : 'FAIL'} ${label}`); if (!condition) failures++; };
const response = (state: ReturnType<typeof createInitialTwinState>) => evaluateSimulationHvac(simulationEvaluationRequest(state));

let initial = createInitialTwinState();
ok(response(initial).evaluation.recommendation === 'HOLD', 'holds in the canonical hysteresis band');
let hot = twinReducer(initial, { type: 'SET_SIMULATED_TEMPERATURE', value: 26 });
ok(response(hot).evaluation.recommendation === 'TURN_FAN_ON', 'recommends ON at the inclusive 26°C threshold');
let cold: ReturnType<typeof createInitialTwinState> = { ...initial, previousSimulatedFanState: 'ON', lastSimulatedFanStateChangeAt: '2026-10-10T11:59:00Z', actuators: initial.actuators.map((item) => ({ ...item, state: 'ON' })) };
cold = twinReducer(cold, { type: 'SET_SIMULATED_TEMPERATURE', value: 24 });
ok(response(cold).evaluation.recommendation === 'TURN_FAN_OFF', 'recommends OFF at the inclusive 24°C threshold');
const offline = twinReducer(hot, { type: 'SET_SIMULATED_CONNECTION', value: 'OFFLINE' });
ok(response(offline).evaluation.reason_code === 'NODE_NOT_ONLINE', 'rejects a disconnected virtual node');
const stale = twinReducer(hot, { type: 'ADVANCE_SIMULATED_TIME', seconds: 31 });
ok(response(stale).evaluation.reason_code === 'STALE_INPUT_TIMESTAMP', 'rejects a synthetic reading older than 30 seconds');
const dwell = { ...hot, lastSimulatedFanStateChangeAt: '2026-10-10T11:59:01Z' };
ok(response(dwell).evaluation.reason_code === 'MINIMUM_DWELL_ACTIVE', 'enforces the canonical 60-second virtual dwell');
const invalid = simulationEvaluationRequest(hot); invalid.sensor.validation_status = 'INVALID';
ok(evaluateSimulationHvac(invalid).evaluation.reason_code === 'UNTRUSTED_SENSOR_STATUS', 'requires NORMAL synthetic validation status');

const request = simulationEvaluationRequest(hot); const generation = hot.evaluationGeneration + 1;
let evaluated = twinReducer(hot, { type: 'BEGIN_SIMULATION_EVALUATION' });
evaluated = twinReducer(evaluated, { type: 'SET_SIMULATION_EVALUATION', value: evaluateSimulationHvac(request), request, generation });
ok(canApplySimulationRecommendation(evaluated), 'makes only an eligible synthetic recommendation actionable');
const applied = twinReducer(evaluated, { type: 'APPLY_SIMULATION_RECOMMENDATION' });
ok(applied.actuators[0]?.state === 'ON' && applied.lastVirtualActuation?.state === 'ON', 'applies only to the browser-local virtual fan');
const changed = twinReducer(evaluated, { type: 'SET_SIMULATED_TEMPERATURE', value: 27 });
ok(!canApplySimulationRecommendation(changed), 'invalidates a stale result after a scenario change');
const reset = twinReducer(evaluated, { type: 'RESET_SIMULATION' });
ok(!canApplySimulationRecommendation(reset) && reset.latestEvaluation === null, 'reset invalidates the evaluation generation');

if (failures) throw new Error(`${failures} browser-local simulation HVAC test(s) failed`);
