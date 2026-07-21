import { useEffect, useState } from 'react';
import { onAuthStateChanged, getRedirectResult, type User } from 'firebase/auth';
import { auth, firebaseEnabled, signInWithGoogle, signOut, isCompanyEmail, ALLOWED_DOMAINS } from './firebase';

/* AuthGate — mirrors the GH Driver Hub sign-in. When Firebase is configured
   (production), the Asset Matrix is only reachable after a Google sign-in with a
   ghlogisticsllc.com or ajgtransport.com work email; any other account is
   rejected. When Firebase is NOT configured (local/demo build), it renders the
   app straight through so the demo still works with no backend. */

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!firebaseEnabled || !auth) { setReady(true); return; }
    // On phones the popup is blocked, so sign-in happens via a full-page
    // redirect; complete it here and surface any error.
    getRedirectResult(auth).catch((e) => setErr((e as Error).message || 'Sign-in failed.'));
    return onAuthStateChanged(auth, (u) => {
      // enforce the work-email allowlist even on restored sessions
      if (u && u.email && !isCompanyEmail(u.email)) { void signOut(); setUser(null); }
      else setUser(u);
      setReady(true);
    });
  }, []);

  // Demo build (no Firebase config) — no gate.
  if (!firebaseEnabled) return <>{children}</>;

  async function login() {
    setErr(''); setBusy(true);
    try { await signInWithGoogle(); }
    catch (e) { setErr((e as Error).message || 'Sign-in failed.'); }
    finally { setBusy(false); }
  }

  if (!ready) {
    return <div className="auth-screen"><div className="auth-card"><div className="auth-loading">Loading…</div></div></div>;
  }

  if (user) {
    return (
      <>
        <div className="auth-bar">
          <span className="auth-who">🔒 {user.email}</span>
          <button className="auth-signout" onClick={() => signOut()}>Sign out</button>
        </div>
        {children}
      </>
    );
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <span className="auth-logo">GH</span>
        <div className="auth-title">ASSET <b>MATRIX</b></div>
        <div className="auth-sub">Asset Ops Master Dispatch</div>
        <p className="auth-copy">Sign in with your work Google account to continue.</p>
        <button className="auth-google" onClick={login} disabled={busy}>
          <span className="auth-g">G</span>{busy ? 'Signing in…' : 'Sign in with Google'}
        </button>
        {err && <div className="auth-err">{err}</div>}
        <div className="auth-domains">Access limited to {ALLOWED_DOMAINS.map((d) => `@${d}`).join(' · ')}</div>
      </div>
    </div>
  );
}
