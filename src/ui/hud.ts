import { DEFAULT_SETTINGS, WORLD, type Settings } from '../core/config';
import type { Game } from '../core/game';
import { SPECIES, SPECIES_IDS } from '../animals/species';
import { PIECES, type PieceType } from '../building/building';
import { RECIPES } from '../crafting/recipes';
import { CELL, GRID_N } from '../exploration/exploration';
import type { Action } from '../input/input';
import type { Stack } from '../inventory/inventory';
import { ITEMS, type EquipSlot } from '../inventory/items';
import { modelCredits } from '../graphics/externalModels';
import { language, setLanguage, t } from '../localization/i18n';
import { DOCS } from '../mysteries/mysteries';
import { SKILLS } from '../progression/skills';
import type { SurvivalData } from '../survival/survival';
import { TAME_PROFILES } from '../taming/profiles';
import { obeyChance } from '../taming/taming';
import { BIOMES, type BiomeId } from '../world/biomes';
import type { WeatherKind } from '../world/environment';

/** The UI talks to the game through its public methods. */
export type GameApi = Game;

export interface MapMarker {
  x: number;
  z: number;
  kind: 'player' | 'site' | 'bag' | 'bed' | 'marker' | 'tame' | 'landmark';
  label?: string;
  heading?: number;
}

const ICON: Partial<Record<string, string>> = {
  wood: '🪵', stone: '🪨', fiber: '🌾', flint: '🔷', clay: '🟫', hide: '🟤', bone: '🦴', obsidian: '⬛', sulfur: '🟡', metal_ore: '⛏', metal_scrap: '⚙',
  ice: '🧊', herb: '🌿', cycad_fronds: '🌴', fern_fronds: '🌱', berries: '🫐', raw_meat: '🥩', cooked_meat: '🍖', raw_fish: '🐟', egg: '🥚',
  waterskin: '👝', waterskin_full: '💧', stone_axe: '🪓', stone_pickaxe: '⛏', stone_knife: '🔪', spear: '🗡', obsidian_spear: '🗡', bow: '🏹', arrow: '➶',
  torch: '🔥', bandage: '🩹', herbal_poultice: '🌿', hide_hood: '🧢', hide_tunic: '🧥', hide_leggings: '👖', fur_coat: '🧥', backpack: '🎒',
  trap_snare: '🪢', field_journal: '📔', research_scanner: '📡', rope: '🧶', metal_ingot: '🧱', crystal: '💎', fossil: '🦴', dino_egg: '🥚',
  feed_mix: '🥗', metal_axe: '🪓', metal_pickaxe: '⛏', metal_knife: '🔪', metal_spear: '🔱', splint: '🦯', antidote: '🧪', spyglass: '🔭',
  compass: '🧭', radio_receiver: '📻', battery: '🔋', flare: '🧨', keycard: '💳', calibration_core: '🔶',
};

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

/** Escapes text for safe insertion into innerHTML (names typed by the player, loaded saves). */
export const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const itemName = (id: string) => t(`item.${id}`);
const stackName = (s: Stack) => (s.sp ? `${itemName(s.id)} (${SPECIES[s.sp]?.name[language()] ?? '?'})` : itemName(s.id));

export type PanelTab = 'inventory' | 'crafting' | 'skills' | 'animals' | 'journal' | 'map' | 'storage';

export class Hud {
  readonly root: HTMLElement;
  private bars: Record<string, HTMLElement> = {};
  private statusEl: HTMLElement;
  private topEl: HTMLElement;
  private perfEl: HTMLElement;
  private radioEl: HTMLElement;
  private notesEl: HTMLElement;
  private promptEl: HTMLElement;
  private hotbarEl: HTMLElement;
  private xpEl: HTMLElement;
  private captionsEl: HTMLElement;
  private buildEl: HTMLElement;
  private panelEl: HTMLElement;
  private docEl: HTMLElement;
  private menuEl: HTMLElement;
  private touchEl: HTMLElement;
  private flashEl: HTMLElement;
  private crosshair: HTMLElement;
  tab: PanelTab = 'inventory';
  private picked: number | null = null;
  private filter = 'all';
  private journalTab: 'species' | 'docs' | 'discoveries' = 'species';
  private settingsTab: 'general' | 'graphics' | 'audio' | 'access' = 'general';
  private mapCanvas: HTMLCanvasElement | null = null;
  private mapSeed = -1;
  private mapRow = 0;
  private mapZoom = 1;
  private lastHotbarKey = '';
  private lastPanelKey = '';
  panelOpen = false;
  menuOpen = false;
  documentOpen = false;
  private rebinding: Action | null = null;
  private offlineText = '';

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
      const row = h('div', 'bar', `<span title="${t(`stat.${k}`)}" aria-label="${t(`stat.${k}`)}">${icon}</span><div class="track" role="progressbar" aria-label="${t(`stat.${k}`)}"><div class="fill" style="background:${color}"></div></div>`);
      bars.appendChild(row);
      this.bars[k] = row;
    }
    this.statusEl = bars.appendChild(h('div', 'status'));
    this.topEl = this.add(h('div', 'top'));
    this.perfEl = this.add(h('div', 'perf hidden'));
    this.radioEl = this.add(h('div', 'radio hidden'));
    this.notesEl = this.add(h('div', 'notes'));
    this.notesEl.setAttribute('aria-live', 'polite');
    this.promptEl = this.add(h('div', 'prompt hidden'));
    this.xpEl = this.add(h('div', 'xp-toast hidden'));
    this.captionsEl = this.add(h('div', 'captions'));
    this.hotbarEl = this.add(h('div', 'hotbar'));
    this.buildEl = this.add(h('div', 'buildbar interactive hidden'));
    this.touchEl = this.add(h('div', 'touch hidden'));
    this.panelEl = this.add(h('div', 'panel hidden'));
    this.docEl = this.add(h('div', 'doc hidden'));
    this.menuEl = this.add(h('div', 'menu hidden'));
    this.buildTouch();
    this.setTouchMode(game.input.mode === 'touch');
  }

  private add<T extends HTMLElement>(e: T): T {
    this.root.appendChild(e);
    return e;
  }

  applyAccessibility(s: Settings): void {
    document.documentElement.style.setProperty('--ui-scale', String(s.uiScale));
    document.body.classList.toggle('high-contrast', s.highContrast);
    document.body.classList.toggle('reduce-motion', s.reduceMotion);
  }

  setOfflineStatus(text: string): void {
    this.offlineText = text;
    const el = this.menuEl.querySelector('.offline-status');
    if (el) el.textContent = text;
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
      this.radioEl.classList.add('hidden');
    }
    this.touchEl.classList.toggle('hidden', !on || this.game.input.mode !== 'touch');
  }

  // ------------------------------------------------------------------ HUD

  updateStats(d: SurvivalData, felt: number, overweight: boolean): void {
    const set = (k: string, v: number) => {
      const el = this.bars[k];
      (el.querySelector('.fill') as HTMLElement).style.width = `${Math.max(0, Math.min(100, v))}%`;
      el.querySelector('.track')!.setAttribute('aria-valuenow', String(Math.round(v)));
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

  updateTop(day: number, frac: number, weather: WeatherKind, biome: BiomeId | 'cave', yaw: number, dirMode: 'exact' | 'sun' | 'none', forecast: { next: WeatherKind; inSeconds: number } | null): void {
    const hours = Math.floor(frac * 24);
    const mins = Math.floor((frac * 24 - hours) * 60);
    const dirs = t('dir.compass').split(',');
    // yaw 0 faces +z (south); north is -z.
    const deg = (((180 - (yaw * 180) / Math.PI) % 360) + 360) % 360;
    let dir = '?';
    if (dirMode === 'exact') dir = dirs[Math.round(deg / 45) % 8];
    else if (dirMode === 'sun') dir = `☀ ~${dirs[(Math.round(deg / 90) * 2) % 8]}`;
    const icon: Record<WeatherKind, string> = { clear: '☀', cloudy: '☁', rain: '🌧', storm: '⛈', fog: '🌫' };
    const fc = forecast ? ` <span class="muted">→ ${icon[forecast.next]} ${Math.ceil(forecast.inSeconds / 60)}min</span>` : '';
    const place = biome === 'cave' ? t('cave.name') : t(`biome.${biome}`);
    const html = `<span class="compass">${dir}</span><span>${t('hud.day', { d: day + 1 })} · ${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}</span><span>${icon[weather]}${fc}</span><span class="muted">${place}</span>`;
    if (this.topEl.innerHTML !== html) this.topEl.innerHTML = html;
  }

  radio(r: { strength: number; bearing: number } | null): void {
    this.radioEl.classList.toggle('hidden', !r);
    if (!r) return;
    const bars = Math.round(r.strength * 5);
    const arrow = ['↑', '↖', '←', '↙', '↓', '↘', '→', '↗'][((Math.round(r.bearing / (Math.PI / 4)) % 8) + 8) % 8];
    this.radioEl.textContent = r.strength > 0.06 ? `📻 ${'▮'.repeat(bars)}${'▯'.repeat(5 - bars)} ${arrow}` : `📻 ${t('radio.silent')}`;
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

  caption(text: string): void {
    const c = h('div', 'caption');
    c.textContent = text;
    this.captionsEl.prepend(c);
    while (this.captionsEl.children.length > 3) this.captionsEl.lastElementChild!.remove();
    setTimeout(() => c.remove(), 3500);
  }

  xpToast(text: string): void {
    this.xpEl.textContent = text;
    this.xpEl.classList.remove('hidden');
    clearTimeout((this.xpEl as unknown as { _t?: number })._t);
    (this.xpEl as unknown as { _t?: number })._t = window.setTimeout(() => this.xpEl.classList.add('hidden'), 1800);
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
      el.setAttribute('role', 'button');
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
      el.title = stackName(s);
      el.appendChild(h('span', 'lbl', `<span class="ico">${ICON[s.id] ?? '◆'}</span>${esc(itemName(s.id))}`));
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
    const key = `${g.buildPiece}|${g.buildSnap}|${validReason}|${touch}|${language()}|${JSON.stringify(g.inventory.data.slots.map((s) => s && s.qty))}|${g.crafting.unlocked.size}`;
    if (this.buildEl.dataset.key === key) return;
    this.buildEl.dataset.key = key;
    this.buildEl.innerHTML = '';
    const pieces = h('div', 'pieces');
    for (const p of Object.keys(PIECES) as PieceType[]) {
      const available = g.pieceAvailable(p);
      const cost = g.pieceCost(p);
      const ok = available && g.inventory.has(cost);
      const costText = available ? Object.entries(cost).map(([k, q]) => `${q} ${itemName(k)}`).join(', ') : `🔒 ${t(`unlock.${PIECES[p].unlock}`)}`;
      const b = h('button', p === g.buildPiece ? 'active' : '', `${t(`piece.${p}`)}<br><span class="muted" style="color:${ok ? 'var(--muted)' : 'var(--bad)'}">${costText}</span>`);
      b.disabled = !available;
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
      mk(t('menu.back'), 'build');
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
    this.lastPanelKey = '';
  }

  /** `soft` re-renders only if the visible data changed (called periodically). */
  renderPanel(soft = false): void {
    if (!this.panelOpen) return;
    const g = this.game;
    if (soft) {
      const key = this.tab === 'animals' ? JSON.stringify(g.tamedAnimals().map((a) => [a.id, Math.round(a.hunger * 20), Math.round(a.thirst * 20), a.tame?.command, Math.round((a.tame?.obedience ?? 0) * 50), a.state])) : JSON.stringify([g.crafting.queue.map((j) => Math.ceil(j.remaining)), g.inventory.data.slots.map((s) => s && [s.id, s.qty])]);
      if (key === this.lastPanelKey) return;
      this.lastPanelKey = key;
    }
    const scrollY = this.panelEl.querySelector('.panel-body')?.scrollTop ?? 0;
    const p = this.panelEl;
    p.innerHTML = '';
    const tabs = h('div', 'tabs');
    tabs.setAttribute('role', 'tablist');
    const tabList: PanelTab[] = ['inventory', 'crafting', 'skills', 'animals', 'journal', 'map'];
    if (g.openStorageItems()) tabList.push('storage');
    const labels: Record<PanelTab, string> = { inventory: t('inv.title'), crafting: t('inv.crafting'), skills: t('ui.skills'), animals: t('ui.animals'), journal: t('inv.journal'), map: t('ui.map'), storage: t('piece.storage') };
    for (const tb of tabList) {
      const b = h('button', tb === this.tab ? 'active' : '', labels[tb]);
      b.setAttribute('role', 'tab');
      b.onclick = () => {
        this.tab = tb;
        this.renderPanel();
      };
      tabs.appendChild(b);
    }
    const close = h('button', 'close', '✕');
    close.setAttribute('aria-label', t('menu.resume'));
    close.onclick = () => g.resume();
    tabs.appendChild(close);
    p.appendChild(tabs);
    const body = h('div', 'panel-body');
    p.appendChild(body);
    if (this.tab === 'inventory') this.renderInventory(body);
    else if (this.tab === 'crafting') this.renderCrafting(body);
    else if (this.tab === 'skills') this.renderSkills(body);
    else if (this.tab === 'animals') this.renderAnimals(body);
    else if (this.tab === 'journal') this.renderJournal(body);
    else if (this.tab === 'map') this.renderMap(body);
    else this.renderStorage(body);
    if (soft) body.scrollTop = scrollY;
  }

  private renderInventory(body: HTMLElement): void {
    const g = this.game;
    const inv = g.inventory;
    const layout = h('div', 'inv-layout');
    const left = h('div');
    const filters = h('div', 'filters');
    for (const f of ['all', 'resource', 'food', 'tool', 'weapon', 'clothing', 'medical', 'special']) {
      const b = h('button', f === this.filter ? 'active' : '', f === 'all' ? t('inv.filter.all') : ({ resource: '🪵', food: '🍖', tool: '🪓', weapon: '🗡', clothing: '🧥', medical: '🩹', special: '✦' } as Record<string, string>)[f]);
      b.title = t(`inv.cat.${f}`);
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
    left.appendChild(h('p', 'muted', t('inv.weight', { w: inv.weight().toFixed(1), c: inv.capacity().toFixed(0) }) + (inv.extraCapacity ? ` (${t('inv.pack', { n: inv.extraCapacity })})` : '')));
    layout.appendChild(left);

    const side = h('div', 'side');
    const sel = this.picked !== null ? inv.data.slots[this.picked] : null;
    const box = h('div', 'box');
    if (sel && this.picked !== null) {
      const i = this.picked;
      const def = ITEMS[sel.id];
      box.appendChild(h('h4', '', `${ICON[sel.id] ?? ''} ${esc(stackName(sel))} ×${sel.qty}`));
      box.appendChild(h('div', 'muted', `${def.weight} kg${def.damage ? ` · ⚔ ${def.damage}` : ''}${def.insulation ? ` · 🌡 +${def.insulation}°` : ''}${def.capacity ? ` · +${def.capacity} kg` : ''}`));
      const desc = t(`desc.${sel.id}`);
      if (desc !== `desc.${sel.id}`) box.appendChild(h('p', 'muted', esc(desc)));
      const row = h('div', 'row');
      const btn = (label: string, fn: () => void) => {
        const b = h('button', '', label);
        b.onclick = () => {
          fn();
          this.renderPanel();
        };
        row.appendChild(b);
      };
      if (def.food || def.heal || ['waterskin_full', 'flare', 'spyglass'].includes(sel.id)) btn(t('inv.use'), () => g.useSlot(i));
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
    } else box.appendChild(h('div', 'muted', t('inv.pickHint')));
    side.appendChild(box);
    const eq = h('div', 'box', `<h4>${t('inv.equipment')}</h4>`);
    for (const slot of ['head', 'body', 'legs', 'back'] as EquipSlot[]) {
      const s = inv.data.equipment[slot];
      const row = h('div', 'row');
      row.appendChild(h('span', 'muted', `${t(`equip.${slot}`)}: ${s ? itemName(s.id) : t('inv.empty')}`));
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
    body.appendChild(h('p', 'muted', t('craft.stationsHere', { list: [...stations].map((s) => t(`station.${s}`)).join(', ') })));
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
        .map(([k, q]) => {
          const have = g.inventory.count(k);
          return `<span class="${have >= q ? 'have' : 'lack'}">${q} ${itemName(k)} (${have})</span>`;
        })
        .join(' · ');
      const tool = r.tool ? `<br><span class="${r.tool.some((x) => g.inventory.count(x) > 0) ? 'have' : 'lack'}">${t('craft.tool', { what: r.tool.map(itemName).join(' / ') })}</span>` : '';
      const kind = r.station === 'hand' ? t('craft.simple') : t('craft.needs', { station: t(`station.${r.station}`) });
      const note = err === 'locked' ? `🔒 ${t(`unlock.${r.unlock}`)}` : `${kind} · ${Math.ceil(r.time * g.crafting.timeMultiplier)}s`;
      row.appendChild(h('div', '', `<b>${ICON[r.output] ?? ''} ${itemName(r.output)}${r.qty > 1 ? ` ×${r.qty}` : ''}</b><br><span class="muted">${err === 'locked' ? '???' : inputs}</span>${err === 'locked' ? '' : tool}<br><span class="muted">${note}</span>`));
      const b = h('button', err ? '' : 'primary', t('craft.make'));
      b.disabled = !!err;
      if (err) b.title = t(`craft.err.${err}`);
      b.onclick = () => {
        g.craft(r.id);
        this.renderPanel();
      };
      row.appendChild(b);
      body.appendChild(row);
    }
  }

  private renderSkills(body: HTMLElement): void {
    const g = this.game;
    const trees = g.skillTrees();
    body.appendChild(h('p', 'muted', t('skill.intro', { n: g.progression.totalLevel(), d: g.progression.d.daysSurvived })));
    const grid = h('div', 'skill-grid');
    for (const tr of trees) {
      const card = h('div', 'box');
      const pct = tr.next ? Math.min(100, (tr.xp / tr.next) * 100) : 100;
      card.appendChild(h('h4', '', `${t(`tree.${tr.tree}`)} — ${t('skill.level', { n: tr.level })}${tr.points > 0 ? ` · <span class="good">${t('skill.points', { n: tr.points })}</span>` : ''}`));
      card.appendChild(h('div', 'xpbar', `<i style="width:${pct}%"></i>`));
      card.appendChild(h('div', 'muted', tr.next ? `${Math.floor(tr.xp)} / ${tr.next} XP` : t('skill.max')));
      card.appendChild(h('div', 'muted small', t(`tree.${tr.tree}.how`)));
      for (const s of SKILLS.filter((x) => x.tree === tr.tree)) {
        const learned = g.progression.has(s.id);
        const row = h('div', 'skill');
        row.appendChild(h('div', '', `<b>${learned ? '✓ ' : ''}${t(`skill.${s.id}.name`)}</b> <span class="muted">(${t('skill.req', { n: s.level })})</span><br><span class="muted">${t(`skill.${s.id}.desc`)}</span>`));
        if (!learned) {
          const b = h('button', g.progression.canLearn(s.id) ? 'primary' : '', t('skill.learn'));
          b.disabled = !g.progression.canLearn(s.id);
          b.onclick = () => {
            g.learnSkill(s.id);
            this.renderPanel();
          };
          row.appendChild(b);
        }
        card.appendChild(row);
      }
      grid.appendChild(card);
    }
    body.appendChild(grid);
  }

  private renderAnimals(body: HTMLElement): void {
    const g = this.game;
    const list = g.tamedAnimals();
    body.appendChild(h('p', 'muted', t('tame.intro')));
    if (!list.length) {
      body.appendChild(h('p', '', t('tame.none')));
      return;
    }
    const p = g.player!;
    for (const a of list.sort((x, y) => (x.id === g.focusAnimal ? -1 : y.id === g.focusAnimal ? 1 : 0))) {
      const tm = a.tame!;
      const sp = SPECIES[a.speciesId];
      const card = h('div', `box animal${a.id === g.focusAnimal ? ' focus' : ''}`);
      const dist = Math.round(Math.hypot(a.x - p.s.x, a.z - p.s.z));
      const pct = (v: number) => `${Math.round(v * 100)}%`;
      const uses = TAME_PROFILES[a.speciesId].uses.map((u) => t(`tame.use.${u}`)).join(', ');
      card.appendChild(
        h(
          'div',
          '',
          `<h4>${esc(tm.name)} <span class="muted">${sp.name[language()]}${g.isJuvenile(a) ? ` ${t('ui.juvenile')}` : ''} · ${a.sex === 'f' ? '♀' : '♂'} · ${dist} m</span></h4>
          <div class="muted">${t('tame.status', { state: t(`ai.${a.state}`), cmd: t(`tame.cmd.${tm.command}`) })}</div>
          <div class="stats">${t('tame.needs', { hunger: pct(a.hunger), thirst: pct(a.thirst), hp: pct(a.health / sp.health) })}<br>${t('tame.training', { bond: pct(tm.bond), obedience: pct(tm.obedience), obey: pct(obeyChance(a)) })}<br>${t('tame.uses', { list: uses || '—' })}</div>`,
        ),
      );
      const row = h('div', 'row');
      for (const cmd of ['follow', 'stay', 'roam', 'guard'] as const) {
        const b = h('button', tm.command === cmd ? 'active' : '', t(`tame.cmd.${cmd}`));
        b.onclick = () => {
          g.animalCommand(a.id, cmd);
          this.renderPanel();
        };
        row.appendChild(b);
      }
      card.appendChild(row);
      const row2 = h('div', 'row');
      const act = (label: string, action: 'mount' | 'feed' | 'rename' | 'release', confirmText?: string) => {
        const b = h('button', '', label);
        b.onclick = () => {
          if (confirmText && !confirm(confirmText)) return;
          let arg: string | undefined;
          if (action === 'rename') arg = prompt(t('tame.renamePrompt'), tm.name) ?? undefined;
          g.animalAction(a.id, action, arg);
          this.renderPanel();
        };
        row2.appendChild(b);
      };
      if (TAME_PROFILES[a.speciesId].uses.includes('mount')) act(t('tame.mount'), 'mount');
      act(t('tame.feed'), 'feed');
      act(t('tame.rename'), 'rename');
      act(t('tame.release'), 'release', t('tame.releaseConfirm', { name: tm.name }));
      card.appendChild(row2);
      body.appendChild(card);
    }
  }

  private renderJournal(body: HTMLElement): void {
    const g = this.game;
    const sub = h('div', 'filters');
    for (const k of ['species', 'docs', 'discoveries'] as const) {
      const b = h('button', this.journalTab === k ? 'active' : '', t(`journal.tab.${k}`));
      b.onclick = () => {
        this.journalTab = k;
        this.renderPanel();
      };
      sub.appendChild(b);
    }
    body.appendChild(sub);
    if (this.journalTab === 'species') {
      const fossils = new Set(g.exploration.d.fossilSpecies);
      body.appendChild(h('p', 'muted', `${t('journal.seen', { n: g.seenSpecies.size, t: SPECIES_IDS.length })} · ${t('journal.fossils', { n: fossils.size })}<br>${t('journal.note')}`));
      for (const id of SPECIES_IDS) {
        const sp = SPECIES[id];
        const seen = g.seenSpecies.has(id);
        const known = seen || fossils.has(id);
        const lang = language();
        const e = h('div', 'journal-entry');
        if (known) {
          const prof = TAME_PROFILES[id];
          e.innerHTML = `<b>${sp.name[lang]}</b> <i class="muted">${sp.scientificName}</i>${seen ? '' : ` <span class="muted">(${t('journal.fromFossil')})</span>`}<br><span class="muted">${t('journal.period', { p: sp.period })} · ${t('journal.diet', { d: t(`diet.${sp.diet}`) })} · ${t('journal.size', { l: sp.lengthM, m: sp.massKg >= 1000 ? `${(sp.massKg / 1000).toFixed(1)} t` : `${sp.massKg} kg` })}</span>${seen ? `<br><span class="muted">${t('journal.behaviour', { social: t(`social.${sp.social.type}`), act: t(`activity.${sp.activity}`), threat: t(`threat.${sp.threat.response}`) })} · ${t(`tame.method.${prof.method}`)}</span>` : ''}`;
        } else e.innerHTML = `<b>???</b> <span class="muted">${t('journal.unknown')}</span>`;
        body.appendChild(e);
      }
    } else if (this.journalTab === 'docs') {
      const m = g.mysteries;
      body.appendChild(h('p', 'muted', t('mystery.summary', { logs: m.logsRead(), paintings: m.paintingsSeen() })));
      const read = DOCS.filter((d) => m.d.read.includes(d.id));
      if (!read.length) body.appendChild(h('p', '', t('mystery.noDocs')));
      for (const d of read) {
        const b = h('button', 'doc-link', `${d.kind === 'painting' ? '🎨' : d.kind === 'radio' ? '📻' : d.kind === 'terminal' ? '💾' : '📄'} ${t(`lore.${d.id}.title`)}`);
        b.onclick = () => this.showDocument(t(`lore.${d.id}.title`), t(`lore.${d.id}.body`));
        body.appendChild(b);
      }
      if (m.d.ending) body.appendChild(h('p', 'good', t(`mystery.ending.${m.d.ending}`)));
    } else {
      const ex = g.exploration;
      const box = h('div', 'box');
      box.appendChild(h('h4', '', t('explore.records')));
      box.appendChild(h('div', '', t('explore.summary', { pct: (ex.exploredFraction() * 100).toFixed(1), sites: g.discovered.size, fossils: ex.d.fossilsFound.length, days: g.progression.d.daysSurvived })));
      const totals: Partial<Record<BiomeId, number>> = ex.d.biomeCells;
      const rows = (Object.keys(BIOMES) as BiomeId[]).filter((b) => b !== 'ocean').map((b) => `<div class="row"><span>${t(`biome.${b}`)}</span><span class="muted">${totals[b] ?? 0} ${t('explore.cells')}</span></div>`);
      box.appendChild(h('div', '', rows.join('')));
      body.appendChild(box);
      const sites = h('div', 'box', `<h4>${t('explore.sites')}</h4>`);
      for (const id of g.discovered) sites.appendChild(h('div', '', `◆ ${t(`site.${id}`)}`));
      body.appendChild(sites);
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

  // ------------------------------------------------------------------ map

  private renderMap(body: HTMLElement): void {
    const g = this.game;
    const wrap = h('div', 'map-wrap');
    const size = 256;
    if (!this.mapCanvas || this.mapSeed !== g.seed) {
      this.mapCanvas = document.createElement('canvas');
      this.mapCanvas.width = this.mapCanvas.height = size;
      this.mapRow = 0;
      this.mapSeed = g.seed;
    }
    const tools = h('div', 'filters');
    for (const z of [1, 4]) {
      const b = h('button', this.mapZoom === z ? 'active' : '', z === 1 ? t('map.continent') : t('map.local'));
      b.onclick = () => {
        this.mapZoom = z;
        this.renderPanel();
      };
      tools.appendChild(b);
    }
    body.appendChild(tools);
    const view = document.createElement('canvas');
    view.width = view.height = 512;
    view.setAttribute('aria-label', t('ui.map'));
    wrap.appendChild(view);
    body.appendChild(wrap);
    body.appendChild(h('p', 'muted', t('map.legend')));
    const half = WORLD.worldHalfSize;
    const p = g.player!;
    const span = (half * 2) / this.mapZoom;
    const ox = this.mapZoom === 1 ? -half : Math.max(-half, Math.min(half - span, p.s.x - span / 2));
    const oz = this.mapZoom === 1 ? -half : Math.max(-half, Math.min(half - span, p.s.z - span / 2));
    const toPx = (x: number, z: number) => [((x - ox) / span) * 512, ((z - oz) / span) * 512];
    view.onclick = (e) => {
      const r = view.getBoundingClientRect();
      const x = ox + ((e.clientX - r.left) / r.width) * span;
      const z = oz + ((e.clientY - r.top) / r.height) * span;
      g.mapClick(x, z);
      draw(true);
    };
    const draw = (once = false) => {
      if (!this.panelOpen || this.tab !== 'map') return;
      const t0 = performance.now();
      while (this.mapRow < 256 && performance.now() - t0 < 12) this.fillMapRows(2);
      const ctx = view.getContext('2d')!;
      ctx.imageSmoothingEnabled = false;
      const sx = ((ox + half) / (half * 2)) * size;
      const sz = ((oz + half) / (half * 2)) * size;
      ctx.drawImage(this.mapCanvas!, sx, sz, size / this.mapZoom, size / this.mapZoom, 0, 0, 512, 512);
      // Fog of war: unexplored cells stay dark.
      const grid = g.exploration.grid;
      ctx.fillStyle = 'rgba(14,12,10,0.94)';
      const cellPx = (CELL / span) * 512;
      for (let cz = 0; cz < GRID_N; cz++)
        for (let cx = 0; cx < GRID_N; cx++) {
          if (grid[cz * GRID_N + cx]) continue;
          const [px, pz] = toPx(-half + cx * CELL, -half + cz * CELL);
          if (px > 512 || pz > 512 || px + cellPx < 0 || pz + cellPx < 0) continue;
          ctx.fillRect(px, pz, cellPx + 0.6, cellPx + 0.6);
        }
      // Trail.
      ctx.strokeStyle = 'rgba(255,240,200,0.45)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      g.exploration.d.trail.forEach(([x, z], i) => {
        const [px, pz] = toPx(x, z);
        if (i === 0) ctx.moveTo(px, pz);
        else ctx.lineTo(px, pz);
      });
      ctx.stroke();
      ctx.font = '12px system-ui';
      for (const m of g.mapMarkers()) {
        if (m.kind === 'landmark' && !g.exploration.isExplored(m.x, m.z) && Math.hypot(m.x - p.s.x, m.z - p.s.z) > 2500) continue;
        const [px, py] = toPx(m.x, m.z);
        if (px < -10 || py < -10 || px > 522 || py > 522) continue;
        const colors: Record<MapMarker['kind'], string> = { player: '#fff', bag: '#ff5a3c', bed: '#8fbf6a', site: '#d9b26a', marker: '#7ac4ff', tame: '#c49aff', landmark: '#ff8a4a' };
        ctx.fillStyle = colors[m.kind];
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
          const glyph = { bag: '✖', bed: '⌂', site: '◆', marker: m.label === 'star' ? '★' : '●', tame: '🦕', landmark: '▲' }[m.kind];
          ctx.fillText(glyph, px - 4, py + 4);
          if (m.label && (m.kind === 'site' || m.kind === 'landmark' || (m.kind === 'tame' && this.mapZoom > 1))) ctx.fillText(m.label, px + 7, py + 4);
        }
      }
      if (!once && this.mapRow < 256) requestAnimationFrame(() => draw());
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

  // ------------------------------------------------------------------ documents & ending

  showDocument(title: string, body: string): void {
    this.documentOpen = true;
    this.docEl.innerHTML = '';
    const card = h('div', 'doc-card interactive');
    card.setAttribute('role', 'dialog');
    card.appendChild(h('h3', '', esc(title)));
    card.appendChild(h('p', '', esc(body)));
    const b = h('button', 'primary', t('ui.close'));
    b.onclick = () => this.closeDocument();
    card.appendChild(b);
    this.docEl.appendChild(card);
    this.docEl.classList.remove('hidden');
    this.game.input.uiCapture = true;
    document.exitPointerLock?.();
  }

  closeDocument(): void {
    if (!this.documentOpen) return;
    this.documentOpen = false;
    this.docEl.classList.add('hidden');
    this.game.input.uiCapture = this.panelOpen;
  }

  endingScreen(onCross: () => void, onStay: () => void): void {
    const card = h('div', 'card');
    card.appendChild(h('h2', '', t('ending.title')));
    card.appendChild(h('p', '', t('ending.body')));
    const a = h('button', 'primary', t('ending.cross'));
    a.onclick = onCross;
    const b = h('button', '', t('ending.stay'));
    b.onclick = onStay;
    card.append(a, b);
    this.setGameplayVisible(false);
    this.showMenu(card);
  }

  endingText(text: string, onDone: () => void): void {
    const card = h('div', 'card');
    card.appendChild(h('p', '', text));
    const b = h('button', 'primary', t('ui.continue'));
    b.onclick = onDone;
    card.appendChild(b);
    this.showMenu(card);
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
    seedInput.maxLength = 24;
    seedInput.value = String(Math.floor(Math.random() * 1e6));
    seedLabel.appendChild(seedInput);
    const n = h('button', g.hasSave ? '' : 'primary', t('menu.new'));
    n.onclick = () => {
      if (g.hasSave && !confirm(t('menu.newConfirm'))) return;
      const v = seedInput.value.trim();
      const seed = /^\d+$/.test(v) ? Number(v) % 2 ** 31 : [...v].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7);
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
    const cr = h('button', '', t('menu.credits'));
    cr.onclick = () => this.creditsMenu(() => this.mainMenu());
    card.appendChild(cr);
    card.appendChild(this.importButton());
    if (g.hasSave) {
      const r = h('button', '', t('save.restoreBackup'));
      r.onclick = () => g.restoreBackup();
      card.appendChild(r);
      const d = h('button', 'danger', t('save.delete'));
      d.onclick = () => {
        if (confirm(t('save.deleteConfirm'))) void g.deleteSave();
      };
      card.appendChild(d);
    }
    card.appendChild(h('p', 'muted offline-status', this.offlineText));
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
    const card = h('div', 'card wide');
    card.appendChild(h('h2', '', t('menu.settings')));
    const tabs = h('div', 'filters');
    for (const k of ['general', 'graphics', 'audio', 'access'] as const) {
      const b = h('button', this.settingsTab === k ? 'active' : '', t(`settings.tab.${k}`));
      b.onclick = () => {
        this.settingsTab = k;
        this.settingsMenu(back);
      };
      tabs.appendChild(b);
    }
    card.appendChild(tabs);
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
    const range = (label: string, value: number, min: number, max: number, step: number, on: (v: number) => void, fmt = (v: number) => v.toFixed(2)) => {
      const l = h('label', '', `${label}: <b>${fmt(value)}</b>`);
      const r = h('input');
      r.type = 'range';
      r.min = String(min);
      r.max = String(max);
      r.step = String(step);
      r.value = String(value);
      r.oninput = () => l.querySelector('b')!.textContent = fmt(Number(r.value));
      r.onchange = () => on(Number(r.value));
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
    if (this.settingsTab === 'general') {
      select(t('settings.language'), s.language, [['pt-BR', 'Português (Brasil)'], ['en', 'English']], (v) => {
        g.applySettings({ language: v as Settings['language'] });
        setLanguage(v as Settings['language']);
        this.lastHotbarKey = '';
        this.settingsMenu(back);
      });
      select(t('settings.difficulty'), s.difficulty, (['peaceful', 'normal', 'hard'] as const).map((d) => [d, t(`difficulty.${d}`)]), (v) => g.applySettings({ difficulty: v as Settings['difficulty'] }));
      range(t('settings.mouse'), s.mouseSensitivity, 0.2, 3, 0.05, (v) => g.applySettings({ mouseSensitivity: v }));
      range(t('settings.touch'), s.touchSensitivity, 0.2, 3, 0.05, (v) => g.applySettings({ touchSensitivity: v }));
      check(t('settings.invertY'), s.invertY, (v) => g.applySettings({ invertY: v }));
      check(t('settings.firstPerson'), s.firstPerson, (v) => g.applySettings({ firstPerson: v }));
    } else if (this.settingsTab === 'graphics') {
      select(t('settings.quality'), s.quality, (['auto', 'low', 'medium', 'high', 'ultra'] as const).map((q) => [q, t(`quality.${q}`)]), (v) => {
        g.applySettings({ quality: v as Settings['quality'] });
        this.settingsMenu(back);
      });
      const q = g.quality();
      card.appendChild(h('p', 'muted', t('settings.gfxNote', { q: t(`quality.${g.qualityLevel}`) })));
      const set = (patch: Partial<Settings['graphics']>) => g.applySettings({ graphics: { ...s.graphics, ...patch } });
      range(t('gfx.resolution'), q.resolutionScale, 0.4, 1, 0.05, (v) => set({ resolutionScale: v }), (v) => `${Math.round(v * 100)}%`);
      check(t('gfx.shadows'), q.shadows, (v) => set({ shadows: v }));
      range(t('gfx.viewDistance'), q.loadRadius, 2, 7, 1, (v) => set({ viewDistance: v }), (v) => `${Math.round(v * 128)} m`);
      range(t('gfx.vegetation'), q.vegetationDensity, 0.1, 1.5, 0.05, (v) => set({ vegetationDensity: v }), (v) => `${Math.round(v * 100)}%`);
      select(t('gfx.textures'), q.textures, [['low', t('quality.low')], ['high', t('quality.high')]], (v) => set({ textures: v as 'low' | 'high' }));
      range(t('gfx.particles'), q.particles, 0, 1, 0.05, (v) => set({ particles: v }), (v) => `${Math.round(v * 100)}%`);
      check(t('gfx.effects'), q.effects, (v) => set({ effects: v }));
      range(t('gfx.groundCover'), q.groundCover, 0, 1.5, 0.05, (v) => set({ groundCover: v }), (v) => (v < 0.01 ? t('gfx.off') : `${Math.round(v * 100)}%`));
      check(t('gfx.ao'), q.postFx, (v) => set({ ambientOcclusion: v }));
      const reset = h('button', '', t('gfx.reset'));
      reset.onclick = () => {
        g.applySettings({ graphics: {} });
        this.settingsMenu(back);
      };
      card.appendChild(reset);
    } else if (this.settingsTab === 'audio') {
      const vol = s.volume;
      const setV = (k: keyof Settings['volume'], v: number) => g.applySettings({ volume: { ...vol, [k]: v } });
      const pct = (v: number) => `${Math.round(v * 100)}%`;
      range(t('audio.master'), vol.master, 0, 1, 0.05, (v) => setV('master', v), pct);
      range(t('audio.sfx'), vol.sfx, 0, 1, 0.05, (v) => setV('sfx', v), pct);
      range(t('audio.ambience'), vol.ambience, 0, 1, 0.05, (v) => setV('ambience', v), pct);
      range(t('audio.music'), vol.music, 0, 1, 0.05, (v) => setV('music', v), pct);
      card.appendChild(h('p', 'muted', t('audio.note')));
    } else {
      range(t('access.uiScale'), s.uiScale, 0.8, 1.5, 0.05, (v) => g.applySettings({ uiScale: v }), (v) => `${Math.round(v * 100)}%`);
      check(t('access.contrast'), s.highContrast, (v) => g.applySettings({ highContrast: v }));
      check(t('access.motion'), s.reduceMotion, (v) => g.applySettings({ reduceMotion: v }));
      check(t('access.captions'), s.captions, (v) => g.applySettings({ captions: v }));
      check(t('access.toggleSprint'), s.toggleSprint, (v) => g.applySettings({ toggleSprint: v }));
    }
    const reset = h('button', '', t('settings.resetAll'));
    reset.onclick = () => {
      if (!confirm(t('settings.resetConfirm'))) return;
      g.applySettings({ ...structuredClone(DEFAULT_SETTINGS), language: s.language });
      this.settingsMenu(back);
    };
    card.appendChild(reset);
    const b = h('button', 'primary', t('menu.back'));
    b.onclick = back;
    card.appendChild(b);
    this.showMenu(card);
  }

  /** Authors of the artist models in use (CC-BY requires the credit). */
  creditsMenu(back: () => void): void {
    const card = h('div', 'card');
    card.appendChild(h('h2', '', t('menu.credits')));
    const list = modelCredits();
    card.appendChild(h('p', 'muted', list.length ? t('credits.models') : t('credits.none')));
    const ul = h('ul', 'credits');
    for (const { id, credit } of list) {
      const li = h('li', '');
      const name = SPECIES[id]?.name[language()] ?? id;
      li.appendChild(h('b', '', name));
      li.appendChild(document.createTextNode(` — “${credit.title}”, ${credit.author} · ${credit.license} · `));
      const a = h('a', '', credit.url.replace(/^https:\/\//, '').split('/')[0]) as HTMLAnchorElement;
      a.href = credit.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      li.appendChild(a);
      ul.appendChild(li);
    }
    card.appendChild(ul);
    card.appendChild(h('p', 'muted', t('credits.procedural')));
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
      list.appendChild(h('span', '', t(`action.${a}`)));
      const b = h('button', '', this.rebinding === a ? '…' : g.input.keys[a].join(' / ').replace(/Key|Digit/g, ''));
      b.onclick = () => {
        this.rebinding = a;
        b.textContent = '…';
        const handler = (e: KeyboardEvent) => {
          e.preventDefault();
          if (e.code !== 'Escape') g.input.rebind(a, e.code);
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
      card.appendChild(h('p', 'muted pct', '0%'));
      this.showMenu(card);
      bar = this.menuEl.querySelector('.loading-bar i') as HTMLElement;
    }
    bar.style.width = `${Math.round(progress * 100)}%`;
    const pct = this.menuEl.querySelector('.pct');
    if (pct) pct.textContent = `${Math.round(progress * 100)}%`;
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
    card.appendChild(h('p', '', esc(msg)));
    const b = h('button', 'primary', t('error.reload'));
    b.onclick = () => location.reload();
    card.appendChild(b);
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
      b.setAttribute('aria-label', label);
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
    mk(btns, t('touch.crouch'), 'crouch');
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
