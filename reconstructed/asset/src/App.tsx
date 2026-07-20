import { useState } from 'react';
import { useTheme } from './theme';
import { firebaseEnabled } from './firebase';
import AssetMatrixView from './views/AssetMatrixView';
import RouteOptimizerView from './views/RouteOptimizerView';
import OTPView from './views/OTPView';
import CoveredView from './views/CoveredView';
import FleetStatusView from './views/FleetStatusView';
import DriversView from './views/DriversView';
import BravoBoardView from './views/BravoBoardView';

/* Asset Matrix — asset-side sibling of Bravo Matrix. A top-level ⇄ switch flips
   between the two boards (both share one schedule store, so assignments coincide).
   Bravo-only surfaces (Sales Hub, Route Matrix, Dedicated) are deliberately absent. */

const APP_VERSION = '0.3.0';

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
  const [mode, setMode] = useState<'asset' | 'bravo'>('asset');
  const [tab, setTab] = useState<Tab>('matrix');
  const { theme, toggle } = useTheme();

  if (mode === 'bravo') {
    return (
      <div className="asset-shell">
        <header className="asset-topbar">
          <div className="asset-brand">
            <span className="asset-logo" style={{ background: 'linear-gradient(135deg,#1e3a8a,#2563eb)' }}>GH</span>
            <div>
              <div className="asset-title">BRAVO <b>MATRIX</b></div>
              <div className="asset-sub">Brokerage coverage board · demo</div>
            </div>
          </div>
          <div className="asset-right">
            <button className="asset-switch" onClick={() => setMode('asset')} title="Cross to the Asset Matrix">⇄ Asset Matrix</button>
            <button className="asset-icon-btn" onClick={toggle}>{theme === 'dark' ? '☀' : '☾'}</button>
            {!firebaseEnabled && <span className="asset-demo">DEMO</span>}
          </div>
        </header>
        <main className="asset-main"><BravoBoardView /></main>
      </div>
    );
  }

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
          <button className="asset-switch" onClick={() => setMode('bravo')} title="Cross to the Bravo Matrix (brokerage board)">⇄ Bravo Matrix</button>
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
