import { SECTIONS } from '../src/model/types';
import { canSee } from '../src/services/permissions';
import { LABELS } from '../src/ui/labels';

let failures = 0;
const ok = (condition: boolean, label: string) => { console.log(`${condition ? 'PASS' : 'FAIL'} ${label}`); if (!condition) failures++; };

ok(SECTIONS.filter((section) => section === 'iot').length === 1, 'keeps exactly one IoT / Systems sidebar destination');
ok(!(SECTIONS as readonly string[]).includes('cps_operations'), 'removes the separate CPS Operations destination');
ok(canSee('operator', 'iot') && canSee('analyst', 'iot'), 'preserves existing device-capable IoT access');
ok(!canSee('privacy', 'iot') && !canSee('access_admin', 'iot') && !canSee('responder', 'iot'), 'preserves restricted IoT access');
ok(LABELS.section.iot.en === 'IoT / CPS', 'preserves the existing IoT / Systems navigation label');

if (failures) process.exit(1);
