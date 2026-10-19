/** Biome catalogue: each biome defines its look, resources, climate offset, fauna and hazards. */
export type BiomeId =
  | 'ocean'
  | 'beach'
  | 'plains'
  | 'jungle'
  | 'forest'
  | 'swamp'
  | 'mountain'
  | 'snow'
  | 'volcanic'
  | 'ruins';

export interface VegetationRule {
  kind: VegetationKind;
  /** Instances per 1000 m². */
  density: number;
}

export type VegetationKind =
  | 'conifer'
  | 'broadleaf'
  | 'palm'
  | 'cycad'
  | 'fern'
  | 'bush'
  | 'deadTree'
  | 'rock'
  | 'boulder'
  | 'reeds'
  | 'grass';

export interface BiomeDef {
  id: BiomeId;
  /** Ground colours: [low, high] variation in linear-ish hex. */
  ground: [number, number];
  vegetation: VegetationRule[];
  /** Movement speed multiplier on foot. */
  movement: number;
  /** Base forage (plant food) carrying capacity 0..1. */
  forage: number;
  /** Resource nodes that may appear (item ids). */
  resources: string[];
  hazards: string[];
  /** Relative spawn weights by species id. */
  fauna: Record<string, number>;
}

export const BIOMES: Record<BiomeId, BiomeDef> = {
  ocean: {
    id: 'ocean', ground: [0x6d6550, 0x857a5c], vegetation: [], movement: 0.4, forage: 0,
    resources: [], hazards: ['drowning'], fauna: {},
  },
  beach: {
    id: 'beach', ground: [0xcdbb8a, 0xe0d2a6],
    vegetation: [{ kind: 'palm', density: 0.35 }, { kind: 'rock', density: 0.15 }, { kind: 'grass', density: 0.4 }],
    movement: 0.9, forage: 0.2, resources: ['stone', 'flint', 'fiber'], hazards: [],
    fauna: { pteranodon: 3, compsognathus: 2, protoceratops: 1, dodo: 2.5 },
  },
  plains: {
    id: 'plains', ground: [0x6e7f3a, 0x96964f],
    vegetation: [
      { kind: 'grass', density: 4 }, { kind: 'broadleaf', density: 0.25 }, { kind: 'bush', density: 0.5 },
      { kind: 'rock', density: 0.18 }, { kind: 'cycad', density: 0.15 }, { kind: 'boulder', density: 0.03 },
    ],
    movement: 1, forage: 0.8, resources: ['wood', 'stone', 'fiber', 'berries', 'flint'], hazards: ['wildfire'],
    fauna: {
      triceratops: 4, parasaurolophus: 4, gallimimus: 3, tyrannosaurus: 0.7, ankylosaurus: 2,
      stegosaurus: 2, velociraptor: 1.2, compsognathus: 1.5, pachycephalosaurus: 2, iguanodon: 2, archaeopteryx: 1,
      megatherium: 0.6, smilodon: 0.5,
    },
  },
  jungle: {
    id: 'jungle', ground: [0x3c5226, 0x55692f],
    vegetation: [
      { kind: 'broadleaf', density: 1.5 }, { kind: 'fern', density: 3 }, { kind: 'cycad', density: 0.8 },
      { kind: 'palm', density: 0.4 }, { kind: 'bush', density: 1 }, { kind: 'rock', density: 0.1 },
    ],
    movement: 0.8, forage: 1, resources: ['wood', 'fiber', 'berries', 'herb', 'stone'], hazards: ['disease'],
    fauna: {
      brachiosaurus: 2, dilophosaurus: 2, velociraptor: 1.5, compsognathus: 3, microraptor: 2,
      iguanodon: 2, parasaurolophus: 1.5, carnotaurus: 0.6, therizinosaurus: 1, dodo: 1, anaconda: 0.6, megatherium: 0.5,
    },
  },
  forest: {
    id: 'forest', ground: [0x4a5a2c, 0x5f6b37],
    vegetation: [
      { kind: 'conifer', density: 0.9 }, { kind: 'broadleaf', density: 0.8 }, { kind: 'fern', density: 1.4 },
      { kind: 'bush', density: 0.6 }, { kind: 'grass', density: 1.2 }, { kind: 'rock', density: 0.15 }, { kind: 'deadTree', density: 0.05 },
    ],
    movement: 0.9, forage: 0.85, resources: ['wood', 'fiber', 'berries', 'herb', 'stone'], hazards: ['wildfire'],
    fauna: {
      stegosaurus: 2, iguanodon: 2.5, therizinosaurus: 1, allosaurus: 0.6, velociraptor: 1, pachycephalosaurus: 1.5,
      microraptor: 2, troodon: 1, archaeopteryx: 1.5, parasaurolophus: 1.5, megatherium: 1.2, smilodon: 0.8,
    },
  },
  swamp: {
    id: 'swamp', ground: [0x45482c, 0x5a5634],
    vegetation: [
      { kind: 'reeds', density: 3 }, { kind: 'deadTree', density: 0.3 }, { kind: 'broadleaf', density: 0.35 },
      { kind: 'fern', density: 1.2 },
    ],
    movement: 0.65, forage: 0.7, resources: ['fiber', 'clay', 'herb', 'wood'], hazards: ['flood', 'disease'],
    fauna: { spinosaurus: 1, sarcosuchus: 1.2, parasaurolophus: 2, dilophosaurus: 1, compsognathus: 1.5, baryonyx: 1, deinosuchus: 0.9, anaconda: 1.3 },
  },
  mountain: {
    id: 'mountain', ground: [0x6b665c, 0x8a857a],
    vegetation: [{ kind: 'conifer', density: 0.6 }, { kind: 'rock', density: 0.6 }, { kind: 'boulder', density: 0.12 }],
    movement: 0.75, forage: 0.35, resources: ['stone', 'flint', 'metal_ore', 'wood'], hazards: ['fall', 'cold'],
    fauna: { pachycephalosaurus: 2, quetzalcoatlus: 1, pteranodon: 1.5, allosaurus: 0.8, stegosaurus: 1, smilodon: 0.5 },
  },
  snow: {
    id: 'snow', ground: [0xdfe4ea, 0xf4f6f8],
    vegetation: [{ kind: 'conifer', density: 0.7 }, { kind: 'rock', density: 0.3 }, { kind: 'deadTree', density: 0.08 }],
    movement: 0.7, forage: 0.2, resources: ['wood', 'stone', 'ice'], hazards: ['cold', 'blizzard'],
    fauna: { pachyrhinosaurus: 3, troodon: 1.5, allosaurus: 0.4 },
  },
  volcanic: {
    id: 'volcanic', ground: [0x2c2826, 0x4a3f38],
    vegetation: [{ kind: 'rock', density: 0.6 }, { kind: 'deadTree', density: 0.2 }, { kind: 'boulder', density: 0.15 }],
    movement: 0.85, forage: 0.1, resources: ['obsidian', 'sulfur', 'stone', 'metal_ore'], hazards: ['heat', 'eruption'],
    fauna: { quetzalcoatlus: 0.6, compsognathus: 0.5 },
  },
  ruins: {
    id: 'ruins', ground: [0x6f6e62, 0x8b897b],
    vegetation: [{ kind: 'bush', density: 0.8 }, { kind: 'broadleaf', density: 0.3 }, { kind: 'grass', density: 2 }],
    movement: 0.95, forage: 0.5, resources: ['metal_scrap', 'stone', 'wood'], hazards: [],
    fauna: { compsognathus: 3, velociraptor: 1, dilophosaurus: 0.6 },
  },
};
