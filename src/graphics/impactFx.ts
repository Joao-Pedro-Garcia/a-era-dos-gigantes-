import * as THREE from 'three';

/**
 * Small, cheap impact effects: wood splinters, stone chips, leaves, clods,
 * water droplets (solid pieces, one instanced draw call) and dust / mist /
 * spray puffs (soft points, one draw call). Fixed-size pools, no
 * allocation per hit; the counts are halved on the Low preset.
 */
export type ImpactMaterial = 'wood' | 'stone' | 'plant' | 'flesh' | 'dirt' | 'water' | 'metal' | 'crystal';

interface Preset {
  chunks: number;
  chunkColor: [number, number, number];
  chunkVar: number;
  /** Chunk shape scale (x, y, z), metres. */
  size: [number, number, number];
  speed: number;
  gravity: number;
  life: number;
  puffs: number;
  puffColor: [number, number, number];
  puffSize: number;
  puffAlpha: number;
}

const PRESETS: Record<ImpactMaterial, Preset> = {
  wood: { chunks: 7, chunkColor: [0.62, 0.48, 0.32], chunkVar: 0.2, size: [0.012, 0.05, 0.008], speed: 3.2, gravity: 9, life: 0.9, puffs: 2, puffColor: [0.55, 0.47, 0.36], puffSize: 0.18, puffAlpha: 0.35 },
  stone: { chunks: 8, chunkColor: [0.5, 0.48, 0.45], chunkVar: 0.25, size: [0.02, 0.016, 0.018], speed: 3.8, gravity: 9.8, life: 0.8, puffs: 4, puffColor: [0.62, 0.6, 0.56], puffSize: 0.3, puffAlpha: 0.45 },
  plant: { chunks: 9, chunkColor: [0.23, 0.38, 0.12], chunkVar: 0.3, size: [0.03, 0.003, 0.022], speed: 1.8, gravity: 2.2, life: 1.6, puffs: 0, puffColor: [0, 0, 0], puffSize: 0, puffAlpha: 0 },
  flesh: { chunks: 4, chunkColor: [0.32, 0.04, 0.03], chunkVar: 0.15, size: [0.012, 0.012, 0.012], speed: 2.2, gravity: 9.8, life: 0.6, puffs: 2, puffColor: [0.45, 0.38, 0.3], puffSize: 0.22, puffAlpha: 0.25 },
  dirt: { chunks: 5, chunkColor: [0.33, 0.26, 0.18], chunkVar: 0.2, size: [0.02, 0.018, 0.02], speed: 2.4, gravity: 9.8, life: 0.7, puffs: 4, puffColor: [0.5, 0.42, 0.32], puffSize: 0.34, puffAlpha: 0.5 },
  water: { chunks: 12, chunkColor: [0.75, 0.85, 0.9], chunkVar: 0.08, size: [0.012, 0.012, 0.012], speed: 3, gravity: 9.8, life: 0.7, puffs: 3, puffColor: [0.85, 0.9, 0.95], puffSize: 0.4, puffAlpha: 0.3 },
  metal: { chunks: 5, chunkColor: [1.6, 1.1, 0.5], chunkVar: 0.1, size: [0.004, 0.025, 0.004], speed: 4.5, gravity: 6, life: 0.35, puffs: 1, puffColor: [0.5, 0.48, 0.45], puffSize: 0.2, puffAlpha: 0.3 },
  crystal: { chunks: 8, chunkColor: [0.6, 0.8, 0.95], chunkVar: 0.1, size: [0.012, 0.022, 0.012], speed: 3.5, gravity: 9.8, life: 0.8, puffs: 2, puffColor: [0.8, 0.9, 1], puffSize: 0.25, puffAlpha: 0.3 },
};

const MAX_CHUNKS = 128;
const MAX_PUFFS = 64;

export class ImpactFx {
  readonly root = new THREE.Group();
  private chunks: THREE.InstancedMesh;
  private cPos = new Float32Array(MAX_CHUNKS * 3);
  private cVel = new Float32Array(MAX_CHUNKS * 3);
  private cRot = new Float32Array(MAX_CHUNKS * 3);
  private cSpin = new Float32Array(MAX_CHUNKS * 3);
  private cSize = new Float32Array(MAX_CHUNKS * 3);
  private cLife = new Float32Array(MAX_CHUNKS * 2);
  private cGrav = new Float32Array(MAX_CHUNKS);
  private cDrag = new Float32Array(MAX_CHUNKS);
  private nChunks = 0;
  private puffs: THREE.Points;
  private pVel = new Float32Array(MAX_PUFFS * 3);
  private pLife = new Float32Array(MAX_PUFFS * 2);
  private pBase = new Float32Array(MAX_PUFFS * 2); // base size, base alpha
  private nPuffs = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private c = new THREE.Color();
  private seed = 1;
  /** 1 = full counts, 0.5 on the Low preset. */
  detail = 1;
  /** Ground height for chunks to settle on (optional). */
  ground: ((x: number, z: number) => number) | null = null;
  readonly uniforms = { uScale: { value: 400 }, uLight: { value: new THREE.Color(1, 1, 1) } };

  constructor() {
    const geo = new THREE.TetrahedronGeometry(1, 0);
    geo.scale(0.8, 1, 0.8);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0 });
    this.chunks = new THREE.InstancedMesh(geo, mat, MAX_CHUNKS);
    this.chunks.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_CHUNKS * 3), 3);
    this.chunks.count = 0;
    this.chunks.frustumCulled = false;
    this.chunks.userData.noAO = true;

    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_PUFFS * 3), 3));
    pg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(MAX_PUFFS * 3), 3));
    pg.setAttribute('size', new THREE.BufferAttribute(new Float32Array(MAX_PUFFS), 1));
    pg.setAttribute('alpha', new THREE.BufferAttribute(new Float32Array(MAX_PUFFS), 1));
    pg.setDrawRange(0, 0);
    const pm = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      vertexShader: `
attribute float size;
attribute float alpha;
attribute vec3 color;
varying float vA;
varying vec3 vC;
uniform float uScale;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = size * uScale / max(0.1, -mv.z);
  vA = alpha;
  vC = color;
}`,
      fragmentShader: `
varying float vA;
varying vec3 vC;
uniform vec3 uLight;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = dot(d, d) * 4.0;
  if (r > 1.0) discard;
  gl_FragColor = vec4(vC * uLight, vA * (1.0 - r) * (1.0 - r));
}`,
    });
    this.puffs = new THREE.Points(pg, pm);
    this.puffs.frustumCulled = false;
    this.puffs.userData.noAO = true;
    this.puffs.renderOrder = 3;
    this.root.add(this.chunks, this.puffs);
  }

  private rand(): number {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  /**
   * Spawns an impact.
   * @param dir direction the blow travelled (pieces fly back toward the attacker and sideways)
   * @param strength 0.5 (light) … 1.5 (heavy)
   */
  spawn(kind: ImpactMaterial, pos: THREE.Vector3, dir: THREE.Vector3, strength = 1): void {
    const P = PRESETS[kind];
    const nC = Math.round(P.chunks * this.detail * Math.min(1.5, strength));
    const back = this.v.copy(dir).normalize().negate();
    for (let i = 0; i < nC; i++) {
      if (this.nChunks >= MAX_CHUNKS) break;
      const k = this.nChunks++;
      this.cPos.set([pos.x, pos.y, pos.z], k * 3);
      const sp = P.speed * (0.4 + this.rand() * 0.8) * (0.7 + strength * 0.3);
      // A cone around the reflected direction, biased upward.
      const vx = back.x * 0.6 + (this.rand() - 0.5) * 1.4;
      const vy = Math.abs(back.y) * 0.3 + 0.5 + this.rand() * 0.8;
      const vz = back.z * 0.6 + (this.rand() - 0.5) * 1.4;
      const l = Math.hypot(vx, vy, vz);
      this.cVel.set([(vx / l) * sp, (vy / l) * sp, (vz / l) * sp], k * 3);
      this.cRot.set([this.rand() * 6, this.rand() * 6, this.rand() * 6], k * 3);
      this.cSpin.set([(this.rand() - 0.5) * 20, (this.rand() - 0.5) * 20, (this.rand() - 0.5) * 20], k * 3);
      const sc = 0.6 + this.rand() * 0.8;
      this.cSize.set([P.size[0] * sc, P.size[1] * sc, P.size[2] * sc], k * 3);
      const life = P.life * (0.6 + this.rand() * 0.6);
      this.cLife.set([life, life], k * 2);
      this.cGrav[k] = P.gravity;
      this.cDrag[k] = kind === 'plant' ? 2.5 : 0.4;
      const vv = 1 + (this.rand() - 0.5) * 2 * P.chunkVar;
      this.chunks.setColorAt(k, this.c.setRGB(P.chunkColor[0] * vv, P.chunkColor[1] * vv, P.chunkColor[2] * vv));
    }
    const nP = Math.round(P.puffs * this.detail * Math.min(1.5, strength));
    const pa = this.puffs.geometry.attributes;
    for (let i = 0; i < nP; i++) {
      if (this.nPuffs >= MAX_PUFFS) break;
      const k = this.nPuffs++;
      (pa.position as THREE.BufferAttribute).setXYZ(k, pos.x + (this.rand() - 0.5) * 0.1, pos.y + (this.rand() - 0.5) * 0.1, pos.z + (this.rand() - 0.5) * 0.1);
      const vv = 0.9 + this.rand() * 0.2;
      (pa.color as THREE.BufferAttribute).setXYZ(k, P.puffColor[0] * vv, P.puffColor[1] * vv, P.puffColor[2] * vv);
      this.pVel.set([back.x * 0.5 + (this.rand() - 0.5) * 0.8, 0.25 + this.rand() * 0.4, back.z * 0.5 + (this.rand() - 0.5) * 0.8], k * 3);
      const life = 0.7 + this.rand() * 0.6;
      this.pLife.set([life, life], k * 2);
      this.pBase.set([P.puffSize * (0.7 + this.rand() * 0.6), P.puffAlpha], k * 2);
    }
  }

  get active(): number {
    return this.nChunks + this.nPuffs;
  }

  update(dt: number): void {
    // Chunks: ballistic, spinning, settle on the ground, shrink out.
    let i = 0;
    while (i < this.nChunks) {
      const l = (this.cLife[i * 2] -= dt);
      if (l <= 0) {
        this.removeChunk(i);
        continue;
      }
      const o = i * 3;
      const drag = Math.exp(-this.cDrag[i] * dt);
      this.cVel[o] *= drag;
      this.cVel[o + 2] *= drag;
      this.cVel[o + 1] = this.cVel[o + 1] * drag - this.cGrav[i] * dt;
      this.cPos[o] += this.cVel[o] * dt;
      this.cPos[o + 1] += this.cVel[o + 1] * dt;
      this.cPos[o + 2] += this.cVel[o + 2] * dt;
      if (this.ground) {
        const gy = this.ground(this.cPos[o], this.cPos[o + 2]);
        if (this.cPos[o + 1] < gy + 0.01) {
          this.cPos[o + 1] = gy + 0.01;
          this.cVel[o] *= 0.4;
          this.cVel[o + 2] *= 0.4;
          this.cVel[o + 1] = Math.abs(this.cVel[o + 1]) * 0.2;
          this.cSpin[o] *= 0.5;
          this.cSpin[o + 1] *= 0.5;
          this.cSpin[o + 2] *= 0.5;
        }
      }
      this.cRot[o] += this.cSpin[o] * dt;
      this.cRot[o + 1] += this.cSpin[o + 1] * dt;
      this.cRot[o + 2] += this.cSpin[o + 2] * dt;
      const fade = Math.min(1, (l / this.cLife[i * 2 + 1]) * 4);
      this.q.setFromEuler(this.e.set(this.cRot[o], this.cRot[o + 1], this.cRot[o + 2]));
      this.s.set(this.cSize[o] * fade, this.cSize[o + 1] * fade, this.cSize[o + 2] * fade);
      this.m.compose(this.v.set(this.cPos[o], this.cPos[o + 1], this.cPos[o + 2]), this.q, this.s);
      this.chunks.setMatrixAt(i, this.m);
      i++;
    }
    this.chunks.count = this.nChunks;
    this.chunks.instanceMatrix.needsUpdate = true;
    if (this.chunks.instanceColor) this.chunks.instanceColor.needsUpdate = true;

    // Puffs: drift up, expand, fade.
    const pa = this.puffs.geometry.attributes;
    const pos = pa.position as THREE.BufferAttribute;
    const size = pa.size as THREE.BufferAttribute;
    const alpha = pa.alpha as THREE.BufferAttribute;
    i = 0;
    while (i < this.nPuffs) {
      const l = (this.pLife[i * 2] -= dt);
      if (l <= 0) {
        this.removePuff(i);
        continue;
      }
      const t = 1 - l / this.pLife[i * 2 + 1];
      const o = i * 3;
      const d = Math.exp(-2 * dt);
      this.pVel[o] *= d;
      this.pVel[o + 1] *= d;
      this.pVel[o + 2] *= d;
      pos.setXYZ(i, pos.getX(i) + this.pVel[o] * dt, pos.getY(i) + this.pVel[o + 1] * dt, pos.getZ(i) + this.pVel[o + 2] * dt);
      size.setX(i, this.pBase[i * 2] * (0.6 + t * 1.6));
      alpha.setX(i, this.pBase[i * 2 + 1] * Math.min(1, t * 8) * (1 - t));
      i++;
    }
    this.puffs.geometry.setDrawRange(0, this.nPuffs);
    pos.needsUpdate = size.needsUpdate = alpha.needsUpdate = true;
    (pa.color as THREE.BufferAttribute).needsUpdate = true;
    this.root.visible = this.nChunks + this.nPuffs > 0;
  }

  private removeChunk(i: number): void {
    const last = --this.nChunks;
    if (i === last) return;
    for (const [arr, n] of [[this.cPos, 3], [this.cVel, 3], [this.cRot, 3], [this.cSpin, 3], [this.cSize, 3], [this.cLife, 2]] as const)
      for (let j = 0; j < n; j++) arr[i * n + j] = arr[last * n + j];
    this.cGrav[i] = this.cGrav[last];
    this.cDrag[i] = this.cDrag[last];
    this.chunks.getColorAt(last, this.c);
    this.chunks.setColorAt(i, this.c);
  }

  private removePuff(i: number): void {
    const last = --this.nPuffs;
    if (i === last) return;
    const pa = this.puffs.geometry.attributes;
    for (const name of ['position', 'color'] as const) {
      const a = pa[name] as THREE.BufferAttribute;
      a.setXYZ(i, a.getX(last), a.getY(last), a.getZ(last));
    }
    for (let j = 0; j < 3; j++) this.pVel[i * 3 + j] = this.pVel[last * 3 + j];
    for (let j = 0; j < 2; j++) {
      this.pLife[i * 2 + j] = this.pLife[last * 2 + j];
      this.pBase[i * 2 + j] = this.pBase[last * 2 + j];
    }
  }

  clear(): void {
    this.nChunks = 0;
    this.nPuffs = 0;
    this.update(0);
  }

  dispose(): void {
    this.chunks.geometry.dispose();
    (this.chunks.material as THREE.Material).dispose();
    this.puffs.geometry.dispose();
    (this.puffs.material as THREE.Material).dispose();
  }
}
