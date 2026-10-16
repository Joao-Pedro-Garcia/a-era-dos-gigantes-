import * as THREE from 'three';

/**
 * Global wind shared by vegetation, water, clouds and particles. Gusts are
 * a slow random walk on top of the weather's wind speed, so trees sway
 * irregularly instead of with a fixed rhythm.
 */
export const WIND = {
  dir: new THREE.Vector2(1, 0),
  /** 0..1 strength used by shaders (≈ windSpeed / 15 m/s with gusts). */
  strength: 0.2,
  uniforms: {
    uWindDir: { value: new THREE.Vector2(1, 0) },
    uWindStrength: { value: 0.2 },
    uWindTime: { value: 0 },
  },
  gust: 0,
  gustTarget: 0,
  gustTimer: 0,
  update(dt: number, dirRad: number, speed: number): void {
    this.dir.set(Math.cos(dirRad), Math.sin(dirRad));
    this.gustTimer -= dt;
    if (this.gustTimer <= 0) {
      this.gustTimer = 2 + Math.random() * 5;
      this.gustTarget = Math.random() * Math.random();
    }
    this.gust += (this.gustTarget - this.gust) * Math.min(1, dt * 0.8);
    this.strength = Math.min(1, speed / 15) * (0.75 + this.gust * 0.6) + 0.05;
    this.uniforms.uWindDir.value.copy(this.dir);
    this.uniforms.uWindStrength.value += (this.strength - this.uniforms.uWindStrength.value) * Math.min(1, dt * 0.5);
    this.uniforms.uWindTime.value += dt;
  },
};
