/* Tiny in-app change bus so views stay congruent live. Any store write emits a
   change; views subscribe and reload. Also listens to cross-tab localStorage
   changes so two browser tabs stay in sync. */

const EVT = 'asset-store-changed';

export function emitChange() {
  try { window.dispatchEvent(new Event(EVT)); } catch { /* ignore */ }
}

export function onChange(cb: () => void): () => void {
  const handler = () => cb();
  window.addEventListener(EVT, handler);
  window.addEventListener('storage', handler); // cross-tab
  return () => { window.removeEventListener(EVT, handler); window.removeEventListener('storage', handler); };
}
