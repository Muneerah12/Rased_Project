import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createInitialTwinState, simulatedFreshness } from '../src/model/twin.ts';
import { twinReducer } from '../src/model/twinReducer.ts';
import { fanAnimationEnabled, visitorDisplayCount } from '../src/ui/SimulationHall.tsx';

const initial = createInitialTwinState();
const advanced = twinReducer(initial, { type: 'ADVANCE_SIMULATED_TIME', seconds: 30 });
const heated = twinReducer(advanced, { type: 'SET_SIMULATED_TEMPERATURE', value: 28.5 });
const temperature = heated.sensors.find((sensor) => sensor.id === 'SIM-SENSOR-TEMP-01');
assert.equal(temperature?.value, 28.5);
assert.equal(temperature?.observedAt, advanced.simulatedNow);
assert.equal(simulatedFreshness(advanced.simulatedNow, advanced.simulatedNow), 'FRESH');
assert.equal(simulatedFreshness(initial.simulatedNow, '2026-10-10T12:00:31Z'), 'STALE');
assert.equal(simulatedFreshness('2026-10-10T12:00:01Z', initial.simulatedNow), 'FUTURE');
assert.equal(simulatedFreshness(undefined, initial.simulatedNow), 'UNAVAILABLE');

const crowd = twinReducer(heated, { type: 'SET_SIMULATED_PEOPLE_COUNT', value: 18 });
assert.equal(crowd.scenarioInputs.simulatedPeopleCount, 18);
assert.equal(visitorDisplayCount(crowd.scenarioInputs.simulatedPeopleCount), 16);
assert.equal(visitorDisplayCount(-4), 0);
assert.equal(visitorDisplayCount(999), 16);

// Judge-demo scenarios remain deterministic Twin-only changes. Crowd is visual only.
const crowdSurge = twinReducer(initial, { type: 'SET_SIMULATED_PEOPLE_COUNT', value: 24 });
assert.equal(crowdSurge.scenarioInputs.simulatedPeopleCount, 24);
assert.equal(crowdSurge.sensors.find((sensor) => sensor.id === 'SIM-SENSOR-TEMP-01')?.value, 24.5);
const heatWave = twinReducer(initial, { type: 'SET_SIMULATED_TEMPERATURE', value: 28 });
assert.equal(heatWave.sensors.find((sensor) => sensor.id === 'SIM-SENSOR-TEMP-01')?.value, 28);
assert.equal(heatWave.sensors.find((sensor) => sensor.id === 'SIM-SENSOR-TEMP-01')?.observedAt, initial.simulatedNow);
const sensorFailure = twinReducer(initial, { type: 'SET_SIMULATED_CONNECTION', value: 'OFFLINE' });
assert.equal(sensorFailure.nodes[0].connectionStatus, 'OFFLINE');
const operatorControl = twinReducer(
  twinReducer(
    twinReducer(
      twinReducer(heatWave, { type: 'SET_SIMULATED_PEOPLE_COUNT', value: 24 }),
      { type: 'SET_SIMULATED_CONNECTION', value: 'OFFLINE' },
    ),
    { type: 'SET_SIMULATED_TEMPERATURE', value: 24.5 },
  ),
  { type: 'SET_SIMULATED_PEOPLE_COUNT', value: 0 },
);
const restored = twinReducer(operatorControl, { type: 'SET_SIMULATED_CONNECTION', value: 'ONLINE' });
assert.equal(restored.nodes[0].connectionStatus, 'ONLINE');
assert.equal(restored.scenarioInputs.temperatureC, 24.5);
assert.equal(restored.scenarioInputs.simulatedPeopleCount, 0);
assert.ok(!JSON.stringify(restored).includes('NODE-04'));

const offline = twinReducer(crowd, { type: 'SET_SIMULATED_CONNECTION', value: 'OFFLINE' });
assert.equal(offline.nodes[0].connectionStatus, 'OFFLINE');
assert.equal(fanAnimationEnabled('OFF'), false);
assert.equal(fanAnimationEnabled('UNAVAILABLE'), false);
assert.equal(fanAnimationEnabled('ON'), true);

const hallSource = readFileSync(new URL('../src/ui/SimulationHall.tsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
assert.ok(hallSource.includes('FAN {fanState}'));
assert.ok(hallSource.includes('{connectionStatus}</text>'));
assert.ok(styles.includes('.sim-simple-controls { display: grid; grid-template-columns: repeat(3'));
assert.ok(styles.includes('.sim-decision-panel .card'));
assert.ok(styles.includes('.sim-hall.node-offline .sim-node rect'));
console.log('simulation hall tests passed');
