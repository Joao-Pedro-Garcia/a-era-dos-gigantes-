import { angleDiff, clamp, damp } from '../core/math';
import type { Terrain } from '../world/terrain';
import { ALPHA, alphaMul, dominance } from '../animals/alpha';
import { type AnimalData, type AIState, effectiveMass, growthScale, lifeStage, maxHealth } from '../animals/animal';
import { HUMAN_MASS, SPECIES, type SpeciesDef, isPredator } from '../animals/species';
import { AQUATIC_MIN_DEPTH, swimDepth } from '../animals/aquatic';
import { dangerAt, nearestMemory, recallSubject, remember } from './memory';
import { canUse } from '../taming/profiles';
import { type ActiveAttack, type AttackMove, type MoveKind, chooseMove, knockback, movesFor, phaseOf, strikeHits, timeScale } from '../combat/dinoAttacks';

/**
 * Animal decision making: utility scoring over needs, perception and memory,
 * with hysteresis so individuals don't flicker between behaviours. Each animal
 * thinks on its own randomized cadence, which de-synchronises herds.
 */
export interface PlayerPercept {
  x: number;
  z: number;
  alive: boolean;
  /** Radius (m) at which the player's noise can be heard by an average listener. */
  noiseRadius: number;
  /** Game time until which the player counts as acting hostile (just attacked). */
  hostileUntil: number;
  /** 0..1 how visible the player is (crouching, night, cover). */
  visibility: number;
  running: boolean;
  /** Mid-dodge (invulnerable to a strike that lands now). */
  dodging?: boolean;
  /** Player velocity (m/s), for predators that lead their target. */
  vx?: number;
  vz?: number;
  /** Torch/campfire in hand or adjacent: deters many animals. */
  hasFire: boolean;
}

export interface Hazard {
  kind: 'fire' | 'eruption';
  x: number;
  z: number;
  r: number;
}

export interface AIWorld {
  now: number;
  isNight: boolean;
  storm: boolean;
  terrain: Terrain;
  player: PlayerPercept;
  predatorBoldness: number;
  hazards: Hazard[];
  neighbors(a: AnimalData, radius: number): AnimalData[];
  get(id: string): AnimalData | undefined;
  groupLeader(groupId: string): AnimalData | undefined;
  forageAt(x: number, z: number): number;
  eatForage(x: number, z: number, amount: number): number;
  blocked(x: number, z: number, r: number): boolean;
  damagePlayer(amount: number, a: AnimalData): void;
  damageAnimal(target: AnimalData, amount: number, attacker: AnimalData): void;
  alarm(a: AnimalData, x: number, z: number, fromPlayer?: boolean): void;
  random(): number;
  /** Unit vector the wind blows toward (for scent). */
  wind?: { x: number; z: number };
  /** Multiplier on flight distances from the player's demeanour (skills). */
  playerCalm?: number;
  /** An animal companions should attack (threatening or fighting the player). */
  companionTarget?: string | null;
  /** Food available in a feeding trough for this tamed animal. */
  troughFood?(a: AnimalData): TroughAccess | null;
  /** Pushes the player (m/s along dx, dz) after a heavy blow. */
  knockPlayer?(dx: number, dz: number, speed: number): void;
  /** Holds the player (constrictor coils, death roll) for some seconds. */
  holdPlayer?(seconds: number, a: AnimalData): void;
  /** Launches a spit projectile at a point (resolved by the game when it arrives). */
  spit?(a: AnimalData, tx: number, tz: number): void;
  /** A blow connected (effects, sound, hit reaction). Target null = the player. */
  strikeLanded?(a: AnimalData, target: AnimalData | null, move: AttackMove, damage: number): void;
  /** The player dodged a blow at the last moment (opens a counter-attack window). */
  playerEvaded?(a: AnimalData, move: AttackMove): void;
  /** An alpha roared (stagger the player, scatter small animals and birds). */
  alphaRoar?(a: AnimalData): void;
  /** Two alphas began / ended a fight (for the player's notice). */
  alphaDuel?(a: AnimalData, b: AnimalData, ended: boolean, winner: AnimalData | null): void;
}

export interface TroughAccess {
  x: number;
  z: number;
  /** Takes one portion; returns hunger relief (0 when empty/unsuitable). */
  eat(): number;
}

export interface RideInput {
  heading: number;
  speed: number;
}

/** Non-persistent per-animal scratch data. */
interface Runtime {
  thinkIn: number;
  threatX: number;
  threatZ: number;
  threatIsPlayer: boolean;
  chaseStart: number;
  altitude: number;
  stride: number;
  peacefulAcc: number;
  trough: TroughAccess | null;
  ride: RideInput | null;
  lastHurtAt: number;
  /** Alpha dominance: the rival being displayed to, until when, and who wins. */
  displayWith: string | null;
  displayUntil: number;
  displayWins: boolean;
  lastDisplayAt: number;
  /** Giving way to an alpha: keep away from it until this time. */
  yieldFrom: string | null;
  yieldUntil: number;
  /** Turning speed (rad/s): eased, so turns start and end smoothly. */
  turnVel: number;
  /** Obstacle avoidance: steer to this side (±1) until the given time. */
  avoidSide: number;
  avoidUntil: number;
  /** Attack in progress (wind-up → strike → recover). */
  atk: ActiveAttack | null;
  lastMove: MoveKind | null;
  /** Interrupted (counter-attacked during a wind-up): no new attack until then. */
  staggerUntil: number;
  /** Hurt mid-fight: the next attack comes sooner (counter-attack) until then. */
  counterUntil: number;
  /** Wounded leg: slower until then. */
  limpUntil: number;
  /** Fighting another alpha (until one gives way). */
  duelWith: string | null;
  duelUntil: number;
  /** Patrol: current angle around the territory centre. */
  patrolAng: number;
}

const PLAYER_ID = '__player__';
const NEED_RATE = 1 / 1200; // fraction per game second (≈ full in one day at rate 1)

export class AnimalBrain {
  private rt = new Map<string, Runtime>();

  runtime(a: AnimalData): Runtime {
    let r = this.rt.get(a.id);
    if (!r) {
      r = { thinkIn: Math.random() * 0.5, threatX: 0, threatZ: 0, threatIsPlayer: false, chaseStart: 0, altitude: 0, stride: 0, peacefulAcc: 0, trough: null, ride: null, lastHurtAt: -1e9, displayWith: null, displayUntil: 0, displayWins: false, lastDisplayAt: -1e9, yieldFrom: null, yieldUntil: 0, turnVel: 0, avoidSide: 0, avoidUntil: 0, atk: null, lastMove: null, staggerUntil: 0, counterUntil: 0, limpUntil: 0, duelWith: null, duelUntil: 0, patrolAng: Math.random() * Math.PI * 2 };
      this.rt.set(a.id, r);
    }
    return r;
  }

  forget(id: string): void {
    this.rt.delete(id);
  }

  /** Strides travelled, used by the renderer so legs follow real displacement. */
  stridePhase(a: AnimalData): number {
    return this.rt.get(a.id)?.stride ?? 0;
  }

  altitude(a: AnimalData): number {
    return this.rt.get(a.id)?.altitude ?? 0;
  }

  /** Player steering input for a ridden animal (null to release). */
  setRide(a: AnimalData, input: RideInput | null): void {
    this.runtime(a).ride = input;
  }

  /**
   * Immediate reaction to a wound: stagger, then flee when badly hurt or
   * retaliate if the species defends itself and the individual is brave.
   */
  onHurt(a: AnimalData, fromX: number, fromZ: number, byPlayer: boolean, now: number): void {
    if (!a.alive) return;
    const sp = SPECIES[a.speciesId];
    const r = this.runtime(a);
    r.threatX = fromX;
    r.threatZ = fromZ;
    r.threatIsPlayer = byPlayer;
    r.lastHurtAt = now;
    if (!r.atk && (a.state === 'hunt' || a.state === 'defend')) r.counterUntil = now + 2.5;
    // Stagger: a small animal is stopped by a blow, a giant barely slows.
    a.speed *= sp.massKg > 3000 ? 0.85 : sp.massKg > 500 ? 0.6 : 0.35;
    if (a.tame) return;
    // Whatever it was doing (grazing, drinking, resting) is interrupted.
    if (a.state === 'graze' || a.state === 'drink' || a.state === 'eat' || a.state === 'rest' || a.state === 'idle' || a.state === 'wander' || a.state === 'nest') this.setState(a, 'alert');
    const ratio = a.health / maxHealth(a, now);
    const brave = (a.personality.courage + a.personality.aggression) / 2;
    if (ratio < 0.3 || (sp.threat.response === 'flee' && ratio < 0.9)) {
      this.setState(a, 'flee');
    } else if (byPlayer && (sp.threat.response === 'charge' || sp.threat.response === 'defend' || sp.threat.response === 'mob') && brave > 0.35 && lifeStage(a, now) !== 'juvenile') {
      a.targetId = PLAYER_ID;
      this.setState(a, 'defend');
    }
  }

  /** Scared off by a flare, fire or loud noise. */
  onScare(a: AnimalData, fromX: number, fromZ: number, now: number): void {
    const r = this.runtime(a);
    r.threatX = fromX;
    r.threatZ = fromZ;
    r.threatIsPlayer = false;
    a.fear = 1;
    remember(a, { kind: 'danger', x: fromX, z: fromZ, strength: 0.8, subject: 'fire' }, now);
    this.setState(a, 'flee');
  }

  setState(a: AnimalData, s: AIState): void {
    if (a.state !== s) {
      const r = this.rt.get(a.id);
      if (r && s !== 'hunt' && s !== 'defend') r.atk = null;
      a.state = s;
      a.stateTime = 0;
    }
  }

  /** Needs drift; shared by active and abstract simulation. */
  static updateNeeds(a: AnimalData, sp: SpeciesDef, dt: number, exertion: number): void {
    const resting = a.state === 'rest';
    a.hunger = clamp(a.hunger + dt * NEED_RATE * 1.1 * sp.foodNeed * (1 + exertion * 0.5), 0, 1);
    a.thirst = clamp(a.thirst + dt * NEED_RATE * 1.6 * sp.waterNeed * (1 + exertion), 0, 1);
    a.fatigue = clamp(a.fatigue + dt * NEED_RATE * (resting ? -4 : 0.9 + exertion * 2), 0, 1);
    a.fear = clamp(a.fear - dt * 0.05, 0, 1);
    a.disease = clamp(a.disease - dt * NEED_RATE * 0.3, 0, 1);
  }

  /** Called every frame for active animals. */
  update(a: AnimalData, w: AIWorld, dt: number): void {
    const sp = SPECIES[a.speciesId];
    const r = this.runtime(a);
    a.stateTime += dt;
    const exertion = a.speed > sp.walkSpeed * 1.4 ? 1 : 0;
    AnimalBrain.updateNeeds(a, sp, dt, exertion);
    this.applyHealth(a, sp, w, dt);
    if (!a.alive) return;

    if (exertion) a.stamina = clamp(a.stamina - dt / sp.stamina, 0, 1);
    else a.stamina = clamp(a.stamina + dt / (sp.stamina * 2.5), 0, 1);

    // Ridden: the rider steers; the animal still tires, hungers and animates.
    if (a.tame?.ridden) {
      this.setState(a, 'ridden');
      const ride = r.ride ?? { heading: a.heading, speed: 0 };
      const speed = a.stamina > 0.05 ? ride.speed : Math.min(ride.speed, sp.walkSpeed);
      this.locomote(a, sp, r, w, dt, a.x + Math.sin(ride.heading) * 20, a.z + Math.cos(ride.heading) * 20, speed, 0, true);
      return;
    }
    // Snared: struggles in place.
    if (a.heldUntil && a.heldUntil > w.now) {
      a.speed = 0;
      a.fear = Math.min(1, a.fear + dt * 0.1);
      this.setState(a, 'alert');
      a.heading += Math.sin(w.now * 7) * dt;
      return;
    }

    // Herd-mates panicking at the player don't stampede an individual that already trusts them.
    if (a.alarmAt > 0 && w.now >= a.alarmAt && a.alarmPlayer && (a.tameProgress > 0.5 || a.habituation > 0.7 || a.tame)) {
      a.alarmAt = -1;
      a.alarmPlayer = false;
      if (!a.tame) this.setState(a, 'alert');
    }
    if (a.alarmAt > 0 && w.now >= a.alarmAt) {
      a.alarmAt = -1;
      a.alarmPlayer = false;
      remember(a, { kind: 'danger', x: a.alarmX, z: a.alarmZ, strength: 0.6 }, w.now);
      a.fear = Math.max(a.fear, 0.7);
      r.threatX = a.alarmX;
      r.threatZ = a.alarmZ;
      r.threatIsPlayer = false;
      if (sp.threat.response === 'flee' || lifeStage(a, w.now) === 'juvenile') this.setState(a, 'flee');
      else this.setState(a, 'alert');
    }

    r.thinkIn -= dt;
    if (r.thinkIn <= 0 && !r.atk) {
      r.thinkIn = 0.25 + w.random() * 0.45;
      this.think(a, sp, r, w);
    }
    this.act(a, sp, r, w, dt);
  }

  private applyHealth(a: AnimalData, sp: SpeciesDef, w: AIWorld, dt: number): void {
    const mh = maxHealth(a, w.now);
    let dmg = 0;
    if (a.hunger >= 1) dmg += mh * 0.004 * dt;
    if (a.thirst >= 1) dmg += mh * 0.006 * dt;
    dmg += a.disease * mh * 0.002 * dt;
    if (dmg > 0) a.health -= dmg;
    else if (a.hunger < 0.6 && a.thirst < 0.6) a.health = Math.min(mh, a.health + mh * 0.002 * dt * (a.state === 'rest' ? 3 : 1));
    if (a.health <= 0 && a.alive) {
      a.alive = false;
      a.diedAt = w.now;
      a.cause = a.thirst >= 1 ? 'thirst' : a.hunger >= 1 ? 'starvation' : 'disease';
      a.meat = effectiveMass(a, w.now) * 0.4;
      void sp;
    }
  }

  // ---------------------------------------------------------------- decisions

  private think(a: AnimalData, sp: SpeciesDef, r: Runtime, w: AIWorld): void {
    const now = w.now;
    const stage = lifeStage(a, now);
    const myMass = effectiveMass(a, now);
    const asleep = a.state === 'rest' && a.stateTime > 4;
    const nightPenalty = w.isNight && sp.activity === 'diurnal' ? 0.45 : w.isNight && sp.activity === 'nocturnal' ? 1.1 : 0.8;
    const sightRange = sp.senses.sight * (asleep ? 0.25 : 1) * (w.isNight ? nightPenalty : 1) * (w.storm ? 0.6 : 1);
    const hearScale = (sp.senses.hearing / 100) * (asleep ? 0.5 : 1) * (w.storm ? 0.5 : 1);

    // --- Hazards (fire, eruptions) always win.
    for (const h of w.hazards) {
      const d = Math.hypot(a.x - h.x, a.z - h.z);
      if (d < h.r + 60) {
        r.threatX = h.x;
        r.threatZ = h.z;
        r.threatIsPlayer = false;
        remember(a, { kind: 'danger', x: h.x, z: h.z, strength: 1, subject: h.kind }, now);
        this.setState(a, 'flee');
        return;
      }
    }

    if (a.tame) {
      this.thinkTame(a, sp, r, w);
      return;
    }

    // --- Badly wounded animals disengage (unless guarding young).
    if (a.health / maxHealth(a, now) < 0.3 && now - r.lastHurtAt < 30 && a.state !== 'flee') {
      const guarding = sp.reproduction.parentalCare > 0.5 && w.neighbors(a, 25).some((o) => o.groupId === a.groupId && lifeStage(o, now) === 'juvenile');
      if (!guarding) {
        this.setState(a, 'flee');
        return;
      }
    }

    // --- Perception of the player.
    const p = w.player;
    const dp = Math.hypot(p.x - a.x, p.z - a.z);
    let seesPlayer = false;
    if (p.alive) {
      const heard = dp < p.noiseRadius * hearScale;
      const angTo = Math.atan2(p.x - a.x, p.z - a.z);
      const inFov = Math.abs(angleDiff(a.heading, angTo)) < ((sp.senses.fovDeg / 2) * Math.PI) / 180;
      const seen = dp < sightRange * p.visibility && (inFov || dp < 8);
      // Scent travels downwind: an animal downwind of the player can smell them.
      let smelled = false;
      if (w.wind && dp > 0.1 && dp < sp.senses.smell * 0.6) {
        const dot = ((a.x - p.x) * w.wind.x + (a.z - p.z) * w.wind.z) / dp;
        smelled = dot > 0.5;
      }
      seesPlayer = heard || seen || smelled;
    }

    // --- Perception of other animals.
    const near = w.neighbors(a, Math.max(sightRange, 40));
    let predatorThreat: AnimalData | null = null;
    let predatorDist = Infinity;
    let groupNear = 0;
    let juvenileNear = false;
    for (const o of near) {
      if (o === a || !o.alive) continue;
      const osp = SPECIES[o.speciesId];
      const d = Math.hypot(o.x - a.x, o.z - a.z);
      if (o.groupId === a.groupId) {
        groupNear++;
        if (lifeStage(o, now) === 'juvenile' && d < 30) juvenileNear = true;
        continue;
      }
      if (o.speciesId === a.speciesId) continue;
      if (isPredator(osp) && !isPredator(sp) || (isPredator(osp) && effectiveMass(o, now) > myMass * 3)) {
        const om = effectiveMass(o, now);
        const dangerous = om > myMass * 0.25 && om < myMass * 60 + 1 && !osp.locomotion.flies;
        const reach = osp.ecology === 'apexPredator' ? 45 : 25;
        const hunting = o.state === 'hunt' && o.targetId === a.id;
        if (dangerous && d < (hunting ? sightRange : reach) && d < predatorDist) {
          predatorThreat = o;
          predatorDist = d;
        }
      }
    }

    // --- Threat from predators.
    if (predatorThreat) {
      r.threatX = predatorThreat.x;
      r.threatZ = predatorThreat.z;
      r.threatIsPlayer = false;
      remember(a, { kind: 'danger', x: a.x, z: a.z, strength: 0.4, subject: predatorThreat.speciesId }, now);
      a.fear = Math.min(1, a.fear + 0.4);
      const big = myMass > 2500 && stage === 'adult';
      const bold = a.personality.courage > 0.55 || juvenileNear;
      if ((sp.threat.response === 'defend' || sp.threat.response === 'charge') && (big || bold) && predatorDist < 25) {
        a.targetId = predatorThreat.id;
        this.setState(a, 'defend');
      } else if (!big) {
        if (a.state !== 'flee') w.alarm(a, predatorThreat.x, predatorThreat.z);
        this.setState(a, 'flee');
      } else {
        this.setState(a, 'alert');
      }
      return;
    }

    // --- Reaction to the player.
    if (seesPlayer) {
      const reaction = this.reactToPlayer(a, sp, r, w, dp, juvenileNear, groupNear);
      if (reaction) return;
    } else if (a.state === 'flee' && r.threatIsPlayer && a.stateTime > 4) {
      this.setState(a, 'alert');
    }

    // Keep fleeing until clear.
    if (a.state === 'flee') {
      const dt = Math.hypot(a.x - r.threatX, a.z - r.threatZ);
      if (dt < 70 && a.stateTime < 12) return;
      this.setState(a, 'alert');
    }
    if ((a.state === 'defend' || a.state === 'hunt' || a.state === 'eat') && this.continueEngagement(a, sp, r, w)) return;

    // --- Dominance among adult males: alphas display, rivals give way (never a fight to the death).
    if (stage === 'adult' && a.sex === 'm' && this.dominance(a, sp, r, w, near)) return;

    // --- Storm shelter.
    if (w.storm && !sp.locomotion.flies && a.state !== 'shelter' && w.random() < 0.15 && stage !== 'adult') {
      this.setState(a, 'shelter');
      a.tx = a.homeX;
      a.tz = a.homeZ;
      return;
    }

    // --- Needs.
    const needsDrink = a.thirst > 0.5;
    const needsFood = a.hunger > (isPredator(sp) ? 0.45 : 0.35);
    const tired = a.fatigue > 0.8 || (a.fatigue > 0.35 && isAsleepTime(sp, w.isNight));

    if (a.state === 'drink' && a.thirst > 0.05) return;
    if (a.state === 'graze' && a.hunger > 0.08 && a.stateTime < 120) return;
    if (a.state === 'rest' && a.fatigue > 0.05 && !(needsDrink && a.thirst > 0.85)) return;

    if (needsDrink && (a.thirst > a.hunger || !needsFood)) {
      if (this.findWater(a, sp, w)) {
        this.setState(a, 'drink');
        return;
      }
    }
    if (needsFood) {
      if (isPredator(sp)) {
        if (this.chooseHuntTarget(a, sp, r, w, near)) return;
      } else {
        this.chooseForage(a, w);
        this.setState(a, 'graze');
        return;
      }
    }
    if (tired) {
      this.setState(a, 'rest');
      return;
    }

    // --- Social cohesion: stay near leader / parent.
    const leaderId = a.parentId && stage === 'juvenile' ? a.parentId : null;
    const leader = (leaderId && w.get(leaderId)) || w.groupLeader(a.groupId);
    if (leader && leader !== a && leader.alive) {
      const d = Math.hypot(leader.x - a.x, leader.z - a.z);
      const spacing = 6 + sp.lengthM * (1.2 + (1 - a.personality.sociability));
      if (d > spacing * 2.5) {
        this.setState(a, 'follow');
        a.targetId = leader.id;
        return;
      }
    }

    if (a.state === 'wander' && Math.hypot(a.tx - a.x, a.tz - a.z) > 3 && a.stateTime < 40) return;
    if (a.state === 'investigate' && a.stateTime < 15) return;
    // Alphas patrol their territory: a slow round of waypoints around its centre,
    // pausing now and then to watch (and roar at what they see).
    if (a.alpha && !a.tame && stage === 'adult' && !(leader && leader !== a && leader.alive && Math.hypot(leader.x - a.x, leader.z - a.z) > 40)) {
      if (w.random() < 0.2) {
        this.setState(a, 'idle');
        return;
      }
      const R = Math.min(sp.territory.radius, 250) * 0.6;
      r.patrolAng += 0.7 + w.random() * 0.4;
      a.tx = a.homeX + Math.sin(r.patrolAng) * R;
      a.tz = a.homeZ + Math.cos(r.patrolAng) * R;
      this.setState(a, 'wander');
      return;
    }
    if (w.random() < 0.35) {
      this.setState(a, 'idle');
    } else {
      this.pickWanderTarget(a, sp, w, leader && leader !== a ? leader : null);
      this.setState(a, 'wander');
    }
  }

  /**
   * Alpha males roar at rival males of their species from other groups, who
   * give way; two alphas display to each other for a few seconds, then the
   * weaker one retreats. Returns true when this decided the animal's action.
   */
  private dominance(a: AnimalData, sp: SpeciesDef, r: Runtime, w: AIWorld, near: AnimalData[]): boolean {
    const now = w.now;
    const range = ALPHA.rivalRange + sp.lengthM;
    if (r.yieldUntil > now) {
      const o = r.yieldFrom ? w.get(r.yieldFrom) : undefined;
      if (!o || !o.alive || Math.hypot(o.x - a.x, o.z - a.z) > range * 2) return false;
      if (a.state !== 'wander' || Math.hypot(a.tx - a.x, a.tz - a.z) < 3) {
        const ang = Math.atan2(a.x - o.x, a.z - o.z) + (w.random() - 0.5) * 0.6;
        a.tx = a.x + Math.sin(ang) * (30 + sp.lengthM * 2);
        a.tz = a.z + Math.cos(ang) * (30 + sp.lengthM * 2);
        this.setState(a, 'wander');
      }
      return true;
    }
    if (r.displayWith) {
      const o = w.get(r.displayWith);
      if (!o || !o.alive || (a.state !== 'alert' && a.state !== 'idle')) r.displayWith = null;
      else {
        r.threatX = o.x;
        r.threatZ = o.z;
        r.threatIsPlayer = false;
        this.setState(a, 'alert');
        a.stateTime = Math.min(a.stateTime, 3);
        if (now >= r.displayUntil) {
          r.displayWith = null;
          const ro = this.runtime(o);
          // Two bold alphas come to blows; otherwise the weaker one gives way.
          const bold = a.alpha && o.alpha && a.personality.aggression + o.personality.aggression > 1.05 && lifeStage(o, now) === 'adult';
          if (bold && !r.duelWith && !ro.duelWith) {
            for (const [x, y, rx] of [[a, o, r], [o, a, ro]] as const) {
              rx.duelWith = y.id;
              rx.duelUntil = now + 90;
              rx.displayWith = null;
              x.targetId = y.id;
              this.setState(x, 'defend');
            }
            w.alphaDuel?.(a, o, false, null);
          } else if (r.displayWins) this.setState(a, 'idle');
          else this.yieldTo(a, o, now);
        }
        return true;
      }
    }
    for (const o of near) {
      if (o === a || !o.alive || o.speciesId !== a.speciesId || o.sex !== 'm' || o.tame || o.groupId === a.groupId) continue;
      if ((!a.alpha && !o.alpha) || lifeStage(o, now) !== 'adult') continue;
      if (Math.hypot(o.x - a.x, o.z - a.z) > range) continue;
      if (!a.alpha) {
        this.yieldTo(a, o, now);
        return true;
      }
      const ro = this.runtime(o);
      if (o.alpha) {
        if (now - r.lastDisplayAt < 30 || now - ro.lastDisplayAt < 30 || ro.yieldUntil > now || o.state === 'flee' || o.state === 'hunt') continue;
        // Both display; the outcome is settled now so the two never disagree.
        const wins = dominance(a, maxHealth(a, now)) >= dominance(o, maxHealth(o, now));
        for (const [x, y, rx, win] of [[a, o, r, wins], [o, a, ro, !wins]] as const) {
          rx.displayWith = y.id;
          rx.displayUntil = now + ALPHA.displayTime;
          rx.displayWins = win;
          rx.lastDisplayAt = now;
          rx.threatX = y.x;
          rx.threatZ = y.z;
          rx.threatIsPlayer = false;
          this.setState(x, 'alert');
        }
        return true;
      }
      // An ordinary rival: a dominance roar now and then, then carry on.
      if (now - r.lastDisplayAt > 25) {
        r.lastDisplayAt = now;
        r.threatX = o.x;
        r.threatZ = o.z;
        r.threatIsPlayer = false;
        this.setState(a, 'alert');
        return true;
      }
    }
    return false;
  }

  private yieldTo(a: AnimalData, o: AnimalData, now: number): void {
    const r = this.runtime(a);
    r.yieldFrom = o.id;
    r.yieldUntil = now + ALPHA.yieldTime;
    r.displayWith = null;
    a.tx = a.x;
    a.tz = a.z;
    this.setState(a, 'idle');
  }

  /**
   * Tamed animals: same needs and fears as wild ones, but their routine is
   * organised around the player's commands and base (troughs, anchors).
   */
  private thinkTame(a: AnimalData, sp: SpeciesDef, r: Runtime, w: AIWorld): void {
    const t = a.tame!;
    const now = w.now;
    const stage = lifeStage(a, now);
    const myMass = effectiveMass(a, now);
    const p = w.player;
    const dp = Math.hypot(p.x - a.x, p.z - a.z);
    const fighter = (canUse(a.speciesId, 'companion') || canUse(a.speciesId, 'guard')) && stage !== 'juvenile' && a.personality.courage + t.bond * 0.3 > 0.4;

    if (a.state === 'flee' && a.stateTime < 5) return;
    if (a.state === 'defend' && this.continueEngagement(a, sp, r, w)) return;

    // Help the player in a fight.
    const ct = w.companionTarget ? w.get(w.companionTarget) : undefined;
    if (fighter && ct && ct.alive && !ct.tame && Math.hypot(ct.x - a.x, ct.z - a.z) < 45) {
      a.targetId = ct.id;
      this.setState(a, 'defend');
      return;
    }
    // Wild predators nearby: defend (guards, brave fighters) or run.
    let threat: AnimalData | null = null;
    let td = Infinity;
    for (const o of w.neighbors(a, 40)) {
      if (o === a || !o.alive || o.tame) continue;
      if (!isPredator(SPECIES[o.speciesId]) || effectiveMass(o, now) < myMass * 0.3) continue;
      const d = Math.hypot(o.x - a.x, o.z - a.z);
      const hunting = o.state === 'hunt' && (o.targetId === a.id || o.targetId === PLAYER_ID);
      const nearAnchor = t.command === 'guard' && Math.hypot(o.x - t.anchorX, o.z - t.anchorZ) < 30;
      if ((d < 18 || hunting || nearAnchor) && d < td) {
        threat = o;
        td = d;
      }
    }
    if (threat) {
      if (fighter && effectiveMass(threat, now) < myMass * 4 && (t.command === 'guard' || threat.state === 'hunt')) {
        a.targetId = threat.id;
        this.setState(a, 'defend');
      } else {
        r.threatX = threat.x;
        r.threatZ = threat.z;
        r.threatIsPlayer = false;
        this.setState(a, 'flee');
      }
      return;
    }

    // Needs first: tamed animals are not machines.
    if (a.state === 'drink' && a.thirst > 0.05) return;
    if (a.state === 'graze' && a.hunger > 0.08 && a.stateTime < 60) return;
    if (a.state === 'eat' && this.continueEngagement(a, sp, r, w)) return;
    if (a.thirst > 0.6 && this.findWater(a, sp, w)) {
      this.setState(a, 'drink');
      return;
    }
    if (a.hunger > 0.5) {
      const tr = w.troughFood?.(a) ?? null;
      if (tr) {
        r.trough = tr;
        a.tx = tr.x;
        a.tz = tr.z;
        this.setState(a, 'graze');
        return;
      }
      if (!isPredator(sp)) {
        this.chooseForage(a, w);
        this.setState(a, 'graze');
        return;
      }
      if (t.command !== 'stay' && this.chooseHuntTarget(a, sp, r, w, w.neighbors(a, sp.senses.sight))) return;
    }
    const playerFar = t.command === 'follow' && dp > 15;
    if (a.state === 'rest' && a.fatigue > 0.1 && !playerFar) return;
    if (a.fatigue > 0.85 && !playerFar) {
      this.setState(a, 'rest');
      return;
    }

    // Commands (individuals with little training sometimes wander off).
    const restless = t.obedience < 0.3 && w.random() < 0.05;
    if (t.command === 'follow' && p.alive && !restless) {
      if (dp > 3 + sp.lengthM * 0.6) {
        a.targetId = PLAYER_ID;
        this.setState(a, 'follow');
      } else if (a.state !== 'idle') this.setState(a, 'idle');
      return;
    }
    const radius = t.command === 'stay' ? (restless ? 10 : 2) : 18;
    const da = Math.hypot(a.x - t.anchorX, a.z - t.anchorZ);
    if (t.command === 'stay' && da < 3 && !restless) {
      if (a.state !== 'idle') this.setState(a, 'idle');
      return;
    }
    if (a.state === 'wander' && Math.hypot(a.tx - a.x, a.tz - a.z) > 2 && a.stateTime < 30) return;
    if (da > radius || w.random() < 0.4) {
      const ang = w.random() * Math.PI * 2;
      const d = Math.sqrt(w.random()) * radius;
      a.tx = t.anchorX + Math.sin(ang) * d;
      a.tz = t.anchorZ + Math.cos(ang) * d;
      this.setState(a, 'wander');
    } else this.setState(a, 'idle');
  }

  private reactToPlayer(a: AnimalData, sp: SpeciesDef, r: Runtime, w: AIWorld, dp: number, juvenileNear: boolean, groupNear: number): boolean {
    const now = w.now;
    const p = w.player;
    const myMass = effectiveMass(a, now);
    const threatMem = recallSubject(a, 'threat', 'player', now) + recallSubject(a, 'injured', 'player', now) * 1.5;
    const hostileNow = now < p.hostileUntil;
    const stage = lifeStage(a, now);

    let flight = sp.threat.flightDistance * a.personality.flightiness;
    flight *= 1 + Math.min(2.5, threatMem * 0.6);
    flight *= 1 - 0.65 * a.habituation;
    flight *= 1 - 0.3 * Math.max(0, a.trustPlayer);
    if (hostileNow) flight *= 1.8;
    if (p.running) flight *= 1.3;
    if (stage === 'juvenile') flight = Math.max(flight, 12) * 1.3;
    if (p.hasFire && !isPredator(sp)) flight *= 1.2;
    flight *= w.playerCalm ?? 1;
    // Growing trust (taming) and a calm, crouched approach let the player come close enough to offer food.
    flight *= Math.pow(1 - a.tameProgress, 1.5);
    if (p.visibility < 0.75 && !hostileNow) flight *= 0.75;
    // A mostly-trusting animal no longer startles at a calm player brushing past it.
    if (a.tameProgress > 0.5 && !hostileNow && !p.running) flight = 0;

    // Predators: is the player food?
    // A marine predator only notices a player who is in the water.
    if (sp.locomotion.aquatic && w.terrain.height(p.x, p.z) > -1.2) return false;
    if (isPredator(sp) && sp.huntsHumans && stage !== 'juvenile') {
      const mass = myMass;
      const pack = sp.social.type === 'pack' ? Math.max(1, groupNear + 1) : 1;
      const canTake = mass * pack > HUMAN_MASS * 0.6;
      const caution = recallSubject(a, 'injured', 'player', now) * 0.5 + recallSubject(a, 'chaseFailed', 'player', now) * 0.3;
      const fireFear = p.hasFire ? 0.35 : 0;
      const motivation = a.hunger * w.predatorBoldness * (0.5 + a.personality.aggression) - caution - fireFear;
      if (canTake && motivation > 0.45 && a.state !== 'hunt') {
        a.targetId = PLAYER_ID;
        r.chaseStart = now;
        this.setState(a, 'hunt');
        return true;
      }
      // Territorial warning for big predators when the player intrudes closely.
      if (sp.territory.defends && dp < 12 + sp.lengthM && mass > 500 && a.state !== 'hunt') {
        if (a.state === 'alert' && a.stateTime > 2.5 || hostileNow) {
          a.targetId = PLAYER_ID;
          this.setState(a, 'defend');
        } else this.setState(a, 'alert');
        return true;
      }
      if (sp.threat.flightDistance <= 0) return false;
    }

    if (sp.threat.flightDistance <= 0) return false;

    if (dp < flight) {
      r.threatX = p.x;
      r.threatZ = p.z;
      r.threatIsPlayer = true;
      a.fear = Math.min(1, a.fear + 0.3);
      const resp = sp.threat.response;
      const brave = (a.personality.courage + a.personality.aggression) / 2;
      const cornered = a.stamina < 0.2;
      const protect = juvenileNear && SPECIES[a.speciesId].reproduction.parentalCare > 0.4;
      if (stage !== 'juvenile' && (resp === 'charge' || resp === 'defend') && (brave > 0.45 || protect || cornered || (hostileNow && brave > 0.3)) && dp < flight * 0.7) {
        a.targetId = PLAYER_ID;
        this.setState(a, 'defend');
      } else if (resp === 'mob' && groupNear >= 2 && brave > 0.45 && stage !== 'juvenile') {
        a.targetId = PLAYER_ID;
        this.setState(a, 'defend');
      } else if (resp === 'freeze' && !hostileNow) {
        this.setState(a, 'alert');
      } else {
        if (a.state !== 'flee') {
          w.alarm(a, p.x, p.z, true);
          if (hostileNow || threatMem > 0.5) remember(a, { kind: 'danger', x: p.x, z: p.z, strength: 0.3, subject: 'player' }, now);
        }
        this.setState(a, 'flee');
      }
      return true;
    }

    // Player is perceived but outside flight distance: watch, maybe approach, habituate.
    if (dp < flight * 2.5 + 20) {
      if (!hostileNow) {
        a.habituation = clamp(a.habituation + 0.004 * a.personality.tolerance, 0, 1);
        r.peacefulAcc += 1;
        if (r.peacefulAcc > 40) {
          r.peacefulAcc = 0;
          remember(a, { kind: 'peaceful', x: a.x, z: a.z, strength: 0.3, subject: 'player' }, now);
          a.trustPlayer = clamp(a.trustPlayer + 0.02, -1, 1);
        }
      }
      if (a.state === 'graze' || a.state === 'drink' || a.state === 'rest') {
        // Vigilance: briefly look up, then carry on.
        if (w.random() < 0.25 * (1 - a.habituation)) {
          this.setState(a, 'alert');
          return true;
        }
        return false;
      }
      if (a.personality.curiosity > 0.6 && threatMem < 0.3 && w.random() < 0.3) {
        const ang = Math.atan2(a.x - p.x, a.z - p.z);
        const keep = flight * 1.4 + 4;
        a.tx = p.x + Math.sin(ang) * keep;
        a.tz = p.z + Math.cos(ang) * keep;
        this.setState(a, 'investigate');
        return true;
      }
    }
    return false;
  }

  private continueEngagement(a: AnimalData, sp: SpeciesDef, r: Runtime, w: AIWorld): boolean {
    const now = w.now;
    if (a.state === 'eat') {
      const c = a.targetId ? w.get(a.targetId) : undefined;
      if (c && !c.alive && c.meat > 0 && a.hunger > 0.05) return true;
      a.targetId = null;
      return false;
    }
    const isPlayer = a.targetId === PLAYER_ID;
    const target = isPlayer ? null : a.targetId ? w.get(a.targetId) : undefined;
    if (!isPlayer && !target) return false;
    if (target && !target.alive) {
      if (a.state === 'hunt' || (isPredator(sp) && a.hunger > 0.2)) {
        this.setState(a, 'eat');
        return true;
      }
      return false;
    }
    if (isPlayer && !w.player.alive) return false;
    const tx = isPlayer ? w.player.x : target!.x;
    const tz = isPlayer ? w.player.z : target!.z;
    const d = Math.hypot(tx - a.x, tz - a.z);
    if (a.state === 'defend' && r.duelWith && target && r.duelWith === target.id) {
      // Alpha fight: until one is beaten (never to the death) or both tire.
      const mine = a.health / Math.max(1, maxHealth(a, now));
      const theirs = target.health / Math.max(1, maxHealth(target, now));
      if (mine < 0.45 || theirs < 0.45 || now > r.duelUntil || d > 60) {
        const loser = mine <= theirs ? a : target;
        const winner = loser === a ? target : a;
        for (const x of [a, target]) {
          const rx = this.runtime(x);
          rx.duelWith = null;
          rx.atk = null;
          x.targetId = null;
        }
        this.yieldTo(loser, winner, now);
        loser.fear = 1;
        this.setState(winner, 'alert');
        w.alphaDuel?.(winner, loser, true, winner);
      }
      return true;
    }
    if (a.state === 'defend') {
      if (a.stateTime > 7 || d > 40) {
        // Disengage: back away a little; the episode stays in memory.
        if (isPlayer) remember(a, { kind: 'threat', x: tx, z: tz, strength: 0.4, subject: 'player' }, now);
        r.threatX = tx;
        r.threatZ = tz;
        r.threatIsPlayer = isPlayer;
        this.setState(a, sp.threat.response === 'flee' || sp.threat.response === 'mob' ? 'flee' : 'alert');
      }
      return true;
    }
    // Hunting: give up when exhausted or the target outruns us.
    if (a.stamina < 0.06 || d > sp.senses.sight * 1.2 || now - r.chaseStart > 60) {
      remember(a, { kind: 'chaseFailed', x: a.x, z: a.z, strength: 0.7, subject: isPlayer ? 'player' : target!.speciesId }, now);
      a.fatigue = clamp(a.fatigue + 0.15, 0, 1);
      a.targetId = null;
      this.setState(a, 'rest');
      return true;
    }
    return true;
  }

  private chooseHuntTarget(a: AnimalData, sp: SpeciesDef, r: Runtime, w: AIWorld, near: AnimalData[]): boolean {
    const now = w.now;
    const myMass = effectiveMass(a, now);
    const pack = sp.social.type === 'pack' || sp.social.type === 'flock';
    const groupSize = pack ? 1 + near.filter((o) => o.groupId === a.groupId && o.alive).length : 1;
    const maxPrey = myMass * (pack ? groupSize * 1.5 : 1.1);
    const minPrey = myMass * 0.004;
    let best: AnimalData | null = null;
    let bestScore = 0;
    for (const o of near) {
      if (o === a || o.groupId === a.groupId || (a.tame && o.tame)) continue;
      const osp = SPECIES[o.speciesId];
      const d = Math.hypot(o.x - a.x, o.z - a.z);
      if (!o.alive) {
        if (o.meat > 0) {
          const s = 2 / (1 + d / 60);
          if (s > bestScore) {
            bestScore = s;
            best = o;
          }
        }
        continue;
      }
      if (osp.id === a.speciesId || osp.locomotion.flies && !(sp.diet === 'piscivore')) continue;
      // A marine predator can only take what is in the water; land animals only on the hunt in it.
      if (sp.locomotion.aquatic && w.terrain.height(o.x, o.z) > -1.2) continue;
      if (isPredator(osp) && effectiveMass(o, now) > myMass * 0.5) continue;
      if (sp.diet === 'piscivore' && osp.massKg > 300) continue;
      const om = effectiveMass(o, now);
      if (om > maxPrey || om < minPrey) continue;
      let s = 1 / (1 + d / 50);
      if (lifeStage(o, now) === 'juvenile') s *= 1.8;
      s *= 1.5 - o.health / maxHealth(o, now);
      s /= 1 + recallSubject(a, 'chaseFailed', o.speciesId, now) * 0.8;
      s *= 1 + recallSubject(a, 'chaseWon', o.speciesId, now) * 0.2;
      if (s > bestScore) {
        bestScore = s;
        best = o;
      }
    }
    if (best) {
      a.targetId = best.id;
      r.chaseStart = now;
      this.setState(a, best.alive ? 'hunt' : 'eat');
      return true;
    }
    // Nothing perceived: patrol the territory (scent trails), favouring remembered hunting grounds.
    const food = nearestMemory(a, 'chaseWon', a.x, a.z, now) ?? nearestMemory(a, 'food', a.x, a.z, now);
    if (food && w.random() < 0.5) {
      a.tx = food.x + (w.random() - 0.5) * 60;
      a.tz = food.z + (w.random() - 0.5) * 60;
    } else this.pickWanderTarget(a, sp, w, null, 2);
    this.setState(a, 'wander');
    return true;
  }

  private chooseForage(a: AnimalData, w: AIWorld): void {
    let bx = a.x;
    let bz = a.z;
    let bs = -Infinity;
    const mem = nearestMemory(a, 'food', a.x, a.z, w.now);
    const candidates: [number, number][] = [];
    for (let i = 0; i < 6; i++) {
      const ang = w.random() * Math.PI * 2;
      const d = 10 + w.random() * 50;
      candidates.push([a.x + Math.sin(ang) * d, a.z + Math.cos(ang) * d]);
    }
    if (mem) candidates.push([mem.x, mem.z]);
    for (const [x, z] of candidates) {
      if (w.terrain.height(x, z) < -0.3) continue;
      const s = w.forageAt(x, z) - dangerAt(a, x, z, w.now) * 0.5 - Math.hypot(x - a.x, z - a.z) / 400;
      if (s > bs) {
        bs = s;
        bx = x;
        bz = z;
      }
    }
    a.tx = bx;
    a.tz = bz;
  }

  private findWater(a: AnimalData, sp: SpeciesDef, w: AIWorld): boolean {
    const mem = nearestMemory(a, 'water', a.x, a.z, w.now);
    if (mem && Math.hypot(mem.x - a.x, mem.z - a.z) < 1500) {
      a.tx = mem.x;
      a.tz = mem.z;
      return true;
    }
    const range = Math.min(400, sp.senses.sight * 2);
    for (let d = 20; d <= range; d += 25) {
      for (let k = 0; k < 12; k++) {
        const ang = (k / 12) * Math.PI * 2 + d * 0.01;
        const x = a.x + Math.sin(ang) * d;
        const z = a.z + Math.cos(ang) * d;
        if (w.terrain.height(x, z) < -0.25 && w.terrain.continentMask(x, z) > 0.85) {
          remember(a, { kind: 'water', x, z, strength: 1 }, w.now);
          a.tx = x;
          a.tz = z;
          return true;
        }
      }
    }
    return false;
  }

  private pickWanderTarget(a: AnimalData, sp: SpeciesDef, w: AIWorld, leader: AnimalData | null, rangeMul = 1): void {
    const cx = leader ? leader.x : a.homeX;
    const cz = leader ? leader.z : a.homeZ;
    const radius = leader ? 15 + sp.lengthM * 2 : Math.min(sp.territory.radius, 250) * rangeMul;
    let bx = a.x;
    let bz = a.z;
    let bs = -Infinity;
    for (let i = 0; i < 4; i++) {
      const ang = w.random() * Math.PI * 2;
      const d = Math.sqrt(w.random()) * radius;
      const x = cx + Math.sin(ang) * d;
      const z = cz + Math.cos(ang) * d;
      const h = w.terrain.height(x, z);
      if (h < -0.3 && !sp.locomotion.swims && !sp.locomotion.flies) continue;
      if (sp.locomotion.aquatic && h > AQUATIC_MIN_DEPTH) continue;
      const s = -dangerAt(a, x, z, w.now) + w.random() * 0.5;
      if (s > bs) {
        bs = s;
        bx = x;
        bz = z;
      }
    }
    a.tx = bx;
    a.tz = bz;
  }

  // ---------------------------------------------------------------- actions & locomotion

  private act(a: AnimalData, sp: SpeciesDef, r: Runtime, w: AIWorld, dt: number): void {
    const now = w.now;
    const g = growthScale(a, now);
    const injured = a.health / maxHealth(a, now) < 0.35 ? 0.6 : 1;
    const fast = alphaMul(a, 'speed');
    const walk = sp.walkSpeed * (0.55 + 0.45 * g) * injured * fast;
    const run = sp.runSpeed * (0.55 + 0.45 * g) * injured * (a.stamina > 0.08 ? 1 : 0.45) * fast;
    let tx = a.tx;
    let tz = a.tz;
    let targetSpeed = 0;
    let wantAlt = 0;

    switch (a.state) {
      case 'idle':
      case 'rest':
        targetSpeed = 0;
        break;
      case 'alert': {
        targetSpeed = 0;
        tx = r.threatX;
        tz = r.threatZ;
        if (a.stateTime > 6) this.setState(a, 'idle');
        break;
      }
      case 'wander':
      case 'shelter':
      case 'investigate':
        targetSpeed = Math.hypot(tx - a.x, tz - a.z) > 2 ? walk : 0;
        if (sp.locomotion.flies && a.state === 'wander') wantAlt = 25 + (a.id.charCodeAt(a.id.length - 1) % 5) * 8;
        if (a.state === 'investigate' && targetSpeed === 0) {
          tx = w.player.x;
          tz = w.player.z;
        }
        break;
      case 'follow': {
        if (a.targetId === PLAYER_ID) {
          tx = w.player.x;
          tz = w.player.z;
          const d = Math.hypot(tx - a.x, tz - a.z);
          const spacing = 3 + sp.lengthM * 0.6;
          targetSpeed = d > spacing * 4 ? run : d > spacing ? walk * 1.3 : 0;
          if (sp.locomotion.flies) wantAlt = d > 20 ? 20 : 8;
          if (targetSpeed === 0 && !sp.locomotion.flies) this.setState(a, 'idle');
          break;
        }
        const l = a.targetId ? w.get(a.targetId) : undefined;
        if (!l) {
          this.setState(a, 'idle');
          break;
        }
        tx = l.x;
        tz = l.z;
        const d = Math.hypot(tx - a.x, tz - a.z);
        targetSpeed = d > 40 ? run * 0.6 : d > 8 + sp.lengthM ? walk * 1.2 : 0;
        if (sp.locomotion.flies) wantAlt = this.altitude(l);
        if (targetSpeed === 0) this.setState(a, 'idle');
        break;
      }
      case 'graze': {
        const d = Math.hypot(tx - a.x, tz - a.z);
        if (d > 2.5 + (r.trough ? sp.lengthM * 0.4 : 0)) targetSpeed = walk;
        else if (r.trough) {
          const got = r.trough.eat();
          a.hunger = clamp(a.hunger - got, 0, 1);
          if (got <= 0 || a.hunger < 0.08) {
            r.trough = null;
            this.setState(a, 'idle');
          }
        } else {
          const eaten = w.eatForage(a.x, a.z, dt * 0.02 * sp.foodNeed);
          a.hunger = clamp(a.hunger - eaten * 1.6, 0, 1);
          if (eaten < dt * 0.002) this.chooseForage(a, w);
          else if (w.random() < dt * 0.02) remember(a, { kind: 'food', x: a.x, z: a.z, strength: 0.3 }, now);
          if (a.hunger < 0.06) this.setState(a, 'idle');
        }
        break;
      }
      case 'drink': {
        const d = Math.hypot(tx - a.x, tz - a.z);
        const atWater = w.terrain.height(a.x + Math.sin(a.heading) * (sp.lengthM * 0.4 + 1), a.z + Math.cos(a.heading) * (sp.lengthM * 0.4 + 1)) < 0;
        if (d > sp.lengthM * 0.5 + 2 && !atWater) targetSpeed = a.thirst > 0.85 ? run * 0.6 : walk;
        else {
          a.thirst = clamp(a.thirst - dt * 0.08, 0, 1);
          if (a.thirst < 0.03) this.setState(a, 'idle');
        }
        if (a.stateTime > 150) this.setState(a, 'idle');
        break;
      }
      case 'flee': {
        const ang = Math.atan2(a.x - r.threatX, a.z - r.threatZ);
        tx = a.x + Math.sin(ang) * 30;
        tz = a.z + Math.cos(ang) * 30;
        targetSpeed = run;
        if (sp.locomotion.flies) wantAlt = 45;
        break;
      }
      case 'hunt':
      case 'defend': {
        const isPlayer = a.targetId === PLAYER_ID;
        const t = isPlayer ? null : a.targetId ? w.get(a.targetId) : undefined;
        if (!isPlayer && !t) {
          this.setState(a, 'idle');
          break;
        }
        tx = isPlayer ? w.player.x : t!.x;
        tz = isPlayer ? w.player.z : t!.z;
        const d = Math.hypot(tx - a.x, tz - a.z);
        // Alphas chase tactically: they run for where the player is going, not
        // where the player is (cutting corners instead of trailing behind).
        if (a.alpha && isPlayer && d > 8 && !r.atk) {
          const lead = Math.min(2.5, d / Math.max(1, sp.runSpeed));
          tx += (w.player.vx ?? 0) * lead;
          tz += (w.player.vz ?? 0) * lead;
        }
        const tsp = t ? SPECIES[t.speciesId] : null;
        const tr = tsp ? tsp.lengthM * 0.3 * growthScale(t!, now) : 0.4;
        const reach = sp.attack.range * (0.5 + 0.5 * g) + tr + sp.lengthM * 0.25 * g;
        const stalking = a.state === 'hunt' && d > 30 && a.stamina > 0.3;
        targetSpeed = d <= reach * 0.8 ? 0 : stalking ? walk : run;
        if (r.atk) {
          const res = this.runAttack(a, sp, r, w, dt, g, isPlayer, t ?? null, tx, tz, tr);
          tx = res.tx;
          tz = res.tz;
          targetSpeed = res.speed;
          if (res.killed) {
            remember(a, { kind: 'chaseWon', x: a.x, z: a.z, strength: 1, subject: t!.speciesId }, now);
            a.targetId = t!.id;
            this.setState(a, 'eat');
          }
          break;
        }
        // Tail fighters turn their back on a close enemy to bring the weapon round.
        const moves = movesFor(sp);
        if (moves.every((m) => m.from === 'tail') && d < reach * 1.3) {
          tx = a.x - (tx - a.x);
          tz = a.z - (tz - a.z);
          targetSpeed = 0;
        }
        const rest = Math.max(0.25, sp.attack.cooldown - 1.1) * (now < r.counterUntil ? 0.35 : 1);
        if (now - a.lastAttackAt > rest && now >= r.staggerUntil) {
          const m = chooseMove(sp, g, a.x, a.z, a.heading, isPlayer ? w.player.x : t!.x, isPlayer ? w.player.z : t!.z, tr, w.random, r.lastMove ?? undefined, !!a.alpha);
          if (m) {
            r.atk = { move: m, t: 0, ts: timeScale(effectiveMass(a, now)) * (now < r.counterUntil ? 0.75 : 1) * (a.alpha ? 0.88 : 1), resolved: false, landed: false, aim: a.heading };
            r.counterUntil = 0;
          }
        }
        break;
      }
      case 'eat': {
        const c = a.targetId ? w.get(a.targetId) : undefined;
        if (!c || c.meat <= 0) {
          this.setState(a, 'idle');
          break;
        }
        tx = c.x;
        tz = c.z;
        const d = Math.hypot(tx - a.x, tz - a.z);
        if (d > 1.5 + sp.lengthM * 0.4) targetSpeed = walk;
        else {
          const bite = Math.min(c.meat, dt * effectiveMass(a, now) * 0.004 + dt * 0.2);
          c.meat -= bite;
          a.hunger = clamp(a.hunger - (bite / Math.max(1, effectiveMass(a, now) * 0.08)), 0, 1);
          if (a.hunger < 0.05) {
            remember(a, { kind: 'food', x: a.x, z: a.z, strength: 0.6 }, now);
            this.setState(a, 'rest');
          }
        }
        break;
      }
      case 'nest':
        targetSpeed = 0;
        break;
    }

    this.locomote(a, sp, r, w, dt, tx, tz, targetSpeed, wantAlt);
  }

  /** Attack in progress for the renderer: move, phase and progress (null when not attacking). */
  attackState(a: AnimalData): { kind: MoveKind; phase: 'windup' | 'strike' | 'recover'; u: number } | null {
    const at = this.rt.get(a.id)?.atk;
    if (!at) return null;
    const p = phaseOf(at);
    return p.phase === 'done' ? null : { kind: at.move.kind, phase: p.phase, u: p.u };
  }

  /** A wounded leg: the animal runs slower for a while. */
  limp(a: AnimalData, now: number, seconds: number): void {
    const r = this.runtime(a);
    r.limpUntil = Math.max(r.limpUntil, now + seconds);
  }

  /**
   * A blow taken during the wind-up breaks the attack (counter-attack): the
   * animal staggers and cannot attack again for a moment. Returns true when
   * an attack was interrupted. Giants shrug off small blows.
   */
  interruptAttack(a: AnimalData, now: number, force: number): boolean {
    const r = this.rt.get(a.id);
    if (!r?.atk || phaseOf(r.atk).phase !== 'windup') return false;
    if (force < Math.min(1, SPECIES[a.speciesId].massKg / 4000)) return false;
    r.atk = null;
    r.staggerUntil = now + 0.9;
    a.lastAttackAt = now;
    return true;
  }

  /**
   * Advances an attack: faces the target during the wind-up, resolves the hit
   * once at the start of the strike (the target may have moved or dodged by
   * then), lunges during the strike and recovers.
   */
  private runAttack(a: AnimalData, sp: SpeciesDef, r: Runtime, w: AIWorld, dt: number, g: number, isPlayer: boolean, t: AnimalData | null, tx: number, tz: number, tr: number): { tx: number; tz: number; speed: number; killed: boolean } {
    const at = r.atk!;
    const now = w.now;
    at.t += dt;
    const { phase } = phaseOf(at);
    const m = at.move;
    let speed = 0;
    let killed = false;
    // Wind-up: keep tracking the target (tail swings track it with the rear).
    if (phase === 'windup' && m.from === 'tail') {
      tx = a.x - (tx - a.x);
      tz = a.z - (tz - a.z);
    } else if (phase !== 'windup') {
      // Committed: no more steering during the strike and recovery.
      tx = a.x + Math.sin(a.heading) * 10;
      tz = a.z + Math.cos(a.heading) * 10;
    }
    if (phase === 'strike' && m.lunge) {
      // The lunge is instant (no acceleration ramp): the body is thrown forward.
      speed = (m.lunge * sp.lengthM * g) / Math.max(0.05, m.strike * at.ts);
      a.speed = speed;
    }
    if ((phase === 'strike' || phase === 'recover' || phase === 'done') && !at.resolved) {
      at.resolved = true;
      const px = isPlayer ? w.player.x : t!.x;
      const pz = isPlayer ? w.player.z : t!.z;
      if (m.kind === 'roar') {
        w.alphaRoar?.(a);
        at.landed = true;
      } else if (m.range) {
        w.spit?.(a, px, pz);
        at.landed = true;
      } else if (strikeHits(a.x, a.z, a.heading, sp, m, g, px, pz, tr)) {
        // Fights between alphas are brutal: harder blows than a hunt.
        const duel = !isPlayer && r.duelWith === t!.id ? 1.6 : 1;
        const dmg = sp.attack.damage * m.dmg * (0.4 + 0.6 * g) * (0.75 + a.personality.aggression * 0.5) * alphaMul(a, 'damage') * duel;
        const ang = m.from === 'tail' ? a.heading + Math.PI * 0.5 * (w.random() < 0.5 ? 1 : -1) : Math.atan2(px - a.x, pz - a.z);
        if (isPlayer) {
          if (w.player.dodging) w.playerEvaded?.(a, m);
          else {
            at.landed = true;
            w.damagePlayer(dmg, a);
            const kb = knockback(m, effectiveMass(a, now), HUMAN_MASS);
            if (kb > 0) w.knockPlayer?.(Math.sin(ang), Math.cos(ang), kb);
            if (m.hold) w.holdPlayer?.(m.hold, a);
            w.strikeLanded?.(a, null, m, dmg);
          }
        } else {
          // Small, nimble prey sometimes sidesteps a big predator's lunge.
          const tm = effectiveMass(t!, now);
          const am = effectiveMass(a, now);
          const sidestep = tm < am * 0.3 && t!.state === 'flee' && w.random() < 0.2;
          if (!sidestep) {
            at.landed = true;
            w.damageAnimal(t!, dmg, a);
            const kb = knockback(m, am, tm);
            if (kb > 0 && t!.alive) {
              const push = Math.min(kb * 0.25, 2);
              const nx = t!.x + Math.sin(ang) * push;
              const nz = t!.z + Math.cos(ang) * push;
              if (!w.blocked(nx, nz, 0.3)) {
                t!.x = nx;
                t!.z = nz;
              }
            }
            if (m.hold && t!.alive) t!.heldUntil = Math.max(t!.heldUntil ?? 0, now + m.hold);
            w.strikeLanded?.(a, t!, m, dmg);
            if (!t!.alive) killed = true;
          }
        }
      }
    }
    if (phaseOf(at).phase === 'done') {
      r.lastMove = m.kind;
      r.atk = null;
      a.lastAttackAt = now;
    }
    return { tx, tz, speed, killed };
  }

  private locomote(a: AnimalData, sp: SpeciesDef, r: Runtime, w: AIWorld, dt: number, tx: number, tz: number, targetSpeed: number, wantAlt: number, manual = false): void {
    const flies = sp.locomotion.flies;
    const airborne = flies && r.altitude > 2;
    const desired = Math.atan2(tx - a.x, tz - a.z);
    const maxTurn = sp.locomotion.turnRate * (a.speed < 1 ? 1.2 : 1) * (manual ? 1.6 : 1);
    const diff = Math.hypot(tx - a.x, tz - a.z) > 0.5 ? angleDiff(a.heading, desired) : 0;
    // Steering: the wanted turning speed grows with the angle still to turn and
    // the actual turning speed eases toward it (no instant start or stop).
    let wantTurn = clamp(diff * 2.5, -maxTurn, maxTurn);
    const avoiding = w.now < r.avoidUntil;
    if (avoiding) wantTurn = r.avoidSide * maxTurn;
    r.turnVel += (wantTurn - r.turnVel) * damp(manual ? 10 : 6, dt);
    const step = r.turnVel * dt;
    // Never overshoot the target direction.
    a.heading += !avoiding && Math.abs(step) > Math.abs(diff) && Math.sign(step) === Math.sign(diff) ? diff : step;
    // A big turn slows the animal down instead of making it run wide arcs or spin on the spot.
    if (!manual && targetSpeed > 0 && Math.abs(diff) > 1.2) targetSpeed *= 0.55;

    // Obstacle and terrain avoidance (probe ahead).
    if (!airborne && targetSpeed > 0 && !manual) {
      const probe = 2 + sp.lengthM * 0.5 + a.speed * 0.6;
      const px = a.x + Math.sin(a.heading) * probe;
      const pz = a.z + Math.cos(a.heading) * probe;
      const h = w.terrain.height(px, pz);
      const bad = sp.locomotion.aquatic
        ? h > AQUATIC_MIN_DEPTH
        : (h < -0.5 && !sp.locomotion.swims) || Math.abs(h - w.terrain.height(a.x, a.z)) / probe > 1.1 || w.blocked(px, pz, sp.lengthM * 0.15 + 0.3);
      if (bad) {
        // Steer around it over the next moments rather than snapping the heading.
        if (!avoiding) r.avoidSide = a.id.charCodeAt(0) % 2 ? 1 : -1;
        r.avoidUntil = w.now + 0.6;
        targetSpeed *= 0.4;
      }
    }

    if (w.now < r.limpUntil) targetSpeed *= 0.6;
    a.speed += (targetSpeed - a.speed) * damp(targetSpeed > a.speed ? 2.2 : 3.5, dt);
    if (a.speed < 0.02) a.speed = 0;
    const nx = a.x + Math.sin(a.heading) * a.speed * dt;
    const nz = a.z + Math.cos(a.heading) * a.speed * dt;
    const deep = manual && !sp.locomotion.swims && w.terrain.height(nx, nz) < -1.2;
    // Marine animals never leave deep water.
    const shore = !!sp.locomotion.aquatic && w.terrain.height(nx, nz) > AQUATIC_MIN_DEPTH;
    if (!deep && !shore && (airborne || !w.blocked(nx, nz, sp.lengthM * 0.12 + 0.25))) {
      a.x = nx;
      a.z = nz;
    } else a.speed *= 0.5;

    if (flies) {
      r.altitude += (wantAlt - r.altitude) * damp(0.8, dt);
      if (r.altitude < 0.05) r.altitude = 0;
    }
    const ground = w.terrain.height(a.x, a.z);
    const sp2 = SPECIES[a.speciesId];
    const swimLevel = -sp2.hipHeightM * growthScale(a, w.now) * 0.8;
    const y = sp.locomotion.aquatic ? swimDepth(a, w.now, ground) : Math.max(ground, airborne ? 0 : swimLevel) + r.altitude;
    // Ease small height changes (terrain bumps, rocks) so the body glides; big ones snap.
    a.y = Math.abs(y - a.y) > 2 || !Number.isFinite(a.y) ? y : a.y + (y - a.y) * damp(y > a.y ? 25 : 12, dt);
    r.stride += (a.speed * dt) / Math.max(0.1, sp.locomotion.stride * growthScale(a, w.now));
  }
}

function isAsleepTime(sp: SpeciesDef, night: boolean): boolean {
  if (sp.activity === 'diurnal') return night;
  if (sp.activity === 'nocturnal') return !night;
  return false;
}

export { PLAYER_ID };
