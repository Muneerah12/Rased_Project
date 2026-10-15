import { useEffect, useMemo, useState } from 'react';
import rasidLogo from '../assets/rasid-logo.png';
import { signOut } from '../services/auth';
import logoAr from '../assets/expo-logo-ar.png';
import logoEn from '../assets/expo-logo-en.png';
import { useStore, useUI } from '../state/store';
import type { EntityRef } from '../state/store';
import { alertStatus, visibleAlerts } from '../model/selectors';
import { fmtAgo, fmtTime } from '../model/config';
import { ROLES, SECTIONS } from '../model/types';
import type { Section } from '../model/types';
import { canSee } from '../services/permissions';
import { LABELS } from './labels';
import { Icon } from './icons';
import type { IconName } from './icons';
import { Ltr } from './primitives';
import { AlertsList } from './panels';

const SECTION_ICON: Record<Section, IconName> = { dashboard: 'dashboard', cameras: 'cameras', incidents: 'incidents', employees: 'employees', iot: 'iot', reports: 'reports' };

export function Sidebar() {
  const { ui, set, go, T, tl, persona } = useUI();
  const { s } = useStore();
  const activeAlerts = visibleAlerts(s, ui.role, persona.userId).filter((a) => alertStatus(s, a) === 'active').length;
  return (
    <nav className={`side${ui.sidebarCollapsed ? ' collapsed' : ''}${ui.mobileNav ? ' open' : ''}`} aria-label={T('الأقسام الرئيسية', 'Primary sections')}>
      <ul>
        {SECTIONS.map((sec) => {
          const ok = canSee(ui.role, sec);
          return (
            <li key={sec}>
              <button type="button" className={`nav${ui.section === sec ? ' on' : ''}${ok ? '' : ' locked'}`} onClick={() => go(sec)}
                aria-current={ui.section === sec ? 'page' : undefined} title={tl(LABELS.section[sec])}>
                <Icon name={SECTION_ICON[sec]} size={20} />
                <span className="nav-l">{tl(LABELS.section[sec])}</span>
                {!ok && <Icon name="lock" size={14} className="nav-lock" />}
                {sec === 'dashboard' && activeAlerts > 0 && ok && <span className="nav-n"><Ltr>{activeAlerts}</Ltr></span>}
              </button>
            </li>
          );
        })}
      </ul>
      <button type="button" className="nav collapse-btn" onClick={() => set({ sidebarCollapsed: !ui.sidebarCollapsed })} aria-pressed={ui.sidebarCollapsed}>
        <Icon name="collapse" size={20} /><span className="nav-l">{ui.sidebarCollapsed ? T('توسيع القائمة', 'Expand menu') : T('طي القائمة', 'Collapse menu')}</span>
      </button>
    </nav>
  );
}

function GlobalSearch() {
  const { s } = useStore();
  const { T, tl, openDrawer, ui } = useUI();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const results = useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (qq.length < 2) return [] as { r: EntityRef; label: string; sub: string }[];
    const out: { r: EntityRef; label: string; sub: string }[] = [];
    const m = (x: string) => x.toLowerCase().includes(qq);
    s.incidents.forEach((i) => { if (m(i.id) || m(tl(LABELS.category[i.category]))) out.push({ r: { kind: 'incident', id: i.id }, label: i.id, sub: tl(LABELS.category[i.category]) }); });
    s.alerts.forEach((a) => { if (m(a.id)) out.push({ r: { kind: 'alert', id: a.id }, label: a.id, sub: T('تنبيه', 'Alert') }); });
    s.employees.forEach((e) => { if (m(e.id) || m(e.name.ar) || m(e.name.en) || m(e.badgeId)) out.push({ r: { kind: 'employee', id: e.id }, label: e.id, sub: tl(e.name) }); });
    s.cameras.forEach((c) => { if (m(c.id)) out.push({ r: { kind: 'camera', id: c.id }, label: c.id, sub: tl(c.label) }); });
    s.nodes.forEach((n) => { if (m(n.id) || n.aliases.some(m)) out.push({ r: { kind: 'node', id: n.id }, label: n.id, sub: n.aliases.join(', ') }); });
    s.sensors.forEach((x) => { if (m(x.id)) out.push({ r: { kind: 'sensor', id: x.id }, label: x.id, sub: 'BME280' }); });
    s.zones.forEach((z) => { if (m(z.id) || m(tl(z.name))) out.push({ r: { kind: 'zone', id: z.id }, label: z.id, sub: tl(z.name) }); });
    return out.slice(0, 10);
  }, [q, s, ui.lang]);
  const pick = (r: EntityRef) => { openDrawer(r); setQ(''); setOpen(false); };
  return (
    <div className="gsearch">
      <Icon name="search" size={16} />
      <input value={q} onChange={(e: { target: { value: string } }) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={T('بحث: حادثة، موظف، جهاز، منطقة', 'Search incidents, staff, devices, zones')} aria-label={T('بحث عام', 'Global search')}
        onKeyDown={(e: KeyboardEvent) => { if (e.key === 'Enter' && results[0]) pick(results[0].r); }} />
      {open && q.trim().length >= 2 && (
        <ul className="gresults" role="listbox">
          {results.length ? results.map((r) => (
            <li key={`${r.r.kind}-${r.r.id}`}><button type="button" onMouseDown={(e: { preventDefault(): void }) => e.preventDefault()} onClick={() => pick(r.r)}><Ltr>{r.label}</Ltr><span className="muted">{r.sub}</span></button></li>
          )) : <li className="muted pad">{T('لا توجد نتائج', 'No results')}</li>}
        </ul>
      )}
    </div>
  );
}

function ConnectionChip() {
  const { s } = useStore();
  const { T, ui } = useUI();
  const mode = s.connection;
  const aiTxt = s.ai.mode === 'lite' ? 'OpenCV' : 'YOLO';
  const label = mode === 'live' ? T(`متصل · ذكاء اصطناعي ${aiTxt}`, `Live · AI ${aiTxt}`) : mode === 'reconnecting' ? T('إعادة الاتصال بالخادم…', 'Reconnecting to server…') : T('بيانات محاكاة', 'Simulated data');
  const title = mode === 'live'
    ? T('متصل بخادم راصد: الكاميرات والحوادث مباشرة ومشتركة بين كل الشاشات. حساسات إنترنت الأشياء والموظفون والطائرة ما زالت بيانات تجريبية.', 'Connected to the Rasid server: cameras and incidents are live and shared by every screen. IoT sensors, staff and drone remain sample data.')
    : T('لا يوجد خادم مباشر متصل؛ البيانات من محاكاة محلية.', 'No live backend is connected; data comes from a local simulation.');
  return (
    <div className={`conn c-${mode}`} role="status" title={title}>
      <span className="conn-dot" aria-hidden="true" />
      <span className="conn-l">{label}</span>
      <span className="conn-t">{T('آخر تحديث', 'updated')} {fmtAgo(s.now, s.lastUpdate, ui.lang)}</span>
    </div>
  );
}

export function TopBar() {
  const { s } = useStore();
  const { ui, set, T, tl, persona } = useUI();
  const bell = ui.alertsOpen;
  const setBell = (v: boolean) => set({ alertsOpen: v });
  const active = visibleAlerts(s, ui.role, persona.userId).filter((a) => alertStatus(s, a) === 'active').length;
  const scopes = [{ id: 'A1.1', l: 'A1.1' }, { id: 'A1', l: T('الإنسانية', 'Humanity') }, { id: 'D2', l: T('الثقافة', 'Culture') }, { id: 'D3', l: T('الأرض', 'Earth') }, { id: 'D4', l: T('التقنيات', 'Technologies') }, { id: 'D5', l: T('التعاون', 'Cooperation') }, { id: 'ALL', l: T('كامل الموقع', 'Site-wide') }];
  useEffect(() => { if (!canSee(ui.role, ui.section)) set({ section: 'dashboard' }); }, [ui.role]);
  return (
    <header className="top">
      <button type="button" className="ibtn menu-btn" onClick={() => set({ mobileNav: !ui.mobileNav })} aria-label={T('القائمة', 'Menu')} aria-expanded={ui.mobileNav}><Icon name="menu" /></button>
      <div className="brand">
        <img className="rasid-logo" src={rasidLogo} alt={T('شعار راصد', 'Rasid logo')} />
        <span className="brand-sep" aria-hidden="true" />
        <img className="expo-logo" src={ui.lang === 'ar' ? logoAr : logoEn} alt={T('شعار إكسبو 2030 الرياض', 'Expo 2030 Riyadh logo')} />
      </div>
      <div className="where">
        <span className="where-sec">{tl(LABELS.section[ui.section])}</span>
        <label className="scope">
          <span className="sr">{T('نطاق المنطقة', 'Zone scope')}</span>
          <Icon name="pin" size={14} />
          <select value={ui.scope} onChange={(e: { target: { value: string } }) => set({ scope: e.target.value })}>
            {scopes.map((o) => <option key={o.id} value={o.id}>{o.l}</option>)}
          </select>
        </label>
      </div>
      <GlobalSearch />
      <div className="top-r">
        <ConnectionChip />
        <div className="bell-wrap">
          <button type="button" className={`ibtn bell${active ? ' has' : ''}`} onClick={() => setBell(!bell)} aria-expanded={bell} aria-label={T(`التنبيهات النشطة: ${active}`, `Active alerts: ${active}`)}>
            <Icon name="bell" />{active > 0 && <span className="bell-n"><Ltr>{active}</Ltr></span>}
          </button>
          {bell && (
            <div className="pop bell-pop" onClick={() => setBell(false)}>
              <div className="pop-h">{T('التنبيهات', 'Alerts')} · <span className="muted">{ui.scope === 'ALL' ? T('كامل الموقع', 'Site-wide') : <Ltr>{ui.scope}</Ltr>}</span></div>
              <AlertsList limit={7} />
            </div>
          )}
        </div>
        <div className="lang" role="group" aria-label={T('اللغة', 'Language')}>
          <button type="button" className={ui.lang === 'ar' ? 'on' : ''} onClick={() => set({ lang: 'ar' })} lang="ar">ع</button>
          <button type="button" className={ui.lang === 'en' ? 'on' : ''} onClick={() => set({ lang: 'en' })} lang="en">EN</button>
        </div>
        <div className="who">
          <span className="who-n">{tl(persona.name)} <span className="muted"><Ltr>{persona.userId}</Ltr></span></span>
          <label className="role-sel">
            <span className="role-tag">{T('معاينة الدور', 'Role preview')}</span>
            <select value={ui.role} onChange={(e: { target: { value: string } }) => set({ role: e.target.value as typeof ui.role, drawer: [], section: 'dashboard', mobileNav: false })}
              aria-label={T('معاينة الدور (ليست تسجيل دخول)', 'Role preview (not sign-in)')}>
              {ROLES.map((r) => <option key={r} value={r}>{tl(LABELS.role[r])}</option>)}
            </select>
          </label>
          <button type="button" className="logout-btn" onClick={() => { signOut(); window.location.reload(); }}>{T('تسجيل الخروج', 'Sign out')}</button>
        </div>
      </div>
      {s.connection === 'reconnecting' && (
        <div className="banner" role="alert">{T(`انقطع الاتصال بخدمة المراقبة. يتم عرض آخر بيانات مستلمة (${fmtTime(s.lastUpdate)}) وقد تكون قديمة.`, `Monitoring connection lost. Showing the last received data (${fmtTime(s.lastUpdate)}); it may be stale.`)}</div>
      )}
    </header>
  );
}

export function DevPanel() {
  const { s, dispatch, reset } = useStore();
  const { ui, set, T } = useUI();
  if (!ui.devOpen) return null;
  return (
    <aside className="dev" aria-label={T('سيناريوهات المطور', 'Developer scenarios')}>
      <header><strong>{T('سيناريوهات المطور', 'Developer scenarios')}</strong><button type="button" className="ibtn" onClick={() => set({ devOpen: false })} aria-label={T('إغلاق', 'Close')}><Icon name="close" size={16} /></button></header>
      <p className="fine">{T('أدوات اختبار للنموذج الأولي (Alt+Shift+D). ليست جزءاً من الواجهة التشغيلية.', 'Prototype test tools (Alt+Shift+D). Not part of the operational UI.')}</p>
      {s.baseMode !== 'live' && <button type="button" onClick={() => dispatch({ type: 'SCENARIO', kind: 'crowd_surge' })}>{T('ارتفاع الحشود على كاميرا 1 (158/150)', 'Crowd surge on Camera 1 (158/150)')}</button>}
      <button type="button" onClick={() => dispatch({ type: 'SCENARIO', kind: 'node_stop' })}>{T('إيقاف نبضات NODE-A1-04', 'Stop NODE-A1-04 heartbeat')}</button>
      <button type="button" onClick={() => dispatch({ type: 'SCENARIO', kind: 'node_restore' })}>{T('استعادة نبضات NODE-A1-04', 'Restore NODE-A1-04 heartbeat')}</button>
      {s.baseMode !== 'live' && (s.connection !== 'reconnecting'
        ? <button type="button" onClick={() => dispatch({ type: 'SCENARIO', kind: 'connection_loss' })}>{T('محاكاة انقطاع المراقبة', 'Simulate monitoring disconnect')}</button>
        : <button type="button" onClick={() => dispatch({ type: 'SCENARIO', kind: 'connection_restore' })}>{T('استعادة الاتصال', 'Restore connection')}</button>)}
      <button type="button" onClick={() => { if (s.baseMode !== 'live' || confirm(T('سيُمسح سجل الحوادث المشترك على الخادم لكل الشاشات. متابعة؟', 'This clears the shared incident journal on the server for every screen. Continue?'))) reset(); }}>
        {s.baseMode === 'live' ? T('مسح السجل المشترك والبدء من جديد', 'Clear the shared journal and start over') : T('إعادة ضبط البيانات التجريبية', 'Reset fixtures')}
      </button>
    </aside>
  );
}

export function Toast() {
  const { ui, set, tl } = useUI();
  useEffect(() => {
    if (!ui.toast) return;
    const t = setTimeout(() => set({ toast: null }), 2600);
    return () => clearTimeout(t);
  }, [ui.toast?.nonce]);
  if (!ui.toast) return null;
  return <div className="toast" role="status">{tl(ui.toast.text)}</div>;
}
