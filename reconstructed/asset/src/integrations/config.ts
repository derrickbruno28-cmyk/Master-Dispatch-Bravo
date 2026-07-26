/* Integration configuration — ALL external services are selected here and read
   keys from env, never from code. Ship-state: every provider runs its local /
   estimate / mock implementation, so the app is fully functional with no keys.

   TO GO LIVE WITH A REAL PROVIDER:
   - Routing (exact driving miles): set VITE_ROUTING_PROVIDER=googleMaps and
     VITE_GOOGLE_MAPS_KEY=<key>, then implement the marked TODO in routing.ts.
   - Documents on Firebase Storage: set VITE_DOCUMENT_STORE=firebase (the app's
     Firebase project is already configured at runtime via window.__ASSET_FB__).
   - Samsara:  VITE_SAMSARA_TOKEN=<token>   (telematics.ts TODO)
   - Fleetio:  VITE_FLEETIO_TOKEN=<token> + VITE_FLEETIO_ACCOUNT=<acct> */

export type RoutingProviderKind = 'estimate' | 'googleMaps';
export type DocumentStoreKind = 'local' | 'firebase';

const env = (k: string): string => ((import.meta.env as Record<string, string | undefined>)[k] ?? '').trim();

export const integrationConfig = {
  routingProvider: (env('VITE_ROUTING_PROVIDER') || 'estimate') as RoutingProviderKind,
  documentStore: (env('VITE_DOCUMENT_STORE') || 'local') as DocumentStoreKind,
  googleMapsKey: env('VITE_GOOGLE_MAPS_KEY'),
  samsaraToken: env('VITE_SAMSARA_TOKEN'),
  fleetioToken: env('VITE_FLEETIO_TOKEN'),
  fleetioAccount: env('VITE_FLEETIO_ACCOUNT'),
};

export const samsaraConfigured = () => !!integrationConfig.samsaraToken;
export const fleetioConfigured = () => !!integrationConfig.fleetioToken;

/* ---- Fleetio: DISCONNECTED (owner decision, 2026-07-26) ----------------------
   The app no longer reads anything from Fleetio. Trucks — including their
   in/out-of-service status — come from the bundled Fleetio vehicle export
   (data/fleetUnits) and from manual OOS marks made inside the Asset Matrix.

   This is a hard off switch, not a per-browser preference: a browser that still
   has the old "live sync" flag set in localStorage will NOT call the connector.
   The read-only Cloud Function connector is still deployed but sits idle, so
   reconnecting later is a one-line change — set FLEETIO_CONNECTED back to true
   and restore the live toggle in the Integrations screen. */
export const FLEETIO_CONNECTED = false;

const FLEETIO_LIVE_KEY = 'asset-fleetio-live-v1';
export function fleetioLiveEnabled(): boolean {
  if (!FLEETIO_CONNECTED) return false;   // disconnected — never call the connector
  try { return localStorage.getItem(FLEETIO_LIVE_KEY) === '1'; } catch { return false; }
}
export function setFleetioLive(on: boolean): void { try { localStorage.setItem(FLEETIO_LIVE_KEY, on ? '1' : '0'); } catch { /* ignore */ } }
