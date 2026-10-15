import { ITEMS, type EquipSlot } from './items';

/**
 * Inventory with a stacked grid, quick-slot references and equipment.
 * Operations are transactional: they either fully succeed or change nothing,
 * which prevents duplication or loss during crafting, building and looting.
 */
export interface Stack {
  id: string;
  qty: number;
  /** Remaining durability for tools/weapons. */
  dur?: number;
  /** Species id for species-specific items (eggs). Stacks only with the same species. */
  sp?: string;
}

export interface InventoryData {
  slots: (Stack | null)[];
  equipment: Partial<Record<EquipSlot, Stack>>;
  /** Hotbar: indices into slots. */
  hotbar: (number | null)[];
}

export const BASE_CAPACITY_KG = 45;
export const GRID_SIZE = 30;
export const HOTBAR_SIZE = 6;

export function createInventory(): InventoryData {
  return { slots: Array(GRID_SIZE).fill(null), equipment: {}, hotbar: Array(HOTBAR_SIZE).fill(null) };
}

export type ItemList = Record<string, number>;

export class Inventory {
  /** Extra carrying capacity from outside the inventory (pack animals). Not saved. */
  extraCapacity = 0;

  constructor(public data: InventoryData = createInventory()) {}

  clone(): Inventory {
    return new Inventory(structuredClone(this.data));
  }

  /** Total quantity of an item; with `sp`, only that species' variant. */
  count(id: string, sp?: string): number {
    let n = 0;
    for (const s of this.data.slots) if (s && s.id === id && (sp === undefined || s.sp === sp)) n += s.qty;
    return n;
  }

  isFull(): boolean {
    return this.data.slots.every((s) => s !== null);
  }

  has(items: ItemList): boolean {
    return Object.entries(items).every(([id, q]) => this.count(id) >= q);
  }

  weight(): number {
    let w = 0;
    for (const s of this.data.slots) if (s) w += ITEMS[s.id].weight * s.qty;
    for (const s of Object.values(this.data.equipment)) if (s) w += ITEMS[s.id].weight * s.qty;
    return w;
  }

  capacity(): number {
    let c = BASE_CAPACITY_KG + this.extraCapacity;
    for (const s of Object.values(this.data.equipment)) if (s) c += ITEMS[s.id].capacity ?? 0;
    return c;
  }

  /** How many of an item can be added given slots (not weight; weight only slows the player). */
  roomFor(id: string): number {
    const def = ITEMS[id];
    let room = 0;
    for (const s of this.data.slots) {
      if (!s) room += def.maxStack;
      else if (s.id === id && s.dur === undefined) room += def.maxStack - s.qty;
    }
    return room;
  }

  /** Adds items; returns quantity that did NOT fit (0 on full success). */
  add(id: string, qty: number, dur?: number, sp?: string): number {
    const def = ITEMS[id];
    if (!def) throw new Error(`Unknown item ${id}`);
    if (!Number.isFinite(qty) || qty <= 0) return 0;
    qty = Math.floor(qty);
    let left = qty;
    const durable = def.durability !== undefined;
    if (!durable) {
      for (const s of this.data.slots) {
        if (left <= 0) break;
        if (s && s.id === id && s.sp === sp && s.qty < def.maxStack) {
          const n = Math.min(left, def.maxStack - s.qty);
          s.qty += n;
          left -= n;
        }
      }
    }
    for (let i = 0; i < this.data.slots.length && left > 0; i++) {
      if (this.data.slots[i]) continue;
      const n = durable ? 1 : Math.min(left, def.maxStack);
      this.data.slots[i] = durable ? { id, qty: 1, dur: dur ?? def.durability } : sp ? { id, qty: n, sp } : { id, qty: n };
      left -= n;
    }
    return left;
  }

  /** Puts tools, weapons, food and medicine into empty hotbar slots (first come, first served). */
  autoHotbar(): void {
    const quick = new Set(['tool', 'weapon', 'food', 'medical']);
    const assigned = new Set(this.data.hotbar.filter((h): h is number => h !== null));
    const seenIds = new Set(this.data.hotbar.map((h) => (h !== null ? this.data.slots[h]?.id : undefined)));
    for (let i = 0; i < this.data.slots.length; i++) {
      const s = this.data.slots[i];
      if (!s || assigned.has(i) || seenIds.has(s.id) || !quick.has(ITEMS[s.id].category)) continue;
      const free = this.data.hotbar.indexOf(null);
      if (free < 0) return;
      this.data.hotbar[free] = i;
      assigned.add(i);
      seenIds.add(s.id);
    }
  }

  /** Adds all items or none. */
  addAll(items: ItemList): boolean {
    const trial = this.clone();
    for (const [id, q] of Object.entries(items)) if (trial.add(id, q) > 0) return false;
    this.data = trial.data;
    return true;
  }

  /** Removes items; all-or-nothing. */
  remove(id: string, qty: number, sp?: string): boolean {
    if (!Number.isFinite(qty) || qty < 0 || this.count(id, sp) < qty) return false;
    let left = qty;
    // Take from the smallest stacks first to keep the grid tidy.
    const idx = this.data.slots
      .map((s, i) => [s, i] as const)
      .filter(([s]) => s && s.id === id && (sp === undefined || s.sp === sp))
      .sort((a, b) => a[0]!.qty - b[0]!.qty)
      .map(([, i]) => i);
    for (const i of idx) {
      const s = this.data.slots[i]!;
      const n = Math.min(s.qty, left);
      s.qty -= n;
      left -= n;
      if (s.qty <= 0) this.clearSlot(i);
      if (left <= 0) break;
    }
    return true;
  }

  removeAll(items: ItemList): boolean {
    if (!this.has(items)) return false;
    for (const [id, q] of Object.entries(items)) this.remove(id, q);
    return true;
  }

  private clearSlot(i: number): void {
    this.data.slots[i] = null;
    this.data.hotbar = this.data.hotbar.map((h) => (h === i ? null : h));
  }

  /** Removes and returns a whole slot (for dropping/transfer). */
  takeSlot(i: number): Stack | null {
    const s = this.data.slots[i];
    if (!s) return null;
    this.clearSlot(i);
    return s;
  }

  moveSlot(from: number, to: number): void {
    const a = this.data.slots[from];
    const b = this.data.slots[to];
    if (a && b && a.id === b.id && a.sp === b.sp && a.dur === undefined && b.dur === undefined) {
      const max = ITEMS[a.id].maxStack;
      const n = Math.min(a.qty, max - b.qty);
      b.qty += n;
      a.qty -= n;
      if (a.qty <= 0) this.clearSlot(from);
      return;
    }
    this.data.slots[from] = b;
    this.data.slots[to] = a;
    this.data.hotbar = this.data.hotbar.map((h) => (h === from ? to : h === to ? from : h));
  }

  /** Equips the item in slot i, swapping any equipped item back into the grid. */
  equip(i: number): boolean {
    const s = this.data.slots[i];
    if (!s) return false;
    const slot = ITEMS[s.id].equip;
    if (!slot) return false;
    const prev = this.data.equipment[slot];
    this.clearSlot(i);
    this.data.equipment[slot] = s;
    if (prev) this.data.slots[i] = prev;
    return true;
  }

  unequip(slot: EquipSlot): boolean {
    const s = this.data.equipment[slot];
    if (!s) return false;
    const free = this.data.slots.findIndex((x) => !x);
    if (free < 0) return false;
    this.data.slots[free] = s;
    delete this.data.equipment[slot];
    return true;
  }

  /** Stable auto-sort by category then id; merges partial stacks. */
  sort(): void {
    const order = ['tool', 'weapon', 'ammo', 'food', 'medical', 'resource', 'building', 'clothing', 'special'];
    const hotIds = this.data.hotbar.map((h) => (h !== null ? this.data.slots[h] : null));
    const items = this.data.slots.filter((s): s is Stack => !!s);
    const merged: Stack[] = [];
    for (const s of items) {
      if (s.dur === undefined) {
        const m = merged.find((x) => x.id === s.id && x.sp === s.sp && x.dur === undefined && x.qty < ITEMS[x.id].maxStack);
        if (m) {
          const n = Math.min(s.qty, ITEMS[m.id].maxStack - m.qty);
          m.qty += n;
          if (s.qty - n > 0) merged.push({ ...s, qty: s.qty - n });
          continue;
        }
      }
      merged.push(s);
    }
    merged.sort((a, b) => order.indexOf(ITEMS[a.id].category) - order.indexOf(ITEMS[b.id].category) || a.id.localeCompare(b.id));
    this.data.slots = Array(GRID_SIZE).fill(null);
    merged.forEach((s, i) => (this.data.slots[i] = s));
    this.data.hotbar = hotIds.map((h) => {
      if (!h) return null;
      const i = this.data.slots.findIndex((s) => s === h) ;
      const j = i >= 0 ? i : this.data.slots.findIndex((s) => s?.id === h.id);
      return j >= 0 ? j : null;
    });
  }

  /** Damages durability of slot i; breaks (removes) it at zero. Returns true if it broke. */
  wear(i: number, amount = 1): boolean {
    const s = this.data.slots[i];
    if (!s || s.dur === undefined) return false;
    s.dur -= amount;
    if (s.dur <= 0) {
      this.clearSlot(i);
      return true;
    }
    return false;
  }

  /** Empties everything (used for death drops); returns the removed stacks. */
  takeEverything(includeEquipment: boolean): Stack[] {
    const out = this.data.slots.filter((s): s is Stack => !!s);
    this.data.slots = Array(GRID_SIZE).fill(null);
    this.data.hotbar = Array(HOTBAR_SIZE).fill(null);
    if (includeEquipment) {
      for (const s of Object.values(this.data.equipment)) if (s) out.push(s);
      this.data.equipment = {};
    }
    return out;
  }

  /** Validates and repairs data loaded from disk. Returns list of problems fixed. */
  static sanitize(data: InventoryData): string[] {
    const issues: string[] = [];
    if (!Array.isArray(data.slots)) {
      data.slots = [];
      issues.push('slots');
    }
    data.slots = Array.from({ length: GRID_SIZE }, (_, i) => data.slots[i] ?? null).map((s) => {
      if (!s) return null;
      const def = ITEMS[s.id];
      if (!def || !Number.isFinite(s.qty) || s.qty <= 0) {
        issues.push(`invalid ${s.id}`);
        return null;
      }
      if (s.qty > def.maxStack) {
        issues.push(`overstack ${s.id}`);
        s.qty = def.maxStack;
      }
      s.qty = Math.floor(s.qty);
      // Normalize: only known fields, durability within limits, species tag must be a string.
      const out: Stack = { id: s.id, qty: s.qty };
      if (def.durability !== undefined) {
        out.qty = 1;
        out.dur = Number.isFinite(s.dur) ? Math.max(1, Math.min(def.durability, s.dur!)) : def.durability;
      }
      if (typeof s.sp === 'string' && /^[a-z]+$/.test(s.sp)) out.sp = s.sp;
      return out;
    });
    if (!Array.isArray(data.hotbar)) data.hotbar = [];
    data.hotbar = Array.from({ length: HOTBAR_SIZE }, (_, i) => {
      const h = data.hotbar[i];
      return typeof h === 'number' && data.slots[h] ? h : null;
    });
    data.equipment ??= {};
    for (const [k, s] of Object.entries(data.equipment)) {
      if (!s || !ITEMS[s.id] || ITEMS[s.id].equip !== k || !Number.isFinite(s.qty)) {
        delete data.equipment[k as EquipSlot];
        issues.push(`equip ${k}`);
      }
    }
    return issues;
  }
}
