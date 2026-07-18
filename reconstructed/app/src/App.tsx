import { useEffect, useState } from 'react';
import { HashRouter, NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { ALLOWED_DOMAINS, auth, firebaseEnabled, isCompanyEmail, signInWithGoogle, signOut } from './firebase';
import { StoreProvider, useStore } from './data/store';
import { ThemeProvider } from './theme';
import { APP_VERSION, isAssetRep, onSalesHub } from './types';
import { addDays, bookingWindow, todayCentral } from './dates';
import { can } from './permissions';
import Logo from './components/Logo';
import TeamBadge from './components/TeamBadge';
import ActionCenter from './components/ActionCenter';
import SettingsMenu from './components/SettingsMenu';
import MatrixView from './views/MatrixView';
import SalesHubView from './views/SalesHubView';
import ImportView from './views/ImportView';
import AdminView from './views/AdminView';
import CapacityView from './views/CapacityView';
import TrackView from './views/TrackView';
import TrailersView from './views/TrailersView';
import AnalyticsView from './views/AnalyticsView';
import QAView from './views/QAView';
import IntegrityView from './views/IntegrityView';
import RateCheckView from './views/RateCheckView';
import LoadboardPage from './views/LoadboardPage';

function Shell() {
  const { demoMode, loads, carrierUsers, users, currentUser, permToast } = useStore();
  const windowDays = bookingWindow();
  const openNow = loads.filter((l) => windowDays.includes(l.date) && onSalesHub(l)).length;
  /* Phase 4 pending-admin bubble: aggregates EVERY admin-actionable item type
     (bookings awaiting clear, carrier registrations, new Base sign-ins awaiting
     clearance; Phase 6 fallout/chargeback approvals join the same count later). */
  /* Booking approvals live on the Sales Hub ONLY (Caleb, 07/09) — the Admin
     bubble counts just the items actioned on the Admin page itself. */
  const pendingAdmin = can(currentUser, 'admin')
    ? carrierUsers.filter((c) => c.status === 'pending').length +
      users.filter((u) => u.role === 'base').length +
      /* §7.4: chargebacks awaiting the admin absorb/confirm call */
      loads.filter((l) => l.chargebackClass === 'once_recovered' && (l.chargebackStatus ?? 'pending') === 'pending').length
    : 0;
  /* §9.1 QA alert — same red-badge pattern, routed to whoever verifies BOL
     (QA Manager / Owner). Recent-window scope matches the QA page. */
  /* Track & Trace badge: yesterday's confirmed trips still not marked
     Loaded/Departed — unambiguously overdue (the page itself also flags
     today's rows once their scheduled PU time passes). */
  const trackConfirmed = new Set(['covered', 'booked_rc_pending', 'rc_signed', 'gtg', 'need_flyer', 'flyer_sent', 'drivers_confirmed', 'dispatched', 'asset']);
  const overdueTrack = loads.filter(
    (l) => !!l.carrier && trackConfirmed.has(l.status) && l.date === addDays(todayCentral(), -1),
  ).length;
  const qaCutoff = addDays(todayCentral(), -7);
  const pendingQa = can(currentUser, 'qa.verify')
    ? loads.filter((l) => !!l.carrier && !l.bolVerified && l.date >= qaCutoff
        && !['not_running', 'chargeback'].includes(l.status)).length
    : 0;

  /* index.html ships the carrier-neutral title so "Bravo Matrix" never
     flashes on the loadboard host; the back office renames itself here. */
  useEffect(() => {
    document.title = 'Bravo Matrix';
  }, []);

  return (
    <div className="shell">
      <header className="topbar">
        {/* the brand IS the home button (Caleb 07/09) — clicking GH / BRAVO
            MATRIX goes to the Matrix; the Matrix tab is gone to save space */}
        <NavLink to="/matrix" className="brand-block" title="Home — Matrix">
          <Logo />
          <div className="brand">
            BRAVO <span>MATRIX</span>
            <sup className="version">v{APP_VERSION}</sup>
          </div>
        </NavLink>
        <nav>
          {can(currentUser, 'hub') && <NavLink to="/saleshub">
            Sales Hub {openNow > 0 && <span className="badge">{openNow}</span>}
          </NavLink>}
          {can(currentUser, 'integrity') ? (
            <NavLink to="/integrity">Integrity</NavLink>
          ) : can(currentUser, 'matrix.book') && !isAssetRep(currentUser.role) ? (
            /* brokers own carrier MC/DOT hygiene — they get JUST the Carriers tab */
            <NavLink to="/integrity?tab=carriers">Carriers</NavLink>
          ) : null}
          {can(currentUser, 'capacity') && <NavLink to="/capacity">Capacity</NavLink>}
          {can(currentUser, 'track') && <NavLink to="/track" title="Track & Trace">
            T&amp;T {overdueTrack > 0 && <span className="badge">{overdueTrack}</span>}
          </NavLink>}
          {can(currentUser, 'trailers') && <NavLink to="/trailers">Trailers</NavLink>}
          {can(currentUser, 'ratecheck') && <NavLink to="/ratecheck" title="Dispatcher go/no-go rate tool">Rate Check</NavLink>}
          {can(currentUser, 'analytics') && <NavLink to="/analytics">Analytics</NavLink>}
          {can(currentUser, 'qa') && (
            <NavLink to="/qa">
              QA {pendingQa > 0 && <span className="badge">{pendingQa}</span>}
            </NavLink>
          )}
          {can(currentUser, 'admin') && (
            <NavLink to="/admin">
              Admin {pendingAdmin > 0 && <span className="badge">{pendingAdmin}</span>}
            </NavLink>
          )}
          <a href="#/board" target="_blank" rel="noreferrer" title="Carrier-facing load board (share this link)">
            Loadboard ↗
          </a>
        </nav>
        <div className="topbar-gap"><TeamBadge /></div>
        <div className="topbar-right">
          <ActionCenter />
          {demoMode && (
            <span className="demo-badge" title="Running on bundled Alpha Matrix data. Connect Firebase to go live.">
              DEMO
            </span>
          )}
          {/* theme / palette / team / sign-out live behind ☰ (Caleb 07/10) */}
          <SettingsMenu />
        </div>
      </header>
      <Routes>
        <Route path="/matrix" element={<MatrixView />} />
        <Route path="/saleshub" element={<SalesHubView />} />
        <Route path="/integrity" element={can(currentUser, 'integrity') || (can(currentUser, 'matrix.book') && !isAssetRep(currentUser.role)) ? <IntegrityView /> : <Navigate to="/matrix" replace />} />
        <Route path="/capacity" element={<CapacityView />} />
        <Route path="/track" element={<TrackView />} />
        <Route path="/trailers" element={can(currentUser, 'trailers') ? <TrailersView /> : <Navigate to="/matrix" replace />} />
        <Route path="/dedicated" element={<Navigate to="/integrity?tab=dedicated" replace />} />
        <Route path="/ratecheck" element={can(currentUser, 'ratecheck') ? <RateCheckView /> : <Navigate to="/matrix" replace />} />
        <Route path="/analytics" element={can(currentUser, 'analytics') ? <AnalyticsView /> : <Navigate to="/matrix" replace />} />
        <Route path="/qa" element={<QAView />} />
        <Route path="/import" element={<ImportView />} />
        <Route path="/admin" element={<AdminView />} />
        <Route path="*" element={<Navigate to="/matrix" replace />} />
      </Routes>
      {/* v2.18.0 (Caleb): 5-second permission-denial toast for live troubleshooting */}
      {permToast && (
        <div className="perm-toast" role="alert">
          {'\u{1F6AB} Action denied due to permissions \u2014 '}{permToast}
        </div>
      )}
    </div>
  );
}

function SignIn() {
  const [error, setError] = useState('');
  return (
    <div className="signin">
      <div className="signin-card">
        <Logo />
        <div className="brand big">
          BRAVO <span>MATRIX</span>
        </div>
        <p>Freight coverage board for GH Logistics.</p>
        <button
          className="btn-primary"
          onClick={() => signInWithGoogle().catch((e) => setError(e.message))}
        >
          Sign in with Google
        </button>
        <p className="muted">Restricted to {ALLOWED_DOMAINS.map((d) => `@${d}`).join(' and ')} accounts.</p>
        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
}

function AccessDenied({ email }: { email: string }) {
  return (
    <div className="signin">
      <div className="signin-card">
        <Logo />
        <p className="error">
          {email} is not an approved account ({ALLOWED_DOMAINS.map((d) => `@${d}`).join(' / ')}) — the back office is restricted.
        </p>
        <p className="muted">Looking for available freight? Visit the carrier load board.</p>
        <a className="btn-primary" href="#/board">Open Load Board</a>
        <button className="btn-ghost" onClick={() => signOut()}>Sign out</button>
      </div>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(!firebaseEnabled);
  const [hash, setHash] = useState(window.location.hash);

  useEffect(() => {
    const onHash = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    if (!firebaseEnabled || !auth) return;
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthReady(true);
    });
  }, []);

  /* Carrier loadboard: public route, own sign-in, no back-office access.
     The dedicated ghl-loadboard.web.app hosting site serves the same build —
     on that hostname the board IS the app, whatever the hash says. */
  const boardHost = window.location.hostname.startsWith('ghl-loadboard.');
  if (boardHost || hash.startsWith('#/board')) {
    return (
      <ThemeProvider>
        <LoadboardPage />
      </ThemeProvider>
    );
  }

  if (!authReady) return <div className="signin">Loading…</div>;

  const companyUser = isCompanyEmail(user?.email ?? '');

  return (
    <ThemeProvider>
      {firebaseEnabled && !user ? (
        <SignIn />
      ) : firebaseEnabled && !companyUser ? (
        <AccessDenied email={user?.email ?? ''} />
      ) : (
        <StoreProvider>
          <HashRouter>
            <Shell />
          </HashRouter>
        </StoreProvider>
      )}
    </ThemeProvider>
  );
}
