/**
 * Per-frame section timings for the diagnostics panel (F3) and the automated
 * performance tests. Each section accumulates CPU time (performance.now) on
 * the main thread; frames are kept in a ring buffer so the panel can show the
 * average and the worst frame of the last ~2 seconds.
 *
 * GPU time is measured with EXT_disjoint_timer_query_webgl2 when the browser
 * exposes it (most desktop Chrome/Edge; usually not Safari or mobile). When
 * it is missing the panel says so instead of estimating.
 */
export const SECTIONS = [
  'input',
  'world',
  'player',
  'survival',
  'actions',
  'ai',
  'taming',
  'base',
  'streaming',
  'animals',
  'environment',
  'character',
  'effects',
  'audio',
  'hud',
  'render',
] as const;
export type Section = (typeof SECTIONS)[number];

const HISTORY = 120;

export interface ProfileSummary {
  frames: number;
  /** Average and worst frame interval (ms), from requestAnimationFrame timestamps. */
  frameAvg: number;
  frameMax: number;
  /** 1 % low FPS: the frame time exceeded by only 1 % of frames. */
  frameP99: number;
  /** Average CPU ms per section and the total of measured sections. */
  sections: Record<Section, number>;
  sectionMax: Record<Section, number>;
  cpuTotal: number;
  /** Average GPU ms of the main scene render, or null when not measurable. */
  gpu: number | null;
  /** Section breakdown of the frame with the most measured CPU time. */
  worst: { cpu: number; sections: Partial<Record<Section, number>> };
}

export class Profiler {
  enabled = false;
  private cur = new Float64Array(SECTIONS.length);
  private ring = new Float64Array(SECTIONS.length * HISTORY);
  private frameMs = new Float64Array(HISTORY);
  private n = 0;
  private head = 0;
  private open = -1;
  private t0 = 0;
  // GPU timer query (WebGL2).
  private gl: WebGL2RenderingContext | null = null;
  private ext: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null = null;
  private pending: WebGLQuery[] = [];
  private gpuRing: number[] = [];
  private active: WebGLQuery | null = null;
  private worstCpu = 0;
  private worstSections = new Float64Array(SECTIONS.length);

  attachGl(gl: WebGLRenderingContext | WebGL2RenderingContext): void {
    if (!('createQuery' in gl)) return;
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
    if (!ext) return;
    this.gl = gl as WebGL2RenderingContext;
    this.ext = ext;
  }

  get gpuAvailable(): boolean {
    return !!this.ext;
  }

  /** Starts a section (ends the open one, so sections never overlap). */
  begin(s: Section): void {
    if (!this.enabled) return;
    const now = performance.now();
    if (this.open >= 0) this.cur[this.open] += now - this.t0;
    this.open = SECTIONS.indexOf(s);
    this.t0 = now;
  }

  end(): void {
    if (!this.enabled || this.open < 0) return;
    this.cur[this.open] += performance.now() - this.t0;
    this.open = -1;
  }

  /** Brackets the main render with a GPU timer query (one in flight at a time per frame). */
  gpuBegin(): void {
    if (!this.enabled || !this.gl || !this.ext || this.active) return;
    const q = this.gl.createQuery();
    if (!q) return;
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q);
    this.active = q;
  }

  gpuEnd(): void {
    if (!this.gl || !this.ext || !this.active) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending.push(this.active);
    this.active = null;
  }

  private pollGpu(): void {
    const gl = this.gl;
    if (!gl || !this.ext) return;
    const disjoint = gl.getParameter(this.ext.GPU_DISJOINT_EXT) as boolean;
    while (this.pending.length) {
      const q = this.pending[0];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      const ns = gl.getQueryParameter(q, gl.QUERY_RESULT) as number;
      if (!disjoint) {
        this.gpuRing.push(ns / 1e6);
        if (this.gpuRing.length > HISTORY) this.gpuRing.shift();
      }
      gl.deleteQuery(q);
      this.pending.shift();
    }
    // Never let unanswered queries pile up.
    while (this.pending.length > 8) gl.deleteQuery(this.pending.shift()!);
  }

  /** Closes the frame; `intervalMs` is the time since the previous frame. */
  frame(intervalMs: number): void {
    if (!this.enabled) return;
    this.end();
    const base = this.head * SECTIONS.length;
    let cpu = 0;
    for (let i = 0; i < SECTIONS.length; i++) cpu += this.cur[i];
    if (cpu > this.worstCpu) {
      this.worstCpu = cpu;
      this.worstSections.set(this.cur);
    }
    for (let i = 0; i < SECTIONS.length; i++) {
      this.ring[base + i] = this.cur[i];
      this.cur[i] = 0;
    }
    this.frameMs[this.head] = intervalMs;
    this.head = (this.head + 1) % HISTORY;
    this.n = Math.min(HISTORY, this.n + 1);
    this.pollGpu();
  }

  reset(): void {
    this.n = 0;
    this.head = 0;
    this.cur.fill(0);
    this.gpuRing = [];
    this.worstCpu = 0;
    this.worstSections.fill(0);
  }

  summary(): ProfileSummary {
    const sections = {} as Record<Section, number>;
    const sectionMax = {} as Record<Section, number>;
    let cpuTotal = 0;
    const n = Math.max(1, this.n);
    SECTIONS.forEach((s, i) => {
      let sum = 0;
      let max = 0;
      for (let f = 0; f < this.n; f++) {
        const v = this.ring[f * SECTIONS.length + i];
        sum += v;
        if (v > max) max = v;
      }
      sections[s] = sum / n;
      sectionMax[s] = max;
      cpuTotal += sum / n;
    });
    const frames = Array.from(this.frameMs.subarray(0, this.n)).sort((a, b) => a - b);
    const frameAvg = frames.reduce((a, b) => a + b, 0) / n;
    return {
      frames: this.n,
      frameAvg,
      frameMax: frames[frames.length - 1] ?? 0,
      frameP99: frames[Math.min(frames.length - 1, Math.floor(frames.length * 0.99))] ?? 0,
      sections,
      sectionMax,
      cpuTotal,
      gpu: this.gpuRing.length ? this.gpuRing.reduce((a, b) => a + b, 0) / this.gpuRing.length : null,
      worst: { cpu: this.worstCpu, sections: Object.fromEntries(SECTIONS.map((k, i) => [k, +this.worstSections[i].toFixed(2)]).filter(([, v]) => (v as number) >= 1)) },
    };
  }
}
