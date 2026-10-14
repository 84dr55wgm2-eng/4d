// Minimal promise wrapper around IndexedDB (no dependency).
const DB_NAME = 'cinematic-world-studio';
const DB_VERSION = 2;
/** packageFiles: prepared package files when OPFS is unavailable (key: `<packageId>/<path>`, value: Blob) */
export type StoreName = 'worlds' | 'contentMeta' | 'settings' | 'packageFiles';

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    let settled = false;
    const fail = (error: Error | DOMException | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error ?? new Error('Le stockage local est indisponible.'));
    };
    const timer = setTimeout(() => fail(new Error('Le stockage local ne répond pas. Ferme les autres onglets du studio puis recharge cette page.')), 10000);
    req.onblocked = () => fail(new Error('Un ancien onglet du studio bloque la mise à jour du stockage. Ferme les autres onglets du studio puis recharge cette page. Tes projets sont conservés.'));
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of ['worlds', 'contentMeta', 'settings', 'packageFiles']) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
    };
    req.onsuccess = () => {
      const db = req.result;
      if (settled) { db.close(); return; }
      settled = true;
      clearTimeout(timer);
      // Release the old connection when another tab needs a newer schema.
      db.onversionchange = () => { db.close(); dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => fail(req.error);
  });
  return dbPromise;
}

function tx<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then((db) => new Promise<T>((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => resolve(req.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

export const idb = {
  get: <T,>(store: StoreName, key: string) => tx<T | undefined>(store, 'readonly', (s) => s.get(key) as IDBRequest<T | undefined>),
  put: (store: StoreName, key: string, value: unknown) => tx(store, 'readwrite', (s) => s.put(value, key)),
  del: (store: StoreName, key: string) => tx(store, 'readwrite', (s) => s.delete(key)),
  keys: (store: StoreName) => tx<IDBValidKey[]>(store, 'readonly', (s) => s.getAllKeys()),
  all: <T,>(store: StoreName) => tx<T[]>(store, 'readonly', (s) => s.getAll() as IDBRequest<T[]>),
};
