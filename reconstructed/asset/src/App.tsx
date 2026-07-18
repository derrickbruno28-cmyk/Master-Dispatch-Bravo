import { useState } from 'react';
import { useTheme } from './theme';
import { firebaseEnabled } from './firebase';
import AssetMatrixView from './views/AssetMatrixView';
import RouteOptimizerView from './views/RouteOptimizerView';
import OTPView from './views/OTPView';
import CoveredView from './views/CoveredView';
import FleetStatusView from './views/FleetStatusView';

/* Asset Matrix — the asset-side (own-truck) sibling of Bravo Matrix.
   Same foundation, theme, and (later) auth + Firestore as Bravo; brokerage-only
   surfaces (Sales Hub, Route Matrix, Dedicated) are deliberately absent — the
   brokerage owns those. Tabs kept: Asset Matrix + Route Optimizer + OTP/OTD +
   Routes Covered + Fleet Status. A ⇄ switch crosses to Bravo without touching it. */

const APP_VERSION = '0.1.0';
/* Where "⇄ Bravo Matrix" points. In a real deploy this is Bravo's hosting URL
   (shared Firebase project); overridable via env so the two link cleanly. */
const BRAVO_URL = (import.meta.env.VITE_BRAVO_URL as string) || '';

type Tab = 'matrix' | 'optimizer' | 'otp' | 'covered' | 'fleet';
const TABS: { key: Tab; label: string }[] = [
  { key: 'matrix', label: '🗓 Asset Matrix' },
  { key: 'optimizer', label: '⚡ Route Optimizer' },
  { key: 'otp', label: '📊 OTP / OTD' },
  { key: 'covered', label: '✅ Routes Covered' },
  { key: 'fleet', label: '🚛 Fleet Status' },
];

export default function App() {
  const [tab, setTab] = useState<Tab>('matrix');
  const { theme, toggle } = useTheme();

  function toBravo() {
    if (BRAVO_URL) window.location.href = BRAVO_URL;
    else window.alert('Bravo Matrix link — set VITE_BRAVO_URL to the Bravo deploy.\nThe two apps share one Firebase project; this switch crosses between them.');
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
            <button
              key={t.key}
              className={`asset-tab ${tab === t.key ? 'on' : ''}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <div className="asset-right">
          <button className="asset-switch" onClick={toBravo} title="Cross to Bravo Matrix (brokerage side)">
            ⇄ Bravo Matrix
          </button>
          <button className="asset-icon-btn" onClick={toggle} title="Toggle light / dark">
            {theme === 'dark' ? '☀' : '☾'}
          </button>
          {!firebaseEnabled && <span className="asset-demo">DEMO</span>}
        </div>
      </header>

      <main className="asset-main">
        {tab === 'matrix' && <AssetMatrixView />}
        {tab === 'optimizer' && <RouteOptimizerView />}
        {tab === 'otp' && <OTPView />}
        {tab === 'covered' && <CoveredView />}
        {tab === 'fleet' && <FleetStatusView />}
      </main>
    </div>
  );
}
