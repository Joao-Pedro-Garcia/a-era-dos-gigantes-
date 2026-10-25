import * as THREE from 'three';
import type { Terrain } from './terrain';

/**
 * Running water that the global sea-level water plane cannot show: the
 * stream on top of the mesa and the waterfall over its northern cliff, with
 * mist and foam at its foot. Built once per world (continent v2) from the
 * terrain itself, so the sheet always clears the rock face.
 */
export interface WaterfallInfo {
  /** Top of the fall (rim of the cliff) and the point where it meets the pool. */
  top: THREE.Vector3;
  bottom: THREE.Vector3;
}

function streakTexture(): THREE.CanvasTexture {
  const w = 64;
  const h = 256;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(200,225,235,0.55)';
  g.fillRect(0, 0, w, h);
  // Deterministic streaks (no Math.random: the same picture every load).
  let s = 7;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 90; i++) {
    const x = rnd() * w;
    const y = rnd() * h;
    const len = 20 + rnd() * 90;
    g.strokeStyle = `rgba(255,255,255,${0.35 + rnd() * 0.6})`;
    g.lineWidth = 1 + rnd() * 3;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (rnd() - 0.5) * 3, y + len);
    g.stroke();
    // Wrap so the texture tiles vertically.
    g.beginPath();
    g.moveTo(x, y - h);
    g.lineTo(x, y - h + len);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function puffTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,0.9)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Pure geometry of the stream and fall (also used by tests). */
export function waterfallPath(terrain: Terrain): { stream: THREE.Vector3[]; info: WaterfallInfo; dir: THREE.Vector3 } | null {
  if (!terrain.v2) return null;
  const prof = terrain.streamProfile();
  if (prof.length < 3) return null;
  const stream = prof.map((p) => new THREE.Vector3(p.x, p.y, p.z));
  const a = stream[stream.length - 2];
  const top = stream[stream.length - 1].clone();
  const dir = new THREE.Vector3(top.x - a.x, 0, top.z - a.z).normalize();
  // The water runs on to the very edge of the cliff.
  let s = 0;
  while (s < 40 && terrain.height(top.x + dir.x * (s + 1), top.z + dir.z * (s + 1)) > top.y - 2) s += 1;
  top.add(dir.clone().multiplyScalar(s));
  stream.push(top.clone());
  return { stream, info: { top, bottom: new THREE.Vector3(top.x, 0.05, top.z) }, dir };
}

export class LandmarkViews {
  readonly root = new THREE.Group();
  readonly waterfall: WaterfallInfo | null = null;
  private streak: THREE.CanvasTexture;
  private streamTex: THREE.CanvasTexture;
  private mats: THREE.Material[] = [];
  private geos: THREE.BufferGeometry[] = [];
  private mist: THREE.Points | null = null;
  private mistSeed: Float32Array | null = null;
  private puff: THREE.CanvasTexture | null = null;

  constructor(terrain: Terrain) {
    this.streak = streakTexture();
    this.streamTex = this.streak.clone();
    this.streamTex.needsUpdate = true;
    const path = waterfallPath(terrain);
    if (!path) return;
    this.waterfall = path.info;
    this.buildStream(path.stream);
    this.buildFall(terrain, path.info, path.dir);
    this.buildMist(path.info.bottom);
  }

  private buildStream(pts: THREE.Vector3[]): void {
    if (pts.length < 2) return;
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    let along = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(pts.length - 1, i + 1)];
      const tx = b.x - a.x;
      const tz = b.z - a.z;
      const l = Math.hypot(tx, tz) || 1;
      const nx = -tz / l;
      const nz = tx / l;
      const w = 3.6;
      if (i > 0) along += pts[i].distanceTo(pts[i - 1]);
      pos.push(pts[i].x + nx * w, pts[i].y, pts[i].z + nz * w, pts[i].x - nx * w, pts[i].y, pts[i].z - nz * w);
      uv.push(0, along / 12, 1, along / 12);
      if (i > 0) {
        const k = i * 2;
        idx.push(k - 2, k - 1, k, k - 1, k + 1, k);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.MeshStandardMaterial({ color: 0x7fa9b8, map: this.streamTex, transparent: true, opacity: 0.85, roughness: 0.15, metalness: 0, depthWrite: false, side: THREE.DoubleSide });
    this.streamTex.repeat.set(1, 1);
    this.add(new THREE.Mesh(g, m), g, m);
  }

  private buildFall(terrain: Terrain, info: WaterfallInfo, dir: THREE.Vector3): void {
    const rows = 18;
    const half = 4.5;
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    let push = 0.5;
    const height = info.top.y - info.bottom.y;
    const reach = Math.hypot(info.bottom.x - info.top.x, info.bottom.z - info.top.z);
    for (let r = 0; r <= rows; r++) {
      const t = r / rows;
      const y = info.top.y - t * height;
      // Clear of the rock at this height, curving out like a real jet of water.
      let s = push;
      while (s < reach && terrain.height(info.top.x + dir.x * s, info.top.z + dir.z * s) > y - 0.8) s += 0.25;
      push = Math.max(push, s + 0.6, Math.sqrt(t) * 3);
      const cx = info.top.x + dir.x * push;
      const cz = info.top.z + dir.z * push;
      const spread = half * (1 + t * 0.35);
      pos.push(cx + side.x * spread, y, cz + side.z * spread, cx - side.x * spread, y, cz - side.z * spread);
      uv.push(0, (t * height) / 10, 1, (t * height) / 10);
      if (r > 0) {
        const k = r * 2;
        idx.push(k - 2, k - 1, k, k - 1, k + 1, k);
      }
    }
    info.bottom.set(info.top.x + dir.x * push, 0.05, info.top.z + dir.z * push);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.MeshStandardMaterial({ color: 0xe8f2f6, map: this.streak, transparent: true, opacity: 0.92, roughness: 0.3, emissive: 0x223038, depthWrite: false, side: THREE.DoubleSide });
    this.add(new THREE.Mesh(g, m), g, m);
    // Foam where it hits the pool.
    const fg = new THREE.CircleGeometry(9, 24);
    fg.rotateX(-Math.PI / 2);
    const fm = new THREE.MeshStandardMaterial({ color: 0xffffff, map: this.streak, transparent: true, opacity: 0.6, roughness: 0.6, depthWrite: false });
    const foam = new THREE.Mesh(fg, fm);
    foam.position.copy(info.bottom).add(new THREE.Vector3(0, 0.08, 0));
    this.add(foam, fg, fm);
  }

  private buildMist(at: THREE.Vector3): void {
    const n = 70;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3));
    g.boundingSphere = new THREE.Sphere(at.clone(), 40);
    this.mistSeed = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      this.mistSeed[i * 3] = (i * 0.618034) % 1;
      this.mistSeed[i * 3 + 1] = (i * 0.381966 + 0.2) % 1;
      this.mistSeed[i * 3 + 2] = (i * 0.754877 + 0.5) % 1;
    }
    this.puff = puffTexture();
    const m = new THREE.PointsMaterial({ map: this.puff, size: 7, transparent: true, opacity: 0.35, depthWrite: false, color: 0xf2f7fa });
    this.mist = new THREE.Points(g, m);
    this.mist.userData.at = at.clone();
    this.add(this.mist, g, m);
  }

  private add(o: THREE.Object3D, g: THREE.BufferGeometry, m: THREE.Material): void {
    o.userData.noAO = true;
    this.root.add(o);
    this.geos.push(g);
    this.mats.push(m);
  }

  /** Animates the water; hidden when far away. */
  update(time: number, camX: number, camZ: number): void {
    const w = this.waterfall;
    this.root.visible = !!w && Math.hypot(camX - w.bottom.x, camZ - w.bottom.z) < 2600;
    if (!this.root.visible) return;
    this.streak.offset.y = (time * 0.9) % 1;
    this.streamTex.offset.y = -(time * 0.25) % 1;
    if (this.mist && this.mistSeed) {
      const at = this.mist.userData.at as THREE.Vector3;
      const p = this.mist.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        const a = this.mistSeed[i * 3] * Math.PI * 2 + time * 0.2;
        const life = (time * (0.12 + this.mistSeed[i * 3 + 2] * 0.1) + this.mistSeed[i * 3 + 1]) % 1;
        const r = 2 + life * 12;
        p.setXYZ(i, at.x + Math.cos(a) * r, at.y + 0.5 + life * 9, at.z + Math.sin(a) * r);
      }
      p.needsUpdate = true;
    }
  }

  dispose(): void {
    this.root.removeFromParent();
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
    this.streak.dispose();
    this.streamTex.dispose();
    this.puff?.dispose();
  }
}
