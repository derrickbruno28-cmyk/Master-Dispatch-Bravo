import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  signOut as fbSignOut,
  type Auth,
  type User,
} from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';

/* Back-office sign-in domains: GH + approved partner dispatch (AJG Transport,
   Caleb 07/10). REQUIRED_DOMAINS is the floor — the env list can ADD partner
   domains but can never remove these two (Caleb 07/13, after a stale
   single-domain .env.local on the desktop silently locked AJG out of every
   v2.16–v2.21 build: ajgtransport access is removed only with Caleb's
   express written consent, and never via an env file). */
const REQUIRED_DOMAINS = ['ghlogisticsllc.com', 'ajgtransport.com'];
export const ALLOWED_DOMAINS = [...new Set([
  ...REQUIRED_DOMAINS,
  ...((import.meta.env.VITE_ALLOWED_DOMAIN as string) || '')
    .split(',').map((d) => d.trim()).filter(Boolean),
])];
export const ALLOWED_DOMAIN = ALLOWED_DOMAINS[0];
export function isCompanyEmail(email: string): boolean {
  const e = (email || '').trim().toLowerCase();
  return ALLOWED_DOMAINS.some((d) => e.endsWith(`@${d.toLowerCase()}`));
}

/* Config resolves at RUNTIME from public/firebase-config.js (window.__ASSET_FB__)
   so a pre-built app can be pointed at a Firebase project by editing one text
   file — no rebuild. Falls back to Vite build-time env for local dev. Empty
   values → demo mode (no backend, localStorage only). */
type FbCfg = Partial<Record<'apiKey' | 'authDomain' | 'projectId' | 'storageBucket' | 'messagingSenderId' | 'appId', string>>;
const rt: FbCfg = (typeof window !== 'undefined' && (window as unknown as { __ASSET_FB__?: FbCfg }).__ASSET_FB__) || {};
const val = (k: keyof FbCfg, env: string | undefined) => (rt[k] && rt[k] !== `PASTE_${k}` ? rt[k] : env) || '';
const cfg = {
  apiKey: val('apiKey', import.meta.env.VITE_FIREBASE_API_KEY),
  authDomain: val('authDomain', import.meta.env.VITE_FIREBASE_AUTH_DOMAIN),
  projectId: val('projectId', import.meta.env.VITE_FIREBASE_PROJECT_ID),
  storageBucket: val('storageBucket', import.meta.env.VITE_FIREBASE_STORAGE_BUCKET),
  messagingSenderId: val('messagingSenderId', import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID),
  appId: val('appId', import.meta.env.VITE_FIREBASE_APP_ID),
};

export const firebaseEnabled = !!cfg.apiKey && !!cfg.projectId;

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;

if (firebaseEnabled) {
  app = initializeApp(cfg);
  auth = getAuth(app);
  db = getFirestore(app);
}

export { app, auth, db };

/* Popup sign-in fails in popup-blocking / third-party-storage-blocking
   browsers (Brave, Safari ITP, locked-down Chrome). Fall back to a full-page
   redirect in those environments; onAuthStateChanged picks up the result. */
const REDIRECT_FALLBACK_CODES = new Set([
  'auth/popup-blocked',
  'auth/cancelled-popup-request',
  'auth/web-storage-unsupported',
  'auth/operation-not-supported-in-this-environment',
]);

async function popupOrRedirect(provider: GoogleAuthProvider): Promise<User> {
  if (!auth) throw new Error('Firebase not configured');
  try {
    const result = await signInWithPopup(auth, provider);
    return result.user;
  } catch (e) {
    const code = (e as { code?: string }).code ?? '';
    if (REDIRECT_FALLBACK_CODES.has(code)) {
      await signInWithRedirect(auth, provider); // navigates away
      return new Promise<User>(() => {}); // unreachable — page reloads
    }
    throw e;
  }
}

export async function signInWithGoogle(): Promise<User> {
  if (!auth) throw new Error('Firebase not configured');
  const provider = new GoogleAuthProvider();
  /* always let the user pick which Google account — avoids silently reusing a
     personal account that then bounces at the work-email gate */
  provider.setCustomParameters({ prompt: 'select_account' });

  /* Popup-FIRST (Google's recommended flow). A full-page redirect "authenticates
     then loops back to sign-in" in Safari and privacy-hardened browsers, because
     the auth handler lives on a different domain (…firebaseapp.com) and the
     post-redirect session is dropped by third-party-storage partitioning. The
     popup completes in the same window context, so it survives. If the popup
     can't run (blocked / closed / unsupported), fall back to the redirect — and
     AuthGate finishes that via getRedirectResult + onAuthStateChanged. */
  let result;
  try {
    result = await signInWithPopup(auth, provider);
  } catch (e) {
    const code = (e as { code?: string }).code ?? '';
    if (code === 'auth/cancelled-popup-request') throw e; // double-invoke; let the first win
    await signInWithRedirect(auth, provider); // navigates away; page reloads
    return new Promise<User>(() => {}); // unreachable — the redirect reloads the page
  }

  const email = result.user.email ?? '';
  if (!isCompanyEmail(email)) {
    await fbSignOut(auth);
    throw new Error("That account isn't authorized. Sign in with your approved work account.");
  }
  return result.user;
}

export async function signOut(): Promise<void> {
  if (auth) await fbSignOut(auth);
}

/** Loadboard sign-in: any Google account is allowed — access is logged, and
    security rules keep everything except the sanitized board invisible. */
export async function signInAnyGoogle(): Promise<User> {
  if (!auth) throw new Error('Firebase not configured');
  return popupOrRedirect(new GoogleAuthProvider());
}
