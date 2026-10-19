import { hpOf, maxHp, repairCost } from '../building/durability';
import { hitRegion, regionMultiplier } from '../combat/dinoAttacks';
import * as THREE from 'three';
import { growthScale, lifeStage, maxHealth, type AnimalData } from '../animals/animal';
import { SPECIES, SPECIES_IDS } from '../animals/species';
import { CROP_SEED, type CropType, type Piece } from '../building/building';
import { resolveDamage, weaponKind } from '../combat/combat';
import { actionKindFor, isHoldable, type ActionDef } from '../combat/actions';
import { reactionScale } from '../animals/animalView';
import type { ImpactMaterial } from '../graphics/impactFx';
import { arrowModel } from '../player/itemModels';
import type { ItemList, Stack } from '../inventory/inventory';
import { ITEMS } from '../inventory/items';
import { language, t } from '../localization/i18n';
import { DOC_BY_ID, Mysteries } from '../mysteries/mysteries';
import { TAME_PROFILES } from '../taming/profiles';
import { canMount, defaultName, foodValue, isScared, issueCommand, makeTame, offerFood } from '../taming/taming';
import { CAVE_Y, type Interactable, type ResourceNode } from '../world/sectors';
import { VEG_YIELD } from '../world/vegetationModels';
import { hash2 } from './rng';
import type { Game } from './game';

export interface Interaction {
  label: string;
  run: () => void;
}

interface Projectile {
  mesh: THREE.Object3D;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  damage: number;
  life: number;
  /** 1 once it has stuck in the ground or a wall. */
  stuck: number;
  /** Where it was released (diagnostics). */
  origin: THREE.Vector3;
}

/**
 * Everything the player can do with the world in front of them: gathering,
 * fighting, taming, reading, building facilities, caves and the mystery.
 */
export class Interactions {
  projectiles: Projectile[] = [];
  private analyzed = new Set<string>();

  constructor(private g: Game) {}

  // ------------------------------------------------------------------ targeting

  inFront(x: number, z: number, maxDist: number, minDot = 0.35, y?: number): number | null {
    const p = this.g.player!;
    if (y !== undefined && Math.abs(y - p.s.y) > 6) return null;
    const dx = x - p.s.x;
    const dz = z - p.s.z;
    const d = Math.hypot(dx, dz);
    if (d > maxDist) return null;
    if (d < 1.2) return d;
    const dot = (dx * Math.sin(p.s.yaw) + dz * Math.cos(p.s.yaw)) / d;
    return dot > minDot ? d : null;
  }

  nodeInFront(range = 2.2, minDot = 0.35): ResourceNode | null {
    const p = this.g.player!;
    let best: ResourceNode | null = null;
    let bd = Infinity;
    for (const n of this.g.sectors!.nodesNear(p.s.x, p.s.z, range + 2.5)) {
      const reach = range + (n.kind === 'boulder' ? 2.4 : n.kind === 'rock' || n.kind === 'rubble' ? 1.2 : 0.3) * n.scale;
      const d = this.inFront(n.x, n.z, reach, minDot, n.y);
      if (d !== null && d < bd) {
        bd = d;
        best = n;
      }
    }
    return best;
  }

  private animalInFront(range: number, filter: (a: AnimalData) => boolean, minDot = 0.5): AnimalData | null {
    const now = this.g.env!.state.time;
    let best: AnimalData | null = null;
    let bd = Infinity;
    for (const a of this.g.eco!.active) {
      if (!filter(a)) continue;
      const sp = SPECIES[a.speciesId];
      const r = sp.lengthM * 0.35 * growthScale(a, now);
      const d = this.inFront(a.x, a.z, range + r, minDot, a.y);
      if (d !== null && d < bd) {
        bd = d;
        best = a;
      }
    }
    return best;
  }

  keyLabel(): string {
    const input = this.g.input;
    return input.mode === 'touch' ? '' : input.mode === 'gamepad' ? '[X]' : `[${input.keys.interact[0].replace('Key', '')}]`;
  }

  // ------------------------------------------------------------------ prompts

  find(): Interaction | null {
    const g = this.g;
    const p = g.player!;
    const key = this.keyLabel();
    const held = g.heldItem();
    const now = g.env!.state.time;

    if (g.mountedId) return { label: t('tame.dismount', { key }), run: () => g.dismount() };

    for (const b of g.bags) {
      if (Math.hypot(b.x - p.s.x, b.z - p.s.z) < 2.5 && Math.abs(b.y - p.s.y) < 4) return { label: t('prompt.bag', { key }), run: () => this.pickupBag(b) };
    }

    // Mystery objects, caves.
    for (const it of g.sectors!.interactablesNear(p.s.x, p.s.z, 6)) {
      const d = this.inFront(it.x, it.z, it.kind === 'cave_enter' || it.kind === 'cave_exit' ? 4.5 : 3, 0.2, it.y);
      if (d === null) continue;
      const res = this.interactableAction(it, key);
      if (res) return res;
    }

    // Tamed / tameable animals and wild nests.
    const tamed = this.animalInFront(4, (a) => a.alive && !!a.tame);
    if (tamed) {
      if (held && foodValue(tamed.speciesId, held.id) > 0 && tamed.hunger > 0.08)
        return { label: t('tame.feedTamed', { key, name: tamed.tame!.name, food: t(`item.${held.id}`) }), run: () => this.feed(tamed, held) };
      return { label: t('tame.open', { key, name: tamed.tame!.name }), run: () => g.openAnimalPanel(tamed.id) };
    }
    const wild = this.animalInFront(5, (a) => a.alive && !a.tame && TAME_PROFILES[a.speciesId]?.method !== 'none');
    if (wild && held && foodValue(wild.speciesId, held.id) > 0) {
      if (isScared(wild, now)) return { label: t('tame.scaredPrompt', { what: SPECIES[wild.speciesId].name[language()] }), run: () => {} };
      return { label: t('tame.offer', { key, food: t(`item.${held.id}`), what: SPECIES[wild.speciesId].name[language()] }), run: () => this.feed(wild, held) };
    }
    for (const n of g.eco!.nests.values()) {
      if (n.eggs > 0 && this.inFront(n.x, n.z, 3, 0.2) !== null) return { label: t('tame.takeEgg', { key, what: SPECIES[n.speciesId].name[language()] }), run: () => this.takeEgg(n.id) };
    }

    // Building pieces.
    const piece = g.buildingSys!.nearest(p.s.x, p.s.z, 3.5, (pc) => USABLE.has(pc.type) && this.inFront(pc.x, pc.z, 3.5, 0.2, pc.y) !== null);
    if (piece) {
      const r = this.pieceAction(piece, key);
      if (r) return r;
    }
    // Damaged pieces: repair with materials (a quarter of the cost at most).
    const hurt = g.buildingSys!.nearest(p.s.x, p.s.z, 4, (pc) => hpOf(pc) < maxHp(pc.type) - 0.5 && this.inFront(pc.x, pc.z, 4, 0.3, pc.y) !== null);
    if (hurt) {
      const cost = repairCost(hurt);
      const list = Object.entries(cost).map(([k, q]) => `${q} ${t(`item.${k}`)}`).join(', ');
      return {
        label: t('build.repair', { key, what: t(`piece.${hurt.type}`), hp: Math.ceil(hpOf(hurt)), max: maxHp(hurt.type), cost: list }),
        run: () => {
          const r = g.buildingSys!.repair(hurt.id, g.inventory);
          if (r === 'ok') {
            g.audio.sfx('place', [hurt.x, hurt.y + 1, hurt.z]);
            g.notify('build.repaired', { what: t(`piece.${hurt.type}`) }, 'good');
            g.xp('crafting', 5);
          } else if (r === 'materials') g.notify('build.repairMissing', { cost: list }, 'warn');
        },
      };
    }

    // Carcasses.
    for (const a of g.eco!.active) {
      if (a.alive || a.meat <= 0) continue;
      const sp = SPECIES[a.speciesId];
      if (this.inFront(a.x, a.z, 2.2 + sp.lengthM * 0.45 * growthScale(a, now), 0.1, a.y) !== null)
        return { label: t('prompt.butcher', { key, what: sp.name[language()] }), run: () => this.g.combat.request(() => this.butcher(a.id)) };
    }

    const n = this.nodeInFront();
    if (n) return { label: t('prompt.harvest', { key, what: this.nodeName(n) }), run: () => this.g.combat.request(() => this.strikeNode(n)) };

    // Water.
    if (!g.inCave) {
      const [fx, fz] = p.forward();
      const wx = p.s.x + fx * 1.6;
      const wz = p.s.z + fz * 1.6;
      if (p.swimming || g.terrain!.height(wx, wz) < g.env!.waterLevel - 0.15) {
        if (g.terrain!.continentMask(wx, wz) >= 0.85) return this.waterAction(key);
      }
    }
    return null;
  }

  private waterAction(key: string): Interaction {
    const g = this.g;
    const skin = g.inventory.data.slots.findIndex((s) => s?.id === 'waterskin');
    if (g.heldItem()?.id === 'waterskin' && skin >= 0) return { label: t('prompt.fill', { key }), run: () => this.fillWaterskin(skin) };
    return {
      label: t('prompt.drink', { key }),
      run: () => {
        g.survival!.drink(25);
        g.audio.sfx('drink');
        g.xp('survival', 1);
      },
    };
  }

  private interactableAction(it: Interactable, key: string): Interaction | null {
    const g = this.g;
    const m = g.mysteries;
    switch (it.kind) {
      case 'doc': {
        const def = DOC_BY_ID[it.ref];
        const needsBattery = def.needs === 'battery' && !m.d.powered.includes(def.id);
        const label = needsBattery ? t('mystery.terminalOff', { key }) : t(def.kind === 'painting' ? 'mystery.examine' : def.kind === 'radio' ? 'mystery.listen' : 'mystery.read', { key });
        return { label, run: () => this.readDoc(def.id) };
      }
      case 'pickup':
        if (m.d.taken.includes(it.ref)) return null;
        return {
          label: t('mystery.take', { key, what: t(`item.${it.ref}`) }),
          run: () => {
            if (m.take(it.ref)) {
              this.give({ [it.ref]: 1 });
              g.xp('exploration', 20);
            }
          },
        };
      case 'door':
        return {
          label: t('mystery.lockedDoor', { key }),
          run: () => {
            if (g.inventory.count('keycard') <= 0) return g.notify('mystery.needKeycard', {}, 'warn');
            m.d.bunkerOpen = true;
            g.sectors!.openDoor(it, 'open:bunker');
            g.audio.sfx('place');
            g.notify('mystery.doorOpen', {}, 'good');
          },
        };
      case 'cache':
        if (!g.scanning() || m.d.taken.includes(it.id)) return null;
        return {
          label: t('mystery.cache', { key }),
          run: () => {
            if (!m.take(it.id)) return;
            this.give({ battery: 1, flare: 2, metal_scrap: 3, bandage: 2 });
            g.xp('tracking', 15);
          },
        };
      case 'beacon':
        return { label: this.beaconLabel(key), run: () => this.useBeacon() };
      case 'cave_enter': {
        const rubble = `rubble:${it.ref}`;
        if (!((g.sectors!.harvested[rubble] ?? -1) > g.env!.state.time)) return null;
        return { label: t('cave.enter', { key, what: t(`site.${it.ref}`) }), run: () => g.enterCave(it.ref) };
      }
      case 'cave_exit':
        return { label: t('cave.exit', { key }), run: () => g.exitCave() };
    }
    return null;
  }

  private beaconLabel(key: string): string {
    const m = this.g.mysteries;
    if (m.d.ending) return t('mystery.beaconDone');
    const missing = m.beaconMissing(this.g.inventory.count('calibration_core') > 0);
    if (!missing.length) return t('mystery.beaconActivate', { key });
    if (missing.includes('power') && this.g.inventory.count('battery') >= 2) return t('mystery.beaconPower', { key });
    return t('mystery.beaconMissing', { list: missing.map((x) => t(`mystery.missing.${x}`, { n: m.logsRead(), m: m.paintingsSeen() })).join(', ') });
  }

  private useBeacon(): void {
    const g = this.g;
    const m = g.mysteries;
    if (m.d.ending) return;
    const missing = m.beaconMissing(g.inventory.count('calibration_core') > 0);
    if (missing.includes('power') && g.inventory.count('battery') >= 2) {
      g.inventory.remove('battery', 2);
      m.d.beaconPowered = true;
      g.sectors!.flags.add('beacon:powered');
      g.notify('mystery.beaconPowered', {}, 'good');
      return;
    }
    if (missing.length) return;
    g.showEnding();
  }

  private pieceAction(pc: Piece, key: string): Interaction | null {
    const g = this.g;
    const held = g.heldItem();
    const now = g.env!.state.time;
    switch (pc.type) {
      case 'watchtower': {
        // Ladder: climb from the foot of the tower, climb down from its top.
        const top = Math.abs(g.player!.s.y - pc.y) < 0.8;
        return {
          label: t(top ? 'tower.down' : 'tower.up', { key }),
          run: () => {
            const pl = g.player!;
            if (top) {
              const ang = Math.atan2(pl.s.x - pc.x, pl.s.z - pc.z);
              const x = pc.x + Math.sin(ang) * 2.4;
              const z = pc.z + Math.cos(ang) * 2.4;
              pl.s.x = x;
              pl.s.z = z;
              pl.s.y = g.terrain!.height(x, z);
            } else {
              pl.s.x = pc.x;
              pl.s.z = pc.z;
              pl.s.y = pc.y;
              g.notify('tower.view', {}, 'good');
            }
            pl.vx = pl.vz = pl.vy = 0;
            pl.visualY = pl.s.y;
            g.audio.sfx('place');
          },
        };
      }
      case 'door':
      case 'gate':
        return { label: t('prompt.door', { key }), run: () => g.buildingSys!.toggleDoor(pc.id) };
      case 'bed':
        return { label: t('prompt.sleep', { key }), run: () => g.sleepIn(pc) };
      case 'storage':
      case 'feeding_trough':
        return { label: t(pc.type === 'storage' ? 'prompt.storage' : 'prompt.trough', { key }), run: () => g.openStorage(pc) };
      case 'water_collector':
        if ((pc.water ?? 0) < 1) return null;
        return {
          label: t('prompt.collector', { key, n: Math.floor(pc.water ?? 0) }),
          run: () => {
            const amount = Math.min(pc.water ?? 0, 5);
            pc.water = (pc.water ?? 0) - amount;
            g.survival!.drink(amount * 8);
            g.audio.sfx('drink');
          },
        };
      case 'well':
        return this.waterAction(key);
      case 'crop_plot': {
        if (!pc.crop) {
          const crop = (['berries', 'herb', 'fern_fronds'] as CropType[]).find((c) => held?.id === CROP_SEED[c] && g.inventory.count(CROP_SEED[c]) >= 2);
          if (!crop) return { label: t('prompt.cropEmpty'), run: () => {} };
          return {
            label: t('prompt.plant', { key, what: t(`item.${CROP_SEED[crop]}`) }),
            run: () => {
              if (g.inventory.remove(CROP_SEED[crop], 2) && g.buildingSys!.plant(pc.id, crop, now)) g.xp('environment', 5);
            },
          };
        }
        if ((pc.growth ?? 0) >= 1)
          return {
            label: t('prompt.crop', { key }),
            run: () => {
              const got = g.buildingSys!.harvestCrop(pc.id);
              if (got) {
                this.give(got);
                g.xp('environment', 10);
              }
            },
          };
        const dry = now - (pc.wateredAt ?? -1e9) >= 1200;
        if (dry && held?.id === 'waterskin_full') {
          return {
            label: t('prompt.water', { key }),
            run: () => {
              const i = g.inventory.data.slots.indexOf(held);
              if (i >= 0) g.inventory.data.slots[i] = { id: 'waterskin', qty: 1 };
              g.buildingSys!.water(pc.id, now);
            },
          };
        }
        return { label: t(dry ? 'prompt.cropDry' : 'prompt.cropGrowing', { n: Math.floor((pc.growth ?? 0) * 100) }), run: () => {} };
      }
      case 'nest_box': {
        if (pc.egg) return { label: t('tame.incubating', { what: SPECIES[pc.egg.sp].name[language()], n: Math.floor(pc.egg.progress * 100) }), run: () => {} };
        if (held?.id === 'dino_egg' && held.sp)
          return {
            label: t('tame.incubate', { key }),
            run: () => {
              const sp = held.sp!;
              if (g.inventory.remove('dino_egg', 1, sp) && g.buildingSys!.incubate(pc.id, sp)) g.notify('tame.incubateStart', { what: SPECIES[sp].name[language()] }, 'good');
            },
          };
        return { label: t('tame.nestEmpty'), run: () => {} };
      }
      case 'spike_trap':
        if ((pc.uses ?? 0) > 0) return { label: t('trap.spikeReady', { n: pc.uses ?? 0 }), run: () => {} };
        return {
          label: t('trap.repair', { key }),
          run: () => {
            if (g.inventory.removeAll({ wood: 2, flint: 1 })) pc.uses = 6;
            else g.notify('craft.missing', {}, 'warn');
          },
        };
      case 'snare_trap':
        if (pc.armed) return { label: t('trap.snareArmed'), run: () => {} };
        return {
          label: t('trap.rearm', { key }),
          run: () => {
            if (g.inventory.remove('rope', 1)) pc.armed = true;
            else g.notify('craft.missing', {}, 'warn');
          },
        };
      case 'lamp':
      case 'electric_fence':
        return { label: t(pc.powered ? 'power.on' : 'power.off'), run: () => {} };
      case 'wind_generator':
        return { label: t('power.generator', { n: Math.round(Math.min(1.6, Math.max(0, (g.env!.state.windSpeed - 1.5) / 5)) * 100) }), run: () => {} };
    }
    return null;
  }

  observePrompt(): string | null {
    const g = this.g;
    const range = g.heldItem()?.id === 'spyglass' ? 160 : 35;
    const detailed = g.progression.has('naturalist') || g.scanning();
    let best: AnimalData | null = null;
    let bd = range;
    for (const a of g.eco!.active) {
      const d = this.inFront(a.x, a.z, bd, range > 50 ? 0.97 : 0.9);
      if (d === null) continue;
      bd = d;
      best = a;
    }
    if (!best) return null;
    const a = best;
    const now = g.env!.state.time;
    const sp = SPECIES[a.speciesId];
    const spName = `${sp.name[language()]}${a.alpha ? ` ${t('ui.alpha')}` : ''}`;
    const name = a.tame ? `${a.tame.name} (${spName})` : `${spName}${lifeStage(a, now) === 'juvenile' ? ` ${t('ui.juvenile')}` : ''}`;
    let text = t('prompt.observe', { what: name, state: a.alive ? t(`ai.${a.state}`) : t('ai.dead') });
    if (a.alpha && a.alive) text += ` · ${t('obs.alpha')}`;
    if (detailed && a.alive) {
      const pct = (v: number) => `${Math.round(v * 100)}%`;
      text += ` · ${t('obs.detail', { hp: pct(a.health / maxHealth(a, now)), hunger: pct(a.hunger), thirst: pct(a.thirst), trust: pct((a.trustPlayer + 1) / 2) })}`;
      if (!a.tame && TAME_PROFILES[a.speciesId]?.method !== 'none') text += ` · ${t('obs.tame', { n: pct(a.tameProgress), m: t(`tame.method.${TAME_PROFILES[a.speciesId].method}`) })}`;
      if (!this.analyzed.has(a.id)) {
        this.analyzed.add(a.id);
        g.xp('tracking', 4);
      }
    }
    return text;
  }

  // ------------------------------------------------------------------ actions

  /** Interact (E) handling for the frame (attacks go through `updateCombat`). */
  update(interaction: Interaction | null): void {
    const g = this.g;
    if (g.input.consume('interact') && interaction) interaction.run();
  }

  /**
   * Drives the action state machine once per frame. `input` is false while
   * a menu or the building mode owns the attack button: the hands still
   * finish what they were doing and follow inventory changes.
   */
  updateCombat(dt: number, input: boolean): void {
    const g = this.g;
    const c = g.combat;
    const held = g.heldItem();
    const wanted = !g.mountedId && held && isHoldable(held.id) ? held.id : '';
    const pressed = input && g.input.consume('attack');
    const events = c.update(dt, { pressed, held: input && g.input.held('attack'), wanted, hasAmmo: g.inventory.count('arrow') > 0 });
    for (const e of events) {
      switch (e.type) {
        case 'equip':
          g.audio.sfx('equip');
          break;
        case 'unequip':
          g.audio.sfx('unequip');
          break;
        case 'swing':
          g.audio.sfx(e.def.kind === 'punch' ? 'swingLight' : e.def.heavy || e.def.twoHanded ? 'swingHeavy' : 'swing');
          break;
        case 'drawStart':
          g.audio.sfx('bowDraw');
          break;
        case 'noAmmo':
          g.notify('notify.noArrows', {}, 'warn');
          break;
        case 'release':
          if (g.inventory.remove('arrow', 1)) {
            g.audio.sfx('bow');
            this.fireArrow(e.draw);
            g.wearHeld();
          }
          break;
        case 'use':
          if (e.task) e.task();
          else if (e.item === 'spyglass') this.useSpyglass();
          else if (e.item === 'flare') this.useFlare();
          break;
        case 'impact':
          if (e.task) e.task();
          else this.strike(e.def, e.item, e.hand);
          break;
      }
    }
    // While an action runs the attack button is busy (the building mode keeps its own cooldown).
    if (c.busy) g.attackCooldown = Math.max(g.attackCooldown, 0.1);
  }

  /** Direction the player is attacking in (camera yaw and pitch). */
  private attackDir(out: THREE.Vector3): THREE.Vector3 {
    const s = this.g.player!.s;
    const cp = Math.cos(s.pitch);
    return out.set(Math.sin(s.yaw) * cp, Math.sin(s.pitch), Math.cos(s.yaw) * cp).normalize();
  }

  /**
   * True when something solid (a wall, a rock, a tree trunk, the terrain)
   * lies between the player's chest and a point.
   */
  private obstructed(x: number, y: number, z: number): boolean {
    const g = this.g;
    const p = g.player!.s;
    const y0 = p.y + 1.3;
    const d = Math.hypot(x - p.x, z - p.z);
    const steps = Math.max(2, Math.ceil(d / 0.35));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const sx = p.x + (x - p.x) * t;
      const sz = p.z + (z - p.z) * t;
      const sy = y0 + (y - y0) * t;
      if (!g.inCave && sy < g.terrain!.height(sx, sz) - 0.05) return true;
      if (g.collision.blocked(sx, sz, 0.05, sy - 0.1, 0.2)) return true;
    }
    return false;
  }

  /**
   * Resolves a melee blow at the impact frame of the animation: the
   * nearest living animal or resource inside the weapon's reach and arc,
   * not hidden behind an obstacle. One target per swing; a miss just ends
   * the swing (or splashes when it ends in water).
   */
  strike(def: ActionDef, item: string, hand: 'L' | 'R'): void {
    const g = this.g;
    const p = g.player!;
    const now = g.env!.state.time;
    const dir = this.attackDir(new THREE.Vector3());
    const target = this.animalInFront(def.reach, (a) => {
      if (!a.alive || (a.tame && a.tame.ridden)) return false;
      const sp = SPECIES[a.speciesId];
      return Math.abs(a.y + sp.hipHeightM * growthScale(a, now) - p.s.y) < sp.hipHeightM * 2 + 2.5;
    }, def.arc);
    if (target) {
      const sp = SPECIES[target.speciesId];
      const gs = growthScale(target, now);
      const r = sp.lengthM * 0.3 * gs;
      const d = Math.max(0.01, Math.hypot(target.x - p.s.x, target.z - p.s.z));
      // Contact point: on the near side of the body, at chest height (clamped to the animal's height).
      const cx = target.x - ((target.x - p.s.x) / d) * Math.min(r, d * 0.7);
      const cz = target.z - ((target.z - p.s.z) / d) * Math.min(r, d * 0.7);
      const cy = THREE.MathUtils.clamp(p.s.y + 1.25 + dir.y * Math.min(d, def.reach), target.y + 0.15 * gs, target.y + sp.hipHeightM * gs * 1.4);
      if (!this.obstructed(cx, cy, cz)) {
        const def2 = item ? ITEMS[item] : null;
        // Where the blow lands matters (head > neck > body > leg > tail), and a blow
        // into a wind-up, or right after dodging one, is a counter-attack.
        const region = hitRegion(target.speciesId, target.x, target.z, target.heading, gs, cx, cz, cy - target.y);
        const interrupted = g.eco!.brain.interruptAttack(target, now, def.heavy ? 1 : 0.55);
        const counter = interrupted || now < g.counterUntil;
        if (counter) {
          g.counterUntil = 0;
          g.notify('combat.counter', {}, 'good');
        }
        if (region === 'leg') g.eco!.brain.limp(target, now, 6);
        const raw = (def2?.damage ?? 4) * g.progression.meleeDamage() * regionMultiplier(target.speciesId, region) * (counter ? 1.5 : 1);
        const dmg = resolveDamage(target, raw, item ? weaponKind(item) : 'blunt');
        this.damageAnimal(target, dmg, def.kind === 'punch' ? 'punch' : 'hit');
        this.react(target, dir.x, dir.z, dmg);
        g.fx.spawn('flesh', new THREE.Vector3(cx, cy, cz), dir, def.heavy ? 1.2 : 0.8);
        g.hitStop(def.heavy ? 0.06 : 0.04);
        if (item) g.wearHeld();
        return;
      }
    }
    const n = this.nodeInFront(def.reach + 0.4, def.arc);
    if (n && this.strikeNode(n, item, hand)) return;
    // Miss. A swing that ends in water splashes.
    if (!g.inCave) {
      const ex = p.s.x + dir.x * def.reach;
      const ez = p.s.z + dir.z * def.reach;
      const ey = p.s.y + 1.25 + dir.y * def.reach;
      const water = g.env!.waterLevel;
      if (g.terrain!.height(ex, ez) < water && ey < water + 0.6) {
        g.fx.spawn('water', new THREE.Vector3(ex, water + 0.02, ez), dir, 1);
        g.audio.sfx('splash', [ex, water, ez]);
      }
    }
  }

  /** Size-scaled reaction of a struck animal (view flinch; the AI reaction is in brain.onHurt). */
  private react(a: AnimalData, dirX: number, dirZ: number, dmg: number): void {
    const g = this.g;
    const sp = SPECIES[a.speciesId];
    const now = g.env!.state.time;
    const share = Math.min(1, (dmg / Math.max(1, maxHealth(a, now))) * 6);
    g.animalHit(a.id, dirX, dirZ, (0.35 + share * 0.65) * reactionScale(sp.massKg * growthScale(a, now) ** 3));
    // Pain / alarm call (urgent), scaled by the animal's size.
    if (a.alive) g.audio.call(sp, a.x, a.y + sp.hipHeightM, a.z, growthScale(a, now), 1, false, '');
  }

  /** Material of a resource node for effects and sounds. */
  private nodeMaterial(n: ResourceNode): ImpactMaterial {
    switch (n.kind) {
      case 'rock':
      case 'boulder':
      case 'rubble':
      case 'fossil':
        return 'stone';
      case 'crystal':
        return 'crystal';
      case 'crate':
      case 'scrap':
        return 'metal';
      case 'bush':
      case 'fern':
      case 'reeds':
        return 'plant';
      default:
        return 'wood';
    }
  }

  /**
   * Hits a resource node at the impact frame (axe on wood, pickaxe on stone,
   * hands on bushes…). Returns false when the node is no longer reachable.
   */
  strikeNode(n: ResourceNode, item = this.g.combat.shown, hand: 'L' | 'R' = 'R'): boolean {
    const g = this.g;
    const p = g.player!;
    void hand;
    const reach = 2.4 + (n.kind === 'boulder' ? 2.4 : n.kind === 'rock' || n.kind === 'rubble' ? 1.2 : 0.3) * n.scale;
    if (this.inFront(n.x, n.z, reach + 0.4, 0.2, n.y) === null) return false;
    const mat = this.nodeMaterial(n);
    const dir = this.attackDir(new THREE.Vector3());
    const d = Math.max(0.01, Math.hypot(n.x - p.s.x, n.z - p.s.z));
    const surf = Math.max(0, d - (n.kind === 'boulder' ? 1.6 : n.kind === 'rock' ? 0.7 : 0.25) * n.scale);
    const hx = p.s.x + ((n.x - p.s.x) / d) * surf;
    const hz = p.s.z + ((n.z - p.s.z) / d) * surf;
    const hy = THREE.MathUtils.clamp(p.s.y + 1.1 + dir.y * surf, n.y + 0.1, n.y + (mat === 'plant' ? 0.8 : 1.6) * n.scale);
    const kind = actionKindFor(item);
    const heavy = kind === 'chop' || kind === 'mine' || kind === 'bash';
    g.fx.spawn(mat === 'stone' && !item ? 'dirt' : mat, new THREE.Vector3(hx, hy, hz), dir, heavy ? 1.2 : 0.7);
    g.sectors!.shakeNode(n, dir.x, dir.z, mat === 'stone' || mat === 'metal' || mat === 'crystal' ? 0.004 : mat === 'plant' ? 0.12 : 0.03 * (heavy ? 1.5 : 1));
    this.harvest(n);
    return true;
  }

  private damageAnimal(target: AnimalData, dmg: number, sound: 'hit' | 'punch' = 'hit'): void {
    const g = this.g;
    const p = g.player!;
    const wasAlive = target.alive;
    g.eco!.playerAttack(target, dmg, p.s.x, p.s.z);
    g.hostileUntil = g.env!.state.time + 10;
    if (!target.tame) g.setCompanionTarget(target.id);
    g.audio.sfx(sound, [target.x, target.y + 1, target.z]);
    g.xp('combat', dmg * 0.2);
    if (wasAlive && !target.alive) g.xp('combat', Math.sqrt(SPECIES[target.speciesId].massKg) * 0.5);
  }

  /**
   * Releases an arrow from the bow's nock (the first-person bow in first
   * person, the body's bow in third person), aimed at the point under the
   * crosshair so the offset between hand and eye does not spoil the aim.
   * Speed grows with the draw.
   */
  private fireArrow(draw: number): void {
    const g = this.g;
    const dir = new THREE.Vector3();
    g.camera.getWorldDirection(dir);
    const p = g.player!;
    const fp = g.settings.firstPerson;
    const pos = new THREE.Vector3();
    const from = fp ? g.viewmodel.nockWorld(pos) : g.playerView!.nockWorld(pos);
    if (!from) pos.set(p.s.x, p.s.y + 1.5, p.s.z).addScaledVector(dir, 0.6);
    const aim = g.camera.position.clone().addScaledVector(dir, 40);
    const v = aim.sub(pos).normalize();
    const mesh = new THREE.Group();
    const model = arrowModel(null, g.textures);
    model.rotation.x = Math.PI / 2;
    mesh.add(model);
    g.worldRoot.add(mesh);
    const speed = (g.progression.has('archer') ? 55 : 45) * (0.55 + 0.45 * draw);
    const dmg = (ITEMS.arrow.damage ?? 20) * g.progression.arrowDamage() * (0.5 + 0.5 * draw);
    this.projectiles.push({ mesh, pos, vel: v.multiplyScalar(speed), damage: dmg, life: 4, stuck: 0, origin: pos.clone() });
  }

  updateProjectiles(dt: number): void {
    const g = this.g;
    const now = g.env!.state.time;
    const seg = new THREE.Line3();
    const closest = new THREE.Vector3();
    const prev = new THREE.Vector3();
    const fwd = new THREE.Vector3(0, 0, 1);
    for (const pr of this.projectiles) {
      pr.life -= dt;
      if (pr.stuck > 0) continue; // stuck in the ground: stays a moment, then disappears
      prev.copy(pr.pos);
      pr.vel.y -= 9.8 * dt;
      pr.pos.addScaledVector(pr.vel, dt);
      pr.mesh.position.copy(pr.pos);
      pr.mesh.quaternion.setFromUnitVectors(fwd, closest.copy(pr.vel).normalize());
      const water = g.inCave ? -Infinity : g.env!.waterLevel;
      const ground = g.inCave ? CAVE_Y : g.terrain!.height(pr.pos.x, pr.pos.z);
      if (pr.pos.y < ground) {
        // Sinks into the soil, pointing along its flight.
        pr.pos.y = ground + 0.05;
        pr.mesh.position.copy(pr.pos).addScaledVector(closest.copy(pr.vel).normalize(), -0.25);
        g.fx.spawn('dirt', pr.pos, pr.vel, 0.5);
        g.audio.sfx('impactDirt', [pr.pos.x, pr.pos.y, pr.pos.z]);
        pr.stuck = 1;
        pr.life = Math.min(pr.life, 6);
        continue;
      }
      if (prev.y > water && pr.pos.y <= water && ground < water) {
        g.fx.spawn('water', new THREE.Vector3(pr.pos.x, water, pr.pos.z), pr.vel, 0.6);
        g.audio.sfx('splash', [pr.pos.x, water, pr.pos.z]);
        pr.vel.multiplyScalar(0.25);
      }
      if (g.collision.blocked(pr.pos.x, pr.pos.z, 0.02, pr.pos.y - 0.05, 0.1)) {
        g.fx.spawn('wood', pr.pos, pr.vel, 0.5);
        g.audio.sfx('chop', [pr.pos.x, pr.pos.y, pr.pos.z]);
        pr.stuck = 1;
        pr.life = Math.min(pr.life, 6);
        continue;
      }
      for (const a of g.eco!.active) {
        if (!a.alive || pr.life <= 0 || a.tame) continue;
        const sp = SPECIES[a.speciesId];
        const gs = growthScale(a, now);
        const center = new THREE.Vector3(a.x, a.y + sp.hipHeightM * gs, a.z);
        seg.set(prev, pr.pos);
        seg.closestPointToPoint(center, true, closest);
        if (closest.distanceTo(center) < Math.max(0.4, sp.lengthM * 0.22 * gs)) {
          const region = hitRegion(a.speciesId, a.x, a.z, a.heading, gs, closest.x, closest.z, closest.y - a.y);
          if (region === 'leg') g.eco!.brain.limp(a, now, 6);
          const dmg = resolveDamage(a, pr.damage * regionMultiplier(a.speciesId, region), 'arrow');
          this.damageAnimal(a, dmg);
          this.react(a, pr.vel.x, pr.vel.z, dmg);
          g.fx.spawn('flesh', closest, pr.vel, 0.7);
          pr.life = 0;
        }
      }
    }
    this.projectiles = this.projectiles.filter((pr) => {
      if (pr.life > 0) return true;
      pr.mesh.removeFromParent();
      pr.mesh.traverse((o) => o instanceof THREE.Mesh && o.geometry.dispose());
      return false;
    });
  }

  clear(): void {
    for (const pr of this.projectiles) {
      pr.mesh.removeFromParent();
      pr.mesh.traverse((o) => o instanceof THREE.Mesh && o.geometry.dispose());
    }
    this.projectiles = [];
    this.analyzed.clear();
  }

  private useSpyglass(): void {
    const g = this.g;
    const p = g.player!;
    const n = g.exploration.reveal(p.s.x, p.s.z, 500 * g.progression.revealMultiplier(), { yaw: p.s.yaw, halfAngle: 0.25 });
    if (n) g.notify('explore.spyglass', { n }, 'good');
  }

  private useFlare(): void {
    const g = this.g;
    if (!g.inventory.remove('flare', 1)) return;
    const p = g.player!;
    g.audio.sfx('flare');
    g.addFlare(p.s.x, p.s.y + 2, p.s.z);
    const now = g.env!.state.time;
    for (const a of g.eco!.active) {
      if (!a.alive || a.tame) continue;
      const sp = SPECIES[a.speciesId];
      if (Math.hypot(a.x - p.s.x, a.z - p.s.z) > 45) continue;
      if (sp.ecology === 'apexPredator' && a.hunger > 0.8) continue;
      g.eco!.brain.onScare(a, p.s.x, p.s.z, now);
    }
  }

  give(items: ItemList, sp?: string): void {
    const g = this.g;
    const overflow: ItemList = {};
    for (const [id, q] of Object.entries(items)) {
      if (!(q > 0)) continue;
      const left = g.inventory.add(id, q, undefined, sp);
      if (q - left > 0) g.notify('notify.got', { n: q - left, what: t(`item.${id}`) });
      if (left > 0) overflow[id] = left;
    }
    if (Object.keys(items).length) g.audio.sfx('pickup');
    g.inventory.autoHotbar();
    g.dropOverflow(overflow, sp);
  }

  nodeName(n: ResourceNode): string {
    if (n.kind === 'crate' || n.kind === 'scrap') return t('item.metal_scrap');
    if (n.kind === 'fossil') return t('item.fossil');
    if (n.kind === 'crystal') return t('item.crystal');
    if (n.kind === 'rubble') return t('cave.rubble');
    const def = VEG_YIELD[n.kind as keyof typeof VEG_YIELD];
    return def ? t(`item.${Object.keys(def.drops)[0]}`) : n.kind;
  }

  harvest(n: ResourceNode): void {
    const g = this.g;
    const held = g.heldItem();
    const now = g.env!.state.time;
    const sectors = g.sectors!;
    if (n.kind === 'crate' || n.kind === 'scrap') {
      const loot: ItemList = n.kind === 'crate' ? { metal_scrap: 3, bandage: 2 } : { metal_scrap: 2 };
      if (n.kind === 'crate' && g.rng.chance(0.5)) loot.sulfur = 2;
      if (n.kind === 'crate' && g.rng.chance(0.4)) loot.battery = 1;
      sectors.hitNode(n, now, 99);
      g.audio.sfx('impactMetal', [n.x, n.y + 0.5, n.z]);
      this.give(loot);
      g.xp('exploration', 3);
      return;
    }
    const stoneTool = held ? ITEMS[held.id].gather?.stone ?? 0 : 0;
    if (n.kind === 'rubble' || n.kind === 'crystal' || n.kind === 'fossil') {
      const knife = held ? ITEMS[held.id].gather?.meat ?? 0 : 0;
      const ok = n.kind === 'fossil' ? stoneTool >= 3 || knife > 0 : stoneTool >= 3;
      if (!ok) return g.notify('notify.needPickaxe', {}, 'warn');
      g.audio.sfx(n.kind === 'crystal' ? 'impactCrystal' : 'stone', [n.x, n.y + 0.5, n.z]);
      g.wearHeld();
      if (!sectors.hitNode(n, now, stoneTool >= 5 ? 2 : 1)) return;
      if (n.kind === 'rubble') {
        g.notify('cave.cleared', {}, 'good');
        g.xp('exploration', 30);
      } else if (n.kind === 'crystal') {
        this.give({ crystal: 2 });
        g.unlock('found_crystal');
        g.xp('environment', 10);
      } else {
        const sp = fossilSpecies(n.id);
        this.give({ fossil: 1 }, sp);
        g.recordFossil(n.id, sp);
      }
      return;
    }
    const def = VEG_YIELD[n.kind as keyof typeof VEG_YIELD];
    if (!def) return;
    const tool = held ? ITEMS[held.id].gather?.[def.tool] ?? 0 : 0;
    const power = tool > 0 ? tool : def.tool === 'fiber' ? 1 : 0.5;
    const drops: ItemList = {};
    for (const [k, q] of Object.entries(def.drops)) drops[k] = Math.max(1, Math.round(q * (tool > 0 ? 1 : 0.5)));
    const r = g.rng;
    if (n.kind === 'rock' || n.kind === 'boulder') {
      if (n.biome === 'volcanic') {
        if (r.chance(0.35)) drops.obsidian = 1;
        if (r.chance(0.25)) drops.sulfur = 1;
      } else if (n.biome === 'mountain' && r.chance(0.3)) drops.metal_ore = 1;
      else if (n.biome === 'snow' && r.chance(0.25)) drops.ice = 1;
      if ((n.biome === 'plains' || n.biome === 'beach' || n.biome === 'mountain') && r.chance(0.45)) drops.flint = 1;
    }
    if (n.kind === 'reeds' && n.biome === 'swamp' && r.chance(0.35)) drops.clay = 1;
    const herbChance = g.progression.has('herbalist') ? 0.6 : 0.35;
    if ((n.kind === 'bush' || n.kind === 'fern') && (n.biome === 'jungle' || n.biome === 'swamp') && r.chance(herbChance)) drops.herb = g.progression.has('herbalist') ? 2 : 1;
    g.audio.sfx(def.tool === 'wood' ? 'chop' : def.tool === 'stone' ? 'stone' : 'impactPlant', [n.x, n.y + 1, n.z]);
    this.give(drops);
    if (tool > 0) g.wearHeld();
    sectors.hitNode(n, now, power);
    g.xp('environment', 1);
  }

  butcher(id: string): void {
    const g = this.g;
    const a = g.eco!.get(id);
    if (!a) return;
    const held = g.heldItem();
    const knife = held ? ITEMS[held.id].gather?.meat ?? 0 : 0;
    const kg = g.eco!.harvestCarcass(a, 4 + knife * 4);
    if (kg <= 0) return;
    const sp = SPECIES[a.speciesId];
    const items: ItemList = { raw_meat: Math.max(1, Math.round(kg / 3)) };
    if (g.rng.chance(knife > 0 ? 0.7 : 0.3)) items.hide = 1;
    if (g.rng.chance(0.35)) items.bone = 1;
    if (sp.diet === 'piscivore' && g.rng.chance(0.3)) items.raw_fish = 1;
    this.give(items);
    if (knife > 0) g.wearHeld();
    g.fx.spawn('flesh', new THREE.Vector3(a.x, a.y + 0.4, a.z), new THREE.Vector3(a.x - g.player!.s.x, -0.5, a.z - g.player!.s.z), 0.6);
  }

  private fillWaterskin(slot: number): void {
    const s = this.g.inventory.data.slots[slot];
    if (!s || s.id !== 'waterskin') return;
    this.g.inventory.data.slots[slot] = { id: 'waterskin_full', qty: 1 };
    this.g.audio.sfx('drink');
  }

  useSlot(i: number): void {
    const g = this.g;
    const s = g.inventory.data.slots[i];
    if (!s) return;
    const def = ITEMS[s.id];
    const surv = g.survival!;
    if (s.id === 'waterskin_full') {
      surv.drink(50);
      g.inventory.data.slots[i] = { id: 'waterskin', qty: 1 };
      g.audio.sfx('drink');
      g.xp('survival', 2);
      return;
    }
    if (s.id === 'flare') return this.useFlare();
    if (s.id === 'spyglass') return this.useSpyglass();
    if (def.food) {
      if (!g.inventory.remove(s.id, 1, s.sp)) return;
      g.audio.sfx('eat');
      if (surv.eat(def.food, g.rng.next())) g.notify('notify.sick', {}, 'warn');
      g.xp('survival', 2);
      return;
    }
    if (def.heal !== undefined) {
      if (!g.inventory.remove(s.id, 1)) return;
      surv.treat(def.heal, !!def.stopsBleeding, { fracture: s.id === 'splint', sickness: s.id === 'antidote' });
      g.xp('survival', 5);
    }
  }

  pickupBag(b: { id: string; items: Stack[] }): void {
    const g = this.g;
    const remaining: Stack[] = [];
    for (const s of b.items) {
      const left = g.inventory.add(s.id, s.qty, s.dur, s.sp);
      if (left > 0) remaining.push({ ...s, qty: left });
      else g.notify('notify.got', { n: s.qty, what: t(`item.${s.id}`) });
    }
    b.items = remaining;
    if (!remaining.length) g.bags = g.bags.filter((x) => x !== b);
    else g.notify('notify.full', {}, 'warn');
    g.audio.sfx('pickup');
  }

  // ------------------------------------------------------------------ taming

  feed(a: AnimalData, stack: Stack): void {
    const g = this.g;
    const now = g.env!.state.time;
    const res = offerFood(a, stack.id, now, g.progression.tamingRate());
    if (['accepted', 'tamed', 'fed'].includes(res)) {
      g.inventory.remove(stack.id, 1, stack.sp);
      g.audio.sfx('eat');
    }
    const name = SPECIES[a.speciesId].name[language()];
    if (res === 'tamed') {
      makeTame(a, defaultName(a.speciesId, language()), now, false);
      g.notify('tame.tamed', { what: name }, 'good');
      g.xp('taming', 100);
    } else if (res === 'accepted') {
      g.notify('tame.accepted', { what: name, n: Math.round(a.tameProgress * 100) }, 'good');
      g.xp('taming', 5);
    } else if (res === 'fed') g.notify('tame.fedTamed', { name: a.tame!.name });
    else g.notify(`tame.result.${res}`, { what: name }, 'warn');
  }

  private takeEgg(nestId: string): void {
    const g = this.g;
    const p = g.player!;
    const sp = g.eco!.takeEgg(nestId, p.s.x, p.s.z);
    if (!sp) return;
    this.give({ dino_egg: 1 }, sp);
    g.hostileUntil = Math.max(g.hostileUntil, g.env!.state.time + 3);
  }

  command(a: AnimalData, cmd: 'follow' | 'stay' | 'roam' | 'guard'): void {
    const g = this.g;
    const p = g.player!;
    if (Math.hypot(a.x - p.s.x, a.z - p.s.z) > 35) return g.notify('tame.tooFar', { name: a.tame!.name }, 'warn');
    const res = issueCommand(a, cmd, g.env!.state.time, g.rng.next(), p.s.x, p.s.z, g.progression.bondRate());
    if (res === 'obeyed') {
      g.notify('tame.obeyed', { name: a.tame!.name, cmd: t(`tame.cmd.${cmd}`) });
      g.xp('taming', 1);
    } else g.notify('tame.ignored', { name: a.tame!.name }, 'warn');
  }

  mount(a: AnimalData): void {
    const g = this.g;
    const p = g.player!;
    if (!canMount(a, g.env!.state.time)) return g.notify('tame.cantMount', { name: a.tame?.name ?? '' }, 'warn');
    if (Math.hypot(a.x - p.s.x, a.z - p.s.z) > 6) return g.notify('tame.tooFar', { name: a.tame!.name }, 'warn');
    g.mount(a);
  }

  // ------------------------------------------------------------------ mysteries

  readDoc(id: string): void {
    const g = this.g;
    const m = g.mysteries;
    const res = m.read(id, g.inventory.count('battery') > 0, () => g.inventory.remove('battery', 1));
    if (res === 'needsBattery') return g.notify('mystery.needBattery', {}, 'warn');
    if (res === 'read') {
      g.xp('environment', 30);
      if (id === 'observatory_radio') {
        for (const s of Mysteries.radioTargets(new Set()))
          if (!g.exploration.d.markers.some((mk) => Math.hypot(mk.x - s.x, mk.z - s.z) < 60)) g.exploration.toggleMarker(s.x, s.z, 'star');
      }
      const def = DOC_BY_ID[id];
      if (def.key === 'log') g.notify('mystery.progressLogs', { n: m.logsRead(), m: 5 }, 'good');
      if (def.key === 'painting') g.notify('mystery.progressPaintings', { n: m.paintingsSeen(), m: 3 }, 'good');
    }
    g.hud.showDocument(t(`lore.${id}.title`), t(`lore.${id}.body`));
  }
}

const USABLE = new Set(['watchtower', 'door', 'gate', 'bed', 'storage', 'feeding_trough', 'water_collector', 'well', 'crop_plot', 'nest_box', 'spike_trap', 'snare_trap', 'lamp', 'electric_fence', 'wind_generator']);

/** Which species a fossil belongs to (deterministic from its id). */
export function fossilSpecies(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return SPECIES_IDS[hash2(h, 7, 11) % SPECIES_IDS.length];
}

