import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore, useUI } from '../state/store';
import type { EntityRef } from '../state/store';
import {
  cameraState, empStatus, findNode, isOpenIncident, nodeState, sensorHealth, sensorLast, sensorState,
  zoneDeviceState, zoneOccupancy,
} from '../model/selectors';
import type { DeviceState, Pt } from '../model/types';
import { fmtAgo, fmtTime } from '../model/config';
import { DISTRICT_SHAPES } from '../model/fixtures';
import { CATEGORY_ICON, Icon, MapGlyph } from './icons';
import { LABELS } from './labels';
import { Ltr } from './primitives';
import { SITE_H, SITE_PHOTO, SITE_W } from './SiteRender';
import { clusterPoints } from './cluster';

export const IMG_W = SITE_W;
export const IMG_H = SITE_H;
export type Layer = 'cameras' | 'devices' | 'employees' | 'incidents' | 'crowd' | 'env';
const ALL_LAYERS: Layer[] = ['cameras', 'devices', 'employees', 'incidents', 'crowd', 'env'];
/** initial view: the five lit zones of the night render */
const SITE_VIEW = { cx: 1010, cy: 600, w: 1500, h: 640 };
/** the base render holds natural-looking detail up to ~3.2× (it is stored at 2× the frame size) */
const MIN_S = 0.35;
const MAX_S = 3.2;
/** zoom used when focusing a district vs. a zone/marker */
const FOCUS_DISTRICT = 1.3;
const FOCUS_ITEM = 2.4;
/** device labels (A1-N01, BME…) are drawn from this zoom on; below it only on hover / focus */
const LABEL_AT = 3;
/** zoomed in this far on A1.1, the photo outside the zone is dimmed */
const SPOT_AT = 1.8;
/** incident beacons closer than this on screen (px) are drawn as one numbered cluster */
const CLUSTER_PX = 34;
/** incidents listed in an opened cluster before "and N more" */
const CLUSTER_LIST = 7;
/** below this zoom only the zone pins and incidents are drawn, like the overview photo */
const DETAIL_AT = 1.05;

/** Status colors: online/normal green, warning amber, critical red, offline gray. */
export const STATE_COLOR: Record<DeviceState, string> = { normal: 'var(--ok)', warning: 'var(--warn)', critical: 'var(--crit)', offline: 'var(--off)' };
/** incidents detected within this window get a "new" tag and a stronger flash */
const NEW_INCIDENT_MS = 60_000;

/** Pin color and icon for each of the five lit zones. */
const ZONE_PIN: Record<string, { c: string; icon: string }> = {
  A1: { c: 'var(--z-red)', icon: '<path d="M12 4.5 19 9v6l-7 4.5L5 15V9z"/><path d="M8.5 11.2 12 9l3.5 2.2v2.6L12 16l-3.5-2.2z"/>' },
  D2: { c: 'var(--z-orange)', icon: '<path d="M6.5 19 12 5l5.5 14"/><path d="M10 14.5h4"/>' },
  D3: { c: 'var(--z-green)', icon: '<path d="M6 5.5 19 12 6 18.5z"/><path d="M10 10.2 14 12l-4 1.8"/>' },
  D4: { c: 'var(--z-blue)', icon: '<path d="M12 4 20 10l-8 10-8-10z"/><path d="M4 10h16"/><path d="M9 10l3 6 3-6"/>' },
  D5: { c: 'var(--z-yellow)', icon: '<path d="M6 5c3.5 3 8.5 11 12 14"/><path d="M18 5c-3.5 3-8.5 11-12 14"/>' },
};
const BEAM_ANGLES = [-28, -6, 14];

interface View { cx: number; cy: number; s: number }

export function ExpoMap({ height = 460, layers: initialLayers, controls = true, focus, onSelect, heat, className, legend = true, label }: {
  height?: number | string; layers?: Layer[]; controls?: boolean; focus?: { ref: EntityRef | null; nonce: number }; onSelect?: (r: EntityRef) => void;
  heat?: 'crowd' | 'env'; className?: string; legend?: boolean; label?: string;
}) {
  const { s } = useStore();
  const { T, tl, ui, openDrawer } = useUI();
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 800, h: 460 });
  const [view, setView] = useState<View | null>(null);
  const [layers, setLayers] = useState<Layer[]>(initialLayers ?? (heat ? [] : ['cameras', 'devices', 'employees', 'incidents']));
  const [attentionOnly, setAttentionOnly] = useState(false);
  const [layerMenu, setLayerMenu] = useState(false);
  const [q, setQ] = useState('');
  const [highlight, setHighlight] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const [openCluster, setOpenCluster] = useState<string | null>(null);
  const drag = useRef<{ x: number; y: number; cx: number; cy: number; moved: boolean; id: number } | null>(null);
  const suppressClick = useRef(false);
  const reduceMotion = useMemo(() => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches, []);

  // show all five zones (contain), but never smaller than what fills the box with the photo (no empty bands)
  const fitView = (w: number, h: number): View => ({ cx: SITE_VIEW.cx, cy: SITE_VIEW.cy, s: Math.min(MAX_S, Math.max(MIN_S, Math.min(w / SITE_VIEW.w, h / SITE_VIEW.h), w / IMG_W, h / IMG_H)) });

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize({ w: r.width, h: r.height });
      setView((v) => v ?? fitView(r.width, r.height));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const posOf = (r: EntityRef): Pt | null => {
    switch (r.kind) {
      case 'zone': return s.zones.find((z) => z.id === r.id)?.center ?? null;
      case 'camera': return s.cameras.find((c) => c.id === r.id)?.pos ?? null;
      case 'node': return findNode(s, r.id)?.pos ?? null;
      case 'sensor': { const se = s.sensors.find((x) => x.id === r.id); return se?.pos ?? (se ? findNode(s, se.nodeId)?.pos ?? null : null); }
      case 'incident': { const i = s.incidents.find((x) => x.id === r.id); return i?.pos ?? (i ? s.zones.find((z) => z.id === i.zoneId)?.center ?? null : null); }
      case 'employee': { const e = s.employees.find((x) => x.id === r.id); return e?.currentZoneId ? s.zones.find((z) => z.id === e.currentZoneId)?.center ?? null : null; }
      default: return null;
    }
  };
  const focusScale = (r: EntityRef) => (r.kind === 'zone' && r.id.length <= 2 ? FOCUS_DISTRICT : FOCUS_ITEM);

  useEffect(() => {
    if (!focus?.ref) return;
    const p = posOf(focus.ref);
    if (!p) return;
    setView({ cx: p[0], cy: p[1], s: focusScale(focus.ref) });
    setHighlight(`${focus.ref.kind}:${focus.ref.id}`);
    const t = setTimeout(() => setHighlight(null), 5000);
    return () => clearTimeout(t);
  }, [focus?.nonce]);

  const v = view ?? fitView(size.w, size.h);
  const tx = size.w / 2 - v.cx * v.s;
  const ty = size.h / 2 - v.cy * v.s;
  const k = 1 / v.s; // keeps marker size constant on screen

  const clampView = (nv: View): View => ({
    s: Math.min(MAX_S, Math.max(MIN_S, nv.s)),
    cx: Math.min(IMG_W, Math.max(0, nv.cx)),
    cy: Math.min(IMG_H, Math.max(0, nv.cy)),
  });
  const zoomBy = (f: number, mx = size.w / 2, my = size.h / 2) => setView((cur) => {
    const c = cur ?? v;
    const ns = Math.min(MAX_S, Math.max(MIN_S, c.s * f));
    const px = c.cx + (mx - size.w / 2) / c.s;
    const py = c.cy + (my - size.h / 2) / c.s;
    return clampView({ s: ns, cx: px - (mx - size.w / 2) / ns, cy: py - (my - size.h / 2) / ns });
  });

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const r = boxRef.current!.getBoundingClientRect();
    zoomBy(e.deltaY < 0 ? 1.18 : 1 / 1.18, e.clientX - r.left, e.clientY - r.top);
  };
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  const onDown = (e: PointerEvent) => {
    if ((e.target as HTMLElement).closest('.map-ui, .pin, .inc-list')) return;
    drag.current = { x: e.clientX, y: e.clientY, cx: v.cx, cy: v.cy, moved: false, id: e.pointerId };
  };
  const onMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) > 4) { d.moved = true; try { boxRef.current?.setPointerCapture(d.id); } catch { /* ignore */ } }
    if (d.moved) setView(clampView({ s: v.s, cx: d.cx - dx / v.s, cy: d.cy - dy / v.s }));
  };
  const onUp = () => { suppressClick.current = !!drag.current?.moved; drag.current = null; };
  const onKey = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement) !== boxRef.current) return;
    const step = 40 / v.s;
    const m: Record<string, () => void> = {
      ArrowLeft: () => setView(clampView({ ...v, cx: v.cx - step })), ArrowRight: () => setView(clampView({ ...v, cx: v.cx + step })),
      ArrowUp: () => setView(clampView({ ...v, cy: v.cy - step })), ArrowDown: () => setView(clampView({ ...v, cy: v.cy + step })),
      '+': () => zoomBy(1.25), '=': () => zoomBy(1.25), '-': () => zoomBy(0.8), '0': () => setView(fitView(size.w, size.h)),
    };
    if (m[e.key]) { e.preventDefault(); m[e.key](); }
  };
  /** clicking empty map releases a pinned zone (as in the overview photo) */
  const onStageClick = () => {
    if (suppressClick.current) { suppressClick.current = false; return; }
    setPinned(null);
    setOpenCluster(null);
  };

  const select = (r: EntityRef) => {
    if (suppressClick.current) { suppressClick.current = false; return; }
    setHighlight(`${r.kind}:${r.id}`);
    (onSelect ?? openDrawer)(r);
  };
  const markerKeys = (r: EntityRef) => ({
    tabIndex: 0, role: 'button',
    onKeyDown: (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(r); } },
    onClick: (e: MouseEvent) => { e.stopPropagation(); select(r); },
  });
  const show = (st: DeviceState) => !attentionOnly || st !== 'normal';
  const on = (l: Layer) => layers.includes(l);
  const hl = (kind: string, id: string) => highlight === `${kind}:${id}`;

  const results = useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (!qq) return [] as { r: EntityRef; label: string }[];
    const out: { r: EntityRef; label: string }[] = [];
    s.zones.forEach((z) => { if (z.id.toLowerCase().includes(qq) || tl(z.name).toLowerCase().includes(qq)) out.push({ r: { kind: 'zone', id: z.id }, label: `${z.id} · ${tl(z.name)}` }); });
    s.cameras.forEach((c) => { if (c.id.toLowerCase().includes(qq) || c.label.en.toLowerCase().includes(qq) || c.label.ar.includes(qq)) out.push({ r: { kind: 'camera', id: c.id }, label: tl(c.label) }); });
    s.nodes.forEach((n) => { if ([n.id, ...n.aliases].some((x) => x.toLowerCase().includes(qq))) out.push({ r: { kind: 'node', id: n.id }, label: `${n.id} (${n.aliases.join(', ')})` }); });
    s.sensors.forEach((x) => { if (x.id.toLowerCase().includes(qq) || 'bme280'.includes(qq)) out.push({ r: { kind: 'sensor', id: x.id }, label: `${x.id} · BME280` }); });
    s.incidents.forEach((i) => { if (i.id.toLowerCase().includes(qq) && i.pos) out.push({ r: { kind: 'incident', id: i.id }, label: `${i.id} · ${tl(LABELS.category[i.category])}` }); });
    return out.slice(0, 8);
  }, [q, s, ui.lang]);
  const pick = (r: EntityRef) => {
    const p = posOf(r);
    if (p) setView({ cx: p[0], cy: p[1], s: focusScale(r) });
    setQ('');
    setHighlight(`${r.kind}:${r.id}`);
    (onSelect ?? openDrawer)(r);
  };

  const a11 = s.zones.find((z) => z.id === 'A1.1')!;
  const occ = zoneOccupancy(s, 'A1.1');
  const clipId = useMemo(() => `clip-a11-${Math.random().toString(36).slice(2, 7)}`, []);
  const tempSensors = s.sensors.filter((x) => x.pos && sensorHealth(s, x) === 'online');
  const showCrowd = heat === 'crowd' || on('crowd');
  const showEnv = heat === 'env' || on('env');
  const a11pts = a11.polygon.map((p) => p.join(',')).join(' ');

  const a11Top = a11.polygon.reduce((m, p) => Math.min(m, p[1]), Infinity);
  const a11Open = s.incidents.filter((i) => i.kind === 'expo' && isOpenIncident(i) && i.zoneId === 'A1.1').length;
  const a11Pct = occ.people != null && occ.capacity ? Math.min(100, Math.round((occ.people / occ.capacity) * 100)) : null;
  const a11InView = (() => {
    const x = (a11.center[0] * v.s + tx), y = (a11.center[1] * v.s + ty);
    return x > 0 && x < size.w && y > 0 && y < size.h;
  })();
  const spotPath = `M0 0H${IMG_W}V${IMG_H}H0Z M${a11.polygon.map((p) => p.join(' ')).join(' L')}Z`;

  // open incidents that would overlap on screen become one numbered cluster (most severe first)
  const clusters = clusterPoints(
    s.incidents.filter((i) => i.kind === 'expo' && isOpenIncident(i) && i.pos).map((i) => ({ id: i.id, x: i.pos![0], y: i.pos![1], severity: i.severity, inc: i })),
    CLUSTER_PX * k,
  ).sort((a, b) => (a.key === openCluster ? 1 : 0) - (b.key === openCluster ? 1 : 0)); // the opened one on top

  const openC = clusters.find((c) => c.key === openCluster && c.items.length > 1) ?? null;

  const ring = (x: number, y: number) => <circle cx={x} cy={y} r={22 * k} className="hl-ring" style={{ strokeWidth: 2 * k }} />;

  // lit-zone state: hover/focus wins, otherwise the pinned (clicked) zone
  const districts = s.zones.filter((z) => z.kind === 'district' && DISTRICT_SHAPES[z.id] && ZONE_PIN[z.id]);
  const activeId = hover ?? pinned;
  const activeZone = districts.find((z) => z.id === activeId) ?? null;
  const detail = !!initialLayers || !!heat || v.s >= DETAIL_AT;
  const spot = detail && v.s >= SPOT_AT && a11InView;
  const scr = (p: Pt) => [tx + p[0] * v.s, ty + p[1] * v.s] as const;
  const origin = activeZone ? scr(DISTRICT_SHAPES[activeZone.id].c) : null;
  const pinEnter = (id: string) => { if (!pinned) setHover(id); };
  const pinLeave = () => { if (!pinned) setHover(null); };
  const pinClick = (id: string) => {
    const next = pinned === id ? null : id;
    setPinned(next);
    setHover(next);
    if (next) (onSelect ?? openDrawer)({ kind: 'zone', id });
  };

  return (
    <div className={`map stage${activeZone ? ' active' : ''} ${className ?? ''}`} style={{ height }}>
      <div ref={boxRef} className="map-box" tabIndex={0} aria-label={label ?? T('خريطة إكسبو التفاعلية. استخدم الأسهم للتحريك و + و - للتكبير.', 'Interactive Expo map. Use arrow keys to pan and + / - to zoom.')}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onKeyDown={onKey} onClick={onStageClick} dir="ltr">
        <div className="world" style={origin ? { transformOrigin: `${origin[0]}px ${origin[1]}px` } : undefined}>
          <div className="map-inner" style={{ width: IMG_W, height: IMG_H, transform: `translate(${tx}px, ${ty}px) scale(${v.s})` }}>
            <img className={`photo${reduceMotion ? '' : ' drift'}`} src={SITE_PHOTO} width={IMG_W} height={IMG_H} alt={T('منظر جوي ليلي لموقع المعرض ومناطقه الخمس', 'Night-time aerial view of the Expo site and its five zones')} draggable={false} />
            {/* one dimming layer per zone, with that zone's ellipse cut out */}
            {districts.map((z) => {
              const g = DISTRICT_SHAPES[z.id];
              const m = `radial-gradient(ellipse ${g.rx * 1.5}px ${g.ry * 1.5}px at ${g.c[0]}px ${g.c[1]}px, transparent 0%, transparent 58%, #000 100%)`;
              return <div key={`sh-${z.id}`} className={`shade${activeId === z.id ? ' on' : ''}`} style={{ WebkitMaskImage: m, maskImage: m }} aria-hidden="true" />;
            })}
            {districts.map((z) => {
              const g = DISTRICT_SHAPES[z.id];
              return <div key={`gl-${z.id}`} className={`glow${activeId === z.id ? ' on' : ''}`} style={{ left: g.c[0], top: g.c[1], width: g.rx * 2.2, height: g.ry * 2.2 }} aria-hidden="true" />;
            })}
            <svg className={`map-svg${v.s >= LABEL_AT ? ' labels-on' : ''}`} width={IMG_W} height={IMG_H} viewBox={`0 0 ${IMG_W} ${IMG_H}`}>
              <defs>
                <clipPath id={clipId}><polygon points={a11pts} /></clipPath>
                <radialGradient id={`${clipId}-crowd`}><stop offset="0" stopColor="var(--heat-crowd)" stopOpacity=".85" /><stop offset="1" stopColor="var(--heat-crowd)" stopOpacity="0" /></radialGradient>
              </defs>
              {/* A1.1: the rest of the photo dims when zoomed in on it */}
              <path d={spotPath} fillRule="evenodd" className={`a11-spot${spot ? ' on' : ''}`} aria-hidden="true" />
              {detail && (
                <g {...markerKeys({ kind: 'zone', id: 'A1.1' })} className={`zone a11 st-${zoneDeviceState(occ.status)}${ui.scope === 'A1.1' ? ' sel' : ''}`} aria-label={`A1.1 ${occ.people ?? ''}/${occ.capacity ?? ''}`}>
                  <polygon points={a11pts} className="a11-halo" style={{ strokeWidth: 6.5 * k }} />
                  <polygon points={a11pts} className="a11-line" style={{ strokeWidth: 2.6 * k }} />
                  {v.s >= DETAIL_AT && (
                    <g transform={`translate(${a11.center[0]}, ${a11Top - 6 * k}) scale(${k})`}>
                      <foreignObject x={-92} y={-58} width={184} height={58} className="zone-card-fo">
                        <div className={`zone-card st-${zoneDeviceState(occ.status)}`} dir={ui.lang === 'ar' ? 'rtl' : 'ltr'}>
                          <div className="zc-top">
                            <strong>A1.1</strong>
                            <span className="zc-st">{occ.status ? tl(LABELS.crowd[occ.status]) : T('لا توجد بيانات', 'No data')}</span>
                            {a11Open > 0 && <span className="zc-inc" title={T('حوادث مفتوحة', 'Open incidents')}><Icon name="incidents" size={12} />{a11Open}</span>}
                          </div>
                          <div className="zc-occ">
                            <span className="zc-bar" aria-hidden="true"><i style={{ width: `${a11Pct ?? 0}%` }} /></span>
                            <Ltr>{occ.people ?? '—'}/{occ.capacity ?? '—'}</Ltr>
                          </div>
                        </div>
                      </foreignObject>
                    </g>
                  )}
                </g>
              )}
              {hl('zone', 'A1.1') && ring(a11.center[0], a11.center[1])}

              {showCrowd && occ.people != null && occ.capacity != null && (
                <g clipPath={`url(#${clipId})`} className="heat" aria-hidden="true">
                  {[[812, 466, 1], [834, 474, 0.9], [856, 462, 0.6], [870, 478, 0.5], [798, 480, 0.45]].map(([x, y, w], i) => (
                    <circle key={i} cx={x} cy={y} r={14 + 24 * w * Math.min(1.3, occ.people! / occ.capacity!)} fill={`url(#${clipId}-crowd)`} opacity={Math.min(1, 0.25 + 0.75 * w * occ.people! / occ.capacity!)} />
                  ))}
                </g>
              )}
              {showEnv && tempSensors.length > 0 && (
                <g clipPath={`url(#${clipId})`} className="heat env" aria-hidden="true">
                  <polygon points={a11pts} fill={tempColor(avg(tempSensors.map((x) => sensorLast(x)?.temperature ?? 0)))} opacity=".3" />
                  {tempSensors.map((x) => <circle key={x.id} cx={x.pos![0]} cy={x.pos![1]} r={32} fill={tempColor(sensorLast(x)?.temperature ?? 0)} opacity=".45" />)}
                </g>
              )}

              {/* nodes: router icon */}
              {detail && on('devices') && s.nodes.filter((n) => n.pos && show(nodeState(s, n))).map((n) => {
                const st = nodeState(s, n);
                return (
                  <g key={n.id} className={`mk mk-node st-${st}`} transform={`translate(${n.pos![0]},${n.pos![1]}) scale(${k})`} {...markerKeys({ kind: 'node', id: n.id })} aria-label={`${n.id} ${tl(LABELS.deviceState[st])}`}>
                    <title>{`${n.id} (${n.aliases.join(', ')}) — ${tl(LABELS.deviceState[st])}`}</title>
                    <circle r={15} className="mk-chip" />
                    <MapGlyph name="router" size={20} color={STATE_COLOR[st]} />
                    <text y={27} className="mk-lbl dev">{n.aliases[0] ?? n.id}</text>
                    {hl('node', n.id) && <circle r={18} className="hl-ring" />}
                  </g>
                );
              })}
              {/* BME280 sensors: thermometer icon */}
              {detail && on('devices') && s.sensors.filter((x) => x.pos && show(sensorState(s, x))).map((x) => {
                const st = sensorState(s, x);
                const last = sensorLast(x);
                return (
                  <g key={x.id} className={`mk mk-sensor st-${st}`} transform={`translate(${x.pos![0]},${x.pos![1]}) scale(${k})`} {...markerKeys({ kind: 'sensor', id: x.id })} aria-label={`${x.id} BME280 ${tl(LABELS.deviceState[st])}`}>
                    <title>{`${x.id} · BME280 — ${st === 'offline' ? T('غير متصل', 'Offline') : `${last?.temperature} °C · ${last?.humidity} % RH · ${last?.pressure} hPa`}`}</title>
                    <circle r={13} className="mk-chip" />
                    <MapGlyph name="thermo" size={18} color={STATE_COLOR[st]} />
                    <text y={25} className="mk-lbl dev">{x.id.replace('BME-', '')}</text>
                    {hl('sensor', x.id) && <circle r={16} className="hl-ring" />}
                  </g>
                );
              })}
              {/* cameras: camera icon */}
              {detail && on('cameras') && s.cameras.filter((c) => c.pos && show(cameraState(s, c))).map((c) => {
                const st = cameraState(s, c);
                return (
                  <g key={c.id} className={`mk mk-cam st-${st}`} transform={`translate(${c.pos![0]},${c.pos![1]}) scale(${k})`} {...markerKeys({ kind: 'camera', id: c.id })} aria-label={`${tl(c.label)} ${tl(LABELS.deviceState[st])}`}>
                    <title>{`${tl(c.label)} — ${tl(LABELS.deviceState[st])}`}</title>
                    {st === 'critical' && <circle r={19} className="pulse-ring" />}
                    <circle r={15} className="mk-chip" />
                    <MapGlyph name="camera" size={20} color={STATE_COLOR[st]} />
                    <text y={27} className="mk-lbl dev name">{tl(c.label)}</text>
                    {hl('camera', c.id) && <circle r={21} className="hl-ring" />}
                  </g>
                );
              })}
              {/* employees: person icon + number, zone-level presence (no precise positions) */}
              {detail && on('employees') && s.zones.filter((z) => z.kind !== 'district').map((z) => {
                const n = s.employees.filter((e) => e.onSite && e.currentZoneId === z.id && empStatus(s, e) !== 'off_duty').length;
                if (!n) return null;
                const [x, y] = [z.center[0] - 37, z.center[1] + 10];
                return (
                  <g key={`emp-${z.id}`} className="mk mk-emp" transform={`translate(${x},${y}) scale(${k})`} {...markerKeys({ kind: 'zone', id: z.id })}
                    aria-label={T(`${n} موظفين في ${z.id} (على مستوى المنطقة)`, `${n} staff in ${z.id} (zone level)`)}>
                    <title>{T(`${n} موظفين — موقع على مستوى المنطقة من قارئات البطاقات، ليس موقعاً دقيقاً`, `${n} staff — zone-level location from badge readers, not a precise position`)}</title>
                    <rect x={-12} y={-13} width={36} height={26} fill="transparent" />
                    <MapGlyph name="person" size={24} color="var(--emp)" />
                    <text x={11} y={5} className="mk-count">{n}</text>
                  </g>
                );
              })}
              {/* incidents: severity-coloured beacon with expanding waves; hover/focus shows a details card */}
              {on('incidents') && clusters.map((c) => {
                if (c.items.length === 1) {
                  const i = c.items[0].inc;
                  const fresh = s.now - i.detectedAt < NEW_INCIDENT_MS;
                  const sel = hl('incident', i.id);
                  return (
                    <g key={i.id} className={`mk mk-inc sev-${i.severity}${fresh ? ' fresh' : ''}${sel ? ' sel' : ''}`} transform={`translate(${i.pos![0]},${i.pos![1]}) scale(${k})`}
                      {...markerKeys({ kind: 'incident', id: i.id })}
                      aria-label={`${i.id} ${tl(LABELS.category[i.category])} ${tl(LABELS.severity[i.severity])} ${tl(LABELS.incidentStatus[i.status])}`}>
                      <rect x={-20} y={-20} width={40} height={40} fill="transparent" />
                      {[0, 1, 2].map((w) => <circle key={w} r={16} className="inc-wave" style={{ animationDelay: `${w * 0.6}s` }} />)}
                      <g className="inc-badge">
                        <circle r={15} className="inc-disc" />
                        <Icon name={CATEGORY_ICON[i.category] ?? 'incidents'} size={18} x={-9} y={-9} stroke="#fff" strokeWidth={2.3} />
                      </g>
                      {fresh && <g className="inc-new" transform="translate(13,-17)"><rect x={-2} y={-8} width={30} height={14} rx={7} /><text x={13} y={2.5}>{T('جديد', 'NEW')}</text></g>}
                      <text y={31} className="mk-lbl inc">{i.id.replace('INC-2026-', 'INC-')}</text>
                      <foreignObject x={-115} y={-82} width={230} height={56} className="inc-tip-fo">
                        <div className="inc-tip" dir={ui.lang === 'ar' ? 'rtl' : 'ltr'}>
                          <strong>{tl(LABELS.category[i.category])} · <span className="sev">{tl(LABELS.severity[i.severity])}</span></strong>
                          <span>{tl(LABELS.incidentStatus[i.status])} · {fmtAgo(s.now, i.detectedAt, ui.lang)} · {T('اضغط للتفاصيل', 'Click for details')}</span>
                        </div>
                      </foreignObject>
                      {sel && <circle r={24} className="hl-ring" />}
                    </g>
                  );
                }
                const n = c.items.length;
                const open = openCluster === c.key;
                const fresh = c.items.some((x) => s.now - x.inc.detectedAt < NEW_INCIDENT_MS);
                const sel = c.items.some((x) => hl('incident', x.id));
                const toggle = () => { if (suppressClick.current) { suppressClick.current = false; return; } setOpenCluster(open ? null : c.key); };
                return (
                  <g key={`cl-${c.key}`} className={`mk mk-inc mk-cluster sev-${c.severity}${fresh ? ' fresh' : ''}${sel ? ' sel' : ''}${open ? ' open' : ''}`} transform={`translate(${c.x},${c.y}) scale(${k})`}
                    tabIndex={0} role="button" aria-expanded={open}
                    aria-label={T(`${n} حوادث متقاربة، أعلاها خطورة ${tl(LABELS.severity[c.severity])}`, `${n} nearby incidents, most severe ${tl(LABELS.severity[c.severity])}`)}
                    onClick={(e: MouseEvent) => { e.stopPropagation(); toggle(); }}
                    onKeyDown={(e: KeyboardEvent) => {
                      if (e.target !== e.currentTarget) return;
                      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } else if (e.key === 'Escape') setOpenCluster(null);
                    }}>
                    <title>{T(`${n} حوادث — اضغط لعرضها`, `${n} incidents — click to list them`)}</title>
                    <rect x={-22} y={-22} width={44} height={44} fill="transparent" />
                    {[0, 1, 2].map((w) => <circle key={w} r={18} className="inc-wave" style={{ animationDelay: `${w * 0.6}s` }} />)}
                    <g className="inc-badge">
                      <circle r={18} className="inc-disc" />
                      <text y={5.5} className="cl-count">{n}</text>
                    </g>
                    {fresh && <g className="inc-new" transform="translate(15,-19)"><rect x={-2} y={-8} width={30} height={14} rx={7} /><text x={13} y={2.5}>{T('جديد', 'NEW')}</text></g>}
                    {sel && <circle r={26} className="hl-ring" />}
                  </g>
                );
              })}
              {highlight && highlight.startsWith('zone:') && highlight !== 'zone:A1.1' && (() => { const z = s.zones.find((x) => `zone:${x.id}` === highlight); return z ? ring(z.center[0], z.center[1]) : null; })()}
            </svg>
          </div>

          {/* zone pins and light beams, placed in screen space so they keep their size at any zoom */}
          <div className="map-pins" dir="rtl">
            {districts.map((z, i) => {
              const g = DISTRICT_SHAPES[z.id];
              const [x, y] = scr(g.c);
              const [bx] = scr([g.c[0] - 6, g.c[1]]);
              const name = tl(z.name);
              const lit = activeId === z.id;
              return (
                <div key={z.id}>
                  <div className={`beams${lit ? ' on' : ''}`} style={{ left: bx, top: y }} aria-hidden="true">
                    {BEAM_ANGLES.map((a, b) => <span key={b} className={`beam b${b + 1}`} style={{ transform: `rotate(${a + (i % 2 ? 4 : -4)}deg)`, left: b * 8 - 8 }} />)}
                  </div>
                  <button type="button" className={`pin${lit ? ' on' : ''}${reduceMotion ? '' : ' idle'}${ui.scope === z.id ? ' sel' : ''}`}
                    style={{ left: x, top: y - 6 * v.s, ['--c' as string]: ZONE_PIN[z.id].c, animationDelay: `${i * 0.45}s` }}
                    aria-label={name} aria-pressed={pinned === z.id}
                    onMouseEnter={() => pinEnter(z.id)} onMouseLeave={pinLeave} onFocus={() => pinEnter(z.id)} onBlur={pinLeave}
                    onClick={(e: MouseEvent) => { e.stopPropagation(); pinClick(z.id); }}>
                    <span className="ico"><svg viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML={{ __html: ZONE_PIN[z.id].icon }} /></span>
                    <span className="lbl">{name}</span>
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {openC && (() => {
        const n = openC.items.length;
        const shown = openC.items.slice(0, CLUSTER_LIST);
        const h = 40 + shown.length * 30 + (n > shown.length ? 30 : 0);
        const [sx, sy] = scr([openC.x, openC.y]);
        const top = sy - 30 - h >= 8 ? sy - 30 - h : Math.min(size.h - h - 8, sy + 30);
        const left = Math.max(8, Math.min(size.w - 278, sx - 135));
        return (
          <div className="inc-list" style={{ left, top }} dir={ui.lang === 'ar' ? 'rtl' : 'ltr'} role="dialog"
            aria-label={T(`${n} حوادث في هذا الموقع`, `${n} incidents at this spot`)} onKeyDown={(e: KeyboardEvent) => { if (e.key === 'Escape') setOpenCluster(null); }}>
            <div className="il-head">
              <strong>{T(`${n} حوادث في هذا الموقع`, `${n} incidents at this spot`)}</strong>
              <button type="button" className="il-x" onClick={() => setOpenCluster(null)} aria-label={T('إغلاق القائمة', 'Close list')}><Icon name="close" size={14} /></button>
            </div>
            <ul>
              {shown.map(({ inc }) => (
                <li key={inc.id}>
                  <button type="button" className={`sev-${inc.severity}`} onClick={() => { setOpenCluster(null); select({ kind: 'incident', id: inc.id }); }}>
                    <Icon name={CATEGORY_ICON[inc.category] ?? 'incidents'} size={14} />
                    <span className="il-cat">{tl(LABELS.category[inc.category])}</span>
                    <span className="il-sev">{tl(LABELS.severity[inc.severity])}</span>
                    <span className="il-ago">{fmtAgo(s.now, inc.detectedAt, ui.lang)}</span>
                  </button>
                </li>
              ))}
            </ul>
            {n > shown.length && (
              <button type="button" className="il-more" onClick={() => { setOpenCluster(null); select({ kind: 'zone', id: openC.items[0].inc.zoneId }); }}>
                {T(`و ${n - shown.length} أخرى — عرض كل حوادث المنطقة`, `and ${n - shown.length} more — all incidents of the zone`)}
              </button>
            )}
          </div>
        );
      })()}
      {controls && (
        <div className="map-ui map-tools">
          <div className="map-search">
            <Icon name="search" size={15} />
            <input value={q} onChange={(e: { target: { value: string } }) => setQ(e.target.value)} placeholder={T('بحث في الخريطة: منطقة، كاميرا، عقدة…', 'Find on map: zone, camera, node…')}
              aria-label={T('البحث في الخريطة', 'Search the map')}
              onKeyDown={(e: KeyboardEvent) => { if (e.key === 'Enter' && results[0]) pick(results[0].r); }} />
            {results.length > 0 && (
              <ul className="map-results" role="listbox">
                {results.map((r) => <li key={`${r.r.kind}${r.r.id}`}><button type="button" onClick={() => pick(r.r)}><Ltr>{r.label}</Ltr></button></li>)}
              </ul>
            )}
            {q && !results.length && <div className="map-results none">{T('لا توجد نتائج', 'No matches')}</div>}
          </div>
          <div className="map-btns">
            <button type="button" className={`mbtn${attentionOnly ? ' on' : ''}`} onClick={() => setAttentionOnly(!attentionOnly)} aria-pressed={attentionOnly} title={T('إظهار ما يحتاج انتباهاً فقط', 'Show only items needing attention')}>
              <Icon name="incidents" size={15} /><span>{T('يحتاج انتباه', 'Attention')}</span>
            </button>
            <div className="layer-wrap">
              <button type="button" className={`mbtn${layerMenu ? ' on' : ''}`} onClick={() => setLayerMenu(!layerMenu)} aria-expanded={layerMenu}><Icon name="layers" size={15} /><span>{T('الطبقات', 'Layers')}</span></button>
              {layerMenu && (
                <div className="layer-menu" role="group" aria-label={T('طبقات الخريطة', 'Map layers')}>
                  {ALL_LAYERS.map((l) => (
                    <label key={l}><input type="checkbox" checked={on(l)} onChange={() => setLayers(on(l) ? layers.filter((x) => x !== l) : [...layers, l])} />{T(...LAYER_LABEL[l])}</label>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      <div className="map-ui map-zoom">
        <button type="button" className="mbtn icon" onClick={() => zoomBy(1.4)} aria-label={T('تكبير', 'Zoom in')}><Icon name="plus" size={16} /></button>
        <button type="button" className="mbtn icon" onClick={() => zoomBy(1 / 1.4)} aria-label={T('تصغير', 'Zoom out')}><Icon name="minus" size={16} /></button>
        <button type="button" className="mbtn icon" onClick={() => setView(fitView(size.w, size.h))} aria-label={T('عرض الموقع كاملاً', 'Fit site')}><Icon name="fit" size={16} /></button>
      </div>
      {legend && (
        <div className="map-ui map-legend">
          {showCrowd && <HeatLegend kind="crowd" />}
          {showEnv && <HeatLegend kind="env" />}
          <div className="map-caption">
            <span>{T('مرّر المؤشر على أي منطقة أو اضغط عليها لإبرازها.', 'Hover or click any zone to highlight it.')}</span>
            <span aria-live="polite">{activeZone ? `${T('المنطقة المحددة: ', 'Selected zone: ')}${tl(activeZone.name)}` : ''}</span>
          </div>
        </div>
      )}
    </div>
  );
}


const LAYER_LABEL: Record<Layer, [string, string]> = {
  cameras: ['الكاميرات', 'Cameras'], devices: ['حساسات BME280 والعقد', 'BME280 sensors & nodes'], employees: ['الموظفون (مستوى المنطقة)', 'Employees (zone level)'],
  incidents: ['الحوادث المفتوحة', 'Open incidents'], crowd: ['خريطة الحشود الحرارية', 'Crowd heatmap'], env: ['الخريطة البيئية (حرارة)', 'Environmental heatmap'],
};

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
/** 30 °C → cool blue, 40 °C → orange (distinct from the crowd scale). */
export function tempColor(v: number): string {
  const t = Math.max(0, Math.min(1, (v - 30) / 10));
  return `hsl(${200 - t * 170} 75% 52%)`;
}

export function HeatLegend({ kind }: { kind: 'crowd' | 'env' }) {
  const { s } = useStore();
  const { T } = useUI();
  if (kind === 'crowd') {
    const occ = zoneOccupancy(s, 'A1.1');
    return (
      <div className="heat-legend">
        <strong>{T('خريطة الحشود الحرارية', 'Crowd heatmap')}</strong>
        <div className="ramp crowd" aria-hidden="true" />
        <div className="ramp-l"><span>{T('منخفض', 'Low')}</span><span>{T('كثافة نسبية (من السعة)', 'Relative density (share of capacity)')}</span><span>{T('مرتفع', 'High')}</span></div>
        <small>{T('المنطقة', 'Zone')} <Ltr>A1.1</Ltr> · {s.baseMode === 'live' ? T('المصدر: عدّ YOLO من كاميرا 1', 'Source: YOLO count from Camera 1') : T('المصدر: تحليل كاميرا 1 (محاكاة)', 'Source: Camera 1 analysis (simulated)')} · <Ltr>{occ.people}/{occ.capacity}</Ltr> · {T('آخر تحديث', 'Updated')} <Ltr>{fmtTime(s.occupancyUpdatedAt['A1.1'] ?? s.now)}</Ltr></small>
      </div>
    );
  }
  const temps = s.sensors.filter((x) => x.pos && sensorHealth(s, x) === 'online');
  if (!temps.length) return <div className="heat-legend"><strong>{T('الخريطة البيئية', 'Environmental heatmap')}</strong><small>{T('لا توجد قراءات بيئية متاحة', 'No environmental readings available')}</small></div>;
  const last = Math.max(...temps.map((x) => sensorLast(x)?.t ?? 0));
  return (
    <div className="heat-legend">
      <strong>{T('الخريطة البيئية — الحرارة', 'Environmental heatmap — temperature')}</strong>
      <div className="ramp env" aria-hidden="true" />
      <div className="ramp-l"><Ltr>30 °C</Ltr><Ltr>35 °C</Ltr><Ltr>40 °C</Ltr></div>
      <small>{T('المنطقة', 'Zone')} <Ltr>A1.1</Ltr> · {T(`المصدر: ${temps.length} أجهزة BME280 متصلة (${temps.map((x) => x.id).join('، ')})`, `Source: ${temps.length} online BME280 devices (${temps.map((x) => x.id).join(', ')})`)} · {T('آخر تحديث', 'Updated')} <Ltr>{fmtTime(last)}</Ltr>. {T('الأجهزة غير المتصلة مستبعدة. خارج A1.1: لا توجد قراءات بيئية متاحة.', 'Offline devices are excluded. Outside A1.1: no environmental readings available.')}</small>
    </div>
  );
}
