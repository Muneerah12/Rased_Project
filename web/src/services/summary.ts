import type { AppState, Incident, L } from '../model/types';
import { fmtDate, fmtDuration, fmtTime } from '../model/config';
import { employeeById, responseTimeMs, droneDurationMs } from '../model/selectors';
import { LABELS } from '../ui/labels';

/**
 * Incident summary boundary. No AI service is connected, so this deterministic
 * template builds the summary strictly from recorded incident fields. It never
 * adds injuries, outcomes or actions that were not recorded.
 */
export interface SummaryService { summarize(s: AppState, i: Incident): { text: L; mode: 'template' | 'service' } }

export const templateSummaryService: SummaryService = {
  summarize(s, i) {
    const cat = LABELS.category[i.category];
    const src = LABELS.source[i.source];
    const a = i.assignment;
    const emp = a ? employeeById(s, a.employeeId) : undefined;
    const rt = responseTimeMs(i);
    const field = i.actions.filter((x) => x.field && x.actor === a?.employeeId && !['Accepted', 'En route', 'Arrived', 'Action taken / resolving', 'Resolved'].includes(x.text.en));
    const d = droneDurationMs(i);
    const en: string[] = [];
    const ar: string[] = [];
    en.push(`${cat.en} was detected in zone ${i.zoneId} (${i.location.en}) on ${fmtDate(i.detectedAt)} at ${fmtTime(i.detectedAt)} by ${src.en} ${i.sourceDeviceId}.`);
    ar.push(`رُصد «${cat.ar}» في المنطقة ${i.zoneId} (${i.location.ar}) بتاريخ ${fmtDate(i.detectedAt)} الساعة ${fmtTime(i.detectedAt)} بواسطة ${src.ar} ${i.sourceDeviceId}.`);
    const evt = s.events.find((e) => e.id === i.eventId);
    if (evt?.aiId && evt.score != null && evt.category !== 'crowding') {
      en.push(`The AI model (${(evt.models ?? []).join(', ') || 'YOLO'}) reported ${Math.round(evt.score * 100)}% confidence; a detection snapshot is attached.`);
      ar.push(`أفاد نموذج الذكاء الاصطناعي (${(evt.models ?? []).join('، ') || 'YOLO'}) بثقة ${Math.round(evt.score * 100)}%، وأُرفقت لقطة الرصد.`);
    }
    const sent = (i.notifications ?? []).filter((n) => n.ok);
    if (sent.length) {
      const ch = (c: string, lng: 'ar' | 'en') => (c === 'dashboard' ? (lng === 'ar' ? 'شاشات راصد' : 'Rasid screens') : c === 'telegram' ? (lng === 'ar' ? 'تيليجرام' : 'Telegram') : c);
      const team = sent[0].team ? LABELS.team[sent[0].team as keyof typeof LABELS.team] : undefined;
      en.push(`Notification sent${team ? ` to ${team.en}` : ''} via ${sent.map((n) => ch(n.channel, 'en')).join(', ')} at ${fmtTime(sent[0].t)}.`);
      ar.push(`أُرسل الإشعار${team ? ` إلى ${team.ar}` : ''} عبر ${sent.map((n) => ch(n.channel, 'ar')).join('، ')} الساعة ${fmtTime(sent[0].t)}.`);
    }
    if (a) {
      en.push(`${a.employeeId}${emp ? ` (${emp.name.en})` : ''} from ${LABELS.team[a.team].en} was assigned at ${fmtTime(a.steps.assigned!)}${a.steps.arrived ? ` and arrived at ${fmtTime(a.steps.arrived)}` : ''}.`);
      ar.push(`كُلّف ${a.employeeId}${emp ? ` (${emp.name.ar})` : ''} من ${LABELS.team[a.team].ar} الساعة ${fmtTime(a.steps.assigned!)}${a.steps.arrived ? ` ووصل الساعة ${fmtTime(a.steps.arrived)}` : ''}.`);
    } else { en.push('No responder has been assigned.'); ar.push('لم يُكلَّف مستجيب بعد.'); }
    if (field.length) {
      en.push(`Recorded field actions: ${field.map((x) => `${x.text.en} (${fmtTime(x.t)})`).join('; ')}.`);
      ar.push(`الإجراءات الميدانية المسجلة: ${field.map((x) => `${x.text.ar} (${fmtTime(x.t)})`).join('؛ ')}.`);
    }
    en.push(rt != null ? `Response time from detection to arrival: ${fmtDuration(rt, 'en')}.` : 'Response time is pending (no arrival recorded).');
    ar.push(rt != null ? `زمن الاستجابة من الرصد حتى الوصول: ${fmtDuration(rt, 'ar')}.` : 'زمن الاستجابة قيد الانتظار (لم يُسجّل وصول).');
    if (i.drone) {
      en.push(`Drone ${i.drone.droneId} supported verification${d != null ? ` for ${fmtDuration(d, 'en')}` : ''}.`);
      ar.push(`دعمت الطائرة ${i.drone.droneId} التحقق${d != null ? ` لمدة ${fmtDuration(d, 'ar')}` : ''}.`);
    }
    if (i.closedAt) { en.push(`The incident was resolved at ${fmtTime(i.resolvedAt!)} and closed at ${fmtTime(i.closedAt)}.`); ar.push(`عولجت الحادثة الساعة ${fmtTime(i.resolvedAt!)} وأُغلقت الساعة ${fmtTime(i.closedAt)}.`); }
    else if (i.resolvedAt) { en.push(`Resolved at ${fmtTime(i.resolvedAt)}; not yet closed.`); ar.push(`عولجت الساعة ${fmtTime(i.resolvedAt)} ولم تُغلق بعد.`); }
    else { en.push(`Current status: ${LABELS.incidentStatus[i.status].en}.`); ar.push(`الحالة الحالية: ${LABELS.incidentStatus[i.status].ar}.`); }
    return { text: { en: en.join(' '), ar: ar.join(' ') }, mode: 'template' };
  },
};
