import { createContext, useContext, useEffect, useMemo, useReducer, useRef, useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import { initialState } from '../model/fixtures';
import { reducer } from '../model/reducer';
import type { Action } from '../model/reducer';
import type { AppState, L, Lang, Role, Section } from '../model/types';
import { RELAYED_ACTIONS } from '../model/reducer';
import { PERSONAS } from '../services/permissions';
import type { Persona } from '../services/permissions';
import { ai } from '../services/ai';

// ---------------- data store ----------------
interface StoreCtx { s: AppState; dispatch: (a: Action) => void; reset: () => void }
const StoreContext = createContext<StoreCtx>(null as unknown as StoreCtx);

/**
 * Local simulation data source. It advances a simulated clock (starting at
 * 15:10:00 on the fixture day) and feeds TICK updates into the same reducer a
 * real-time backend adapter would feed.
 */
export function StoreProvider({ children }: { children: ReactNode }) {
  const [s, rawDispatch] = useReducer(reducer, initialState());
  const liveRef = useRef(false);
  liveRef.current = s.baseMode === 'live';
  useEffect(() => {
    ai.attach(rawDispatch);
    const id = setInterval(() => rawDispatch({ type: 'TICK', now: ai.now() }), 1000);
    return () => clearInterval(id);
  }, []);
  /**
   * Live mode: actions that change shared records are sent to the server journal and
   * applied when they come back, so every screen applies them in the same order.
   */
  const dispatch = useCallback((a: Action) => {
    if (liveRef.current && RELAYED_ACTIONS.has(a.type)) {
      void ai.relay(a).then((ok) => { if (!ok) window.dispatchEvent(new CustomEvent('rasid-relay-failed')); });
      return;
    }
    rawDispatch(a);
  }, []);
  const reset = useCallback(() => {
    if (liveRef.current) { void ai.resetShared(); return; }
    rawDispatch({ type: 'RESET', now: ai.now() });
  }, []);
  const value = useMemo(() => ({ s, dispatch, reset }), [s]);
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}
export const useStore = () => useContext(StoreContext);

/** Re-render on AI engine updates (live frames, local camera sources). */
export function useAi() {
  const [, setV] = useState(0);
  useEffect(() => ai.subscribe(() => setV(ai.version)), []);
  return ai;
}

// ---------------- UI / navigation state ----------------
export type RefKind = 'zone' | 'camera' | 'node' | 'sensor' | 'employee' | 'alert' | 'incident' | 'event';
export interface EntityRef { kind: RefKind; id: string }
export interface UIState {
  lang: Lang;
  role: Role;
  section: Section;
  scope: string; // 'ALL' | zone id
  drawer: EntityRef[];
  incidentTab: 'expo' | 'employee' | 'manual' | 'response';
  incidentId: string | null;
  employeeId: string | null;
  reportId: string | null;
  cameraId: string;
  iotTab: 'overview' | 'ot' | 'iot' | 'noc';
  cameraTab: 'cameras' | 'ai' | 'notify';
  sidebarCollapsed: boolean;
  mobileNav: boolean;
  map: { focus: EntityRef | null; nonce: number };
  mapModal: EntityRef | null;
  devOpen: boolean;
  /** header alerts popover (bell); also opened from the Active alerts KPI tile */
  alertsOpen: boolean;
  toast: { text: L; nonce: number } | null;
  printId: string | null;
}
interface UICtx {
  ui: UIState;
  set: (p: Partial<UIState>) => void;
  persona: Persona;
  T: (ar: string, en: string) => string;
  tl: (l: L | undefined) => string;
  openDrawer: (r: EntityRef) => void;
  closeDrawer: () => void;
  backDrawer: () => void;
  showOnMap: (r: EntityRef) => void;
  openIncident: (id: string, kind?: 'expo' | 'employee') => void;
  openReport: (id: string) => void;
  openEmployee: (id: string) => void;
  openCamera: (id: string) => void;
  go: (s: Section) => void;
  toast: (text: L) => void;
}
const UIContext = createContext<UICtx>(null as unknown as UICtx);

function readStored<T>(k: string, fallback: T): T {
  try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; }
}

export function UIProvider({ children }: { children: ReactNode }) {
  const [ui, setUi] = useState<UIState>(() => ({
    lang: readStored<Lang>('rasid.lang', 'ar'),
    role: readStored<Role>('rasid.role', 'operator'),
    section: 'dashboard', scope: 'A1.1', drawer: [], incidentTab: 'expo', incidentId: null, employeeId: null,
    reportId: null, cameraId: 'CAM-1', iotTab: 'overview', cameraTab: 'cameras', sidebarCollapsed: false, mobileNav: false,
    map: { focus: null, nonce: 0 }, mapModal: null,
    devOpen: typeof location !== 'undefined' && location.hash === '#dev', alertsOpen: false, toast: null, printId: null,
  }));
  const set = useCallback((p: Partial<UIState>) => setUi((u) => ({ ...u, ...p })), []);

  useEffect(() => {
    try { localStorage.setItem('rasid.lang', JSON.stringify(ui.lang)); localStorage.setItem('rasid.role', JSON.stringify(ui.role)); } catch { /* storage unavailable */ }
    document.documentElement.lang = ui.lang;
    document.documentElement.dir = ui.lang === 'ar' ? 'rtl' : 'ltr';
  }, [ui.lang, ui.role]);

  useEffect(() => {
    const offAlarm = ai.onAlarm((e) => setUi((u) => ({ ...u, toast: { text: { ar: `🚨 رصد جديد: ${e.incidentHint} — ${e.cameraId}`, en: `🚨 New AI detection: ${e.category} — ${e.cameraId}` }, nonce: (u.toast?.nonce ?? 0) + 1 } })));
    const onFail = () => setUi((u) => ({ ...u, toast: { text: { ar: 'تعذر الإرسال إلى خادم راصد — تحقق من الاتصال', en: 'Could not reach the Rasid server — check the connection' }, nonce: (u.toast?.nonce ?? 0) + 1 } }));
    const unlock = () => ai.unlockAudio();
    window.addEventListener('rasid-relay-failed', onFail);
    window.addEventListener('pointerdown', unlock, { once: true });
    return () => { offAlarm(); window.removeEventListener('rasid-relay-failed', onFail); window.removeEventListener('pointerdown', unlock); };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && e.shiftKey && (e.key === 'D' || e.key === 'd' || e.code === 'KeyD')) { e.preventDefault(); setUi((u) => ({ ...u, devOpen: !u.devOpen })); }
      if (e.key === 'Escape') setUi((u) => (u.mapModal ? { ...u, mapModal: null } : u.drawer.length ? { ...u, drawer: [] } : u));
    };
    const onHash = () => { if (location.hash === '#dev') setUi((u) => ({ ...u, devOpen: true })); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('hashchange', onHash);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('hashchange', onHash); };
  }, []);

  const value = useMemo<UICtx>(() => {
    const T = (ar: string, en: string) => (ui.lang === 'ar' ? ar : en);
    return {
      ui, set, persona: PERSONAS[ui.role], T,
      tl: (l) => (l ? l[ui.lang] : ''),
      openDrawer: (r) => setUi((u) => {
        const top = u.drawer[u.drawer.length - 1];
        if (top && top.kind === r.kind && top.id === r.id) return u;
        return { ...u, drawer: [...u.drawer, r].slice(-6), mobileNav: false };
      }),
      closeDrawer: () => set({ drawer: [] }),
      backDrawer: () => setUi((u) => ({ ...u, drawer: u.drawer.slice(0, -1) })),
      showOnMap: (r) => setUi((u) => ({ ...u, mapModal: r, map: { focus: r, nonce: u.map.nonce + 1 } })),
      openIncident: (id, kind) => setUi((u) => ({
        ...u, section: 'incidents', incidentId: id, incidentTab: kind === 'employee' || id.startsWith('EI-') ? 'employee' : 'expo',
        drawer: [], mapModal: null, mobileNav: false,
      })),
      openReport: (id) => setUi((u) => ({ ...u, section: 'reports', reportId: id, drawer: [], mapModal: null, mobileNav: false })),
      openEmployee: (id) => setUi((u) => ({ ...u, section: 'employees', employeeId: id, drawer: [], mapModal: null, mobileNav: false })),
      openCamera: (id) => setUi((u) => ({ ...u, section: 'cameras', cameraId: id, drawer: [], mapModal: null, mobileNav: false })),
      go: (section) => setUi((u) => ({ ...u, section, drawer: [], mobileNav: false })),
      toast: (text) => setUi((u) => ({ ...u, toast: { text, nonce: (u.toast?.nonce ?? 0) + 1 } })),
    };
  }, [ui, set]);
  return <UIContext.Provider value={value}>{children}</UIContext.Provider>;
}
export const useUI = () => useContext(UIContext);
