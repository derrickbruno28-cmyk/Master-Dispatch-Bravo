import { useState } from 'react';

/* Uses the real GH Logistics logo if app/public/logo.png exists;
   falls back to a styled wordmark otherwise. */
export default function Logo() {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span className="logo-fallback" aria-label="GH Logistics">
        GH<small>LOGISTICS</small>
      </span>
    );
  }
  return (
    <img
      src="/logo.png"
      alt="GH Logistics"
      className="logo-img"
      onError={() => setFailed(true)}
    />
  );
}
