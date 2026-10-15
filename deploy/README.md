# نشر راصد على الإنترنت · Deployment

| الجزء | المكان | الرابط |
| --- | --- | --- |
| لوحة راصد (الواجهة) | Vercel، مشروع `rased` من مجلد `web/` | https://rased-ivory.vercel.app |
| خادم راصد + الموديلات + خادم CPS | Hugging Face Space `Ahmed014/rased` (مجاني) | https://ahmed014-rased.hf.space |

الواجهة تتصل بالخادم عن طريق `VITE_API_BASE` (متغير بيئة في مشروع Vercel). بدونه تتصل بنفس الموقع اللي فتحها، مثل التشغيل المحلي على 8010.

## الخادم على Hugging Face (`huggingface-space/`)
- الـ Space نوعه Gradio لأن Docker صار مدفوع، والعتاد ZeroGPU (المجاني الوحيد المتاح للحساب). الموديلات تشتغل على المعالج.
- `app.py` يجيب الكود من GitHub على الـ commit المكتوب في `REF`، يشغّل خادم CPS على 127.0.0.1:8001 بتوكن عشوائي جديد كل تشغيل، ثم خادم راصد على 7860 في عملية مستقلة على المعالج.
- ZeroGPU ما يبقي الـ Space شغال إلا إذا سجّل تطبيق Gradio دالة `@spaces.GPU`، فـ `app.py` يسجّل دالة شكلية (ما تنستدعى أبداً، فما تستهلك من حصة GPU) ويشغّل صفحة Gradio داخلية على 7861. لو وقف خادم راصد يطلع `app.py` ويعيد الـ Space التشغيل.
- الموديلات تتنزل من Hugging Face أول ما يشتغل الخادم، وحالتها تظهر في صفحة «الكاميرات والذكاء الاصطناعي».
- البيانات (الحوادث واللقطات) مؤقتة: تنمسح لما يعيد الـ Space التشغيل. الـ Space ينام بعد 48 ساعة بدون زيارات، ويصحى خلال دقيقة أو دقيقتين أول ما أحد يفتحه.
- مسارات CPS والتكييف في الخادم المنشور ترجع 403 للمتصفح (حماية مقصودة: بيانات الجهاز فيها عناوين الشبكة)، فالواجهة على Vercel تستخدم بيانات العرض التجريبية بدلها.

**تحديث الخادم:** ارفع التعديلات على GitHub، وغيّر `REF` في `app.py` على الـ Space (Files ← app.py ← Edit) لرقم الـ commit الجديد.

## الواجهة على Vercel
```bash
cd web
vercel deploy --prod
```
المشروع مربوط (`web/.vercel`، ما ينرفع على git)، والمتغيرات محفوظة في إعدادات المشروع للـ Production:
- `VITE_API_BASE=https://ahmed014-rased.hf.space`
- `VITE_DEMO_CPS=1`: صفحة «إنترنت الأشياء / الأنظمة» تعرض بيانات NODE-04 والتكييف والطائرات مولّدة للعرض (`web/src/services/demoCps.ts`)، لأن خادم راصد يعطي بيانات CPS لنفس الجهاز فقط (127.0.0.1). الصفحة مكتوب عليها «بيانات عرض تجريبية». بدون المتغير (التشغيل المحلي) تبقى البيانات الفعلية.

## Docker (`server/Dockerfile`)
نفس الخادم كصورة Docker وحدة، للاستضافات اللي تدعم Docker (Railway، أو Space من نوع Docker لو انضاف دفع للحساب). الموديلات تتنزل وقت بناء الصورة.

---

**English:** the dashboard is on Vercel (`web/`, built with `VITE_API_BASE` pointing at the server) and the Rasid server,
its AI models and the CPS backend run on the free Hugging Face Space `Ahmed014/rased` (Gradio SDK running `app.py`, CPU
inference in a process that never imports `spaces`; a never-called `@spaces.GPU` placeholder satisfies ZeroGPU's
startup check). `app.py` checks out the repository at `REF`; bump it after pushing server changes. The server keeps
its CPS routes loopback-only, so the Vercel build sets `VITE_DEMO_CPS=1` and the CPS workspace shows generated,
labelled NODE-04 / HVAC / drone demo data (`web/src/services/demoCps.ts`); local builds keep the real data. `server/Dockerfile` is the
same server as one image for any Docker host.
