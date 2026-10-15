import { CONFIG, crowdStatus } from './config';
import type {
  Actuator, Alert, AppState, Camera, CrowdStatus, DeviceState, Drone, Employee, Incident, Node, ResponderStep, Sensor, TempPermit, Zone,
} from './types';
import { RESPONDER_STEPS, THREAT_CATEGORIES } from './types';

/** Reference time for health checks. While reconnecting we judge against the
 *  last received update so a lost monitoring link does not mark every device offline. */
export const refTime = (s: AppState) => (s.connection === 'reconnecting' ? s.lastUpdate : s.now);

export const zoneById = (s: AppState, id: string) => s.zones.find((z) => z.id === id);
/** true when record zone `zoneId` falls under the selected scope */
export function inScope(s: AppState, zoneId: string, scope: string): boolean {
  if (scope === 'ALL') return true;
  if (zoneId === scope) return true;
  const z = zoneById(s, zoneId);
  return !!z && z.parentId === scope;
}

export const lastHeartbeat = (n: Node) => n.heartbeats[n.heartbeats.length - 1] ?? null;
export const nodeOnline = (s: AppState, n: Node) => {
  const hb = lastHeartbeat(n);
  return hb != null && refTime(s) - hb <= CONFIG.heartbeatTimeoutMs;
};
export const findNode = (s: AppState, id: string) => s.nodes.find((n) => n.id === id || n.aliases.includes(id));

/** A BME280 device is online while its reports arrive within the heartbeat timeout through an online node. */
export type SensorHealth = 'online' | 'offline';
export const sensorLast = (se: Sensor) => se.readings[se.readings.length - 1];
export function sensorHealth(s: AppState, se: Sensor): SensorHealth {
  const n = findNode(s, se.nodeId);
  const last = sensorLast(se);
  if (!n || !nodeOnline(s, n) || !last) return 'offline';
  return refTime(s) - last.t <= CONFIG.heartbeatTimeoutMs ? 'online' : 'offline';
}
/** Actuators report through their node; without an online node the state is unknown. */
export function actuatorConnected(s: AppState, a: Actuator): boolean {
  const n = findNode(s, a.nodeId);
  return !!n && nodeOnline(s, n);
}
export type PermitStatus = 'active' | 'expired' | 'upcoming';
export function permitStatus(s: AppState, p: TempPermit): PermitStatus {
  if (s.now < p.validFrom) return 'upcoming';
  return s.now <= p.validUntil ? 'active' : 'expired';
}
export function droneZone(s: AppState, d: Drone): string | null {
  const inc = d.incidentId ? s.incidents.find((i) => i.id === d.incidentId) : undefined;
  return inc?.drone && d.status === 'on_scene' ? inc.drone.targetZoneId : null;
}
export const cameraLabel = (s: AppState, id: string) => s.cameras.find((c) => c.id === id)?.label;

export type EmpStatus = 'available' | 'responding' | 'on_task' | 'unseen' | 'off_duty';
/** on duty, but no badge reader has read the employee's badge for CONFIG.badgeUnseenMs */
export function empUnseen(s: AppState, e: Employee): boolean {
  if (e.availability === 'off_duty') return false;
  return e.lastBadgeRead == null || refTime(s) - e.lastBadgeRead > CONFIG.badgeUnseenMs;
}
export function empStatus(s: AppState, e: Employee): EmpStatus {
  if (e.availability === 'off_duty') return 'off_duty';
  if (empUnseen(s, e)) return 'unseen';
  return e.availability;
}
export const empNotInZone = (e: Employee) =>
  e.availability !== 'off_duty' && e.onSite && e.currentZoneId != null && e.currentZoneId !== e.assignedZoneId;
export const employeeById = (s: AppState, id: string) => s.employees.find((e) => e.id === id);

export function zoneOccupancy(s: AppState, zoneId: string): { people: number | null; capacity: number | null; status: CrowdStatus | null } {
  const z = zoneById(s, zoneId);
  if (!z || !z.hasOccupancy || z.capacity == null) return { people: null, capacity: z?.capacity ?? null, status: null };
  const people = s.occupancy[zoneId] ?? null;
  return { people, capacity: z.capacity, status: people == null ? null : crowdStatus(people, z.capacity) };
}

export const isOpenIncident = (i: Incident) => i.status !== 'resolved' && i.status !== 'closed';

export interface ZoneStats {
  people: number | null; capacity: number | null; crowd: CrowdStatus | null;
  employeesPresent: number; notInZone: number; accessIssues: number;
  openIncidents: number; activeAlerts: number;
  cameras: [number, number]; sensors: [number, number]; nodes: [number, number];
}
export function scopeStats(s: AppState, scope: string): ZoneStats {
  const occ = scope === 'ALL' ? { people: null, capacity: null, status: null } : zoneOccupancy(s, scope);
  const cams = s.cameras.filter((c) => inScope(s, c.zoneId, scope));
  const sens = s.sensors.filter((c) => inScope(s, c.zoneId, scope));
  const nodes = s.nodes.filter((c) => inScope(s, c.zoneId, scope));
  const emps = s.employees.filter((e) => e.onSite && e.availability !== 'off_duty');
  return {
    people: occ.people, capacity: occ.capacity, crowd: occ.status,
    employeesPresent: emps.filter((e) => e.currentZoneId && inScope(s, e.currentZoneId, scope)).length,
    notInZone: emps.filter((e) => empNotInZone(e) && inScope(s, e.assignedZoneId, scope)).length,
    accessIssues: s.employees.filter((e) => e.accessIssue && inScope(s, e.assignedZoneId, scope)).length,
    openIncidents: s.incidents.filter((i) => i.kind === 'expo' && isOpenIncident(i) && inScope(s, i.zoneId, scope)).length,
    activeAlerts: s.alerts.filter((a) => alertStatus(s, a) === 'active' && inScope(s, a.zoneId, scope)).length,
    cameras: [cams.filter((c) => c.online).length, cams.length],
    sensors: [sens.filter((x) => sensorHealth(s, x) === 'online').length, sens.length],
    nodes: [nodes.filter((n) => nodeOnline(s, n)).length, nodes.length],
  };
}

/** Alerts a role may see: responders only see alerts linked to their assigned incidents. */
export function visibleAlerts(s: AppState, role: string, userId: string): Alert[] {
  if (role !== 'responder') return s.alerts;
  return s.alerts.filter((a) => s.incidents.some((i) => i.id === a.incidentId && i.assignment?.employeeId === userId));
}

export type AlertStatus = 'active' | 'in_response' | 'resolved' | 'cleared';
export function alertStatus(s: AppState, a: Alert): AlertStatus {
  if (a.nodeId) {
    const n = findNode(s, a.nodeId);
    return a.clearedAt || (n && nodeOnline(s, n)) ? 'cleared' : 'active';
  }
  if (a.clearedAt) return 'cleared';
  if (a.incidentId) {
    const inc = s.incidents.find((i) => i.id === a.incidentId);
    if (inc) {
      if (inc.status === 'resolved' || inc.status === 'closed') return 'resolved';
      if (inc.status === 'assigned' || inc.status === 'responding') return 'in_response';
    }
  }
  return 'active';
}

export function zoneDeviceState(crowd: CrowdStatus | null): DeviceState {
  if (crowd === 'crowded') return 'critical';
  if (crowd === 'medium') return 'warning';
  return 'normal';
}
export function cameraState(s: AppState, c: Camera): DeviceState {
  if (!c.online) return 'offline';
  if (c.countsZone && zoneOccupancy(s, c.zoneId).status === 'crowded') return 'critical';
  // threat add-on: an open weapon / gunshot / abnormal-behavior incident from this camera is critical
  if (s.incidents.some((i) => i.sourceDeviceId === c.id && isOpenIncident(i) && (THREAT_CATEGORIES as string[]).includes(i.category))) return 'critical';
  if (s.incidents.some((i) => i.sourceDeviceId === c.id && isOpenIncident(i))) return 'warning';
  return 'normal';
}
export const nodeState = (s: AppState, n: Node): DeviceState => (nodeOnline(s, n) ? 'normal' : 'offline');
export const sensorState = (s: AppState, se: Sensor): DeviceState => (sensorHealth(s, se) === 'online' ? 'normal' : 'offline');

export function incidentDeviceState(i: Incident): DeviceState {
  if (!isOpenIncident(i)) return 'normal';
  return i.severity === 'critical' || i.severity === 'high' ? 'critical' : 'warning';
}

// ---- incident timeline ----
export type TimelineKey = 'detected' | 'alert_created' | 'assigned' | 'accepted' | 'en_route' | 'arrived' | 'resolving' | 'resolved' | 'closed';
export const TIMELINE_KEYS: TimelineKey[] = ['detected', 'alert_created', 'assigned', 'accepted', 'en_route', 'arrived', 'resolving', 'resolved', 'closed'];
export function incidentTimeline(i: Incident): { key: TimelineKey; t?: number }[] {
  const st = i.assignment?.steps ?? {};
  return TIMELINE_KEYS.map((key) => {
    let t: number | undefined;
    if (key === 'detected') t = i.detectedAt;
    else if (key === 'alert_created') t = i.alertAt;
    else if (key === 'closed') t = i.closedAt;
    else if (key === 'resolved') t = st.resolved ?? i.resolvedAt;
    else t = st[key as ResponderStep];
    return { key, t };
  });
}
/** Timestamps that are recorded must never go backwards. */
export function timelineOrderValid(i: Incident): boolean {
  const ts = incidentTimeline(i).map((x) => x.t).filter((x): x is number => x != null);
  return ts.every((t, k) => k === 0 || t >= ts[k - 1]);
}
/** Response time definition: detection → responder arrival. */
export function responseTimeMs(i: Incident): number | null {
  const arr = i.assignment?.steps.arrived;
  return arr == null ? null : arr - i.detectedAt;
}
export const droneDurationMs = (i: Incident): number | null =>
  i.drone && i.drone.endedAt != null ? i.drone.endedAt - i.drone.dispatchedAt : null;

export function nextStep(cur: ResponderStep): ResponderStep | null {
  const k = RESPONDER_STEPS.indexOf(cur);
  return k >= 0 && k < RESPONDER_STEPS.length - 1 ? RESPONDER_STEPS[k + 1] : null;
}

export function incidentsForEmployee(s: AppState, empId: string): Incident[] {
  return s.incidents.filter((i) => i.assignment?.employeeId === empId || i.employeeId === empId);
}

export const zoneName = (s: AppState, id: string | null | undefined) => (id ? zoneById(s, id)?.name : undefined);
export type { Zone };
