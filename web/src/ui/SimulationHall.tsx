import type { TwinActuatorState, TwinConnectionStatus } from '../model/twin';

const VISITOR_POSITIONS = [
  [310, 190], [354, 211], [398, 190], [442, 211], [486, 190], [530, 211], [574, 190], [618, 211],
  [370, 250], [418, 273], [466, 250], [514, 273], [562, 250], [610, 273], [658, 250], [706, 273],
] as const;

export function visitorDisplayCount(peopleCount: number): number {
  return Math.max(0, Math.min(VISITOR_POSITIONS.length, Math.floor(peopleCount)));
}

export function fanAnimationEnabled(fanState: TwinActuatorState): boolean {
  return fanState === 'ON';
}

function IsometricBooth({ x, y }: { x: number; y: number }) {
  return <g className="sim-iso-booth" transform={`translate(${x} ${y})`}>
    <polygon className="sim-booth-side" points="0,20 78,58 78,85 0,47" />
    <polygon className="sim-booth-side sim-booth-side-right" points="78,58 142,26 142,53 78,85" />
    <polygon className="sim-booth-top" points="0,20 64,-12 142,26 78,58" />
  </g>;
}

export function SimulationHall({ temperatureC, peopleCount, connectionStatus, fanState }: {
  temperatureC: number;
  peopleCount: number;
  connectionStatus: TwinConnectionStatus;
  fanState: TwinActuatorState;
}) {
  const visitors = visitorDisplayCount(peopleCount);
  const fanOn = fanAnimationEnabled(fanState);
  const nodeTone = connectionStatus === 'ONLINE' ? 'ok' : connectionStatus === 'STALE' ? 'warn' : 'off';
  return <div className="sim-hall-wrap">
    <svg className={`sim-hall fan-${fanState.toLowerCase()} node-${connectionStatus.toLowerCase()}`} viewBox="0 0 900 400" role="img" aria-labelledby="sim-hall-title sim-hall-desc">
      <title id="sim-hall-title">Simulated isometric Hall A1</title>
      <desc id="sim-hall-desc">A synthetic isometric exhibition hall with {peopleCount} visitors, a wall-mounted temperature sensor reading {temperatureC.toFixed(1)} degrees Celsius, a virtual HVAC fan, and a virtual node.</desc>
      <defs>
        <linearGradient id="sim-floor-gradient" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#ecf4ef" /><stop offset="1" stopColor="#cfe0d8" /></linearGradient>
        <linearGradient id="sim-wall-gradient" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#f7faf8" /><stop offset="1" stopColor="#d9e3de" /></linearGradient>
        <filter id="sim-hall-shadow" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="9" stdDeviation="7" floodOpacity=".18" /></filter>
      </defs>
      <g filter="url(#sim-hall-shadow)">
        <polygon className="sim-iso-floor" points="116,122 510,30 830,184 431,365" />
        <polygon className="sim-cutaway-wall sim-wall-left" points="116,122 510,30 510,85 116,177" />
        <polygon className="sim-cutaway-wall sim-wall-right" points="510,30 830,184 830,239 510,85" />
        <polygon className="sim-iso-walkway" points="188,168 508,94 761,215 439,292" />
        <path className="sim-iso-path-lines" d="M302 142 626 296M488 99 490 351M213 241 536 166" />
        <IsometricBooth x={172} y={145} />
        <IsometricBooth x={306} y={113} />
        <IsometricBooth x={560} y={170} />
        <IsometricBooth x={440} y={232} />
      </g>
      <g className="sim-wall-sensor" transform="translate(466 83)">
        <rect x="-16" y="-14" width="32" height="25" rx="5" /><circle cx="-7" cy="-2" r="3" />
        <path d="M5 -7v10a5 5 0 1 1-5 5" />
      </g>
      <g className={`sim-fan ${fanOn ? 'on' : 'off'}`} transform="translate(737 225)">
        <ellipse className="sim-fan-shadow" cx="0" cy="23" rx="30" ry="10" />
        <rect className="sim-fan-mount" x="-4" y="-2" width="8" height="22" rx="3" />
        <circle className="sim-fan-ring" r="31" />
        <g className="sim-fan-rotor"><path d="M0 0C-4-28 12-34 17-12L5 2z" /><path d="M0 0C26-12 35 4 14 14L-3 5z" /><path d="M0 0C13 25-4 35-14 14L-5-3z" /><path d="M0 0C-27 13-35-4-14-14L3-5z" /></g>
        <circle className="sim-fan-core" r="5" />
        <text className="sim-hall-device-label" x="0" y="53" textAnchor="middle">FAN {fanState}</text>
      </g>
      <g className={`sim-node ${nodeTone}`} transform="translate(164 191)">
        <rect x="-43" y="-22" width="86" height="44" rx="10" /><circle cx="-27" cy="0" r="5" />
        <text className="sim-node-label" x="8" y="5" textAnchor="middle">{connectionStatus}</text>
      </g>
      <g className={`sim-visitors ${visitors > 15 ? 'surge' : ''}`} aria-label={`${peopleCount} simulated visitors`}>
        {VISITOR_POSITIONS.slice(0, visitors).map(([x, y], index) => <g key={`${x}-${y}`} className="sim-visitor" style={{ animationDelay: `${(index % 6) * 0.12}s` }} transform={`translate(${x} ${y})`}>
          <ellipse className="sim-visitor-shadow" cy="8" rx="6" ry="2" /><circle cy="-6" r="4" /><path d="M-5 8c1-7 9-7 10 0" />
        </g>)}
      </g>
    </svg>
  </div>;
}
