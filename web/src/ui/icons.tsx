import type { ReactNode } from 'react';

// Stroke icons drawn for Rasid (24px grid, currentColor).
const P: Record<string, ReactNode> = {
  dashboard: <><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></>,
  cameras: <><path d="M3 7h11a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H3z" /><path d="m16 11 5-3v8l-5-3" /><circle cx="8.5" cy="12" r="2" /></>,
  incidents: <><path d="M12 3 2.5 20h19z" /><path d="M12 10v4.5" /><circle cx="12" cy="17.2" r=".6" fill="currentColor" /></>,
  employees: <><circle cx="9" cy="8" r="3.2" /><path d="M3 20c.6-3.4 3-5.4 6-5.4s5.4 2 6 5.4" /><circle cx="17.5" cy="9" r="2.4" /><path d="M16.5 14.4c2.3.2 4 1.8 4.5 4.6" /></>,
  iot: <><circle cx="12" cy="12" r="2.2" /><path d="M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7M5.6 5.6a9 9 0 0 0 0 12.8M18.4 5.6a9 9 0 0 1 0 12.8" /></>,
  reports: <><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4M9 12h6M9 16h6" /></>,
  bell: <><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" /><path d="M10 20.5a2 2 0 0 0 4 0" /></>,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></>,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  back: <path d="M15 5 8 12l7 7" />,
  collapse: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></>,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  fit: <><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></>,
  layers: <><path d="m12 3 9 5-9 5-9-5z" /><path d="m3 13 9 5 9-5" /></>,
  pin: <><path d="M12 21s7-6.2 7-11.5a7 7 0 0 0-14 0C5 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.4" /></>,
  camera: <><rect x="3" y="7" width="13" height="10" rx="2" /><path d="m16 11 5-3v8l-5-3" /></>,
  node: <path d="M12 3 20 7.5v9L12 21l-8-4.5v-9z" />,
  sensor: <><circle cx="12" cy="12" r="3" /><circle cx="12" cy="12" r="8" /></>,
  drone: <><circle cx="5.5" cy="5.5" r="2.5" /><circle cx="18.5" cy="5.5" r="2.5" /><circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" /><rect x="9" y="9" width="6" height="6" rx="1.5" /><path d="M7.5 7.5 9 9M16.5 7.5 15 9M7.5 16.5 9 15M16.5 16.5 15 15" /></>,
  lock: <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
  upload: <><path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 16v4h16v-4" /></>,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  info: <><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5.5" /><path d="M12 7.6v.1" /></>,
  link: <><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></>,
  offline: <><path d="M3 3l18 18" /><path d="M8.5 16.5a5 5 0 0 1 7 0M5 12.5a10 10 0 0 1 4-2.4M19 12.5a10 10 0 0 0-3.2-2.1M12 20h.01" /></>,
  heart: <path d="M3 12h4l2-5 4 10 2-5h6" />,
  refresh: <><path d="M20 12a8 8 0 1 1-2.34-5.66" /><path d="M20 4v5h-5" /></>,
  user: <><circle cx="12" cy="8" r="3.5" /><path d="M5 20c.8-3.6 3.6-5.6 7-5.6s6.2 2 7 5.6" /></>,
  play: <path d="M8 5v14l11-7z" />,
  pause: <path d="M8 5v14M16 5v14" />,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  flame: <path d="M12 21c-3.9 0-6.5-2.6-6.5-6 0-3.8 3.4-5.6 4.2-10 2.6 1.6 4 3.8 4.2 6.2 1-.7 1.6-1.9 1.8-3.2 1.8 1.6 2.8 4 2.8 7 0 3.4-2.6 6-6.5 6z" />,
  crowd: <><circle cx="7" cy="8" r="2" /><circle cx="12" cy="6.5" r="2" /><circle cx="17" cy="8" r="2" /><path d="M3.5 17c.4-2.6 1.8-4.2 3.5-4.2M20.5 17c-.4-2.6-1.8-4.2-3.5-4.2M8 19c.5-3.4 2-5.4 4-5.4s3.5 2 4 5.4" /></>,
  signal: <><path d="M4 20v-3M9 20v-7M14 20V9M19 20V4" /></>,
  globe: <><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.5 2.6 3.6 5.5 3.6 8.5S14.5 17.9 12 20.5C9.5 17.9 8.4 15 8.4 12S9.5 6.1 12 3.5z" /></>,
  // devices
  router: <><path d="M4 14h16v5H4z" /><path d="M8 14V8M16 14V8" /><path d="M5.5 5.5a4 4 0 0 1 5 0M13.5 5.5a4 4 0 0 1 5 0" /><path d="M7 16.5h.01M10 16.5h.01" /></>,
  thermo: <><path d="M10 4a2 2 0 0 1 4 0v9.3a4 4 0 1 1-4 0z" /><path d="M12 9v7" /><path d="M18 5.5c1.2 1.5 1.8 2.5 1.8 3.3a1.8 1.8 0 0 1-3.6 0c0-.8.6-1.8 1.8-3.3z" /></>,
  hvac: <><rect x="3" y="4" width="18" height="8" rx="1.5" /><path d="M6 9h12" /><path d="M7 15c0 1.5-1 2-1 3.5M12 15c0 1.5-1 2-1 3.5M17 15c0 1.5-1 2-1 3.5" /></>,
  idbadge: <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M10 3v3h4V3" /><circle cx="12" cy="11" r="2.3" /><path d="M8.5 17c.5-1.8 1.8-2.8 3.5-2.8s3 1 3.5 2.8" /></>,
  user_ok: <><circle cx="9" cy="7.5" r="3.3" /><path d="M2.8 20c.6-3.5 3.1-5.6 6.2-5.6 1.4 0 2.6.4 3.6 1.1" /><path d="m14.8 17.6 2.3 2.3 4.4-4.9" /></>,
  user_go: <><circle cx="9" cy="7.5" r="3.3" /><path d="M2.8 20c.6-3.5 3.1-5.6 6.2-5.6 1.4 0 2.6.4 3.6 1.1" /><path d="M14.5 17.5h6.5M18.3 14.8l2.7 2.7-2.7 2.7" /></>,
  user_task: <><circle cx="9" cy="7.5" r="3.3" /><path d="M2.8 20c.6-3.5 3.1-5.6 6.2-5.6 1 0 1.9.2 2.7.6" /><circle cx="17.8" cy="17" r="3.9" /><path d="M17.8 15.2V17l1.3 1" /></>,
  person: <><circle cx="12" cy="5" r="2.6" /><path d="M12 8.5v6.5M8 11l4-1.5 4 1.5M12 15l-3 6M12 15l3 6" /></>,
  print: <><path d="M7 9V3h10v6" /><rect x="4" y="9" width="16" height="8" rx="1.5" /><path d="M7 14h10v7H7z" /></>,
  // incident categories (shared by map markers, lists and records)
  fall: <><circle cx="16.5" cy="5" r="2.2" /><path d="M14.5 8.5 9 11l-3.5-2M14.5 8.5l-1.5 5.5 4 3M13 14l-5 2.5-1 3.5" /><path d="M3 21h18" /></>,
  barrier: <><path d="M3 9h18v5H3z" /><path d="M7 9l-3 5M13 9l-3 5M19 9l-3 5" /><path d="M6 14v6M18 14v6" /></>,
  noentry: <><circle cx="12" cy="12" r="8.5" /><path d="M7.5 12h9" /><path d="M15 9.5 17.5 12 15 14.5" /></>,
  cigarette: <><path d="M2.5 15h14v3h-14z" /><path d="M19 15v3M21.5 15v3" /><path d="M19 12c0-2 2.5-2 2.5-4.5M16.5 12c0-2 2.5-2 2.5-4.5" /></>,
  trash: <><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /><path d="M10 11v6M14 11v6" /></>,
  // threat-detection add-on
  gun: <><path d="M3 8h17v4h-7l-1.5 2.5H9L7.5 19H4l1.5-7H3z" /><path d="M11.5 12v2.5" /></>,
  soundwave: <path d="M3 12h2M7 9v6M11 5v14M15 8v8M19 10.5v3M21 12h.01" />,
  running: <><circle cx="15.5" cy="4.5" r="2" /><path d="M8 10.5 12.5 8l3 3.5 3.5 1.5M12.5 8l-1.5 5.5 3.5 3-1 4.5M11 13.5 8 17l-4 .5" /></>,
  mic: <><path d="M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3z" /><path d="M6.5 11.5a5.5 5.5 0 0 0 11 0M12 17v4M9 21h6" /></>,
  temperature: <><path d="M14 14.8V5a2 2 0 0 0-4 0v9.8a4 4 0 1 0 4 0z" /><circle cx="12" cy="17.8" r="1.6" fill="currentColor" stroke="none" /><path d="M12 16.2V9M17 6h2.5M17 9.5h2.5M17 13h2.5" /></>,
  droplet: <><path d="M12 3.2s6.5 6.8 6.5 11.3a6.5 6.5 0 0 1-13 0C5.5 10 12 3.2 12 3.2z" /><path d="M9 15.2a3 3 0 0 0 2.6 2.8" /></>,
  gauge: <><path d="M4.2 17.5a9 9 0 1 1 15.6 0" /><path d="m12 13.5 3.8-4.3" /><circle cx="12" cy="13.5" r="1.6" fill="currentColor" stroke="none" /><path d="M6.6 9.6l1.2.9M12 5.5v1.4M17.4 9.6l-1.2.9M8.5 19h7" /></>,
};

export const CATEGORY_ICON: Record<string, keyof typeof P> = {
  crowding: 'crowd', fall: 'fall', fire_smoke: 'flame', obstruction: 'barrier', wrong_way: 'noentry', smoking: 'cigarette', littering: 'trash',
  not_in_zone: 'pin', badge_problem: 'idbadge', access_problem: 'lock', badge_unseen: 'idbadge',
  no_task_response: 'clock', employee_emergency: 'incidents',
  weapon: 'gun', gunshot: 'soundwave', abnormal_behavior: 'running', node_offline: 'router',
};

export type IconName = keyof typeof P;
export function Icon({ name, size = 18, className, x, y, stroke = 'currentColor', strokeWidth = 1.7 }: {
  name: IconName; size?: number; className?: string; x?: number; y?: number; stroke?: string; strokeWidth?: number;
}) {
  return (
    <svg className={`ic ${className ?? ''}`} width={size} height={size} x={x} y={y} viewBox="0 0 24 24" fill="none" stroke={stroke}
      strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {P[name]}
    </svg>
  );
}

/** One shared incident icon: the same glyph per category everywhere it appears. */
export function IncidentIcon({ category, size = 18, className }: { category: string; size?: number; className?: string }) {
  return <Icon name={CATEGORY_ICON[category] ?? 'incidents'} size={size} className={`inc-ic ${className ?? ''}`} />;
}

/** Map glyph: an icon with a light halo so it stays readable on the rendered map without a container. */
export function MapGlyph({ name, size = 22, color }: { name: IconName; size?: number; color: string }) {
  const o = -size / 2;
  return (
    <>
      <Icon name={name} size={size} x={o} y={o} stroke="var(--map-halo)" strokeWidth={5} />
      <Icon name={name} size={size} x={o} y={o} stroke={color} strokeWidth={2.1} />
    </>
  );
}
