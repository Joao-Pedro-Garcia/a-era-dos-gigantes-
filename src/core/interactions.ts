import * as THREE from 'three';
import { growthScale, lifeStage, maxHealth, type AnimalData } from '../animals/animal';
import { SPECIES, SPECIES_IDS } from '../animals/species';
import { CROP_SEED, type CropType, type Piece } from '../building/building';
import { resolveDamage, weaponKind } from '../combat/combat';
import type { ItemList, Stack } from '../inventory/inventory';
import { ITEMS } from '../inventory/items';
import { language, t } from '../localization/i18n';
import { DOC_BY_ID, Mysteries } from '../mysteries/mysteries';
import { TAME_PROFILES } from '../taming/profiles';
import { canMount, defaultName, foodValue, issueCommand, makeTame, offerFood } from '../taming/taming';
import { CAVE_Y, type Interactable, type ResourceNode } from '../world/sectors';
import { VEG_YIELD } from '../world/vegetationModels';
import { hash2 } from './rng';
import type { Game } from './game';

export interface Interaction {
  label: string;
  run: () => void;
}

interface Projectile {
  mesh: THREE.Mesh;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  damage: number;
  life: number;
}

const arrowGeo = new THREE.CylinderGeometry(0.015, 0.015, 0.8, 4);
const arrowMat = new THREE.MeshStandardMaterial({ color: 0x6a4a2a });
arrowGeo.userData.shared = true;
arrowMat.userData.shared = true;

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

  nodeInFront(): ResourceNode | null {
    const p = this.g.player!;
    let best: ResourceNode | null = null;
    let bd = Infinity;
    for (const n of this.g.sectors!.nodesNear(p.s.x, p.s.z, 4.5)) {
      const reach = 2.2 + (n.kind === 'boulder' ? 2.4 : n.kind === 'rock' || n.kind === 'rubble' ? 1.2 : 0.3) * n.scale;
      const d = this.inFront(n.x, n.z, reach, 0.35, n.y);
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

    // Carcasses.
    for (const a of g.eco!.active) {
      if (a.alive || a.meat <= 0) continue;
      const sp = SPECIES[a.speciesId];
      if (this.inFront(a.x, a.z, 2.2 + sp.lengthM * 0.45 * growthScale(a, now), 0.1, a.y) !== null)
        return { label: t('prompt.butcher', { key, what: sp.name[language()] }), run: () => this.butcher(a.id) };
    }

    const n = this.nodeInFront();
    if (n) return { label: t('prompt.harvest', { key, what: this.nodeName(n) }), run: () => this.harvest(n) };

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
    const name = a.tame ? `${a.tame.name} (${sp.name[language()]})` : `${sp.name[language()]}${lifeStage(a, now) === 'juvenile' ? ` ${t('ui.juvenile')}` : ''}`;
    let text = t('prompt.observe', { what: name, state: a.alive ? t(`ai.${a.state}`) : t('ai.dead') });
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

  /** Interact (E) and attack/use (click) handling for the frame. */
  update(interaction: Interaction | null): void {
    const g = this.g;
    if (g.input.consume('interact') && interaction) interaction.run();
    const wantsAttack = g.input.consume('attack') || (g.input.mode === 'touch' && g.input.held('attack'));
    if (wantsAttack && g.attackCooldown <= 0) this.attack();
  }

  attack(): void {
    const g = this.g;
    const p = g.player!;
    const held = g.heldItem();
    g.attackCooldown = held?.id === 'bow' ? 0.9 : 0.6;
    g.playerView!.attackSwing();
    if (held?.id === 'spyglass') return this.useSpyglass();
    if (held?.id === 'flare') return this.useFlare();
    if (held?.id === 'bow') {
      if (!g.inventory.remove('arrow', 1)) {
        g.notify('notify.noArrows', {}, 'warn');
        return;
      }
      g.audio.sfx('bow');
      this.fireArrow();
      g.wearHeld();
      return;
    }
    g.audio.sfx('swing');
    const def = held ? ITEMS[held.id] : null;
    const reach = held?.id.includes('spear') ? 3.2 : held ? 2.4 : 1.8;
    const now = g.env!.state.time;
    const target = this.animalInFront(reach, (a) => {
      if (!a.alive || (a.tame && a.tame.ridden)) return false;
      const sp = SPECIES[a.speciesId];
      return Math.abs(a.y + sp.hipHeightM * growthScale(a, now) - p.s.y) < sp.hipHeightM * 2 + 2.5;
    });
    if (target) {
      const raw = (def?.damage ?? 4) * g.progression.meleeDamage();
      this.damageAnimal(target, resolveDamage(target, raw, weaponKind(held?.id)));
      g.wearHeld();
      return;
    }
    const n = this.nodeInFront();
    if (n) this.harvest(n);
  }

  private damageAnimal(target: AnimalData, dmg: number): void {
    const g = this.g;
    const p = g.player!;
    const wasAlive = target.alive;
    g.eco!.playerAttack(target, dmg, p.s.x, p.s.z);
    g.hostileUntil = g.env!.state.time + 10;
    if (!target.tame) g.setCompanionTarget(target.id);
    g.audio.sfx('hit', [target.x, target.y + 1, target.z]);
    g.xp('combat', dmg * 0.2);
    if (wasAlive && !target.alive) g.xp('combat', Math.sqrt(SPECIES[target.speciesId].massKg) * 0.5);
  }

  private fireArrow(): void {
    const g = this.g;
    const dir = new THREE.Vector3();
    g.camera.getWorldDirection(dir);
    const p = g.player!;
    const pos = new THREE.Vector3(p.s.x, p.s.y + 1.5, p.s.z).addScaledVector(dir, 0.8);
    const mesh = new THREE.Mesh(arrowGeo, arrowMat);
    g.worldRoot.add(mesh);
    const speed = g.progression.has('archer') ? 55 : 45;
    this.projectiles.push({ mesh, pos, vel: dir.multiplyScalar(speed), damage: (ITEMS.arrow.damage ?? 20) * g.progression.arrowDamage(), life: 4 });
  }

  updateProjectiles(dt: number): void {
    const g = this.g;
    const now = g.env!.state.time;
    const seg = new THREE.Line3();
    const closest = new THREE.Vector3();
    for (const pr of this.projectiles) {
      const prev = pr.pos.clone();
      pr.vel.y -= 9.8 * dt;
      pr.pos.addScaledVector(pr.vel, dt);
      pr.life -= dt;
      pr.mesh.position.copy(pr.pos);
      pr.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), pr.vel.clone().normalize());
      const ground = g.inCave ? CAVE_Y : g.terrain!.height(pr.pos.x, pr.pos.z);
      if (pr.pos.y < ground) pr.life = 0;
      for (const a of g.eco!.active) {
        if (!a.alive || pr.life <= 0 || a.tame) continue;
        const sp = SPECIES[a.speciesId];
        const gs = growthScale(a, now);
        const center = new THREE.Vector3(a.x, a.y + sp.hipHeightM * gs, a.z);
        seg.set(prev, pr.pos);
        seg.closestPointToPoint(center, true, closest);
        if (closest.distanceTo(center) < Math.max(0.4, sp.lengthM * 0.22 * gs)) {
          this.damageAnimal(a, resolveDamage(a, pr.damage, 'arrow'));
          pr.life = 0;
        }
      }
    }
    this.projectiles = this.projectiles.filter((pr) => {
      if (pr.life > 0) return true;
      pr.mesh.removeFromParent();
      return false;
    });
  }

  clear(): void {
    for (const pr of this.projectiles) pr.mesh.removeFromParent();
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
    g.attackCooldown = 0.45;
    g.playerView!.attackSwing();
    const sectors = g.sectors!;
    if (n.kind === 'crate' || n.kind === 'scrap') {
      const loot: ItemList = n.kind === 'crate' ? { metal_scrap: 3, bandage: 2 } : { metal_scrap: 2 };
      if (n.kind === 'crate' && g.rng.chance(0.5)) loot.sulfur = 2;
      if (n.kind === 'crate' && g.rng.chance(0.4)) loot.battery = 1;
      sectors.hitNode(n, now, 99);
      g.audio.sfx('stone');
      this.give(loot);
      g.xp('exploration', 3);
      return;
    }
    const stoneTool = held ? ITEMS[held.id].gather?.stone ?? 0 : 0;
    if (n.kind === 'rubble' || n.kind === 'crystal' || n.kind === 'fossil') {
      const knife = held ? ITEMS[held.id].gather?.meat ?? 0 : 0;
      const ok = n.kind === 'fossil' ? stoneTool >= 3 || knife > 0 : stoneTool >= 3;
      if (!ok) return g.notify('notify.needPickaxe', {}, 'warn');
      g.audio.sfx('stone');
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
    g.audio.sfx(def.tool === 'wood' ? 'chop' : def.tool === 'stone' ? 'stone' : 'pickup', [n.x, n.y + 1, n.z]);
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
    g.playerView!.attackSwing();
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

const USABLE = new Set(['door', 'gate', 'bed', 'storage', 'feeding_trough', 'water_collector', 'well', 'crop_plot', 'nest_box', 'spike_trap', 'snare_trap', 'lamp', 'electric_fence', 'wind_generator']);

/** Which species a fossil belongs to (deterministic from its id). */
export function fossilSpecies(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return SPECIES_IDS[hash2(h, 7, 11) % SPECIES_IDS.length];
}

