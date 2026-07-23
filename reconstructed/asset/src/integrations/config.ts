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
