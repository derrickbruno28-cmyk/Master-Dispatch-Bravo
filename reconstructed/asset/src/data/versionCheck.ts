/* Auto-update detector — so nobody stays stuck on an old cached version.

   How it works: every deploy gives the main JS bundle a brand-new content hash
   (Vite), so the filename in index.html changes on every release. We remember
   the bundle this page booted with, then periodically (and on tab focus) fetch a
   fresh, un-cached copy of index.html and compare. If the live bundle differs, a
   newer version is deployed → we surface a one-tap "Refresh" banner. No service
   worker, no build wiring, no dependence on cache headers. */

function currentBundle(): string {
  const src = Array.from(document.querySelectorAll('script'))
    .map((s) => s.getAttribute('src') || '')
    .find((s) => /\/assets\/index-[\w-]+\.js/.test(s));
  return src || '';
}

async function latestBundle(): Promise<string> {
  const res = await fetch(`/index.html?_=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) return '';
  const html = await res.text();
  const m = html.match(/\/assets\/index-[\w-]+\.js/);
  return m ? m[0] : '';
}

/* Call once. Fires onUpdate() when a newer deploy is detected. Returns a cleanup
   fn. Never fires in dev (no hashed bundle) or while offline. */
export function watchForUpdate(onUpdate: () => void, intervalMs = 5 * 60 * 1000): () => void {
  const mine = currentBundle();
  if (!mine) return () => {};   // dev server / unexpected markup — skip
  let stopped = false;
  let fired = false;
  const check = async () => {
    if (stopped || fired || document.hidden) return;
    try {
      const latest = await latestBundle();
      if (latest && latest !== mine) { fired = true; onUpdate(); }
    } catch { /* offline / transient — try again next tick */ }
  };
  const id = window.setInterval(check, intervalMs);
  const onFocus = () => { void check(); };
  window.addEventListener('focus', onFocus);
  void check();
  return () => { stopped = true; window.clearInterval(id); window.removeEventListener('focus', onFocus); };
}
