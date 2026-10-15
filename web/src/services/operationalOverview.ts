/** Read-only provenance selectors for the real-operations overview surfaces. */

import type { CpsNodeState } from './cps';

/** Display-only safety limit; this is not an AI, occupancy, or control policy. */
export const OPERATIONAL_AI_FRESHNESS_MS = 30_000;

export type OperationalPeopleObservation = {
  value: number | null;
  observedAt: number | null;
  freshness: 'FRESH' | 'STALE' | 'MISSING' | 'INVALID';
};

type PeopleFrame = { t: number; people: number | null; peopleSmoothed: number | null } | undefined;

/** A frame counts as operational evidence only while the live server connection is active. */
export function operationalPeopleObservation(
  connected: boolean,
  frame: PeopleFrame,
  now: number,
  freshnessMs = OPERATIONAL_AI_FRESHNESS_MS,
): OperationalPeopleObservation {
  if (!connected || !frame) return { value: null, observedAt: null, freshness: 'MISSING' };
  const value = frame.peopleSmoothed ?? frame.people;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || !Number.isFinite(frame.t)) return { value: null, observedAt: null, freshness: 'INVALID' };
  const age = now - frame.t;
  if (age < 0) return { value: null, observedAt: frame.t, freshness: 'INVALID' };
  return { value: age <= freshnessMs ? value : null, observedAt: frame.t, freshness: age <= freshnessMs ? 'FRESH' : 'STALE' };
}

/** The strict CPS client has already verified NODE-04; unavailable remains null, never zero. */
export function verifiedCpsPhysicalNodeCount(state: CpsNodeState | null): number | null {
  return state?.node_id === 'NODE-04' ? 1 : null;
}

type OperationalEvent = { id: string; simulated: boolean; aiId?: string };
type OperationalIncident = { fixture: boolean; source: string; eventId?: string; status: string };
type OperationalAlert = { incidentId?: string; eventId?: string };

/** Accept only a server-originated AI event; fixture/manual/scenario records fail closed. */
export function isVerifiedOperationalEvent(event: OperationalEvent | undefined): boolean {
  return !!event && event.simulated === false && typeof event.aiId === 'string' && event.aiId.length > 0;
}

export function isVerifiedOperationalIncident(incident: OperationalIncident, events: OperationalEvent[]): boolean {
  return !incident.fixture && incident.source === 'ai_camera'
    && typeof incident.eventId === 'string'
    && isVerifiedOperationalEvent(events.find((event) => event.id === incident.eventId));
}

export function isVerifiedOperationalAlert(alert: OperationalAlert, incidents: (OperationalIncident & { id: string })[], events: OperationalEvent[]): boolean {
  if (!alert.incidentId || !alert.eventId || !isVerifiedOperationalEvent(events.find((event) => event.id === alert.eventId))) return false;
  const incident = incidents.find((item) => item.id === alert.incidentId);
  return !!incident && isVerifiedOperationalIncident(incident, events);
}
