import assert from 'node:assert/strict';
import { parseOperationalHvacRecommendation } from '../src/services/operationalHvac.ts';

const timestamp = '2026-10-10T12:00:00+00:00';
const trend = {
  direction: 'UNKNOWN', delta: null, previous_observed_at: null,
  current_observed_at: timestamp, reason_code: 'OBSERVATION_HISTORY_MISSING',
};
const response = {
  schema_version: 'operational-hvac-recommendation-api-v1', context: 'real_operations', monitor_only: true,
  evaluation: {
    status: 'POLICY_NOT_CONFIGURED', reason_code: 'REAL_POLICY_NOT_APPROVED',
    explanation: 'Operational thresholds are not configured and approved.', policy_version: 'real-hvac-draft-v1',
    evaluated_at: timestamp, zone_id: 'A1.1', sources: ['cps_node_state', 'live_ai'], evidence_issues: [],
    temperature_trend: trend, crowd_trend: trend, thresholds: null,
  },
  evidence: {
    cps: {
      source: 'cps_node_state', node_id: 'NODE-04', location_id: 'A1-1', zone_id: 'A1.1', status: 'ACTIVE',
      connection_status: 'ONLINE', as_of: timestamp, snapshot_freshness: 'FRESH', last_heartbeat_received_at: timestamp,
      issues: [], temperature: { sensor_id: 'TEMP-01', value_c: 25.5, observed_at: timestamp, validation_status: 'NORMAL', freshness: 'FRESH', issues: [] },
    },
    ai_people: {
      source: 'live_ai', camera_id: 'CAM-1', zone_id: 'A1.1', observed_at: timestamp, freshness: 'FRESH',
      people_count: 4, people_smoothed: null, derived_detection_confidence: null,
      confidence_note: 'Derived detection confidence is not count accuracy.', issues: [],
    },
  },
};

assert.equal(parseOperationalHvacRecommendation(response)?.evidence.ai_people.people_count, 4);
assert.equal(parseOperationalHvacRecommendation({ ...response, monitor_only: false }), null);
assert.equal(parseOperationalHvacRecommendation({ ...response, command: 'ON' }), null);
assert.equal(parseOperationalHvacRecommendation({ ...response, evidence: { ...response.evidence, ai_people: { ...response.evidence.ai_people, people_count: 0 } } })?.evidence.ai_people.people_count, 0);
assert.equal(parseOperationalHvacRecommendation({ ...response, evidence: { ...response.evidence, ai_people: { ...response.evidence.ai_people, people_count: null, people_smoothed: null } } })?.evidence.ai_people.people_count, null);

const thresholds = { reactive_temperature_c: 26, normal_temperature_max_c: 25, minimum_temperature_rise_c: 0.5, minimum_crowd_increase: 3 };
assert.equal(parseOperationalHvacRecommendation({ ...response, evaluation: { ...response.evaluation, thresholds } })?.evaluation.thresholds?.reactive_temperature_c, 26);
assert.equal(parseOperationalHvacRecommendation({ ...response, evaluation: { ...response.evaluation, thresholds: { ...thresholds, extra: 1 } } }), null);
assert.equal(parseOperationalHvacRecommendation({ ...response, evaluation: { ...response.evaluation, thresholds: { ...thresholds, reactive_temperature_c: 'hot' } } }), null);

console.log('operational HVAC client tests passed');
