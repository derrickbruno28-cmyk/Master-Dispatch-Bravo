/* Trailer combobox — PHASE 10A.

   FREE TEXT ALWAYS WINS. You can type anything and save; the trailer list is a
   convenience, not a gate. That is deliberate — a driver reading a number off
   the side of a trailer at 2am should never be blocked because the roster hasn't
   been imported yet.

   What the list adds: matches as you type, the trailer's type filled in for you,
   a warning when it's In Shop or already on another live load, and an inline
   "+ Add trailer" so a new one gets a real record instead of living only as text
   on this leg. */

import { useMemo, useState } from 'react';
import {
  loadTrailers, saveTrailer, blankTrailer, TRAILER_TYPES, type Trailer,
} from '../data/trailersStore';
import { loadAll } from '../data/loadsStore';

export interface TrailerHint { tone: 'warn' | 'info' | ''; text: string; type: string }

/* Never blocks. Returns what is worth saying about this trailer, if anything. */
export function trailerHint(number: string, excludeLoadId: string): TrailerHint {
  const n = number.trim();
  if (!n) return { tone: '', text: '', type: '' };
  const rec = loadTrailers().find((t) => t.number.trim().toLowerCase() === n.toLowerCase());
  if (!rec) return { tone: 'info', text: `#${n} isn't in the trailer list yet.`, type: '' };

  if (rec.status === 'In Shop' || rec.status === 'Out of Service') {
    return { tone: 'warn', text: `#${n} is marked ${rec.status}. You can still dispatch it — this is a warning, not a block.`, type: rec.type };
  }

  /* already on another load that hasn't finished */
  const busy = loadAll().find((l) => l.id !== excludeLoadId
    && l.status !== 'completed'
    && (l.assignedTrailer || '').trim().toLowerCase() === n.toLowerCase());
  if (busy) {
    return { tone: 'warn', text: `#${n} is already on ${busy.routeName || busy.id} (${busy.date}), which hasn't completed.`, type: rec.type };
  }
  return { tone: 'info', text: rec.type ? `${rec.type}${rec.location ? ` · ${rec.location}` : ''}` : '', type: rec.type };
}

export default function TrailerCombo({ value, loadId, onChange }: {
  value: string; loadId: string; onChange: (v: string) => void;
}) {
  const [adding, setAdding] = useState<Trailer | null>(null);
  const [msg, setMsg] = useState('');

  const list = loadTrailers();
  const hint = useMemo(() => trailerHint(value, loadId), [value, loadId]);
  const known = list.some((t) => t.number.trim().toLowerCase() === value.trim().toLowerCase());
  const matches = useMemo(() => {
    const n = value.trim().toLowerCase();
    if (!n) return list.slice(0, 8);
    return list.filter((t) => `${t.number} ${t.type} ${t.location}`.toLowerCase().includes(n)).slice(0, 8);
  }, [list, value]);

  function startAdd() {
    setAdding({ ...blankTrailer(), number: value.trim(), status: 'Available' });
    setMsg('');
  }
  function commitAdd() {
    if (!adding || !adding.number.trim()) return;
    saveTrailer(adding);
    onChange(adding.number.trim());
    setMsg(`✓ Trailer #${adding.number.trim()} added to the fleet.`);
    setAdding(null);
  }

  return (
    <div className="trl-wrap">
      <input className="am-input" list="leg-trailers-live" value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="power-only? leave blank" />
      <datalist id="leg-trailers-live">
        {matches.map((t) => <option key={t.number} value={t.number}>{[t.type, t.status, t.location].filter(Boolean).join(' · ')}</option>)}
      </datalist>

      {hint.text && <div className={`trl-hint ${hint.tone}`}>{hint.tone === 'warn' ? '⚠ ' : ''}{hint.text}</div>}

      {value.trim() && !known && !adding && (
        <button className="am-clear trl-add" onClick={startAdd}>+ Add trailer #{value.trim()}</button>
      )}

      {adding && (
        <div className="trl-form">
          <input className="am-input trl-in" value={adding.number} placeholder="trailer #"
            onChange={(e) => setAdding({ ...adding, number: e.target.value })} />
          <select className="am-input trl-in" value={adding.type} onChange={(e) => setAdding({ ...adding, type: e.target.value })}>
            <option value="">— type —</option>
            {TRAILER_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <input className="am-input trl-in" value={adding.location} placeholder="location"
            onChange={(e) => setAdding({ ...adding, location: e.target.value })} />
          <button className="am-save" disabled={!adding.number.trim()} onClick={commitAdd}>✓ Add</button>
          <button className="am-clear" onClick={() => setAdding(null)}>Cancel</button>
        </div>
      )}

      {msg && <div className="trl-hint">{msg}</div>}
    </div>
  );
}
