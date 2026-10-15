import { mapTargetForCpsLocation, rasidZoneForCpsLocation } from '../src/services/cpsLocationMap';

let failures = 0;
const ok = (condition: boolean, message: string) => {
  console.log(`${condition ? 'PASS' : 'FAIL'} ${message}`);
  if (!condition) failures += 1;
};

// User-confirmed mapping: CPS A1-1 is the RASID A1.1 zone.
ok(rasidZoneForCpsLocation('A1-1') === 'A1.1', 'confirmed CPS location maps to RASID zone');
ok(JSON.stringify(mapTargetForCpsLocation('A1-1')) === JSON.stringify({ kind: 'zone', id: 'A1.1' }), 'confirmed location produces existing zone navigation target');

// Unknown or absent locations must not be guessed or navigated.
ok(mapTargetForCpsLocation('A1.1') === null, 'similar but unconfirmed location does not map');
ok(mapTargetForCpsLocation('B2-7') === null, 'unknown location has no navigation target');
ok(mapTargetForCpsLocation(null) === null, 'missing location has no navigation target');

if (failures) process.exit(1);
console.log('cps location map tests passed');
