import { useEffect, useMemo, useRef, useState } from 'react';
import { useTheme } from './theme';
import { firebaseEnabled } from './firebase';
import AssetMatrixView from './views/AssetMatrixView';
import RouteOptimizerView from './views/RouteOptimizerView';
import OTPView from './views/OTPView';
import CoveredView from './views/CoveredView';
import FleetStatusView from './views/FleetStatusView';
import DriversView from './views/DriversView';
import RolesView from './views/RolesView';
import FinancialsView, { type FinPage } from './views/FinancialsView';
import { loadDrivers } from './data/driversStore';
import { loadFleet } from './data/fleetStore';
import { ROUTES } from './data/fleet';
import { canManageRoles } from './data/permStore';
import { onChange } from './data/bus';

/* Asset Matrix — the asset-side master dispatch. Standalone: it holds our own
   trucks, the USPS route data, scheduling, driver availability, and the route
   optimizer. It no longer bundles the Bravo (brokerage) board — Caleb maps the
   asset schedule into his live Bravo Matrix on his own system. This app is the
   single source for OUR asset data. */

const APP_VERSION = '0.5.0';

type Tab = 'matrix' | 'optimizer' | 'otp' | 'covered' | 'fleet' | 'drivers' | 'roles'
  | 'fin-cpm' | 'fin-customer' | 'fin-truck' | 'fin-miles';
const TABS: { key: Tab; label: string; managerOnly?: boolean }[] = [
  { key: 'matrix', label: '🗓 Asset Matrix' },
  { key: 'optimizer', label: '⚡ Route Optimizer' },
  { key: 'otp', label: '📊 OTP / OTD' },
  { key: 'covered', label: '✅ Routes Covered' },
  { key: 'fleet', label: '🚛 Fleet Status' },
  { key: 'drivers', label: '👤 Drivers' },
  { key: 'roles', label: '🔑 Roles', managerOnly: true },
];
/* Financials ▾ — a dropdown, not full-width tabs (per the nav-restructure spec) */
const FIN_ITEMS: { key: Tab; page: FinPage; label: string }[] = [
  { key: 'fin-cpm', page: 'cpm', label: 'Revenue / CPM' },
  { key: 'fin-customer', page: 'customer', label: 'Revenue by Customer' },
  { key: 'fin-truck', page: 'truck', label: 'Revenue by Truck / Team' },
  { key: 'fin-miles', page: 'miles', label: 'Driver Miles' },
];
const finPageOf = (t: Tab): FinPage | null => FIN_ITEMS.find((f) => f.key === t)?.page ?? null;

interface Hit { kind: 'driver' | 'team' | 'route'; label: string; sub: string; q: string; go: Tab }

export default function App() {
  const [tab, setTab] = useState<Tab>('matrix');
  const { theme, toggle } = useTheme();
  const [query, setQuery] = useState('');
  const [openResults, setOpenResults] = useState(false);
  const [finOpen, setFinOpen] = useState(false);
  const [seedDrivers, setSeedDrivers] = useState<{ q: string; nonce: number }>({ q: '', nonce: 0 });
  const [seedFleet, setSeedFleet] = useState<{ q: string; nonce: number }>({ q: '', nonce: 0 });
  const [, force] = useState(0);
  const searchRef = useRef<HTMLDivElement>(null);

  /* re-render on any store change so Roles-tab visibility + search data stay live */
  useEffect(() => onChange(() => force((n) => n + 1)), []);

  /* close the results dropdown on an outside click */
  useEffect(() => {
    function onDoc(e: MouseEvent) { if (searchRef.current && !searchRef.current.contains(e.target as Node)) setOpenResults(false); }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const showRoles = canManageRoles();
  const visibleTabs = TABS.filter((t) => !t.managerOnly || showRoles);
  /* if the current tab just became hidden (role changed), fall back to the matrix */
  useEffect(() => { if (tab === 'roles' && !showRoles) setTab('matrix'); }, [tab, showRoles]);

  /* ---- global search across drivers, teams, and routes ---- */
  const hits = useMemo<Hit[]>(() => {
    const n = query.trim().toLowerCase();
    if (n.length < 1) return [];
    const out: Hit[] = [];
    let c = 0;
    for (const d of loadDrivers()) {
      if (`${d.name} ${d.position} ${d.homeCity} ${d.constraints}`.toLowerCase().includes(n)) {
        out.push({ kind: 'driver', label: d.name, sub: [d.position, d.homeCity].filter(Boolean).join(' · '), q: d.name, go: 'drivers' });
        if (++c >= 6) break;
      }
    }
    c = 0;
    for (const t of loadFleet()) {
      if (`${t.tractor} ${t.driver1} ${t.driver2} ${t.homeCity} ${t.currentCity} ${t.type} ${t.constraints}`.toLowerCase().includes(n)) {
        out.push({ kind: 'team', label: `#${t.tractor}`, sub: [t.driver1, t.driver2].filter(Boolean).join(' · ') || t.type, q: t.tractor, go: 'fleet' });
        if (++c >= 6) break;
      }
    }
    c = 0;
    for (const r of ROUTES) {
      if (r.route.toLowerCase().includes(n)) {
        out.push({ kind: 'route', label: r.route, sub: [r.freq, r.miles ? `${r.miles} mi` : ''].filter(Boolean).join(' · '), q: r.route, go: 'matrix' });
        if (++c >= 6) break;
      }
    }
    return out;
  }, [query]);

  function pick(h: Hit) {
    if (h.go === 'drivers') setSeedDrivers({ q: h.q, nonce: Date.now() });
    if (h.go === 'fleet') setSeedFleet({ q: h.q, nonce: Date.now() });
    setTab(h.go);
    setQuery(''); setOpenResults(false);
  }

  const groups: { kind: Hit['kind']; title: string }[] = [
    { kind: 'driver', title: 'Drivers' }, { kind: 'team', title: 'Teams' }, { kind: 'route', title: 'Routes' },
  ];

  return (
    <div className="asset-shell">
      <header className="asset-topbar">
        <div className="asset-brand">
          <span className="asset-logo">GH</span>
          <div>
            <div className="asset-title">ASSET <b>MATRIX</b></div>
            <div className="asset-sub">Asset Ops Master Dispatch · v{APP_VERSION}</div>
          </div>
        </div>

        <div className="asset-search" ref={searchRef}>
          <span className="asset-search-icon">🔎</span>
          <input
            className="asset-search-input"
            placeholder="Search drivers, teams, routes…"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setOpenResults(true); }}
            onFocus={() => setOpenResults(true)}
            onKeyDown={(e) => { if (e.key === 'Enter' && hits[0]) pick(hits[0]); if (e.key === 'Escape') { setQuery(''); setOpenResults(false); } }}
          />
          {query && <button className="asset-search-clear" title="Clear" onClick={() => { setQuery(''); setOpenResults(false); }}>✕</button>}
          {openResults && query.trim() && (
            <div className="asset-search-results">
              {hits.length === 0 ? (
                <div className="asset-search-empty">No matches for “{query.trim()}”.</div>
              ) : groups.map((g) => {
                const rows = hits.filter((h) => h.kind === g.kind);
                if (!rows.length) return null;
                return (
                  <div key={g.kind} className="asset-search-group">
                    <div className="asset-search-grouphead">{g.title}</div>
                    {rows.map((h, i) => (
                      <button key={g.kind + i} className="asset-search-item" onMouseDown={(e) => { e.preventDefault(); pick(h); }}>
                        <span className="asset-search-item-label">{h.label}</span>
                        {h.sub && <span className="asset-search-item-sub">{h.sub}</span>}
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <nav className="asset-tabs">
          {visibleTabs.map((t) => (
            <button key={t.key} className={`asset-tab ${tab === t.key ? 'on' : ''}`} onClick={() => setTab(t.key)}>
              {t.label}
            </button>
          ))}
          <span className="asset-dropdown" onMouseLeave={() => setFinOpen(false)}>
            <button className={`asset-tab ${finPageOf(tab) ? 'on' : ''}`} onClick={() => setFinOpen((o) => !o)}>💰 Financials ▾</button>
            {finOpen && (
              <div className="asset-dropdown-menu">
                {FIN_ITEMS.map((f) => (
                  <button key={f.key} className={`asset-dropdown-item ${tab === f.key ? 'on' : ''}`} onClick={() => { setTab(f.key); setFinOpen(false); }}>{f.label}</button>
                ))}
              </div>
            )}
          </span>
        </nav>
        <div className="asset-right">
          <button className="asset-icon-btn" onClick={toggle} title="Toggle light / dark">{theme === 'dark' ? '☀' : '☾'}</button>
          {!firebaseEnabled && <span className="asset-demo">DEMO</span>}
        </div>
      </header>

      <main className="asset-main">
        {tab === 'matrix' && <AssetMatrixView />}
        {tab === 'optimizer' && <RouteOptimizerView />}
        {tab === 'otp' && <OTPView />}
        {tab === 'covered' && <CoveredView />}
        {tab === 'fleet' && <FleetStatusView seed={seedFleet} />}
        {tab === 'drivers' && <DriversView seed={seedDrivers} />}
        {tab === 'roles' && showRoles && <RolesView />}
        {finPageOf(tab) && <FinancialsView page={finPageOf(tab)!} />}
      </main>
    </div>
  );
}
