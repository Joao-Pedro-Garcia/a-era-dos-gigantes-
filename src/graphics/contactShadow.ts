import * as THREE from 'three';

/**
 * Soft dark disc under characters and animals. It grounds them where the
 * shadow map is coarse or disabled (Low preset) and adds the darkening right
 * under the feet that shadow maps lose with their bias.
 */
let tex: THREE.DataTexture | null = null;

function gradient(): THREE.DataTexture {
  if (tex) return tex;
  const n = 64;
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const dx = (x + 0.5) / n - 0.5;
      const dy = (y + 0.5) / n - 0.5;
      const r = Math.sqrt(dx * dx + dy * dy) * 2;
      const a = Math.max(0, 1 - r);
      const o = (y * n + x) * 4;
      data[o] = data[o + 1] = data[o + 2] = 0;
      data[o + 3] = Math.round(255 * a * a * (3 - 2 * a));
    }
  tex = new THREE.DataTexture(data, n, n);
  tex.needsUpdate = true;
  return tex;
}

export function createContactShadow(radius: number, opacity = 0.55): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(radius * 2, radius * 2);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({ map: gradient(), transparent: true, opacity, depthWrite: false, color: 0x000000, fog: false });
  mat.polygonOffset = true;
  mat.polygonOffsetFactor = -2;
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = 1;
  m.userData.noAO = true;
  return m;
}
