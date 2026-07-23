/* DocumentStore — per-load paperwork behind an interface. Ships with a LOCAL
   implementation (IndexedDB, falls back to in-memory) so nothing external is
   required; a Firebase Storage implementation slots in behind the
   VITE_DOCUMENT_STORE=firebase flag when paperwork should live in the cloud. */

import { integrationConfig } from './config';

export interface LoadDocument {
  id: string;
  loadId: string;
  name: string;
  type: string;        // mime type
  size: number;        // bytes
  uploadedAt: string;  // ISO
  deleted: boolean;    // soft-delete (trash) — never hard-removed by the UI
}

export interface DocumentStore {
  readonly kind: string;
  readonly label: string;          // storage badge text
  list(loadId: string): Promise<LoadDocument[]>;
  put(loadId: string, file: File): Promise<LoadDocument>;
  data(id: string): Promise<Blob | null>;
  rename(id: string, name: string): Promise<void>;
  softDelete(id: string): Promise<void>;
  countByLoad(): Promise<Record<string, number>>;   // for board 📎 badges
}

/* ---------- local implementation: IndexedDB with in-memory fallback ---------- */

const DB = 'asset-load-docs'; const META = 'meta'; const BLOBS = 'blobs';

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(BLOBS)) db.createObjectStore(BLOBS);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}
function tx<T>(db: IDBDatabase, store: string, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return new Promise((resolve) => {
    try {
      const r = run(db.transaction(store, mode).objectStore(store));
      r.onsuccess = () => resolve(r.result as T);
      r.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}

class LocalDocumentStore implements DocumentStore {
  readonly kind = 'local';
  readonly label = 'Local (Firebase-ready)';
  private mem = new Map<string, { meta: LoadDocument; blob: Blob }>(); // fallback

  async list(loadId: string): Promise<LoadDocument[]> {
    const db = await openDb();
    if (db) {
      const all = (await tx<LoadDocument[]>(db, META, 'readonly', (s) => s.getAll() as IDBRequest<LoadDocument[]>)) ?? [];
      return all.filter((d) => d.loadId === loadId && !d.deleted).sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
    }
    return [...this.mem.values()].map((x) => x.meta).filter((d) => d.loadId === loadId && !d.deleted);
  }
  async put(loadId: string, file: File): Promise<LoadDocument> {
    const meta: LoadDocument = {
      id: `doc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      loadId, name: file.name, type: file.type || 'application/octet-stream',
      size: file.size, uploadedAt: new Date().toISOString(), deleted: false,
    };
    const db = await openDb();
    if (db) {
      await tx(db, META, 'readwrite', (s) => s.put(meta));
      await tx(db, BLOBS, 'readwrite', (s) => s.put(file, meta.id));
    } else this.mem.set(meta.id, { meta, blob: file });
    return meta;
  }
  async data(id: string): Promise<Blob | null> {
    const db = await openDb();
    if (db) return (await tx<Blob>(db, BLOBS, 'readonly', (s) => s.get(id) as IDBRequest<Blob>)) ?? null;
    return this.mem.get(id)?.blob ?? null;
  }
  private async patch(id: string, f: (m: LoadDocument) => void) {
    const db = await openDb();
    if (db) {
      const m = await tx<LoadDocument>(db, META, 'readonly', (s) => s.get(id) as IDBRequest<LoadDocument>);
      if (m) { f(m); await tx(db, META, 'readwrite', (s) => s.put(m)); }
    } else { const e = this.mem.get(id); if (e) f(e.meta); }
  }
  async rename(id: string, name: string) { await this.patch(id, (m) => { m.name = name; }); }
  async softDelete(id: string) { await this.patch(id, (m) => { m.deleted = true; }); }
  async countByLoad(): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    const db = await openDb();
    const all = db
      ? (await tx<LoadDocument[]>(db, META, 'readonly', (s) => s.getAll() as IDBRequest<LoadDocument[]>)) ?? []
      : [...this.mem.values()].map((x) => x.meta);
    for (const d of all) if (!d.deleted) out[d.loadId] = (out[d.loadId] ?? 0) + 1;
    return out;
  }
}

/* TODO(go-live): Firebase Storage implementation — upload to
   `loadDocs/{loadId}/{docId}` via the already-initialized app (firebase.ts),
   metadata in Firestore `loadDocuments`. Activated by VITE_DOCUMENT_STORE=firebase.
   Until implemented, the flag intentionally still returns the local store so
   flipping it early can never lose paperwork. */
export function documentStore(): DocumentStore {
  void integrationConfig.documentStore;
  return singleton;
}
const singleton = new LocalDocumentStore();
