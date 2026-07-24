import { useEffect, useRef, useState } from 'react';
import { useTheme } from './theme';
import { firebaseEnabled } from './firebase';
import AssetMatrixView from './views/AssetMatrixView';
import RouteOptimizerView from './views/RouteOptimizerView';
import OTPView from './views/OTPView';
import CoveredView from './views/CoveredView';
import FleetStatusView from './views/FleetStatusView';
import FleetMapView from './views/FleetMapView';
import OutOfServiceView from './views/OutOfServiceView';
import DriversView from './views/DriversView';
import RolesView from './views/RolesView';
import SettingsView from './views/SettingsView';
import FinancialsView, { type FinPage } from './views/FinancialsView';
import { loadDrivers } from './data/driversStore';
import { loadFleet } from './data/fleetStore';
import { ROUTES } from './data/fleet';
import { canManageRoles } from './data/permStore';
import { onChange } from './data/bus';
import { watchForUpdate } from './data/versionCheck';

/* Asset Matrix — the asset-side master dispatch. Standalone: it holds our own
   trucks, the USPS route data, scheduling, driver availability, and the route
   optimizer. Navigation lives in a collapsible left side panel; the top bar is
   kept minimal, and driver / team / route look-ups are separate filters below
   the header (not one catch-all search box). */

const APP_VERSION = '0.13.2';

type Tab = 'matrix' | 'optimizer' | 'otp' | 'covered' | 'fleet' | 'fleet-map' | 'fleet-oos' | 'drivers' | 'roles'
  | 'fin-cpm' | 'fin-customer' | 'fin-truck' | 'fin-miles' | 'integrations';

interface NavItem { key: Tab; label: string; managerOnly?: boolean }
const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
  { title: 'Dispatch', items: [
    { key: 'matrix', label: '🗓 Asset Matrix' },
    { key: 'optimizer', label: '⚡ Route Optimizer' },
    { key: 'otp', label: '📊 OTP / OTD' },
    { key: 'covered', label: '✅ Routes Covered' },
  ] },
  { title: 'People', items: [
    { key: 'drivers', label: '👤 Driver Availability' },
    { key: 'roles', label: '🔑 Roles', managerOnly: true },
  ] },
  { title: 'Fleet', items: [
    { key: 'fleet', label: '🚛 Fleet Status' },
    { key: 'fleet-map', label: '🗺 Fleet Map' },
    { key: 'fleet-oos', label: '🛠 Out of Service' },
  ] },
  { title: 'Financials', items: [
    { key: 'fin-cpm', label: '💰 Revenue / CPM' },
    { key: 'fin-customer', label: '🏷 By Customer' },
    { key: 'fin-truck', label: '🚚 By Truck / Team' },
    { key: 'fin-miles', label: '🛣 Driver Miles' },
  ] },
  { title: 'Setup', items: [
    { key: 'integrations', label: '🔌 Integrations' },
  ] },
];
const FIN_PAGE: Partial<Record<Tab, FinPage>> = { 'fin-cpm': 'cpm', 'fin-customer': 'customer', 'fin-truck': 'truck', 'fin-miles': 'miles' };
const finPageOf = (t: Tab): FinPage | null => FIN_PAGE[t] ?? null;

interface Hit { key: string; label: string; sub: string }

/* one labelled look-up field with its own results dropdown (drivers / teams /
   routes each get their own, instead of a single universal search box) */
function LookupField({ icon, label, placeholder, hits, onPick }: {
  icon: string; label: string; placeholder: string;
  hits: (q: string) => Hit[]; onPick: (h: Hit) => void;
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const d = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', d);
    return () => document.removeEventListener('mousedown', d);
  }, []);
  const results = q.trim() ? hits(q.trim().toLowerCase()).slice(0, 8) : [];
  const choose = (h: Hit) => { onPick(h); setQ(''); setOpen(false); };
  return (
    <div className="lookup-field" ref={ref}>
      <span className="lookup-cap">{icon} {label}</span>
      <div className="lookup-inputwrap">
        <input
          className="lookup-input" placeholder={placeholder} value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => { if (e.key === 'Enter' && results[0]) choose(results[0]); if (e.key === 'Escape') { setQ(''); setOpen(false); } }}
        />
        {q && <button className="lookup-clear" title="Clear" onClick={() => { setQ(''); setOpen(false); }}>✕</button>}
        {open && q.trim() && (
          <div className="lookup-menu">
            {results.length === 0
              ? <div className="lookup-empty">No {label.toLowerCase()} matches “{q.trim()}”.</div>
              : results.map((h, i) => (
                <button key={i} className="lookup-item" onMouseDown={(e) => { e.preventDefault(); choose(h); }}>
                  <span className="lookup-item-label">{h.label}</span>
                  {h.sub && <span className="lookup-item-sub">{h.sub}</span>}
                </button>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState<Tab>('matrix');
  const { theme, toggle } = useTheme();
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(() => (typeof window !== 'undefined' ? window.innerWidth > 820 : true));
  const [seedDrivers, setSeedDrivers] = useState<{ q: string; nonce: number }>({ q: '', nonce: 0 });
  const [seedFleet, setSeedFleet] = useState<{ q: string; nonce: number }>({ q: '', nonce: 0 });
  const [, force] = useState(0);
  const [updateReady, setUpdateReady] = useState(false);

  /* re-render on any store change so Roles-tab visibility + look-up data stay live */
  useEffect(() => onChange(() => force((n) => n + 1)), []);

  /* watch for a newer deploy → prompt a one-tap refresh (no more stale versions) */
  useEffect(() => watchForUpdate(() => setUpdateReady(true)), []);

  /* collapse the drawer when the window shrinks to mobile so it doesn't sit open over content */
  useEffect(() => {
    const onResize = () => { if (window.innerWidth <= 820) setSidebarOpen(false); };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const showRoles = canManageRoles();
  /* if the current tab just became hidden (role changed), fall back to the matrix */
  useEffect(() => { if (tab === 'roles' && !showRoles) setTab('matrix'); }, [tab, showRoles]);

  const onMobile = () => typeof window !== 'undefined' && window.innerWidth <= 820;
  function go(t: Tab) { setTab(t); if (onMobile()) setSidebarOpen(false); }

  /* ---- separate look-ups: drivers, teams, routes ---- */
  function driverHits(n: string): Hit[] {
    const out: Hit[] = [];
    for (const d of loadDrivers()) {
      if (`${d.name} ${d.position} ${d.homeCity} ${d.constraints}`.toLowerCase().includes(n)) {
        out.push({ key: d.name, label: d.name, sub: [d.position, d.homeCity].filter(Boolean).join(' · ') });
        if (out.length >= 8) break;
      }
    }
    return out;
  }
  function teamHits(n: string): Hit[] {
    const out: Hit[] = [];
    for (const t of loadFleet()) {
      if (`${t.tractor} ${t.driver1} ${t.driver2} ${t.homeCity} ${t.currentCity} ${t.type} ${t.constraints}`.toLowerCase().includes(n)) {
        out.push({ key: t.tractor, label: `#${t.tractor}`, sub: [t.driver1, t.driver2].filter(Boolean).join(' · ') || t.type });
        if (out.length >= 8) break;
      }
    }
    return out;
  }
  function routeHits(n: string): Hit[] {
    const out: Hit[] = [];
    for (const r of ROUTES) {
      if (r.route.toLowerCase().includes(n)) {
        out.push({ key: r.route, label: r.route, sub: [r.freq, r.miles ? `${r.miles} mi` : ''].filter(Boolean).join(' · ') });
        if (out.length >= 8) break;
      }
    }
    return out;
  }
  function pickDriver(h: Hit) { setSeedDrivers({ q: h.key, nonce: Date.now() }); go('drivers'); }
  function pickTeam(h: Hit) { setSeedFleet({ q: h.key, nonce: Date.now() }); go('fleet'); }
  function pickRoute(_h: Hit) { go('matrix'); }

  return (
    <div className={`asset-shell ${sidebarOpen ? 'sb-open' : ''}`}>
      {updateReady && (
        <div className="asset-update-bar" role="alert">
          <span>🔄 A newer version of Asset Matrix is available.</span>
          <button className="asset-update-btn" onClick={() => window.location.reload()}>Refresh now</button>
          <button className="asset-update-x" title="Dismiss" onClick={() => setUpdateReady(false)}>✕</button>
        </div>
      )}
      <header className="asset-topbar">
        <button className="asset-menu" onClick={() => setSidebarOpen((o) => !o)} title={sidebarOpen ? 'Hide menu' : 'Show menu'} aria-label="Toggle navigation">☰</button>
        <div className="asset-brand">
          <span className="asset-logo">GH</span>
          <div>
            <div className="asset-title">ASSET <b>MATRIX</b></div>
            <div className="asset-sub">Asset Ops Master Dispatch · v{APP_VERSION}</div>
          </div>
        </div>
        <div className="asset-right">
          <button className="asset-icon-btn" onClick={toggle} title="Toggle light / dark">{theme === 'dark' ? '☀' : '☾'}</button>
          {!firebaseEnabled && <span className="asset-demo">DEMO</span>}
        </div>
      </header>

      {/* separate look-up filters (below the header, not a universal search bar) */}
      <div className="asset-lookups">
        <span className="lookups-title">Look up</span>
        <LookupField icon="👤" label="Driver" placeholder="driver name…" hits={driverHits} onPick={pickDriver} />
        <LookupField icon="🚛" label="Team" placeholder="truck # or driver…" hits={teamHits} onPick={pickTeam} />
        <LookupField icon="🛣" label="Route" placeholder="route / trip…" hits={routeHits} onPick={pickRoute} />
      </div>

      <div className="asset-body">
        <aside className="asset-sidebar">
          <nav className="asset-nav">
            {NAV_GROUPS.map((g) => {
              const items = g.items.filter((it) => !it.managerOnly || showRoles);
              if (!items.length) return null;
              return (
                <div key={g.title} className="nav-group">
                  <div className="nav-group-title">{g.title}</div>
                  {items.map((it) => (
                    <button key={it.key} className={`nav-item ${tab === it.key ? 'on' : ''}`} onClick={() => go(it.key)}>{it.label}</button>
                  ))}
                </div>
              );
            })}
          </nav>
        </aside>
        <div className="asset-scrim" onClick={() => setSidebarOpen(false)} />

        <main className="asset-main">
          {tab === 'matrix' && <AssetMatrixView />}
          {tab === 'optimizer' && <RouteOptimizerView />}
          {tab === 'otp' && <OTPView />}
          {tab === 'covered' && <CoveredView />}
          {tab === 'fleet' && <FleetStatusView seed={seedFleet} />}
          {tab === 'fleet-map' && <FleetMapView />}
          {tab === 'fleet-oos' && <OutOfServiceView />}
          {tab === 'drivers' && <DriversView seed={seedDrivers} />}
          {tab === 'roles' && showRoles && <RolesView />}
          {tab === 'integrations' && <SettingsView />}
          {finPageOf(tab) && <FinancialsView page={finPageOf(tab)!} />}
        </main>
      </div>
    </div>
  );
}
