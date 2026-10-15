import { SAVE_VERSION, migrate, sanitize, type SaveData } from './saveData';

/**
 * IndexedDB persistence. Writes go through a single transaction so a crash
 * mid-save can never leave a half-written world; the previous save is kept as
 * a backup slot.
 */
const DB_NAME = 'era-dos-gigantes';
const STORE = 'saves';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function writeSave(slot: string, data: SaveData): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const prev = store.get(slot);
      prev.onsuccess = () => {
        if (prev.result) store.put(prev.result, `${slot}.backup`);
        store.put({ ...data, version: SAVE_VERSION, savedAt: Date.now() }, slot);
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function readSave(slot: string): Promise<{ data: SaveData; issues: string[] } | null> {
  const db = await openDb();
  try {
    const raw = await new Promise<unknown>((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(slot);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    if (!raw) return null;
    const data = migrate(raw);
    const issues = sanitize(data);
    return { data, issues };
  } finally {
    db.close();
  }
}

export async function deleteSave(slot: string): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(slot);
      tx.objectStore(STORE).delete(`${slot}.backup`);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export function exportSave(data: SaveData): Blob {
  return new Blob([JSON.stringify(data)], { type: 'application/json' });
}

export async function importSave(file: Blob): Promise<SaveData> {
  const text = await file.text();
  const data = migrate(JSON.parse(text));
  sanitize(data);
  return data;
}
