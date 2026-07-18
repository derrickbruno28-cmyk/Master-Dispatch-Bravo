import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { buildActions } from '../actions';
import { useStore } from '../data/store';

/* Action Center (Caleb 07/09): the topbar "✓ Actions" button + panel. Counts
   are derived live and capability-matched — an empty list means the data is
   healthy for everything YOU can fix, so the button goes quiet (no badge). */
export default function ActionCenter() {
  const { lanes, loads, carriers, carrierUsers, users, currentUser, integrity, trmMeta } = useStore();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const boxRef = useRef<HTMLDivElement>(null);

  const items = useMemo(
    () => buildActions({ user: currentUser, lanes, loads, carriers, carrierUsers, users, integrity, trmMeta }),
    [currentUser, lanes, loads, carriers, carrierUsers, users, integrity, trmMeta],
  );
  const total = items.reduce((n, i) => n + i.count, 0);
  const reds = items.filter((i) => i.severity === 'red').reduce((n, i) => n + i.count, 0);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div className="action-center" ref={boxRef}>
      <button
        className={`btn-ghost action-btn ${reds > 0 ? 'action-red' : ''}`}
        title="Action items — data that needs your attention"
        onClick={() => setOpen((v) => !v)}
      >
        ✓ Actions {total > 0 && <span className="badge">{total > 999 ? '999+' : total}</span>}
      </button>
      {open && (
        <div className="action-panel">
          <div className="action-panel-head">
            Action items <span className="muted">— live from the data, scoped to what you can fix</span>
          </div>
          {items.length === 0 ? (
            <div className="action-empty">✓ All clear — nothing in your scope needs attention.</div>
          ) : (
            items.map((it) => (
              <button
                key={it.key}
                className="action-item"
                onClick={() => { setOpen(false); navigate(it.to.replace(/^#?\/?/, '/')); }}
              >
                <span className={`action-dot ${it.severity}`} />
                <span className="action-count">{it.count}</span>
                <span className="action-text">{it.text}</span>
                <span className="action-fix">Fix →</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
