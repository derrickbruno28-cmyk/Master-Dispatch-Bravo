/* Fleet Map base styles. Free vector basemaps (OpenFreeMap — no key, no cost)
   are always available. Satellite / hybrid / terrain need a MapTiler imagery key,
   pasted on the Integrations page (stored in the browser only, never in code) —
   this is how Option B (the full Samsara satellite look) turns on later without
   any code change. */

const MT_KEY_STORE = 'asset-maptiler-key-v1';

export function maptilerKey(): string { try { return localStorage.getItem(MT_KEY_STORE) || ''; } catch { return ''; } }
export function setMaptilerKey(k: string) { try { k.trim() ? localStorage.setItem(MT_KEY_STORE, k.trim()) : localStorage.removeItem(MT_KEY_STORE); } catch { /* ignore */ } }
export function maptilerMasked(): string { const k = maptilerKey(); return k ? `${k.slice(0, 4)}••••${k.slice(-3)}` : ''; }

export interface BaseStyle { id: string; label: string; needsKey: boolean; url: string }

/* free basemaps (always usable) + key-gated imagery (Samsara-style) */
export function baseStyles(): BaseStyle[] {
  const key = maptilerKey();
  const mt = (name: string) => `https://api.maptiler.com/maps/${name}/style.json?key=${key}`;
  return [
    { id: 'streets', label: 'Streets', needsKey: false, url: 'https://tiles.openfreemap.org/styles/liberty' },
    { id: 'light', label: 'Light', needsKey: false, url: 'https://tiles.openfreemap.org/styles/positron' },
    { id: 'satellite', label: 'Satellite', needsKey: true, url: mt('satellite') },
    { id: 'hybrid', label: 'Hybrid', needsKey: true, url: mt('hybrid') },
    { id: 'terrain', label: 'Terrain', needsKey: true, url: mt('outdoor-v2') },
  ];
}
export function styleFor(id: string): BaseStyle {
  const all = baseStyles();
  return all.find((s) => s.id === id) ?? all[0];
}
