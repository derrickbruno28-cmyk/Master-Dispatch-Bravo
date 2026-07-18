import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useStore } from '../data/store';
import { cleanTimes, dateRange, finalDelTime, headerLabel, isoToday, weekStart, addDays, todayCentral } from '../dates';
import { GH_CARRIER_RE, freqDescription, freqDisplay, STATUS_GROUPS, isExtraLane, freqDateFor, activeChargeback, assetLaneAllowed, autoTeamSolo, dedicatedCoversDate, fmtRateStr, isAssetRep, isExposed, laneShortName, legStatusLabel, runsOn, shuttleLegExposed, DEFAULT_SECTION, type Lane, type Load } from '../types';

/** Loaded miles as a bare number — the sheet's miles column can carry
    transit/buffer notes after the figure. */
function laneMiles(lane: Lane): string {
  return /\d[\d,.]*/.exec(lane.miles ?? '')?.[0] ?? '';
}
import { fmtBand } from '../pricing';
import { can } from '../permissions';
import LoadEditor from '../components/LoadEditor';
import LaneEditor from '../components/LaneEditor';
import LaneDetails from '../components/LaneDetails';

const WEEK_DAYS = 9; // Sat -> following Sun, matching Alpha Matrix weeks

/* Alpha-style search highlight (Think Tank 07/15): the matched substring
   glows in lane names and cell text while a search is active. */
function Hi({ text, q }: { text: string; q: string }) {
  const needle = q.trim().toLowerCase();
  if (!needle) return <>{text}</>;
  const i = text.toLowerCase().indexOf(needle);
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark className="search-hit">{text.slice(i, i + needle.length)}</mark>
      {text.slice(i + needle.length)}
    </>
  );
}

export default function MatrixView() {
  const { lanes, loads, statuses, currentUser, integrity, dedicated, moveLoad, patchLane } = useStore();
  const integrityByTrip = useMemo(
    () => new Map(integrity.map((r) => [r.tripCode.toUpperCase(), r])),
    [integrity],
  );
  const role = currentUser.role;
  /* Lane/planning data belongs to the Pricing tier — plain Admin no longer edits lanes (§2.2). */
  const laneEditor = can(currentUser, 'integrity.lanes');
  /* Extras/overflow lane creation is its own permission (brokers add extras
     runs all day) — full lane editing stays with the pricing tier. */
  const mayAddExtras = laneEditor || can(currentUser, 'matrix.addLane');
  const mayTouch = (lane: Lane) => can(currentUser, 'matrix.book') && (!isAssetRep(role) || assetLaneAllowed(lane));
  const mayCreate = (lane: Lane) => can(currentUser, 'matrix.create') && (!isAssetRep(role) || assetLaneAllowed(lane));
  /* Default = the CURRENT week: weekStart snaps to the Saturday on/before
     today (Central), so the board rolls forward Saturday midnight CT.
     (Was anchored to the earliest load date — opened on stale week 27.) */
  const [start, setStart] = useState(() => weekStart(isoToday()));
  const [search, setSearch] = useState('');
  const [trkSearch, setTrkSearch] = useState(''); // dedicated TRK# finder (AJG etc.)
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ lane: Lane; date: string } | null>(null);
  const [laneEdit, setLaneEdit] = useState<{ lane: Lane | null; section?: string } | null>(null);
  /* v2.19.0 long-press move (Caleb, trip 580): hold a load ~half a second to
     arm move mode, then click (or drag-release onto) an OPEN day in the SAME
     row. Esc cancels. Cross-callback state lives in refs (rule 9a). */
  const [moveSrc, setMoveSrc] = useState<{ load: Load; lane: Lane } | null>(null);
  const moveSrcRef = useRef<{ load: Load; lane: Lane } | null>(null);
  const pressTimer = useRef<number | undefined>(undefined);
  const lastDropAt = useRef(0);
  const armMove = (load: Load, lane: Lane) => {
    moveSrcRef.current = { load, lane };
    setMoveSrc(moveSrcRef.current);
  };
  const disarmMove = () => {
    moveSrcRef.current = null;
    setMoveSrc(null);
  };
  const confirmDrop = (toDate: string) => {
    const src = moveSrcRef.current;
    if (!src) return;
    if (window.confirm(`Move load ${src.load.loadNumber || '(no LS#)'} from ${headerLabel(src.load.date)} to ${headerLabel(toDate)} on this lane?`)) {
      lastDropAt.current = Date.now();
      void moveLoad(src.load, toDate).then((err) => err && window.alert(err));
    }
    disarmMove();
  };
  const [details, setDetails] = useState<Lane | null>(null);
  /* GLOBAL drag-reorder (Caleb 07/14) — permission-gated because everyone
     sees the result. Drop before a target row → sortOrder midpoint between
     its neighbors; dropping into another section ADOPTS that section. */
  const mayReorder = can(currentUser, 'matrix.reorder');
  const dragIdRef = useRef<string | null>(null); // ref: drop can fire before a re-render lands
  const [dropId, setDropId] = useState<string | null>(null);
  function handleDrop(targetLane: Lane) {
    const srcId = dragIdRef.current;
    dragIdRef.current = null; setDropId(null);
    if (!srcId || srcId === targetLane.id) return;
    const ordered = [...lanes].filter((l) => l.active).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    const ti = ordered.findIndex((l) => l.id === targetLane.id);
    if (ti < 0) return;
    const prevRow = ordered.slice(0, ti).filter((l) => l.id !== srcId).pop();
    const above = prevRow?.sortOrder ?? (targetLane.sortOrder ?? 0) - 2;
    const newOrder = (above + (targetLane.sortOrder ?? 0)) / 2;
    const patch: Partial<Lane> = { sortOrder: newOrder };
    const src = lanes.find((l) => l.id === srcId);
    if (src && (src.section || DEFAULT_SECTION) !== (targetLane.section || DEFAULT_SECTION)) {
      patch.section = targetLane.section || DEFAULT_SECTION;
    }
    void patchLane(srcId, patch);
  }
  const dragProps = (lane: Lane) => mayReorder ? {
    draggable: true,
    onDragStart: () => { dragIdRef.current = lane.id; },
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); setDropId(lane.id); },
    onDragLeave: () => setDropId((d) => (d === lane.id ? null : d)),
    onDrop: (e: React.DragEvent) => { e.preventDefault(); handleDrop(lane); },
    onDragEnd: () => { dragIdRef.current = null; setDropId(null); },
  } : {};
  const [searchParams, setSearchParams] = useSearchParams();

  /* deep link from Sales Hub: /matrix?load=<loadId> opens that load's modal */
  useEffect(() => {
    const loadId = searchParams.get('load');
    if (!loadId || !lanes.length) return;
    const target = loads.find((l) => l.id === loadId);
    const lane = target && lanes.find((l) => l.id === target.laneId);
    if (target && lane) {
      setStart(weekStart(target.date));
      setEditing({ lane, date: target.date });
    }
    setSearchParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, lanes.length]);

  const days = useMemo(() => dateRange(start, WEEK_DAYS), [start]);

  /* v2.32.0 (Caleb): searching a load # from another week flips the board to
     that week; clearing the search returns to wherever you were. */
  const preSearchWeek = useRef<string | null>(null);
  useEffect(() => {
    const qq = search.trim().toLowerCase();
    if (!qq) {
      if (preSearchWeek.current) { setStart(preSearchWeek.current); preSearchWeek.current = null; }
      return;
    }
    if (preSearchWeek.current == null) preSearchWeek.current = start;
    const window = dateRange(start, WEEK_DAYS);
    if (loads.some((l) => window.includes(l.date) && (l.loadNumber ?? '').toLowerCase().includes(qq))) return;
    const matches = loads.filter((l) => (l.loadNumber ?? '').toLowerCase().includes(qq));
    if (!matches.length) return;
    const exact = matches.find((l) => l.loadNumber.toLowerCase() === qq);
    const target = exact ?? [...matches].sort((a, b) => b.date.localeCompare(a.date))[0];
    setStart(weekStart(target.date));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const loadMap = useMemo(() => {
    const m = new Map<string, Load>();
    for (const l of loads) m.set(`${l.laneId}_${l.date}`, l);
    return m;
  }, [loads]);

  const statusMap = useMemo(() => new Map(statuses.map((s) => [s.key, s])), [statuses]);
  const laneMap = useMemo(() => new Map(lanes.map((l) => [l.id, l])), [lanes]);

  function effectiveStatus(load: Load): string {
    if (load.status === 'chargeback') return 'chargeback';
    if (isExposed(load)) {
      const lane = laneMap.get(load.laneId);
      if (lane?.dedicated && lane.dedicatedCarrier) {
        /* §7.1: only expect the dedicated carrier on days the MASTER says
           they're dedicated — the "expects them on a Mon trip" fix. */
        return dedicatedCoversDate(dedicated, lane, load.date) === false ? 'exposed' : 'dedicated_pending';
      }
      return 'exposed';
    }
    return load.status;
  }

  /* GH Logistics stands out as a royal-blue pill in Matrix cells (Caleb 07/17)
     — the only carrier with name styling. Pills the literal "GH Logistics"
     wherever it appears (plain, "CB: GH Logistics", shuttle legs); other text
     keeps the search highlight. */
  function ghCarrier(text: string) {
    const m = /GH Logistics/i.exec(text);
    if (!m) return <Hi text={text} q={search} />;
    return (
      <>
        {text.slice(0, m.index) && <Hi text={text.slice(0, m.index)} q={search} />}
        <span className="gh-pill">{text.slice(m.index, m.index + m[0].length)}</span>
        {text.slice(m.index + m[0].length)}
      </>
    );
  }

  function carrierLine(load: Load, lane: Lane, eff: string): string {
    if (eff === 'not_running') return 'NOT RUNNING';
    if (eff === 'omitted') return 'OMITTED';
    if (eff === 'chargeback') return load.carrier ? `CB: ${load.carrier}` : 'CHARGEBACK — RECOVER';
    if (load.carrier) return load.carrier;
    if (eff === 'dedicated_pending') return `SEND TO ${lane.dedicatedCarrier?.toUpperCase()}`;
    return 'NEEDS COVERAGE';
  }

  function rateLine(load: Load, lane: Lane, eff: string): string {
    if (eff === 'not_running') return [load.tonuBill ? 'TONU BILL' : '', load.cancelReason || ''].filter(Boolean).join(' · ');
    /* omitted = SITE cancelled — black cell, everything in caps */
    if (eff === 'omitted') return [load.tonuBill ? 'TONU BILL' : '', (load.cancelReason || '').toUpperCase()].filter(Boolean).join(' · ');
    const truck = load.truckNumber ? `TRK ${load.truckNumber}` : '';
    const rate = fmtRateStr(load.rate ?? '');
    /* full notes — reps write multi-line context and it must not truncate */
    const note = load.rateNotes.trim();
    if (truck || rate || note) return [rate, truck, note].filter(Boolean).join(' · ');
    if (eff === 'dedicated_pending' && lane.dedicatedRate) return `Dedicated @ ${lane.dedicatedRate}`;
    return '';
  }

  /* Persistent chargeback visibility (Caleb 07/09): once another carrier
     covers the trip, a slim strip in the chargeback color keeps the CB
     carrier + amount on the cell until recovered/waived. */
  function cbStrip(load: Load, eff: string) {
    if (!activeChargeback(load) || eff === 'chargeback') return null;
    return (
      <div className="cb-strip">
        CB {load.chargebackCarrier || '—'}{load.chargebackAmount ? ` · $${load.chargebackAmount.replace(/^\$/, '')}` : ''}
      </div>
    );
  }

  /* Loadout tag (Caleb 07/17): a PO load carrying a trailer # wears a small
     L.O.T chip so the cell shows the obligation at a glance. */
  function lotTag(load: Load) {
    if (!(load.trailerNumber ?? '').trim()) return null;
    return <div className="lot-tag">L.O.T Trailer #{load.trailerNumber!.trim()}</div>;
  }

  /* dates (this week) that already have imported loads — used for MISSING? flags */
  const datesWithLoads = useMemo(
    () => new Set(loads.filter((l) => l.loadNumber).map((l) => l.date)),
    [loads],
  );
  const today = todayCentral();

  useEffect(() => {
    if (!moveSrc) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && disarmMove();
    /* true drag: releasing the pointer over a valid open cell drops there;
       releasing over the source keeps move mode armed (click-to-place). */
    const up = (e: PointerEvent) => {
      const src = moveSrcRef.current;
      if (!src) return;
      const td = document.elementFromPoint(e.clientX, e.clientY)?.closest('td[data-md]') as HTMLElement | null;
      if (!td) return;
      if (td.dataset.ml === src.lane.id && td.dataset.me === '1' && td.dataset.md && td.dataset.md !== src.load.date) {
        confirmDrop(td.dataset.md);
      }
    };
    window.addEventListener('keydown', esc);
    document.addEventListener('pointerup', up);
    return () => { window.removeEventListener('keydown', esc); document.removeEventListener('pointerup', up); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moveSrc]);

  /* searchable text per lane: name + trip + dedicated carrier + EVERY load
     detail — notes (driver names like "Juan"), truck #s, both shuttle legs,
     cancel reasons (Caleb 07/09: the Matrix must find loads by any detail). */
  const laneSearchText = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of lanes) {
      m.set(l.id, `${l.name} ${l.origin} ${l.destination} ${(l.via ?? []).join(' ')} ${l.tripCode} ${l.dedicatedCarrier ?? ''}`.toLowerCase());
    }
    for (const ld of loads) {
      const details = [
        ld.loadNumber, ld.carrier, ld.rateNotes, ld.truckNumber ?? '', ld.cancelReason ?? '',
        ld.shuttleCarrier ?? '', ld.shuttleTruckNumber ?? '', ld.shuttleAssetLs ?? '',
        ld.shuttleLegNotes ?? '', ld.shuttleLocation ?? '', ld.shuttleCity ?? '', ld.hubNotes ?? '',
      ].join(' ');
      m.set(ld.laneId, `${m.get(ld.laneId) ?? ''} ${details}`.toLowerCase());
    }
    return m;
  }, [lanes, loads]);

  const lanesWithLoads = useMemo(() => new Set(loads.map((l) => l.laneId)), [loads]);
  const sections = useMemo(() => {
    /* render follows sortOrder (drag-reorder writes it); rows without one
       keep their array position via a stable index fallback */
    let list = lanes
      .map((l, i) => ({ l, i }))
      .filter(({ l }) => l.active)
      .sort((a, b) => (a.l.sortOrder ?? a.i) - (b.l.sortOrder ?? b.i))
      .map(({ l }) => l);
    /* v2.20.0 (Caleb): a retired lane disappears from the week it was retired
       FORWARD — windows that start before the retirement date keep the row
       and its loads; nothing in the past is ever deleted. */
    list = list.filter((l) => !l.retiredOn || days[0] < l.retiredOn);
    /* one-off extras only render on weeks that actually hold one of their
       loads (Sat/Sun overlap works naturally — both windows contain the day).
       A brand-new extra with no loads anywhere stays visible to be filled. */
    list = list.filter((l) =>
      l.isGroupHeader || !isExtraLane(l)
      || days.some((d) => loadMap.has(`${l.id}_${d}`))
      || !lanesWithLoads.has(l.id));
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((l) => !l.isGroupHeader && (laneSearchText.get(l.id) ?? '').includes(q));
    }
    if (statusFilter) {
      list = list.filter((l) =>
        days.some((d) => {
          const load = loadMap.get(`${l.id}_${d}`);
          if (!load) return false;
          /* "Assets" pseudo-chip (Think Tank 07/15): loads covered by GH */
          if (statusFilter === '__assets') return GH_CARRIER_RE.test(load.carrier);
          return effectiveStatus(load) === statusFilter;
        }),
      );
    }
    if (trkSearch.trim()) {
      const tq = trkSearch.toLowerCase().replace(/[^a-z0-9]/g, '');
      list = list.filter((l) =>
        loads.some((ld) => ld.laneId === l.id
          && ((ld.truckNumber ?? '').toLowerCase().replace(/[^a-z0-9]/g, '').includes(tq)
            || (ld.shuttleTruckNumber ?? '').toLowerCase().replace(/[^a-z0-9]/g, '').includes(tq))));
    }
    const bySection = new Map<string, Lane[]>();
    for (const lane of list) {
      const key = lane.section || DEFAULT_SECTION;
      const arr = bySection.get(key) ?? [];
      arr.push(lane);
      bySection.set(key, arr);
    }
    return [...bySection.entries()];
  }, [lanes, search, statusFilter, days, loadMap, laneSearchText, trkSearch, loads, lanesWithLoads]);

  /* Saturday-anchored weeks of the year for the quick-jump dropdown */
  const weekOptions = useMemo(() => {
    const year = Number(start.slice(0, 4));
    const options: Array<{ value: string; label: string }> = [];
    let sat = weekStart(`${year}-01-07`); // first Saturday on/before Jan 7 = week 1 anchor
    if (sat.slice(0, 4) < String(year)) sat = addDays(sat, 7);
    for (let n = 1; sat.slice(0, 4) === String(year); n++, sat = addDays(sat, 7)) {
      options.push({
        value: sat,
        label: `${sat === weekStart(isoToday()) ? '● ' : ''}Week ${n} · ${headerLabel(sat)} – ${headerLabel(addDays(sat, WEEK_DAYS - 1))}${sat === weekStart(isoToday()) ? '  — current' : ''}`,
      });
    }
    return options;
  }, [start]);

  const exposedCount = useMemo(
    () => loads.filter((l) => days.includes(l.date) && isExposed(l)).length,
    [loads, days],
  );

  return (
    <div className="matrix-page">
      <div className="toolbar">
        <div className="week-nav">
          <button className="btn-ghost btn-icon" onClick={() => setStart(addDays(start, -7))} aria-label="Previous week">‹</button>
          <select
            className="week-select"
            value={weekOptions.some((o) => o.value === start) ? start : ''}
            onChange={(e) => e.target.value && setStart(e.target.value)}
          >
            {!weekOptions.some((o) => o.value === start) && (
              <option value="">{headerLabel(days[0])} – {headerLabel(days[days.length - 1])}</option>
            )}
            {weekOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <button className="btn-ghost btn-icon" onClick={() => setStart(addDays(start, 7))} aria-label="Next week">›</button>
          <button className="btn-ghost" onClick={() => setStart(weekStart(isoToday()))}>Today</button>
        </div>
        <input
          className="search"
          placeholder="Filter lanes or trip #…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <input
          className="search trk-search"
          placeholder="TRK #…"
          title="Find loads by truck # (either shuttle leg)"
          value={trkSearch}
          onChange={(e) => setTrkSearch(e.target.value)}
        />
        {(() => {
          /* two labeled chip rows (Caleb 07/18): Broker/General on top,
             Asset statuses beneath — plus a Jump-to row for the site headers */
          const assetKeys = new Set(STATUS_GROUPS.filter((g) => g.label === 'Assets').flatMap((g) => g.keys)); // GTG (Q/A) lives on the Broker/General row (Caleb 07/18)
          const chip = (st: typeof statuses[number]) => (
            <button
              key={st.key}
              className={`chip ${statusFilter === st.key ? 'chip-on' : ''}`}
              style={{ ['--chip' as string]: st.color }}
              onClick={() => setStatusFilter(statusFilter === st.key ? null : st.key)}
            >
              {st.label}
            </button>
          );
          const JUMPS: Array<{ label: string; head?: RegExp; section?: RegExp }> = [
            { label: 'Coppell', head: /coppell/i },
            { label: 'Irving', head: /irving/i },
            { label: 'SATX', head: /san antonio|satx/i },
            { label: 'ATX', head: /austin/i },
            { label: 'Memphis', head: /memphis/i },
            { label: 'Columbia', head: /columbia/i },
            { label: 'Tampa', head: /tampa/i },
            { label: 'Inbound TX', head: /inbound tx/i },
            { label: 'Extras', section: /overflow|extra/i },
            { label: 'FA', section: /auction/i },
          ];
          const jumpTo = (j: typeof JUMPS[number]) => {
            const rows = [...document.querySelectorAll<HTMLElement>('[data-jump]')];
            const el = j.head
              ? rows.find((r) => j.head!.test(r.dataset.jump ?? ''))
              : [...document.querySelectorAll<HTMLElement>('.section-title')].find((r) => j.section!.test(r.textContent ?? ''));
            el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          };
          return (
            <>
              <div className="status-chips">
                <span className="chip-row-label">Broker / General:</span>
                {statuses.filter((st) => st.key !== 'asset' && !assetKeys.has(st.key)).map(chip)}
                <span className="exposed-count">{exposedCount} exposed this week</span>
              </div>
              <div className="status-chips">
                <span className="chip-row-label">Asset:</span>
                {statuses.filter((st) => st.key !== 'asset' && assetKeys.has(st.key)).map(chip)}
                <span className="chip-row-label jump-label">Jump to:</span>
                {JUMPS.map((j) => (
                  <button key={j.label} className="chip chip-jump" onClick={() => jumpTo(j)}>{j.label}</button>
                ))}
              </div>
            </>
          );
        })()}
      </div>

      <div className="grid-scroll">
        <table className="matrix">
          <thead>
            <tr>
              <th className="lane-col">Lane</th>
              {days.map((d) => (
                <th key={d} className={d === isoToday() ? 'today' : ''}>
                  {headerLabel(d)}
                </th>
              ))}
            </tr>
          </thead>
          {sections.map(([sectionName, sectionLanes]) => (
            <tbody
              key={sectionName}
              className={sectionName === DEFAULT_SECTION ? '' : 'section-alt'}
            >
              {sectionName !== DEFAULT_SECTION && (
                <tr className="section-row">
                  <td className="lane-col section-head" colSpan={days.length + 1}>
                    <span className="section-title">{sectionName}</span>
                    {mayAddExtras && (
                      <button
                        className="btn-ghost btn-sm"
                        onClick={() => setLaneEdit({ lane: null, section: sectionName })}
                      >
                        + Add lane
                      </button>
                    )}
                  </td>
                </tr>
              )}
              {sectionLanes.map((lane) => lane.isGroupHeader ? (
                <tr data-jump={lane.name} key={lane.id} className={`group-row ${dropId === lane.id ? 'drop-target' : ''}`} {...dragProps(lane)}>
                  <td className="lane-col group-head" colSpan={days.length + 1}>
                    {mayReorder && <span className="drag-handle" title="Drag to reorder (global)">⠿ </span>}
                    {lane.name.split('\n')[0]}
                  </td>
                </tr>
              ) : (
                <tr key={lane.id} className={dropId === lane.id ? 'drop-target' : ''}>
                  <td className="lane-col" {...dragProps(lane)}>
                    <div className="lane-top">
                      {mayReorder && <span className="drag-handle" title="Drag to reorder (global)">⠿</span>}
                      <div className={`lane-name ${lane.dedicated ? 'lane-dedicated' : ''}`}>
                        <Hi text={laneShortName(lane)} q={search} />
                        {lane.dedicated && <span className="dedicated-dot" title={`Dedicated → ${lane.dedicatedCarrier}`}>●</span>}
                      </div>
                      <button
                        className="lane-edit"
                        title={lane.serviceNotes ? `Lane details — ⚠ service change noted: ${lane.serviceNotes.slice(0, 80)}` : 'Lane details'}
                        onClick={() => setDetails(lane)}
                      >
                        ⓘ{lane.serviceNotes && <sup className="svc-flag">⚠</sup>}
                      </button>
                      {/* per-lane ✎ moved to Integrity (v2.11.3) — Integrity
                          is the source of truth for lane data; Matrix keeps
                          ⓘ details + section-level "+ Add lane" only */}
                    </div>
                    <div className="lane-meta">
                      {lane.tripCode && <span className="pill pill-trip">{lane.tripCode}</span>}
                      {lane.tripLabel && <span className="pill pill-label">{lane.tripLabel}</span>}
                      {lane.planning && <span className="pill pill-plan">{lane.planning.split('\n')[0]}</span>}
                      {lane.arrivalTime && <span className="pill">Arr {cleanTimes(lane.arrivalTime)}</span>}
                      {lane.departureTime && <span className="pill">Dep {cleanTimes(lane.departureTime)}</span>}
                      {/* multi-drop lanes: only the FINAL scheduled arrival here — full stop list in lane details (ⓘ) */}
                      {lane.delTime && (
                        <span className="pill" title={cleanTimes(lane.delTime.replace(/\n/g, ' · '))}>
                          Final Del {finalDelTime(lane.delTime)}
                        </span>
                      )}
                      {lane.frequency && (
                        <span className="pill" title={freqDescription(lane, integrityByTrip.get(lane.tripCode.toUpperCase())?.trm?.freqCode ?? undefined)}>
                          Freq {freqDisplay(lane, integrityByTrip.get(lane.tripCode.toUpperCase())?.trm?.freqCode ?? undefined)}
                        </span>
                      )}
                      {laneMiles(lane) && <span className="pill">{laneMiles(lane)} mi</span>}
                      {autoTeamSolo(lane) && (
                        <span className="pill" title={lane.soloApproved ? 'Solo-approved route' : 'Auto designation from loaded miles'}>
                          {autoTeamSolo(lane)}
                        </span>
                      )}
                    </div>
                    {(() => {
                      const rec = integrityByTrip.get(lane.tripCode.toUpperCase());
                      if (!rec) return null;
                      return (
                        <div className="lane-target">
                          <span><b>WD</b> {fmtBand(rec.bands?.weekday)}</span>
                          <span><b>WE</b> {fmtBand(rec.bands?.weekend)}</span>
                        </div>
                      );
                    })()}
                    {!integrityByTrip.has(lane.tripCode.toUpperCase()) && (lane.weekendRate || lane.weekdayRate) && (
                      <div className="lane-target">
                        {lane.weekendRate && <span><b>Weekend</b> {lane.weekendRate}</span>}
                        {lane.weekdayRate && <span><b>Weekday</b> {lane.weekdayRate}</span>}
                      </div>
                    )}
                  </td>
                  {days.map((d) => {
                    const load = loadMap.get(`${lane.id}_${d}`);
                    const eff = load ? effectiveStatus(load) : '';
                    const st = load ? statusMap.get(eff) : undefined;
                    const dim = statusFilter && load && (statusFilter === '__assets' ? !GH_CARRIER_RE.test(load.carrier) : eff !== statusFilter);
                    const expected = !load && d >= today && (!lane.retiredOn || d < lane.retiredOn) && runsOn(lane, freqDateFor(lane, d), integrityByTrip.get(lane.tripCode.toUpperCase())?.trm?.freqCode ?? undefined);
                    const missing = expected && datesWithLoads.has(d);
                    const clickable = load ? mayTouch(lane) : mayCreate(lane);
                    /* QA glow (Caleb 07/18): a tendered load (has an LS#)
                       sitting cancelled WITHOUT a written reason needs eyes —
                       it may have been cancelled in error. */
                    const qaCancel = !!load && (eff === 'not_running' || eff === 'omitted')
                      && !!load.loadNumber && !(load.cancelReason ?? '').trim();
                    const isMoveSrc = !!moveSrc && !!load && load.id === moveSrc.load.id;
                    const isMoveTarget = !!moveSrc && !load && lane.id === moveSrc.lane.id;
                    return (
                      <td
                        key={d}
                        data-ml={lane.id}
                        data-md={d}
                        data-me={load ? '0' : '1'}
                        className={`cell ${dim ? 'dim' : ''} ${missing ? 'cell-missing qa-glow' : ''} ${qaCancel ? 'qa-glow' : ''} ${clickable ? '' : 'cell-static'} ${isMoveSrc ? 'cell-move-src' : ''} ${isMoveTarget ? 'cell-move-target' : ''}`}
                        style={load && st && !load.isShuttle ? { background: st.color, color: st.textColor } : undefined}
                        onPointerDown={load && mayTouch(lane) ? () => {
                          window.clearTimeout(pressTimer.current);
                          pressTimer.current = window.setTimeout(() => armMove(load, lane), 500);
                        } : undefined}
                        onPointerUp={() => window.clearTimeout(pressTimer.current)}
                        onPointerLeave={() => window.clearTimeout(pressTimer.current)}
                        onClick={() => {
                          if (Date.now() - lastDropAt.current < 500) return; // just dropped here
                          const src = moveSrcRef.current;
                          if (src) {
                            if (load && load.id === src.load.id) return; // arming release — stay armed
                            if (!load && lane.id === src.lane.id && d !== src.load.date) confirmDrop(d);
                            else disarmMove();
                            return;
                          }
                          if (clickable) setEditing({ lane, date: d });
                        }}
                        title={
                          load
                            ? st?.label
                            : missing
                              ? 'Expected per frequency but no load imported for this day'
                              : expected
                                ? 'Scheduled to run — waiting on load tender (EDI)'
                                : mayTouch(lane)
                                  ? 'Click to add load'
                                  : ''
                        }
                      >
                        {load && load.isShuttle ? (
                          /* §shuttle-split: legs are marked independently — top
                             half = pickup leg (the load itself), bottom half =
                             delivery leg (own carrier + covered/exposed). */
                          <div className="cell-split">
                            <div className="cell-leg" style={st ? { background: st.color, color: st.textColor } : undefined}>
                              <div className="c-load">{load.loadNumber || '—'} ⇄</div>
                              <div className="c-carrier">{ghCarrier(carrierLine(load, lane, eff))}</div>
                              {/* fix: shuttle cells were dropping the rate/notes line entirely */}
                              <div className="c-rate">{rateLine(load, lane, eff)}</div>
                            </div>
                            {(() => {
                              /* leg 2 carries the FULL status palette now —
                                 legacy covered/exposed still render via the
                                 red/green classes */
                              const legKey = load.shuttleLegStatus || '';
                              const legSt = legKey && !['covered', 'exposed'].includes(legKey) ? statusMap.get(legKey) : undefined;
                              const swapAt = [load.shuttleLocation, [load.shuttleCity, load.shuttleState].filter(Boolean).join(', ')]
                                .filter(Boolean).join(' · ');
                              return (
                                <div
                                  className={`cell-leg ${legSt ? '' : shuttleLegExposed(load) ? 'leg-exposed' : 'leg-covered'}`}
                                  style={legSt ? { background: legSt.color, color: legSt.textColor } : undefined}
                                  title={legSt ? `Leg 2 — ${legStatusLabel(legKey)}` : undefined}
                                >
                                  <div className="c-carrier">
                                    {shuttleLegExposed(load)
                                      ? (load.shuttleType === 'repower' ? 'REPOWER — NEEDS CARRIER' : 'LEG 2 — NEEDS COVERAGE')
                                      : ghCarrier([load.shuttleCarrier || 'LEG 2 COVERED', legSt ? legStatusLabel(legKey).toUpperCase() : ''].filter(Boolean).join(' — '))}
                                  </div>
                                  <div className="c-rate">
                                    {[swapAt && `@ ${swapAt}`, load.shuttleSwapEta && `ETA ${load.shuttleSwapEta}`, load.shuttleLegNotes?.trim()]
                                      .filter(Boolean).join(' · ')}
                                  </div>
                                </div>
                              );
                            })()}
                            {lotTag(load)}
                            {cbStrip(load, eff)}
                          </div>
                        ) : load ? (
                          <>
                            <div className="c-load"><Hi text={load.loadNumber || '—'} q={search} /></div>
                            <div className="c-carrier">{ghCarrier(carrierLine(load, lane, eff))}</div>
                            <div className="c-rate">{rateLine(load, lane, eff)}</div>
                            {lotTag(load)}
                            {cbStrip(load, eff)}
                          </>
                        ) : missing ? (
                          <div className="c-missing">
                            <div>MISSING?</div>
                            <div className="c-missing-sub">REQUIRES QA REVIEW ASAP</div>
                          </div>
                        ) : expected ? (
                          <div className="c-pending">
                            <div>WAITING</div>
                            <div className="c-pending-sub">load tender / EDI</div>
                          </div>
                        ) : mayTouch(lane) ? (
                          <div className="c-empty">+</div>
                        ) : null}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>

      {moveSrc && (
        <div className="move-hint">
          {'⇢ Moving load '}{moveSrc.load.loadNumber || '(no LS#)'}{' — '}{headerLabel(moveSrc.load.date)}
          {' · click an open day on the SAME row to drop it · Esc cancels'}
        </div>
      )}

      {editing && (
        <LoadEditor
          lane={editing.lane}
          date={editing.date}
          load={loadMap.get(`${editing.lane.id}_${editing.date}`)}
          onClose={() => setEditing(null)}
        />
      )}
      {laneEdit && (
        <LaneEditor lane={laneEdit.lane} section={laneEdit.section} onClose={() => setLaneEdit(null)} />
      )}
      {details && (
        <LaneDetails
          lane={details}
          onClose={() => setDetails(null)}
          onEdit={() => {
            setLaneEdit({ lane: details });
            setDetails(null);
          }}
        />
      )}
    </div>
  );
}
