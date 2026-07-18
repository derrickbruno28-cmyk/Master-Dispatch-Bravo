import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { collection, doc, getDocs, onSnapshot, query, setDoc, where } from 'firebase/firestore';
import { auth, db, firebaseEnabled, signInAnyGoogle, signOut } from '../firebase';
import { boardWindow, cleanTimes, hubLabel } from '../dates';
import { boardVisible, buildBoardDoc, buildCityStateMap, type BoardDoc } from '../board';
import type { CarrierUser, Lane, Load, Offer } from '../types';
import Logo from '../components/Logo';
import seedLanes from '../seed/lanes.json';
import seedLoads from '../seed/loads.json';

/* Carrier-facing storefront: view-only, sanitized, live.
   Reads ONLY the `loadboard` mirror, the carrier's OWN offers, and their OWN
   registration — the Matrix and Sales Hub are unreachable (security rules).
   Offers require an approved registration (company + MC verified by GH). */

function RegistrationGate({
  user,
  registration,
  onRegister,
}: {
  user: User | null;
  registration: CarrierUser | null;
  onRegister: (company: string, mc: string, phone: string) => Promise<void>;
}) {
  const [company, setCompany] = useState('');
  const [mc, setMc] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);

  if (registration?.status === 'pending') {
    return (
      <div className="board-gate pending">
        ⏳ <b>{registration.company}</b> (MC {registration.mcNumber}) — registration received.
        We verify every account against the carrier's listed contact before offers unlock.
        You can browse the board in the meantime.
      </div>
    );
  }
  if (registration?.status === 'rejected') {
    return (
      <div className="board-gate rejected">
        Your registration could not be verified. Contact freight@ghlogisticsllc.com to resolve.
      </div>
    );
  }
  if (registration?.status === 'approved') return null;

  const mcOk = /^\d{4,8}$/.test(mc.replace(/^MC[-\s]*/i, '').trim());

  return (
    <div className="board-gate form">
      <b>New Carrier Setup</b>
      <span className="muted-inline">
        One-time, takes a minute. You're signed in as <b>{user?.email}</b> — offers unlock after
        we verify that address against your company's listed contacts on Highway.
      </span>
      <div className="board-reg-steps">
        <label>
          <span className="reg-step">1 · Company legal name</span>
          <input
            placeholder="e.g. Roadrunner Freight LLC"
            value={company}
            autoFocus
            onChange={(e) => setCompany(e.target.value)}
          />
        </label>
        <label>
          <span className="reg-step">2 · MC number</span>
          <input
            placeholder="digits only, e.g. 998877"
            value={mc}
            onChange={(e) => setMc(e.target.value)}
          />
          {mc.trim() !== '' && !mcOk && <span className="reg-hint">MC numbers are 4–8 digits.</span>}
        </label>
        <label>
          <span className="reg-step">3 · Dispatch phone <i>(optional)</i></span>
          <input placeholder="e.g. 555-0142" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </label>
      </div>
      <button
        className="btn-send-offer"
        disabled={saving || !company.trim() || !mcOk}
        onClick={async () => {
          setSaving(true);
          await onRegister(company.trim(), mc.trim(), phone.trim());
          setSaving(false);
        }}
      >
        {saving ? 'Submitting…' : 'Submit registration'}
      </button>
      <span className="muted-inline">
        What happens next: we verify with your company's Highway contact, then the Offer buttons
        unlock — usually same business day.
      </span>
    </div>
  );
}

function OfferButton({
  trip,
  myOffers,
  approved,
  onSend,
}: {
  trip: BoardDoc;
  myOffers: Offer[];
  approved: boolean;
  onSend: (trip: BoardDoc, rate: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [rate, setRate] = useState('');
  const [sending, setSending] = useState(false);

  const latest = myOffers
    .filter((o) => o.loadId === trip.id)
    .sort((a, b) => b.at.localeCompare(a.at))[0];

  if (latest?.status === 'pending') {
    return <span className="offer-status pending">Offer sent: {latest.rate} — pending</span>;
  }
  if (latest?.status === 'accepted') {
    return (
      <span className="offer-status accepted">
        ✓ Accepted at {latest.rate} — {latest.respondedBy ? `${latest.respondedBy} will reach out regarding next steps` : "we'll be in touch"}
      </span>
    );
  }
  if (!approved) {
    return <span className="offer-status locked" title="Register above to send offers">Register to offer</span>;
  }

  async function send() {
    if (!rate.trim()) return;
    setSending(true);
    await onSend(trip, rate.trim());
    setSending(false);
    setOpen(false);
    setRate('');
  }

  return (
    <div className="offer-cell">
      {latest?.status === 'countered' && (
        <div className="offer-status countered">Counter: <b>{latest.counter}</b> — offer again to take it</div>
      )}
      {latest?.status === 'denied' && (
        <div className="offer-status denied">Offer {latest.rate} declined</div>
      )}
      {open ? (
        <div className="offer-form">
          <input
            placeholder="Your rate $"
            value={rate}
            autoFocus
            onChange={(e) => setRate(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && send()}
          />
          <div className="offer-form-actions">
            <button className="btn-send-offer" disabled={sending || !rate.trim()} onClick={send}>
              {sending ? 'Sending…' : 'Send'}
            </button>
            <button className="btn-ghost btn-sm" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <button className="btn-send-offer btn-offer-compact" onClick={() => setOpen(true)}>Offer</button>
      )}
    </div>
  );
}

export default function LoadboardPage() {
  const demoMode = !firebaseEnabled;
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(demoMode);
  const [docs, setDocs] = useState<BoardDoc[]>([]);
  const [myOffers, setMyOffers] = useState<Offer[]>([]);
  const [registration, setRegistration] = useState<CarrierUser | null>(
    demoMode && !new URLSearchParams(window.location.search).has('showreg')
      ? {
          uid: 'demo-carrier', email: 'demo@carrier.test', name: 'Demo Carrier',
          company: 'Roadrunner Freight LLC', mcNumber: 'MC-998877', phone: '555-0142',
          status: 'approved', requestedAt: new Date().toISOString(),
        }
      : null,
  );
  const [error, setError] = useState('');
  const [refreshedAt, setRefreshedAt] = useState('');
  const [citySearch, setCitySearch] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpand = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  /* Carriers never see the internal app name — plain loadboard branding. */
  useEffect(() => {
    document.title = 'GHL Loadboard';
  }, []);

  /* demo mode: derive the board locally from bundled data */
  useEffect(() => {
    if (!demoMode) return;
    const lanes = seedLanes as Lane[];
    const laneMap = new Map(lanes.map((l) => [l.id, l]));
    const cityState = buildCityStateMap(lanes);
    setDocs(
      (seedLoads as Load[])
        .filter((l) => {
          const lane = laneMap.get(l.laneId);
          return lane && !lane.isGroupHeader && boardVisible(l);
        })
        .map((l) => buildBoardDoc(l, laneMap.get(l.laneId)!, cityState)),
    );
  }, [demoMode]);

  useEffect(() => {
    if (demoMode || !auth) return;
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthReady(true);
    });
  }, [demoMode]);

  /* live subscriptions: board, own offers, own registration + access logging */
  useEffect(() => {
    if (demoMode || !db || !user) return;
    void setDoc(doc(db, 'loadboardAccess', `${user.uid}-${Date.now()}`), {
      uid: user.uid,
      email: user.email ?? '',
      name: user.displayName ?? '',
      at: new Date().toISOString(),
      ua: navigator.userAgent.slice(0, 160),
    }).catch(() => {});
    const subs = [
      onSnapshot(
        collection(db, 'loadboard'),
        (snap) => {
          setDocs(snap.docs.map((d) => d.data() as BoardDoc));
          setRefreshedAt(new Date().toTimeString().slice(0, 5));
        },
        (e) => setError(e.message),
      ),
      onSnapshot(
        query(collection(db, 'offers'), where('email', '==', user.email ?? '')),
        (snap) => setMyOffers(snap.docs.map((d) => d.data() as Offer)),
        () => {},
      ),
      onSnapshot(
        doc(db, 'carrierUsers', user.uid),
        (snap) => setRegistration(snap.exists() ? (snap.data() as CarrierUser) : null),
        () => {},
      ),
    ];
    return () => subs.forEach((u) => u());
  }, [demoMode, user]);

  const register = useCallback(
    async (company: string, mc: string, phone: string) => {
      const reg: CarrierUser = {
        uid: user?.uid ?? 'demo-carrier',
        email: user?.email ?? '',
        name: user?.displayName ?? '',
        company,
        mcNumber: mc,
        phone,
        status: 'pending',
        requestedAt: new Date().toISOString(),
      };
      if (demoMode || !db) {
        setRegistration(reg);
        return;
      }
      await setDoc(doc(db, 'carrierUsers', reg.uid), reg);
    },
    [demoMode, user],
  );

  const refresh = useCallback(async () => {
    if (demoMode || !db) {
      setRefreshedAt(new Date().toTimeString().slice(0, 5));
      return;
    }
    const snap = await getDocs(collection(db, 'loadboard'));
    setDocs(snap.docs.map((d) => d.data() as BoardDoc));
    setRefreshedAt(new Date().toTimeString().slice(0, 5));
  }, [demoMode]);

  const sendOffer = useCallback(
    async (trip: BoardDoc, rate: string) => {
      if (!registration || registration.status !== 'approved') return;
      const offer: Offer = {
        id: `offer-${trip.id}-${Date.now()}`,
        loadId: trip.id,
        rate: rate.startsWith('$') ? rate : `$${rate}`,
        company: registration.company,
        mcNumber: registration.mcNumber,
        phone: registration.phone,
        email: user?.email ?? registration.email,
        name: user?.displayName ?? registration.name,
        at: new Date().toISOString(),
        status: 'pending',
      };
      if (demoMode || !db) {
        setMyOffers((prev) => [...prev, offer]);
        return;
      }
      await setDoc(doc(db, 'offers', offer.id), offer);
    },
    [demoMode, user, registration],
  );

  const myBooked = useMemo(
    () => myOffers.filter((o) => o.status === 'accepted').sort((a, b) => b.at.localeCompare(a.at)),
    [myOffers],
  );

  const windowDays = boardWindow(); // today + tomorrow only
  const days = useMemo(() => {
    const q = citySearch.trim().toLowerCase();
    const inWindow = docs
      .filter((d) => windowDays.includes(d.date))
      /* carrier search is city/state only — match pickup OR delivery */
      .filter((d) => !q || `${d.origin} ${d.destination}`.toLowerCase().includes(q));
    return windowDays.map((date) => ({
      date,
      trips: inWindow
        .filter((d) => d.date === date)
        /* pickup site first, PU appointment time within each site */
        .sort((a, b) => Number(a.sortLast ?? false) - Number(b.sortLast ?? false) || a.origin.localeCompare(b.origin) || a.puTime.localeCompare(b.puTime)),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docs, citySearch]);

  const approved = registration?.status === 'approved';

  if (!authReady) return <div className="board-shell"><div className="board-signin">Loading…</div></div>;

  if (!demoMode && !user) {
    return (
      <div className="board-shell">
        <div className="board-signin">
          <Logo />
          <h1>GHL <span>Loadboard</span></h1>
          <p>Available USPS freight — updated live. Sign in with any Google account to view.</p>
          <button
            className="btn-primary"
            onClick={() => signInAnyGoogle().catch((e) => setError(e.message))}
          >
            Continue with Google
          </button>
          {error && <p className="error">{error}</p>}
          <p className="board-fine">Access is logged. Book with us: freight@ghlogisticsllc.com</p>
        </div>
      </div>
    );
  }

  return (
    <div className="board-shell">
      <header className="board-head">
        <div className="board-brand">
          <Logo />
          <div>
            <h1>GHL <span>Loadboard</span></h1>
            <div className="board-sub">
              Live — updates automatically · Book with us:{' '}
              <b>freight@ghlogisticsllc.com</b>
              {refreshedAt && <span> · updated {cleanTimes(refreshedAt)}</span>}
              {approved && <span> · {registration?.company} (MC {registration?.mcNumber?.replace(/^MC[-\s]*/i, '')})</span>}
            </div>
          </div>
        </div>
        <div className="board-head-actions">
          <input
            className="search"
            placeholder="Search city or state…"
            value={citySearch}
            onChange={(e) => setCitySearch(e.target.value)}
          />
          <button className="btn-ghost" onClick={refresh}>⟳ Refresh</button>
          {!demoMode && <button className="btn-ghost" onClick={() => signOut()}>Sign out</button>}
        </div>
      </header>

      {error && <p className="error">{error}</p>}
      {/* self-hides once approved; in demo, ?showreg walks the registration flow */}
      <RegistrationGate user={user} registration={registration} onRegister={register} />

      {/* §5.5 My Loads: accepted offers land here (in-app confirmation channel).
          Booked loads leave the open board instantly, so this renders from the
          offer's acceptance snapshot (laneLabel/puDate stamped at accept). */}
      {myBooked.length > 0 && (
        <section>
          <h2 className="board-day">My Loads <span className="board-count">({myBooked.length})</span></h2>
          <table className="board-table">
            <thead>
              <tr><th>PU Date & Time</th><th>Lane</th><th>Agreed Rate</th><th>Status</th></tr>
            </thead>
            <tbody>
              {myBooked.map((o) => (
                <tr key={o.id}>
                  <td className="bw-strong">
                    {o.puDate ? `${Number(o.puDate.slice(5, 7))}/${Number(o.puDate.slice(8, 10))}` : '—'}
                    {o.puTime ? ` ${o.puTime}` : ''}
                  </td>
                  <td className="bw-strong">{o.laneLabel ?? o.loadId}</td>
                  <td className="bw-rate-val">{o.rate}</td>
                  <td>
                    <span className="offer-status accepted">
                      ✓ Booked — {o.respondedBy ? `${o.respondedBy} will reach out regarding next steps` : "we'll be in touch"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {days.map(({ date, trips }) => (
        <section key={date}>
          <h2 className="board-day">{hubLabel(date)}</h2>
          {trips.length === 0 ? (
            <div className="board-clear">No available trips — check back soon.</div>
          ) : (
            <table className="board-table">
              <colgroup>
                <col className="bw-pu" />
                <col className="bw-lane" />
                <col className="bw-rate" />
                <col className="bw-team" />
                <col className="bw-equip" />
                <col className="bw-comm" />
                <col className="bw-offer" />
              </colgroup>
              <thead>
                <tr>
                  <th>PU Date &amp; Time</th>
                  <th>Lane</th>
                  <th>Rate</th>
                  <th>Solo/Team</th>
                  <th>Equipment</th>
                  <th>Commodity</th>
                  <th>Offer</th>
                </tr>
              </thead>
              <tbody>
                {trips.map((t) => (
                  <Fragment key={t.id}>
                    <tr className="board-row" onClick={() => toggleExpand(t.id)}>
                      <td className="bw-strong">
                        <span className="board-chev">{expanded.has(t.id) ? '▾' : '▸'}</span>
                        {Number(t.date.slice(5, 7))}/{Number(t.date.slice(8, 10))} {t.puTime}
                      </td>
                      <td className="bw-strong">
                        {t.origin} → {t.destination}
                        {t.shuttle && <div className="board-shuttle">⇄ SHUTTLE — {t.shuttle}</div>}
                      </td>
                      <td className="bw-rate-val">{t.rate || 'Call'}</td>
                      <td>{t.teamSolo || '—'}</td>
                      <td>{t.equipment}</td>
                      <td>{t.commodity}</td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <OfferButton trip={t} myOffers={myOffers} approved={approved} onSend={sendOffer} />
                      </td>
                    </tr>
                    {expanded.has(t.id) && (
                      <tr className="board-detail-row">
                        <td colSpan={7}>
                          <div className="board-detail">
                            <div><b>Route:</b> {t.stops || `${t.origin} → ${t.destination}`}</div>
                            <div>
                              {t.milesLoaded && <span><b>Loaded miles:</b> {t.milesLoaded} · </span>}
                              <b>Equipment:</b> {t.equipment} · <b>Solo/Team:</b> {t.teamSolo || 'TBD'} ·{' '}
                              <b>Commodity:</b> {t.commodity}
                              {t.shuttle && <span> · <b>Shuttle:</b> {t.shuttle}</span>}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ))}
    </div>
  );
}
