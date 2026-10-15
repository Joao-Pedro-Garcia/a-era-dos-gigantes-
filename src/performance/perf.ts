import type { QualityLevel } from '../core/config';

/**
 * Frame-time monitor with adaptive quality. Steps quality down quickly when
 * the frame rate is poor and up slowly when there's sustained headroom.
 */
export class PerfMonitor {
  fps = 60;
  private acc = 0;
  private frames = 0;
  private goodFor = 0;
  private badFor = 0;

  constructor(public level: QualityLevel) {}

  /** Returns a new quality level if an adjustment is due. */
  frame(dt: number, auto: boolean): QualityLevel | null {
    this.acc += dt;
    this.frames++;
    if (this.acc < 1) return null;
    this.fps = this.frames / this.acc;
    this.acc = 0;
    this.frames = 0;
    if (!auto) return null;
    if (this.fps < 30) {
      this.badFor++;
      this.goodFor = 0;
    } else if (this.fps > 56) {
      this.goodFor++;
      this.badFor = 0;
    } else {
      this.badFor = 0;
      this.goodFor = 0;
    }
    const order: QualityLevel[] = ['low', 'medium', 'high'];
    const i = order.indexOf(this.level);
    if (this.badFor >= 3 && i > 0) {
      this.badFor = 0;
      return (this.level = order[i - 1]);
    }
    if (this.goodFor >= 15 && i < order.length - 1) {
      this.goodFor = 0;
      return (this.level = order[i + 1]);
    }
    return null;
  }

  static initialGuess(): QualityLevel {
    const mobile = matchMedia('(pointer: coarse)').matches;
    const cores = navigator.hardwareConcurrency ?? 4;
    if (mobile) return cores >= 8 ? 'medium' : 'low';
    return cores >= 8 ? 'high' : 'medium';
  }
}
