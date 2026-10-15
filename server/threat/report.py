"""Incident report of one threat analysis: printable bilingual HTML (and the same data as JSON)."""

from __future__ import annotations

import html
import time
from typing import Any, Dict

KIND_TEXT = {
    "weapon": ("سلاح", "Weapon"), "gunshot": ("صوت إطلاق نار / انفجار", "Gunshot / explosion sound"),
    "violence": ("عنف (شجار / اعتداء)", "Violence (fight / assault)"), "running": ("ركض مفاجئ", "Sudden running"),
    "intrusion": ("دخول منطقة ممنوعة", "Restricted-area entry"),
}
LABEL_TEXT = {
    "gun": ("مسدس / بندقية", "Gun"), "knife": ("سكين", "Knife"), "gunshot": ("طلق ناري", "Gunshot"),
    "machine_gun": ("رشاش", "Automatic fire"), "explosion": ("انفجار", "Explosion"), "violence": ("عنف", "Violence"),
    "running": ("ركض", "Running"), "sudden_running": ("ركض مفاجئ", "Sudden running"), "crowd_running": ("ركض جماعي", "Crowd running"),
    "intrusion": ("دخول منطقة ممنوعة", "Restricted-area entry"),
}
SEV_TEXT = {"critical": ("حرجة", "Critical"), "high": ("عالية", "High"), "medium": ("متوسطة", "Medium"), "low": ("منخفضة", "Low")}


def _e(x: Any) -> str:
    return html.escape("" if x is None else str(x))


def _fmt_t(sec: Any) -> str:
    if sec is None:
        return "—"
    s = float(sec)
    return f"{int(s // 60):02d}:{s % 60:05.2f}"


def render_html(job: Dict[str, Any]) -> str:
    alerts = job.get("alerts", [])
    stages = job.get("stages", {})
    created = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime((job.get("created_at") or 0) / 1000))
    audio = stages.get("audio", {})
    audio_txt = "لا يوجد مسار صوتي / No audio track" if audio.get("has_audio") is False else f"{_e(audio.get('state'))} {_e(audio.get('error'))}"
    rows = []
    for i, a in enumerate(alerts, 1):
        kar, ken = KIND_TEXT.get(a["kind"], (a["kind"], a["kind"]))
        lab = "، ".join(LABEL_TEXT.get(x, (x, x))[0] for x in a.get("labels", []))
        lab_en = ", ".join(LABEL_TEXT.get(x, (x, x))[1] for x in a.get("labels", []))
        sar, sen = SEV_TEXT.get(a["severity"], (a["severity"], a["severity"]))
        img = f'<img src="{_e(a["snapshot_url"])}" alt="">' if a.get("snapshot_url") else ""
        zone = f"<div>المنطقة / Zone: {_e(a.get('zone_name'))}</div>" if a.get("zone_name") else ""
        rows.append(f"""
<section class="ev sev-{_e(a['severity'])}">
  <div class="meta">
    <h3>{i}. {kar} <span class="en">{ken}</span></h3>
    <div>رقم الحدث / Event: <code>{_e(a['event_id'])}</code></div>
    <div>الرصد / Detected: {_e(lab)} <span class="en">({_e(lab_en)})</span></div>
    <div>التوقيت في الفيديو / Video time: <b dir="ltr">{_fmt_t(a.get('start_sec'))} → {_fmt_t(a.get('end_sec'))}</b></div>
    <div>الثقة / Confidence: <b dir="ltr">{round((a.get('confidence') or 0) * 100)}%</b></div>
    <div>الخطورة / Severity: <span class="sev">{sar} / {sen}</span></div>
    {zone}
  </div>
  {img}
</section>""")
    models = "".join(f"<li>{_e(v)}</li>" for v in (job.get("models") or {}).values())
    body = "".join(rows) or '<p class="none">لم تُرصد أي تهديدات في هذا الفيديو. / No threats were detected in this video.</p>'
    return f"""<!doctype html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>تقرير التهديدات {_e(job.get('id'))}</title>
<style>
body{{font-family:Tahoma,Arial,sans-serif;margin:24px;color:#1b1f24;background:#fff}}
h1{{margin:0 0 4px;font-size:22px}} .en{{color:#5b6570;font-weight:normal}}
table.sum{{border-collapse:collapse;margin:12px 0 20px}} .sum td{{border:1px solid #d5dbe1;padding:6px 10px}}
.ev{{display:flex;gap:16px;border:1px solid #d5dbe1;border-inline-start:6px solid #888;border-radius:8px;padding:12px;margin:12px 0;break-inside:avoid}}
.ev.sev-critical{{border-inline-start-color:#c62828}} .ev.sev-high{{border-inline-start-color:#ef6c00}} .ev.sev-medium{{border-inline-start-color:#f9a825}}
.ev h3{{margin:0 0 6px;font-size:17px}} .ev img{{max-width:420px;width:45%;border-radius:6px;object-fit:contain;align-self:flex-start}}
.meta div{{margin:3px 0}} .none{{padding:16px;background:#eef6ee;border-radius:8px}}
@media print{{button{{display:none}}}}
</style></head><body>
<button onclick="print()">طباعة / Print</button>
<h1>تقرير حادثة — رصد التهديدات والسلوك غير الطبيعي <span class="en">Threat & Abnormal Behaviour Incident Report</span></h1>
<table class="sum">
<tr><td>رقم التحليل / Analysis</td><td dir="ltr">{_e(job.get('id'))}</td></tr>
<tr><td>الملف / File</td><td dir="ltr">{_e(job.get('file_name'))}</td></tr>
<tr><td>الكاميرا / Camera</td><td dir="ltr">{_e(job.get('camera_id'))}</td></tr>
<tr><td>وقت التحليل / Analyzed at</td><td dir="ltr">{created}</td></tr>
<tr><td>مدة الفيديو / Duration</td><td dir="ltr">{_e(job.get('duration_sec'))} s</td></tr>
<tr><td>الحالة / State</td><td dir="ltr">{_e(job.get('state'))}</td></tr>
<tr><td>تحليل الصوت / Audio</td><td>{audio_txt}</td></tr>
<tr><td>عدد التنبيهات / Alerts</td><td dir="ltr">{len(alerts)}</td></tr>
</table>
<h2>الأحداث / Events</h2>
{body}
<h2>المودلات / Models</h2><ul dir="ltr">{models}</ul>
<p class="en">جميع النتائج من تحليل الذكاء الاصطناعي لهذا الملف، ويجب التحقق منها بشرياً. / All results come from AI analysis of this file and must be verified by a person.</p>
</body></html>"""
