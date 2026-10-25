import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

/**
 * Optional post-processing for the High/Ultra presets: ground-truth ambient
 * occlusion (contact shadows between rocks, roots, feet and the ground) and
 * multisampled anti-aliasing in an HDR buffer, then tone mapping/sRGB in the
 * output pass. Lower presets render directly (baked vertex AO only).
 *
 * Objects flagged `userData.noAO` (sky, water, far terrain, particles) are
 * hidden from the AO normal pass so they don't produce false occlusion.
 */
export class PostFx {
  private composer: EffectComposer;
  private gtao: GTAOPass;
  enabled = false;

  constructor(
    private renderer: THREE.WebGLRenderer,
    private scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
  ) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, rt);
    this.composer.addPass(new RenderPass(scene, camera));
    this.gtao = new GTAOPass(scene, camera, size.x, size.y);
    this.gtao.output = GTAOPass.OUTPUT.Default;
    this.gtao.blendIntensity = 0.85;
    this.gtao.updateGtaoMaterial({ radius: 0.9, distanceExponent: 1.6, thickness: 1.2, scale: 1, samples: 12 });
    this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
    // Keep sky, water and particles out of the AO normal/depth pass.
    const g = this.gtao as unknown as { overrideVisibility: () => void; _visibilityCache: Map<THREE.Object3D, boolean> };
    const base = g.overrideVisibility.bind(this.gtao);
    g.overrideVisibility = () => {
      base();
      this.scene.traverse((o) => {
        if (o.userData.noAO) o.visible = false;
      });
    };
    this.composer.addPass(this.gtao);
    this.composer.addPass(new OutputPass());
  }

  setSize(w: number, h: number): void {
    const pr = this.renderer.getPixelRatio();
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
  }

  render(): void {
    if (this.enabled) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.composer.dispose();
    this.gtao.dispose();
  }
}
