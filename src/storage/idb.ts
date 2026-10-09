// Minimal promise wrapper around IndexedDB (no dependency).
const DB_NAME = 'cinematic-world-studio';
const DB_VERSION = 1;
export type StoreName = 'worlds' | 'contentMeta' | 'settings';

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of ['worlds', 'contentMeta', 'settings']) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
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
