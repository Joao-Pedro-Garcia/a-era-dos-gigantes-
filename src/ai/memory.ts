import type { AnimalData, MemoryEntry, MemoryKind } from '../animals/animal';

/**
 * Bounded episodic memory. Entries are merged spatially, decay with time and
 * the weakest are forgotten. Animals only remember what they perceived.
 */
export const MEMORY_CAPACITY = 12;

/** Half-life in game seconds per memory kind (a game day is 1200 s). */
const HALF_LIFE: Record<MemoryKind, number> = {
  threat: 1200 * 4,
  danger: 1200 * 2,
  food: 1200 * 3,
  water: 1200 * 8,
  peaceful: 1200 * 3,
  chaseFailed: 1200 * 2,
  chaseWon: 1200 * 3,
  injured: 1200 * 6,
};

const MERGE_RADIUS = 35;

export function currentStrength(e: MemoryEntry, now: number): number {
  return e.strength * Math.pow(0.5, Math.max(0, now - e.t) / HALF_LIFE[e.kind]);
}

export function remember(a: AnimalData, entry: Omit<MemoryEntry, 't'>, now: number): void {
  for (const e of a.memory) {
    if (e.kind === entry.kind && e.subject === entry.subject && Math.hypot(e.x - entry.x, e.z - entry.z) < MERGE_RADIUS) {
      const s = currentStrength(e, now);
      e.strength = Math.min(5, s + entry.strength);
      e.t = now;
      e.x = (e.x + entry.x) / 2;
      e.z = (e.z + entry.z) / 2;
      return;
    }
  }
  a.memory.push({ ...entry, t: now });
  if (a.memory.length > MEMORY_CAPACITY) forgetWeakest(a, now);
}

export function forgetWeakest(a: AnimalData, now: number): void {
  let wi = 0;
  let ws = Infinity;
  a.memory.forEach((e, i) => {
    const s = currentStrength(e, now);
    if (s < ws) {
      ws = s;
      wi = i;
    }
  });
  a.memory.splice(wi, 1);
}

/** Drops memories that have faded to irrelevance. */
export function pruneMemory(a: AnimalData, now: number): void {
  a.memory = a.memory.filter((e) => currentStrength(e, now) > 0.05);
}

/** Total strength of memories of a kind about a subject (any location). */
export function recallSubject(a: AnimalData, kind: MemoryKind, subject: string, now: number): number {
  let s = 0;
  for (const e of a.memory) if (e.kind === kind && e.subject === subject) s += currentStrength(e, now);
  return s;
}

/** How dangerous a location feels based on remembered threats/danger nearby. */
export function dangerAt(a: AnimalData, x: number, z: number, now: number, radius = 60): number {
  let d = 0;
  for (const e of a.memory) {
    if (e.kind !== 'danger' && e.kind !== 'threat' && e.kind !== 'injured') continue;
    const dist = Math.hypot(e.x - x, e.z - z);
    if (dist < radius) d += currentStrength(e, now) * (1 - dist / radius);
  }
  return d;
}

export function nearestMemory(a: AnimalData, kind: MemoryKind, x: number, z: number, now: number): MemoryEntry | null {
  let best: MemoryEntry | null = null;
  let bd = Infinity;
  for (const e of a.memory) {
    if (e.kind !== kind || currentStrength(e, now) < 0.1) continue;
    const d = Math.hypot(e.x - x, e.z - z);
    if (d < bd) {
      bd = d;
      best = e;
    }
  }
  return best;
}
