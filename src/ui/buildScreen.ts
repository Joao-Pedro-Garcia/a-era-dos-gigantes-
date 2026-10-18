import { PIECES, type Placement, type PieceType } from '../building/building';
import { BUILD_STEPS, type BuildController, type BuildStep } from '../building/buildMode';
import type { PieceThumbs } from '../building/pieceThumbs';
import type { Action, Input } from '../input/input';
import type { Inventory, ItemList } from '../inventory/inventory';
import { t } from '../localization/i18n';

/**
 * The build screen: a catalogue of pieces by category (with 3D pictures of
 * the real models, costs as have/need), the selected piece's details and the
 * placement controls. Every control drives the game's real build system
 * (BuildController + Building.preview/place); nothing here builds by itself.
 */
export interface BuildHost {
  buildCtl: BuildController;
  buildPlacement: Placement | null;
  inventory: Inventory;
  input: Input;
  thumbs: PieceThumbs;
  pieceAvailable(p: PieceType): boolean;
  pieceCost(p: PieceType): ItemList;
  setBuildPiece(p: PieceType): void;
  cancelBuildPlacement(): void;
  toggleBuild(): void;
  itemName(id: string): string;
}

/** Each piece belongs to exactly one category (checked by the tests). */
export const BUILD_CATEGORIES: { id: string; pieces: PieceType[] }[] = [
  { id: 'foundations', pieces: ['foundation', 'stone_foundation', 'floor', 'platform'] },
  { id: 'walls', pieces: ['wall', 'stone_wall', 'door'] },
  { id: 'roofs', pieces: ['roof', 'stairs'] },
  { id: 'defense', pieces: ['fence', 'palisade', 'gate', 'electric_fence', 'spike_trap', 'snare_trap'] },
  { id: 'stations', pieces: ['campfire', 'workbench', 'forge', 'storage'] },
  { id: 'living', pieces: ['bed', 'crop_plot', 'water_collector', 'well'] },
  { id: 'animals', pieces: ['feeding_trough', 'nest_box'] },
  { id: 'energy', pieces: ['wind_generator', 'lamp', 'torch_post'] },
];

/** Simple line icons (consistent on every platform, unlike emoji). */
const ICONS: Record<string, string> = {
  foundations: '<path d="M3 15h18v4H3zM6 15V11h12v4"/>',
  walls: '<path d="M4 5h16v14H4zM4 10h16M4 15h16M9 5v5M15 10v5M9 15v4"/>',
  roofs: '<path d="M3 12 12 4l9 8M6 10v9h12v-9"/>',
  defense: '<path d="M5 20V8l2-3 2 3v12M11 20V8l2-3 2 3v12M17 20V8l2-3 2 3v12M3 13h20"/>',
  stations: '<path d="M4 11h16v3H4zM6 14v6M18 14v6M9 11V7h6v4"/>',
  living: '<path d="M3 17h18M5 17v-4h14v4M7 13V9h4v4"/>',
  animals: '<path d="M4 14h16l-2 5H6zM8 14c0-3 2-5 4-5s4 2 4 5"/>',
  energy: '<path d="M13 3 6 13h5l-1 8 7-10h-5z"/>',
};
const icon = (id: string) => `<svg viewBox="0 0 24 24" class="bs-ico" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round">${ICONS[id] ?? ''}</g></svg>`;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

export class BuildScreen {
  private category = 'foundations';
  private catalogKey = '';
  private statusKey = '';
  private catalogEl: HTMLElement;
  private sideEl: HTMLElement;
  private collapsed = false;
  private dyn: { status: HTMLElement; lift: HTMLElement; cost: HTMLElement; confirm: HTMLButtonElement } | null = null;
  private dynKey = '';

  constructor(
    private root: HTMLElement,
    private g: BuildHost,
  ) {
    root.className = 'buildscreen interactive hidden';
    root.innerHTML = '';
    this.catalogEl = el('div', 'bs-catalog');
    this.sideEl = el('div', 'bs-side');
    root.append(this.catalogEl, this.sideEl);
  }

  /** Called every frame while building (cheap when nothing changed). */
  update(show: boolean, reason: string | null): void {
    this.root.classList.toggle('hidden', !show);
    document.body.classList.toggle('building', show);
    if (!show) return;
    const g = this.g;
    // The renderer exists only once the game runs: hook the pictures up lazily.
    g.thumbs.onReady = () => {
      this.catalogKey = '';
    };
    g.thumbs.pump(2);
    const sel = g.buildCtl.selected;
    // A piece chosen from the catalogue opens its category.
    if (sel && !BUILD_CATEGORIES.find((c) => c.id === this.category)!.pieces.includes(sel)) this.category = BUILD_CATEGORIES.find((c) => c.pieces.includes(sel))!.id;
    const inv = JSON.stringify(g.inventory.data.slots.map((s) => s && [s.id, s.qty]));
    const ck = `${this.category}|${sel}|${inv}|${this.collapsed}|${g.input.mode}|${BUILD_CATEGORIES.map((c) => c.pieces.map((p) => +g.pieceAvailable(p)).join('')).join()}`;
    if (ck !== this.catalogKey) {
      this.catalogKey = ck;
      this.renderCatalog();
    }
    // Structure only changes with the piece/options (never while a button is held).
    const sk = `${sel}|${g.buildCtl.step}|${g.buildCtl.snap}|${g.input.mode}`;
    if (sk !== this.statusKey) {
      this.statusKey = sk;
      this.renderSide();
      this.dynKey = '';
    }
    const pl = g.buildPlacement;
    const dk = `${reason}|${pl?.valid}|${g.buildCtl.lift}|${inv}`;
    if (dk !== this.dynKey) {
      this.dynKey = dk;
      this.updateDynamic(reason);
    }
  }

  private updateDynamic(reason: string | null): void {
    const d = this.dyn;
    const sel = this.g.buildCtl.selected;
    if (!d || !sel) return;
    const pl = this.g.buildPlacement;
    d.status.className = `bs-status ${pl?.valid ? 'ok' : 'no'}`;
    d.status.innerHTML = pl?.valid ? `<b>✔</b> ${t('build.ready')}` : `<b>✖</b> ${reason ? t(`build.invalid.${reason}`) : t('build.aim')}`;
    const lift = this.g.buildCtl.lift;
    d.lift.textContent = `${t('build.move')} · ${t('build.height')}: ${lift >= 0 ? '+' : ''}${lift.toFixed(2)} m`;
    d.cost.innerHTML = '';
    for (const r of this.costRows(sel)) d.cost.appendChild(el('span', r.have >= r.need ? 'ok' : 'no', `${r.have}/${r.need} ${this.g.itemName(r.id)}`));
    d.confirm.disabled = !pl?.valid;
  }

  private costRows(p: PieceType): { id: string; need: number; have: number }[] {
    return Object.entries(this.g.pieceCost(p)).map(([id, need]) => ({ id, need, have: this.g.inventory.count(id) }));
  }

  private renderCatalog(): void {
    const g = this.g;
    const c = this.catalogEl;
    c.innerHTML = '';
    const head = el('div', 'bs-head');
    const title = el('h3', '', t('build.title'));
    const fold = el('button', 'bs-fold', this.collapsed ? '▴' : '▾');
    fold.title = t(this.collapsed ? 'build.expand' : 'build.collapse');
    fold.onclick = () => {
      this.collapsed = !this.collapsed;
      this.catalogKey = '';
    };
    const exit = el('button', 'bs-exit');
    exit.innerHTML = `${t('build.exit')} <kbd>B</kbd>`;
    exit.onclick = () => g.toggleBuild();
    head.append(title, fold, exit);
    c.appendChild(head);
    c.classList.toggle('collapsed', this.collapsed);
    if (this.collapsed) return;
    const tabs = el('div', 'bs-tabs');
    for (const cat of BUILD_CATEGORIES) {
      const b = el('button', cat.id === this.category ? 'active' : '');
      b.innerHTML = `${icon(cat.id)}<span>${t(`build.cat.${cat.id}`)}</span>`;
      b.title = t(`build.cat.${cat.id}`);
      b.onclick = () => {
        this.category = cat.id;
        this.catalogKey = '';
      };
      tabs.appendChild(b);
    }
    // Touch layout has no header: the exit lives at the end of the tab row.
    const ex = el('button', 'bs-tabexit', t('build.exit'));
    ex.onclick = () => g.toggleBuild();
    tabs.appendChild(ex);
    c.appendChild(tabs);
    const grid = el('div', 'bs-grid');
    for (const p of BUILD_CATEGORIES.find((x) => x.id === this.category)!.pieces) {
      const available = g.pieceAvailable(p);
      const rows = this.costRows(p);
      const affordable = rows.every((r) => r.have >= r.need);
      const card = el('button', `bs-card${p === g.buildCtl.selected ? ' selected' : ''}${!available ? ' locked' : !affordable ? ' short' : ''}`);
      card.dataset.piece = p;
      const pic = el('div', 'bs-pic');
      const url = g.thumbs.get(p);
      if (url) pic.style.backgroundImage = `url(${url})`;
      else pic.innerHTML = icon(this.category);
      const name = el('div', 'bs-name', t(`piece.${p}`));
      const cost = el('div', 'bs-cost');
      if (!available) cost.textContent = `🔒 ${t(`unlock.${PIECES[p].unlock}`)}`;
      else
        for (const r of rows) {
          const chip = el('span', r.have >= r.need ? 'ok' : 'no', `${Math.min(r.have, 999)}/${r.need} ${g.itemName(r.id)}`);
          cost.appendChild(chip);
        }
      card.append(pic, name, cost);
      card.onclick = () => {
        if (!available) return;
        g.setBuildPiece(p);
        this.statusKey = '';
        this.catalogKey = '';
      };
      grid.appendChild(card);
    }
    c.appendChild(grid);
  }

  /** A control that works with a tap/click and keeps repeating while held. */
  private holdButton(action: Action, html: string, title: string, cls = ''): HTMLButtonElement {
    const b = el('button', `bs-ctl ${cls}`);
    b.innerHTML = html;
    b.title = title;
    b.dataset.action = action;
    const input = this.g.input;
    b.onpointerdown = (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        b.setPointerCapture?.(e.pointerId);
      } catch {
        /* synthetic or already-released pointers: the press still counts */
      }
      input.touchPress(action);
      input.touchHold(action, true);
    };
    const up = () => input.touchHold(action, false);
    b.onpointerup = up;
    b.onpointercancel = up;
    b.onlostpointercapture = up;
    return b;
  }

  private key(a: Action): string {
    const k = this.g.input.keys[a]?.[0] ?? '';
    return k.replace(/^Key|^Digit/, '').replace('PageUp', 'PgUp').replace('PageDown', 'PgDn').replace('Mouse0', t('build.click'));
  }

  private renderSide(): void {
    const g = this.g;
    const s = this.sideEl;
    s.innerHTML = '';
    this.dyn = null;
    const sel = g.buildCtl.selected;
    const touch = g.input.mode === 'touch';
    if (!sel) {
      s.classList.add('empty');
      s.appendChild(el('p', 'bs-hint', t(touch ? 'build.pickHintTouch' : 'build.pickHint')));
      const dem = this.holdButton('demolish', `${t('build.demolish')} <kbd>${this.key('demolish')}</kbd>`, t('build.demolishHint'), 'wide');
      s.appendChild(dem);
      return;
    }
    s.classList.remove('empty');
    // Details.
    const det = el('div', 'bs-detail');
    det.appendChild(el('h4', '', t(`piece.${sel}`)));
    det.appendChild(el('p', 'muted', t(`piece.desc.${sel}`)));
    const cost = el('div', 'bs-cost big');
    det.appendChild(cost);
    const st = el('div', 'bs-status');
    st.setAttribute('role', 'status');
    det.appendChild(st);
    s.appendChild(det);

    // Placement controls.
    const k = (a: Action) => (touch ? '' : ` <kbd>${this.key(a)}</kbd>`);
    const pad = el('div', 'bs-pad');
    pad.append(
      el('span'),
      this.holdButton('buildForward', `▲${k('buildForward')}`, t('build.forward')),
      this.holdButton('buildRaise', `⤒${k('buildRaise')}`, t('build.raise')),
      this.holdButton('buildLeft', `◀${k('buildLeft')}`, t('build.left')),
      this.holdButton('buildBack', `▼${k('buildBack')}`, t('build.back')),
      this.holdButton('buildRight', `▶${k('buildRight')}`, t('build.right')),
      this.holdButton('rotateLeft', `⟲${k('rotateLeft')}`, t('build.rotLeft')),
      this.holdButton('buildLower', `⤓${k('buildLower')}`, t('build.lower')),
      this.holdButton('rotateRight', `⟳${k('rotateRight')}`, t('build.rotRight')),
    );
    s.appendChild(pad);
    const labels = el('div', 'bs-padlabels muted');
    s.appendChild(labels);

    const opts = el('div', 'bs-opts');
    const seg = el('div', 'bs-seg');
    seg.setAttribute('role', 'radiogroup');
    seg.title = `${t('build.step')}${touch ? '' : ` (${this.key('buildStep')})`}`;
    for (const step of ['fine', 'normal', 'fast'] as BuildStep[]) {
      const b = el('button', g.buildCtl.step === step ? 'active' : '', t(`build.step.${step}`));
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(g.buildCtl.step === step));
      b.title = `${BUILD_STEPS[step].move} m · ${Math.round((BUILD_STEPS[step].rot * 180) / Math.PI)}°`;
      b.onclick = () => {
        g.buildCtl.step = step;
        this.statusKey = '';
      };
      seg.appendChild(b);
    }
    opts.appendChild(seg);
    const snap = el('button', `bs-toggle ${g.buildCtl.snap ? 'on' : ''}`);
    snap.innerHTML = `⌗ ${t(g.buildCtl.snap ? 'build.snapOn' : 'build.snapOff')}${k('snapToggle')}`;
    snap.onclick = () => {
      g.buildCtl.snap = !g.buildCtl.snap;
      this.statusKey = '';
    };
    const reset = el('button', 'bs-toggle');
    reset.innerHTML = `↺ ${t('build.rotReset')}${k('buildRotReset')}`;
    reset.onclick = () => {
      g.buildCtl.resetRotation();
      this.statusKey = '';
    };
    opts.append(snap, reset);
    s.appendChild(opts);

    const actions = el('div', 'bs-actions');
    const confirm = el('button', 'primary bs-confirm');
    confirm.innerHTML = `${t('build.confirm')}${touch ? '' : ` <kbd>${t('build.click')}</kbd>`}`;
    confirm.onpointerdown = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!confirm.disabled) g.input.touchPress('attack');
    };
    const cancel = el('button', 'bs-cancel');
    cancel.innerHTML = `${t('build.cancel')}${touch ? '' : ' <kbd>Esc</kbd>'}`;
    cancel.onclick = () => {
      g.cancelBuildPlacement();
      this.statusKey = '';
      this.catalogKey = '';
    };
    actions.append(cancel, confirm);
    s.appendChild(actions);
    if (!touch) s.appendChild(el('p', 'bs-hint small', t('build.mouseHint')));
    this.dyn = { status: st, lift: labels, cost, confirm };
  }
}
