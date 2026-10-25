/**
 * 2.5D collision world: vertical cylinders (trunks, rocks) and oriented boxes
 * (building pieces) in a spatial hash. Characters are cylinders too.
 */
export interface CircleCollider {
  kind: 'circle';
  id: string;
  x: number;
  z: number;
  r: number;
  y0: number;
  y1: number;
}

export interface BoxCollider {
  kind: 'box';
  id: string;
  x: number;
  z: number;
  /** Half extents along local x/z. */
  hx: number;
  hz: number;
  rot: number;
  y0: number;
  y1: number;
  /** Walkable top surface (characters can stand on it). */
  walkable: boolean;
  enabled: boolean;
  /** Ramp (stairs): walkable surface rising from y0 at local -z to y1 at +z; never blocks movement. */
  ramp?: boolean;
}

export type Collider = CircleCollider | BoxCollider;

const CELL = 16;

export class CollisionWorld {
  private cells = new Map<string, Set<Collider>>();
  private byId = new Map<string, Collider>();

  private keysFor(c: Collider): string[] {
    const ext = c.kind === 'circle' ? c.r : Math.hypot(c.hx, c.hz);
    const x0 = Math.floor((c.x - ext) / CELL);
    const x1 = Math.floor((c.x + ext) / CELL);
    const z0 = Math.floor((c.z - ext) / CELL);
    const z1 = Math.floor((c.z + ext) / CELL);
    const keys: string[] = [];
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) keys.push(`${x},${z}`);
    return keys;
  }

  add(c: Collider): void {
    if (this.byId.has(c.id)) this.remove(c.id);
    this.byId.set(c.id, c);
    for (const k of this.keysFor(c)) {
      let s = this.cells.get(k);
      if (!s) this.cells.set(k, (s = new Set()));
      s.add(c);
    }
  }

  remove(id: string): void {
    const c = this.byId.get(id);
    if (!c) return;
    this.byId.delete(id);
    for (const k of this.keysFor(c)) {
      const s = this.cells.get(k);
      s?.delete(c);
      if (s && !s.size) this.cells.delete(k);
    }
  }

  get(id: string): Collider | undefined {
    return this.byId.get(id);
  }

  get size(): number {
    return this.byId.size;
  }

  query(x: number, z: number, r: number): Collider[] {
    const out = new Set<Collider>();
    const x0 = Math.floor((x - r) / CELL);
    const x1 = Math.floor((x + r) / CELL);
    const z0 = Math.floor((z - r) / CELL);
    const z1 = Math.floor((z + r) / CELL);
    for (let cx = x0; cx <= x1; cx++)
      for (let cz = z0; cz <= z1; cz++) this.cells.get(`${cx},${cz}`)?.forEach((c) => out.add(c));
    return [...out];
  }

  /** Penetration vector pushing a cylinder (x,z,r) out of collider c, or null. */
  static penetration(c: Collider, x: number, z: number, r: number): [number, number] | null {
    if (c.kind === 'circle') {
      const dx = x - c.x;
      const dz = z - c.z;
      const d = Math.hypot(dx, dz);
      const min = r + c.r;
      if (d >= min) return null;
      if (d < 1e-6) return [min, 0];
      return [(dx / d) * (min - d), (dz / d) * (min - d)];
    }
    if (!c.enabled) return null;
    // Transform into box space.
    const cos = Math.cos(-c.rot);
    const sin = Math.sin(-c.rot);
    const lx = (x - c.x) * cos - (z - c.z) * sin;
    const lz = (x - c.x) * sin + (z - c.z) * cos;
    const qx = Math.max(-c.hx, Math.min(c.hx, lx));
    const qz = Math.max(-c.hz, Math.min(c.hz, lz));
    let px = lx - qx;
    let pz = lz - qz;
    const d = Math.hypot(px, pz);
    let ox: number;
    let oz: number;
    if (d > 1e-6) {
      if (d >= r) return null;
      ox = (px / d) * (r - d);
      oz = (pz / d) * (r - d);
    } else {
      // Centre inside the box: push out along the shallowest axis.
      const dxp = c.hx - Math.abs(lx);
      const dzp = c.hz - Math.abs(lz);
      if (dxp < dzp) {
        ox = Math.sign(lx || 1) * (dxp + r);
        oz = 0;
      } else {
        ox = 0;
        oz = Math.sign(lz || 1) * (dzp + r);
      }
    }
    px = ox * Math.cos(c.rot) - oz * Math.sin(c.rot);
    pz = ox * Math.sin(c.rot) + oz * Math.cos(c.rot);
    return [px, pz];
  }

  /**
   * Resolves a cylinder from feet y to y+height against colliders it overlaps vertically.
   * Walkable tops lower than stepHeight above the feet are ignored (they can be stepped onto).
   */
  resolve(x: number, z: number, r: number, y: number, height: number, stepHeight = 0.5): [number, number] {
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      for (const c of this.query(x, z, r + 1)) {
        if (c.kind === 'box' && c.ramp) continue;
        if (c.y1 <= y + (c.kind === 'box' && c.walkable ? stepHeight : 0.05) || c.y0 >= y + height) continue;
        const p = CollisionWorld.penetration(c, x, z, r);
        if (p) {
          x += p[0];
          z += p[1];
          moved = true;
        }
      }
      if (!moved) break;
    }
    return [x, z];
  }

  blocked(x: number, z: number, r: number, y = -Infinity, height = Infinity): boolean {
    for (const c of this.query(x, z, r + 1)) {
      if (c.kind === 'box' && (!c.enabled || c.ramp)) continue;
      if (y !== -Infinity && (c.y1 <= y + 0.3 || c.y0 >= y + height)) continue;
      if (CollisionWorld.penetration(c, x, z, r)) return true;
    }
    return false;
  }

  /** Highest walkable surface at (x,z) not above maxY (for standing on floors). */
  surfaceAt(x: number, z: number, maxY: number): number {
    let best = -Infinity;
    for (const c of this.query(x, z, 0.5)) {
      if (c.kind !== 'box' || !c.walkable || !c.enabled) continue;
      if (!CollisionWorld.penetration(c, x, z, 0.01)) continue;
      let top = c.y1;
      if (c.ramp) {
        const lz = -(x - c.x) * Math.sin(c.rot) + (z - c.z) * Math.cos(c.rot);
        top = c.y0 + ((lz + c.hz) / (2 * c.hz)) * (c.y1 - c.y0);
      }
      if (top <= maxY && top > best) best = top;
    }
    return best;
  }
}
