import { SAVE_VERSION, SaveError, migrate, sanitize, withChecksum, type SaveData } from './saveData';

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
        store.put(withChecksum({ ...data, version: SAVE_VERSION, savedAt: Date.now() }), slot);
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/**
 * Reads a save; if it is corrupted, falls back to the backup slot automatically.
 * `fromBackup` tells the caller so it can inform the player.
 */
export async function loadWithFallback(slot: string): Promise<{ data: SaveData; issues: string[]; fromBackup: boolean; error?: string } | null> {
  try {
    const r = await readSave(slot);
    if (r) return { ...r, fromBackup: false };
  } catch (e) {
    const b = await readSave(`${slot}.backup`).catch(() => null);
    if (b) return { ...b, fromBackup: true, error: String(e) };
    throw e;
  }
  return null;
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
  return new Blob([JSON.stringify(withChecksum({ ...data, version: SAVE_VERSION }))], { type: 'application/json' });
}

/** Max accepted import size (a large world is ~2–4 MB). */
export const MAX_IMPORT_BYTES = 32 * 1024 * 1024;

export async function importSave(file: Blob): Promise<{ data: SaveData; issues: string[] }> {
  if (file.size > MAX_IMPORT_BYTES) throw new SaveError('structure', 'size');
  const text = await file.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new SaveError('json');
  }
  const data = migrate(parsed);
  const issues = sanitize(data);
  return { data, issues };
}
