// Shared data contracts. The simulation service and any future FastAPI/CPS
// backend adapter must both produce these shapes.

export type Lang = 'ar' | 'en';
export type L = { ar: string; en: string };
/** Image-relative coordinate on the aerial concept rendering (px of the 1100×606 source). */
export type Pt = [number, number];

export type DeviceState = 'normal' | 'warning' | 'critical' | 'offline';
export type Severity = 'low' | 'medium' | 'high' | 'critical';
export type CrowdStatus = 'normal' | 'medium' | 'crowded';

/** The only supported AI event categories. */
export type EventCategory =
  | 'crowding' | 'fall' | 'fire_smoke' | 'obstruction' | 'wrong_way' | 'smoking' | 'littering'
  | ThreatCategory | DeviceCategory;
export const EVENT_CATEGORIES: EventCategory[] = [
  'crowding', 'fall', 'fire_smoke', 'obstruction', 'wrong_way', 'smoking', 'littering',
];
/** AI Threat & Abnormal Behavior Detection add-on (server/threat). Kept out of EVENT_CATEGORIES so the dashboard stays as is. */
export type ThreatCategory = 'weapon' | 'gunshot' | 'abnormal_behavior';
export const THREAT_CATEGORIES: ThreatCategory[] = ['weapon', 'gunshot', 'abnormal_behavior'];
/** Device health raised by the server's CPS watcher (real NODE-04). Kept out of EVENT_CATEGORIES so the dashboard charts stay as is. */
export type DeviceCategory = 'node_offline';
export const DEVICE_CATEGORIES: DeviceCategory[] = ['node_offline'];

export type EmpIncidentCategory =
  | 'not_in_zone' | 'badge_problem' | 'access_problem'
  | 'badge_unseen' | 'no_task_response' | 'employee_emergency';
export const EMP_INCIDENT_CATEGORIES: EmpIncidentCategory[] = [
  'not_in_zone', 'badge_problem', 'access_problem',
  'badge_unseen', 'no_task_response', 'employee_emergency',
];

export type Role = 'operator' | 'analyst' | 'privacy' | 'access_admin' | 'responder';
export const ROLES: Role[] = ['operator', 'analyst', 'privacy', 'access_admin', 'responder'];
export type Section = 'dashboard' | 'cameras' | 'incidents' | 'employees' | 'iot' | 'reports';
export const SECTIONS: Section[] = ['dashboard', 'cameras', 'incidents', 'employees', 'iot', 'reports'];

export interface Zone {
  id: string;
  name: L;
  kind: 'district' | 'zone';
  parentId?: string;
  /** null when no capacity has been supplied for this area */
  capacity: number | null;
  polygon: Pt[];
  center: Pt;
  /** true only where occupancy data exists (A1.1 in this prototype) */
  hasOccupancy: boolean;
  illustrative: boolean;
}

export interface Camera {
  id: string;
  zoneId: string;
  pos: Pt | null;
  online: boolean;
  label: L;
  /** what the camera is for, shown small next to its numbered name */
  role?: L;
  /** this camera's analysis produces the zone occupancy count */
  countsZone: boolean;
  /** thermal camera: per-pixel temperature and hot spots instead of YOLO video detectors */
  thermal?: boolean;
  /** the central camera: the large middle screen of the Cameras page */
  central?: boolean;
  /** shown in the camera info popover, e.g. a stand-in model */
  note?: L;
}

export interface Node {
  id: string;          // canonical ID, e.g. NODE-A1-04
  aliases: string[];   // other IDs that refer to the same fixture, e.g. A1-N04
  zoneId: string;
  pos: Pt | null;
  link: string;
  heartbeats: number[]; // recent heartbeat timestamps (ms)
  heartbeatStopped: boolean;
}

/** One report from a BME280: three readings from the same physical device. */
export interface BmeReading { t: number; temperature: number; humidity: number; pressure: number }
export type BmeMetric = 'temperature' | 'humidity' | 'pressure';
export const BME_UNITS: Record<BmeMetric, string> = { temperature: '°C', humidity: '% RH', pressure: 'hPa' };
export interface Sensor {
  id: string;
  model: 'BME280';
  zoneId: string;
  nodeId: string;
  pos: Pt | null;
  /** device stopped reporting (simulated fault or power loss) */
  stopped: boolean;
  readings: BmeReading[];
}

/** HVAC equipment (actuator). Read-only in the prototype: no control commands. */
export interface Actuator {
  id: string;
  kind: 'hvac';
  label: L;
  zoneId: string;
  nodeId: string;
  location: L;
  /** operating state last reported by the unit */
  state: 'cooling' | 'fan_only' | 'standby';
  stateAt: number;
}

export type TeamId = 'medical' | 'civil_defense' | 'hvac' | 'organizers' | 'security';
export const TEAMS: TeamId[] = ['medical', 'civil_defense', 'hvac', 'organizers', 'security'];

export interface TempPermit { id: string; zones: string[]; validFrom: number; validUntil: number }
export type Availability = 'available' | 'responding' | 'on_task' | 'off_duty';

export interface Activity { t: number; text: L; incidentId?: string }

export interface Employee {
  id: string;
  name: L;
  team: TeamId;
  jobRole: L;
  badgeId: string;
  assignedZoneId: string;
  /** zone-level location from badge readers; null when unknown */
  currentZoneId: string | null;
  onSite: boolean;
  availability: Availability;
  accessIssue: L | null;
  /** employees carry an access badge only (no wearable): last time any badge reader read it */
  lastBadgeRead: number | null;
  /** simulation: this badge is not read at any reader any more */
  badgeReadsPaused: boolean;
  checkIn: number | null;
  checkOut: number | null;
  /** illustrative prototype distance to A1.1 incidents, not measured */
  distanceM: number | null;
  activity: Activity[];
  /** sample permission data — not real authorization records */
  permissions: L[];
  allowedZones: string[];
  permits: TempPermit[];
}

export type EventSourceKind = 'camera' | 'recorded' | 'sensor' | 'manual';
export interface DetectionEvent {
  id: string;
  category: EventCategory;
  zoneId: string;
  sourceKind: EventSourceKind;
  sourceId: string;
  t: number;
  lastSeen: number;
  endedAt?: number;
  peakCount?: number;
  capacity?: number;
  simulated: boolean;
  incidentId?: string;
  alertId?: string;
  fileName?: string;
  /** id of the event on the Rasid AI server (live AI detections only) */
  aiId?: string;
  /** highest model confidence while the event lasted (0–1) */
  score?: number;
  /** raw detector labels, e.g. fire, smoke, fallen */
  labels?: string[];
  /** models that produced the detection */
  models?: string[];
  offsetSec?: number;
}

export type AlertKind = 'event' | 'employee' | 'device';
export interface Alert {
  id: string;
  kind: AlertKind;
  /** title key interpreted by the UI together with params */
  titleKey: 'crowd_limit' | 'smoke' | 'fire' | 'fall' | 'event_generic' | 'emp_not_in_zone' | 'emp_badge' | 'emp_badge_unseen' | 'node_offline' | 'manual';
  params: Record<string, string | number>;
  severity: Severity;
  sourceLabel: string;
  zoneId: string;
  t: number;
  eventId?: string;
  incidentId?: string;
  employeeId?: string;
  nodeId?: string;
  clearedAt?: number;
}

export type IncidentStatus = 'open' | 'assigned' | 'responding' | 'resolved' | 'closed';
export type ResponderStep = 'assigned' | 'accepted' | 'en_route' | 'arrived' | 'resolving' | 'resolved';
export const RESPONDER_STEPS: ResponderStep[] = ['assigned', 'accepted', 'en_route', 'arrived', 'resolving', 'resolved'];

export interface Assignment {
  employeeId: string;
  team: TeamId;
  by: string;
  steps: Partial<Record<ResponderStep, number>>;
  current: ResponderStep;
}

export interface DroneMission {
  droneId: string;
  by: string;
  dispatchedAt: number;
  arrivedAt?: number;
  endedAt?: number;
  mission: L;
  targetZoneId: string;
  /** true when timestamps are sample fixture data */
  fixture: boolean;
}

export type EvidenceKind = 'camera_frame' | 'camera_clip' | 'sensor_reading' | 'drone_feed' | 'upload' | 'manual_media';
export interface Evidence {
  id: string;
  kind: EvidenceKind;
  label: L;
  sourceId: string;
  t: number;
  simulated: boolean;
  mediaUrl?: string;
  mediaType?: string;
}

export interface ActionEntry { t: number; actor: string; text: L; field: boolean }

export type IncidentSource = 'ai_camera' | 'iot_sensor' | 'manual' | 'system';

/** One delivery of an AI event (dashboard, Telegram, webhook…), reported by the server. */
export interface NotifyResult { channel: string; team?: string | null; target?: string; ok: boolean; detail: string; t: number }
export interface Incident {
  id: string;
  kind: 'expo' | 'employee';
  category: EventCategory | EmpIncidentCategory;
  zoneId: string;
  location: L;
  source: IncidentSource;
  sourceDeviceId: string;
  severity: Severity;
  status: IncidentStatus;
  detectedAt: number;
  alertAt?: number;
  description: L;
  eventId?: string;
  alertId?: string;
  employeeId?: string;
  evidence: Evidence[];
  assignment?: Assignment;
  drone?: DroneMission;
  actions: ActionEntry[];
  resolvedAt?: number;
  closedAt?: number;
  pos: Pt | null;
  fixture: boolean;
  /** notifications sent for this incident by the server */
  notifications?: NotifyResult[];
}

export interface Drone {
  id: string;
  link: 'connected' | 'disconnected';
  battery: number;
  status: 'available' | 'deployed' | 'on_scene' | 'charging';
  incidentId?: string;
}

export type ConnectionMode = 'live' | 'reconnecting' | 'simulated';

/** Live status of a camera on the Rasid AI server. */
/** Latest readings of a thermal camera (°C). */
export interface ThermalReading { mode: 'y16' | 'gray'; maxC: number; minC: number; meanC: number; hotPct: number; hotC: number; fireC: number }
/** Thermal camera settings kept on the server. */
export interface ThermalCfg { mode: 'y16' | 'gray'; rangeMinC: number; rangeMaxC: number; hotC: number; fireC: number }
export interface AiCamera {
  id: string;
  kind: 'video' | 'thermal';
  thermal: ThermalReading | null;
  thermalCfg: ThermalCfg | null;
  source: 'none' | 'browser' | 'stream';
  active: boolean;
  fps: number;
  people: number | null;
  peopleSmoothed: number | null;
  alerts: string[];
  inferMs: number | null;
  error: string;
  streamUrl: string;
  models: string[];
  direction: string;
  capacity: number | null;
  autostart: boolean;
}
export interface AiModel { name: string; source: string; state: 'idle' | 'loading' | 'ready' | 'failed' | 'disabled'; error: string }
export interface AiStatus {
  /** true while the WebSocket to the Rasid AI server is open */
  connected: boolean;
  mode: 'yolo' | 'lite' | null;
  device: string;
  models: Record<string, AiModel>;
  notify: { webhook: boolean; telegram: boolean; telegram_teams?: Record<string, boolean>; notify_recorded?: boolean } | null;
  cameras: Record<string, AiCamera>;
}

export interface AppState {
  now: number;
  zones: Zone[];
  cameras: Camera[];
  nodes: Node[];
  sensors: Sensor[];
  actuators: Actuator[];
  employees: Employee[];
  events: DetectionEvent[];
  alerts: Alert[];
  incidents: Incident[];
  drones: Drone[];
  crowdHistory: Record<string, { t: number; v: number; fixture: boolean }[]>;
  occupancy: Record<string, number>;
  occupancyUpdatedAt: Record<string, number>;
  analysisRunning: Record<string, boolean>;
  connection: ConnectionMode;
  /** mode to return to after a reconnection */
  baseMode: 'live' | 'simulated';
  lastUpdate: number;
  scenario: { surgeUntil?: number };
  seq: { inc: number; evt: number; alr: number; ev: number; ei: number; dev: number };
  processedRecordings: string[];
  /** last applied entry of the shared server journal */
  journalSeq: number;
  /** set by the first platform start with the current rules: only true duplicates merge into an open incident.
   *  Journals written before that keep the older merge rule, so past incident numbers stay the same. */
  strictMerge?: boolean;
  ai: AiStatus;
}
