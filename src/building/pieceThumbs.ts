import * as THREE from 'three';
import { type PieceType } from './building';
import { createPieceObject, disposeObject } from './pieceViews';

/**
 * Small 3D pictures of the build pieces for the build screen, rendered from
 * the very same models the game places (not separate icons). They are made
 * lazily, a few per frame, so opening the screen never stalls the game.
 */
const SIZE = 112;

export class PieceThumbs {
  private cache = new Map<PieceType, string>();
  private queue: PieceType[] = [];
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 1, 0.05, 200);
  private target: THREE.WebGLRenderTarget | null = null;
  private pixels = new Uint8Array(SIZE * SIZE * 4);
  private canvas: HTMLCanvasElement | null = null;
  /** Called when new pictures are ready (the screen re-renders its cards). */
  onReady: () => void = () => {};

  constructor(private renderer: THREE.WebGLRenderer) {
    this.scene.add(new THREE.HemisphereLight(0xfff4dd, 0x5a5040, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(3, 5, 4);
    this.scene.add(sun);
  }

  get(type: PieceType): string | null {
    const url = this.cache.get(type);
    if (url) return url;
    if (!this.queue.includes(type)) this.queue.push(type);
    return null;
  }

  /** Renders up to `n` queued pictures (call once per frame). */
  pump(n = 2): void {
    if (!this.queue.length) return;
    let made = 0;
    while (this.queue.length && made < n) {
      const type = this.queue.shift()!;
      if (this.cache.has(type)) continue;
      try {
        this.cache.set(type, this.render(type));
      } catch {
        this.cache.set(type, '');
      }
      made++;
    }
    if (made) this.onReady();
  }

  private render(type: PieceType): string {
    const obj = createPieceObject(type);
    obj.traverse((o) => {
      if (o instanceof THREE.Light) o.visible = false;
    });
    this.scene.add(obj);
    const box = new THREE.Box3().setFromObject(obj);
    const size = box.getSize(new THREE.Vector3());
    const c = box.getCenter(new THREE.Vector3());
    const r = Math.max(size.x, size.y, size.z) * 0.62 + 0.05;
    const dist = r / Math.tan((this.camera.fov * Math.PI) / 360);
    this.camera.position.copy(c).add(new THREE.Vector3(0.75, 0.55, 1).normalize().multiplyScalar(dist * 1.05));
    this.camera.near = dist / 50;
    this.camera.far = dist * 10;
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(c);
    this.target ??= new THREE.WebGLRenderTarget(SIZE, SIZE, { samples: 4 });
    const r0 = this.renderer.getRenderTarget();
    const clear = this.renderer.getClearColor(new THREE.Color());
    const alpha = this.renderer.getClearAlpha();
    this.renderer.setRenderTarget(this.target);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    this.renderer.readRenderTargetPixels(this.target, 0, 0, SIZE, SIZE, this.pixels);
    this.renderer.setRenderTarget(r0);
    this.renderer.setClearColor(clear, alpha);
    this.scene.remove(obj);
    disposeObject(obj);
    // Render targets hold linear colour: convert to sRGB and flip vertically.
    this.canvas ??= document.createElement('canvas');
    this.canvas.width = this.canvas.height = SIZE;
    const ctx = this.canvas.getContext('2d')!;
    const img = ctx.createImageData(SIZE, SIZE);
    const enc = (v: number) => {
      const l = v / 255;
      return Math.round(255 * (l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055));
    };
    for (let y = 0; y < SIZE; y++)
      for (let x = 0; x < SIZE; x++) {
        const s = ((SIZE - 1 - y) * SIZE + x) * 4;
        const d = (y * SIZE + x) * 4;
        img.data[d] = enc(this.pixels[s]);
        img.data[d + 1] = enc(this.pixels[s + 1]);
        img.data[d + 2] = enc(this.pixels[s + 2]);
        img.data[d + 3] = this.pixels[s + 3];
      }
    ctx.putImageData(img, 0, 0);
    return this.canvas.toDataURL('image/png');
  }

  dispose(): void {
    this.target?.dispose();
    this.target = null;
  }
}
