import { Inventory, type ItemList } from '../inventory/inventory';
import { RECIPE_BY_ID, type Recipe, type Station } from './recipes';

/**
 * Crafting queue. Materials are validated and removed atomically when a job
 * starts and fully refunded on cancel, so the inventory can never be left
 * half-consumed. Outputs that don't fit are returned as an overflow list for
 * the caller to drop in the world (never silently destroyed).
 */
export interface CraftJob {
  recipeId: string;
  remaining: number;
  /** Exactly what was taken from the inventory, refunded on cancel. */
  consumed: ItemList;
}

export type CraftError = 'unknown' | 'locked' | 'station' | 'tool' | 'materials';

export class Crafting {
  queue: CraftJob[] = [];
  /** Skill effects: time multiplier and chance to save one input on completion. */
  timeMultiplier = 1;
  refundChance = 0;
  random: () => number = Math.random;

  constructor(public unlocked: Set<string> = new Set()) {}

  check(r: Recipe, inv: Inventory, stations: Set<Station>): CraftError | null {
    if (r.unlock && !this.unlocked.has(r.unlock)) return 'locked';
    if (r.station !== 'hand' && !stations.has(r.station)) return 'station';
    if (r.tool && !r.tool.some((t) => inv.count(t) > 0)) return 'tool';
    if (!inv.has(r.inputs)) return 'materials';
    return null;
  }

  start(recipeId: string, inv: Inventory, stations: Set<Station>): CraftError | null {
    const r = RECIPE_BY_ID[recipeId];
    if (!r) return 'unknown';
    const err = this.check(r, inv, stations);
    if (err) return err;
    if (!inv.removeAll(r.inputs)) return 'materials';
    this.queue.push({ recipeId, remaining: r.time * this.timeMultiplier, consumed: { ...r.inputs } });
    return null;
  }

  /** Cancels a job and refunds its materials. Returns items that did not fit. */
  cancel(index: number, inv: Inventory): ItemList {
    const job = this.queue[index];
    if (!job) return {};
    this.queue.splice(index, 1);
    const overflow: ItemList = {};
    for (const [id, q] of Object.entries(job.consumed)) {
      const left = inv.add(id, q);
      if (left > 0) overflow[id] = left;
    }
    return overflow;
  }

  /** Advances the first job. Returns completed outputs and anything that didn't fit. */
  update(dt: number, inv: Inventory): { completed: string[]; overflow: ItemList } {
    const completed: string[] = [];
    const overflow: ItemList = {};
    const job = this.queue[0];
    if (!job) return { completed, overflow };
    job.remaining -= dt;
    if (job.remaining <= 0) {
      this.queue.shift();
      const r = RECIPE_BY_ID[job.recipeId];
      const left = inv.add(r.output, r.qty);
      if (left > 0) overflow[r.output] = left;
      completed.push(r.id);
      // Thrifty crafters sometimes save a unit of material.
      if (this.refundChance > 0 && this.random() < this.refundChance) {
        const ids = Object.keys(job.consumed);
        const back = ids[Math.floor(this.random() * ids.length)];
        if (back && inv.add(back, 1) > 0) overflow[back] = (overflow[back] ?? 0) + 1;
      }
    }
    return { completed, overflow };
  }
}
