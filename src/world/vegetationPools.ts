import * as THREE from 'three';

/**
 * World-wide instance pools: one InstancedMesh per plant model (kind ×
 * variant × detail level) shared by every loaded sector, so vegetation costs
 * a few dozen draw calls no matter how many sectors are visible. Instances
 * are added and removed with stable handles (swap-remove keeps the buffers
 * dense; the moved instance's handle is updated).
 */
export interface InstanceHandle {
  pool: InstancePool;
  slot: number;
}

export class InstancePool {
  mesh: THREE.InstancedMesh;
  private handles: InstanceHandle[] = [];
  private tmp = new THREE.Matrix4();
  private tmpC = new THREE.Color();

  constructor(
    private root: THREE.Group,
    private geometry: THREE.BufferGeometry,
    private material: THREE.Material,
    private depthMaterial: THREE.Material | null,
    readonly wantShadow: boolean,
    private shadows: boolean,
    capacity = 64,
  ) {
    this.mesh = this.create(capacity);
  }

  private create(capacity: number): THREE.InstancedMesh {
    const m = new THREE.InstancedMesh(this.geometry, this.material, capacity);
    m.count = 0;
    m.frustumCulled = false;
    m.castShadow = this.shadows;
    m.receiveShadow = true;
    if (this.depthMaterial) m.customDepthMaterial = this.depthMaterial;
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3).fill(1), 3);
    m.userData.vegPool = true;
    this.root.add(m);
    return m;
  }

  get count(): number {
    return this.handles.length;
  }

  add(matrix: THREE.Matrix4, color?: THREE.Color): InstanceHandle {
    if (this.handles.length >= this.mesh.instanceMatrix.count) this.grow();
    const slot = this.handles.length;
    const h: InstanceHandle = { pool: this, slot };
    this.handles.push(h);
    this.mesh.setMatrixAt(slot, matrix);
    this.mesh.setColorAt(slot, color ?? this.tmpC.setRGB(1, 1, 1));
    this.mesh.count = this.handles.length;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor!.needsUpdate = true;
    return h;
  }

  remove(h: InstanceHandle): void {
    if (h.pool !== this || h.slot < 0) return;
    const last = this.handles.length - 1;
    const slot = h.slot;
    if (slot !== last) {
      const moved = this.handles[last];
      this.mesh.getMatrixAt(last, this.tmp);
      this.mesh.setMatrixAt(slot, this.tmp);
      this.mesh.getColorAt(last, this.tmpC);
      this.mesh.setColorAt(slot, this.tmpC);
      moved.slot = slot;
      this.handles[slot] = moved;
    }
    this.handles.pop();
    h.slot = -1;
    this.mesh.count = this.handles.length;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor!.needsUpdate = true;
  }

  getMatrix(h: InstanceHandle, out: THREE.Matrix4): boolean {
    if (h.pool !== this || h.slot < 0) return false;
    this.mesh.getMatrixAt(h.slot, out);
    return true;
  }

  setMatrix(h: InstanceHandle, m: THREE.Matrix4): void {
    if (h.pool !== this || h.slot < 0) return;
    this.mesh.setMatrixAt(h.slot, m);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  private grow(): void {
    const old = this.mesh;
    const next = this.create(old.instanceMatrix.count * 2);
    (next.instanceMatrix.array as Float32Array).set(old.instanceMatrix.array as Float32Array);
    (next.instanceColor!.array as Float32Array).set(old.instanceColor!.array as Float32Array);
    next.count = old.count;
    this.root.remove(old);
    old.dispose();
    this.mesh = next;
  }

  setShadows(on: boolean): void {
    this.shadows = on && this.wantShadow;
    this.mesh.castShadow = this.shadows;
  }

  setMaterial(mat: THREE.Material, depth: THREE.Material | null): void {
    this.material = mat;
    this.depthMaterial = depth;
    this.mesh.material = mat;
    this.mesh.customDepthMaterial = depth ?? undefined;
  }

  dispose(): void {
    this.root.remove(this.mesh);
    this.mesh.dispose();
    this.handles.forEach((h) => (h.slot = -1));
    this.handles = [];
  }
}

export class VegetationPools {
  readonly root = new THREE.Group();
  private pools = new Map<string, InstancePool>();
  material: THREE.Material;
  depthMaterial: THREE.Material | null = null;
  shadows = true;

  constructor(material: THREE.Material) {
    this.root.name = 'vegetation';
    this.material = material;
  }

  pool(key: string, geometry: THREE.BufferGeometry, castShadow: boolean): InstancePool {
    let p = this.pools.get(key);
    if (!p) {
      p = new InstancePool(this.root, geometry, this.material, this.depthMaterial, castShadow, castShadow && this.shadows);
      this.pools.set(key, p);
    }
    return p;
  }

  setMaterials(mat: THREE.Material, depth: THREE.Material | null): void {
    this.material = mat;
    this.depthMaterial = depth;
    for (const p of this.pools.values()) p.setMaterial(mat, depth);
  }

  setShadows(on: boolean): void {
    this.shadows = on;
    for (const p of this.pools.values()) p.setShadows(on);
  }

  get instanceCount(): number {
    let n = 0;
    for (const p of this.pools.values()) n += p.count;
    return n;
  }

  get poolCount(): number {
    return this.pools.size;
  }

  dispose(): void {
    for (const p of this.pools.values()) p.dispose();
    this.pools.clear();
  }
}
