"""How an AI event is sent out.

Every event is always delivered to the Rasid dashboards (WebSocket journal). On top of
that, each configured channel receives it, routed to the team that handles the category:

    fall        -> medical         (Medical Team)
    fire_smoke  -> civil_defense   (Civil Defense)
    crowding    -> organizers      (Organizers)
    wrong_way   -> organizers

Channels (configure in server/.env):
    NOTIFY_WEBHOOK_URL                     JSON POST of the event (any system: SMS gateway, n8n, Teams…)
    TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID  photo + Arabic caption; per-team chats override the default:
    TELEGRAM_CHAT_ID_MEDICAL / _CIVIL_DEFENSE / _ORGANIZERS

Each delivery result is written back to the journal (AI_NOTIFY) so the incident shows
exactly what was sent, to whom, and whether it succeeded.
"""

from __future__ import annotations

import json
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Dict, List, Optional

import config
from events import persist_event
from hub import hub, now_ms

TEAM_AR = {"medical": "الكادر الطبي", "civil_defense": "الدفاع المدني", "organizers": "المنظمين", "hvac": "صيانة التكييف"}
CAT_AR = {"fire_smoke": "حريق ودخان", "fall": "سقوط شخص", "crowding": "تجاوز سعة الحشود", "wrong_way": "حركة بالاتجاه الخاطئ"}
LABEL_AR = {"fire": "حريق", "smoke": "دخان", "fall": "سقوط", "wrong_way": "اتجاه خاطئ", "people": "أشخاص"}
# threat-detection add-on (server/threat)
TEAM_AR["security"] = "الأمن"
CAT_AR.update({"weapon": "رصد سلاح", "gunshot": "صوت إطلاق نار / انفجار", "abnormal_behavior": "سلوك غير طبيعي"})
LABEL_AR.update({"gun": "سلاح ناري", "knife": "سكين", "gunshot": "طلق ناري", "machine_gun": "رشاش", "explosion": "انفجار",
                 "violence": "عنف (شجار/اعتداء)", "running": "ركض", "sudden_running": "ركض مفاجئ", "crowd_running": "ركض جماعي",
                 "intrusion": "دخول منطقة ممنوعة"})


def _requests():
    import requests  # ships with ultralytics; imported lazily

    return requests


def channels_status() -> Dict[str, Any]:
    return {
        "dashboard": True,
        "webhook": bool(config.NOTIFY_WEBHOOK_URL),
        "telegram": bool(config.TELEGRAM_BOT_TOKEN and (config.TELEGRAM_CHAT_ID or any(config.TELEGRAM_CHAT_BY_TEAM.values()))),
        "telegram_teams": {k: bool(v or config.TELEGRAM_CHAT_ID) for k, v in config.TELEGRAM_CHAT_BY_TEAM.items()},
        "notify_recorded": config.NOTIFY_RECORDED,
    }


def caption(ev: Dict[str, Any]) -> str:
    t = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(ev["started_at"] / 1000))
    cat = CAT_AR.get(ev["category"], ev["category"])
    labels = "، ".join(LABEL_AR.get(x, x) for x in ev.get("labels", []))
    head = "🧪 راصد — رسالة اختبار للإشعارات (ليست حادثة حقيقية)" if ev.get("source") == "test" else f"🚨 راصد — {cat}"
    lines = [
        head,
        f"الكاميرا: {ev['camera_id']} · المنطقة: {ev.get('zone_id') or '—'}",
        f"الوقت: {t}",
    ]
    if ev["category"] == "crowding" and ev.get("peak_count") is not None:
        lines.append(f"العدد: {ev['peak_count']} / السعة {ev.get('capacity')}")
    else:
        lines.append(f"الرصد: {labels} · الثقة {round((ev.get('peak_score') or 0) * 100)}%")
    if ev.get("source") == "recorded":
        lines.append(f"المصدر: تسجيل {ev.get('file_name') or ''} (عند {ev.get('offset_sec')} ث)")
    lines.append(f"الفريق المختص: {TEAM_AR.get(ev.get('team', ''), ev.get('team', ''))}")
    lines.append(f"رقم الحدث: {ev['id']}")
    if config.PUBLIC_BASE_URL and ev.get("snapshot_url"):
        lines.append(f"اللقطة: {config.PUBLIC_BASE_URL}{ev['snapshot_url']}")
    return "\n".join(lines)


class Notifier:
    def __init__(self) -> None:
        self.pool = ThreadPoolExecutor(max_workers=2)
        self.lock = threading.Lock()

    def dispatch(self, ev: Dict[str, Any], frame_path: Optional[Path] = None) -> None:
        if ev.get("source") == "recorded" and not config.NOTIFY_RECORDED:
            self._record(ev, [self._result("dashboard", ev, True, "dashboard only (recorded video)")])
            return
        self.pool.submit(self._send_all, ev, frame_path)

    def _result(self, channel: str, ev: Dict[str, Any], ok: bool, detail: str, target: str = "") -> Dict[str, Any]:
        return {"channel": channel, "team": ev.get("team"), "target": target, "ok": ok, "detail": detail[:200], "t": now_ms()}

    def _send_all(self, ev: Dict[str, Any], frame_path: Optional[Path]) -> None:
        results: List[Dict[str, Any]] = [self._result("dashboard", ev, True, "delivered to all Rasid screens")]
        if config.NOTIFY_WEBHOOK_URL:
            results.append(self._webhook(ev))
        if config.TELEGRAM_BOT_TOKEN:
            chat = config.TELEGRAM_CHAT_BY_TEAM.get(ev.get("team", "")) or config.TELEGRAM_CHAT_ID
            if chat:
                results.append(self._telegram(ev, chat, frame_path))
        self._record(ev, results)

    def _record(self, ev: Dict[str, Any], results: List[Dict[str, Any]]) -> None:
        persist_event({"id": ev["id"], "notifications": results})
        hub.record({"type": "AI_NOTIFY", "eventId": ev["id"], "results": results})

    def _webhook(self, ev: Dict[str, Any]) -> Dict[str, Any]:
        try:
            payload = {**ev, "text": caption(ev)}
            if config.PUBLIC_BASE_URL and ev.get("snapshot_url"):
                payload["snapshot_full_url"] = config.PUBLIC_BASE_URL + ev["snapshot_url"]
            r = _requests().post(config.NOTIFY_WEBHOOK_URL, json=payload, timeout=8)
            return self._result("webhook", ev, r.ok, f"HTTP {r.status_code}", config.NOTIFY_WEBHOOK_URL.split("?")[0])
        except Exception as exc:  # noqa: BLE001
            return self._result("webhook", ev, False, str(exc))

    def _telegram(self, ev: Dict[str, Any], chat: str, frame_path: Optional[Path]) -> Dict[str, Any]:
        base = f"https://api.telegram.org/bot{config.TELEGRAM_BOT_TOKEN}"
        text = caption(ev)
        try:
            rq = _requests()
            if frame_path and Path(frame_path).exists():
                with open(frame_path, "rb") as f:
                    r = rq.post(f"{base}/sendPhoto", data={"chat_id": chat, "caption": text[:1000]}, files={"photo": f}, timeout=15)
            else:
                r = rq.post(f"{base}/sendMessage", data={"chat_id": chat, "text": text}, timeout=10)
            ok = r.ok and r.json().get("ok", False)
            detail = "sent" if ok else f"HTTP {r.status_code}: {r.text[:120]}"
            return self._result("telegram", ev, ok, detail, f"chat {chat}")
        except Exception as exc:  # noqa: BLE001
            return self._result("telegram", ev, False, str(exc), f"chat {chat}")

    def send_text(self, text: str, payload: Dict[str, Any]) -> None:
        """Plain message (e.g. a CPS node going offline) to the webhook and the default Telegram chat."""
        def _send() -> None:
            if config.NOTIFY_WEBHOOK_URL:
                try:
                    _requests().post(config.NOTIFY_WEBHOOK_URL, json={**payload, "text": text}, timeout=8)
                except Exception:  # noqa: BLE001 - best effort
                    pass
            chat = config.TELEGRAM_CHAT_ID or next((c for c in config.TELEGRAM_CHAT_BY_TEAM.values() if c), "")
            if config.TELEGRAM_BOT_TOKEN and chat:
                try:
                    _requests().post(f"https://api.telegram.org/bot{config.TELEGRAM_BOT_TOKEN}/sendMessage", data={"chat_id": chat, "text": text}, timeout=10)
                except Exception:  # noqa: BLE001 - best effort
                    pass
        self.pool.submit(_send)

    def test(self, team: str = "civil_defense") -> List[Dict[str, Any]]:
        """Send a clearly-labelled test message through every configured channel."""
        ev = {
            "id": "TEST-" + time.strftime("%H%M%S"), "camera_id": "TEST", "zone_id": "A1.1", "category": "fire_smoke",
            "source": "test", "started_at": now_ms(), "labels": ["fire"], "peak_score": 1.0, "team": team,
        }
        out = []
        if config.NOTIFY_WEBHOOK_URL:
            out.append(self._webhook({**ev, "test": True}))
        if config.TELEGRAM_BOT_TOKEN:
            chat = config.TELEGRAM_CHAT_BY_TEAM.get(team) or config.TELEGRAM_CHAT_ID
            if chat:
                ev_t = dict(ev)
                r = self._telegram(ev_t, chat, None)
                out.append(r)
        if not out:
            out.append(self._result("dashboard", ev, True, "no external channel configured (only Rasid screens)"))
        return out


notifier = Notifier()

if __name__ == "__main__":  # quick manual check:  python notify.py
    print(json.dumps(channels_status(), indent=2))
    print(json.dumps(notifier.test(), indent=2, ensure_ascii=False))
