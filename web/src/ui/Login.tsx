import { useMemo, useState } from 'react';
import { useUI } from '../state/store';
import { MIN_PASSWORD_LENGTH, signIn } from '../services/auth';
import rasidLogo from '../assets/rasid-logo.png';
import logoAr from '../assets/expo-logo-ar.png';
import logoEn from '../assets/expo-logo-en.png';

/** Expo 2030 film from web/public (served as-is at the site root). Portrait, H.264, no sound needed. */
const HERO_VIDEO = '/exp.mp4';

type InputEv = { currentTarget: HTMLInputElement };
type Prevent = { preventDefault: () => void };

/**
 * Password field that shows one * per character. The real value lives in state only; the input
 * holds the stars, and the caret is kept at the end so typing and Backspace map onto the value.
 */
function StarPassword({ value, onChange, id }: { value: string; onChange: (v: string) => void; id: string }) {
  const toEnd = (el: HTMLInputElement) => { const n = el.value.length; el.setSelectionRange(n, n); };
  return (
    <input id={id} className="login-in ltr-in" type="text" inputMode="text" autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
      value={'*'.repeat(value.length)}
      onChange={(e: { target: { value: string } }) => {
        const shown = e.target.value;
        onChange(shown.length < value.length ? value.slice(0, shown.length) : value + shown.slice(value.length));
      }}
      onSelect={(e: InputEv) => toEnd(e.currentTarget)} onFocus={(e: InputEv) => toEnd(e.currentTarget)}
      onCopy={(e: Prevent) => e.preventDefault()} onCut={(e: Prevent) => e.preventDefault()} />
  );
}

export function Login({ onSignedIn }: { onSignedIn: () => void }) {
  const { T, ui, set } = useUI();
  const [user, setUser] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const reduceMotion = useMemo(() => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches, []);

  const submit = (e: Prevent) => {
    e.preventDefault();
    if (!user.trim() || !pw) { setErr(T('أدخل اسم المستخدم وكلمة المرور', 'Enter the username and password')); return; }
    const r = signIn(user, pw);
    if (r.ok) { onSignedIn(); return; }
    setPw('');
    if (r.reason === 'short') setErr(T(`كلمة المرور يجب أن تكون ${MIN_PASSWORD_LENGTH} أحرف على الأقل`, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`));
    else if (r.reason === 'locked') setErr(T(`محاولات كثيرة. حاول بعد ${r.retryInSec} ثانية`, `Too many attempts. Try again in ${r.retryInSec}s`));
    else setErr(T('اسم المستخدم أو كلمة المرور غير صحيحة', 'Incorrect username or password'));
  };

  return (
    <div className="login" dir={ui.lang === 'ar' ? 'rtl' : 'ltr'} lang={ui.lang}>
      <aside className="login-hero" aria-hidden="true">
        {/* portrait film: a blurred, zoomed copy fills the panel and the sharp original sits on top, uncropped.
            Reduced-motion users get the first frame, still. */}
        <video className="login-vid-bg" src={HERO_VIDEO} autoPlay={!reduceMotion} muted loop playsInline preload="auto" tabIndex={-1} />
        <video className="login-vid" src={HERO_VIDEO} autoPlay={!reduceMotion} muted loop playsInline preload="auto" tabIndex={-1} />
        <div className="login-hero-txt">
          <span className="login-hero-k">{T('إكسبو 2030 الرياض', 'Expo 2030 Riyadh')}</span>
          <strong>{T('منصة راصد للمراقبة الذكية', 'Rasid smart monitoring platform')}</strong>
          <span>{T('الحوادث والحشود والكاميرات والموظفون في شاشة واحدة', 'Incidents, crowds, cameras and staff on one screen')}</span>
        </div>
      </aside>
      <main className="login-side">
        <div className="login-top">
          <div className="login-logos">
            <img src={rasidLogo} alt={T('شعار راصد', 'Rasid logo')} className="login-rasid" />
            <span className="login-sep" aria-hidden="true" />
            <img src={ui.lang === 'ar' ? logoAr : logoEn} alt={T('شعار إكسبو 2030 الرياض', 'Expo 2030 Riyadh logo')} className="login-expo" />
          </div>
          <div className="login-lang" role="group" aria-label={T('اللغة', 'Language')}>
            <button type="button" className={ui.lang === 'ar' ? 'on' : ''} onClick={() => set({ lang: 'ar' })} lang="ar">العربية</button>
            <button type="button" className={ui.lang === 'en' ? 'on' : ''} onClick={() => set({ lang: 'en' })} lang="en">English</button>
          </div>
        </div>
        <form className="login-card" onSubmit={submit} noValidate>
          <h1 className="login-h">{T('تسجيل الدخول', 'Sign in')}</h1>
          <p className="login-sub">{T('أدخل بيانات حسابك للوصول إلى لوحة القيادة', 'Enter your account details to access the dashboard')}</p>
          <label className="login-l" htmlFor="login-user">{T('اسم المستخدم', 'Username')}</label>
          <input id="login-user" className="login-in ltr-in" autoComplete="username" autoCapitalize="off" spellCheck={false} autoFocus
            value={user} onChange={(e: { target: { value: string } }) => setUser(e.target.value)} />
          <label className="login-l" htmlFor="login-pw">{T('كلمة المرور', 'Password')}</label>
          <StarPassword id="login-pw" value={pw} onChange={setPw} />
          {err && <div className="login-err" role="alert">{err}</div>}
          <button type="submit" className="login-btn">{T('تسجيل الدخول', 'Sign in')}</button>
          <p className="login-note">{T('هذا النظام مخصص للمستخدمين المصرّح لهم فقط.', 'This system is for authorised users only.')}</p>
        </form>
        <footer className="login-foot">© 2026 {T('راصد · إكسبو 2030 الرياض', 'Rasid · Expo 2030 Riyadh')}</footer>
      </main>
    </div>
  );
}
