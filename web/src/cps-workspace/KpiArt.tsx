/**
 * Small decorative illustrations behind the CPS overview KPIs. Pure SVG; the only
 * motion is CSS transform/opacity, and every animation reflects real state:
 * a grounded drone (fleet out of service), signal arcs only while NODE-04 is
 * ONLINE, and a camera sweep only while a camera is actively analysing.
 */

/** Drone parked on its landing pad, propellers still. */
export function DroneArt() {
  return <svg className="ka ka-drone" viewBox="0 0 140 80" aria-hidden="true">
    <ellipse className="ka-pad" cx="70" cy="66" rx="46" ry="10" />
    <text className="ka-pad-h" x="70" y="70" textAnchor="middle">H</text>
    <g className="ka-drone-body">
      <ellipse className="ka-shadow" cx="70" cy="62" rx="26" ry="4" />
      <path className="ka-arm" d="M42 40 L98 40 M52 32 L88 48 M52 48 L88 32" />
      {[[42, 40], [98, 40], [52, 31], [88, 31]].map(([x, y]) => <g key={`${x}-${y}`}><line className="ka-mast" x1={x} y1={y} x2={x} y2={y - 6} /><ellipse className="ka-prop" cx={x} cy={y - 7} rx="10" ry="2.2" /></g>)}
      <rect className="ka-core" x="58" y="34" width="24" height="12" rx="4" />
      <circle className="ka-cam" cx="70" cy="50" r="3.2" />
      <path className="ka-leg" d="M60 46 L56 58 M80 46 L84 58 M52 58 H62 M78 58 H88" />
      <circle className="ka-led off" cx="62" cy="40" r="1.8" />
    </g>
  </svg>;
}

/** NODE-04 sensor box; signal arcs ripple only while it is online. */
export function NodeArt({ online }: { online: boolean }) {
  return <svg className={`ka ka-node ${online ? 'online' : 'offline'}`} viewBox="0 0 140 80" aria-hidden="true">
    {[0, 1, 2].map((i) => <path key={i} className="ka-arc" style={{ animationDelay: `${i * 0.5}s` }} d={`M${70 - 10 - i * 8} ${38 - i * 3} a${10 + i * 8} ${10 + i * 8} 0 0 1 ${20 + i * 16} 0`} />)}
    <rect className="ka-box" x="52" y="40" width="36" height="24" rx="5" />
    <circle className="ka-dot" cx="61" cy="52" r="2.6" />
    <path className="ka-vent" d="M68 48h12M68 52h12M68 56h12" />
    <path className="ka-wire" d="M88 58 C104 58 106 70 122 70" />
  </svg>;
}

/** Wall camera; its view sweeps only while at least one camera is analysing. */
export function CameraArt({ active }: { active: boolean }) {
  return <svg className={`ka ka-camera ${active ? 'active' : 'idle'}`} viewBox="0 0 140 80" aria-hidden="true">
    <path className="ka-mount" d="M110 10 V22 H96" />
    <g className="ka-cam-head">
      <polygon className="ka-beam" points="72,30 18,64 52,74" />
      <rect className="ka-cam-box" x="70" y="18" width="30" height="16" rx="4" transform="rotate(18 85 26)" />
      <circle className="ka-lens" cx="72" cy="30" r="4" />
    </g>
    <circle className="ka-rec" cx="94" cy="24" r="2" />
  </svg>;
}
