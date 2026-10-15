import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createInitialTwinState, TWIN_ISOLATION } from '../src/model/twin.ts';
import { twinReducer } from '../src/model/twinReducer.ts';

const initial = createInitialTwinState();
assert.equal(initial.context, 'simulation');
assert.equal(initial.simulated, true);
assert.deepEqual(initial.nodes.map((node) => node.id), ['SIM-NODE-01']);
assert.ok(initial.sensors.every((sensor) => sensor.id.startsWith('SIM-SENSOR-') && sensor.synthetic));
assert.ok(initial.actuators.every((actuator) => actuator.id.startsWith('SIM-ACTUATOR-') && actuator.synthetic));
assert.ok(!JSON.stringify(initial).includes('NODE-04'));
assert.deepEqual(TWIN_ISOLATION, {
  browserLocal: true, operationalApiAccess: false, sharedStoreAccess: false, journalWrites: false, physicalCommands: false,
});

const changed = { ...initial, scenarioInputs: { ...initial.scenarioInputs, temperatureC: 99 } };
const reset = twinReducer(changed, { type: 'RESET_SIMULATION' });
assert.notEqual(reset, initial);
assert.equal(reset.scenarioInputs.temperatureC, 24.5);
assert.equal(reset.nodes[0].id, 'SIM-NODE-01');

const twinModule = readFileSync(new URL('../src/model/twin.ts', import.meta.url), 'utf8');
const reducerModule = readFileSync(new URL('../src/model/twinReducer.ts', import.meta.url), 'utf8');
assert.ok(!/services\/cps|services\/operational|state\/store/.test(twinModule));
assert.ok(!/services\/cps|services\/operational|state\/store/.test(reducerModule));

const iotPage = readFileSync(new URL('../src/pages/IoT.tsx', import.meta.url), 'utf8');
assert.match(iotPage, /function SimulationCenter\(\)/);
assert.match(iotPage, /area === 'simulation' \? <SimulationCenter \/>/);
assert.match(iotPage, /Real Operations/);
assert.match(iotPage, /Simulation Center/);
console.log('twin state tests passed');
