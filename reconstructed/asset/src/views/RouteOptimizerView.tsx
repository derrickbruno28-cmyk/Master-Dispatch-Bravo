import { TRUCKS, ROUTES } from '../data/fleet';

/* Route Optimizer — KEPT from the Operations Center (the crown jewel). Full
   haversine deadhead-matching logic ports here in Phase 4; this placeholder
   confirms the data is wired and the tab is live on the new foundation. */
export default function RouteOptimizerView() {
  return (
    <div className="am-page">
      <div className="am-head"><h2>Route Optimizer</h2></div>
      <div className="am-note">
        <p><b>Kept feature — full port lands in Phase 4.</b> The deadhead / HOS matcher
          (pick a truck → ranked USPS routes by distance, hours, homeward pull) moves here
          from the Operations Center onto this shared foundation.</p>
        <p className="am-muted">Data already wired: <b>{TRUCKS.length}</b> trucks · <b>{ROUTES.length}</b> USPS routes.</p>
      </div>
    </div>
  );
}
