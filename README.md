# راصد + موديلات الذكاء الاصطناعي (lama YOLO)

> **التشغيل من الصفر:** راجع [`RUN_FROM_ZERO.md`](RUN_FROM_ZERO.md) — تثبيت الأدوات، ملفات الأسرار، تشغيل CPS وراصد، ربط ESP32، والتحقق.
> **Run from zero:** see [`RUN_FROM_ZERO.md`](RUN_FROM_ZERO.md). Architecture, logs, status and security: `CPS-Project/docs/01`–`06`.

واجهة **راصد** مربوطة بموديلات مشروع **lama-main**. الكاميرات والتحليل والحوادث والإشعارات كلها حقيقية وتشتغل مع بعض.

```
كاميرا / فيديو / RTSP ─► موديلات YOLO ─► رصد متكرر ─► حدث ─► تنبيه + حادثة + لقطة ─► إشعار الفريق المختص
                                                                    │
                                                    كل شاشات راصد المفتوحة (مباشر)
```

---

## التشغيل

### ويندوز
1. ثبّت **Python 3.10 أو أحدث** من python.org، وفعّل خيار *Add Python to PATH* أثناء التثبيت.
2. اضغط مرتين على **`start.bat`**.
3. أول مرة يثبّت المكتبات، وتأخذ عدة دقائق. بعدها يفتح المتصفح على **http://localhost:8010** تلقائياً.

### لينكس / ماك
```bash
./start.sh
```

**ما تحتاج Node.js.** الواجهة مبنية وجاهزة داخل `web/dist`.

> **أول تشغيل:** الموديلات تتنزل تلقائياً. YOLO26s من Ultralytics، وموديلا الحريق/الدخان والسقوط من Hugging Face. حالة كل موديل تظهر في صفحة «الكاميرات والذكاء الاصطناعي». إذا فشل التنزيل يشتغل بديل مبني على OpenCV بدقة أقل، والصفحة توضح ذلك.

> **كرت شاشة NVIDIA:** التثبيت العادي على ويندوز يجيب نسخة PyTorch للمعالج. لتسريع كبير ثبّت نسخة CUDA من pytorch.org داخل `server\.venv`. الصفحة تعرض `cuda` أو `cpu`.

---

## الكاميرات — صفحة «الكاميرات والذكاء الاصطناعي»

لكل كاميرا (مصدر الكاميرا 1 و2) ثلاث طرق للربط:

| الطريقة | متى تستخدمها |
|---|---|
| **تشغيل كاميرا هذا الجهاز** | كاميرا اللابتوب أو كاميرا USB على الجهاز اللي فاتح الصفحة. |
| **تشغيل ملف فيديو كبث** | تجربة بفيديو يتكرر. فيه ملف تجريبي في `samples/test_scene.mp4`. |
| **ربط كاميرا IP / RTSP** | كاميرات المراقبة وأجهزة التسجيل NVR. السيرفر نفسه يحلل، حتى لو المتصفح مقفل. وفيه خيار «يبدأ تلقائياً مع الخادم». |

### أمثلة روابط RTSP

| النوع | الرابط |
|---|---|
| Hikvision | `rtsp://user:pass@192.168.1.64:554/Streaming/Channels/101` |
| Dahua | `rtsp://user:pass@192.168.1.108:554/cam/realmonitor?channel=1&subtype=0` |
| كاميرا USB على جهاز السيرفر | اكتب `0` أو `1` |

### إعدادات كل كاميرا
- **الكواشف:** عدّ الأشخاص، الدخان، الحريق، السقوط، اتجاه المشي.
- **اتجاه المشي الصحيح:** يظهر لما تفعّل كاشف اتجاه المشي.
- **سعة المنطقة:** حد الازدحام. لما يتجاوزه العدد تنفتح حادثة «ازدحام».

> **ملاحظة:** المتصفح يسمح بالكاميرا فقط على `localhost` أو `https`. يعني كاميرا الجهاز تشتغل من نفس جهاز السيرفر، أما الأجهزة الثانية فاستخدم معها RTSP.

---

## التحليلات والحوادث

### البث المباشر
صورة حقيقية عليها مربعات الكشف:

| اللون | المعنى |
|---|---|
| أخضر | اتجاه صحيح |
| أحمر | عكس الاتجاه أو سقوط |
| أصفر | يتتبع |
| برتقالي | حريق |
| رمادي | دخان |

ومعها عدد الأشخاص وزمن التحليل.

### متى تنفتح الحادثة
الحدث ما ينفتح إلا إذا تكرر الرصد في **3 من آخر 5 إطارات**، عشان ما تطلع حوادث من إطار واحد غلط. ولما يختفي الرصد **8 ثواني** ينتهي الحدث.

### محتوى الحادثة
- لقطة محفوظة عليها المربعات.
- نسبة الثقة واسم الموديل.
- الإشعارات المرسلة.
- مسار الاستجابة كامل: تكليف ← قبول ← في الطريق ← وصول ← معالجة ← إغلاق.

لو تكرر نفس النوع من نفس الكاميرا والحادثة لسا مفتوحة، ما تنفتح حادثة جديدة. الرصد الجديد ينضاف لها كدليل.

### الأرقام في لوحة القيادة
عدد الأشخاص ومنحنى الحشود ومؤشر الازدحام كلها من عدّ YOLO الحقيقي لمصدر الكاميرا 1.

### الفيديو المسجّل
ترفع الملف، والسيرفر يحلله كامل بمعدل إطارين في الثانية. كل رصد يصير حادثة ومعها لقطة ومقطع الفيديو.

### المشاركة بين الشاشات
كل الشاشات تشوف نفس الحوادث بنفس الأرقام. التكليف من شاشة المشغل يظهر عند المستجيب. البيانات تبقى بعد تحديث الصفحة وبعد إعادة تشغيل السيرفر، ومحفوظة في `server/data/`.

---

## كيف يُرسل التنبيه

| نوع الرصد | الفريق المختص |
|---|---|
| السقوط | الكادر الطبي |
| الحريق والدخان | الدفاع المدني |
| الازدحام والاتجاه الخاطئ | منظمو إكسبو |

### القنوات
1. **شاشات راصد:** دائماً تشتغل. يظهر تنبيه وصوت ورسالة على الشاشة، وإشعار سطح المكتب لو فعّلته من زر «تفعيل الصوت وإشعارات سطح المكتب».
2. **Telegram:** يرسل صورة اللقطة مع نص عربي.
3. **Webhook:** يرسل الحدث كـ JSON لأي نظام تبيه، مثل بوابة SMS أو n8n أو Teams أو نظامكم.

### إعداد القنوات في `server/.env`
(الملف ينشأ تلقائياً من `.env.example` أول تشغيل.)

```ini
TELEGRAM_BOT_TOKEN=123456:ABC...
TELEGRAM_CHAT_ID=-100xxxxxxxxxx
TELEGRAM_CHAT_ID_CIVIL_DEFENSE=-100yyyy   # اختياري: قروب لكل فريق
NOTIFY_WEBHOOK_URL=https://example.com/rasid-hook
RASID_PUBLIC_URL=http://192.168.1.10:8010 # يضيف رابط اللقطة في الرسالة
```

**طريقة إعداد Telegram:**
1. أنشئ بوت من **@BotFather**.
2. أضف البوت للقروب.
3. خذ رقم القروب، مثلاً من @RawDataBot.
4. أعد تشغيل `start.bat`.

بعدها جرّب من زر «إشعار تجريبي». نتيجة كل إرسال (نجح أو فشل) تنسجل في الحادثة، وتطلع في ملخص التقرير.

---

## الحقيقي والتجريبي

| الجزء | الحالة |
|---|---|
| الكاميرات، الكشف، العدّ، الأحداث، الحوادث، اللقطات، الإشعارات، التكليف والاستجابة | **حقيقي**، ويشتغل على السيرفر |
| حساسات BME280، العقد، الطائرة المسيّرة، بيانات الموظفين، الحوادث السابقة (INC-0142/0143) | **بيانات تجريبية**، لأنه ما فيه لها مصدر حقيقي في المشروعين |
| تبديل الدور (مشغل / مستجيب…) | **معاينة للواجهة فقط**، وليس تسجيل دخول |

إذا فتحت راصد بدون السيرفر، ترجع الواجهة لوضع المحاكاة الأصلي وتكتب أن الخادم غير متصل.

---

## أدوات إضافية

### البدء من جديد
اضغط **Alt+Shift+D** ← «مسح السجل المشترك والبدء من جديد».

### ضبط الحساسية
من `server/.env`:

| المتغير | وظيفته |
|---|---|
| `RASID_EVENT_START_HITS` | كم مرة لازم يتكرر الرصد عشان يبدأ الحدث |
| `RASID_EVENT_END_AFTER_S` | كم ثانية بدون رصد عشان ينتهي الحدث |
| `RASID_EVENT_COOLDOWN_S` | أقل فاصل قبل حدث جديد من نفس النوع على نفس الكاميرا |
| `RASID_STREAM_MAX_FPS` | أقصى معدل تحليل لكل بث |

### تطوير الواجهة
```bash
cd web
npm install
npm run dev     # على 5173، ويحوّل /api إلى السيرفر على 8010
npm test        # اختبارات النموذج ومسار الذكاء الاصطناعي
npm run build   # يحدّث web/dist
```

### واجهة lama القديمة
`POST /api/detect` يقبل نفس طلب lama-main بالضبط. أضف `camera_id` لما تبي الرصد يتحول لأحداث وحوادث.

## MVP live-demo preflight (2026-10-10)

The real operational demo requires both local services to be running before it
is presented as live: the CPS backend (with `NODE-04`), then the RASID server.
The browser must access CPS only through RASID's same-origin, loopback-only
development routes; the CPS integration token stays in `server/.env` and is
never placed in Vite or browser configuration.

Before a demo, verify `/api/health`, `/api/cps/node-state`, and
`/api/operational/hvac/recommendation` from the local RASID server. Confirm
that `NODE-04` has a current heartbeat and that camera observations are fresh
before calling them live. An unavailable, stale, or offline source must remain
labelled as such; it must not fall back to fixture or Simulation Center data.
The operational HVAC endpoint is monitor-only. With no approved operational
threshold policy, `POLICY_NOT_CONFIGURED` is the expected safe result and no
fan command is sent. Local ESP32 HVAC control remains independent and is not
controlled by RASID.

### CPS backend (`CPS-Project/`)

The CPS backend and its recorded database (`CPS-Project/backend/cps.db`:
NODE-04 readings, heartbeats, zones and halls) are in this repository. Start it
on port 8001 before the RASID server:

```
cd CPS-Project
copy .env.example .env      # set RASID_INTEGRATION_TOKEN
python -m venv backend/.venv
backend\.venv\Scripts\pip install -r backend/requirements.txt
backend\.venv\Scripts\python -m uvicorn main:app --app-dir backend --host 127.0.0.1 --port 8001
```

In `server/.env` set `CPS_INTEGRATION_BASE_URL=http://127.0.0.1:8001`,
`CPS_INTEGRATION_DEVELOPMENT_MODE=true` and `CPS_RASID_INTEGRATION_TOKEN` to the
same value as `RASID_INTEGRATION_TOKEN` above.

---

## هيكل المشروع

```
start.bat / start.sh     تشغيل بضغطة
samples/test_scene.mp4   فيديو تجربة (أشخاص + لهب)
server/
  main.py               FastAPI: الواجهة، WebSocket، الكاميرات، الفيديو، الإشعارات
  detectors.py          كواشف lama (أشخاص، دخان، حريق، سقوط، اتجاه) + بدائل OpenCV
  models_loader.py      تحميل الموديلات وحالتها
  cameras.py            مصادر الكاميرا: متصفح، RTSP/USB، بث MJPEG
  events.py             تحويل الرصد إلى أحداث + اللقطات
  notify.py             الإرسال: الشاشات، Telegram، Webhook
  jobs.py               تحليل الفيديو المسجّل
  hub.py                البث المباشر والسجل المشترك
  data/                 السجل، اللقطات، الملفات المرفوعة (ينشأ تلقائياً)
web/
  src/services/ai.ts    اتصال الواجهة بالسيرفر وتشغيل كاميرا المتصفح
  src/pages/CamerasLive.tsx   صفحة الكاميرات الحقيقية
  dist/                 الواجهة المبنية
```
