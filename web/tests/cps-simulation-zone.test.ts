import { createInitialTwinState, evaluateSimulationExhaust, evaluateSimulationHvac, exhaustFanState, simulationEvaluationRequest, twinReducer } from '../src/cps-workspace';
import type { TwinState } from '../src/cps-workspace';

let failures = 0;
const ok = (condition: boolean, label: string) => { if (!condition) { failures += 1; console.error(`FAIL ${label}`); } };

/** Mirrors the Simulation Center "Run" button: one simulated minute, a fresh reading, then evaluate. */
function run(state: TwinState): TwinState {
  const temperature = state.sensors.find((sensor) => sensor.id === 'SIM-SENSOR-TEMP-01')?.value ?? 0;
  let next = twinReducer(state, { type: 'ADVANCE_SIMULATED_TIME', seconds: 60 });
  next = twinReducer(next, { type: 'SET_SIMULATED_TEMPERATURE', value: temperature });
  const request = simulationEvaluationRequest(next); const generation = next.evaluationGeneration + 1;
  next = twinReducer(next, { type: 'BEGIN_SIMULATION_EVALUATION' });
  return twinReducer(next, { type: 'SET_SIMULATION_EVALUATION', value: evaluateSimulationHvac(request), request, generation });
}
const fans = (state: TwinState, prefix: string) => state.actuators.filter((item) => item.id.startsWith(prefix)).map((item) => item.state);

let twin = createInitialTwinState();
ok(fans(twin, 'SIM-ACTUATOR-FAN-').length === 2 && fans(twin, 'SIM-ACTUATOR-EXH-').length === 2, 'zone has two circulation and two exhaust fans');

twin = twinReducer(twin, { type: 'SET_SIMULATED_TEMPERATURE', value: 28 });
twin = run(twin);
ok(twin.latestEvaluation?.response.evaluation.recommendation === 'TURN_FAN_ON', 'heat triggers a circulation recommendation');
twin = twinReducer(twin, { type: 'APPLY_SIMULATION_RECOMMENDATION' });
ok(fans(twin, 'SIM-ACTUATOR-FAN-').every((state) => state === 'ON'), 'apply turns both circulation fans on');

twin = twinReducer(twin, { type: 'SET_SIMULATED_TEMPERATURE', value: 23 });
twin = run(twin);
ok(twin.latestEvaluation?.response.evaluation.recommendation === 'TURN_FAN_OFF', 'cooling after a minute recommends turning circulation off');
twin = twinReducer(twin, { type: 'APPLY_SIMULATION_RECOMMENDATION' });
ok(fans(twin, 'SIM-ACTUATOR-FAN-').every((state) => state === 'OFF'), 'apply turns both circulation fans off');

ok(evaluateSimulationExhaust(twin).recommendation === 'HOLD', 'no exhaust with an empty zone');
twin = twinReducer(twin, { type: 'SET_SIMULATED_PEOPLE_COUNT', value: 18 });
ok(evaluateSimulationExhaust(twin).recommendation === 'TURN_EXHAUST_ON', 'a crowd recommends exhaust');
twin = twinReducer(twin, { type: 'APPLY_EXHAUST_RECOMMENDATION' });
ok(exhaustFanState(twin) === 'ON' && fans(twin, 'SIM-ACTUATOR-EXH-').every((state) => state === 'ON'), 'apply turns both exhaust fans on');
twin = twinReducer(twin, { type: 'SET_SIMULATED_PEOPLE_COUNT', value: 12 });
ok(evaluateSimulationExhaust(twin).recommendation === 'HOLD', 'exhaust holds between the on and off limits');
twin = twinReducer(twin, { type: 'SET_SIMULATED_PEOPLE_COUNT', value: 6 });
ok(evaluateSimulationExhaust(twin).recommendation === 'TURN_EXHAUST_OFF', 'a thinning crowd recommends exhaust off');
twin = twinReducer(twin, { type: 'APPLY_EXHAUST_RECOMMENDATION' });
ok(exhaustFanState(twin) === 'OFF', 'apply turns exhaust off');

twin = twinReducer(twin, { type: 'SET_SIMULATED_PEOPLE_COUNT', value: 30 });
twin = twinReducer(twin, { type: 'SET_SIMULATED_CONNECTION', value: 'OFFLINE' });
ok(evaluateSimulationExhaust(twin).recommendation === 'INSUFFICIENT_DATA', 'offline node gives no exhaust recommendation');
const before = exhaustFanState(twin);
twin = twinReducer(twin, { type: 'APPLY_EXHAUST_RECOMMENDATION' });
ok(exhaustFanState(twin) === before, 'nothing is applied while the node is offline');
twin = run(twin);
ok(twin.latestEvaluation?.response.evaluation.recommendation === 'INSUFFICIENT_DATA', 'offline node gives no circulation recommendation');
twin = twinReducer(twin, { type: 'RESET_SIMULATION' });
ok(exhaustFanState(twin) === 'OFF' && fans(twin, 'SIM-ACTUATOR-FAN-').every((state) => state === 'OFF') && twin.nodes[0].connectionStatus === 'ONLINE', 'reset restores the zone');

// Simulated AI detections
let zone = createInitialTwinState();
ok(zone.simulatedThreat === null, 'starts with no simulated detection');
zone = twinReducer(zone, { type: 'SIMULATE_THREAT', kind: 'weapon' });
ok(zone.simulatedThreat?.kind === 'weapon' && zone.simulatedThreat.cameraId === 'CAM-C', 'weapon is detected by the central camera');
const beforeProtocol = JSON.stringify(zone.actuators);
zone = twinReducer(zone, { type: 'APPLY_FIRE_PROTOCOL' });
ok(JSON.stringify(zone.actuators) === beforeProtocol, 'smoke control does nothing without a fire');
zone = twinReducer(zone, { type: 'APPLY_SIMULATION_RECOMMENDATION' });
zone = twinReducer(zone, { type: 'SIMULATE_THREAT', kind: 'fire' });
ok(zone.simulatedThreat?.kind === 'fire' && zone.simulatedThreat.cameraId === 'CAM-2', 'fire replaces the previous detection and is seen by CAM-2');
zone = twinReducer(zone, { type: 'APPLY_FIRE_PROTOCOL' });
ok(exhaustFanState(zone) === 'ON' && fans(zone, 'SIM-ACTUATOR-FAN-').every((state) => state === 'OFF'), 'smoke control: exhaust on, circulation off');
zone = twinReducer(zone, { type: 'CLEAR_THREAT' });
ok(zone.simulatedThreat === null, 'clear removes the detection');
zone = twinReducer(twinReducer(zone, { type: 'SIMULATE_THREAT', kind: 'fight' }), { type: 'RESET_SIMULATION' });
ok(zone.simulatedThreat === null, 'reset removes the detection');

if (failures) process.exit(1);
console.log('CPS simulation zone tests passed');
