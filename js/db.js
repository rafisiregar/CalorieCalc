// Penyimpanan di perangkat (IndexedDB). Jika IndexedDB tidak tersedia
// (misalnya mode penyamaran di beberapa browser), data disimpan di memori saja.

const DB_NAME = 'foto-kalori';
const STORE = 'kv';
let dbPromise = null;
let memoryOnly = false;
const memory = new Map();

function open() {
  if (memoryOnly) return Promise.resolve(null);
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => { memoryOnly = true; resolve(null); };
        req.onblocked = () => { memoryOnly = true; resolve(null); };
      } catch (e) {
        memoryOnly = true;
        resolve(null);
      }
    });
  }
  return dbPromise;
}

function run(mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    if (!db) return resolve(fn(null));
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    let result;
    const req = fn(store);
    if (req) req.onsuccess = () => { result = req.result; };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
}

export const isMemoryOnly = () => memoryOnly;

export function get(key) {
  return run('readonly', (s) => (s ? s.get(key) : null)).then((v) => (memoryOnly ? memory.get(key) : v));
}

export function set(key, value) {
  if (memoryOnly) { memory.set(key, value); return Promise.resolve(); }
  return run('readwrite', (s) => (s ? s.put(value, key) : memory.set(key, value)));
}

export function del(key) {
  if (memoryOnly) { memory.delete(key); return Promise.resolve(); }
  return run('readwrite', (s) => (s ? s.delete(key) : memory.delete(key)));
}

// Semua pasangan [kunci, nilai] yang kuncinya diawali `prefix`.
export async function entries(prefix) {
  if (memoryOnly) return [...memory.entries()].filter(([k]) => k.startsWith(prefix));
  const db = await open();
  if (!db) return [...memory.entries()].filter(([k]) => k.startsWith(prefix));
  return new Promise((resolve, reject) => {
    const out = [];
    const tx = db.transaction(STORE, 'readonly');
    const range = IDBKeyRange.bound(prefix, prefix + '￿');
    const req = tx.objectStore(STORE).openCursor(range);
    req.onsuccess = () => {
      const c = req.result;
      if (c) { out.push([c.key, c.value]); c.continue(); }
    };
    tx.oncomplete = () => resolve(out);
    tx.onerror = () => reject(tx.error);
  });
}
