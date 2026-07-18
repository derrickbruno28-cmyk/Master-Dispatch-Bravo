/* OTP / OTD Tracker — KEPT from the Operations Center. On-time pickup /
   delivery compliance entry + dashboards port here in Phase 4. */
export default function OTPView() {
  return (
    <div className="am-page">
      <div className="am-head"><h2>OTP / OTD Tracker</h2></div>
      <div className="am-note">
        <p><b>Kept feature — full port lands in Phase 4.</b> On-time pickup / delivery
          compliance tracking (entry form + per-driver dashboards) moves onto the shared
          foundation, backed by Firestore so entries persist and are shared, not reset on reload.</p>
      </div>
    </div>
  );
}
