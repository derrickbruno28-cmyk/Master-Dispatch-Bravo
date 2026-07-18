import { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { useStore } from '../data/store';
import { can } from '../permissions';
import type { Load } from '../types';

const TRIP_RE = /(FA2D3|FA28D|7523D)[-_ ]?(\d+)/i;

interface ParsedRow {
  loadNumber: string;
  tripCode: string;
  date: string; // YYYY-MM-DD
  time: string;
  carrier: string;
  pay: string;
  driver: string; // Monarc: Driver Name/Phone → goes to notes
  powerUnit: string; // Monarc: GH truck # when the carrier is GH
  customer: string; // Monarc Customer column — drives the skipped-loads check
  matchedLaneId: string | null;
}

interface SkippedRow {
  loadNumber: string;
  customer: string;
  reason: string;
}

/* TMS profiles — auto-detected from headers. LoadStop is the original;
   Monarc renames three columns and emits real date CELLS (SheetJS silently
   reformats those to 2-digit-year text under raw:false, so the whole reader
   runs cellDates+raw and this helper normalizes every shape we've seen:
   Date objects, "2026-07-18 21:30:00", "6/19/2026 18:45", "07/04/2026 12:30 AM"). */
const HEADER_ALIASES: Record<string, string> = {
  'Load #': 'Load',
  'Pickup Date/Time': 'Pickup',
  'Carrier': 'Carrier Name',
};

function pickupParts(cell: unknown): { date: string; time: string } {
  if (cell instanceof Date && !Number.isNaN(cell.getTime())) {
    const p = (n: number) => String(n).padStart(2, '0');
    return {
      date: `${cell.getFullYear()}-${p(cell.getMonth() + 1)}-${p(cell.getDate())}`,
      time: `${p(cell.getHours())}:${p(cell.getMinutes())}`,
    };
  }
  const s = String(cell ?? '').trim();
  let m = /(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}:\d{2})/.exec(s);
  if (m) return { date: `${m[1]}-${m[2]}-${m[3]}`, time: m[4] };
  m = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (m) {
    const rest = s.slice(m.index + m[0].length);
    const tm = /(\d{1,2}:\d{2}(?:\s*[AP]M)?)/i.exec(rest);
    return {
      date: `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`,
      time: tm ? tm[1].toUpperCase() : '',
    };
  }
  m = /(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? { date: m[0], time: '' } : { date: '', time: '' };
}

export default function ImportView() {
  const { lanes, importLoads, currentUser } = useStore();
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [skipped, setSkipped] = useState<SkippedRow[]>([]);
  const [fileName, setFileName] = useState('');
  const [profile, setProfile] = useState('');
  const [result, setResult] = useState('');

  const laneByTrip = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of lanes) {
      if (l.tripCode && !m.has(l.tripCode.toUpperCase())) m.set(l.tripCode.toUpperCase(), l.id);
    }
    return m;
  }, [lanes]);

  async function handleFile(file: File) {
    setFileName(file.name);
    setResult('');
    /* cellDates+raw: Monarc emits real date cells that raw:false silently
       reformats to 2-digit-year text — pickupParts() handles every shape. */
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const data: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true });
    const headers = (data[0] ?? []).map((h) => {
      const t = String(h ?? '').trim();
      return HEADER_ALIASES[t] ?? t;
    });
    const rawHeaders = (data[0] ?? []).map((h) => String(h ?? '').trim());
    const isMonarc = rawHeaders.includes('Load #') || rawHeaders.includes('Pickup Date/Time');
    setProfile(isMonarc ? 'Monarc' : 'LoadStop');
    const idx = {
      load: headers.indexOf('Load'),
      pickup: headers.indexOf('Pickup'),
      carrier: headers.indexOf('Carrier Name'),
      pay: headers.indexOf('Carrier Pay'),
      driverName: headers.indexOf('Driver Name'),
      driverPhone: headers.indexOf('Driver Phone'),
      powerUnit: headers.indexOf('Power Unit'),
      customer: headers.indexOf('Customer'),
    };
    const cellStr = (row: unknown[], i: number) => (i === -1 ? '' : String(row[i] ?? '').trim());
    const parsed: ParsedRow[] = [];
    const skippedRows: SkippedRow[] = [];
    for (const row of data.slice(1)) {
      if (!row || row.length === 0 || row.every((c) => c == null || String(c).trim() === '')) continue;
      const loadNumber = cellStr(row, idx.load);
      const customer = cellStr(row, idx.customer);
      if (!loadNumber) {
        skippedRows.push({ loadNumber: '—', customer, reason: 'no load number' });
        continue;
      }
      /* trip reference can appear in Route Name, PO Number, Pickup ref, or
         Monarc's Pickup # — scan the whole row for the first contract-trip pattern */
      let tripCode = '';
      for (const cell of row) {
        if (cell instanceof Date) continue;
        const m = TRIP_RE.exec(String(cell ?? ''));
        if (m) {
          tripCode = `${m[1].toUpperCase()}-${m[2]}`;
          break;
        }
      }
      const { date, time } = pickupParts(idx.pickup === -1 ? '' : row[idx.pickup]);
      const payRaw = cellStr(row, idx.pay);
      const driver = [cellStr(row, idx.driverName), cellStr(row, idx.driverPhone)].filter(Boolean).join(' ');
      parsed.push({
        loadNumber,
        tripCode,
        date,
        time,
        carrier: cellStr(row, idx.carrier),
        pay: payRaw ? payRaw.replace(/^\$?\s*/, '$') : '',
        driver,
        powerUnit: cellStr(row, idx.powerUnit),
        customer,
        matchedLaneId: tripCode && date ? laneByTrip.get(tripCode) ?? null : null,
      });
    }
    /* §import-QA: every row that will NOT import, with its customer — so a
       skipped USPS load can't slip through silently. */
    for (const r of parsed) {
      if (!r.matchedLaneId) {
        skippedRows.push({
          loadNumber: r.loadNumber,
          customer: r.customer,
          reason: !r.tripCode ? 'no trip reference' : !r.date ? 'no pickup date' : `trip ${r.tripCode} has no Matrix lane`,
        });
      }
    }
    setSkipped(skippedRows);
    setRows(parsed);
  }

  if (!can(currentUser, 'import')) {
    return <div className="page"><p className="muted">Import access required — see your manager.</p></div>;
  }

  const matched = rows.filter((r) => r.matchedLaneId);
  const unmatched = rows.filter((r) => !r.matchedLaneId);

  async function apply() {
    const toImport: Load[] = matched.map((r) => ({
      id: `${r.matchedLaneId}_${r.date}`,
      laneId: r.matchedLaneId!,
      date: r.date,
      loadNumber: r.loadNumber,
      carrier: r.carrier,
      /* rate is a first-class field now; driver details go to notes */
      rate: r.carrier ? r.pay : '',
      rateNotes: r.carrier && r.driver ? `Driver: ${r.driver}` : '',
      status: r.carrier ? 'covered' : 'exposed',
      postedRate: '',
      equipment: '',
      hubNotes: '',
      bookingApproved: !!r.carrier,
      ...(r.powerUnit && /\bGH\b|GH\s*Logistics/i.test(r.carrier) ? { truckNumber: r.powerUnit } : {}),
    }));
    const n = await importLoads(toImport);
    setResult(`Imported ${n} loads into the Matrix. ${skipped.length} rows skipped — review the skipped list below before closing this out.`);
    setRows([]);
  }

  const uspsSkipped = skipped.filter((k) => /usps|postal/i.test(k.customer));

  return (
    <div className="page">
      <div className="page-head">
        <h2>Import Loads</h2>
        <span className="muted">
          Upload a LoadStop or Monarc export (.xlsx/.csv) — the profile is auto-detected; loads
          match lanes by trip # + pickup date.
        </span>
      </div>

      <label className="dropzone">
        <input
          type="file"
          accept=".xlsx,.xls,.csv"
          hidden
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
        />
        <span className="dropzone-icon">⬆</span>
        <span>{fileName ? `${fileName}${profile ? ` (${profile} profile)` : ''}` : 'Click to choose the TMS export file'}</span>
      </label>

      {result && <p className="import-result">{result}</p>}

      {rows.length > 0 && (
        <>
          <div className="import-summary">
            <span className="ok">{matched.length} matched</span>
            <span className="warn">{unmatched.length} unmatched</span>
            <button className="btn-primary" onClick={apply} disabled={matched.length === 0}>
              Apply {matched.length} loads to Matrix
            </button>
          </div>
          <table className="list-table table-dense">
            <thead>
              <tr>
                <th>Load</th><th>Trip</th><th>PU Date</th><th>PU Time</th><th>Carrier</th><th>Pay</th><th>Match</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 200).map((r, i) => (
                <tr key={i} className={r.matchedLaneId ? '' : 'row-warn'}>
                  <td>{r.loadNumber}</td>
                  <td>{r.tripCode || '—'}</td>
                  <td>{r.date}</td>
                  <td>{r.time}</td>
                  <td>
                    {r.carrier || <span className="muted">none (exposed)</span>}
                    {r.driver && <div className="muted" style={{ fontSize: 11 }}>{r.driver}</div>}
                  </td>
                  <td>{r.carrier ? r.pay : ''}</td>
                  <td>{r.matchedLaneId ? '✓' : 'no lane'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > 200 && <p className="muted">…and {rows.length - 200} more rows.</p>}
        </>
      )}

      {skipped.length > 0 && (
        <section>
          <h3>
            Skipped rows <span className="muted">({skipped.length})</span>
            {uspsSkipped.length > 0 && (
              <span className="skip-usps"> ⚠ {uspsSkipped.length} USPS load(s) being skipped — review before applying!</span>
            )}
          </h3>
          <p className="muted">
            Every row that will NOT import, with its customer — confirm nothing USPS slips through.
            Non-Matrix freight (FedEx, LA Foods…) is expected here.
          </p>
          <table className="list-table table-dense">
            <thead>
              <tr><th>Load #</th><th>Customer</th><th>Why skipped</th></tr>
            </thead>
            <tbody>
              {skipped.map((k, i) => (
                <tr key={i} className={/usps|postal/i.test(k.customer) ? 'row-warn' : ''}>
                  <td className="strong">{k.loadNumber}</td>
                  <td className="wrap">{k.customer || <span className="muted">—</span>}</td>
                  <td className="muted">{k.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
