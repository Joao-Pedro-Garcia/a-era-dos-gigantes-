import type { SpeciesDef } from '../animals/species';

/**
 * Procedural Web Audio: wind and rain beds, thunder, and synthesized animal
 * calls positioned in 3D. No external audio files are required; the context
 * starts on the first user gesture as browsers require.
 */
export class AudioSystem {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private wind!: GainNode;
  private rain!: GainNode;
  private noise!: AudioBuffer;
  enabled = true;

  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = 0.6;
    this.master.connect(ctx.destination);
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02; // brownish
      d[i] = last * 3.5;
    }
    this.wind = this.loop(400, 'lowpass');
    this.rain = this.loop(2500, 'highpass');
  }

  private loop(freq: number, type: BiquadFilterType): GainNode {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(f).connect(g).connect(this.master);
    src.start();
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

  ambience(wind: number, rain: number): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.wind.gain.setTargetAtTime(Math.min(0.5, 0.04 + wind * 0.025), t, 0.5);
    this.rain.gain.setTargetAtTime(rain * 0.25, t, 0.5);
  }

  thunder(distance: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.enabled) return;
    const at = ctx.currentTime + distance / 343;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 180;
    const g = ctx.createGain();
    const vol = Math.max(0.05, 1 - distance / 900);
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(vol, at + 0.05);
    g.gain.exponentialRampToValueAtTime(0.001, at + 3.5);
    src.connect(f).connect(g).connect(this.master);
    src.start(at, Math.random());
    src.stop(at + 4);
  }

  /** Synthesizes a species-specific vocalization at a world position. */
  call(sp: SpeciesDef, x: number, y: number, z: number, scale: number, urgency = 0): void {
    const ctx = this.ctx;
    if (!ctx || !this.enabled) return;
    const now = ctx.currentTime;
    const pan = ctx.createPanner();
    pan.panningModel = 'HRTF';
    pan.distanceModel = 'exponential';
    pan.refDistance = 6 + sp.lengthM;
    pan.rolloffFactor = 1.1;
    if (pan.positionX) {
      pan.positionX.value = x;
      pan.positionY.value = y;
      pan.positionZ.value = z;
    } else pan.setPosition(x, y, z);
    pan.connect(this.master);
    const pitch = sp.audio.pitch / Math.max(0.35, scale) ** 0.5 * (1 + urgency * 0.25);
    const dur = { roar: 1.6, bellow: 2.2, honk: 1.1, chirp: 0.18, hiss: 0.9, screech: 0.5, grunt: 0.45 }[sp.audio.call];
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(0.5, now + Math.min(0.15, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.001, now + dur);
    g.connect(pan);
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
    const repeats = sp.audio.call === 'chirp' ? 3 : 1;
    osc.frequency.setValueAtTime(pitch, now);
    if (sp.audio.call === 'roar' || sp.audio.call === 'bellow') {
      osc.frequency.linearRampToValueAtTime(pitch * 1.3, now + dur * 0.3);
      osc.frequency.exponentialRampToValueAtTime(pitch * 0.7, now + dur);
    } else if (sp.audio.call === 'honk') {
      osc.frequency.linearRampToValueAtTime(pitch * 1.08, now + dur * 0.5);
      osc.frequency.linearRampToValueAtTime(pitch * 0.92, now + dur);
    } else if (sp.audio.call === 'chirp') {
      for (let i = 0; i < repeats; i++) {
        osc.frequency.setValueAtTime(pitch * 1.3, now + i * 0.07);
        osc.frequency.exponentialRampToValueAtTime(pitch, now + i * 0.07 + 0.06);
      }
    }
    // A formant filter and gentle amplitude modulation make large animals sound throaty.
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

  /** Short UI/impact blip. */
  hit(): void {
    const ctx = this.ctx;
    if (!ctx || !this.enabled) return;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.4, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 900;
    src.connect(f).connect(g).connect(this.master);
    src.start(now, Math.random());
    src.stop(now + 0.2);
  }
}
