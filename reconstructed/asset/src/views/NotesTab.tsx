/* Notes thread — PHASE 7.

   A thread, not a text box. Every note carries who wrote it, when, and what KIND
   of note it is, because "called the receiver" and "driver says he's out of
   hours" get read by different people looking for different things.

   Late Reason notes render in the warning colour: those are the ones that end up
   quoted back to a customer, and they should be findable at a glance. */

import { useEffect, useRef, useState } from 'react';
import { onChange } from '../data/bus';
import { canDelete } from '../data/permStore';
import type { Load } from '../data/loadsStore';
import {
  storedNotes, fetchNotes, addNote, editNote, pinNote, removeNote,
} from '../data/tms/notesStore';
import { NOTE_CATEGORIES, type NoteCategory } from '../data/tms/types';

const fmtWhen = (iso: string) => (iso
  ? new Date(iso).toLocaleString(undefined, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  : '—');

export default function NotesTab({ load, readOnly }: { load: Load; readOnly?: boolean }) {
  const [, force] = useState(0);
  const [body, setBody] = useState('');
  const [cat, setCat] = useState<NoteCategory>('General');
  const [editing, setEditing] = useState('');
  const [editBody, setEditBody] = useState('');
  const [showHidden, setShowHidden] = useState(false);
  const [msg, setMsg] = useState('');
  const boxRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => onChange(() => force((n) => n + 1)), []);
  useEffect(() => { void fetchNotes(load.id).then(() => force((n) => n + 1)); }, [load.id]);

  const notes = storedNotes(load.id, showHidden);
  const mayDelete = canDelete();

  async function post() {
    if (!body.trim()) return;
    await addNote(load.id, body, cat);
    setBody(''); setCat('General'); force((n) => n + 1);
    boxRef.current?.focus();
  }

  return (
    <div className="notes-wrap">
      {readOnly
        ? <div className="am-notice">This load is open on somebody else's screen — you can read the thread but not add to it.</div>
        : (
          <div className="notes-compose">
            <select className="am-input notes-cat" value={cat} onChange={(e) => setCat(e.target.value as NoteCategory)}>
              {NOTE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <textarea ref={boxRef} className="am-input notes-box" rows={2} value={body}
              placeholder="What happened, who you spoke to, what they said."
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void post(); }} />
            <button className="am-save" disabled={!body.trim()} onClick={() => void post()}>Post</button>
          </div>
        )}

      {msg && <div className="am-notice" style={{ color: 'var(--red)' }}>{msg}</div>}

      <div className="notes-head">
        <span className="am-muted">{notes.length} note{notes.length === 1 ? '' : 's'}</span>
        <label className="notes-showhidden">
          <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} />
          Show hidden notes
        </label>
        <span className="am-muted notes-policy">Notes are never deleted — hiding one keeps the record and logs who hid it.</span>
      </div>

      {notes.length === 0
        ? <div className="am-muted">Nothing on this load yet.</div>
        : (
          <div className="notes-thread">
            {notes.map((n) => (
              <div key={n.id} className={`note-card ${n.category === 'Late Reason' ? 'late' : ''} ${n.deletedAt ? 'hidden' : ''} ${n.pinned ? 'pinned' : ''}`}>
                <div className="note-top">
                  <span className={`note-cat ${n.category === 'Late Reason' ? 'late' : ''}`}>{n.category}</span>
                  <span className="am-muted">{n.authorEmail} · {fmtWhen(n.createdAt)}</span>
                  {n.editedAt && <span className="am-muted note-edited">edited {fmtWhen(n.editedAt)} by {n.editedBy}</span>}
                  {n.deletedAt && <span className="note-hidden-tag">hidden {fmtWhen(n.deletedAt)}</span>}
                  {!readOnly && !n.deletedAt && (
                    <span className="note-actions">
                      <button className="am-clear" title={n.pinned ? 'Unpin' : 'Pin to the top of the thread'}
                        onClick={() => void pinNote(load.id, n.id, !n.pinned)}>{n.pinned ? '📌 Unpin' : '📌'}</button>
                      <button className="am-clear" onClick={() => { setEditing(n.id); setEditBody(n.body); }}>✎</button>
                      {mayDelete
                        ? <button className="fleet-del" title="Hide this note — the record is kept"
                            onClick={() => void removeNote(load.id, n.id).then((r) => { if (!r.ok) setMsg(r.reason); force((x) => x + 1); })}>🗑</button>
                        : <button className="am-clear" disabled title="Hiding a note is restricted to FMT Lead / US Ops / Owner">🔒</button>}
                    </span>
                  )}
                </div>
                {editing === n.id
                  ? (
                    <div className="note-edit">
                      <textarea className="am-input" rows={2} value={editBody} autoFocus onChange={(e) => setEditBody(e.target.value)} />
                      <button className="am-save" disabled={!editBody.trim()}
                        onClick={() => void editNote(load.id, n.id, editBody).then(() => { setEditing(''); force((x) => x + 1); })}>Save</button>
                      <button className="am-clear" onClick={() => setEditing('')}>Cancel</button>
                    </div>
                  )
                  : <div className="note-body">{n.body}</div>}
              </div>
            ))}
          </div>
        )}
    </div>
  );
}
