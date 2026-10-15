/**
 * Explicitly approved CPS-to-RASID zone mappings.
 *
 * These mappings select a RASID zone only. They do not create a device marker
 * or imply a precise physical coordinate for CPS hardware.
 */
const CPS_LOCATION_TO_RASID_ZONE: Readonly<Record<string, string>> = {
  'A1-1': 'A1.1',
};

export type CpsMapTarget = { kind: 'zone'; id: string };

export function rasidZoneForCpsLocation(locationId: string | null | undefined): string | null {
  if (!locationId) return null;
  return CPS_LOCATION_TO_RASID_ZONE[locationId] ?? null;
}

/** Returns a map selection only for an explicitly configured CPS location. */
export function mapTargetForCpsLocation(locationId: string | null | undefined): CpsMapTarget | null {
  const zoneId = rasidZoneForCpsLocation(locationId);
  return zoneId ? { kind: 'zone', id: zoneId } : null;
}
