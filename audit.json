/* Data layer: Firestore when configured, bundled Alpha Matrix seed data in demo mode. */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  runTransaction,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { app, auth, db, firebaseEnabled } from '../firebase';
import { getFunctions, httpsCallable } from 'firebase/functions';
import {
  DEFAULT_STATUSES,
  GH_CARRIER_RE,
  normalizeMc,
  normalizeCarrierName,
  normalizeRole,
  type AppUser,
  type CapacityList,
  type Carrier,
  type DedicatedLane,
  type CarrierUser,
  type HistoryEntry,
  type Lane,
  type Load,
  type Offer,
  type Role,
  type StatusDef,
  type Facility,
  expectedWeekdays,
  laneTripNumber,
  firstMoney,
  laneMiles,
} from '../types';
import { todayCentral } from '../dates';
import { boardVisible, buildBoardDoc, buildCityStateMap } from '../board';
import { DEFAULT_TRAILER_SETTINGS, type TrailerSettings } from '../trailers';
import { can, setRoleMatrix } from '../permissions';
import { inferEmpties } from '../capacity';
import { DEFAULT_MARGIN_SETTINGS, type MarginSettings } from '../margin';
import { integrityIdForTripCode,
  demoIntegrityFromLanes,
  type Band,
  type BandHistoryEntry,
  type IntegrityRecord,
  type TrmMeta,
} from '../pricing';
import seedLanes from '../seed/lanes.json';
import seedLoads from '../seed/loads.json';
import seedCarriers from '../seed/carriers.json';

const OWNER_EMAIL =
  (import.meta.env.VITE_OWNER_EMAIL as string) || 'caleb@ghlogisticsllc.com';

/* Map legacy Alpha Matrix cell colors to Bravo statuses on first import. */
function legacyStatus(load: Load): string {
  const c = (load.cellColor ?? '').toUpperCase();
  if (c === '#999999' || c === '#000000') return 'not_running';
  if (c === '#FFFF00') return load.carrier ? 'booked_rc_pending' : 'exposed';
  /* asset = our own GH Logistics trucks only; purple cells on outside carriers are just covered */
  if (c === '#B4A7D6' && GH_CARRIER_RE.test(load.carrier)) return 'asset';
  return load.carrier ? 'covered' : 'exposed';
}

function summarize(prev: Partial<Load>, next: Partial<Load>): string {
  const fields: Array<[keyof Load, string]> = [
    ['loadNumber', 'load #'],
    ['carrier', 'carrier'],
    ['rate', 'rate'],
    ['rateNotes', 'notes'],
    ['status', 'status'],
    ['postedRate', 'posted rate'],
    ['equipment', 'equipment'],
    ['teamSolo', 'solo/team'],
    ['truckNumber', 'truck #'],
    ['cancelReason', 'cancel reason'],
    ['hubNotes', 'hub notes'],
    ['chargebackClass', 'chargeback class'],
    ['chargebackAmount', 'chargeback amount'],
    ['chargebackStatus', 'chargeback status'],
    ['chargebackWaiveNote', 'chargeback waive reason'],
    ['shuttleLocation', 'shuttle swap/stage location'],
    ['shuttleCarrier', 'shuttle 2nd-leg carrier'],
    ['shuttleTruckNumber', 'shuttle 2nd-leg truck #'],
    ['shuttleAssetLs', 'shuttle asset LS #'],
    ['shuttleLegStatus', 'shuttle delivery-leg status'],
    ['shuttleLegNotes', 'shuttle delivery-leg notes'],
    ['shuttleCity', 'swap city'],
    ['shuttleState', 'swap state'],
    ['shuttleSwapEta', 'ETA to swap'],
    ['shuttlePostedRate', 'leg-2 posted rate'],
    ['nextEmailAt', 'next required email'],
    ['trailerNumber', 'loadout trailer #'],
    ['trailerReturnSite', 'trailer return site'],
  ];
  if ('trailerReturnedAt' in next && prev.trailerReturnedAt !== next.trailerReturnedAt) {
    return next.trailerReturnedAt ? 'loadout trailer RETURNED' : 'trailer return mark removed';
  }
  if ('trailerFreeDays' in next && prev.trailerFreeDays !== next.trailerFreeDays) {
    return `trailer free days: ${prev.trailerFreeDays ?? 'default'} → ${next.trailerFreeDays ?? 'default'}`;
  }
  if ('hideFromBoard' in next && prev.hideFromBoard !== next.hideFromBoard) {
    return next.hideFromBoard ? 'hidden from loadboard' : 'shown on loadboard';
  }
  if ('pinnedNight' in next && prev.pinnedNight !== next.pinnedNight) {
    return next.pinnedNight ? 'pinned for night shift' : 'night shift pin removed';
  }
  if ('onSiteAt' in next && prev.onSiteAt !== next.onSiteAt) return next.onSiteAt ? 'marked ON-SITE at shipper' : 'on-site mark removed';
  if ('deliveredAt' in next && prev.deliveredAt !== next.deliveredAt) return next.deliveredAt ? 'marked DELIVERED' : 'delivered mark removed';
  if ('ppwkAt' in next && prev.ppwkAt !== next.ppwkAt) return next.ppwkAt ? 'PPWK/BOL received (T&T)' : 'PPWK mark removed';
  if ('defcon' in next && prev.defcon !== next.defcon) return next.defcon ? '🚨 marked DEFCON' : 'DEFCON cleared';
  if ('softBook' in next && prev.softBook !== next.softBook) {
    return next.softBook ? 'flagged SOFT BOOK — still shopping for cheaper' : 'soft-book flag removed';
  }
  if ('bookingApproved' in next && prev.bookingApproved !== next.bookingApproved) {
    return next.bookingApproved ? 'booking approved — cleared from Sales Hub' : 'booking approval revoked';
  }
  if ('tonuBill' in next && prev.tonuBill !== next.tonuBill) {
    return next.tonuBill ? 'TONU billing flagged — Bill USPS (< 4 hours)' : 'TONU billing flag removed';
  }
  if ('bolVerified' in next && prev.bolVerified !== next.bolVerified) {
    return next.bolVerified ? 'BOL verified (QA)' : 'BOL verification removed';
  }
  if ('isShuttle' in next && prev.isShuttle !== next.isShuttle) {
    return next.isShuttle ? 'flagged as SHUTTLE' : 'shuttle flag removed';
  }
  const parts: string[] = [];
  for (const [key, label] of fields) {
    const a = (prev[key] ?? '') as string;
    const b = (next[key] ?? '') as string;
    if (key in next && a !== b) {
      parts.push(`${label}: "${a || '—'}" → "${b || '—'}"`);
    }
  }
  return parts.join('; ');
}

interface StoreShape {
  demoMode: boolean;
  ready: boolean;
  currentUser: AppUser;
  lanes: Lane[];
  loads: Load[];
  carriers: Carrier[];
  users: AppUser[];
  statuses: StatusDef[];
  offers: Offer[];
  respondOffer: (offerId: string, patch: Partial<Offer>) => Promise<void>;
  carrierUsers: CarrierUser[];
  respondCarrierUser: (uid: string, approve: boolean) => Promise<void>;
  requestCarrierVerification: (uid: string, contactEmail: string) => Promise<void>;
  upsertLoad: (load: Load) => Promise<void>;
  updateLoad: (id: string, patch: Partial<Load>) => Promise<void>;
  approveBooking: (id: string) => Promise<void>;
  addHubNote: (id: string, text: string) => Promise<void>;
  deleteHubNote: (id: string, noteAt: string) => Promise<void>;
  addCarrier: (name: string, mcNumber?: string) => Promise<Carrier>;
  updateLane: (id: string, patch: Partial<Lane>) => Promise<void>;
  /* narrow lane writes: drag-reorder (sortOrder/section) + ⓘ service notes */
  patchLane: (id: string, patch: Partial<Lane>) => Promise<void>;
  addLane: (lane: Omit<Lane, 'id' | 'sortOrder'>) => Promise<Lane>;
  removeLane: (id: string) => Promise<void>;
  setUserRole: (id: string, role: Role, fedCom?: boolean) => Promise<void>;
  setUserPermissions: (id: string, permAllow: string[], permDeny: string[]) => Promise<void>;
  /* v2.18.0 */
  permToast: string | null;
  /* v2.32.0: owner-editable role-permission matrix (settings/roleDefaults) */
  roleMatrix: Record<string, string[]> | null;
  saveRoleDefaults: (matrix: Record<string, string[]>) => Promise<void>;
  /** v2.19.0 long-press move: same lane, open target day. Returns an error
      string when the move is refused, null on success. */
  moveLoad: (load: Load, toDate: string) => Promise<string | null>;
  removeDedicated: (id: string) => Promise<void>;
  createIntegrityRecord: (lane: Lane) => Promise<void>;
  importLoads: (loads: Load[]) => Promise<number>;
  rebuildLoadboard: () => Promise<number>;
  /* §6.4 — 08:00 empty-truck snapshot (capacity/current; demo derives live) */
  capacity: CapacityList | null;
  /* §8.1 — margin settings (fuel/FSC/breakeven/company; settings/margin doc) */
  marginSettings: MarginSettings;
  saveMarginSettings: (patch: Partial<MarginSettings>) => Promise<void>;
  /* §9.1 — QA BOL verification; §8.2 — FedCom-edited rep goals */
  approveBol: (id: string) => Promise<void>;
  setUserGoal: (id: string, dailyGoal: number) => Promise<void>;
  /* §7.1 — dedicated-day master (source of truth for dedicated coverage) */
  dedicated: DedicatedLane[];
  importDedicated: (rows: DedicatedLane[]) => Promise<number>;
  updateDedicated: (id: string, patch: Partial<DedicatedLane>) => Promise<void>;
  setCarrierIssue: (id: string, issue: boolean) => Promise<void>;
  /* Carrier database tab (Integrity): MC / DOT / notes edits, admin-tier UI */
  updateCarrier: (id: string, patch: Partial<Carrier>) => Promise<void>;
  /* Morale badge: owner toggles the feature; each user picks their own team */
  moraleEnabled: boolean;
  setMoraleEnabled: (enabled: boolean) => Promise<void>;
  setMyTeam: (team: string, teamLogoUrl: string) => Promise<void>;
  /* T&T Phase 1: facility contact directory (replaces the CT spreadsheet) */
  facilities: Facility[];
  saveFacility: (f: Facility) => Promise<void>;
  /* Rate Confirmation module: callable — send/resend the RC email */
  sendRateCon: (loadId: string, toEmail: string, saveToCarrierId?: string) => Promise<void>;
  /* Loadout Trailer Module: adjustable fine-per-day (settings/trailers) */
  trailerSettings: TrailerSettings;
  saveTrailerSettings: (patch: Partial<TrailerSettings>) => Promise<void>;
  setUserMorale: (id: string, moraleOk: boolean) => Promise<void>;
  /* Phase 3 — integrity DB (rate bands + TRM revenue data) */
  integrity: IntegrityRecord[];
  saveTrm: (id: string, patch: { currentRate?: number | null; miles?: number | null; freqCode?: string }) => Promise<void>;
  trmMeta: TrmMeta | null;
  saveBand: (id: string, dayType: 'weekday' | 'weekend', band: Band, reasonCode: string) => Promise<void>;
  getBandHistory: (id: string) => Promise<BandHistoryEntry[]>;
  importTrm: (records: IntegrityRecord[], filename: string) => Promise<{ added: number; updated: number; missing: string[] }>;
}

const StoreContext = createContext<StoreShape | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const demoMode = !firebaseEnabled;
  const [ready, setReady] = useState(demoMode);
  const [lanes, setLanes] = useState<Lane[]>(() =>
    demoMode ? (seedLanes as Lane[]) : [],
  );
  const [loads, setLoads] = useState<Load[]>(() =>
    demoMode
      ? (seedLoads as Load[]).map((l) => ({ ...l, status: legacyStatus(l) }))
      : [],
  );
  const [carriers, setCarriers] = useState<Carrier[]>(() =>
    demoMode ? (seedCarriers as Carrier[]) : [],
  );
  const [users, setUsers] = useState<AppUser[]>(() =>
    demoMode
      ? [
          { id: 'demo-owner', name: 'Demo Owner', email: OWNER_EMAIL, role: 'owner' },
          { id: 'demo-broker', name: 'Demo Broker', email: 'broker@ghlogisticsllc.com', role: 'broker_rep' as Role },
        ]
      : [],
  );
  const [statuses] = useState<StatusDef[]>(DEFAULT_STATUSES);
  const [offers, setOffers] = useState<Offer[]>(() => {
    if (!demoMode) return [];
    /* demo: one sample carrier offer so the hub flow is visible */
    const sample = (seedLoads as Load[]).find(
      (l) => l.loadNumber && !l.carrier && l.date >= new Date().toISOString().slice(0, 10),
    );
    if (!sample) return [];
    /* three competing offers on one load so the §5.4 lowest-first stack shows */
    const mk = (n: number, rate: string, company: string, email: string, minsAgo: number): Offer => ({
      id: `offer-demo-${sample.id}-${n}`,
      loadId: sample.id,
      rate,
      company,
      phone: '555-0142',
      email,
      name: 'Demo Carrier',
      at: new Date(Date.now() - minsAgo * 60000).toISOString(),
      status: 'pending',
    });
    return [
      mk(1, '$2650', 'Roadrunner Freight LLC', 'dispatch@roadrunner.test', 42),
      mk(2, '$2450', 'Desert Eagle Logistics', 'ops@deserteagle.test', 17),
      mk(3, '$2900', 'Bluebonnet Carriers', 'book@bluebonnet.test', 65),
    ];
  });
  const [carrierUsers, setCarrierUsers] = useState<CarrierUser[]>([]);
  const [integrity, setIntegrity] = useState<IntegrityRecord[]>(() =>
    demoMode ? demoIntegrityFromLanes(seedLanes as Lane[]) : [],
  );
  /* cross-callback ref (rule 9a) */
  const integrityRef = useRef<IntegrityRecord[]>([]);
  useEffect(() => { integrityRef.current = integrity; }, [integrity]);
  const [trmMeta, setTrmMeta] = useState<TrmMeta | null>(null);
  const [capacity, setCapacity] = useState<CapacityList | null>(() =>
    demoMode
      ? {
          builtAt: new Date().toISOString(),
          entries: inferEmpties(
            (seedLoads as Load[]).map((l) => ({ ...l, status: legacyStatus(l) })),
            seedLanes as Lane[],
          ),
        }
      : null,
  );
  const [dedicated, setDedicated] = useState<DedicatedLane[]>([]);
  const [marginSettings, setMarginSettings] = useState<MarginSettings>(DEFAULT_MARGIN_SETTINGS);
  const [moraleEnabled, setMoraleState] = useState(false);
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [trailerSettings, setTrailerSettings] = useState<TrailerSettings>(DEFAULT_TRAILER_SETTINGS);
  const [usersLoaded, setUsersLoaded] = useState(demoMode);
  /* These MUST be useRef: a `{ current: x }` literal is a NEW object every
     render, but the memoized callbacks capture the FIRST render's object —
     freezing the state they read at its initial value. updateLoad would then
     rebuild loads from a stale base and silently revert prior edits. */
  const offersRef = useRef(offers);
  offersRef.current = offers;
  /* Always-current loads for write-path lookups. NEVER compute a Firestore
     write from values captured inside a setLoads updater: React defers the
     updater when other updates are queued, so the captured variable is still
     undefined when the write runs — the mutation silently never persists
     (v1.9.0 fix for vanishing night pins and reappearing deleted notes). */
  const loadsRef = useRef(loads);
  loadsRef.current = loads;

  const [roleMatrix, setRoleMatrixState] = useState<Record<string, string[]> | null>(null);
  const currentUser = useMemo<AppUser>(() => {
    if (demoMode) {
      /* demo-only: ?role=broker_rep (etc.) walks the app as that role —
         used for role-POV UX audits; ignored outside demo mode */
      const params = new URLSearchParams(window.location.search);
      const demoRole = normalizeRole(params.get('role') ?? 'owner');
      return {
        id: 'demo-owner',
        name: demoRole === 'owner' ? 'Demo Owner' : `Demo ${demoRole.replace(/_/g, ' ')}`,
        email: OWNER_EMAIL,
        role: demoRole,
        fedCom: params.get('fedcom') === '1',
      };
    }
    const u = auth?.currentUser;
    const email = u?.email ?? '';
    const existing = users.find((x) => x.id === u?.uid);
    const role: Role = existing ? normalizeRole(existing.role) : email === OWNER_EMAIL ? 'owner' : 'base';
    /* v2.18.1: SPREAD the user doc — building this object from scratch dropped
       permAllow/permDeny, so per-user overrides showed in the Permissions
       editor but never applied to the person's own UI (Jheremie's Integrity
       grant was invisible to him; server rules honored it all along). */
    return { ...existing, id: u?.uid ?? '', name: existing?.name || u?.displayName || email, email, role, fedCom: existing?.fedCom };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demoMode, users, roleMatrix]);

  useEffect(() => {
    if (demoMode || !db) return;
    const subs = [
      onSnapshot(collection(db, 'lanes'), (snap) => {
        setLanes(
          snap.docs
            .map((d) => d.data() as Lane)
            .sort((a, b) => a.sortOrder - b.sortOrder),
        );
        setReady(true);
      }),
      onSnapshot(collection(db, 'loads'), (snap) =>
        setLoads(snap.docs.map((d) => d.data() as Load)),
      ),
      onSnapshot(collection(db, 'carriers'), (snap) =>
        setCarriers(snap.docs.map((d) => d.data() as Carrier)),
      ),
      onSnapshot(collection(db, 'users'), (snap) => {
        setUsers(snap.docs.map((d) => {
          const u = d.data() as AppUser;
          return { ...u, id: d.id, role: normalizeRole(u.role) };
        }));
        setUsersLoaded(true);
      }),
      onSnapshot(collection(db, 'offers'), (snap) =>
        setOffers(snap.docs.map((d) => d.data() as Offer)),
      ),
      onSnapshot(collection(db, 'carrierUsers'), (snap) =>
        setCarrierUsers(snap.docs.map((d) => d.data() as CarrierUser)),
      ),
      onSnapshot(collection(db, 'integrity'), (snap) =>
        setIntegrity(snap.docs.map((d) => d.data() as IntegrityRecord)),
      ),
      onSnapshot(doc(db, 'integrityMeta', 'trm'), (snap) =>
        setTrmMeta(snap.exists() ? (snap.data() as TrmMeta) : null),
      ),
      onSnapshot(doc(db, 'capacity', 'current'), (snap) =>
        setCapacity(snap.exists() ? (snap.data() as CapacityList) : null),
      ),
      onSnapshot(collection(db, 'dedicated'), (snap) =>
        setDedicated(snap.docs.map((d) => d.data() as DedicatedLane)),
      ),
      onSnapshot(doc(db, 'settings', 'margin'), (snap) =>
        setMarginSettings(snap.exists() ? { ...DEFAULT_MARGIN_SETTINGS, ...(snap.data() as MarginSettings) } : DEFAULT_MARGIN_SETTINGS),
      ),
      onSnapshot(doc(db, 'settings', 'morale'), (snap) =>
        setMoraleState(snap.exists() && !!(snap.data() as { enabled?: boolean }).enabled),
      onSnapshot(collection(db, 'facilities'), (snap) =>
        setFacilities(snap.docs.map((d) => d.data() as Facility)),
      ),
      onSnapshot(doc(db, 'settings', 'trailers'), (snap) =>
        setTrailerSettings(snap.exists() ? { ...DEFAULT_TRAILER_SETTINGS, ...(snap.data() as TrailerSettings) } : DEFAULT_TRAILER_SETTINGS),
      onSnapshot(doc(db, 'settings', 'roleDefaults'), (snap) => {
        const m = snap.exists() ? (snap.data() as Record<string, string[]>) : null;
        setRoleMatrix(m); /* registry consulted by defaultPerms() */
        setRoleMatrixState(m); /* state so currentUser + gates re-render */
      }),
      ),
      ),
    ];
    return () => subs.forEach((u) => u());
  }, [demoMode]);

  /* Register the signed-in user so the owner can assign roles.
     MUST wait for the users snapshot: deciding from an empty pre-load list
     rewrote existing docs with the default role, demoting admins on refresh. */
  useEffect(() => {
    if (demoMode || !db || !auth?.currentUser || !usersLoaded) return;
    const u = auth.currentUser;
    if (!users.some((x) => x.id === u.uid)) {
      /* Self-registration lands at Base (read-only) until provisioned (§2.4). */
      void setDoc(doc(db, 'users', u.uid), {
        id: u.uid,
        name: u.displayName ?? u.email,
        email: u.email,
        role: u.email === OWNER_EMAIL ? 'owner' : 'base',
      });
    }
  }, [demoMode, users, usersLoaded]);

  /* ---- carrier loadboard mirror: sanitized docs, kept in lockstep with loads ---- */
  const lanesRef = useRef(lanes);
  const dedicatedRef = useRef<DedicatedLane[]>([]);
  lanesRef.current = lanes;
  dedicatedRef.current = dedicated;
  const cityStateMap = useMemo(() => buildCityStateMap(lanes), [lanes]);
  const cityStateRef = useRef(cityStateMap);
  cityStateRef.current = cityStateMap;

  const syncBoard = useCallback(
    async (affected: Load[]) => {
      if (demoMode || !db) return;
      for (const load of affected) {
        const lane = lanesRef.current.find((l) => l.id === load.laneId);
        try {
          if (lane && !lane.isGroupHeader && boardVisible(load)) {
            await setDoc(doc(db, 'loadboard', load.id), buildBoardDoc(load, lane, cityStateRef.current));
          } else {
            await deleteDoc(doc(db, 'loadboard', load.id));
          }
        } catch {
          /* board mirror is best-effort; reconcile repairs drift */
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [demoMode],
  );

  /* Full reconcile: desired state vs mirror. Runs on admin session start and on demand. */
  const rebuildLoadboard = useCallback(async () => {
    if (demoMode || !db) return 0;
    const cityState = buildCityStateMap(lanes);
    const laneMap = new Map(lanes.map((l) => [l.id, l]));
    const desired = new Map<string, Load>();
    for (const load of loads) {
      const lane = laneMap.get(load.laneId);
      if (lane && !lane.isGroupHeader && boardVisible(load)) desired.set(load.id, load);
    }
    const existing = await getDocs(collection(db, 'loadboard'));
    const batch = writeBatch(db);
    let ops = 0;
    for (const d of existing.docs) {
      if (!desired.has(d.id)) {
        batch.delete(d.ref);
        ops++;
      }
    }
    for (const [id, load] of desired) {
      batch.set(doc(db, 'loadboard', id), buildBoardDoc(load, laneMap.get(load.laneId)!, cityState));
      ops++;
    }
    if (ops) await batch.commit();
    return desired.size;
  }, [demoMode, lanes, loads]);

  const reconciled = useState({ done: false })[0];
  useEffect(() => {
    if (demoMode || reconciled.done || !ready || !loads.length || !lanes.length) return;
    if (!can(currentUser, 'hub.push')) return;
    reconciled.done = true;
    void rebuildLoadboard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demoMode, ready, loads.length, lanes.length, currentUser.role]);

  const stamp = useCallback(
    (action: string): HistoryEntry => ({
      at: new Date().toISOString(),
      by: currentUser.name || currentUser.email,
      action,
    }),
    [currentUser],
  );

  /* v2.17.0: NEVER swallow a rejected write. v2.18.0 (Caleb): permission
     rejections show a 5-second bottom-right toast naming the permission the
     action needs, so live troubleshooting is instant; every other failure
     keeps the loud alert. */
  const [permToast, setPermToast] = useState<string | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  const writeFailed = (what: string, permKey: string) => (e: unknown) => {
    console.error(`${what} write failed`, e);
    const msg = e instanceof Error ? e.message : String(e);
    if (/permission|insufficient/i.test(msg)) {
      window.clearTimeout(toastTimer.current);
      setPermToast(`${what} \u2014 requires \u201c${permKey}\u201d`);
      toastTimer.current = window.setTimeout(() => setPermToast(null), 5000);
      return;
    }
    window.alert(`\u26a0 ${what} did NOT save \u2014 the server rejected it.\n\n${msg}\n\nThe board will snap back to the saved value. If this keeps happening, screenshot this message and send it to Caleb.`);
  };

  const upsertLoad = useCallback(
    async (load: Load) => {
      const entry = stamp(summarize({}, load) || 'created');
      const withHistory = { ...load, history: [...(load.history ?? []), entry] };
      if (withHistory.carrier) {
        withHistory.bookedBy = currentUser.name || currentUser.email;
        withHistory.bookingApproved = withHistory.bookingApproved ?? false;
      }
      setLoads((prev) => {
        const i = prev.findIndex((l) => l.id === load.id);
        if (i === -1) return [...prev, withHistory];
        const next = prev.slice();
        next[i] = withHistory;
        return next;
      });
      if (!demoMode && db) await setDoc(doc(db, 'loads', load.id), withHistory).catch(writeFailed('New load', 'matrix.create'));
      void syncBoard([withHistory]);
    },
    [demoMode, stamp, currentUser, syncBoard],
  );

  const updateLoad = useCallback(
    async (id: string, patch: Partial<Load>) => {
      /* Everything is computed from loadsRef BEFORE setLoads — see the ref's
         comment; a deferred updater must not be able to drop the write. */
      const cur = loadsRef.current.find((l) => l.id === id);
      if (!cur) return;
      const summary = summarize(cur, patch);
      const derived: Partial<Load> = {};
      /* T&T ETA clock: stamp the FIRST transition into 'departed' */
      if (patch.status === 'departed' && cur.status !== 'departed' && !cur.departedAt && !patch.departedAt) {
        derived.departedAt = new Date().toISOString();
      }
      const next = { ...cur, ...patch };
      let becameBooked = false;
      if ('carrier' in patch && !patch.status) {
        const auto = ['exposed', 'covered'].includes(next.status);
        if (auto) derived.status = patch.carrier ? 'covered' : 'exposed';
      }
      /* booking bookkeeping: new carrier assignment awaits admin approval */
      if ('carrier' in patch && patch.carrier && patch.carrier !== cur.carrier) {
        derived.bookedBy = currentUser.name || currentUser.email;
        if (!('bookingApproved' in patch)) derived.bookingApproved = false;
        becameBooked = true;
      }
      if ('carrier' in patch && !patch.carrier) {
        derived.bookedBy = '';
        derived.bookingApproved = false;
      }
      const updated: Load = { ...next, ...derived };
      let historyEntry: HistoryEntry | undefined;
      if (summary) {
        historyEntry = stamp(summary);
        updated.history = [...(cur.history ?? []), historyEntry];
      }
      setLoads((prev) => prev.map((l) => (l.id === id ? updated : l)));
      /* Field-level patch only — writing the whole doc from a stale client
         snapshot is what resurrected deleted notes / clobbered teammates. */
      if (!demoMode && db) {
        const remotePatch: Record<string, unknown> = { ...patch, ...derived };
        if (historyEntry) remotePatch.history = arrayUnion(historyEntry);
        await updateDoc(doc(db, 'loads', id), remotePatch).catch(writeFailed('Load update', 'matrix.book'));
      }
      void syncBoard([updated]);
      /* booking closes the auction — auto-deny any offers still pending */
      if (becameBooked) {
        const stale = offersRef.current.filter((o) => o.loadId === id && o.status === 'pending');
        const respondedAt = new Date().toISOString();
        for (const o of stale) {
          setOffers((prev) =>
            prev.map((x) =>
              x.id === o.id
                ? { ...x, status: 'denied', respondedBy: 'auto — load booked', respondedAt }
                : x,
            ),
          );
          if (!demoMode && db) {
            void updateDoc(doc(db, 'offers', o.id), {
              status: 'denied',
              respondedBy: 'auto — load booked',
              respondedAt,
            }).catch(() => {});
          }
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [demoMode, stamp, currentUser, syncBoard],
  );

  /* v2.19.0 (Caleb, trip 580): move a load to another day ON THE SAME LANE.
     The id embeds the date, so a move is create-new + delete-old; history
     travels with an audit entry, the loadboard mirror doc for the old id is
     removed, and pending offers BLOCK the move (they reference the old id). */
  const moveLoad = useCallback(
    async (load: Load, toDate: string): Promise<string | null> => {
      const newId = `${load.laneId}_${toDate}`;
      if (loadsRef.current.some((l) => l.id === newId)) return 'That day already has a load on this lane.';
      if (offersRef.current.some((o) => o.loadId === load.id && o.status === 'pending')) {
        return 'This load has pending carrier offers - respond to them before moving it.';
      }
      const entry = stamp(`moved from ${load.date} to ${toDate}`);
      const moved: Load = { ...load, id: newId, date: toDate, history: [...(load.history ?? []), entry] };
      setLoads((prev) => [...prev.filter((l) => l.id !== load.id), moved]);
      if (!demoMode && db) {
        await setDoc(doc(db, 'loads', newId), moved).catch(writeFailed('Load move', 'matrix.book'));
        await deleteDoc(doc(db, 'loads', load.id)).catch(writeFailed('Load move (old-day cleanup)', 'matrix.book'));
        await deleteDoc(doc(db, 'loadboard', load.id)).catch(() => {});
      }
      void syncBoard([moved]);
      return null;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [demoMode, stamp, syncBoard],
  );

  /* Phase 4: clearing a booking off the hub is an audited admin action —
     stamps who/when so "Cleared today" can list it (imports leave no stamp). */
  const approveBooking = useCallback(
    async (id: string) => {
      await updateLoad(id, {
        bookingApproved: true,
        bookingApprovedBy: currentUser.name || currentUser.email,
        bookingApprovedAt: new Date().toISOString(),
      });
    },
    [updateLoad, currentUser],
  );

  /* Append-only Sales Hub note — recorded with author and timestamp, never edited in place. */
  const addHubNote = useCallback(
    async (id: string, text: string) => {
      if (!loadsRef.current.some((l) => l.id === id)) return;
      const entry = stamp(text.trim());
      const histEntry = { ...entry, action: `hub note: "${text.trim()}"` };
      setLoads((prev) =>
        prev.map((l) =>
          l.id === id
            ? { ...l, hubNoteLog: [...(l.hubNoteLog ?? []), entry], history: [...(l.history ?? []), histEntry] }
            : l,
        ),
      );
      if (!demoMode && db) {
        await updateDoc(doc(db, 'loads', id), {
          hubNoteLog: arrayUnion(entry),
          history: arrayUnion(histEntry),
        }).catch(writeFailed('Hub note', 'hub.fields'));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [demoMode, stamp],
  );

  /* Respond to a carrier offer: accept / counter / deny. */
  const respondOffer = useCallback(
    async (offerId: string, patch: Partial<Offer>) => {
      if (!offersRef.current.some((o) => o.id === offerId)) return;
      const respondedBy = currentUser.name || currentUser.email;
      const respondedAt = new Date().toISOString();
      setOffers((prev) =>
        prev.map((o) => (o.id === offerId ? { ...o, ...patch, respondedBy, respondedAt } : o)),
      );
      if (!demoMode && db) {
        await updateDoc(doc(db, 'offers', offerId), { ...patch, respondedBy, respondedAt }).catch(writeFailed('Offer response', 'hub.offers'));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [demoMode, currentUser],
  );

  /* Approve/reject a loadboard registration. Approving links the login to a
     carrier by MC — matching an existing carrier or creating one. */
  const respondCarrierUser = useCallback(
    async (uid: string, approve: boolean) => {
      const cu = carrierUsers.find((c) => c.uid === uid);
      if (!cu) return;
      const respondedBy = currentUser.name || currentUser.email;
      const respondedAt = new Date().toISOString();
      const status = approve ? 'approved' : 'rejected';
      setCarrierUsers((prev) => prev.map((c) => (c.uid === uid ? { ...c, status, respondedBy, respondedAt } : c)));
      if (!demoMode && db) {
        await updateDoc(doc(db, 'carrierUsers', uid), { status, respondedBy, respondedAt }).catch(() => {});
      }
      if (approve) {
        const mc = normalizeMc(cu.mcNumber);
        const existing = carriers.find(
          (c) => (mc && normalizeMc(c.mcNumber ?? '') === mc) || c.name.toLowerCase() === cu.company.toLowerCase(),
        );
        if (!existing) {
          const carrier: Carrier = { id: `carrier-${Date.now()}`, name: cu.company, mcNumber: cu.mcNumber };
          setCarriers((prev) => [...prev, carrier]);
          if (!demoMode && db) await setDoc(doc(db, 'carriers', carrier.id), carrier);
        } else if (mc && !normalizeMc(existing.mcNumber ?? '')) {
          setCarriers((prev) => prev.map((c) => (c.id === existing.id ? { ...c, mcNumber: cu.mcNumber } : c)));
          if (!demoMode && db) await updateDoc(doc(db, 'carriers', existing.id), { mcNumber: cu.mcNumber }).catch(() => {});
        }
      }
    },
    [demoMode, currentUser, carrierUsers, carriers],
  );

  /* Kick off Highway-contact email verification: the doc create triggers the
     sendCarrierVerification Cloud Function, which emails a single-use approve/
     deny link and keeps carrierUsers/{uid}.verification updated. */
  const requestCarrierVerification = useCallback(
    async (uid: string, contactEmail: string) => {
      const sentAt = new Date().toISOString();
      setCarrierUsers((prev) =>
        prev.map((c) => (c.uid === uid ? { ...c, verification: { contactEmail, sentAt, status: 'sent' } } : c)),
      );
      if (demoMode || !db) return;
      await setDoc(doc(collection(db, 'verificationRequests')), {
        carrierUid: uid,
        contactEmail,
        requestedBy: currentUser.name || currentUser.email,
        requestedAt: sentAt,
        status: 'pending',
      });
    },
    [demoMode, currentUser],
  );

  /* Note deletion — only offered to the note's creator; the removal itself is logged. */
  const deleteHubNote = useCallback(
    async (id: string, noteAt: string) => {
      const cur = loadsRef.current.find((l) => l.id === id);
      const note = (cur?.hubNoteLog ?? []).find((n) => n.at === noteAt);
      if (!cur || !note) return;
      const delEntry = stamp(`deleted hub note: "${note.action}"`);
      setLoads((prev) =>
        prev.map((l) =>
          l.id === id
            ? {
                ...l,
                hubNoteLog: (l.hubNoteLog ?? []).filter((n) => n.at !== noteAt),
                history: [...(l.history ?? []), delEntry],
              }
            : l,
        ),
      );
      if (!demoMode && db) {
        /* Remove by timestamp against the SERVER copy in a transaction.
           arrayRemove needs an exact element match and fails silently when the
           local copy has drifted from Firestore — that's how deleted notes
           came back after refresh. */
        const ref = doc(db, 'loads', id);
        await runTransaction(db, async (tx) => {
          const snap = await tx.get(ref);
          if (!snap.exists()) return;
          const log = ((snap.data().hubNoteLog ?? []) as HistoryEntry[]).filter((n) => n.at !== noteAt);
          tx.update(ref, { hubNoteLog: log, history: arrayUnion(delEntry) });
        }).catch(writeFailed('Note delete', 'hub.fields'));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [demoMode, stamp],
  );

  /* Duplicate-proof (v2.8.1): a name that normalizes to an existing carrier
     REUSES it (backfilling a missing MC) — creating "RAASO TRUCKING LLC"
     next to "Raaso Trucking LLC." is no longer possible from any path
     (editor, offer accept, registration approve). */
  const addCarrier = useCallback(
    async (name: string, mcNumber?: string) => {
      const key = normalizeCarrierName(name);
      const existing = carriers.find((c) => normalizeCarrierName(c.name) === key);
      if (existing) {
        const mc = mcNumber?.trim();
        if (mc && !existing.mcNumber) {
          setCarriers((prev) => prev.map((c) => (c.id === existing.id ? { ...c, mcNumber: mc } : c)));
          if (!demoMode && db) await updateDoc(doc(db, 'carriers', existing.id), { mcNumber: mc }).catch(() => {});
        }
        return existing;
      }
      const carrier: Carrier = {
        id: `carrier-${Date.now()}`,
        name: name.trim(),
        mcNumber: mcNumber?.trim() ?? '',
      };
      setCarriers((prev) => [...prev, carrier]);
      if (!demoMode && db) await setDoc(doc(db, 'carriers', carrier.id), carrier);
      return carrier;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [demoMode, carriers],
  );

  /* Narrow lane writes (reorder ✥ / ⓘ service notes): FIELD-LEVEL updateDoc —
     the rules only allow these key-sets for the matching permission, so the
     whole-doc updateLane path would be rejected for non-lane-editors. */
  const patchLane = useCallback(
    async (id: string, patch: Partial<Lane>) => {
      setLanes((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
      if (!demoMode && db) await updateDoc(doc(db, 'lanes', id), patch as Record<string, unknown>).catch(writeFailed('Lane reorder / service note', 'matrix.reorder'));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [demoMode],
  );

  const updateLane = useCallback(
    async (id: string, patch: Partial<Lane>) => {
      const before = lanesRef.current.find((l) => l.id === id);
      let updated: Lane | undefined;
      setLanes((prev) =>
        prev.map((l) => {
          if (l.id !== id) return l;
          updated = { ...l, ...patch };
          return updated;
        }),
      );
      if (!demoMode && db && updated) await setDoc(doc(db, 'lanes', id), updated);
      /* v2.20.0 (Caleb): a Loading-default change in Integrity cascades into
         every FUTURE load on the lane (uncovered AND covered), which flows to
         the Sales Hub and board automatically via updateLoad. Computed from
         loadsRef, never from setState-captured values (rule 9). */
      /* DEDICATED FLOWS FROM BRAVO (Caleb 07/14): marking a lane dedicated in
         Integrity auto-creates its Dedicated-section row (day grid defaults to
         the lane's frequency days, LC = whoever dedicated it); clearing or
         switching the carrier removes the old row. The XLSX import is retired. */
      if (updated && before && ('dedicatedCarrier' in patch || 'dedicated' in patch)) {
        const slug = (n: string) => n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        const trip = laneTripNumber(updated);
        const newC = updated.dedicated ? (updated.dedicatedCarrier ?? '').trim() : '';
        const oldC = before.dedicated ? (before.dedicatedCarrier ?? '').trim() : '';
        if (trip && oldC && oldC !== newC) {
          const gone = dedicatedRef.current.filter((d) => d.tripNumber === trip && slug(d.carrier) === slug(oldC));
          if (gone.length) {
            const ids = new Set(gone.map((g) => g.id));
            setDedicated((prev) => prev.filter((d) => !ids.has(d.id)));
            if (!demoMode && db) for (const g of gone) void deleteDoc(doc(db, 'dedicated', g.id)).catch(() => {});
          }
        }
        if (trip && newC && slug(newC) !== slug(oldC)) {
          const rowId = `${trip}_${slug(newC)}`;
          if (!dedicatedRef.current.some((d) => d.id === rowId)) {
            const wds = expectedWeekdays(updated.frequency ?? '');
            const days = Array.from({ length: 7 }, (_, mi) => (wds ? wds.includes((mi + 1) % 7) : true));
            const row: DedicatedLane = {
              id: rowId,
              tripNumber: trip,
              origin: (updated.origin ?? '').split('\n')[0],
              destination: (updated.destination ?? '').split('\n')[0],
              miles: laneMiles(updated),
              carrier: newC,
              carrierRate: firstMoney(updated.dedicatedRate ?? ''),
              revenuePerDay: null,
              days,
              everyDay: !wds,
              notes: updated.dedicatedNotes ?? '',
              validated: false,
              lc: currentUser.name || currentUser.email,
              updatedAt: new Date().toISOString(),
              updatedBy: currentUser.name || currentUser.email,
            };
            setDedicated((prev) => [...prev, row]);
            if (!demoMode && db) void setDoc(doc(db, 'dedicated', rowId), row);
          }
        }
      }
      if ('defaultEquipment' in patch) {
        const t = todayCentral();
        const next = patch.defaultEquipment ?? '';
        for (const l of loadsRef.current.filter(
          (x) => x.laneId === id && x.date >= t && (x.equipment ?? '') !== next,
        )) {
          void updateLoad(l.id, { equipment: next });
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [demoMode, updateLoad],
  );

  const addLane = useCallback(
    async (lane: Omit<Lane, 'id' | 'sortOrder'>) => {
      const full: Lane = {
        ...lane,
        id: `lane-x-${Date.now()}`,
        sortOrder: Math.max(0, ...lanes.map((l) => l.sortOrder)) + 1,
      };
      setLanes((prev) => [...prev, full]);
      if (!demoMode && db) await setDoc(doc(db, 'lanes', full.id), full);
      return full;
    },
    [demoMode, lanes],
  );

  const removeLane = useCallback(
    async (id: string) => {
      setLanes((prev) => prev.filter((l) => l.id !== id));
      if (!demoMode && db) await deleteDoc(doc(db, 'lanes', id));
    },
    [demoMode],
  );

  /* Provisioning: UI constrains choices to creatableRoles(); firestore.rules
     re-enforce the creation matrix server-side. FedCom only means anything on
     role 'admin' — clear it on any other role so the tag can't go stale. */
  const setUserRole = useCallback(
    async (id: string, role: Role, fedCom?: boolean) => {
      const tag = role === 'admin' ? !!fedCom : false;
      setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, role, fedCom: tag } : u)));
      if (!demoMode && db) {
        await updateDoc(doc(db, 'users', id), { role, fedCom: tag }).catch(() => {});
      }
    },
    [demoMode],
  );

  /* v2.11: owner-set granular overrides. Arrays are stored as-is; closure
     logic lives in permissions.ts (client) and firestore.rules (server). */
  const setUserPermissions = useCallback(
    async (id: string, permAllow: string[], permDeny: string[]) => {
      setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, permAllow, permDeny } : u)));
      if (!demoMode && db) {
        await updateDoc(doc(db, 'users', id), { permAllow, permDeny }).catch(() => {});
      }
    },
    [demoMode],
  );

  /* v2.32.0 (Caleb): the OWNER reshapes what each ROLE can do, live. The
     owner column is immutable (defaultPerms ignores the matrix for owner),
     and the settings/roleDefaults doc is owner-only in firestore.rules. */
  const saveRoleDefaults = useCallback(
    async (matrix: Record<string, string[]>) => {
      const { owner: _drop, ...safe } = matrix; /* the owner row can never be stored */
      setRoleMatrix(safe);
      setRoleMatrixState(safe);
      if (!demoMode && db) {
        await setDoc(doc(db, 'settings', 'roleDefaults'), safe).catch(writeFailed('Role defaults', 'owner only'));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [demoMode],
  );

  const saveMarginSettings = useCallback(
    async (patch: Partial<MarginSettings>) => {
      setMarginSettings((prev) => ({ ...prev, ...patch }));
      if (!demoMode && db) {
        await setDoc(doc(db, 'settings', 'margin'), patch, { merge: true });
      }
    },
    [demoMode],
  );

  /* §9.1: QA Manager (or Owner) marks BOL verified — audited on the load. */
  const approveBol = useCallback(
    async (id: string) => {
      await updateLoad(id, {
        bolVerified: true,
        bolVerifiedBy: currentUser.name || currentUser.email,
        bolVerifiedAt: new Date().toISOString(),
      });
    },
    [updateLoad, currentUser],
  );

  /* §8.2: per-rep daily booked-loads goal — FedCom/Owner only (rules re-check). */
  const setUserGoal = useCallback(
    async (id: string, dailyGoal: number) => {
      setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, dailyGoal } : u)));
      if (!demoMode && db) await updateDoc(doc(db, 'users', id), { dailyGoal }).catch(() => {});
    },
    [demoMode],
  );

  /* Inline TRM edits (Caleb: stop round-tripping the spreadsheet) — the weekly
     Master upload remains the bulk sync; both stamp updatedAt/updatedBy. */
  const saveTrm = useCallback(
    async (id: string, patch: { currentRate?: number | null; miles?: number | null; freqCode?: string }) => {
      const stamp = { updatedAt: new Date().toISOString(), updatedBy: currentUser.name || currentUser.email };
      setIntegrity((prev) => prev.map((r) => (r.id === id ? { ...r, trm: { ...r.trm, ...patch }, ...stamp } : r)));
      if (!demoMode && db) {
        const dotted: Record<string, unknown> = { ...stamp };
        for (const [k, v] of Object.entries(patch)) dotted[`trm.${k}`] = v;
        await updateDoc(doc(db, 'integrity', id), dotted).catch(() => {});
      }
    },
    [demoMode, currentUser],
  );

  /* §7.1 dedicated master: XLSX import replaces matching rows (id = trip_carrier);
     day edits are field-level. §7.3 issue flag lives on the carrier record. */
  const importDedicated = useCallback(
    async (rows: DedicatedLane[]) => {
      setDedicated((prev) => {
        const byId = new Map(prev.map((d) => [d.id, d]));
        rows.forEach((r) => byId.set(r.id, r));
        return [...byId.values()];
      });
      if (!demoMode && db) {
        for (let i = 0; i < rows.length; i += 450) {
          const batch = writeBatch(db);
          for (const r of rows.slice(i, i + 450)) batch.set(doc(db, 'dedicated', r.id), r);
          await batch.commit();
        }
      }
      return rows.length;
    },
    [demoMode],
  );

  const updateDedicated = useCallback(
    async (id: string, patch: Partial<DedicatedLane>) => {
      const stamped = { ...patch, updatedAt: new Date().toISOString(), updatedBy: currentUser.name || currentUser.email };
      setDedicated((prev) => prev.map((d) => (d.id === id ? { ...d, ...stamped } : d)));
      if (!demoMode && db) await updateDoc(doc(db, 'dedicated', id), stamped).catch(() => {});
    },
    [demoMode, currentUser],
  );

  /* v2.18.0 (Caleb): pull a carrier off dedicated entirely -- pricing tier +
     FedCom admins (rules-enforced). */
  const removeDedicated = useCallback(
    async (id: string) => {
      setDedicated((prev) => prev.filter((d) => d.id !== id));
      if (!demoMode && db) {
        await deleteDoc(doc(db, 'dedicated', id)).catch(writeFailed('Dedicated removal', 'integrity.dedicated'));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [demoMode],
  );

  /* v2.18.0: a Matrix lane with a trip code but NO Integrity record (trip 6
     et al. slipped the Phase 3 migration) gets a stub so pricing can band it --
     the Matrix must always be a reflection of the Integrity database. */
  const createIntegrityRecord = useCallback(
    async (lane: Lane) => {
      const id = integrityIdForTripCode(lane.tripCode);
      if (!id || integrityRef.current.some((r) => r.id === id)) return;
      const [contract, tripNumber] = id.split('_');
      const rec: IntegrityRecord = {
        id,
        contract,
        tripNumber,
        tripCode: lane.tripCode,
        odLabel: `${lane.origin} \u2192 ${lane.destination}`,
        bands: { weekday: { target: null, ceiling: null }, weekend: { target: null, ceiling: null } },
        updatedAt: new Date().toISOString(),
        updatedBy: currentUser.name || currentUser.email,
      };
      setIntegrity((prev) => [...prev, rec]);
      if (!demoMode && db) {
        await setDoc(doc(db, 'integrity', id), rec).catch(writeFailed('Integrity record', 'integrity.bands'));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [demoMode, currentUser],
  );

  const setCarrierIssue = useCallback(
    async (id: string, issue: boolean) => {
      setCarriers((prev) => prev.map((c) => (c.id === id ? { ...c, issue } : c)));
      if (!demoMode && db) await updateDoc(doc(db, 'carriers', id), { issue }).catch(() => {});
    },
    [demoMode],
  );

  /* Carrier database tab: field-level patches (MC / DOT / notes / issue). */
  const updateCarrier = useCallback(
    async (id: string, patch: Partial<Carrier>) => {
      setCarriers((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
      if (!demoMode && db) await updateDoc(doc(db, 'carriers', id), patch).catch(() => {});
    },
    [demoMode],
  );

  const setMoraleEnabled = useCallback(
    async (enabled: boolean) => {
      setMoraleState(enabled);
      if (!demoMode && db) await setDoc(doc(db, 'settings', 'morale'), { enabled }, { merge: true });
    },
    [demoMode],
  );

  /* Per-user badge activation (owner checkbox on Team & Roles). */
  const setUserMorale = useCallback(
    async (id: string, moraleOk: boolean) => {
      setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, moraleOk } : u)));
      if (!demoMode && db) await updateDoc(doc(db, 'users', id), { moraleOk }).catch(() => {});
    },
    [demoMode],
  );

  /* Self-service: users may write ONLY their own team fields (rules-enforced). */
  const sendRateCon = useCallback(
    async (loadId: string, toEmail: string, saveToCarrierId?: string) => {
      if (demoMode) { window.alert('Demo mode — rate cons send from the live app only.'); return; }
      const fn = httpsCallable(getFunctions(app!, 'us-central1'), 'sendRateCon');
      await fn({ loadId, toEmail, saveToCarrierId });
    },
    [demoMode],
  );

  const saveTrailerSettings = useCallback(
    async (patch: Partial<TrailerSettings>) => {
      setTrailerSettings((prev) => ({ ...prev, ...patch }));
      if (!demoMode && db) await setDoc(doc(db, 'settings', 'trailers'), patch, { merge: true });
    },
    [demoMode],
  );

  /* T&T facility directory: whole-doc set is safe — tiny docs, single-writer flow */
  const saveFacility = useCallback(
    async (f: Facility) => {
      const stamped = { ...f, updatedAt: new Date().toISOString(), updatedBy: currentUser.name || currentUser.email };
      setFacilities((prev) => {
        const i = prev.findIndex((x) => x.id === f.id);
        return i >= 0 ? prev.map((x) => (x.id === f.id ? stamped : x)) : [...prev, stamped];
      });
      if (!demoMode && db) await setDoc(doc(db, 'facilities', f.id), stamped);
    },
    [demoMode, currentUser],
  );

  const setMyTeam = useCallback(
    async (team: string, teamLogoUrl: string) => {
      setUsers((prev) => prev.map((u) => (u.id === currentUser.id ? { ...u, team, teamLogoUrl } : u)));
      if (!demoMode && db && currentUser.id) {
        await updateDoc(doc(db, 'users', currentUser.id), { team, teamLogoUrl }).catch(() => {});
      }
    },
    [demoMode, currentUser.id],
  );

  const importLoads = useCallback(
    async (incoming: Load[]) => {
      const entry = stamp('imported from LoadStop');
      const byId = new Map(loadsRef.current.map((l) => [l.id, l]));
      const created: Load[] = [];
      const patched: Array<{ id: string; patch: Record<string, unknown>; next: Load }> = [];
      for (const inc of incoming) {
        const existing = byId.get(inc.id);
        if (existing) {
          const fields: Partial<Load> = {
            loadNumber: inc.loadNumber || existing.loadNumber,
            carrier: inc.carrier || existing.carrier,
            rateNotes: inc.rateNotes || existing.rateNotes,
            status:
              inc.carrier || existing.carrier
                ? ['exposed', 'covered'].includes(existing.status)
                  ? 'covered'
                  : existing.status
                : existing.status,
            /* carriers arriving via TMS import are pre-approved bookings */
            bookingApproved: existing.bookingApproved ?? !!(inc.carrier || existing.carrier),
          };
          const next: Load = { ...existing, ...fields, history: [...(existing.history ?? []), entry] };
          patched.push({ id: inc.id, patch: { ...fields, history: arrayUnion(entry) }, next });
          byId.set(inc.id, next);
        } else {
          const next: Load = { ...inc, bookingApproved: !!inc.carrier, history: [entry] };
          created.push(next);
          byId.set(inc.id, next);
        }
      }
      setLoads([...byId.values()]);
      if (!demoMode && db) {
        /* Existing docs get FIELD-LEVEL patches only — the old whole-doc
           batch.set from client state clobbered concurrent edits and
           resurrected deleted notes / dropped night pins (v1.9.0 fix). */
        let batch = writeBatch(db);
        let n = 0;
        const flush = async () => { if (n) { await batch.commit(); batch = writeBatch(db!); n = 0; } };
        for (const l of created) {
          batch.set(doc(db, 'loads', l.id), l);
          if (++n >= 450) await flush();
        }
        for (const p of patched) {
          batch.update(doc(db, 'loads', p.id), p.patch);
          if (++n >= 450) await flush();
        }
        await flush();
        void syncBoard([...created, ...patched.map((p) => p.next)]);
      }
      return created.length + patched.length;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [demoMode, stamp, syncBoard],
  );

  /* ---- Phase 3: integrity DB mutations (pricing tier; rules enforce) ---- */

  /* Save one band (weekday or weekend) with a required reason code. Field-level
     write + an immutable bandHistory entry — mirrors the Console's audit model. */
  const saveBand = useCallback(
    async (id: string, dayType: 'weekday' | 'weekend', band: Band, reasonCode: string) => {
      const by = currentUser.name || currentUser.email;
      const at = new Date().toISOString();
      const entry: BandHistoryEntry = {
        dayType,
        target: band.target,
        ceiling: band.ceiling,
        reasonCode,
        setBy: by,
        at,
      };
      setIntegrity((prev) =>
        prev.map((r) =>
          r.id === id
            ? { ...r, bands: { ...r.bands, [dayType]: band }, updatedAt: at, updatedBy: by }
            : r,
        ),
      );
      if (!demoMode && db) {
        await updateDoc(doc(db, 'integrity', id), {
          [`bands.${dayType}`]: band,
          updatedAt: at,
          updatedBy: by,
        }).catch(writeFailed('Band update', 'integrity.bands'));
        await setDoc(doc(db, 'integrity', id, 'bandHistory', `${Date.now()}`), entry).catch(() => {});
      }
    },
    [demoMode, currentUser],
  );

  const getBandHistory = useCallback(
    async (id: string): Promise<BandHistoryEntry[]> => {
      if (demoMode || !db) return [];
      const snap = await getDocs(collection(db, 'integrity', id, 'bandHistory'));
      return snap.docs
        .map((d) => d.data() as BandHistoryEntry)
        .sort((a, b) => b.at.localeCompare(a.at));
    },
    [demoMode],
  );

  /* Weekly Master TRM upload — reconcile, never overwrite: new trips are added
     (with EMPTY bands), existing trips get ONLY their trm block refreshed, and
     trips absent from the file are reported, not deleted. Tuned bands untouched. */
  const importTrm = useCallback(
    async (records: IntegrityRecord[], filename: string) => {
      const existing = new Map(integrity.map((r) => [r.id, r]));
      const incoming = new Set(records.map((r) => r.id));
      let added = 0, updated = 0;
      const missing = [...existing.keys()].filter((id) => !incoming.has(id));
      const meta: TrmMeta = {
        filename,
        importedAt: new Date().toISOString(),
        importedBy: currentUser.name || currentUser.email,
      };
      setIntegrity((prev) => {
        const byId = new Map(prev.map((r) => [r.id, r]));
        for (const rec of records) {
          const cur = byId.get(rec.id);
          byId.set(rec.id, cur ? { ...cur, odLabel: cur.odLabel || rec.odLabel, trm: rec.trm } : rec);
        }
        return [...byId.values()];
      });
      if (!demoMode && db) {
        for (let i = 0; i < records.length; i += 400) {
          const batch = writeBatch(db);
          for (const rec of records.slice(i, i + 400)) {
            if (existing.has(rec.id)) {
              batch.update(doc(db, 'integrity', rec.id), { trm: rec.trm });
            } else {
              batch.set(doc(db, 'integrity', rec.id), rec);
            }
          }
          await batch.commit();
        }
        await setDoc(doc(db, 'integrityMeta', 'trm'), meta);
      }
      setTrmMeta(meta);
      for (const rec of records) existing.has(rec.id) ? updated++ : added++;
      return { added, updated, missing };
    },
    [demoMode, integrity, currentUser],
  );

  const value = useMemo(
    () => ({
      demoMode,
      ready,
      currentUser,
      lanes,
      loads,
      carriers,
      users,
      statuses,
      offers,
      respondOffer,
      carrierUsers,
      respondCarrierUser,
      requestCarrierVerification,
      upsertLoad,
      updateLoad,
      approveBooking,
      addHubNote,
      deleteHubNote,
      addCarrier,
      updateLane,
      patchLane,
      addLane,
      removeLane,
      setUserRole,
      setUserPermissions,
      permToast,
      roleMatrix,
      saveRoleDefaults,
      moveLoad,
      removeDedicated,
      createIntegrityRecord,
      importLoads,
      rebuildLoadboard,
      capacity,
      marginSettings,
      saveMarginSettings,
      approveBol,
      setUserGoal,
      dedicated,
      importDedicated,
      updateDedicated,
      setCarrierIssue,
      updateCarrier,
      moraleEnabled,
      setMoraleEnabled,
      setMyTeam,
      setUserMorale,
      facilities,
      saveFacility,
      trailerSettings,
      saveTrailerSettings,
      sendRateCon,
      integrity,
      saveTrm,
      trmMeta,
      saveBand,
      getBandHistory,
      importTrm,
    }),
    [demoMode, ready, currentUser, lanes, loads, carriers, users, statuses, offers, carrierUsers,
     respondOffer, respondCarrierUser, requestCarrierVerification, upsertLoad, updateLoad, approveBooking, addHubNote, deleteHubNote, addCarrier, updateLane, patchLane, addLane, removeLane, setUserRole, setUserPermissions, importLoads, rebuildLoadboard,
     capacity, marginSettings, saveMarginSettings, approveBol, setUserGoal, dedicated, importDedicated, updateDedicated, setCarrierIssue, updateCarrier, moraleEnabled, setMoraleEnabled, setMyTeam, setUserMorale, facilities, saveFacility, trailerSettings, saveTrailerSettings, sendRateCon, integrity, saveTrm, trmMeta, saveBand, getBandHistory, importTrm, permToast, roleMatrix, saveRoleDefaults, moveLoad, removeDedicated, createIntegrityRecord],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreShape {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore outside StoreProvider');
  return ctx;
}

/* One-time seeding of a fresh Firestore project from the bundled Alpha Matrix data. */
export async function seedFirestore(): Promise<void> {
  if (!db) throw new Error('Firebase not configured');
  const all: Array<{ col: string; id: string; data: unknown }> = [
    ...(seedLanes as Lane[]).map((l) => ({ col: 'lanes', id: l.id, data: l })),
    ...(seedLoads as Load[]).map((l) => ({
      col: 'loads',
      id: l.id,
      data: { ...l, status: legacyStatus(l) },
    })),
    ...(seedCarriers as Carrier[]).map((c) => ({ col: 'carriers', id: c.id, data: c })),
  ];
  for (let i = 0; i < all.length; i += 450) {
    const batch = writeBatch(db);
    for (const item of all.slice(i, i + 450)) {
      batch.set(doc(db, item.col, item.id), item.data as Record<string, unknown>);
    }
    await batch.commit();
  }
}
