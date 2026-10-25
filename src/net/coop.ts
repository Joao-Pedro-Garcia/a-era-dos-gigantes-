import * as THREE from 'three';
import { createAnimal, type AnimalData } from '../animals/animal';
import { SPECIES } from '../animals/species';
import type { RemotePercept } from '../animals/ecosystem';
import { CombatController } from '../combat/actions';
import { Rng } from '../core/rng';
import { PlayerView } from '../player/playerView';
import type { TextureLibrary } from '../graphics/textureLibrary';
import type { WeatherKind } from '../world/environment';
import { NetClient, type NetStatus } from './client';
import { A_ALPHA, A_TAME, ANIMALS_HZ, F_CROUCH, F_DEAD, F_MOUNTED, F_SPRINT, F_SWIM, MAX_ANIMALS_PER_SNAPSHOT, STATE_HZ, type AnimalTuple, type ErrorCode, type PeerInfo, type PlayerState, type ServerMsg } from './protocol';

/**
 * What the co-op session needs from the game (kept narrow so it can be tested with a fake).
 */
export interface CoopHost {
  readonly worldRoot: THREE.Object3D;
  readonly textures: TextureLibrary | null;
  /** Camera, for projecting the name tags onto the screen. */
  readonly camera: THREE.Camera;
  now(): number;
  /** The local player as the network sees it. */
  localState(): PlayerState;
  ground(x: number, z: number): number;
  /** Host: animals to share (active, near the given players). */
  animalsNear(points: { x: number; z: number }[], radius: number): AnimalData[];
  altitude(a: AnimalData): number;
  /** Guest: the ecosystem's animal map and active list (puppets are put there). */
  animals(): Map<string, AnimalData>;
  setActive(list: AnimalData[]): void;
  puppet(a: AnimalData, dt: number, altitude: number): void;
  env(): { time: number; weather: WeatherKind } | null;
  setEnv(time: number, weather: WeatherKind): void;
  /** Host: a guest's blow on an animal. */
  applyHit(animalId: string, dmg: number, fromX: number, fromZ: number): void;
  /** Guest: an animal's blow on the local player. */
  takeDamage(amount: number, speciesId: string, x: number, z: number, knock: [number, number, number] | null): void;
  notify(key: string, params?: Record<string, string | number>, kind?: 'info' | 'warn' | 'good'): void;
  chat(name: string, text: string): void;
  /** Building: every piece of the world (host: sent to late joiners), and remote changes. */
  pieces(): { id: string; type: string; x: number; y: number; z: number; rot: number }[];
  addPiece(id: string, type: string, x: number, y: number, z: number, rot: number): void;
  removePiece(id: string): void;
}

/** A building change on the wire: the piece's world-wide id is `owner:localId`. */
interface BuildData {
  id: string;
  type?: string;
  x?: number;
  y?: number;
  z?: number;
  rot?: number;
}

interface Remote {
  info: PeerInfo;
  view: PlayerView | null;
  label: HTMLElement | null;
  combat: CombatController;
  /** Interpolation buffer: [receive time (s), state]. */
  buf: [number, PlayerState][];
  shown: PlayerState | null;
  stride: number;
  act: number;
  bodyYaw: number;
}

interface Puppet {
  a: AnimalData;
  tx: number;
  ty: number;
  tz: number;
  th: number;
  alt: number;
  seen: number;
}

export type CoopRole = 'host' | 'guest';

/** Interpolation delay for remote players (s): two state packets at STATE_HZ. */
const INTERP_DELAY = 2 / STATE_HZ;
/** A puppet not in any snapshot for this long is removed (ms). */
const PUPPET_TIMEOUT_MS = 5000;
/** Animals within this distance of a guest are sent to it (m). */
const SHARE_RADIUS = 170;

export class CoopSession {
  readonly net: NetClient;
  role: CoopRole;
  me = '';
  code = '';
  seed = 0;
  status: NetStatus = 'connecting';
  error: ErrorCode | string | null = null;
  readonly remotes = new Map<string, Remote>();
  private puppets = new Map<string, Puppet>();
  private sendAcc = 0;
  private animalsAcc = 0;
  private envAcc = 0;
  private clock = 0;
  private welcomed: ((seed: number) => void) | null;
  /** Building messages waiting to be sent (paced below the server's rate limit). */
  private buildQueue: { op: 'place' | 'remove'; data: BuildData }[] = [];
  private buildAcc = 0;
  private rng = new Rng(1);

  constructor(
    private readonly host: CoopHost,
    opts: { url: string; name: string; create?: { seed: number }; join?: { code: string } },
    onWelcome: (seed: number) => void,
  ) {
    this.role = opts.create ? 'host' : 'guest';
    this.welcomed = onWelcome;
    this.net = new NetClient(
      {
        url: opts.url,
        onMessage: (m) => this.onMessage(m),
        onStatus: (s, err) => {
          this.status = s;
          if (err) this.error = err;
          if (s === 'reconnecting') host.notify('coop.reconnecting', {}, 'warn');
          if (s === 'closed' && err) host.notify(`coop.error.${err}`, {}, 'warn');
        },
      },
      opts.create ? { t: 'create', name: opts.name, seed: opts.create.seed } : { t: 'join', name: opts.name, code: opts.join!.code },
    );
  }

  get isHost(): boolean {
    return this.role === 'host';
  }
  get isGuest(): boolean {
    return this.role === 'guest';
  }

  /** Other players, as the ecosystem perceives them (host only). */
  percepts(): RemotePercept[] {
    const out: RemotePercept[] = [];
    for (const r of this.remotes.values()) {
      const s = r.shown;
      if (!s || !r.info.connected) continue;
      const crouch = (s.flags & F_CROUCH) !== 0;
      out.push({ id: r.info.id, x: s.x, z: s.z, alive: (s.flags & F_DEAD) === 0, noiseRadius: crouch ? 6 : s.speed > 5 ? 40 : 18, hostileUntil: 0, visibility: crouch ? 0.5 : 1, running: s.speed > 5, vx: 0, vz: 0, hasFire: false });
    }
    return out;
  }

  sendHit(animalId: string, dmg: number, x: number, z: number): void {
    this.net.send({ t: 'hit', id: animalId, dmg: Math.min(250, Math.max(0, dmg)), x, z });
  }

  sendDamage(to: string, amount: number, a: AnimalData, knock: { dx: number; dz: number; speed: number } | null): void {
    this.net.send({ t: 'damage', to, amount: Math.min(1000, Math.max(0, amount)), species: a.speciesId, x: a.x, z: a.z, knock: knock ? [knock.dx, knock.dz, Math.min(60, knock.speed)] : null });
  }

  chat(text: string): void {
    this.net.send({ t: 'chat', text });
  }

  /** World-wide id of a piece: local pieces get this player's prefix, remote ones keep theirs. */
  netPieceId(localId: string): string {
    return localId.includes(':') ? localId : `${this.me}:${localId}`;
  }

  private localPieceId(netId: string): string {
    return netId.startsWith(`${this.me}:`) ? netId.slice(this.me.length + 1) : netId;
  }

  sendPlace(p: { id: string; type: string; x: number; y: number; z: number; rot: number }): void {
    this.buildQueue.push({ op: 'place', data: { id: this.netPieceId(p.id), type: p.type, x: round(p.x, 3), y: round(p.y, 3), z: round(p.z, 3), rot: round(p.rot, 4) } });
  }

  sendRemove(localId: string): void {
    this.buildQueue.push({ op: 'remove', data: { id: this.netPieceId(localId) } });
  }

  private applyBuild(op: 'place' | 'remove', d: unknown): void {
    if (!d || typeof d !== 'object') return;
    const b = d as BuildData;
    if (typeof b.id !== 'string' || b.id.length > 48) return;
    const id = this.localPieceId(b.id);
    if (op === 'remove') {
      this.host.removePiece(id);
      return;
    }
    const n = (v: unknown, lim: number) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= lim;
    if (typeof b.type !== 'string' || !n(b.x, 20000) || !n(b.y, 5000) || !n(b.z, 20000) || !n(b.rot, 100)) return;
    this.host.addPiece(id, b.type, b.x!, b.y!, b.z!, b.rot!);
  }

  leave(): void {
    this.net.close();
    for (const r of this.remotes.values()) this.disposeRemote(r);
    this.remotes.clear();
    this.puppets.clear();
  }

  // ---------------------------------------------------------------- messages

  private onMessage(m: ServerMsg): void {
    switch (m.t) {
      case 'welcome': {
        this.me = m.you;
        this.code = m.code;
        this.seed = m.seed;
        this.role = m.host ? 'host' : 'guest';
        for (const p of m.peers) this.upsert(p);
        const cb = this.welcomed;
        this.welcomed = null;
        cb?.(m.seed);
        break;
      }
      case 'peer': {
        const known = this.remotes.has(m.peer.id);
        const r = this.upsert(m.peer);
        if (!known) {
          this.host.notify('coop.joined', { name: r.info.name }, 'good');
          // The host brings late joiners up to date with every structure of the world.
          if (this.isHost) for (const p of this.host.pieces()) this.sendPlace(p);
        }
        else if (!m.peer.connected) this.host.notify('coop.dropped', { name: r.info.name }, 'warn');
        break;
      }
      case 'gone': {
        const r = this.remotes.get(m.id);
        if (r) {
          this.host.notify('coop.left', { name: r.info.name });
          this.disposeRemote(r);
          this.remotes.delete(m.id);
        }
        break;
      }
      case 'host': {
        const wasHost = this.isHost;
        this.role = m.id === this.me ? 'host' : 'guest';
        for (const r of this.remotes.values()) r.info.host = r.info.id === m.id;
        if (!wasHost && this.isHost) {
          // Take over the simulation from the last snapshot: the puppets become real animals.
          this.puppets.clear();
          this.host.notify('coop.nowHost', {}, 'info');
        }
        break;
      }
      case 'states':
        for (const [id, s] of m.list) {
          if (id === this.me) continue;
          const r = this.remotes.get(id);
          if (!r) continue;
          r.buf.push([this.clock, s]);
          if (r.buf.length > 12) r.buf.shift();
        }
        break;
      case 'animals':
        if (this.isGuest) this.applyAnimals(m.list);
        break;
      case 'env':
        if (this.isGuest) this.host.setEnv(m.time, m.weather as WeatherKind);
        break;
      case 'hit':
        if (this.isHost) {
          const r = this.remotes.get(m.from);
          const s = r?.shown ?? r?.buf[r.buf.length - 1]?.[1];
          this.host.applyHit(m.id, m.dmg, s?.x ?? m.x, s?.z ?? m.z);
        }
        break;
      case 'damage':
        this.host.takeDamage(m.amount, m.species, m.x, m.z, m.knock);
        break;
      case 'chat':
        this.host.chat(m.name, m.text);
        break;
      case 'build':
        this.applyBuild(m.op, m.data);
        break;
      case 'correct':
        // The server held us back (impossible move): nothing to do but accept it next frame.
        break;
      case 'error':
        this.error = m.code;
        break;
      default:
        break;
    }
  }

  private upsert(p: PeerInfo): Remote {
    let r = this.remotes.get(p.id);
    if (!r) {
      r = { info: p, view: null, label: null, combat: new CombatController(), buf: [], shown: p.state, stride: 0, act: p.state?.act ?? 0, bodyYaw: p.state?.yaw ?? 0 };
      this.remotes.set(p.id, r);
    } else r.info = p;
    if (p.state) r.buf.push([this.clock, p.state]);
    return r;
  }

  // ---------------------------------------------------------------- per frame

  update(dt: number): void {
    this.clock += dt;
    if (this.status !== 'online') return;
    this.sendAcc += dt;
    if (this.sendAcc >= 1 / STATE_HZ) {
      this.sendAcc = 0;
      this.net.send({ t: 'state', s: this.host.localState() });
    }
    if (this.isHost && this.remotes.size) {
      this.animalsAcc += dt;
      if (this.animalsAcc >= 1 / ANIMALS_HZ) {
        this.animalsAcc = 0;
        this.sendAnimals();
      }
      this.envAcc += dt;
      if (this.envAcc >= 2) {
        this.envAcc = 0;
        const e = this.host.env();
        if (e) this.net.send({ t: 'env', time: e.time, weather: e.weather });
      }
    }
    // Building changes at up to 20 a second (bases with hundreds of pieces arrive over a few seconds).
    this.buildAcc = Math.min(this.buildAcc + dt * 20, 20);
    while (this.buildQueue.length && this.buildAcc >= 1) {
      const b = this.buildQueue.shift()!;
      this.net.send({ t: 'build', op: b.op, data: b.data });
      this.buildAcc -= 1;
    }
    if (this.isGuest) this.updatePuppets(dt);
    this.updateRemotes(dt);
  }

  private sendAnimals(): void {
    const points: { x: number; z: number }[] = [];
    for (const r of this.remotes.values()) if (r.shown && r.info.connected) points.push(r.shown);
    if (!points.length) return;
    const list = this.host
      .animalsNear(points, SHARE_RADIUS)
      .slice(0, MAX_ANIMALS_PER_SNAPSHOT)
      .map((a): AnimalTuple => [a.id, a.speciesId, round(a.x), round(a.y), round(a.z), round(a.heading, 3), round(a.speed), a.state, round(a.health), a.alive ? 1 : 0, round(this.host.altitude(a)), a.bornAt, (a.alpha ? A_ALPHA : 0) | (a.tame ? A_TAME : 0)]);
    this.net.send({ t: 'animals', list });
  }

  /** Guest: create/update the puppets from a host snapshot. */
  private applyAnimals(list: AnimalTuple[]): void {
    const map = this.host.animals();
    for (const [id, speciesId, x, y, z, heading, speed, state, health, alive, alt, bornAt, flags] of list) {
      if (!SPECIES[speciesId]) continue;
      let p = this.puppets.get(id);
      if (!p) {
        const a = map.get(id) ?? createAnimal({ id, speciesId, x, z, bornAt, groupId: `net-${id}`, rng: this.rng });
        a.x = x;
        a.y = y;
        a.z = z;
        a.heading = heading;
        map.set(id, a);
        p = { a, tx: x, ty: y, tz: z, th: heading, alt, seen: performance.now() };
        this.puppets.set(id, p);
      }
      const a = p.a;
      p.tx = x;
      p.ty = y;
      p.tz = z;
      p.th = heading;
      p.alt = alt;
      p.seen = performance.now();
      a.speed = speed;
      a.state = state as AnimalData['state'];
      a.health = health;
      a.alive = alive === 1;
      a.bornAt = bornAt;
      a.alpha = (flags & A_ALPHA) !== 0 || undefined;
    }
  }

  private updatePuppets(dt: number): void {
    const map = this.host.animals();
    const k = 1 - Math.exp(-10 * dt);
    const list: AnimalData[] = [];
    for (const [id, p] of this.puppets) {
      if (performance.now() - p.seen > PUPPET_TIMEOUT_MS) {
        // Out of the host's snapshots (far away, despawned or eaten): drop it. Wall time, so a
        // slow frame rate here does not drop animals between snapshots.
        this.puppets.delete(id);
        map.delete(id);
        continue;
      }
      const a = p.a;
      if (Math.hypot(p.tx - a.x, p.tz - a.z) > 30) {
        a.x = p.tx;
        a.z = p.tz;
      } else {
        a.x += (p.tx - a.x) * k;
        a.z += (p.tz - a.z) * k;
      }
      a.y += (p.ty - a.y) * k;
      let dh = p.th - a.heading;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      a.heading += dh * k;
      this.host.puppet(a, dt, p.alt);
      list.push(a);
    }
    this.host.setActive(list);
  }

  private updateRemotes(dt: number): void {
    const renderAt = this.clock - INTERP_DELAY;
    for (const r of this.remotes.values()) {
      const s = this.sample(r, renderAt);
      if (!s) continue;
      r.shown = s;
      if (!r.view) {
        r.view = new PlayerView(this.host.textures ?? undefined);
        this.host.worldRoot.add(r.view.root);
        r.label = nameTag(r.info.name);
      }
      r.view.root.visible = r.info.connected;
      // Body turns smoothly toward the reported facing.
      let dy = s.yaw - r.bodyYaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      r.bodyYaw += dy * (1 - Math.exp(-12 * dt));
      r.stride += (s.speed * dt) / 1.4;
      if (s.act > r.act) r.combat.request(() => {});
      r.act = s.act;
      r.combat.shown = s.held;
      r.combat.update(dt, { pressed: false, held: false, wanted: s.held, hasAmmo: true });
      const g = this.host.ground(s.x, s.z);
      const swim = (s.flags & F_SWIM) !== 0;
      const mock = {
        s: { x: s.x, y: s.y, z: s.z, yaw: r.bodyYaw, pitch: 0 },
        bodyYaw: r.bodyYaw,
        horizontalSpeed: s.speed,
        onGround: !swim && s.y - g < 0.3,
        swimming: swim,
        crouching: (s.flags & F_CROUCH) !== 0,
        sprinting: (s.flags & F_SPRINT) !== 0,
        stride: r.stride,
        visualY: s.y,
        stepLength: () => Math.min(1.6, Math.max(1.1, 1.1 + ((s.speed - 3.3) / 3.1) * 0.5)),
      };
      r.view.update(dt, mock as unknown as Parameters<PlayerView['update']>[1], false, (x, z) => this.host.ground(x, z), r.combat);
      // Mounted players are carried by their animal on the host; dead ones lie down.
      r.view.root.visible = r.info.connected && (s.flags & F_MOUNTED) === 0;
      if (s.flags & F_DEAD) r.view.root.rotation.z = Math.PI / 2;
      else r.view.root.rotation.z = 0;
      this.placeTag(r, s);
    }
  }

  /** Name tag over the head: HTML projected from the world (crisp at any resolution). */
  private placeTag(r: Remote, s: PlayerState): void {
    const el = r.label;
    if (!el) return;
    const cam = this.host.camera;
    tmp.set(s.x, s.y + 2.05, s.z);
    const dist = tmp.distanceTo(cam.position);
    tmp.project(cam);
    const show = r.info.connected && (s.flags & F_MOUNTED) === 0 && tmp.z < 1 && dist < 120 && Math.abs(tmp.x) < 1.1 && Math.abs(tmp.y) < 1.1;
    el.style.display = show ? '' : 'none';
    if (!show) return;
    el.style.transform = `translate(${((tmp.x + 1) / 2) * innerWidth}px, ${((1 - tmp.y) / 2) * innerHeight}px) translate(-50%, -100%)`;
    el.style.opacity = String(Math.max(0.35, 1 - dist / 140));
  }

  /** State at time `t` interpolated from the buffer (holds the latest if packets stop). */
  private sample(r: Remote, t: number): PlayerState | null {
    const b = r.buf;
    if (!b.length) return r.shown;
    while (b.length > 2 && b[1][0] <= t) b.shift();
    if (b.length === 1 || t <= b[0][0]) return b[0][1];
    const [t0, s0] = b[0];
    const [t1, s1] = b[1];
    const u = Math.min(1, Math.max(0, (t - t0) / Math.max(1e-3, t1 - t0)));
    let dy = s1.yaw - s0.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    return { ...s1, x: s0.x + (s1.x - s0.x) * u, y: s0.y + (s1.y - s0.y) * u, z: s0.z + (s1.z - s0.z) * u, yaw: s0.yaw + dy * u, speed: s0.speed + (s1.speed - s0.speed) * u };
  }

  private disposeRemote(r: Remote): void {
    if (r.view) {
      r.view.root.removeFromParent();
      r.view.dispose();
    }
    r.label?.remove();
    r.view = null;
    r.label = null;
  }
}

const round = (v: number, d = 2): number => Math.round(v * 10 ** d) / 10 ** d;

const tmp = new THREE.Vector3();

/** A name tag over a remote player's head (an HTML element in the HUD layer). */
function nameTag(name: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'coop-tag';
  el.textContent = name;
  (document.getElementById('ui') ?? document.body).appendChild(el);
  return el;
}

export { F_CROUCH, F_DEAD, F_MOUNTED, F_SPRINT, F_SWIM };
