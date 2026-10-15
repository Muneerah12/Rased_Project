import assert from 'node:assert/strict';
import {
  isVerifiedOperationalAlert, isVerifiedOperationalIncident, operationalPeopleObservation, verifiedCpsPhysicalNodeCount,
} from '../src/services/operationalOverview.ts';

const now = 1_000_000;
assert.deepEqual(operationalPeopleObservation(true, { t: now - 1_000, people: 3, peopleSmoothed: 4 }, now), { value: 4, observedAt: now - 1_000, freshness: 'FRESH' });
assert.deepEqual(operationalPeopleObservation(true, { t: now - 30_001, people: 3, peopleSmoothed: null }, now), { value: null, observedAt: now - 30_001, freshness: 'STALE' });
assert.equal(operationalPeopleObservation(false, { t: now, people: 0, peopleSmoothed: 0 }, now).freshness, 'MISSING');
assert.equal(operationalPeopleObservation(true, undefined, now).value, null);
assert.equal(verifiedCpsPhysicalNodeCount(null), null);
assert.equal(verifiedCpsPhysicalNodeCount({ node_id: 'NODE-04' } as never), 1);

const events = [{ id: 'EVT-real', simulated: false, aiId: 'server-event' }, { id: 'EVT-sim', simulated: true, aiId: 'fixture' }];
const real = { id: 'INC-real', fixture: false, source: 'ai_camera', eventId: 'EVT-real', status: 'open' };
const simulated = { id: 'INC-sim', fixture: true, source: 'ai_camera', eventId: 'EVT-sim', status: 'open' };
assert.equal(isVerifiedOperationalIncident(real, events), true);
assert.equal(isVerifiedOperationalIncident(simulated, events), false);
assert.equal(isVerifiedOperationalAlert({ incidentId: 'INC-real', eventId: 'EVT-real' }, [real, simulated], events), true);
assert.equal(isVerifiedOperationalAlert({ incidentId: 'INC-sim', eventId: 'EVT-sim' }, [real, simulated], events), false);
console.log('operational overview tests passed');
