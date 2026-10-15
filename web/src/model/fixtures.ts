import { at, SIM_START, CONFIG } from './config';
import type {
  Actuator, AppState, BmeReading, Camera, Employee, Incident, Node, Sensor, Zone, Pt, Alert, Drone, TeamId, L, TempPermit,
} from './types';

/*
 * Map coordinates are in the 2000×1125 pixel frame of the official night-time aerial
 * render of the Expo site (src/assets/expo-site-night.jpg, rendered by src/ui/SiteRender.tsx). Outlines and positions are illustrative, not
 * official boundaries or surveyed positions.
 */
function ellipse(cx: number, cy: number, rx: number, ry: number, rot = 0, n = 32): Pt[] {
  const pts: Pt[] = [];
  const r = (rot * Math.PI) / 180;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const x = Math.cos(a) * rx * (1 + 0.05 * Math.sin(3 * a));
    const y = Math.sin(a) * ry * (1 + 0.04 * Math.cos(2 * a));
    pts.push([+(cx + x * Math.cos(r) - y * Math.sin(r)).toFixed(1), +(cy + x * Math.sin(r) + y * Math.cos(r)).toFixed(1)]);
  }
  return pts;
}

const Lx = (ar: string, en: string): L => ({ ar, en });

export const A11 = 'A1.1';
export const CAM1 = 'CAM-1';
export const CAM2 = 'CAM-2';
export const CAM3 = 'CAM-3';
export const CAM4 = 'CAM-4';
export const CAMC = 'CAM-C';
export const CAMTH = 'CAM-TH';
export const CAMT1 = 'CAM-T1';

/** The five lit zones of the aerial photo (also drive the map pins and highlight). */
export const DISTRICT_SHAPES: Record<string, { c: Pt; rx: number; ry: number; rot: number }> = {
  A1: { c: [905, 400], rx: 190, ry: 100, rot: 0 },
  D2: { c: [1365, 390], rx: 180, ry: 92, rot: 0 },
  D3: { c: [575, 540], rx: 185, ry: 115, rot: 0 },
  D4: { c: [1470, 560], rx: 195, ry: 115, rot: 0 },
  D5: { c: [965, 815], rx: 230, ry: 150, rot: 0 },
};

function makeZones(): Zone[] {
  const d = (id: string, ar: string, en: string): Zone => {
    const g = DISTRICT_SHAPES[id];
    return { id, name: Lx(ar, en), kind: 'district', capacity: null, polygon: ellipse(g.c[0], g.c[1], g.rx, g.ry, g.rot), center: g.c, hasOccupancy: false, illustrative: true };
  };
  return [
    d('A1', 'الإنسانية', 'Humanity'),
    d('D2', 'الثقافة', 'Culture'),
    d('D3', 'الأرض', 'Earth'),
    d('D4', 'التقنيات', 'Technologies'),
    d('D5', 'التعاون', 'Cooperation'),
    {
      id: A11, name: Lx('المنطقة A1.1', 'Zone A1.1'), kind: 'zone', parentId: 'A1', capacity: 150,
      // outline of the hexagonal pavilion complex west of the A1 plaza in the site photo
      polygon: [[771, 457], [794, 445], [828, 441], [864, 456], [888, 469], [886, 488], [852, 490], [812, 490], [788, 484], [776, 472]],
      center: [830, 468], hasOccupancy: true, illustrative: true,
    },
  ];
}

/** One camera per job, spread over the site's zones; the central camera stays in A1.1 and counts it (crowding). */
function makeCameras(): Camera[] {
  return [
    { id: CAM1, zoneId: 'D2', pos: [1320, 425], online: true, countsZone: false, label: Lx('كاميرا 2', 'Camera 2'), role: Lx('حريق ودخان', 'Fire & smoke') },
    { id: CAM2, zoneId: 'D3', pos: [620, 575], online: true, countsZone: false, label: Lx('كاميرا 3', 'Camera 3'), role: Lx('سقوط', 'Falls') },
    { id: CAM3, zoneId: 'D4', pos: [1425, 595], online: true, countsZone: false, label: Lx('كاميرا 4', 'Camera 4'), role: Lx('عكس السير', 'Wrong way') },
    { id: CAM4, zoneId: 'D5', pos: [1015, 850], online: true, countsZone: false, label: Lx('كاميرا 6', 'Camera 6'), role: Lx('سلوك', 'Behavior'),
      note: Lx('لا يوجد موديل سلوك بعد؛ مؤقتاً ترصد السقوط واتجاه المشي.', 'No behavior model yet; for now it detects falls and walking direction.') },
    { id: CAMC, zoneId: A11, pos: [826, 466], online: true, countsZone: true, central: true, label: Lx('كاميرا 1', 'Camera 1'), role: Lx('مركزية', 'Central') },
    { id: CAMTH, zoneId: 'A1', pos: [995, 372], online: true, countsZone: false, label: Lx('كاميرا 5', 'Camera 5'), role: Lx('تهديدات', 'Threats'),
      note: Lx('ترصد السلاح والشجار والركض المفاجئ ودخول المناطق الممنوعة، وتوجّه الحوادث لفريق الأمن.', 'Detects weapons, fights, sudden running and restricted-area entry; incidents go to the security team.') },
    { id: CAMT1, zoneId: 'D5', pos: [905, 785], online: true, countsZone: false, thermal: true, label: Lx('كاميرا 7', 'Camera 7'), role: Lx('حرارية', 'Thermal') },
  ];
}

function hbSeries(last: number, count = 24): number[] {
  const out: number[] = [];
  for (let i = count - 1; i >= 0; i--) out.push(last - i * CONFIG.heartbeatPeriodMs);
  return out;
}

/** Two connectivity nodes: one online, one offline. */
function makeNodes(now: number): Node[] {
  return [
    { id: 'NODE-A1-01', aliases: ['A1-N01'], zoneId: A11, pos: [806, 455], link: 'LoRaWAN', heartbeats: hbSeries(now - 3000), heartbeatStopped: false },
    { id: 'NODE-A1-04', aliases: ['A1-N04'], zoneId: A11, pos: [868, 465], link: 'LoRaWAN', heartbeats: hbSeries(now - 120_000), heartbeatStopped: true },
  ];
}

/** BME280 report series: one report every 10 s, each carrying temperature, humidity and pressure. */
export function bmeSeries(seed: number, end: number, count = 60): BmeReading[] {
  const out: BmeReading[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const t = end - i * 10_000;
    const ph = t / 60_000 + seed;
    out.push({
      t,
      temperature: +(33.6 + 0.7 * Math.sin(ph / 3.1) + (seed % 3) * 0.3).toFixed(1),
      humidity: +(18 + 1.4 * Math.sin(ph / 4.2 + 1) + (seed % 2)).toFixed(1),
      pressure: +(946.2 + 0.4 * Math.sin(ph / 6.5)).toFixed(1),
    });
  }
  return out;
}

/** Four BME280 devices: two online, two offline. */
function makeSensors(now: number): Sensor[] {
  const s = (id: string, nodeId: string, pos: Pt, seed: number, lastAt: number, stopped = false): Sensor => ({
    id, model: 'BME280', zoneId: A11, nodeId, pos, stopped, readings: bmeSeries(seed, lastAt),
  });
  return [
    s('BME-A1-01', 'NODE-A1-01', [792, 476], 1, now - 2000),
    s('BME-A1-02', 'NODE-A1-01', [846, 452], 2, now - 6000),
    s('BME-A1-03', 'NODE-A1-01', [818, 486], 3, now - 240_000, true), // device itself stopped reporting
    s('BME-A1-04', 'NODE-A1-04', [878, 476], 4, now - 120_000), // offline because its node is offline
  ];
}

/** HVAC actuators — sample records, read-only (no control integration). */
function makeActuators(now: number): Actuator[] {
  return [
    { id: 'HVAC-A1-01', kind: 'hvac', label: Lx('وحدة تبريد الساحة', 'Plaza cooling unit'), zoneId: A11, nodeId: 'NODE-A1-01', location: Lx('الساحة الرئيسية', 'Main plaza'), state: 'cooling', stateAt: now - 45_000 },
    { id: 'HVAC-A1-02', kind: 'hvac', label: Lx('وحدة تبريد منطقة الجلوس', 'Seating-area cooling unit'), zoneId: A11, nodeId: 'NODE-A1-04', location: Lx('منطقة الجلوس الشرقية', 'East seating area'), state: 'fan_only', stateAt: now - 125_000 },
  ];
}

// Sample permission data per team (clearly labeled as sample in the UI).
const TEAM_PERMISSIONS: Record<TeamId, L[]> = {
  medical: [Lx('الاستجابة للحوادث الطبية', 'Respond to medical incidents'), Lx('دخول نقاط الإسعاف الأولي', 'Enter first-aid points')],
  civil_defense: [Lx('الاستجابة لحوادث الحريق والدخان', 'Respond to fire & smoke incidents'), Lx('دخول غرف معدات السلامة', 'Enter fire-safety equipment rooms')],
  hvac: [Lx('دخول مناطق معدات التكييف', 'Enter HVAC equipment areas'), Lx('صيانة وحدات التكييف', 'Maintain air-conditioning units')],
  organizers: [Lx('إرشاد الزوار وتنظيم الحشود', 'Visitor guidance and crowd coordination'), Lx('دخول الممرات التشغيلية', 'Enter operational walkways')],
  security: [Lx('الاستجابة للتهديدات الأمنية', 'Respond to security threats'), Lx('دخول غرفة المراقبة والمناطق المقيدة', 'Enter the monitoring room and restricted areas')],
};

function emp(
  id: string, ar: string, en: string, team: TeamId, jobAr: string, jobEn: string, badge: string,
  assigned: string, current: string | null, onSite: boolean, availability: Employee['availability'],
  lastRead: number | null, checkIn: number | null, distance: number | null, extra: Partial<Employee> = {},
): Employee {
  return {
    id, name: Lx(ar, en), team, jobRole: Lx(jobAr, jobEn), badgeId: badge, assignedZoneId: assigned, currentZoneId: current,
    onSite, availability, accessIssue: null, lastBadgeRead: lastRead, badgeReadsPaused: false, checkIn, checkOut: null,
    distanceM: distance, activity: [], permissions: TEAM_PERMISSIONS[team], allowedZones: [assigned], permits: [], ...extra,
  };
}
const permit = (id: string, zones: string[], from: number, until: number): TempPermit => ({ id, zones, validFrom: from, validUntil: until });
const day29 = (h: number, m: number) => at(h, m) - 24 * 3600_000;

function makeEmployees(now: number): Employee[] {
  return [
    emp('E014', 'أحمد', 'Ahmed', 'medical', 'مسعف', 'Paramedic', 'BDG-10414', A11, A11, true, 'available', now - 5000, at(13, 2), 40, {
      permits: [permit('TP-2026-0112', ['D2'], at(12, 0), at(18, 0))],
      activity: [
        { t: at(13, 2, 14), text: Lx('تسجيل الحضور', 'Checked in') },
        { t: at(13, 3, 30), text: Lx('تنبيه: غير مرصود في المنطقة المخصصة', 'Alert: not detected in assigned zone') },
        { t: at(13, 5, 2), text: Lx('دخول المنطقة A1.1', 'Entered A1.1') },
        { t: at(14, 32, 20), text: Lx('تكليف بالحادثة INC-2026-0142', 'Assigned INC-2026-0142'), incidentId: 'INC-2026-0142' },
        { t: at(14, 32, 31), text: Lx('قبول التكليف', 'Accepted'), incidentId: 'INC-2026-0142' },
        { t: at(14, 34, 2), text: Lx('الوصول إلى الموقع', 'Arrived'), incidentId: 'INC-2026-0142' },
        { t: at(14, 39, 10), text: Lx('تمت معالجة الحادثة', 'Incident resolved'), incidentId: 'INC-2026-0142' },
      ],
    }),
    emp('E021', 'خالد', 'Khalid', 'civil_defense', 'رجل إطفاء', 'Firefighter', 'BDG-10421', A11, A11, true, 'responding', now - 3000, at(12, 55), 75, {
      accessIssue: Lx('فشل قراءة البطاقة عند بوابة A1-G2', 'Badge read failed at gate A1-G2'),
      permits: [permit('TP-2026-0098', ['D3'], day29(8, 0), day29(20, 0))],
      activity: [
        { t: at(12, 55, 40), text: Lx('تسجيل الحضور', 'Checked in') },
        { t: at(12, 58, 3), text: Lx('دخول المنطقة A1.1', 'Entered A1.1') },
        { t: at(14, 51, 12), text: Lx('مشكلة في البطاقة عند بوابة A1-G2', 'Badge problem at gate A1-G2') },
        { t: at(15, 3, 5), text: Lx('تكليف بالحادثة INC-2026-0143', 'Assigned INC-2026-0143'), incidentId: 'INC-2026-0143' },
        { t: at(15, 3, 20), text: Lx('قبول التكليف', 'Accepted'), incidentId: 'INC-2026-0143' },
        { t: at(15, 3, 31), text: Lx('في الطريق', 'En route'), incidentId: 'INC-2026-0143' },
      ],
    }),
    emp('E009', 'فيصل', 'Faisal', 'medical', 'طبيب ميداني', 'Field doctor', 'BDG-10409', A11, A11, true, 'available', now - 2000, at(12, 48), 110, {
      activity: [{ t: at(12, 48, 9), text: Lx('تسجيل الحضور', 'Checked in') }, { t: at(12, 52, 30), text: Lx('دخول المنطقة A1.1', 'Entered A1.1') }],
    }),
    emp('E003', 'نورة', 'Noura', 'organizers', 'مشرفة تنظيم', 'Organizer supervisor', 'BDG-10403', A11, A11, true, 'on_task', now - 4000, at(12, 30), 60, {
      allowedZones: [A11, 'A1'],
      activity: [{ t: at(12, 30, 0), text: Lx('تسجيل الحضور', 'Checked in') }, { t: at(14, 50, 0), text: Lx('بدء مهمة: تنظيم طابور البوابة الشمالية', 'Started task: north gate queue') }],
    }),
    emp('E007', 'سلطان', 'Sultan', 'organizers', 'منظم', 'Organizer', 'BDG-10407', A11, A11, true, 'available', now - 1000, at(13, 10), 55, {
      activity: [{ t: at(13, 10, 21), text: Lx('تسجيل الحضور', 'Checked in') }],
    }),
    emp('E011', 'مريم', 'Mariam', 'hvac', 'فنية تكييف', 'HVAC technician', 'BDG-10411', A11, A11, true, 'on_task', now - 2500, at(12, 40), 90, {
      activity: [{ t: at(12, 40, 12), text: Lx('تسجيل الحضور', 'Checked in') }, { t: at(15, 0, 0), text: Lx('بدء مهمة: فحص وحدة HVAC-A1-02', 'Started task: inspect HVAC-A1-02') }],
    }),
    emp('E016', 'عمر', 'Omar', 'hvac', 'فني تكييف', 'HVAC technician', 'BDG-10416', A11, A11, true, 'available', now - 3500, at(13, 20), 130, {
      permits: [permit('TP-2026-0115', ['D4', 'D5'], at(14, 0), at(16, 0))],
      activity: [{ t: at(13, 20, 44), text: Lx('تسجيل الحضور', 'Checked in') }],
    }),
    emp('E018', 'هدى', 'Huda', 'civil_defense', 'مسؤولة سلامة', 'Safety officer', 'BDG-10418', A11, A11, true, 'available', now - 4500, at(13, 0), 85, {
      activity: [{ t: at(13, 0, 5), text: Lx('تسجيل الحضور', 'Checked in') }],
    }),
    emp('E012', 'يوسف', 'Yousef', 'organizers', 'منظم', 'Organizer', 'BDG-10412', A11, 'D2', true, 'available', now - 2000, at(13, 15), null, {
      activity: [{ t: at(13, 15, 2), text: Lx('تسجيل الحضور', 'Checked in') }, { t: at(14, 58, 40), text: Lx('رصد عند قارئ بطاقات في المنطقة 2', 'Detected at a District 2 badge reader') }],
    }),
    emp('E025', 'لمى', 'Lama', 'organizers', 'منظمة', 'Organizer', 'BDG-10425', A11, null, true, 'available', now - 75 * 60_000, at(12, 50), null, {
      badgeReadsPaused: true, // badge not read at any reader for over an hour
      activity: [{ t: at(12, 50, 30), text: Lx('تسجيل الحضور', 'Checked in') }],
    }),
    emp('E027', 'عبدالله', 'Abdullah', 'hvac', 'فني تكييف', 'HVAC technician', 'BDG-10427', 'D3', 'D3', true, 'available', now - 1500, at(13, 30), null, {
      permits: [permit('TP-2026-0109', [A11], at(9, 0), at(13, 0))],
      activity: [{ t: at(13, 30, 0), text: Lx('تسجيل الحضور', 'Checked in') }],
    }),
    emp('E030', 'سعد', 'Saad', 'organizers', 'منسق', 'Coordinator', 'BDG-10430', 'D2', null, false, 'off_duty', null, at(7, 0), null, {
      checkOut: at(12, 0, 30),
      activity: [{ t: at(7, 0, 10), text: Lx('تسجيل الحضور', 'Checked in') }, { t: at(12, 0, 30), text: Lx('تسجيل الانصراف', 'Checked out') }],
    }),
    // security team (threat-detection add-on: weapons, gunshots, abnormal behaviour)
    emp('E031', 'ماجد', 'Majed', 'security', 'رجل أمن', 'Security officer', 'BDG-10431', A11, A11, true, 'available', now - 2000, at(12, 45), 50, {
      activity: [{ t: at(12, 45, 10), text: Lx('تسجيل الحضور', 'Checked in') }, { t: at(12, 49, 0), text: Lx('دخول المنطقة A1.1', 'Entered A1.1') }],
    }),
    emp('E032', 'ريم', 'Reem', 'security', 'مشرفة أمن', 'Security supervisor', 'BDG-10432', A11, A11, true, 'available', now - 3000, at(12, 35), 95, {
      activity: [{ t: at(12, 35, 40), text: Lx('تسجيل الحضور', 'Checked in') }],
    }),
  ];
}

function makeIncidents(): Incident[] {
  const fall: Incident = {
    id: 'INC-2026-0142', kind: 'expo', category: 'fall', zoneId: A11,
    location: Lx('الممشى الشرقي (مجال كاميرا السقوط)', 'East walkway (Fall Camera view)'),
    source: 'ai_camera', sourceDeviceId: CAM2, severity: 'high', status: 'closed',
    detectedAt: at(14, 32, 8), alertAt: at(14, 32, 9),
    description: Lx('رصد سقوط شخص على الممشى الشرقي.', 'A person fall was detected on the east walkway.'),
    eventId: 'EVT-A1-000871', alertId: 'ALR-2026-0301',
    evidence: [
      { id: 'EV-0142-1', kind: 'camera_clip', label: Lx('مقطع كاميرا السقوط عند الرصد', 'Fall Camera clip at detection'), sourceId: CAM2, t: at(14, 32, 8), simulated: true },
      { id: 'EV-0142-2', kind: 'drone_feed', label: Lx('بث جوي من الطائرة D-01', 'Aerial feed from drone D-01'), sourceId: 'D-01', t: at(14, 33, 45), simulated: true },
    ],
    assignment: {
      employeeId: 'E014', team: 'medical', by: 'OP-01', current: 'resolved',
      steps: { assigned: at(14, 32, 20), accepted: at(14, 32, 31), en_route: at(14, 32, 40), arrived: at(14, 34, 2), resolving: at(14, 34, 10), resolved: at(14, 39, 10) },
    },
    drone: { droneId: 'D-01', by: 'OP-01', dispatchedAt: at(14, 33, 0), arrivedAt: at(14, 33, 45), endedAt: at(14, 37, 20), mission: Lx('التحقق من الحادثة', 'Incident verification'), targetZoneId: A11, fixture: true },
    actions: [
      { t: at(14, 32, 20), actor: 'OP-01', text: Lx('تكليف E014 (الكادر الطبي)', 'Assigned E014 (Medical Team)'), field: false },
      { t: at(14, 33, 0), actor: 'OP-01', text: Lx('إطلاق الطائرة D-01 للتحقق', 'Deployed drone D-01 for verification'), field: false },
      { t: at(14, 34, 10), actor: 'E014', text: Lx('بدء الفحص في الموقع', 'On-scene check started'), field: true },
      { t: at(14, 36, 5), actor: 'E014', text: Lx('إبقاء الممشى حول الموقع خالياً', 'Kept the walkway around the location clear'), field: true },
      { t: at(14, 39, 10), actor: 'E014', text: Lx('تحديد الحالة كمعالجة', 'Marked the situation resolved'), field: true },
      { t: at(14, 41, 3), actor: 'OP-01', text: Lx('إغلاق الحادثة', 'Closed the incident'), field: false },
    ],
    resolvedAt: at(14, 39, 10), closedAt: at(14, 41, 3), pos: [856, 483], fixture: true,
  };
  const smoke: Incident = {
    id: 'INC-2026-0143', kind: 'expo', category: 'fire_smoke', zoneId: A11,
    location: Lx('منطقة الأكشاك قرب الممشى الشرقي', 'Kiosk area by the east walkway'),
    source: 'ai_camera', sourceDeviceId: CAM1, severity: 'high', status: 'responding',
    detectedAt: at(15, 2, 41), alertAt: at(15, 2, 42),
    description: Lx('رصد دخان في مجال رؤية كاميرا 2.', 'Smoke detected in the field of view of Camera 2.'),
    eventId: 'EVT-A1-000874', alertId: 'ALR-2026-0305',
    evidence: [{ id: 'EV-0143-1', kind: 'camera_frame', label: Lx('إطار كاميرا 2 عند الرصد', 'Camera 2 frame at detection'), sourceId: CAM1, t: at(15, 2, 41), simulated: true }],
    assignment: { employeeId: 'E021', team: 'civil_defense', by: 'OP-01', current: 'en_route', steps: { assigned: at(15, 3, 5), accepted: at(15, 3, 20), en_route: at(15, 3, 31) } },
    actions: [{ t: at(15, 3, 5), actor: 'OP-01', text: Lx('تكليف E021 (الدفاع المدني)', 'Assigned E021 (Civil Defense)'), field: false }],
    pos: [834, 474], fixture: true,
  };
  const empInc = (id: string, category: Incident['category'], employeeId: string, zoneId: string, t: number, desc: L, status: Incident['status'], source: Incident['source'], dev: string, alertId: string, closedAt?: number, severity: Incident['severity'] = 'medium'): Incident => ({
    id, kind: 'employee', category, zoneId, location: Lx('على مستوى المنطقة', 'Zone level'), source, sourceDeviceId: dev, severity, status, detectedAt: t, alertAt: t,
    description: desc, employeeId, alertId, evidence: [], actions: closedAt ? [{ t: closedAt, actor: 'SYSTEM', text: Lx('أغلق آلياً بعد رصد الموظف في منطقته', 'Closed automatically after the employee was detected in the assigned zone'), field: false }] : [],
    closedAt, resolvedAt: closedAt, pos: null, fixture: true,
  });
  return [
    fall, smoke,
    empInc('EI-2026-0031', 'not_in_zone', 'E014', A11, at(13, 3, 30), Lx('لم يُرصد الموظف E014 في المنطقة المخصصة بعد تسجيل الحضور.', 'E014 was not detected in the assigned zone after check-in.'), 'closed', 'system', 'Badge readers A1.1', 'ALR-2026-0290', at(13, 5, 2), 'low'),
    empInc('EI-2026-0034', 'badge_problem', 'E021', A11, at(14, 51, 12), Lx('فشلت قراءة بطاقة E021 مرتين عند البوابة A1-G2.', 'Badge read for E021 failed twice at gate A1-G2.'), 'open', 'system', 'A1-G2', 'ALR-2026-0298'),
    empInc('EI-2026-0035', 'not_in_zone', 'E012', 'D2', at(14, 58, 40), Lx('رُصد E012 عند قارئ بطاقات في المنطقة 2 بينما منطقته المخصصة A1.1.', 'E012 was read at a District 2 badge reader; assigned zone is A1.1.'), 'open', 'system', 'Badge readers D2', 'ALR-2026-0303'),
    empInc('EI-2026-0036', 'badge_unseen', 'E025', A11, SIM_START - 15 * 60_000, Lx('لم تُقرأ بطاقة E025 عند أي قارئ منذ أكثر من ساعة. لا يدل ذلك على إصابة أو غياب فعلي.', 'E025’s badge has not been read at any reader for over an hour. This does not confirm injury or physical absence.'), 'open', 'system', 'Badge BDG-10425', 'ALR-2026-0306'),
  ];
}

function makeAlerts(): Alert[] {
  return [
    { id: 'ALR-2026-0290', kind: 'employee', titleKey: 'emp_not_in_zone', params: { emp: 'E014' }, severity: 'low', sourceLabel: 'Badge readers A1.1', zoneId: A11, t: at(13, 3, 30), employeeId: 'E014', incidentId: 'EI-2026-0031', clearedAt: at(13, 5, 2) },
    { id: 'ALR-2026-0298', kind: 'employee', titleKey: 'emp_badge', params: { emp: 'E021' }, severity: 'medium', sourceLabel: 'Gate A1-G2', zoneId: A11, t: at(14, 51, 12), employeeId: 'E021', incidentId: 'EI-2026-0034' },
    { id: 'ALR-2026-0301', kind: 'event', titleKey: 'fall', params: { zone: A11 }, severity: 'high', sourceLabel: 'Fall Camera', zoneId: A11, t: at(14, 32, 9), eventId: 'EVT-A1-000871', incidentId: 'INC-2026-0142' },
    { id: 'ALR-2026-0303', kind: 'employee', titleKey: 'emp_not_in_zone', params: { emp: 'E012' }, severity: 'medium', sourceLabel: 'Badge readers D2', zoneId: 'D2', t: at(14, 58, 40), employeeId: 'E012', incidentId: 'EI-2026-0035' },
    { id: 'ALR-2026-0305', kind: 'event', titleKey: 'smoke', params: { cam: CAM1 }, severity: 'high', sourceLabel: 'Fire & Smoke Camera', zoneId: A11, t: at(15, 2, 42), eventId: 'EVT-A1-000874', incidentId: 'INC-2026-0143' },
    { id: 'ALR-2026-0306', kind: 'employee', titleKey: 'emp_badge_unseen', params: { emp: 'E025' }, severity: 'medium', sourceLabel: 'Badge BDG-10425', zoneId: A11, t: SIM_START - 15 * 60_000, employeeId: 'E025', incidentId: 'EI-2026-0036' },
    { id: 'ALR-2026-0296', kind: 'device', titleKey: 'node_offline', params: { node: 'NODE-A1-04', alias: 'A1-N04' }, severity: 'medium', sourceLabel: 'NODE-A1-04', zoneId: A11, t: SIM_START - 90_000, nodeId: 'NODE-A1-04' },
  ];
}

function crowdHistory(): { t: number; v: number; fixture: boolean }[] {
  return [
    { t: at(10, 0), v: 53 }, { t: at(11, 0), v: 85 }, { t: at(12, 0), v: 124 }, { t: at(13, 0), v: 156 },
    { t: at(14, 0), v: 129 }, { t: at(15, 0), v: 135 }, { t: SIM_START, v: 138 },
  ].map((p) => ({ ...p, fixture: true }));
}

export function initialState(): AppState {
  const now = SIM_START;
  const drones: Drone[] = [
    { id: 'D-01', link: 'connected', battery: 82, status: 'available' },
    { id: 'D-02', link: 'connected', battery: 34, status: 'charging' },
  ];
  return {
    now, zones: makeZones(), cameras: makeCameras(), nodes: makeNodes(now), sensors: makeSensors(now), actuators: makeActuators(now),
    employees: makeEmployees(now),
    events: [
      { id: 'EVT-A1-000871', category: 'fall', zoneId: A11, sourceKind: 'camera', sourceId: CAM2, t: at(14, 32, 8), lastSeen: at(14, 32, 30), endedAt: at(14, 32, 30), simulated: true, incidentId: 'INC-2026-0142', alertId: 'ALR-2026-0301' },
      { id: 'EVT-A1-000874', category: 'fire_smoke', zoneId: A11, sourceKind: 'camera', sourceId: CAM1, t: at(15, 2, 41), lastSeen: at(15, 4, 10), endedAt: at(15, 4, 10), simulated: true, incidentId: 'INC-2026-0143', alertId: 'ALR-2026-0305' },
    ],
    alerts: makeAlerts(), incidents: makeIncidents(), drones,
    crowdHistory: { [A11]: crowdHistory() },
    occupancy: { [A11]: 138 }, occupancyUpdatedAt: { [A11]: now },
    analysisRunning: { [CAMC]: true, [CAM1]: true, [CAM2]: true },
    connection: 'simulated', baseMode: 'simulated', lastUpdate: now, scenario: {},
    seq: { inc: 144, evt: 875, alr: 307, ev: 1, ei: 37, dev: 1 },
    processedRecordings: [],
    journalSeq: 0,
    ai: { connected: false, mode: null, device: '', models: {}, notify: null, cameras: {} },
  };
}

/** Teams suited to each incident category (user-confirmed prototype mapping). HVAC has no matching category. */
export const SUITABLE_TEAMS: Record<string, TeamId[]> = {
  fall: ['medical'],
  fire_smoke: ['civil_defense'],
  crowding: ['organizers'],
  obstruction: ['organizers'],
  wrong_way: ['organizers'],
  smoking: ['organizers'],
  littering: ['organizers'],
  weapon: ['security'],
  gunshot: ['security'],
  abnormal_behavior: ['security'],
  node_offline: ['hvac'],
};
