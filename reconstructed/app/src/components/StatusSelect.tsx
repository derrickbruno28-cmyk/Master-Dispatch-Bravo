import { useEffect, useRef, useState } from 'react';
import type { StatusDef } from '../types';

/* Status dropdown with COLOR DOTS (Caleb's team, 07/09): native <option>s
   can't render shapes, so this is a custom listbox — a medium dot in each
   row in the status's exact color, plus the label text, grouped by the same
   sections as before. Keyboard: Enter/Space opens, Esc closes. */
interface Props {
  value: string;
  onChange: (key: string) => void;
  groups: Array<{ label: string; keys: string[] }>;
  statuses: StatusDef[];
  /** relabel hook (leg 2 renames 'departed' → "Swap Complete / En Route") */
  labelFor?: (key: string) => string;
  /** first row for leg-2's '' auto option */
  emptyOption?: string;
  excludeKeys?: string[];
}

export default function StatusSelect({ value, onChange, groups, statuses, labelFor, emptyOption, excludeKeys }: Props) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const stMap = new Map(statuses.map((s) => [s.key, s]));
  const label = (k: string) => labelFor?.(k) ?? stMap.get(k)?.label ?? k;
  const dot = (k: string) => stMap.get(k)?.color ?? 'var(--muted)';

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);

  const inGroups = groups.some((g) => g.keys.includes(value));
  const pick = (k: string) => { onChange(k); setOpen(false); };
  const row = (k: string, text?: string) => (
    <button
      key={k || 'auto'}
      type="button"
      className={`status-option ${value === k ? 'is-selected' : ''}`}
      onClick={() => pick(k)}
    >
      <span className="status-dot" style={{ background: k ? dot(k) : 'transparent', borderColor: k ? dot(k) : 'var(--muted)' }} />
      <span>{text ?? label(k)}</span>
    </button>
  );

  return (
    <div className="status-select" ref={boxRef}>
      <button type="button" className="status-trigger" onClick={() => setOpen((v) => !v)}>
        <span
          className="status-dot"
          style={{ background: value ? dot(value) : 'transparent', borderColor: value ? dot(value) : 'var(--muted)' }}
        />
        <span className="status-trigger-label">{value ? label(value) : emptyOption ?? '—'}</span>
        <span className="status-caret">▾</span>
      </button>
      {open && (
        <div className="status-menu" role="listbox">
          {emptyOption != null && row('', emptyOption)}
          {/* current value survives dept filtering — always selectable as itself */}
          {value && !inGroups && row(value)}
          {groups.map((g) => (
            <div key={g.label || 'top'}>
              {g.label && <div className="status-group-label">{g.label}</div>}
              {g.keys
                .filter((k) => !excludeKeys?.includes(k))
                .filter((k) => stMap.has(k))
                .map((k) => row(k))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
