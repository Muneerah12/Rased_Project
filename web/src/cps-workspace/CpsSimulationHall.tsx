import type { SimThreatKind, TwinActuatorState, TwinConnectionStatus, TwinSimThreat } from './contracts';

/* Isometric Expo zone A1.1. Room is 10 × 8 floor units, walls 2.6 units high. */
const S = 44, OX = 400, OY = 156;
const C30 = 0.866;
type Pt = readonly [number, number];
/** Project room coordinates (x along the right wall, y along the left wall, z up) to the screen. */
const iso = (x: number, y: number, z = 0): Pt => [OX + (x - y) * C30 * S, OY + (x + y) * 0.5 * S - z * S];
const pts = (...points: Pt[]) => points.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(' ');
/** SVG matrix mapping local (u, v) units onto a room plane, so flat drawings (fans, signs) sit on walls and floors. */
const floorPlane = (x: number, y: number, z: number) => { const [e, f] = iso(x, y, z); return `matrix(${C30 * S} ${0.5 * S} ${-C30 * S} ${0.5 * S} ${e} ${f})`; };
const leftWallPlane = (y: number, z: number) => { const [e, f] = iso(0, y, z); return `matrix(${-C30 * S} ${0.5 * S} 0 ${-S} ${e} ${f})`; };
const rightWallPlane = (x: number, z: number) => { const [e, f] = iso(x, 0, z); return `matrix(${C30 * S} ${0.5 * S} 0 ${-S} ${e} ${f})`; };

const WALL_H = 2.6;
/** Unscaled skew so text runs along an x-direction surface (right wall, pavilion fronts). */
const alongX = ([e, f]: Pt) => `matrix(${C30} 0.5 0 1 ${e} ${f})`;
/** Same for a y-direction surface seen from the front-right (the entrance gate). */
const alongY = ([e, f]: Pt) => `matrix(${C30} -0.5 0 1 ${e} ${f})`;

/** Visitor spots on the walkways, in room units; at most 16 are drawn. */
const VISITOR_SPOTS: readonly Pt[] = [[4.6, 1.5], [5.4, 2.4], [4.8, 3.3], [5.6, 4.6], [4.5, 5.5], [5.3, 6.4], [2.0, 4.3], [3.1, 3.8], [6.9, 4.2], [8.0, 3.6], [8.8, 4.4], [1.4, 3.7], [3.9, 4.9], [6.4, 5.4], [7.4, 2.1], [2.6, 6.6]];
export function visitorDisplayCount(peopleCount: number): number { return Math.max(0, Math.min(VISITOR_SPOTS.length, Math.floor(peopleCount))); }
export function fanAnimationEnabled(fanState: TwinActuatorState): boolean { return fanState === 'ON'; }

const VISITOR_COLORS = ['#2f73bd', '#d4622a', '#6a4fc4', '#1f9d5b', '#c7860a', '#d23a3f'];

type Pavilion = { id: string; x: number; y: number; w: number; d: number; h: number; color: string; label: string };
const PAVILIONS: Pavilion[] = [
  { id: 'p1', x: 1.0, y: 0.8, w: 2.6, d: 2.2, h: 1.3, color: '#1b9151', label: 'جناح 1' },
  { id: 'p2', x: 6.6, y: 0.8, w: 2.6, d: 2.0, h: 1.1, color: '#c7860a', label: 'جناح 2' },
  { id: 'p3', x: 0.9, y: 5.0, w: 2.4, d: 2.2, h: 1.0, color: '#6a4fc4', label: 'جناح 3' },
  { id: 'p4', x: 6.8, y: 5.2, w: 2.4, d: 2.0, h: 1.2, color: '#2f73bd', label: 'جناح 4' },
];

function PavilionBox({ p }: { p: Pavilion }) {
  const { x, y, w, d, h } = p;
  const band = Math.min(0.35, h * 0.3);
  return <g className="xz-pavilion">
    <polygon className="xz-shadow" points={pts(iso(x + 0.15, y + d + 0.15), iso(x + w + 0.15, y + d + 0.15), iso(x + w + 0.15, y + 0.15), iso(x + w, y), iso(x, y + d))} />
    <polygon className="xz-face-left" points={pts(iso(x, y + d, 0), iso(x + w, y + d, 0), iso(x + w, y + d, h), iso(x, y + d, h))} />
    <polygon className="xz-face-right" points={pts(iso(x + w, y, 0), iso(x + w, y + d, 0), iso(x + w, y + d, h), iso(x + w, y, h))} />
    <polygon style={{ fill: p.color }} points={pts(iso(x, y + d, h - band), iso(x + w, y + d, h - band), iso(x + w, y + d, h), iso(x, y + d, h))} />
    <polygon style={{ fill: p.color, filter: 'brightness(0.82)' }} points={pts(iso(x + w, y, h - band), iso(x + w, y + d, h - band), iso(x + w, y + d, h), iso(x + w, y, h))} />
    <polygon className="xz-top" points={pts(iso(x, y, h), iso(x + w, y, h), iso(x + w, y + d, h), iso(x, y + d, h))} />
    <polygon className="xz-canopy" style={{ fill: p.color }} points={pts(iso(x + 0.3, y + 0.3, h + 0.45), iso(x + w - 0.3, y + 0.3, h + 0.2), iso(x + w - 0.3, y + d - 0.3, h + 0.45), iso(x + 0.3, y + d - 0.3, h + 0.2))} />
    <text className="xz-pavilion-label" transform={alongX(iso(x + w / 2, y + d, h - band / 2))} y="3.5" textAnchor="middle">{p.label}</text>
  </g>;
}

/** Ceiling HVLS circulation fan, drawn in the horizontal plane so its blades spin in perspective. */
function CirculationFan({ x, y, on, id }: { x: number; y: number; on: boolean; id: string }) {
  const [rx, ry] = iso(x, y, WALL_H + 0.25); const [hx, hy] = iso(x, y, WALL_H - 0.35);
  return <g className={`xz-circ ${on ? 'on' : 'off'}`} aria-label={`${id} ${on ? 'ON' : 'OFF'}`}>
    {on && <g transform={floorPlane(x, y, 0.02)}><g className="xz-swirl"><circle r="1.15" /><circle r="0.7" /></g></g>}
    <line className="xz-rod" x1={rx} y1={ry} x2={hx} y2={hy} />
    <g transform={floorPlane(x, y, WALL_H - 0.35)}>
      <g className="xz-circ-rotor">{[0, 72, 144, 216, 288].map((deg) => <path key={deg} transform={`rotate(${deg})`} d="M0.08 -0.06 L1.05 -0.16 Q1.12 0 1.05 0.16 L0.08 0.06 Z" />)}<circle r="0.16" className="xz-hub" /></g>
    </g>
    <text className="xz-device-label" x={hx} y={hy - 12} textAnchor="middle">{id}</text>
  </g>;
}

/** Louvred exhaust fan set into the left wall; when on, air is pushed out of the zone. */
function ExhaustFan({ y, on, id }: { y: number; on: boolean; id: string }) {
  const z = 1.75; const [lx, ly] = iso(0, y, z + 0.6);
  return <g className={`xz-exh ${on ? 'on' : 'off'}`} aria-label={`${id} ${on ? 'ON' : 'OFF'}`}>
    <g transform={leftWallPlane(y, z)}>
      <rect x="-0.5" y="-0.5" width="1" height="1" rx="0.08" className="xz-exh-frame" />
      <circle r="0.4" className="xz-exh-ring" />
      <g className="xz-exh-rotor">{[0, 90, 180, 270].map((deg) => <path key={deg} transform={`rotate(${deg})`} d="M0 0 C0.1 -0.3 0.32 -0.3 0.36 -0.06 Z" />)}</g>
      <circle r="0.06" className="xz-hub" />
    </g>
    {on && <g className="xz-airout">{[0, 1, 2].map((i) => { const [ax, ay] = iso(0, y + (i - 1) * 0.28, z); return <path key={i} style={{ animationDelay: `${i * 0.25}s` }} d={`M${ax} ${ay} l-34 -8 m6 -5 l-6 5 l7 3`} />; })}</g>}
    <text className="xz-device-label" x={lx} y={ly} textAnchor="middle">{id}</text>
  </g>;
}

/** Wall-top CCTV camera with a view cone onto the floor; the cone lights up while it sees visitors. */
function Cctv({ at, cone, id, watching, alarm = false }: { at: Pt; cone: Pt[]; id: string; watching: boolean; alarm?: boolean }) {
  return <g className={`xz-cctv ${watching ? 'watching' : ''}${alarm ? ' alarm' : ''}`}>
    <polygon className="xz-cone" points={pts(at, ...cone)} />
    <g transform={`translate(${at[0]} ${at[1]})`}>
      <rect x="-13" y="-7" width="26" height="12" rx="4" className="xz-cam-body" />
      <rect x="-3" y="-13" width="6" height="7" className="xz-cam-mount" />
      <circle cx="9" cy="-1" r="3.4" className="xz-cam-lens" />
      <circle cx="-7" cy="-1" r="2" className="xz-cam-rec" />
    </g>
    <text className="xz-device-label" x={at[0]} y={at[1] - 18} textAnchor="middle">{id}</text>
  </g>;
}

const THREAT_LABEL: Record<SimThreatKind, string> = { fire: 'FIRE', weapon: 'WEAPON', fight: 'FIGHT' };

/** The incident itself, standing on the floor at its spot. */
function ThreatMarker({ threat }: { threat: TwinSimThreat }) {
  const [px, py] = iso(threat.x, threat.y);
  if (threat.kind === 'fire') return <g className="xa-fire" transform={`translate(${px} ${py})`}>
    <ellipse cy="2" rx="22" ry="7" className="xa-scorch" />
    {[0, 1, 2, 3].map((i) => <circle key={i} className="xa-smoke" cx={(i - 1.5) * 6} cy={-30} r={9 + i * 2} style={{ animationDelay: `${i * 0.55}s` }} />)}
    <path className="xa-flame outer" d="M-16 0 C-20 -18 -8 -22 -6 -40 C2 -26 8 -30 6 -48 C18 -30 20 -14 16 0 Z" />
    <path className="xa-flame mid" d="M-10 0 C-12 -12 -3 -16 -2 -28 C4 -18 10 -20 9 -32 C16 -18 14 -8 10 0 Z" />
    <path className="xa-flame core" d="M-5 0 C-6 -8 0 -10 0 -18 C4 -10 7 -8 5 0 Z" />
  </g>;
  if (threat.kind === 'weapon') return <g transform={`translate(${px} ${py})`}>
    <ellipse cy="1" rx="7" ry="2.6" className="xz-visitor-shadow" />
    <g className="xa-weapon">
      <rect x="-4" y="-17" width="8" height="16" rx="3.6" className="xa-suspect" />
      <circle cy="-21.5" r="4.2" className="xz-visitor-head" />
      <path className="xa-gun" d="M3 -12 h11 v3 h-6 l-1 4 h-3 l1 -4 h-2 z" />
    </g>
  </g>;
  return <g className="xa-fight" transform={`translate(${px} ${py})`}>
    <ellipse cy="1" rx="12" ry="3.4" className="xz-visitor-shadow" />
    <g className="xa-fighter a"><rect x="-11" y="-16" width="7.4" height="15" rx="3.4" className="xa-suspect" /><circle cx="-7.3" cy="-20" r="4" className="xz-visitor-head" /><path className="xa-arm" d="M-4 -12 L4 -16" /></g>
    <g className="xa-fighter b"><rect x="3.6" y="-16" width="7.4" height="15" rx="3.4" className="xa-suspect b" /><circle cx="7.3" cy="-20" r="4" className="xz-visitor-head" /><path className="xa-arm" d="M4 -10 L-4 -14" /></g>
  </g>;
}

/** AI overlay: line of sight from the camera, a detection box and its label. */
function DetectionOverlay({ threat, cameraAt }: { threat: TwinSimThreat; cameraAt: Pt }) {
  const [px, py] = iso(threat.x, threat.y);
  const h = threat.kind === 'fire' ? 64 : 44, w = threat.kind === 'fight' ? 50 : threat.kind === 'fire' ? 52 : 38;
  const label = `${THREAT_LABEL[threat.kind]} ${Math.round(threat.confidence * 100)}%`;
  return <g className="xa-overlay">
    <line className="xa-sight" x1={cameraAt[0]} y1={cameraAt[1]} x2={px} y2={py - h / 2} />
    <rect className="xa-box" x={px - w / 2} y={py - h - 4} width={w} height={h + 10} rx="3" />
    <g transform={`translate(${px - w / 2} ${py - h - 22})`}><rect className="xa-tag" width={label.length * 7.2 + 12} height="17" rx="3" /><text className="xa-tag-text" x="6" y="12.5">{label}</text></g>
  </g>;
}

/** Floor tint from cool blue (≤ 22 °C) through neutral to warm orange (≥ 30 °C). */
function heatTint(temperatureC: number): { color: string; opacity: number } {
  if (temperatureC <= 24) return { color: '#2f73bd', opacity: Math.min(0.22, (24 - temperatureC) * 0.08) };
  return { color: '#d4622a', opacity: Math.min(0.34, (temperatureC - 24) * 0.06) };
}

/** Visual-only, browser-local Expo zone. It has no real CPS inputs. */
export function CpsSimulationHall({ temperatureC, peopleCount, connectionStatus, fanState, exhaustState = 'OFF', threat = null }: { temperatureC: number; peopleCount: number; connectionStatus: TwinConnectionStatus; fanState: TwinActuatorState; exhaustState?: TwinActuatorState; threat?: TwinSimThreat | null }) {
  const visitors = visitorDisplayCount(peopleCount); const circOn = fanAnimationEnabled(fanState); const exhOn = fanAnimationEnabled(exhaustState);
  const nodeTone = connectionStatus === 'ONLINE' ? 'ok' : connectionStatus === 'STALE' ? 'warn' : 'off';
  const tint = heatTint(temperatureC); const watching = visitors > 0;
  const [nx, ny] = iso(8.2, 0, 1.5);
  const gateA = iso(10, 3.3), gateB = iso(10, 4.7);
  const people = VISITOR_SPOTS.slice(0, visitors).map((spot, index) => ({ spot, index })).sort((a, b) => (a.spot[0] + a.spot[1]) - (b.spot[0] + b.spot[1]));
  // Pavilions and visitors are painted back to front so nearer objects overlap farther ones.
  const depthItems = [...PAVILIONS.map((p) => ({ depth: p.x + p.w + p.y + p.d - 0.6, node: <PavilionBox key={p.id} p={p} /> })),
    ...people.map(({ spot: [x, y], index }) => { const [px, py] = iso(x, y); const c = VISITOR_COLORS[index % VISITOR_COLORS.length];
      return { depth: x + y, node: <g key={`v${index}`} transform={`translate(${px} ${py})`}><ellipse cy="1" rx="6" ry="2.4" className="xz-visitor-shadow" /><g className="xz-visitor" style={{ animationDelay: `${(index % 5) * 0.18}s` }}><rect x="-3.6" y="-15" width="7.2" height="14" rx="3.4" style={{ fill: c }} /><circle cy="-19" r="3.8" className="xz-visitor-head" /></g></g> }; }),
    ...(threat ? [{ depth: threat.x + threat.y, node: <ThreatMarker key="threat" threat={threat} /> }] : []),
  ].sort((a, b) => a.depth - b.depth);
  const camAt: Record<TwinSimThreat['cameraId'], Pt> = { 'CAM-C': iso(5.0, 0, WALL_H + 0.05), 'CAM-1': iso(0, 4.0, WALL_H + 0.05), 'CAM-2': iso(0, 0, WALL_H + 0.05) };

  return <div className="cpsw-hall-wrap"><svg className={`xz-hall node-${connectionStatus.toLowerCase()}`} viewBox="0 0 900 590" role="img" aria-labelledby="xz-title xz-desc">
    <title id="xz-title">Simulated Expo zone A1.1</title>
    <desc id="xz-desc">A synthetic Expo zone with {peopleCount} visitors, {temperatureC.toFixed(1)} degrees Celsius, two ceiling circulation fans ({fanState}), two wall exhaust fans ({exhaustState}), three CCTV cameras, and a virtual node ({connectionStatus}).</desc>
    <defs>
      <linearGradient id="xz-floor" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#f3f6f2" /><stop offset="1" stopColor="#dfe7e1" /></linearGradient>
      <linearGradient id="xz-wall" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#fbfcfb" /><stop offset="1" stopColor="#dde6e1" /></linearGradient>
      <pattern id="xz-tiles" width="22" height="22" patternUnits="userSpaceOnUse" patternTransform="skewX(-30) scale(1 0.58)"><path d="M0 0H22V22" fill="none" stroke="#cdd8d2" strokeWidth="0.8" /></pattern>
    </defs>

    {/* Walls (back-left and back-right) and floor */}
    <polygon className="xz-wall" points={pts(iso(0, 0, 0), iso(0, 8, 0), iso(0, 8, WALL_H), iso(0, 0, WALL_H))} />
    <polygon className="xz-wall xz-wall-right" points={pts(iso(0, 0, 0), iso(10, 0, 0), iso(10, 0, WALL_H), iso(0, 0, WALL_H))} />
    <polygon className="xz-wall-cap" points={pts(iso(0, 8, WALL_H), iso(0, 0, WALL_H), iso(10, 0, WALL_H), iso(10, -0.12, WALL_H + 0.06), iso(-0.12, -0.12, WALL_H + 0.06), iso(-0.12, 8, WALL_H + 0.06))} />
    <g transform={rightWallPlane(3.3, 1.55)}><rect x="0" y="0" width="3.4" height="0.5" rx="0.08" className="xz-sign" /></g>
    <text className="xz-sign-text" transform={alongX(iso(5.0, 0, 1.8))} y="4" textAnchor="middle">EXPO 2030 · A1.1</text>
    <polygon fill="url(#xz-floor)" className="xz-floor" points={pts(iso(0, 0), iso(10, 0), iso(10, 8), iso(0, 8))} />
    <polygon fill="url(#xz-tiles)" points={pts(iso(0, 0), iso(10, 0), iso(10, 8), iso(0, 8))} />
    <polygon className="xz-heat" style={{ fill: tint.color, opacity: tint.opacity }} points={pts(iso(0, 0), iso(10, 0), iso(10, 8), iso(0, 8))} />
    {/* Walkways: a central spine to the gate and a cross aisle */}
    <polygon className="xz-walk" points={pts(iso(4.2, 0.3), iso(5.9, 0.3), iso(5.9, 7.7), iso(4.2, 7.7))} />
    <polygon className="xz-walk" points={pts(iso(0.3, 3.4), iso(10, 3.4), iso(10, 4.7), iso(0.3, 4.7))} />
    <g transform={floorPlane(5.05, 4.05, 0.01)}><circle r="0.75" className="xz-plaza" /></g>

    {/* Exhaust fans in the left wall, node sensor on the right wall */}
    <ExhaustFan y={2.2} on={exhOn} id="EXH-01" />
    <ExhaustFan y={5.8} on={exhOn} id="EXH-02" />
    <g className={`xz-node ${nodeTone}`}>
      <g transform={rightWallPlane(8.0, 1.75)}><rect x="0" y="0" width="0.5" height="0.5" rx="0.08" className="xz-node-box" /></g>
      <circle cx={nx + 10} cy={ny - 4} r="3.2" className="xz-node-led" />
      <g transform={`translate(${nx + 58} ${ny - 34})`}><rect x="-44" y="-15" width="88" height="30" rx="9" className="xz-node-tag" /><circle cx="-29" cy="0" r="4.5" className="xz-node-dot" /><text className="xz-node-text" x="8" y="4.5" textAnchor="middle">{connectionStatus}</text></g>
      <text className="xz-device-label" x={nx + 58} y={ny - 54} textAnchor="middle">NODE · BME280</text>
    </g>

    {/* Info kiosk at the plaza */}
    <g className="xz-kiosk"><polygon className="xz-face-left" points={pts(iso(4.8, 4.3, 0), iso(5.3, 4.3, 0), iso(5.3, 4.3, 0.7), iso(4.8, 4.3, 0.7))} /><polygon className="xz-face-right" points={pts(iso(5.3, 3.8, 0), iso(5.3, 4.3, 0), iso(5.3, 4.3, 0.7), iso(5.3, 3.8, 0.7))} /><polygon className="xz-kiosk-top" points={pts(iso(4.8, 3.8, 0.7), iso(5.3, 3.8, 0.7), iso(5.3, 4.3, 0.7), iso(4.8, 4.3, 0.7))} /></g>

    {depthItems.map((item) => item.node)}

    {/* Entrance gate on the open front-right edge */}
    <g className="xz-gate">
      <line x1={gateA[0]} y1={gateA[1]} x2={gateA[0]} y2={gateA[1] - 1.6 * S} />
      <line x1={gateB[0]} y1={gateB[1]} x2={gateB[0]} y2={gateB[1] - 1.6 * S} />
      <polygon className="xz-gate-beam" points={pts(iso(10, 2.9, 1.5), iso(10, 5.1, 1.5), iso(10, 5.1, 2.05), iso(10, 2.9, 2.05))} />
      <text className="xz-gate-text" transform={alongY(iso(10, 4, 1.78))} y="4" textAnchor="middle">ENTRANCE · A1.1</text>
    </g>

    {/* Ceiling level: circulation fans and CCTV */}
    <CirculationFan x={3.0} y={3.0} on={circOn} id="CIRC-01" />
    <CirculationFan x={7.2} y={4.6} on={circOn} id="CIRC-02" />
    <Cctv id="CAM-C" at={iso(5.0, 0, WALL_H + 0.05)} cone={[iso(3.4, 3.2), iso(6.8, 3.2), iso(6.2, 5.6), iso(3.9, 5.6)]} watching={watching} alarm={threat?.cameraId === 'CAM-C'} />
    <Cctv id="CAM-1" at={iso(0, 4.0, WALL_H + 0.05)} cone={[iso(2.6, 2.6), iso(4.8, 3.4), iso(4.6, 5.2), iso(2.4, 5.6)]} watching={watching} alarm={threat?.cameraId === 'CAM-1'} />
    <Cctv id="CAM-2" at={iso(0, 0, WALL_H + 0.05)} cone={[iso(2.0, 1.2), iso(4.6, 1.6), iso(3.6, 3.6), iso(1.4, 3.0)]} watching={watching} alarm={threat?.cameraId === 'CAM-2'} />
    {threat && <DetectionOverlay threat={threat} cameraAt={camAt[threat.cameraId]} />}
  </svg></div>;
}
