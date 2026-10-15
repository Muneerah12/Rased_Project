import { createRoot } from 'react-dom/client';
import './styles.css';
import { setTimeBase } from './model/config';
import { routeApiFetches } from './services/apiBase';
import { serveDemoCps } from './services/demoCps';

// Sample records are anchored to page-load time until the shared server state arrives.
setTimeBase(Date.now());
routeApiFetches();
serveDemoCps(); // outermost, so it sees the relative /api paths
import { StoreProvider, UIProvider, useUI } from './state/store';
import { canSee } from './services/permissions';
import { DevPanel, Sidebar, Toast, TopBar } from './ui/shell';
import { Drawer, MapModal } from './ui/drawers';
import { Restricted } from './ui/primitives';
import { Dashboard } from './pages/Dashboard';
import { Cameras } from './pages/Cameras';
import { Incidents } from './pages/Incidents';
import { Employees } from './pages/Employees';
import { CpsWorkspace } from './cps-workspace/CpsWorkspace';
import { PrintRoot, Reports } from './pages/Reports';
import { Login } from './ui/Login';
import { isSignedIn } from './services/auth';
import { useState } from 'react';

function Page() {
  const { ui } = useUI();
  if (!canSee(ui.role, ui.section)) return <div className="page"><Restricted /></div>;
  switch (ui.section) {
    case 'dashboard': return <Dashboard />;
    case 'cameras': return <Cameras />;
    case 'incidents': return <Incidents />;
    case 'employees': return <Employees />;
    case 'iot': return <CpsWorkspace />;
    case 'reports': return <Reports />;
  }
}

function App() {
  const { ui, set } = useUI();
  const [signedIn, setSignedIn] = useState(isSignedIn);
  if (!signedIn) return <Login onSignedIn={() => setSignedIn(true)} />;
  return (
    <>
    <PrintRoot />
    <div className={`app role-${ui.role}${ui.sidebarCollapsed ? ' side-c' : ''}`} dir={ui.lang === 'ar' ? 'rtl' : 'ltr'} lang={ui.lang}>
      <a className="skip" href="#main">{ui.lang === 'ar' ? 'انتقل إلى المحتوى' : 'Skip to content'}</a>
      <TopBar />
      <Sidebar />
      {ui.mobileNav && <div className="scrim nav-scrim" onClick={() => set({ mobileNav: false })} aria-hidden="true" />}
      <main id="main" className="main" tabIndex={-1}><Page /></main>
      <Drawer />
      <MapModal />
      <DevPanel />
      <Toast />
    </div>
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StoreProvider>
    <UIProvider>
      <App />
    </UIProvider>
  </StoreProvider>,
);
