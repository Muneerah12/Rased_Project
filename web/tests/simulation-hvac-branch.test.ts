import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createInitialTwinState, simulationEvaluationRequest } from '../src/model/twin.ts';
import { canApplySimulationRecommendation, twinReducer } from '../src/model/twinReducer.ts';
import { parseSimulationHvacEvaluation } from '../src/services/simulationHvac.ts';

const initial = createInitialTwinState();
const request = simulationEvaluationRequest(initial);
assert.equal(request.context, 'simulation');
assert.equal(request.simulated, true);
assert.equal(request.sensor.temperature_c, 24.5);
assert.equal(request.simulation_context.connection_status, 'ONLINE');
assert.equal(request.simulation_context.previous_simulated_state, 'OFF');
assert.ok(!JSON.stringify(request).includes('NODE-04'));
assert.ok(!JSON.stringify(request).includes('simulatedPeopleCount'));

const temperatureChanged = twinReducer(initial, { type: 'SET_SIMULATED_TEMPERATURE', value: 27 });
assert.equal(simulationEvaluationRequest(temperatureChanged).sensor.temperature_c, 27);
assert.equal(temperatureChanged.latestEvaluation, null);
const heatScenario = twinReducer(initial, { type: 'SET_SIMULATED_TEMPERATURE', value: 28 });
assert.equal(simulationEvaluationRequest(heatScenario).sensor.temperature_c, 28);
assert.equal(heatScenario.sensors.find((sensor) => sensor.id === 'SIM-SENSOR-TEMP-01')?.observedAt, heatScenario.simulatedNow);
const visitorsScenario = twinReducer(initial, { type: 'SET_SIMULATED_PEOPLE_COUNT', value: initial.scenarioInputs.simulatedPeopleCount + 8 });
assert.equal(visitorsScenario.scenarioInputs.simulatedPeopleCount, 8);
const disconnectedScenario = twinReducer(initial, { type: 'SET_SIMULATED_CONNECTION', value: 'OFFLINE' });
assert.equal(disconnectedScenario.nodes[0].connectionStatus, 'OFFLINE');
const timeAdvanced = twinReducer(temperatureChanged, { type: 'ADVANCE_SIMULATED_TIME', seconds: 60 });
assert.equal(timeAdvanced.simulatedNow, '2026-10-10T12:01:00.000Z');
assert.equal(twinReducer(timeAdvanced, { type: 'ADVANCE_SIMULATED_TIME', seconds: -1 }), timeAdvanced);
assert.equal(twinReducer(timeAdvanced, { type: 'SET_SIMULATED_PEOPLE_COUNT', value: -1 }), timeAdvanced);

const valid = {
  schema_version: 'simulation-hvac-evaluation-api-v1', context: 'simulation', simulated: true,
  evaluation: {
    recommendation: 'TURN_FAN_ON', reason_code: 'TEMPERATURE_AT_OR_ABOVE_ON_THRESHOLD', reason: 'Synthetic only.', policy_version: 'sim-hvac-v1',
    evaluated_at: '2026-10-10T12:01:00Z', input_timestamp: '2026-10-10T12:01:00Z', connection_status: 'ONLINE',
    previous_simulated_state: 'OFF', proposed_simulated_state: 'ON',
  },
};
const parsed = parseSimulationHvacEvaluation(valid);
assert.ok(parsed);
assert.equal(parsed.evaluation.recommendation, 'TURN_FAN_ON');
assert.equal(parseSimulationHvacEvaluation({ ...valid, context: 'real_operations' }), null);
assert.equal(parseSimulationHvacEvaluation({ ...valid, command: 'ON' }), null);
assert.equal(parseSimulationHvacEvaluation({ ...valid, evaluation: { ...valid.evaluation, policy_version: 'operational-hvac-v1' } }), null);

function simulatedRecommendation(state: ReturnType<typeof createInitialTwinState>, recommendation: 'TURN_FAN_ON' | 'TURN_FAN_OFF' | 'HOLD' | 'INSUFFICIENT_DATA') {
  const input = simulationEvaluationRequest(state);
  const proposed = recommendation === 'TURN_FAN_ON' ? 'ON' : recommendation === 'TURN_FAN_OFF' ? 'OFF' : state.previousSimulatedFanState;
  const response = parseSimulationHvacEvaluation({
    schema_version: 'simulation-hvac-evaluation-api-v1', context: 'simulation', simulated: true,
    evaluation: {
      recommendation, reason_code: 'TEST_ONLY', reason: 'Synthetic test result.', policy_version: 'sim-hvac-v1',
      evaluated_at: input.simulation_context.evaluated_at, input_timestamp: input.sensor.observed_at,
      connection_status: input.simulation_context.connection_status, previous_simulated_state: input.simulation_context.previous_simulated_state,
      proposed_simulated_state: proposed,
    },
  });
  assert.ok(response);
  return { input, response };
}

const onInput = twinReducer(createInitialTwinState(), { type: 'SET_SIMULATED_TEMPERATURE', value: 26 });
const on = simulatedRecommendation(onInput, 'TURN_FAN_ON');
const stagedOn = twinReducer(onInput, { type: 'SET_SIMULATION_EVALUATION', value: on.response, request: on.input, generation: onInput.evaluationGeneration });
assert.ok(canApplySimulationRecommendation(stagedOn));
const appliedOn = twinReducer(stagedOn, { type: 'APPLY_SIMULATION_RECOMMENDATION' });
assert.equal(appliedOn.actuators[0].state, 'ON');
assert.equal(appliedOn.previousSimulatedFanState, 'ON');
assert.equal(appliedOn.lastSimulatedFanStateChangeAt, on.input.simulation_context.evaluated_at);
assert.equal(appliedOn.latestEvaluation, null);
assert.equal(appliedOn.lastVirtualActuation?.recommendation, 'TURN_FAN_ON');
assert.equal(appliedOn.lastVirtualActuation?.reasonCode, 'TEST_ONLY');
assert.equal(twinReducer(appliedOn, { type: 'APPLY_SIMULATION_RECOMMENDATION' }), appliedOn);

const offPrepared = twinReducer(twinReducer(appliedOn, { type: 'ADVANCE_SIMULATED_TIME', seconds: 60 }), { type: 'SET_SIMULATED_TEMPERATURE', value: 24 });
const off = simulatedRecommendation(offPrepared, 'TURN_FAN_OFF');
const appliedOff = twinReducer(twinReducer(offPrepared, { type: 'SET_SIMULATION_EVALUATION', value: off.response, request: off.input, generation: offPrepared.evaluationGeneration }), { type: 'APPLY_SIMULATION_RECOMMENDATION' });
assert.equal(appliedOff.actuators[0].state, 'OFF');
assert.equal(appliedOff.lastSimulatedFanStateChangeAt, off.input.simulation_context.evaluated_at);

// UTC formatting differences must not hide a valid action after simulated time advances.
const advancedHot = twinReducer(
  twinReducer(createInitialTwinState(), { type: 'ADVANCE_SIMULATED_TIME', seconds: 10 }),
  { type: 'SET_SIMULATED_TEMPERATURE', value: 40 },
);
const advancedHotRecommendation = simulatedRecommendation(advancedHot, 'TURN_FAN_ON');
assert.match(advancedHotRecommendation.input.simulation_context.evaluated_at, /\.000Z$/);
assert.match(advancedHotRecommendation.input.sensor.observed_at ?? '', /\.000Z$/);
const normalizedTimestampResponse = parseSimulationHvacEvaluation({
  ...advancedHotRecommendation.response,
  evaluation: {
    ...advancedHotRecommendation.response.evaluation,
    evaluated_at: advancedHotRecommendation.response.evaluation.evaluated_at.replace('.000Z', 'Z'),
    input_timestamp: advancedHotRecommendation.response.evaluation.input_timestamp?.replace('.000Z', 'Z') ?? null,
  },
});
assert.ok(normalizedTimestampResponse);
const stagedNormalizedTimestamps = twinReducer(advancedHot, {
  type: 'SET_SIMULATION_EVALUATION', value: normalizedTimestampResponse, request: advancedHotRecommendation.input, generation: advancedHot.evaluationGeneration,
});
assert.ok(canApplySimulationRecommendation(stagedNormalizedTimestamps));
assert.equal(stagedNormalizedTimestamps.actuators[0].state, 'OFF');
assert.equal(twinReducer(stagedNormalizedTimestamps, { type: 'APPLY_SIMULATION_RECOMMENDATION' }).actuators[0].state, 'ON');

const differentTimestampResponse = parseSimulationHvacEvaluation({
  ...advancedHotRecommendation.response,
  evaluation: { ...advancedHotRecommendation.response.evaluation, evaluated_at: '2026-10-10T12:00:11Z' },
});
assert.ok(differentTimestampResponse);
const stagedDifferentTimestamp = twinReducer(advancedHot, {
  type: 'SET_SIMULATION_EVALUATION', value: differentTimestampResponse, request: advancedHotRecommendation.input, generation: advancedHot.evaluationGeneration,
});
assert.equal(canApplySimulationRecommendation(stagedDifferentTimestamp), false);
const invalidTimestampResponse = {
  ...advancedHotRecommendation.response,
  evaluation: { ...advancedHotRecommendation.response.evaluation, evaluated_at: 'not-a-timestamp' },
};
assert.equal(parseSimulationHvacEvaluation(invalidTimestampResponse), null);
const stagedInvalidTimestamp = twinReducer(advancedHot, {
  type: 'SET_SIMULATION_EVALUATION', value: invalidTimestampResponse as typeof advancedHotRecommendation.response, request: advancedHotRecommendation.input, generation: advancedHot.evaluationGeneration,
});
assert.equal(canApplySimulationRecommendation(stagedInvalidTimestamp), false);

const hold = simulatedRecommendation(onInput, 'HOLD');
const stagedHold = twinReducer(onInput, { type: 'SET_SIMULATION_EVALUATION', value: hold.response, request: hold.input, generation: onInput.evaluationGeneration });
assert.equal(canApplySimulationRecommendation(stagedHold), false);
assert.equal(twinReducer(stagedHold, { type: 'APPLY_SIMULATION_RECOMMENDATION' }), stagedHold);

const insufficient = simulatedRecommendation(onInput, 'INSUFFICIENT_DATA');
const stagedInsufficient = twinReducer(onInput, { type: 'SET_SIMULATION_EVALUATION', value: insufficient.response, request: insufficient.input, generation: onInput.evaluationGeneration });
assert.equal(canApplySimulationRecommendation(stagedInsufficient), false);
assert.equal(twinReducer(stagedInsufficient, { type: 'APPLY_SIMULATION_RECOMMENDATION' }), stagedInsufficient);

const staleCandidate = twinReducer(onInput, { type: 'SET_SIMULATION_EVALUATION', value: on.response, request: on.input, generation: onInput.evaluationGeneration });
const changedAfterEvaluation = twinReducer(staleCandidate, { type: 'ADVANCE_SIMULATED_TIME', seconds: 10 });
assert.equal(changedAfterEvaluation.latestEvaluation, null);
assert.equal(twinReducer(changedAfterEvaluation, { type: 'APPLY_SIMULATION_RECOMMENDATION' }), changedAfterEvaluation);
const superseded = twinReducer(changedAfterEvaluation, { type: 'SET_SIMULATION_EVALUATION', value: on.response, request: on.input, generation: onInput.evaluationGeneration });
assert.equal(superseded, changedAfterEvaluation);
for (const action of [
  { type: 'SET_SIMULATED_TEMPERATURE' as const, value: 27 },
  { type: 'SET_SIMULATED_CONNECTION' as const, value: 'STALE' as const },
]) {
  const staged = twinReducer(onInput, { type: 'SET_SIMULATION_EVALUATION', value: on.response, request: on.input, generation: onInput.evaluationGeneration });
  const invalidated = twinReducer(staged, action);
  assert.equal(invalidated.latestEvaluation, null);
  assert.equal(twinReducer(invalidated, { type: 'APPLY_SIMULATION_RECOMMENDATION' }), invalidated);
}

const dwell = twinReducer(appliedOn, { type: 'ADVANCE_SIMULATED_TIME', seconds: 59 });
assert.equal(simulationEvaluationRequest(dwell).simulation_context.last_simulated_state_change_at, on.input.simulation_context.evaluated_at);
assert.equal(Date.parse(simulationEvaluationRequest(dwell).simulation_context.evaluated_at) - Date.parse(on.input.simulation_context.evaluated_at), 59_000);
const reset = twinReducer(appliedOff, { type: 'RESET_SIMULATION' });
assert.equal(reset.actuators[0].state, 'OFF');
assert.equal(reset.latestEvaluation, null);
assert.equal(reset.lastVirtualActuation, null);

// Starting a new run revokes the previous actionable recommendation before any API response arrives.
const beginsWithStoredResult = twinReducer(onInput, { type: 'SET_SIMULATION_EVALUATION', value: on.response, request: on.input, generation: onInput.evaluationGeneration });
const begun = twinReducer(beginsWithStoredResult, { type: 'BEGIN_SIMULATION_EVALUATION' });
assert.equal(begun.latestEvaluation, null);
assert.ok(!canApplySimulationRecommendation(begun));

// A delayed response cannot be revived by Reset or by returning to an otherwise identical snapshot.
const delayed = simulatedRecommendation(createInitialTwinState(), 'TURN_FAN_ON');
const runStarted = twinReducer(createInitialTwinState(), { type: 'BEGIN_SIMULATION_EVALUATION' });
const resetDuringRun = twinReducer(runStarted, { type: 'RESET_SIMULATION' });
const rejectedAfterReset = twinReducer(resetDuringRun, { type: 'SET_SIMULATION_EVALUATION', value: delayed.response, request: delayed.input, generation: runStarted.evaluationGeneration });
assert.equal(rejectedAfterReset.latestEvaluation, null);
const changedThenRestored = twinReducer(twinReducer(runStarted, { type: 'SET_SIMULATED_TEMPERATURE', value: 28 }), { type: 'RESET_SIMULATION' });
const rejectedAfterRoundTrip = twinReducer(changedThenRestored, { type: 'SET_SIMULATION_EVALUATION', value: delayed.response, request: delayed.input, generation: runStarted.evaluationGeneration });
assert.equal(rejectedAfterRoundTrip.latestEvaluation, null);

const service = readFileSync(new URL('../src/services/simulationHvac.ts', import.meta.url), 'utf8');
assert.ok(service.includes("'/api/simulation/hvac/evaluate'"));
assert.ok(!/api\/cps|api\/operational|journal\.|incident\./.test(service));
const iotPage = readFileSync(new URL('../src/pages/IoT.tsx', import.meta.url), 'utf8');
assert.ok(iotPage.includes("'Increase Heat'"));
assert.ok(iotPage.includes("'Add Visitors'"));
assert.ok(iotPage.includes("'Disconnect Node'"));
assert.ok(iotPage.includes("'Run Simulation'"));
assert.ok(iotPage.includes("'Turn Virtual Fan ON'"));
assert.ok(iotPage.includes("'Technical Details (Optional)'"));
assert.ok(!iotPage.includes("'1. Choose Scenario'"));
assert.ok(!iotPage.includes("'Restore Normal Conditions'"));
console.log('simulation HVAC tests passed');
