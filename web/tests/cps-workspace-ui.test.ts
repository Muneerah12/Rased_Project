import { CPS_WORKSPACE_TABS } from '../src/cps-workspace/contracts';
import { SIMULATION_HVAC_POLICY } from '../src/cps-workspace';
import { fanAnimationEnabled, visitorDisplayCount } from '../src/cps-workspace/CpsSimulationHall';

let failures = 0;
const ok = (condition: boolean, label: string) => { console.log(`${condition ? 'PASS' : 'FAIL'} ${label}`); if (!condition) failures++; };

ok(CPS_WORKSPACE_TABS.map((tab) => tab.id).join(',') === 'overview,ot,iot,noc', 'preserves canonical CPS tab order');
ok(CPS_WORKSPACE_TABS.every((tab) => !!tab.label.ar && !!tab.label.en), 'provides Arabic and English tab labels');
ok(SIMULATION_HVAC_POLICY.fanOnTemperatureC === 26 && SIMULATION_HVAC_POLICY.fanOffTemperatureC === 24, 'uses the canonical browser-local HVAC policy thresholds');
ok(visitorDisplayCount(40) === 16 && visitorDisplayCount(-1) === 0, 'caps visual-only simulated visitors without changing Twin state');
ok(fanAnimationEnabled('ON') && !fanAnimationEnabled('OFF'), 'animates only an applied virtual ON fan state');

if (failures) process.exit(1);
