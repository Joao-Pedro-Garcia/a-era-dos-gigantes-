import type { SpeciesDef } from '../animals/species';
import type { BiomeId } from '../world/biomes';

/**
 * Procedural Web Audio. Everything is synthesized at runtime (no audio files),
 * routed through separate effect, ambience and music buses with independent
 * volumes, and through a reverb send whose level follows the surroundings
 * (open air, shelter, cave). Repetition is avoided with randomized pitch,
 * timing and per-sound cooldowns.
 */
export type SfxName =
  | 'chop' | 'stone' | 'hit' | 'swing' | 'bow' | 'place' | 'craft' | 'eat' | 'drink' | 'pickup' | 'ui' | 'shock' | 'flare' | 'snap' | 'demolish'
  // Combat (v0.4): swing weights, impacts by material, bow and equipment.
  | 'swingHeavy' | 'swingLight' | 'punch' | 'impactPlant' | 'impactDirt' | 'impactMetal' | 'impactCrystal' | 'splash' | 'bowDraw' | 'equip' | 'unequip';
export type Surface = 'grass' | 'sand' | 'snow' | 'rock' | 'wood' | 'water' | 'mud';
export type MusicMood = 'calm' | 'night' | 'tension' | 'cave' | 'off';
export type Indoor = 'open' | 'sheltered' | 'cave';

export interface Volumes {
  master: number;
  sfx: number;
  ambience: number;
  music: number;
}

export interface AmbienceParams {
  wind: number;
  rain: number;
  biome: BiomeId;
  night: boolean;
  /** 0..1 proximity of running/standing water. */
  water: number;
  indoor: Indoor;
}

export class AudioSystem {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private buses!: { sfx: GainNode; ambience: GainNode; music: GainNode };
  private reverbSend!: GainNode;
  private wind!: GainNode;
  private rain!: GainNode;
  private insects!: GainNode;
  private waterBed!: GainNode;
  private caveBed!: GainNode;
  private radio!: GainNode;
  private radioTone!: OscillatorNode;
  private noise!: AudioBuffer;
  private cooldown = new Map<string, number>();
  private nextBird = 0;
  private nextCricket = 0;
  private nextDrip = 0;
  private nextNote = 0;
  private mood: MusicMood = 'calm';
  private last: AmbienceParams | null = null;
  volumes: Volumes = { master: 0.8, sfx: 1, ambience: 0.8, music: 0.45 };
  /** Receives a short text for every animal call (sound captions). */
  onCaption: (text: string, x: number, z: number) => void = () => {};

  get ready(): boolean {
    return !!this.ctx;
  }

  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    this.buses = { sfx: ctx.createGain(), ambience: ctx.createGain(), music: ctx.createGain() };
    for (const b of Object.values(this.buses)) b.connect(this.master);
    // Reverb: synthetic impulse response (decaying noise).
    const conv = ctx.createConvolver();
    const len = ctx.sampleRate * 2.5;
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    conv.buffer = ir;
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.05;
    this.reverbSend.connect(conv).connect(this.master);
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    let lastV = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      lastV = (lastV + 0.02 * w) / 1.02;
      d[i] = i % 2 ? lastV * 3.5 : w * 0.5; // brown-ish with some white grain
    }
    this.wind = this.loop(380, 'lowpass', this.buses.ambience);
    this.rain = this.loop(2600, 'highpass', this.buses.ambience);
    this.insects = this.loop(5200, 'bandpass', this.buses.ambience, 8);
    this.waterBed = this.loop(900, 'bandpass', this.buses.ambience, 0.7);
    this.caveBed = this.loop(160, 'lowpass', this.buses.ambience);
    this.radio = this.loop(1800, 'bandpass', this.buses.sfx, 1.5);
    this.radioTone = ctx.createOscillator();
    this.radioTone.frequency.value = 880;
    const toneGain = ctx.createGain();
    toneGain.gain.value = 0;
    this.radioTone.connect(toneGain).connect(this.buses.sfx);
    this.radioTone.start();
    (this.radioTone as unknown as { gainNode: GainNode }).gainNode = toneGain;
    this.applyVolumes();
  }

  setVolumes(v: Partial<Volumes>): void {
    Object.assign(this.volumes, v);
    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.volumes.master, t, 0.05);
    this.buses.sfx.gain.setTargetAtTime(this.volumes.sfx, t, 0.05);
    this.buses.ambience.gain.setTargetAtTime(this.volumes.ambience, t, 0.05);
    this.buses.music.gain.setTargetAtTime(this.volumes.music, t, 0.05);
  }

  private loop(freq: number, type: BiquadFilterType, bus: GainNode, q = 1): GainNode {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.playbackRate.value = 0.9 + Math.random() * 0.2;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(f).connect(g).connect(bus);
    src.start(0, Math.random() * 2);
    return g;
  }

  suspend(): void {
    void this.ctx?.suspend();
  }

  resume(): void {
    void this.ctx?.resume();
  }

  setListener(x: number, y: number, z: number, fx: number, fz: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const l = ctx.listener;
    if (l.positionX) {
      l.positionX.value = x;
      l.positionY.value = y;
      l.positionZ.value = z;
      l.forwardX.value = fx;
      l.forwardY.value = 0;
      l.forwardZ.value = fz;
    } else {
      l.setPosition(x, y, z);
      l.setOrientation(fx, 0, fz, 0, 1, 0);
    }
  }

  /** Continuous beds plus randomly scheduled one-shots (birds, crickets, drips). */
  ambience(p: AmbienceParams): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.last = p;
    const t = ctx.currentTime;
    const cave = p.indoor === 'cave';
    const shelter = p.indoor === 'sheltered' ? 0.5 : 1;
    const lush = p.biome === 'jungle' || p.biome === 'swamp' ? 1 : p.biome === 'plains' ? 0.4 : 0.1;
    this.wind.gain.setTargetAtTime(cave ? 0.01 : Math.min(0.5, 0.03 + p.wind * 0.025) * shelter, t, 0.6);
    this.rain.gain.setTargetAtTime(cave ? 0 : p.rain * 0.25 * shelter, t, 0.6);
    this.insects.gain.setTargetAtTime(cave ? 0 : lush * (p.night ? 0.05 : 0.025) * (1 - p.rain * 0.7), t, 1);
    this.waterBed.gain.setTargetAtTime(cave ? 0 : p.water * 0.18, t, 0.8);
    this.caveBed.gain.setTargetAtTime(cave ? 0.12 : 0, t, 0.8);
    this.reverbSend.gain.setTargetAtTime(cave ? 0.55 : p.indoor === 'sheltered' ? 0.2 : 0.04, t, 0.4);
    // One-shots at irregular intervals.
    if (!cave && !p.night && p.rain < 0.4 && t > this.nextBird && lush > 0.2) {
      this.nextBird = t + 2 + Math.random() * 9 / lush;
      this.birdCall();
    }
    if (!cave && p.night && t > this.nextCricket && p.biome !== 'snow') {
      this.nextCricket = t + 0.4 + Math.random() * 1.6;
      this.cricket();
    }
    if (cave && t > this.nextDrip) {
      this.nextDrip = t + 0.8 + Math.random() * 3;
      this.drip();
    }
    this.musicTick();
  }

  private env(gain: GainNode, t: number, peak: number, attack: number, decay: number): void {
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(peak, t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  /** A short tone/noise event with optional 3D position. */
  private blip(opts: { freq: number; type?: OscillatorType; dur: number; vol: number; slide?: number; noise?: boolean; filter?: number; bus?: GainNode; pos?: [number, number, number]; reverb?: boolean }): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const g = ctx.createGain();
    this.env(g, t, opts.vol, Math.min(0.02, opts.dur * 0.2), opts.dur);
    let out: AudioNode = g;
    if (opts.pos) {
      const pan = this.panner(opts.pos, 8);
      g.connect(pan);
      out = pan;
    }
    out.connect(opts.bus ?? this.buses.sfx);
    if (opts.reverb !== false) out.connect(this.reverbSend);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = opts.filter ?? 6000;
    f.connect(g);
    if (opts.noise) {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.playbackRate.value = opts.freq / 1000;
      src.connect(f);
      src.start(t, Math.random());
      src.stop(t + opts.dur + 0.1);
    } else {
      const o = ctx.createOscillator();
      o.type = opts.type ?? 'sine';
      o.frequency.setValueAtTime(opts.freq, t);
      if (opts.slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, opts.freq * opts.slide), t + opts.dur);
      o.connect(f);
      o.start(t);
      o.stop(t + opts.dur + 0.1);
    }
  }

  private panner(pos: [number, number, number], ref: number): PannerNode {
    const pan = this.ctx!.createPanner();
    pan.panningModel = 'HRTF';
    pan.distanceModel = 'exponential';
    pan.refDistance = ref;
    pan.rolloffFactor = 1.1;
    if (pan.positionX) {
      pan.positionX.value = pos[0];
      pan.positionY.value = pos[1];
      pan.positionZ.value = pos[2];
    } else pan.setPosition(...pos);
    return pan;
  }

  private birdCall(): void {
    const base = 1800 + Math.random() * 2200;
    const n = 1 + Math.floor(Math.random() * 4);
    const ang = Math.random() * Math.PI * 2;
    const l = this.ctx!.listener;
    const lx = l.positionX?.value ?? 0;
    const lz = l.positionZ?.value ?? 0;
    for (let i = 0; i < n; i++) {
      setTimeout(() => this.ctx && this.blip({ freq: base * (1 + Math.random() * 0.1), type: 'sine', dur: 0.08 + Math.random() * 0.08, vol: 0.06, slide: 1.3, bus: this.buses.ambience, pos: [lx + Math.cos(ang) * 25, 8, lz + Math.sin(ang) * 25] }), i * (90 + Math.random() * 60));
    }
  }

  private cricket(): void {
    this.blip({ freq: 4200 + Math.random() * 400, type: 'square', dur: 0.04, vol: 0.012, bus: this.buses.ambience, filter: 7000, reverb: false });
  }

  private drip(): void {
    this.blip({ freq: 1200 + Math.random() * 900, type: 'sine', dur: 0.12, vol: 0.08, slide: 0.5, bus: this.buses.ambience });
  }

  private canPlay(key: string, gap: number): boolean {
    const t = this.ctx?.currentTime ?? 0;
    if ((this.cooldown.get(key) ?? -1) > t) return false;
    this.cooldown.set(key, t + gap);
    return true;
  }

  sfx(name: SfxName, pos?: [number, number, number]): void {
    if (!this.ctx || !this.canPlay(`sfx:${name}`, 0.06)) return;
    const v = 0.9 + Math.random() * 0.2;
    switch (name) {
      case 'chop':
        this.blip({ freq: 900 * v, noise: true, dur: 0.12, vol: 0.5, filter: 2200, pos });
        this.blip({ freq: 180 * v, type: 'triangle', dur: 0.1, vol: 0.3, slide: 0.6, pos });
        break;
      case 'stone':
        this.blip({ freq: 2200 * v, noise: true, dur: 0.08, vol: 0.45, filter: 5000, pos });
        this.blip({ freq: 700 * v, type: 'square', dur: 0.05, vol: 0.08, slide: 0.8, pos });
        break;
      case 'hit':
        this.blip({ freq: 140 * v, type: 'sine', dur: 0.18, vol: 0.5, slide: 0.5, pos });
        this.blip({ freq: 800 * v, noise: true, dur: 0.08, vol: 0.3, filter: 1500, pos });
        break;
      case 'swing':
        this.blip({ freq: 1400 * v, noise: true, dur: 0.18, vol: 0.12, filter: 3000, reverb: false });
        break;
      case 'bow':
        // Release: string twang plus the slap of the limbs.
        this.blip({ freq: 220 * v, type: 'triangle', dur: 0.25, vol: 0.25, slide: 0.7 });
        this.blip({ freq: 1500 * v, noise: true, dur: 0.05, vol: 0.2, filter: 3000, reverb: false });
        break;
      case 'place':
        this.blip({ freq: 160 * v, type: 'triangle', dur: 0.15, vol: 0.4, slide: 0.7, pos });
        this.blip({ freq: 600 * v, noise: true, dur: 0.1, vol: 0.2, filter: 1800, pos });
        break;
      case 'demolish':
        this.blip({ freq: 400 * v, noise: true, dur: 0.5, vol: 0.4, filter: 1200, pos });
        break;
      case 'craft':
        this.blip({ freq: 660 * v, type: 'sine', dur: 0.2, vol: 0.12 });
        setTimeout(() => this.ctx && this.blip({ freq: 990 * v, type: 'sine', dur: 0.3, vol: 0.1 }), 120);
        break;
      case 'eat':
        for (let i = 0; i < 3; i++) setTimeout(() => this.ctx && this.blip({ freq: 1500 * v, noise: true, dur: 0.05, vol: 0.18, filter: 3000, reverb: false }), i * 130);
        break;
      case 'drink':
        for (let i = 0; i < 3; i++) setTimeout(() => this.ctx && this.blip({ freq: 400 + i * 80, type: 'sine', dur: 0.09, vol: 0.12, slide: 1.6, reverb: false }), i * 200);
        break;
      case 'pickup':
        this.blip({ freq: 880 * v, type: 'sine', dur: 0.12, vol: 0.1, slide: 1.3, reverb: false });
        break;
      case 'ui':
        this.blip({ freq: 1200, type: 'sine', dur: 0.05, vol: 0.05, reverb: false });
        break;
      case 'shock':
        this.blip({ freq: 3000, noise: true, dur: 0.25, vol: 0.3, filter: 8000, pos });
        this.blip({ freq: 120, type: 'sawtooth', dur: 0.25, vol: 0.15, pos });
        break;
      case 'flare':
        this.blip({ freq: 2000, noise: true, dur: 1.5, vol: 0.4, filter: 4000 });
        break;
      case 'snap':
        this.blip({ freq: 2500, noise: true, dur: 0.06, vol: 0.4, filter: 6000, pos });
        break;
      case 'swingHeavy':
        // A heavy tool cuts the air lower and longer.
        this.blip({ freq: 650 * v, noise: true, dur: 0.26, vol: 0.16, filter: 1400, reverb: false });
        break;
      case 'swingLight':
        this.blip({ freq: 2200 * v, noise: true, dur: 0.12, vol: 0.1, filter: 4500, reverb: false });
        break;
      case 'punch':
        this.blip({ freq: 95 * v, type: 'sine', dur: 0.12, vol: 0.45, slide: 0.6, pos });
        this.blip({ freq: 500 * v, noise: true, dur: 0.05, vol: 0.25, filter: 900, pos });
        break;
      case 'impactPlant':
        this.blip({ freq: 1800 * v, noise: true, dur: 0.22, vol: 0.22, filter: 3500, pos });
        this.blip({ freq: 3200 * v, noise: true, dur: 0.12, vol: 0.1, filter: 7000, pos });
        break;
      case 'impactDirt':
        this.blip({ freq: 400 * v, noise: true, dur: 0.16, vol: 0.3, filter: 900, pos });
        break;
      case 'impactMetal':
        this.blip({ freq: 1250 * v, type: 'triangle', dur: 0.35, vol: 0.14, slide: 0.98, pos });
        this.blip({ freq: 1870 * v, type: 'sine', dur: 0.25, vol: 0.08, pos });
        this.blip({ freq: 3000 * v, noise: true, dur: 0.05, vol: 0.3, filter: 6000, pos });
        break;
      case 'impactCrystal':
        this.blip({ freq: 2600 * v, type: 'sine', dur: 0.4, vol: 0.1, slide: 1.02, pos });
        this.blip({ freq: 4000 * v, noise: true, dur: 0.06, vol: 0.25, filter: 8000, pos });
        break;
      case 'splash':
        this.blip({ freq: 1100 * v, noise: true, dur: 0.3, vol: 0.32, filter: 2600, pos });
        this.blip({ freq: 300 * v, type: 'sine', dur: 0.1, vol: 0.15, slide: 2.2, pos });
        break;
      case 'bowDraw':
        // Creak of the limbs and the string being drawn.
        this.blip({ freq: 180 * v, type: 'sawtooth', dur: 0.5, vol: 0.035, slide: 1.25, filter: 700, reverb: false });
        this.blip({ freq: 900 * v, noise: true, dur: 0.45, vol: 0.05, filter: 1500, reverb: false });
        break;
      case 'equip':
        this.blip({ freq: 700 * v, noise: true, dur: 0.1, vol: 0.12, filter: 2500, reverb: false });
        this.blip({ freq: 240 * v, type: 'triangle', dur: 0.06, vol: 0.08, reverb: false });
        break;
      case 'unequip':
        this.blip({ freq: 500 * v, noise: true, dur: 0.12, vol: 0.09, filter: 1800, reverb: false });
        break;
    }
  }

  /** Player footsteps by surface; distant heavy animals produce positional thuds. */
  footstep(surface: Surface, loud: number, pos?: [number, number, number], heavy = 0): void {
    if (!this.ctx) return;
    if (heavy > 0) {
      if (!pos || !this.canPlay(`step:${pos[0] | 0}`, 0.15)) return;
      this.blip({ freq: 45 + Math.random() * 10, type: 'sine', dur: 0.35, vol: Math.min(0.6, heavy), slide: 0.6, pos, filter: 300 });
      return;
    }
    const f: Record<Surface, [number, number]> = { grass: [900, 1500], sand: [1400, 2500], snow: [600, 1200], rock: [2500, 5000], wood: [300, 900], water: [700, 2000], mud: [300, 600] };
    const [freq, filt] = f[surface];
    this.blip({ freq: freq * (0.85 + Math.random() * 0.3), noise: true, dur: 0.07 + Math.random() * 0.03, vol: 0.08 * loud, filter: filt, reverb: true });
  }

  thunder(distance: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const at = ctx.currentTime + distance / 343;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.6;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 180;
    const g = ctx.createGain();
    const vol = Math.max(0.05, 1 - distance / 900);
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(vol, at + 0.05);
    g.gain.exponentialRampToValueAtTime(0.001, at + 3.5);
    src.connect(f).connect(g).connect(this.buses.ambience);
    g.connect(this.reverbSend);
    src.start(at, Math.random());
    src.stop(at + 4);
  }

  /**
   * Species vocalization at a world position. `occluded` muffles it (terrain or
   * walls between source and listener).
   */
  call(sp: SpeciesDef, x: number, y: number, z: number, scale: number, urgency = 0, occluded = false, label = ''): void {
    const ctx = this.ctx;
    if (!ctx || !this.canPlay(`call:${sp.id}:${Math.round(x / 10)}`, 1.5)) return;
    const now = ctx.currentTime;
    const pan = this.panner([x, y, z], 6 + sp.lengthM);
    pan.connect(this.buses.sfx);
    pan.connect(this.reverbSend);
    const pitch = (sp.audio.pitch / Math.max(0.35, scale) ** 0.5) * (1 + urgency * 0.25) * (0.92 + Math.random() * 0.16);
    const dur = { roar: 1.6, bellow: 2.2, honk: 1.1, chirp: 0.18, hiss: 0.9, screech: 0.5, grunt: 0.45 }[sp.audio.call] * (0.85 + Math.random() * 0.3);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(occluded ? 0.25 : 0.5, now + Math.min(0.15, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.001, now + dur);
    const occ = ctx.createBiquadFilter();
    occ.type = 'lowpass';
    occ.frequency.value = occluded ? 700 : 12000;
    g.connect(occ).connect(pan);
    if (label) this.onCaption(label, x, z);
    if (sp.audio.call === 'hiss') {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 1800 + pitch;
      f.Q.value = 0.8;
      src.connect(f).connect(g);
      src.start(now, Math.random());
      src.stop(now + dur);
      return;
    }
    const osc = ctx.createOscillator();
    osc.type = sp.audio.call === 'chirp' || sp.audio.call === 'screech' ? 'triangle' : 'sawtooth';
    osc.frequency.setValueAtTime(pitch, now);
    if (sp.audio.call === 'roar' || sp.audio.call === 'bellow') {
      osc.frequency.linearRampToValueAtTime(pitch * 1.3, now + dur * 0.3);
      osc.frequency.exponentialRampToValueAtTime(pitch * 0.7, now + dur);
    } else if (sp.audio.call === 'honk') {
      osc.frequency.linearRampToValueAtTime(pitch * 1.08, now + dur * 0.5);
      osc.frequency.linearRampToValueAtTime(pitch * 0.92, now + dur);
    } else if (sp.audio.call === 'chirp') {
      for (let i = 0; i < 3; i++) {
        osc.frequency.setValueAtTime(pitch * 1.3, now + i * 0.07);
        osc.frequency.exponentialRampToValueAtTime(pitch, now + i * 0.07 + 0.06);
      }
    }
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = Math.min(4000, pitch * 4);
    f.Q.value = 3;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = sp.massKg > 1000 ? 18 : 35;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.3;
    lfo.connect(lfoGain).connect(g.gain);
    osc.connect(f).connect(g);
    osc.start(now);
    lfo.start(now);
    osc.stop(now + dur + 0.1);
    lfo.stop(now + dur + 0.1);
  }

  /** Feeding/crunching sounds of an animal. */
  feeding(x: number, y: number, z: number, big: boolean): void {
    if (!this.ctx || !this.canPlay(`feed:${x | 0}`, 2 + Math.random() * 3)) return;
    this.blip({ freq: big ? 500 : 1400, noise: true, dur: 0.12, vol: 0.2, filter: big ? 900 : 2500, pos: [x, y, z] });
  }

  /** Radio receiver: static whose tone grows clearer near a signal source (0..1). */
  radioSignal(strength: number | null): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const on = strength !== null;
    this.radio.gain.setTargetAtTime(on ? 0.05 * (1 - (strength ?? 0) * 0.7) : 0, t, 0.2);
    const tg = (this.radioTone as unknown as { gainNode: GainNode }).gainNode;
    const pulse = on && Math.sin(t * 6) > 0.3 ? (strength ?? 0) * 0.04 : 0;
    tg.gain.setTargetAtTime(pulse, t, 0.02);
  }

  setMusicMood(m: MusicMood): void {
    this.mood = m;
  }

  /** Generative score: sparse pentatonic phrases over a soft drone; darker in danger. */
  private musicTick(): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    if (this.mood === 'off' || this.volumes.music <= 0 || t < this.nextNote) return;
    const scales: Record<Exclude<MusicMood, 'off'>, number[]> = {
      calm: [0, 2, 4, 7, 9, 12, 14],
      night: [0, 3, 5, 7, 10, 12],
      tension: [0, 1, 5, 6, 8],
      cave: [0, 2, 3, 7, 8],
    };
    const root = this.mood === 'tension' ? 110 : this.mood === 'night' ? 146.8 : this.mood === 'cave' ? 98 : 196;
    const sc = scales[this.mood];
    const step = sc[Math.floor(Math.random() * sc.length)];
    const freq = root * Math.pow(2, step / 12) * (Math.random() < 0.3 ? 2 : 1);
    const dur = this.mood === 'tension' ? 0.6 : 2.5 + Math.random() * 2;
    this.blip({ freq, type: this.mood === 'tension' ? 'sawtooth' : 'sine', dur, vol: this.mood === 'tension' ? 0.05 : 0.07, bus: this.buses.music, filter: this.mood === 'tension' ? 900 : 2500 });
    if (Math.random() < 0.35) this.blip({ freq: root / 2, type: 'triangle', dur: dur * 1.6, vol: 0.05, bus: this.buses.music, filter: 400 });
    this.nextNote = t + (this.mood === 'tension' ? 0.5 + Math.random() * 0.5 : 2.5 + Math.random() * 5);
  }

  /** Short impact used by older call sites. */
  hit(): void {
    this.sfx('hit');
  }

  get lastAmbience(): AmbienceParams | null {
    return this.last;
  }
}
