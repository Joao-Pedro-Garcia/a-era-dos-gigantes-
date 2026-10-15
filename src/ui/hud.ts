import { DEFAULT_SETTINGS, WORLD, type Settings } from '../core/config';
import { SPECIES, SPECIES_IDS } from '../animals/species';
import { PIECES, type PieceType } from '../building/building';
import type { Crafting } from '../crafting/crafting';
import { RECIPES, type Station } from '../crafting/recipes';
import type { Action, Input } from '../input/input';
import type { Inventory, Stack } from '../inventory/inventory';
import { ITEMS, type EquipSlot } from '../inventory/items';
import { t, setLanguage } from '../localization/i18n';
import type { SurvivalData } from '../survival/survival';
import { BIOMES } from '../world/biomes';
import type { Terrain } from '../world/terrain';

/** Everything the UI is allowed to ask of the game. */
export interface GameApi {
  input: Input;
  inventory: Inventory;
  crafting: Crafting;
  settings: Settings;
  terrain: Terrain | null;
  selectedHotbar: number;
  buildPiece: PieceType;
  buildSnap: boolean;
  building: boolean;
  seenSpecies: Set<string>;
  discovered: Set<string>;
  hasSave: boolean;
  openStorageItems(): (Stack | null)[] | null;
  stations(): Set<Station>;
  craft(id: string): void;
  cancelCraft(i: number): void;
  useSlot(i: number): void;
  dropSlot(i: number): void;
  equipSlot(i: number): void;
  unequip(slot: EquipSlot): void;
  moveSlot(a: number, b: number): void;
  assignHotbar(slot: number, hot: number): void;
  sortInventory(): void;
  storageTransfer(dir: 'in' | 'out', index: number): void;
  setBuildPiece(p: PieceType): void;
  toggleBuild(): void;
  applySettings(s: Partial<Settings>): void;
  newGame(seed: number): void;
  continueGame(): void;
  save(): void;
  exportSave(): void;
  importSave(f: File): void;
  respawn(): void;
  quitToMenu(): void;
  resume(): void;
  mapMarkers(): { x: number; z: number; kind: 'player' | 'site' | 'bag' | 'bed'; label?: string; heading?: number }[];
}

const ICON: Partial<Record<string, string>> = {
  wood: '🪵', stone: '🪨', fiber: '🌾', flint: '🔷', clay: '🟫', hide: '🟤', bone: '🦴', obsidian: '⬛', sulfur: '🟡', metal_ore: '⛏', metal_scrap: '⚙',
  ice: '🧊', herb: '🌿', cycad_fronds: '🌴', fern_fronds: '🌱', berries: '🫐', raw_meat: '🥩', cooked_meat: '🍖', raw_fish: '🐟', egg: '🥚',
  waterskin: '👝', waterskin_full: '💧', stone_axe: '🪓', stone_pickaxe: '⛏', stone_knife: '🔪', spear: '🗡', obsidian_spear: '🗡', bow: '🏹', arrow: '➶',
  torch: '🔥', bandage: '🩹', herbal_poultice: '🌿', hide_hood: '🧢', hide_tunic: '🧥', hide_leggings: '👖', fur_coat: '🧥', backpack: '🎒',
  trap_snare: '🪢', field_journal: '📔', research_scanner: '📡',
};

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

const itemName = (id: string) => t(`item.${id}`);

export type PanelTab = 'inventory' | 'crafting' | 'journal' | 'map' | 'storage';

export class Hud {
  readonly root: HTMLElement;
  private bars: Record<string, HTMLElement> = {};
  private statusEl: HTMLElement;
  private topEl: HTMLElement;
  private perfEl: HTMLElement;
  private notesEl: HTMLElement;
  private promptEl: HTMLElement;
  private hotbarEl: HTMLElement;
  private buildEl: HTMLElement;
  private panelEl: HTMLElement;
  private menuEl: HTMLElement;
  private touchEl: HTMLElement;
  private flashEl: HTMLElement;
  private crosshair: HTMLElement;
  tab: PanelTab = 'inventory';
  private picked: number | null = null;
  private filter = 'all';
  private mapCanvas: HTMLCanvasElement | null = null;
  private mapRow = 0;
  private lastHotbarKey = '';
  panelOpen = false;
  menuOpen = false;
  private rebinding: Action | null = null;

  constructor(private game: GameApi) {
    this.root = document.getElementById('ui')!;
    this.root.innerHTML = '';
    this.flashEl = this.add(h('div', 'damage-flash'));
    this.crosshair = this.add(h('div', 'crosshair'));
    const bars = this.add(h('div', 'bars'));
    const defs: [string, string, string][] = [
      ['health', '❤', '#d4553f'], ['food', '🍖', '#d9a04a'], ['water', '💧', '#5aa7d6'], ['energy', '⚡', '#c6c06a'], ['stamina', '💨', '#9bd0a0'],
    ];
    for (const [k, icon, color] of defs) {
      const row = h('div', 'bar', `<span title="${t(`stat.${k}`)}">${icon}</span><div class="track"><div class="fill" style="background:${color}"></div></div>`);
      bars.appendChild(row);
      this.bars[k] = row;
    }
    this.statusEl = bars.appendChild(h('div', 'status'));
    this.topEl = this.add(h('div', 'top'));
    this.perfEl = this.add(h('div', 'perf hidden'));
    this.notesEl = this.add(h('div', 'notes'));
    this.promptEl = this.add(h('div', 'prompt hidden'));
    this.hotbarEl = this.add(h('div', 'hotbar'));
    this.buildEl = this.add(h('div', 'buildbar interactive hidden'));
    this.touchEl = this.add(h('div', 'touch hidden'));
    this.panelEl = this.add(h('div', 'panel hidden'));
    this.menuEl = this.add(h('div', 'menu hidden'));
    this.buildTouch();
    this.setTouchMode(game.input.mode === 'touch');
  }

  private add<T extends HTMLElement>(e: T): T {
    this.root.appendChild(e);
    return e;
  }

  setTouchMode(on: boolean): void {
    document.body.classList.toggle('touch-mode', on);
    this.touchEl.classList.toggle('hidden', !on || this.menuOpen);
  }

  setGameplayVisible(on: boolean): void {
    for (const el of [this.topEl, this.hotbarEl, this.crosshair, this.statusEl.parentElement!]) el.classList.toggle('hidden', !on);
    if (!on) {
      this.promptEl.classList.add('hidden');
      this.buildEl.classList.add('hidden');
    }
    this.touchEl.classList.toggle('hidden', !on || this.game.input.mode !== 'touch');
  }

  // ------------------------------------------------------------------ HUD

  updateStats(d: SurvivalData, felt: number, overweight: boolean): void {
    const set = (k: string, v: number) => {
      const el = this.bars[k];
      (el.querySelector('.fill') as HTMLElement).style.width = `${Math.max(0, Math.min(100, v))}%`;
      el.classList.toggle('low', v < 20);
    };
    set('health', d.health);
    set('food', d.food);
    set('water', d.water);
    set('energy', d.energy);
    set('stamina', d.stamina);
    const chips: string[] = [];
    const tempChip = `<span class="chip info">🌡 ${d.bodyTemp.toFixed(1)}°C · ${Math.round(felt)}°</span>`;
    if (d.bleeding > 0.05) chips.push(t('status.bleeding'));
    if (d.fracture > 0.05) chips.push(t('status.fracture'));
    if (d.sickness > 0.1) chips.push(t('status.sick'));
    if (d.bodyTemp < 36) chips.push(t('status.cold'));
    if (d.bodyTemp > 38.5) chips.push(t('status.hot'));
    if (overweight) chips.push(t('status.overweight'));
    const html = tempChip + chips.map((c) => `<span class="chip">${c}</span>`).join('');
    if (this.statusEl.innerHTML !== html) this.statusEl.innerHTML = html;
  }

  updateTop(day: number, frac: number, weather: string, biome: string, yaw: number): void {
    const hours = Math.floor(frac * 24);
    const mins = Math.floor((frac * 24 - hours) * 60);
    const dirs = ['N', 'NE', 'L', 'SE', 'S', 'SO', 'O', 'NO'];
    // yaw 0 faces +z (south); north is -z.
    const deg = ((180 - (yaw * 180) / Math.PI) % 360 + 360) % 360;
    const dir = dirs[Math.round(deg / 45) % 8];
    const icon = { clear: '☀', cloudy: '☁', rain: '🌧', storm: '⛈', fog: '🌫' }[weather] ?? '';
    const html = `<span class="compass">${dir}</span><span>${t('hud.day', { d: day + 1 })} · ${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}</span><span>${icon}</span><span class="muted">${t(`biome.${biome}`)}</span>`;
    if (this.topEl.innerHTML !== html) this.topEl.innerHTML = html;
  }

  setPerf(text: string | null): void {
    this.perfEl.classList.toggle('hidden', !text);
    if (text) this.perfEl.textContent = text;
  }

  notify(text: string, kind: 'info' | 'warn' | 'good' = 'info'): void {
    const n = h('div', `note ${kind}`);
    n.textContent = text;
    this.notesEl.prepend(n);
    while (this.notesEl.children.length > 5) this.notesEl.lastElementChild!.remove();
    setTimeout(() => n.remove(), 5000);
  }

  prompt(text: string | null): void {
    this.promptEl.classList.toggle('hidden', !text);
    if (text && this.promptEl.textContent !== text) this.promptEl.textContent = text;
  }

  damageFlash(): void {
    this.flashEl.style.transition = 'none';
    this.flashEl.style.opacity = '1';
    requestAnimationFrame(() => {
      this.flashEl.style.transition = 'opacity .6s';
      this.flashEl.style.opacity = '0';
    });
  }

  renderHotbar(): void {
    const inv = this.game.inventory.data;
    const key = JSON.stringify([inv.hotbar, inv.hotbar.map((i) => (i !== null ? inv.slots[i] : null)), this.game.selectedHotbar]);
    if (key === this.lastHotbarKey) return;
    this.lastHotbarKey = key;
    this.hotbarEl.innerHTML = '';
    inv.hotbar.forEach((idx, i) => {
      const s = idx !== null ? inv.slots[idx] : null;
      const el = this.slotEl(s, `${i + 1}`);
      el.classList.toggle('sel', i === this.game.selectedHotbar);
      el.classList.add('interactive');
      el.onclick = () => {
        this.game.selectedHotbar = i;
        this.lastHotbarKey = '';
        this.renderHotbar();
      };
      this.hotbarEl.appendChild(el);
    });
  }

  private slotEl(s: Stack | null, keyLabel = ''): HTMLElement {
    const el = h('div', 'slot');
    if (keyLabel) el.appendChild(h('span', 'key', keyLabel));
    if (s) {
      el.title = itemName(s.id);
      el.appendChild(h('span', '', `<span class="ico">${ICON[s.id] ?? '◆'}</span>${itemName(s.id)}`));
      if (s.qty > 1) el.appendChild(h('span', 'qty', String(s.qty)));
      const max = ITEMS[s.id].durability;
      if (s.dur !== undefined && max) el.appendChild(h('span', 'dur', `<i style="width:${(s.dur / max) * 100}%"></i>`));
    }
    return el;
  }

  // ------------------------------------------------------------------ build bar

  showBuild(on: boolean, validReason: string | null = null): void {
    this.buildEl.classList.toggle('hidden', !on);
    if (!on) return;
    const g = this.game;
    const touch = g.input.mode === 'touch';
    const key = `${g.buildPiece}|${g.buildSnap}|${validReason}|${touch}|${JSON.stringify(g.inventory.data.slots.map((s) => s && s.qty))}`;
    if (this.buildEl.dataset.key === key) return;
    this.buildEl.dataset.key = key;
    this.buildEl.innerHTML = '';
    const pieces = h('div', 'pieces');
    for (const p of Object.keys(PIECES) as PieceType[]) {
      const def = PIECES[p];
      const ok = g.inventory.has(def.cost);
      const cost = Object.entries(def.cost).map(([k, q]) => `${q} ${itemName(k)}`).join(', ');
      const b = h('button', p === g.buildPiece ? 'active' : '', `${t(`piece.${p}`)}<br><span class="muted" style="color:${ok ? 'var(--muted)' : 'var(--bad)'}">${cost}</span>`);
      b.onclick = () => g.setBuildPiece(p);
      pieces.appendChild(b);
    }
    this.buildEl.appendChild(pieces);
    const info = h('div', 'info');
    info.textContent = `${t('build.mode', { snap: g.buildSnap ? t('build.snap') : t('build.free') })}${validReason ? ` — ${t(`build.invalid.${validReason}`)}` : ''} · ${touch ? t('build.helpTouch') : t('build.help')}`;
    this.buildEl.appendChild(info);
    if (touch) {
      const row = h('div', 'row');
      row.style.justifyContent = 'center';
      const mk = (label: string, a: Action) => {
        const b = h('button', '', label);
        b.onclick = () => g.input.touchPress(a);
        row.appendChild(b);
      };
      mk('⟲', 'rotateLeft');
      mk(t('build.place'), 'attack');
      mk('⟳', 'rotateRight');
      mk('⌗', 'snapToggle');
      mk('✖', 'demolish');
      this.buildEl.appendChild(row);
    }
  }

  // ------------------------------------------------------------------ panels

  openPanel(tab: PanelTab): void {
    this.tab = tab;
    this.panelOpen = true;
    this.picked = null;
    this.panelEl.classList.remove('hidden');
    this.renderPanel();
  }

  closePanel(): void {
    this.panelOpen = false;
    this.panelEl.classList.add('hidden');
  }

  renderPanel(): void {
    if (!this.panelOpen) return;
    const g = this.game;
    const p = this.panelEl;
    p.innerHTML = '';
    const tabs = h('div', 'tabs');
    const tabList: PanelTab[] = ['inventory', 'crafting', 'journal', 'map'];
    if (g.openStorageItems()) tabList.push('storage');
    const labels: Record<PanelTab, string> = { inventory: t('inv.title'), crafting: t('inv.crafting'), journal: t('inv.journal'), map: '🗺', storage: t('piece.storage') };
    for (const tb of tabList) {
      const b = h('button', tb === this.tab ? 'active' : '', labels[tb]);
      b.onclick = () => {
        this.tab = tb;
        this.renderPanel();
      };
      tabs.appendChild(b);
    }
    const close = h('button', 'close', '✕');
    close.onclick = () => g.resume();
    tabs.appendChild(close);
    p.appendChild(tabs);
    const body = h('div', 'panel-body');
    p.appendChild(body);
    if (this.tab === 'inventory') this.renderInventory(body);
    else if (this.tab === 'crafting') this.renderCrafting(body);
    else if (this.tab === 'journal') this.renderJournal(body);
    else if (this.tab === 'map') this.renderMap(body);
    else this.renderStorage(body);
  }

  private renderInventory(body: HTMLElement): void {
    const g = this.game;
    const inv = g.inventory;
    const layout = h('div', 'inv-layout');
    const left = h('div');
    const filters = h('div', 'filters');
    for (const f of ['all', 'resource', 'food', 'tool', 'weapon', 'clothing', 'medical']) {
      const b = h('button', f === this.filter ? 'active' : '', f === 'all' ? t('inv.filter.all') : ({ resource: '🪵', food: '🍖', tool: '🪓', weapon: '🗡', clothing: '🧥', medical: '🩹' } as Record<string, string>)[f]);
      b.onclick = () => {
        this.filter = f;
        this.renderPanel();
      };
      filters.appendChild(b);
    }
    const sort = h('button', '', t('inv.sort'));
    sort.onclick = () => {
      g.sortInventory();
      this.renderPanel();
    };
    filters.appendChild(sort);
    left.appendChild(filters);
    const grid = h('div', 'grid');
    inv.data.slots.forEach((s, i) => {
      const el = this.slotEl(s);
      if (s && this.filter !== 'all' && ITEMS[s.id].category !== this.filter) el.style.opacity = '0.25';
      if (i === this.picked) el.classList.add('picked');
      el.onclick = () => {
        if (this.picked !== null && this.picked !== i) {
          g.moveSlot(this.picked, i);
          this.picked = null;
        } else this.picked = this.picked === i ? null : s ? i : null;
        this.renderPanel();
      };
      grid.appendChild(el);
    });
    left.appendChild(grid);
    left.appendChild(h('p', 'muted', t('inv.weight', { w: inv.weight().toFixed(1), c: inv.capacity().toFixed(0) })));
    layout.appendChild(left);

    const side = h('div', 'side');
    const sel = this.picked !== null ? inv.data.slots[this.picked] : null;
    const box = h('div', 'box');
    if (sel && this.picked !== null) {
      const i = this.picked;
      const def = ITEMS[sel.id];
      box.appendChild(h('h4', '', `${ICON[sel.id] ?? ''} ${itemName(sel.id)} ×${sel.qty}`));
      box.appendChild(h('div', 'muted', `${def.weight} kg${def.damage ? ` · ⚔ ${def.damage}` : ''}${def.insulation ? ` · 🌡 +${def.insulation}°` : ''}${def.capacity ? ` · +${def.capacity} kg` : ''}`));
      const row = h('div', 'row');
      const btn = (label: string, fn: () => void) => {
        const b = h('button', '', label);
        b.onclick = () => {
          fn();
          this.renderPanel();
        };
        row.appendChild(b);
      };
      if (def.food || def.heal || sel.id === 'waterskin_full') btn(t('inv.use'), () => g.useSlot(i));
      if (def.equip) btn(t('inv.equip'), () => {
        g.equipSlot(i);
        this.picked = null;
      });
      btn(t('inv.drop'), () => {
        g.dropSlot(i);
        this.picked = null;
      });
      box.appendChild(row);
      const hot = h('div', 'row');
      hot.style.marginTop = '6px';
      for (let k = 0; k < 6; k++) {
        const b = h('button', '', String(k + 1));
        b.title = t('inv.toHotbar', { n: k + 1 });
        b.onclick = () => {
          g.assignHotbar(i, k);
          this.lastHotbarKey = '';
          this.renderPanel();
        };
        hot.appendChild(b);
      }
      box.appendChild(hot);
    } else box.appendChild(h('div', 'muted', '—'));
    side.appendChild(box);
    const eq = h('div', 'box', `<h4>${t('inv.equipment')}</h4>`);
    for (const slot of ['head', 'body', 'legs', 'back'] as EquipSlot[]) {
      const s = inv.data.equipment[slot];
      const row = h('div', 'row');
      row.appendChild(h('span', 'muted', `${slot}: ${s ? itemName(s.id) : t('inv.empty')}`));
      if (s) {
        const b = h('button', '', t('inv.unequip'));
        b.onclick = () => {
          g.unequip(slot);
          this.renderPanel();
        };
        row.appendChild(b);
      }
      eq.appendChild(row);
    }
    side.appendChild(eq);
    layout.appendChild(side);
    body.appendChild(layout);
  }

  private renderCrafting(body: HTMLElement): void {
    const g = this.game;
    const stations = g.stations();
    if (g.crafting.queue.length) {
      const q = h('div', 'box', `<h4>${t('craft.queue')}</h4>`);
      g.crafting.queue.forEach((job, i) => {
        const r = RECIPES.find((x) => x.id === job.recipeId)!;
        const row = h('div', 'row');
        row.appendChild(h('span', '', `${itemName(r.output)} — ${Math.ceil(job.remaining)}s`));
        const c = h('button', '', t('craft.cancel'));
        c.onclick = () => {
          g.cancelCraft(i);
          this.renderPanel();
        };
        row.appendChild(c);
        q.appendChild(row);
      });
      body.appendChild(q);
      body.appendChild(h('div', '', '&nbsp;'));
    }
    let lastCat = '';
    for (const r of RECIPES) {
      if (r.category !== lastCat) {
        body.appendChild(h('h4', '', t(`cat.${r.category}`)));
        lastCat = r.category;
      }
      const err = g.crafting.check(r, g.inventory, stations);
      const row = h('div', 'recipe');
      const inputs = Object.entries(r.inputs)
        .map(([k, q]) => `<span class="${g.inventory.count(k) >= q ? 'have' : 'lack'}">${q} ${itemName(k)}</span>`)
        .join(' · ');
      const note = err === 'locked' ? t('craft.locked') : err === 'station' ? t('craft.needs', { station: t(`station.${r.station}`) }) : `${r.time}s`;
      row.appendChild(h('div', '', `<b>${ICON[r.output] ?? ''} ${itemName(r.output)}${r.qty > 1 ? ` ×${r.qty}` : ''}</b><br><span class="muted">${err === 'locked' ? '???' : inputs}</span><br><span class="muted">${note}</span>`));
      const b = h('button', err ? '' : 'primary', t('craft.make'));
      b.disabled = !!err;
      b.onclick = () => {
        g.craft(r.id);
        this.renderPanel();
      };
      row.appendChild(b);
      body.appendChild(row);
    }
  }

  private renderJournal(body: HTMLElement): void {
    const g = this.game;
    body.appendChild(h('p', 'muted', `${t('journal.seen', { n: g.seenSpecies.size, t: SPECIES_IDS.length })}<br>${t('journal.note')}`));
    for (const id of SPECIES_IDS) {
      const sp = SPECIES[id];
      const seen = g.seenSpecies.has(id);
      const lang = g.settings.language;
      const e = h('div', 'journal-entry');
      e.innerHTML = seen
        ? `<b>${sp.name[lang]}</b> <i class="muted">${sp.scientificName}</i><br><span class="muted">${t('journal.period', { p: sp.period })} · ${t('journal.diet', { d: t(`diet.${sp.diet}`) })} · ${t('journal.size', { l: sp.lengthM, m: sp.massKg >= 1000 ? `${(sp.massKg / 1000).toFixed(1)} t` : `${sp.massKg} kg` })}</span>`
        : `<b>???</b> <span class="muted">${t('journal.unknown')}</span>`;
      body.appendChild(e);
    }
  }

  private renderStorage(body: HTMLElement): void {
    const g = this.game;
    const items = g.openStorageItems();
    if (!items) return;
    const wrap = h('div', 'inv-layout');
    const mk = (title: string, slots: (Stack | null)[], dir: 'in' | 'out') => {
      const col = h('div', 'box', `<h4>${title}</h4>`);
      const grid = h('div', 'grid');
      slots.forEach((s, i) => {
        const el = this.slotEl(s);
        el.onclick = () => {
          if (!s) return;
          g.storageTransfer(dir, i);
          this.renderPanel();
        };
        grid.appendChild(el);
      });
      col.appendChild(grid);
      return col;
    };
    wrap.appendChild(mk(t('inv.title'), g.inventory.data.slots, 'in'));
    wrap.appendChild(mk(t('piece.storage'), items, 'out'));
    body.appendChild(wrap);
  }

  private renderMap(body: HTMLElement): void {
    const wrap = h('div', 'map-wrap');
    const size = 256;
    if (!this.mapCanvas) {
      this.mapCanvas = document.createElement('canvas');
      this.mapCanvas.width = this.mapCanvas.height = size;
      this.mapRow = 0;
    }
    const view = document.createElement('canvas');
    view.width = view.height = 512;
    wrap.appendChild(view);
    body.appendChild(wrap);
    body.appendChild(h('p', 'muted', '▲ você · ◆ locais descobertos · ✖ itens perdidos · ⌂ cama'));
    const draw = () => {
      if (!this.panelOpen || this.tab !== 'map') return;
      const t0 = performance.now();
      while (this.mapRow < 256 && performance.now() - t0 < 12) this.fillMapRows(2);
      const ctx = view.getContext('2d')!;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this.mapCanvas!, 0, 0, 512, 512);
      const toPx = (x: number, z: number) => [((x + WORLD.worldHalfSize) / (WORLD.worldHalfSize * 2)) * 512, ((z + WORLD.worldHalfSize) / (WORLD.worldHalfSize * 2)) * 512];
      ctx.font = '12px system-ui';
      for (const m of this.game.mapMarkers()) {
        const [px, py] = toPx(m.x, m.z);
        ctx.fillStyle = m.kind === 'player' ? '#fff' : m.kind === 'bag' ? '#ff5a3c' : m.kind === 'bed' ? '#8fbf6a' : '#d9b26a';
        if (m.kind === 'player') {
          ctx.save();
          ctx.translate(px, py);
          ctx.rotate(Math.PI - (m.heading ?? 0));
          ctx.beginPath();
          ctx.moveTo(0, -8);
          ctx.lineTo(5, 6);
          ctx.lineTo(-5, 6);
          ctx.fill();
          ctx.restore();
        } else {
          ctx.fillText(m.kind === 'bag' ? '✖' : m.kind === 'bed' ? '⌂' : '◆', px - 4, py + 4);
          if (m.label) ctx.fillText(m.label, px + 6, py + 4);
        }
      }
      if (this.mapRow < size) requestAnimationFrame(draw);
    };
    draw();
  }

  private fillMapRows(rows: number): void {
    const terrain = this.game.terrain;
    if (!terrain || !this.mapCanvas || this.mapRow >= 256) return;
    const ctx = this.mapCanvas.getContext('2d')!;
    const img = ctx.createImageData(256, rows);
    const span = WORLD.worldHalfSize * 2;
    for (let r = 0; r < rows && this.mapRow + r < 256; r++) {
      for (let c = 0; c < 256; c++) {
        const x = -WORLD.worldHalfSize + ((c + 0.5) / 256) * span;
        const z = -WORLD.worldHalfSize + ((this.mapRow + r + 0.5) / 256) * span;
        const hgt = terrain.height(x, z);
        let col: number;
        if (hgt < 0) col = hgt < -10 ? 0x1d3a4a : 0x2f5d6e;
        else col = BIOMES[terrain.biomeAt(x, z, hgt)].ground[1];
        const shade = hgt > 0 ? 0.75 + Math.min(0.35, hgt / 600) : 1;
        const o = (r * 256 + c) * 4;
        img.data[o] = ((col >> 16) & 255) * shade;
        img.data[o + 1] = ((col >> 8) & 255) * shade;
        img.data[o + 2] = (col & 255) * shade;
        img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, this.mapRow);
    this.mapRow += rows;
  }

  // ------------------------------------------------------------------ menus

  private showMenu(card: HTMLElement): void {
    this.menuOpen = true;
    this.menuEl.innerHTML = '';
    this.menuEl.appendChild(card);
    this.menuEl.classList.remove('hidden');
    this.touchEl.classList.add('hidden');
  }

  hideMenu(): void {
    this.menuOpen = false;
    this.menuEl.classList.add('hidden');
    this.setTouchMode(this.game.input.mode === 'touch');
  }

  mainMenu(): void {
    const g = this.game;
    const card = h('div', 'card');
    card.appendChild(h('h1', '', t('game.title')));
    card.appendChild(h('p', 'sub', t('game.subtitle')));
    if (g.hasSave) {
      const c = h('button', 'primary', t('menu.continue'));
      c.onclick = () => g.continueGame();
      card.appendChild(c);
    }
    const seedLabel = h('label', '', t('menu.seed'));
    const seedInput = h('input');
    seedInput.type = 'text';
    seedInput.value = String(Math.floor(Math.random() * 1e6));
    seedLabel.appendChild(seedInput);
    const n = h('button', g.hasSave ? '' : 'primary', t('menu.new'));
    n.onclick = () => {
      if (g.hasSave && !confirm(t('menu.newConfirm'))) return;
      const v = seedInput.value.trim();
      const seed = /^\d+$/.test(v) ? Number(v) : [...v].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7);
      g.newGame(seed);
    };
    card.appendChild(seedLabel);
    card.appendChild(n);
    const s = h('button', '', t('menu.settings'));
    s.onclick = () => this.settingsMenu(() => this.mainMenu());
    card.appendChild(s);
    const k = h('button', '', t('menu.controls'));
    k.onclick = () => this.controlsMenu(() => this.mainMenu());
    card.appendChild(k);
    card.appendChild(this.importButton());
    card.appendChild(h('p', 'muted', t('journal.note')));
    this.showMenu(card);
  }

  private importButton(): HTMLElement {
    const label = h('button', '', t('menu.import'));
    const file = h('input');
    file.type = 'file';
    file.accept = 'application/json,.json';
    file.style.display = 'none';
    file.onchange = () => {
      if (file.files?.[0]) this.game.importSave(file.files[0]);
    };
    label.onclick = () => file.click();
    label.appendChild(file);
    return label;
  }

  pauseMenu(): void {
    const g = this.game;
    const card = h('div', 'card');
    card.appendChild(h('h2', '', t('menu.paused')));
    const items: [string, () => void, string?][] = [
      [t('menu.resume'), () => g.resume(), 'primary'],
      [t('menu.save'), () => g.save()],
      [t('menu.settings'), () => this.settingsMenu(() => this.pauseMenu())],
      [t('menu.controls'), () => this.controlsMenu(() => this.pauseMenu())],
      [t('menu.export'), () => g.exportSave()],
      [t('menu.quit'), () => g.quitToMenu()],
    ];
    for (const [label, fn, cls] of items) {
      const b = h('button', cls ?? '', label);
      b.onclick = fn;
      card.appendChild(b);
    }
    card.appendChild(this.importButton());
    this.showMenu(card);
  }

  settingsMenu(back: () => void): void {
    const g = this.game;
    const s = g.settings;
    const card = h('div', 'card');
    card.appendChild(h('h2', '', t('menu.settings')));
    const select = (label: string, value: string, options: [string, string][], on: (v: string) => void) => {
      const l = h('label', '', label);
      const sel = h('select');
      for (const [v, text] of options) {
        const o = h('option', '', text);
        o.value = v;
        if (v === value) o.selected = true;
        sel.appendChild(o);
      }
      sel.onchange = () => on(sel.value);
      l.appendChild(sel);
      card.appendChild(l);
    };
    const range = (label: string, value: number, on: (v: number) => void) => {
      const l = h('label', '', `${label}: <b>${value.toFixed(2)}</b>`);
      const r = h('input');
      r.type = 'range';
      r.min = '0.2';
      r.max = '3';
      r.step = '0.05';
      r.value = String(value);
      r.oninput = () => {
        on(Number(r.value));
        l.querySelector('b')!.textContent = Number(r.value).toFixed(2);
      };
      l.appendChild(r);
      card.appendChild(l);
    };
    const check = (label: string, value: boolean, on: (v: boolean) => void) => {
      const l = h('label', 'check');
      const c = h('input');
      c.type = 'checkbox';
      c.checked = value;
      c.onchange = () => on(c.checked);
      l.appendChild(c);
      l.appendChild(document.createTextNode(label));
      card.appendChild(l);
    };
    select(t('settings.language'), s.language, [['pt-BR', 'Português (Brasil)'], ['en', 'English']], (v) => {
      g.applySettings({ language: v as Settings['language'] });
      setLanguage(v as Settings['language']);
      this.settingsMenu(back);
    });
    select(t('settings.difficulty'), s.difficulty, (['peaceful', 'normal', 'hard'] as const).map((d) => [d, t(`difficulty.${d}`)]), (v) => g.applySettings({ difficulty: v as Settings['difficulty'] }));
    select(t('settings.quality'), s.quality, (['auto', 'low', 'medium', 'high'] as const).map((q) => [q, t(`quality.${q}`)]), (v) => g.applySettings({ quality: v as Settings['quality'] }));
    range(t('settings.mouse'), s.mouseSensitivity, (v) => g.applySettings({ mouseSensitivity: v }));
    range(t('settings.touch'), s.touchSensitivity, (v) => g.applySettings({ touchSensitivity: v }));
    check(t('settings.invertY'), s.invertY, (v) => g.applySettings({ invertY: v }));
    check(t('settings.firstPerson'), s.firstPerson, (v) => g.applySettings({ firstPerson: v }));
    const reset = h('button', '', '↺');
    reset.onclick = () => {
      g.applySettings({ ...DEFAULT_SETTINGS, language: s.language });
      this.settingsMenu(back);
    };
    card.appendChild(reset);
    const b = h('button', 'primary', t('menu.back'));
    b.onclick = back;
    card.appendChild(b);
    this.showMenu(card);
  }

  controlsMenu(back: () => void): void {
    const g = this.game;
    const card = h('div', 'card');
    card.appendChild(h('h2', '', t('menu.controls')));
    card.appendChild(h('p', 'muted', t('controls.list')));
    card.appendChild(h('p', 'muted', t('controls.rebind')));
    const list = h('div', 'keylist');
    for (const a of Object.keys(g.input.keys) as Action[]) {
      list.appendChild(h('span', '', a));
      const b = h('button', '', this.rebinding === a ? '…' : g.input.keys[a].join(' / ').replace(/Key|Digit/g, ''));
      b.onclick = () => {
        this.rebinding = a;
        b.textContent = '…';
        const handler = (e: KeyboardEvent) => {
          e.preventDefault();
          g.input.rebind(a, e.code);
          this.rebinding = null;
          removeEventListener('keydown', handler, true);
          this.controlsMenu(back);
        };
        addEventListener('keydown', handler, true);
      };
      list.appendChild(b);
    }
    card.appendChild(list);
    const reset = h('button', '', t('controls.reset'));
    reset.onclick = () => {
      g.input.resetKeys();
      this.controlsMenu(back);
    };
    card.appendChild(reset);
    const b = h('button', 'primary', t('menu.back'));
    b.onclick = back;
    card.appendChild(b);
    this.showMenu(card);
  }

  loading(progress: number): void {
    let bar = this.menuEl.querySelector('.loading-bar i') as HTMLElement | null;
    if (!bar) {
      const card = h('div', 'card');
      card.appendChild(h('h1', '', t('game.title')));
      card.appendChild(h('p', 'sub', t('menu.loading')));
      card.appendChild(h('div', 'loading-bar', '<i></i>'));
      this.showMenu(card);
      bar = this.menuEl.querySelector('.loading-bar i') as HTMLElement;
    }
    bar.style.width = `${Math.round(progress * 100)}%`;
  }

  deathScreen(cause: string): void {
    const card = h('div', 'card');
    card.appendChild(h('h2', '', t('death.title')));
    card.appendChild(h('p', 'sub', t('death.cause', { cause })));
    const b = h('button', 'primary', t('death.respawn'));
    b.onclick = () => this.game.respawn();
    card.appendChild(b);
    this.showMenu(card);
  }

  fatal(msg: string): void {
    const card = h('div', 'card');
    card.appendChild(h('h1', '', t('game.title')));
    card.appendChild(h('p', '', msg));
    this.showMenu(card);
  }

  // ------------------------------------------------------------------ touch

  private buildTouch(): void {
    const input = this.game.input;
    const joy = h('div', 'joy', '<i></i>');
    const knob = joy.querySelector('i') as HTMLElement;
    let joyId: number | null = null;
    const joyMove = (e: PointerEvent) => {
      const r = joy.getBoundingClientRect();
      let dx = e.clientX - (r.left + r.width / 2);
      let dy = e.clientY - (r.top + r.height / 2);
      const max = r.width / 2;
      const l = Math.hypot(dx, dy);
      if (l > max) {
        dx = (dx / l) * max;
        dy = (dy / l) * max;
      }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      input.move.x = dx / max;
      input.move.y = -dy / max;
    };
    joy.addEventListener('pointerdown', (e) => {
      joyId = e.pointerId;
      joy.setPointerCapture(e.pointerId);
      input.setMode('touch');
      joyMove(e);
    });
    joy.addEventListener('pointermove', (e) => e.pointerId === joyId && joyMove(e));
    const joyEnd = (e: PointerEvent) => {
      if (e.pointerId !== joyId) return;
      joyId = null;
      knob.style.transform = '';
      input.move.x = input.move.y = 0;
    };
    joy.addEventListener('pointerup', joyEnd);
    joy.addEventListener('pointercancel', joyEnd);

    const look = h('div', 'look-area');
    const lastPos = new Map<number, [number, number]>();
    look.addEventListener('pointerdown', (e) => {
      look.setPointerCapture(e.pointerId);
      lastPos.set(e.pointerId, [e.clientX, e.clientY]);
      input.setMode('touch');
    });
    look.addEventListener('pointermove', (e) => {
      const p = lastPos.get(e.pointerId);
      if (!p) return;
      const s = this.game.settings.touchSensitivity * 1.6;
      input.look.x += (e.clientX - p[0]) * s;
      input.look.y += (e.clientY - p[1]) * s;
      lastPos.set(e.pointerId, [e.clientX, e.clientY]);
    });
    const lookEnd = (e: PointerEvent) => lastPos.delete(e.pointerId);
    look.addEventListener('pointerup', lookEnd);
    look.addEventListener('pointercancel', lookEnd);

    const btns = h('div', 'tbtns');
    const mk = (parent: HTMLElement, label: string, a: Action, cls = '', hold = false) => {
      const b = h('button', `tbtn ${cls}`, label);
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        input.touchPress(a);
        if (hold) input.touchHold(a, true);
        if (a === 'sprint' || a === 'crouch') b.classList.toggle('on');
      });
      const up = () => hold && input.touchHold(a, false);
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      parent.appendChild(b);
    };
    mk(btns, t('touch.crouch'), 'crouch', '', false);
    mk(btns, t('touch.interact'), 'interact');
    mk(btns, t('touch.eat'), 'eat');
    mk(btns, t('touch.sprint'), 'sprint');
    mk(btns, t('touch.jump'), 'jump');
    mk(btns, t('touch.attack'), 'attack', 'big', true);
    const top = h('div', 'ttop');
    mk(top, t('touch.inv'), 'inventory');
    mk(top, t('touch.build'), 'build');
    mk(top, t('touch.cam'), 'camera');
    mk(top, '🗺', 'map');
    mk(top, '❚❚', 'pause');
    this.touchEl.append(look, joy, btns, top);
  }
}
