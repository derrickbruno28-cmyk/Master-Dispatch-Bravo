import { useState } from 'react';
import { useTheme } from './theme';
import { firebaseEnabled } from './firebase';
import AssetMatrixView from './views/AssetMatrixView';
import RouteOptimizerView from './views/RouteOptimizerView';
import OTPView from './views/OTPView';
import CoveredView from './views/CoveredView';
import FleetStatusView from './views/FleetStatusView';
import DriversView from './views/DriversView';

/* Asset Matrix — the asset-side master dispatch. Standalone: it holds our own
   trucks, the USPS route data, scheduling, driver availability, and the route
   optimizer. It no longer bundles the Bravo (brokerage) board — Caleb maps the
   asset schedule into his live Bravo Matrix on his own system. This app is the
   single source for OUR asset data, exportable as one self-contained HTML file. */

const APP_VERSION = '0.4.0';

type Tab = 'matrix' | 'optimizer' | 'otp' | 'covered' | 'fleet' | 'drivers';
const TABS: { key: Tab; label: string }[] = [
  { key: 'matrix', label: '🗓 Asset Matrix' },
  { key: 'optimizer', label: '⚡ Route Optimizer' },
  { key: 'otp', label: '📊 OTP / OTD' },
  { key: 'covered', label: '✅ Routes Covered' },
  { key: 'fleet', label: '🚛 Fleet Status' },
  { key: 'drivers', label: '👤 Drivers' },
];

export default function App() {
  const [tab, setTab] = useState<Tab>('matrix');
  const { theme, toggle } = useTheme();

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
        <nav className="asset-tabs">
          {TABS.map((t) => (
            <button key={t.key} className={`asset-tab ${tab === t.key ? 'on' : ''}`} onClick={() => setTab(t.key)}>
              {t.label}
            </button>
          ))}
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
        {tab === 'fleet' && <FleetStatusView />}
        {tab === 'drivers' && <DriversView />}
      </main>
    </div>
  );
}
