/**
 * Skeletons fitted to artist models that the game animates itself.
 *
 * Some realistic models come with few or no usable animation clips. Their skin
 * is re-bound to the game's procedural skeleton (see `rig` in the model
 * manifest), and for that the skeleton's joints must sit where the artist's
 * joints are. These are the artist's bind-pose joint positions, scaled to the
 * game's metres (+z forward, +x left, y up), produced by a tool from the model
 * file. Adults only: juveniles keep their own procedural proportions.
 */
type V3 = [number, number, number];
export interface RigFit {
  /** Spine control points by bone name. */
  cps: Record<string, V3>;
  /** Tail tip. */
  tip: V3;
  head: V3;
  jaw: V3;
  /** Rotation (rad, + opens) that closes the mouth when the artist's bind pose has it open. */
  jawClosed?: number;
  /** Hip/shoulder, knee/elbow, ankle/wrist, toe joint, toe tip. */
  legs: Record<string, [V3, V3, V3, V3, V3]>;
}

export const RIG_FITS: Record<string, RigFit> = {
  // seirogan, "Spinosaurus_animation" (CC BY 4.0), 14 m.
  spinosaurus: {
    // Bound with the mouth open (~38°, from a roar).
    jawClosed: -0.6,
    cps: {
      pelvis: [0.0, 4.531, -0.0],
      torso: [-0.0, 4.322, 1.005],
      chest: [-0.007, 4.091, 1.821],
      neck1: [-0.007, 3.406, 2.438],
      neck2: [-0.007, 3.254, 2.943],
      neck3: [-0.007, 3.658, 3.801],
      tail1: [-0.0, 4.313, -1.309],
      tail2: [-0.0, 4.381, -2.939],
      tail3: [-0.0, 4.635, -4.536],
      tail4: [-0.0, 4.8, -5.945],
    },
    tip: [0.0, 4.938, -7.22],
    head: [-0.007, 4.062, 4.116],
    jaw: [-0.007, 4.062, 4.116],
    legs: {
      hindL: [
        [0.882, 3.715, -0.831],
        [0.904, 2.308, -0.442],
        [0.904, 1.562, -1.402],
        [1.028, 0.68, -0.95],
        [1.005, 0.217, 0.014],
      ],
      hindR: [
        [-0.882, 3.715, -0.831],
        [-0.904, 2.308, -0.442],
        [-0.904, 1.562, -1.402],
        [-1.028, 0.68, -0.95],
        [-1.005, 0.217, 0.014],
      ],
      armL: [
        [0.616, 3.664, 1.882],
        [0.798, 2.52, 1.663],
        [0.596, 1.558, 2.138],
        [0.525, 1.369, 2.339],
        [0.458, 1.054, 2.446],
      ],
      armR: [
        [-0.616, 3.664, 1.882],
        [-0.798, 2.52, 1.663],
        [-0.596, 1.558, 2.138],
        [-0.525, 1.369, 2.339],
        [-0.458, 1.054, 2.446],
      ],
    },
  },
};
