import type { L } from '../model/types';

export const lx = (ar: string, en: string): L => ({ ar, en });

export const LABELS = {
  section: {
    dashboard: lx('لوحة القيادة', 'Dashboard'), cameras: lx('الكاميرات والذكاء الاصطناعي', 'Cameras & AI'),
    incidents: lx('الحوادث', 'Incidents'), employees: lx('الموظفون', 'Employees'), iot: lx('إنترنت الأشياء / الأنظمة', 'IoT / CPS'), reports: lx('التقارير', 'Reports'),
  },
  role: {
    operator: lx('مشغل مركز القيادة', 'Command Centre Operator'), analyst: lx('محلل أمني', 'Security Analyst'),
    privacy: lx('مسؤول الخصوصية والتدقيق', 'Privacy & Audit Officer'), access_admin: lx('مدير الصلاحيات', 'Access Administrator'),
    responder: lx('مستجيب ميداني', 'Field Responder'),
  },
  deviceState: { normal: lx('طبيعي', 'Normal'), warning: lx('تحذير', 'Warning'), critical: lx('حرج', 'Critical'), offline: lx('غير متصل', 'Offline') },
  severity: { low: lx('منخفضة', 'Low'), medium: lx('متوسطة', 'Medium'), high: lx('عالية', 'High'), critical: lx('حرجة', 'Critical') },
  crowd: { normal: lx('طبيعي', 'Normal'), medium: lx('متوسط', 'Medium'), crowded: lx('مزدحم', 'Crowded') },
  category: {
    crowding: lx('ازدحام', 'Crowding'), fall: lx('رصد سقوط', 'Fall Detection'), fire_smoke: lx('حريق ودخان', 'Fire & Smoke'),
    obstruction: lx('عائق', 'Obstruction'), wrong_way: lx('حركة بالاتجاه الخاطئ', 'Wrong-Way Movement'), smoking: lx('تدخين', 'Smoking'), littering: lx('رمي النفايات', 'Littering'),
    weapon: lx('رصد سلاح', 'Weapon Detection'), gunshot: lx('صوت إطلاق نار', 'Gunshot Sound'), abnormal_behavior: lx('سلوك غير طبيعي', 'Abnormal Behavior'), node_offline: lx('انقطاع عقدة CPS', 'CPS Node Offline'),
    not_in_zone: lx('غير موجود في المنطقة المخصصة', 'Not present in assigned zone'), badge_problem: lx('مشكلة في البطاقة', 'Badge problem'),
    access_problem: lx('مشكلة في الدخول', 'Access problem'),
    badge_unseen: lx('لم تُرصد البطاقة', 'Badge not seen'), no_task_response: lx('عدم الاستجابة لمهمة مكلف بها', 'No response to an assigned task'),
    employee_emergency: lx('طارئ متعلق بموظف', 'Employee-related emergency'),
  } as Record<string, L>,
  incidentStatus: { open: lx('مفتوحة', 'Open'), assigned: lx('مُكلَّف', 'Assigned'), responding: lx('قيد الاستجابة', 'Responding'), resolved: lx('تمت المعالجة', 'Resolved'), closed: lx('مغلقة', 'Closed') },
  alertStatus: { active: lx('نشط', 'Active'), in_response: lx('قيد الاستجابة', 'In response'), resolved: lx('تمت المعالجة', 'Resolved'), cleared: lx('زال', 'Cleared') },
  responder: { assigned: lx('مُكلَّف', 'Assigned'), accepted: lx('مقبول', 'Accepted'), en_route: lx('في الطريق', 'En route'), arrived: lx('وصل', 'Arrived'), resolving: lx('قيد المعالجة', 'Resolving'), resolved: lx('تمت المعالجة', 'Resolved') },
  stepAction: { accepted: lx('قبول التكليف', 'Accept'), en_route: lx('أنا في الطريق', 'Mark en route'), arrived: lx('وصلت إلى الموقع', 'Mark arrived'), resolving: lx('بدء المعالجة', 'Start resolving'), resolved: lx('تمت المعالجة', 'Mark resolved') } as Record<string, L>,
  timeline: {
    detected: lx('الرصد', 'Detected'), alert_created: lx('إنشاء التنبيه', 'Alert created'), assigned: lx('التكليف', 'Assigned'), accepted: lx('القبول', 'Accepted'),
    en_route: lx('في الطريق', 'En route'), arrived: lx('الوصول', 'Arrived'), resolving: lx('اتخاذ الإجراء / المعالجة', 'Action taken / Resolving'),
    resolved: lx('تمت المعالجة', 'Resolved'), closed: lx('الإغلاق', 'Closed'),
  },
  source: { ai_camera: lx('كاميرا ذكاء اصطناعي', 'AI Camera'), iot_sensor: lx('حساس إنترنت الأشياء', 'IoT Sensor'), manual: lx('بلاغ يدوي', 'Manual Report'), system: lx('النظام', 'System') },
  empStatus: { available: lx('متاح', 'Available'), responding: lx('يستجيب', 'Responding'), on_task: lx('في مهمة', 'On Task'), unseen: lx('لم يُرصد مؤخراً', 'Not seen recently'), off_duty: lx('خارج الدوام', 'Off Duty') },
  team: { medical: lx('الكادر الطبي', 'Medical Team'), civil_defense: lx('الدفاع المدني', 'Civil Defense'), hvac: lx('صيانة التكييف', 'HVAC Maintenance'), organizers: lx('المنظمين', 'Organizers'), security: lx('الأمن', 'Security') },
  metric: { temperature: lx('الحرارة', 'Temperature'), humidity: lx('الرطوبة', 'Humidity'), pressure: lx('الضغط', 'Pressure') },
  sensorHealth: { online: lx('متصل', 'Online'), offline: lx('غير متصل', 'Offline') },
  drone: { available: lx('متاحة', 'Available'), deployed: lx('في الطريق إلى المهمة', 'En route to mission'), on_scene: lx('في موقع المهمة', 'On scene'), charging: lx('قيد الشحن', 'Charging') },
  droneLink: { connected: lx('متصلة', 'Connected'), disconnected: lx('غير متصلة', 'Disconnected') },
  permit: { active: lx('ساري', 'Active'), expired: lx('منتهي', 'Expired'), upcoming: lx('لم يبدأ', 'Not yet valid') },
  hvacState: { cooling: lx('تبريد', 'Cooling'), fan_only: lx('تهوية فقط', 'Fan only'), standby: lx('وضع الاستعداد', 'Standby') },
  evidence: { camera_frame: lx('إطار كاميرا', 'Camera frame'), camera_clip: lx('مقطع كاميرا', 'Camera clip'), sensor_reading: lx('قراءة حساس', 'Sensor reading'), drone_feed: lx('بث طائرة', 'Drone feed'), upload: lx('تسجيل مرفوع', 'Uploaded recording'), manual_media: lx('وسائط البلاغ', 'Report media') },
};

const CAM_NAMES: Record<string, L> = {
  'CAM-1': lx('كاميرا 2', 'Camera 2'),
  'CAM-2': lx('كاميرا 3', 'Camera 3'),
  'CAM-3': lx('كاميرا 4', 'Camera 4'),
  'CAM-4': lx('كاميرا 6', 'Camera 6'),
  'CAM-C': lx('كاميرا 1', 'Camera 1'),
  'CAM-TH': lx('كاميرا 5', 'Camera 5'),
  'CAM-T1': lx('كاميرا 7', 'Camera 7'),
};
function camName(id: string | number | undefined): L { return CAM_NAMES[String(id)] ?? lx(String(id), String(id)); }

export function alertTitle(a: { titleKey: string; params: Record<string, string | number> }): L {
  const p = a.params;
  switch (a.titleKey) {
    case 'crowd_limit': return lx(`تجاوز حد الازدحام — ${p.zone} — ${p.count}/${p.capacity}`, `Crowd Limit Exceeded — ${p.zone} — ${p.count}/${p.capacity}`);
    case 'smoke': return lx(`رصد دخان — ${camName(p.cam).ar}`, `Smoke Detected — ${camName(p.cam).en}`);
    case 'fire': return lx(`رصد حريق — ${camName(p.cam).ar}`, `Fire Detected — ${camName(p.cam).en}`);
    case 'fall': return lx(`رصد سقوط — ${p.zone}`, `Fall Detected — ${p.zone}`);
    case 'event_generic': { const c = LABELS.category[String(p.cat)]; return lx(`${c.ar} — ${camName(p.cam).ar}`, `${c.en} — ${camName(p.cam).en}`); }
    case 'emp_not_in_zone': return lx(`الموظف ${p.emp} غير مرصود في منطقته المخصصة`, `Employee ${p.emp} Not Detected in Assigned Zone`);
    case 'emp_badge': return lx(`الموظف ${p.emp}: مشكلة بطاقة/دخول`, `Employee ${p.emp} Badge/Access Issue`);
    case 'emp_badge_unseen': return lx(`الموظف ${p.emp}: لم تُرصد البطاقة منذ أكثر من ساعة`, `Employee ${p.emp}: badge not seen for over an hour`);
    case 'node_offline': return lx(`العقدة ${p.alias || p.node} غير متصلة`, `Node ${p.alias || p.node} Offline`);
    case 'manual': { const c = LABELS.category[String(p.cat)]; return lx(`بلاغ يدوي: ${c.ar} — ${p.zone}`, `Manual report: ${c.en} — ${p.zone}`); }
  }
  return lx(a.titleKey, a.titleKey);
}
