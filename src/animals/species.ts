import type { BiomeId } from '../world/biomes';

/**
 * Species catalogue. Every behavioural system reads these parameters, so new
 * species are added here without touching AI or ecosystem code.
 *
 * Paleontological note: the game is a fictional "synthesis" of the Mesozoic.
 * Species from different periods coexist on purpose; each entry records its
 * real period. The look of the film species follows the Jurassic Park/World
 * films where the player asked for it (featherless Velociraptor at film size,
 * Dilophosaurus with its neck frill); pterosaurs and Sarcosuchus are still not
 * dinosaurs. The expanded fauna adds animals from much later times (giant
 * ground sloth, sabre-toothed cat, dodo, anaconda) and Deinosuchus.
 */
export type Diet = 'herbivore' | 'carnivore' | 'piscivore' | 'omnivore';
export type BodyPlan = 'theropod' | 'quadruped' | 'sauropod' | 'hadrosaur' | 'pterosaur' | 'bird' | 'crocodyliform' | 'mosasaur' | 'mammal' | 'serpent';
export type SocialType = 'solitary' | 'pair' | 'family' | 'herd' | 'pack' | 'flock';
export type ThreatResponse = 'flee' | 'defend' | 'charge' | 'mob' | 'freeze';
export type Activity = 'diurnal' | 'nocturnal' | 'crepuscular' | 'cathemeral';
export type Feature =
  | 'horns3' | 'frill' | 'neckFrill' | 'frillSpikes' | 'nasalBoss' | 'crestTube' | 'sail' | 'plates' | 'tailSpikes'
  | 'club' | 'armor' | 'longNeck' | 'feathers' | 'dualCrest' | 'dome' | 'longClaws' | 'longSnout'
  | 'wings' | 'beak' | 'thumbSpike' | 'browHorns' | 'headCrest' | 'scutes' | 'fluke'
  // Mammals and others of the expanded fauna.
  | 'fur' | 'shaggy' | 'sabers' | 'plump' | 'hookBeak';

export interface SpeciesDef {
  id: string;
  name: { 'pt-BR': string; en: string };
  scientificName: string;
  clade: 'dinosaur' | 'pterosaur' | 'crocodyliform' | 'avialan' | 'squamate' | 'mammal';
  period: string;
  diet: Diet;
  ecology: 'apexPredator' | 'mesoPredator' | 'smallPredator' | 'megaHerbivore' | 'largeHerbivore' | 'mediumHerbivore' | 'smallHerbivore' | 'flyer';
  lengthM: number;
  hipHeightM: number;
  massKg: number;
  walkSpeed: number;
  runSpeed: number;
  /** Seconds of sustained sprint before exhaustion. */
  stamina: number;
  /** Multipliers on base need rates. */
  foodNeed: number;
  waterNeed: number;
  social: { type: SocialType; size: [number, number] };
  senses: { sight: number; hearing: number; smell: number; fovDeg: number };
  temperament: { aggression: number; fearfulness: number; curiosity: number };
  territory: { radius: number; defends: boolean };
  activity: Activity;
  /** live: gives birth to live young (no nest); incubationDays is then the gestation. */
  reproduction: { clutch: [number, number]; incubationDays: number; maturityDays: number; parentalCare: number; season: [number, number]; live?: boolean };
  threat: { response: ThreatResponse; flightDistance: number };
  attack: { damage: number; range: number; cooldown: number };
  health: number;
  taming: { possible: boolean; difficulty: number; preferredFood: string[] };
  habitat: BiomeId[];
  tempRange: [number, number];
  /** aquatic: lives only in deep water (never comes ashore). */
  locomotion: { plan: BodyPlan; stride: number; turnRate: number; swims: boolean; flies: boolean; aquatic?: boolean };
  audio: { pitch: number; call: 'roar' | 'bellow' | 'honk' | 'chirp' | 'hiss' | 'screech' | 'grunt' };
  look: { base: number; belly: number; accent: number; pattern: 'plain' | 'stripes' | 'spots' | 'countershade'; features: Feature[] };
  /** Will consider a lone human a potential meal when hungry. */
  huntsHumans: boolean;
}

type Def = Omit<SpeciesDef, 'id'>;

const S: Record<string, Def> = {
  tyrannosaurus: {
    name: { 'pt-BR': 'Tiranossauro', en: 'Tyrannosaurus' }, scientificName: 'Tyrannosaurus rex', clade: 'dinosaur',
    period: 'Cretáceo Superior (~68–66 Ma)', diet: 'carnivore', ecology: 'apexPredator',
    lengthM: 12.3, hipHeightM: 3.6, massKg: 8000, walkSpeed: 2.2, runSpeed: 7.5, stamina: 12, foodNeed: 0.7, waterNeed: 0.8,
    social: { type: 'solitary', size: [1, 1] }, senses: { sight: 140, hearing: 160, smell: 260, fovDeg: 150 },
    temperament: { aggression: 0.7, fearfulness: 0.05, curiosity: 0.4 }, territory: { radius: 900, defends: true },
    activity: 'cathemeral', reproduction: { clutch: [2, 4], incubationDays: 6, maturityDays: 30, parentalCare: 0.5, season: [8, 16] },
    threat: { response: 'charge', flightDistance: 0 }, attack: { damage: 85, range: 4.5, cooldown: 2.2 }, health: 1600,
    taming: { possible: false, difficulty: 1, preferredFood: ['raw_meat'] }, habitat: ['plains', 'jungle'], tempRange: [8, 34],
    locomotion: { plan: 'theropod', stride: 3.6, turnRate: 1.1, swims: true, flies: false },
    audio: { pitch: 55, call: 'bellow' }, look: { base: 0x6a6955, belly: 0xb4ae94, accent: 0x44463a, pattern: 'countershade', features: [] },
    huntsHumans: true,
  },
  velociraptor: {
    name: { 'pt-BR': 'Velocirraptor', en: 'Velociraptor' }, scientificName: 'Velociraptor mongoliensis', clade: 'dinosaur',
    period: 'Cretáceo Superior (~75–71 Ma)', diet: 'carnivore', ecology: 'smallPredator',
    lengthM: 3.6, hipHeightM: 1.0, massKg: 70, walkSpeed: 1.8, runSpeed: 10, stamina: 9, foodNeed: 1.2, waterNeed: 0.8,
    social: { type: 'pack', size: [2, 4] }, senses: { sight: 70, hearing: 90, smell: 120, fovDeg: 200 },
    temperament: { aggression: 0.5, fearfulness: 0.45, curiosity: 0.75 }, territory: { radius: 400, defends: false },
    activity: 'crepuscular', reproduction: { clutch: [3, 6], incubationDays: 3, maturityDays: 10, parentalCare: 0.6, season: [5, 12] },
    threat: { response: 'mob', flightDistance: 14 }, attack: { damage: 18, range: 1.8, cooldown: 1.1 }, health: 160,
    taming: { possible: true, difficulty: 0.75, preferredFood: ['raw_meat'] }, habitat: ['plains', 'jungle', 'ruins'], tempRange: [10, 36],
    locomotion: { plan: 'theropod', stride: 0.9, turnRate: 4, swims: false, flies: false },
    audio: { pitch: 620, call: 'chirp' }, look: { base: 0x5e5940, belly: 0xa89a78, accent: 0x2a2a1e, pattern: 'stripes', features: ['longClaws'] },
    huntsHumans: true,
  },
  triceratops: {
    name: { 'pt-BR': 'Tricerátops', en: 'Triceratops' }, scientificName: 'Triceratops horridus', clade: 'dinosaur',
    period: 'Cretáceo Superior (~68–66 Ma)', diet: 'herbivore', ecology: 'megaHerbivore',
    lengthM: 8.5, hipHeightM: 2.6, massKg: 9000, walkSpeed: 1.8, runSpeed: 7, stamina: 10, foodNeed: 1, waterNeed: 1,
    social: { type: 'family', size: [2, 5] }, senses: { sight: 60, hearing: 110, smell: 120, fovDeg: 220 },
    temperament: { aggression: 0.35, fearfulness: 0.25, curiosity: 0.2 }, territory: { radius: 600, defends: false },
    activity: 'diurnal', reproduction: { clutch: [3, 6], incubationDays: 6, maturityDays: 30, parentalCare: 0.7, season: [10, 20] },
    threat: { response: 'charge', flightDistance: 18 }, attack: { damage: 45, range: 4, cooldown: 2 }, health: 1400,
    taming: { possible: true, difficulty: 0.6, preferredFood: ['berries', 'cycad_fronds'] }, habitat: ['plains'], tempRange: [10, 34],
    locomotion: { plan: 'quadruped', stride: 2.2, turnRate: 0.9, swims: true, flies: false },
    audio: { pitch: 90, call: 'grunt' }, look: { base: 0x77715c, belly: 0xd4c6a8, accent: 0x56603c, pattern: 'countershade', features: ['horns3', 'frill'] },
    huntsHumans: false,
  },
  brachiosaurus: {
    name: { 'pt-BR': 'Braquiossauro', en: 'Brachiosaurus' }, scientificName: 'Brachiosaurus altithorax', clade: 'dinosaur',
    period: 'Jurássico Superior (~154–150 Ma)', diet: 'herbivore', ecology: 'megaHerbivore',
    lengthM: 22, hipHeightM: 5.5, massKg: 40000, walkSpeed: 1.6, runSpeed: 3.6, stamina: 20, foodNeed: 1.4, waterNeed: 1.3,
    social: { type: 'herd', size: [3, 6] }, senses: { sight: 160, hearing: 120, smell: 100, fovDeg: 200 },
    temperament: { aggression: 0.1, fearfulness: 0.15, curiosity: 0.15 }, territory: { radius: 1500, defends: false },
    activity: 'cathemeral', reproduction: { clutch: [8, 14], incubationDays: 8, maturityDays: 45, parentalCare: 0.05, season: [12, 22] },
    threat: { response: 'defend', flightDistance: 10 }, attack: { damage: 70, range: 5, cooldown: 3 }, health: 4200,
    taming: { possible: false, difficulty: 1, preferredFood: ['cycad_fronds'] }, habitat: ['jungle', 'plains', 'swamp'], tempRange: [16, 38],
    locomotion: { plan: 'sauropod', stride: 3.2, turnRate: 0.45, swims: true, flies: false },
    audio: { pitch: 35, call: 'bellow' }, look: { base: 0x8a7448, belly: 0xb8a274, accent: 0x5a4a30, pattern: 'countershade', features: ['longNeck'] },
    huntsHumans: false,
  },
  ankylosaurus: {
    name: { 'pt-BR': 'Anquilossauro', en: 'Ankylosaurus' }, scientificName: 'Ankylosaurus magniventris', clade: 'dinosaur',
    period: 'Cretáceo Superior (~68–66 Ma)', diet: 'herbivore', ecology: 'largeHerbivore',
    lengthM: 7, hipHeightM: 1.5, massKg: 5000, walkSpeed: 1.2, runSpeed: 3, stamina: 8, foodNeed: 0.9, waterNeed: 1,
    social: { type: 'solitary', size: [1, 2] }, senses: { sight: 40, hearing: 70, smell: 140, fovDeg: 200 },
    temperament: { aggression: 0.3, fearfulness: 0.1, curiosity: 0.1 }, territory: { radius: 400, defends: false },
    activity: 'diurnal', reproduction: { clutch: [4, 8], incubationDays: 6, maturityDays: 28, parentalCare: 0.3, season: [10, 20] },
    threat: { response: 'defend', flightDistance: 6 }, attack: { damage: 55, range: 4, cooldown: 2.5 }, health: 1800,
    taming: { possible: true, difficulty: 0.55, preferredFood: ['berries', 'herb'] }, habitat: ['plains', 'jungle'], tempRange: [10, 34],
    locomotion: { plan: 'quadruped', stride: 1.4, turnRate: 0.8, swims: false, flies: false },
    audio: { pitch: 80, call: 'grunt' }, look: { base: 0x7e8260, belly: 0x9a967a, accent: 0x8c8c3a, pattern: 'spots', features: ['armor', 'club', 'scutes'] },
    huntsHumans: false,
  },
  spinosaurus: {
    name: { 'pt-BR': 'Espinossauro', en: 'Spinosaurus' }, scientificName: 'Spinosaurus aegyptiacus', clade: 'dinosaur',
    period: 'Cretáceo Superior (~99–93 Ma)', diet: 'piscivore', ecology: 'apexPredator',
    lengthM: 14, hipHeightM: 2.6, massKg: 7400, walkSpeed: 1.8, runSpeed: 5, stamina: 10, foodNeed: 0.8, waterNeed: 0.4,
    social: { type: 'solitary', size: [1, 1] }, senses: { sight: 110, hearing: 120, smell: 160, fovDeg: 160 },
    temperament: { aggression: 0.45, fearfulness: 0.1, curiosity: 0.3 }, territory: { radius: 700, defends: true },
    activity: 'cathemeral', reproduction: { clutch: [2, 4], incubationDays: 6, maturityDays: 30, parentalCare: 0.4, season: [8, 18] },
    threat: { response: 'charge', flightDistance: 0 }, attack: { damage: 80, range: 4.8, cooldown: 2 }, health: 1900,
    taming: { possible: false, difficulty: 1, preferredFood: ['raw_fish'] }, habitat: ['swamp', 'beach'], tempRange: [18, 40],
    locomotion: { plan: 'theropod', stride: 2.6, turnRate: 1, swims: true, flies: false },
    audio: { pitch: 70, call: 'hiss' }, look: { base: 0x58533f, belly: 0xa59c7f, accent: 0x7a4a33, pattern: 'countershade', features: ['sail', 'longSnout'] },
    huntsHumans: true,
  },
  pteranodon: {
    name: { 'pt-BR': 'Pteranodonte', en: 'Pteranodon' }, scientificName: 'Pteranodon longiceps', clade: 'pterosaur',
    period: 'Cretáceo Superior (~86–84 Ma)', diet: 'piscivore', ecology: 'flyer',
    lengthM: 1.8, hipHeightM: 0.9, massKg: 25, walkSpeed: 1, runSpeed: 14, stamina: 60, foodNeed: 1, waterNeed: 0.6,
    social: { type: 'flock', size: [3, 7] }, senses: { sight: 220, hearing: 70, smell: 40, fovDeg: 220 },
    temperament: { aggression: 0.15, fearfulness: 0.6, curiosity: 0.4 }, territory: { radius: 1200, defends: false },
    activity: 'diurnal', reproduction: { clutch: [1, 2], incubationDays: 5, maturityDays: 15, parentalCare: 0.6, season: [6, 14] },
    threat: { response: 'flee', flightDistance: 22 }, attack: { damage: 6, range: 1.5, cooldown: 1.2 }, health: 60,
    taming: { possible: true, difficulty: 0.7, preferredFood: ['raw_fish'] }, habitat: ['beach', 'mountain'], tempRange: [8, 36],
    locomotion: { plan: 'pterosaur', stride: 0.8, turnRate: 1.6, swims: true, flies: true },
    audio: { pitch: 900, call: 'screech' }, look: { base: 0x8a8578, belly: 0xd8d2c2, accent: 0xa4462a, pattern: 'plain', features: ['wings', 'headCrest', 'beak'] },
    huntsHumans: false,
  },
  quetzalcoatlus: {
    name: { 'pt-BR': 'Quetzalcoatlo', en: 'Quetzalcoatlus' }, scientificName: 'Quetzalcoatlus northropi', clade: 'pterosaur',
    period: 'Cretáceo Superior (~68–66 Ma)', diet: 'carnivore', ecology: 'flyer',
    lengthM: 5, hipHeightM: 2.5, massKg: 220, walkSpeed: 1.5, runSpeed: 16, stamina: 80, foodNeed: 1, waterNeed: 0.6,
    social: { type: 'pair', size: [1, 2] }, senses: { sight: 260, hearing: 80, smell: 40, fovDeg: 200 },
    temperament: { aggression: 0.3, fearfulness: 0.4, curiosity: 0.35 }, territory: { radius: 1800, defends: false },
    activity: 'diurnal', reproduction: { clutch: [1, 2], incubationDays: 6, maturityDays: 25, parentalCare: 0.5, season: [6, 14] },
    threat: { response: 'flee', flightDistance: 25 }, attack: { damage: 22, range: 2.5, cooldown: 1.8 }, health: 260,
    taming: { possible: true, difficulty: 0.85, preferredFood: ['raw_meat'] }, habitat: ['mountain', 'plains', 'volcanic'], tempRange: [6, 38],
    locomotion: { plan: 'pterosaur', stride: 1.6, turnRate: 1.2, swims: false, flies: true },
    audio: { pitch: 400, call: 'screech' }, look: { base: 0x4a4a48, belly: 0x8a7a70, accent: 0x2a4a78, pattern: 'plain', features: ['wings', 'headCrest', 'beak', 'longNeck'] },
    huntsHumans: false,
  },
  parasaurolophus: {
    name: { 'pt-BR': 'Parassaurolofo', en: 'Parasaurolophus' }, scientificName: 'Parasaurolophus walkeri', clade: 'dinosaur',
    period: 'Cretáceo Superior (~77–73 Ma)', diet: 'herbivore', ecology: 'largeHerbivore',
    lengthM: 9.5, hipHeightM: 2.4, massKg: 2600, walkSpeed: 1.8, runSpeed: 9, stamina: 14, foodNeed: 1, waterNeed: 1,
    social: { type: 'herd', size: [4, 10] }, senses: { sight: 120, hearing: 150, smell: 120, fovDeg: 260 },
    temperament: { aggression: 0.05, fearfulness: 0.7, curiosity: 0.3 }, territory: { radius: 900, defends: false },
    activity: 'diurnal', reproduction: { clutch: [6, 10], incubationDays: 5, maturityDays: 22, parentalCare: 0.7, season: [10, 18] },
    threat: { response: 'flee', flightDistance: 40 }, attack: { damage: 15, range: 2.5, cooldown: 2 }, health: 700,
    taming: { possible: true, difficulty: 0.4, preferredFood: ['berries', 'cycad_fronds'] }, habitat: ['plains', 'swamp', 'jungle'], tempRange: [10, 36],
    locomotion: { plan: 'hadrosaur', stride: 2, turnRate: 1.3, swims: true, flies: false },
    audio: { pitch: 140, call: 'honk' }, look: { base: 0xb8986e, belly: 0xe2d2b6, accent: 0x6a4a30, pattern: 'stripes', features: ['crestTube'] },
    huntsHumans: false,
  },
  stegosaurus: {
    name: { 'pt-BR': 'Estegossauro', en: 'Stegosaurus' }, scientificName: 'Stegosaurus stenops', clade: 'dinosaur',
    period: 'Jurássico Superior (~155–150 Ma)', diet: 'herbivore', ecology: 'largeHerbivore',
    lengthM: 7.5, hipHeightM: 2.2, massKg: 4500, walkSpeed: 1.3, runSpeed: 3.8, stamina: 8, foodNeed: 1, waterNeed: 1,
    social: { type: 'family', size: [2, 4] }, senses: { sight: 50, hearing: 80, smell: 120, fovDeg: 220 },
    temperament: { aggression: 0.3, fearfulness: 0.3, curiosity: 0.1 }, territory: { radius: 500, defends: false },
    activity: 'diurnal', reproduction: { clutch: [4, 8], incubationDays: 6, maturityDays: 26, parentalCare: 0.4, season: [10, 20] },
    threat: { response: 'defend', flightDistance: 10 }, attack: { damage: 50, range: 4.5, cooldown: 2.2 }, health: 1300,
    taming: { possible: true, difficulty: 0.5, preferredFood: ['berries', 'fern_fronds'] }, habitat: ['plains', 'mountain'], tempRange: [10, 34],
    locomotion: { plan: 'quadruped', stride: 1.6, turnRate: 0.8, swims: false, flies: false },
    audio: { pitch: 100, call: 'grunt' }, look: { base: 0x6e6c40, belly: 0xa8a070, accent: 0x8a6e42, pattern: 'spots', features: ['plates', 'tailSpikes'] },
    huntsHumans: false,
  },
  dilophosaurus: {
    name: { 'pt-BR': 'Dilofossauro', en: 'Dilophosaurus' }, scientificName: 'Dilophosaurus wetherilli', clade: 'dinosaur',
    period: 'Jurássico Inferior (~193 Ma)', diet: 'carnivore', ecology: 'mesoPredator',
    lengthM: 3.2, hipHeightM: 0.9, massKg: 60, walkSpeed: 2, runSpeed: 9, stamina: 10, foodNeed: 1, waterNeed: 1,
    social: { type: 'pair', size: [1, 3] }, senses: { sight: 100, hearing: 110, smell: 150, fovDeg: 160 },
    temperament: { aggression: 0.5, fearfulness: 0.3, curiosity: 0.5 }, territory: { radius: 500, defends: true },
    activity: 'crepuscular', reproduction: { clutch: [3, 5], incubationDays: 5, maturityDays: 20, parentalCare: 0.5, season: [8, 16] },
    threat: { response: 'defend', flightDistance: 12 }, attack: { damage: 15, range: 1.8, cooldown: 1.4 }, health: 180,
    taming: { possible: true, difficulty: 0.8, preferredFood: ['raw_meat', 'raw_fish'] }, habitat: ['jungle', 'swamp'], tempRange: [14, 38],
    locomotion: { plan: 'theropod', stride: 1.6, turnRate: 2.2, swims: true, flies: false },
    audio: { pitch: 300, call: 'hiss' }, look: { base: 0x6a6438, belly: 0xb4a878, accent: 0x3e3a22, pattern: 'spots', features: ['dualCrest', 'neckFrill'] },
    huntsHumans: true,
  },
  compsognathus: {
    name: { 'pt-BR': 'Compsognato', en: 'Compsognathus' }, scientificName: 'Compsognathus longipes', clade: 'dinosaur',
    period: 'Jurássico Superior (~150 Ma)', diet: 'carnivore', ecology: 'smallPredator',
    lengthM: 1, hipHeightM: 0.25, massKg: 3, walkSpeed: 1.5, runSpeed: 8, stamina: 10, foodNeed: 1.5, waterNeed: 1,
    social: { type: 'flock', size: [4, 9] }, senses: { sight: 50, hearing: 70, smell: 80, fovDeg: 220 },
    temperament: { aggression: 0.25, fearfulness: 0.65, curiosity: 0.9 }, territory: { radius: 250, defends: false },
    activity: 'cathemeral', reproduction: { clutch: [4, 8], incubationDays: 3, maturityDays: 8, parentalCare: 0.3, season: [4, 30] },
    threat: { response: 'flee', flightDistance: 9 }, attack: { damage: 2, range: 0.8, cooldown: 0.8 }, health: 12,
    taming: { possible: true, difficulty: 0.3, preferredFood: ['raw_meat', 'raw_fish'] }, habitat: ['jungle', 'plains', 'ruins', 'beach'], tempRange: [12, 38],
    locomotion: { plan: 'theropod', stride: 0.4, turnRate: 6, swims: false, flies: false },
    audio: { pitch: 1400, call: 'chirp' }, look: { base: 0x6e7c3c, belly: 0xc4ac84, accent: 0xa04a32, pattern: 'countershade', features: [] },
    huntsHumans: false,
  },
  archaeopteryx: {
    name: { 'pt-BR': 'Arqueoptérix', en: 'Archaeopteryx' }, scientificName: 'Archaeopteryx lithographica', clade: 'avialan',
    period: 'Jurássico Superior (~150 Ma)', diet: 'carnivore', ecology: 'flyer',
    lengthM: 0.5, hipHeightM: 0.15, massKg: 0.8, walkSpeed: 1, runSpeed: 9, stamina: 30, foodNeed: 1.5, waterNeed: 1,
    social: { type: 'flock', size: [2, 5] }, senses: { sight: 60, hearing: 60, smell: 20, fovDeg: 260 },
    temperament: { aggression: 0, fearfulness: 0.9, curiosity: 0.5 }, territory: { radius: 200, defends: false },
    activity: 'diurnal', reproduction: { clutch: [2, 4], incubationDays: 2, maturityDays: 6, parentalCare: 0.5, season: [4, 20] },
    threat: { response: 'flee', flightDistance: 10 }, attack: { damage: 0.5, range: 0.5, cooldown: 1 }, health: 4,
    taming: { possible: true, difficulty: 0.4, preferredFood: ['insects', 'berries'] }, habitat: ['plains', 'jungle'], tempRange: [14, 36],
    locomotion: { plan: 'bird', stride: 0.2, turnRate: 6, swims: false, flies: true },
    audio: { pitch: 2400, call: 'chirp' }, look: { base: 0x2b2b2b, belly: 0x6a6a6a, accent: 0x8a6a3a, pattern: 'plain', features: ['feathers', 'wings'] },
    huntsHumans: false,
  },
  microraptor: {
    name: { 'pt-BR': 'Microrraptor', en: 'Microraptor' }, scientificName: 'Microraptor zhaoianus', clade: 'dinosaur',
    period: 'Cretáceo Inferior (~120 Ma)', diet: 'carnivore', ecology: 'flyer',
    lengthM: 0.8, hipHeightM: 0.2, massKg: 1.2, walkSpeed: 1.2, runSpeed: 8, stamina: 25, foodNeed: 1.4, waterNeed: 1,
    social: { type: 'solitary', size: [1, 2] }, senses: { sight: 70, hearing: 60, smell: 30, fovDeg: 240 },
    temperament: { aggression: 0.05, fearfulness: 0.8, curiosity: 0.6 }, territory: { radius: 200, defends: false },
    activity: 'diurnal', reproduction: { clutch: [2, 4], incubationDays: 2, maturityDays: 6, parentalCare: 0.4, season: [4, 20] },
    threat: { response: 'flee', flightDistance: 10 }, attack: { damage: 1, range: 0.6, cooldown: 1 }, health: 6,
    taming: { possible: true, difficulty: 0.5, preferredFood: ['raw_fish', 'insects'] }, habitat: ['jungle'], tempRange: [14, 36],
    locomotion: { plan: 'bird', stride: 0.25, turnRate: 5, swims: false, flies: true },
    audio: { pitch: 2000, call: 'chirp' }, look: { base: 0x18181a, belly: 0x2a2a2e, accent: 0x6a2a1e, pattern: 'plain', features: ['feathers', 'wings'] },
    huntsHumans: false,
  },
  gallimimus: {
    name: { 'pt-BR': 'Galimimo', en: 'Gallimimus' }, scientificName: 'Gallimimus bullatus', clade: 'dinosaur',
    period: 'Cretáceo Superior (~70 Ma)', diet: 'omnivore', ecology: 'mediumHerbivore',
    lengthM: 6, hipHeightM: 1.9, massKg: 440, walkSpeed: 2, runSpeed: 13, stamina: 18, foodNeed: 1, waterNeed: 1,
    social: { type: 'herd', size: [5, 12] }, senses: { sight: 150, hearing: 120, smell: 60, fovDeg: 280 },
    temperament: { aggression: 0, fearfulness: 0.9, curiosity: 0.35 }, territory: { radius: 900, defends: false },
    activity: 'diurnal', reproduction: { clutch: [4, 8], incubationDays: 4, maturityDays: 16, parentalCare: 0.4, season: [8, 18] },
    threat: { response: 'flee', flightDistance: 45 }, attack: { damage: 4, range: 1.2, cooldown: 1.5 }, health: 160,
    taming: { possible: true, difficulty: 0.45, preferredFood: ['berries', 'insects'] }, habitat: ['plains'], tempRange: [12, 38],
    locomotion: { plan: 'theropod', stride: 2.2, turnRate: 3, swims: false, flies: false },
    audio: { pitch: 700, call: 'honk' }, look: { base: 0x9a7a42, belly: 0xdcc9a0, accent: 0x6a5230, pattern: 'countershade', features: ['beak', 'longNeck'] },
    huntsHumans: false,
  },
  pachycephalosaurus: {
    name: { 'pt-BR': 'Paquicefalossauro', en: 'Pachycephalosaurus' }, scientificName: 'Pachycephalosaurus wyomingensis', clade: 'dinosaur',
    period: 'Cretáceo Superior (~68–66 Ma)', diet: 'herbivore', ecology: 'mediumHerbivore',
    lengthM: 4.5, hipHeightM: 1.4, massKg: 400, walkSpeed: 1.8, runSpeed: 8, stamina: 10, foodNeed: 1, waterNeed: 1,
    social: { type: 'herd', size: [3, 7] }, senses: { sight: 90, hearing: 110, smell: 80, fovDeg: 240 },
    temperament: { aggression: 0.35, fearfulness: 0.5, curiosity: 0.4 }, territory: { radius: 500, defends: true },
    activity: 'diurnal', reproduction: { clutch: [3, 6], incubationDays: 4, maturityDays: 16, parentalCare: 0.4, season: [10, 18] },
    threat: { response: 'charge', flightDistance: 16 }, attack: { damage: 20, range: 1.8, cooldown: 2 }, health: 260,
    taming: { possible: true, difficulty: 0.5, preferredFood: ['berries', 'herb'] }, habitat: ['plains', 'mountain'], tempRange: [6, 34],
    locomotion: { plan: 'theropod', stride: 1.4, turnRate: 2.4, swims: false, flies: false },
    audio: { pitch: 260, call: 'grunt' }, look: { base: 0x6e5c40, belly: 0xb09c76, accent: 0x5b7a8a, pattern: 'spots', features: ['dome'] },
    huntsHumans: false,
  },
  iguanodon: {
    name: { 'pt-BR': 'Iguanodonte', en: 'Iguanodon' }, scientificName: 'Iguanodon bernissartensis', clade: 'dinosaur',
    period: 'Cretáceo Inferior (~126–122 Ma)', diet: 'herbivore', ecology: 'largeHerbivore',
    lengthM: 10, hipHeightM: 2.5, massKg: 3500, walkSpeed: 1.7, runSpeed: 6.5, stamina: 12, foodNeed: 1, waterNeed: 1,
    social: { type: 'herd', size: [4, 9] }, senses: { sight: 100, hearing: 120, smell: 110, fovDeg: 240 },
    temperament: { aggression: 0.2, fearfulness: 0.5, curiosity: 0.2 }, territory: { radius: 800, defends: false },
    activity: 'diurnal', reproduction: { clutch: [6, 10], incubationDays: 5, maturityDays: 24, parentalCare: 0.5, season: [10, 18] },
    threat: { response: 'defend', flightDistance: 28 }, attack: { damage: 25, range: 2.5, cooldown: 1.8 }, health: 850,
    taming: { possible: true, difficulty: 0.45, preferredFood: ['fern_fronds', 'berries'] }, habitat: ['plains', 'jungle'], tempRange: [10, 34],
    locomotion: { plan: 'hadrosaur', stride: 2, turnRate: 1.2, swims: true, flies: false },
    audio: { pitch: 120, call: 'bellow' }, look: { base: 0x6c6c66, belly: 0xb4a284, accent: 0x4a4a44, pattern: 'stripes', features: ['thumbSpike'] },
    huntsHumans: false,
  },
  allosaurus: {
    name: { 'pt-BR': 'Alossauro', en: 'Allosaurus' }, scientificName: 'Allosaurus fragilis', clade: 'dinosaur',
    period: 'Jurássico Superior (~155–145 Ma)', diet: 'carnivore', ecology: 'apexPredator',
    lengthM: 9, hipHeightM: 2.6, massKg: 2000, walkSpeed: 2.2, runSpeed: 8.5, stamina: 10, foodNeed: 0.9, waterNeed: 0.9,
    social: { type: 'solitary', size: [1, 2] }, senses: { sight: 120, hearing: 130, smell: 200, fovDeg: 160 },
    temperament: { aggression: 0.6, fearfulness: 0.1, curiosity: 0.4 }, territory: { radius: 800, defends: true },
    activity: 'cathemeral', reproduction: { clutch: [3, 5], incubationDays: 5, maturityDays: 25, parentalCare: 0.3, season: [8, 16] },
    threat: { response: 'charge', flightDistance: 0 }, attack: { damage: 55, range: 3.2, cooldown: 1.8 }, health: 900,
    taming: { possible: false, difficulty: 1, preferredFood: ['raw_meat'] }, habitat: ['mountain', 'plains', 'snow'], tempRange: [0, 34],
    locomotion: { plan: 'theropod', stride: 2.6, turnRate: 1.5, swims: true, flies: false },
    audio: { pitch: 85, call: 'roar' }, look: { base: 0x6a5238, belly: 0xb0997a, accent: 0x9a3a22, pattern: 'stripes', features: ['browHorns'] },
    huntsHumans: true,
  },
  carnotaurus: {
    name: { 'pt-BR': 'Carnotauro', en: 'Carnotaurus' }, scientificName: 'Carnotaurus sastrei', clade: 'dinosaur',
    period: 'Cretáceo Superior (~72–69 Ma)', diet: 'carnivore', ecology: 'apexPredator',
    lengthM: 8, hipHeightM: 2.2, massKg: 1500, walkSpeed: 2.4, runSpeed: 10, stamina: 9, foodNeed: 0.9, waterNeed: 0.9,
    social: { type: 'solitary', size: [1, 1] }, senses: { sight: 110, hearing: 120, smell: 180, fovDeg: 150 },
    temperament: { aggression: 0.65, fearfulness: 0.1, curiosity: 0.3 }, territory: { radius: 700, defends: true },
    activity: 'crepuscular', reproduction: { clutch: [2, 4], incubationDays: 5, maturityDays: 22, parentalCare: 0.3, season: [8, 16] },
    threat: { response: 'charge', flightDistance: 0 }, attack: { damage: 45, range: 3, cooldown: 1.6 }, health: 750,
    taming: { possible: false, difficulty: 1, preferredFood: ['raw_meat'] }, habitat: ['plains', 'jungle'], tempRange: [10, 36],
    locomotion: { plan: 'theropod', stride: 2.6, turnRate: 1.2, swims: false, flies: false },
    audio: { pitch: 95, call: 'roar' }, look: { base: 0x6e3a24, belly: 0xb08868, accent: 0x1c120c, pattern: 'spots', features: ['browHorns'] },
    huntsHumans: true,
  },
  therizinosaurus: {
    name: { 'pt-BR': 'Terizinossauro', en: 'Therizinosaurus' }, scientificName: 'Therizinosaurus cheloniformis', clade: 'dinosaur',
    period: 'Cretáceo Superior (~70 Ma)', diet: 'herbivore', ecology: 'largeHerbivore',
    lengthM: 9, hipHeightM: 2.8, massKg: 5000, walkSpeed: 1.4, runSpeed: 5, stamina: 9, foodNeed: 1, waterNeed: 1,
    social: { type: 'solitary', size: [1, 1] }, senses: { sight: 80, hearing: 100, smell: 120, fovDeg: 200 },
    temperament: { aggression: 0.45, fearfulness: 0.2, curiosity: 0.2 }, territory: { radius: 500, defends: true },
    activity: 'diurnal', reproduction: { clutch: [4, 8], incubationDays: 6, maturityDays: 28, parentalCare: 0.4, season: [10, 18] },
    threat: { response: 'defend', flightDistance: 12 }, attack: { damage: 50, range: 3.5, cooldown: 2 }, health: 1200,
    taming: { possible: true, difficulty: 0.7, preferredFood: ['berries', 'fern_fronds'] }, habitat: ['jungle', 'plains'], tempRange: [12, 36],
    locomotion: { plan: 'theropod', stride: 1.6, turnRate: 1, swims: false, flies: false },
    audio: { pitch: 160, call: 'grunt' }, look: { base: 0x3c3a36, belly: 0x5c5650, accent: 0x24221f, pattern: 'plain', features: ['feathers', 'longClaws', 'longNeck', 'beak'] },
    huntsHumans: false,
  },
  baryonyx: {
    name: { 'pt-BR': 'Barionix', en: 'Baryonyx' }, scientificName: 'Baryonyx walkeri', clade: 'dinosaur',
    period: 'Cretáceo Inferior (~130–125 Ma)', diet: 'piscivore', ecology: 'mesoPredator',
    lengthM: 8, hipHeightM: 2, massKg: 1500, walkSpeed: 1.9, runSpeed: 7, stamina: 10, foodNeed: 0.9, waterNeed: 0.5,
    social: { type: 'solitary', size: [1, 1] }, senses: { sight: 100, hearing: 110, smell: 150, fovDeg: 160 },
    temperament: { aggression: 0.35, fearfulness: 0.25, curiosity: 0.35 }, territory: { radius: 600, defends: true },
    activity: 'cathemeral', reproduction: { clutch: [2, 4], incubationDays: 5, maturityDays: 22, parentalCare: 0.3, season: [8, 18] },
    threat: { response: 'defend', flightDistance: 8 }, attack: { damage: 35, range: 3, cooldown: 1.6 }, health: 700,
    taming: { possible: true, difficulty: 0.8, preferredFood: ['raw_fish'] }, habitat: ['swamp', 'beach'], tempRange: [14, 36],
    locomotion: { plan: 'theropod', stride: 2, turnRate: 1.3, swims: true, flies: false },
    audio: { pitch: 120, call: 'hiss' }, look: { base: 0x6a6a44, belly: 0xb4aa80, accent: 0x96462e, pattern: 'countershade', features: ['longSnout', 'longClaws'] },
    huntsHumans: true,
  },
  sarcosuchus: {
    name: { 'pt-BR': 'Sarcosuco', en: 'Sarcosuchus' }, scientificName: 'Sarcosuchus imperator', clade: 'crocodyliform',
    period: 'Cretáceo Inferior (~112 Ma)', diet: 'carnivore', ecology: 'apexPredator',
    lengthM: 9.5, hipHeightM: 0.9, massKg: 3500, walkSpeed: 0.9, runSpeed: 4, stamina: 4, foodNeed: 0.4, waterNeed: 0.2,
    social: { type: 'solitary', size: [1, 1] }, senses: { sight: 60, hearing: 80, smell: 80, fovDeg: 200 },
    temperament: { aggression: 0.6, fearfulness: 0.1, curiosity: 0.1 }, territory: { radius: 300, defends: true },
    activity: 'cathemeral', reproduction: { clutch: [10, 20], incubationDays: 6, maturityDays: 35, parentalCare: 0.3, season: [10, 18] },
    threat: { response: 'charge', flightDistance: 0 }, attack: { damage: 60, range: 3, cooldown: 2.5 }, health: 1300,
    taming: { possible: false, difficulty: 1, preferredFood: ['raw_meat'] }, habitat: ['swamp'], tempRange: [18, 40],
    locomotion: { plan: 'crocodyliform', stride: 1.2, turnRate: 0.9, swims: true, flies: false },
    audio: { pitch: 60, call: 'hiss' }, look: { base: 0x6a5236, belly: 0xa89068, accent: 0x3a2a1a, pattern: 'stripes', features: ['longSnout', 'scutes'] },
    huntsHumans: true,
  },
  protoceratops: {
    name: { 'pt-BR': 'Protocerátops', en: 'Protoceratops' }, scientificName: 'Protoceratops andrewsi', clade: 'dinosaur',
    period: 'Cretáceo Superior (~75–71 Ma)', diet: 'herbivore', ecology: 'smallHerbivore',
    lengthM: 2, hipHeightM: 0.6, massKg: 85, walkSpeed: 1.2, runSpeed: 6, stamina: 8, foodNeed: 1, waterNeed: 0.7,
    social: { type: 'herd', size: [3, 8] }, senses: { sight: 60, hearing: 80, smell: 70, fovDeg: 240 },
    temperament: { aggression: 0.2, fearfulness: 0.6, curiosity: 0.4 }, territory: { radius: 300, defends: false },
    activity: 'crepuscular', reproduction: { clutch: [6, 12], incubationDays: 4, maturityDays: 12, parentalCare: 0.6, season: [8, 18] },
    threat: { response: 'mob', flightDistance: 15 }, attack: { damage: 6, range: 1.2, cooldown: 1.4 }, health: 90,
    taming: { possible: true, difficulty: 0.3, preferredFood: ['berries', 'cycad_fronds'] }, habitat: ['beach', 'plains'], tempRange: [10, 38],
    locomotion: { plan: 'quadruped', stride: 0.6, turnRate: 2.4, swims: false, flies: false },
    audio: { pitch: 380, call: 'grunt' }, look: { base: 0x6e6038, belly: 0xb0a070, accent: 0x4a4026, pattern: 'countershade', features: ['frill', 'beak'] },
    huntsHumans: false,
  },
  pachyrhinosaurus: {
    name: { 'pt-BR': 'Paquirrinossauro', en: 'Pachyrhinosaurus' }, scientificName: 'Pachyrhinosaurus perotorum', clade: 'dinosaur',
    period: 'Cretáceo Superior (~70–69 Ma, Ártico)', diet: 'herbivore', ecology: 'largeHerbivore',
    lengthM: 6, hipHeightM: 2, massKg: 3000, walkSpeed: 1.6, runSpeed: 6, stamina: 12, foodNeed: 1, waterNeed: 0.8,
    social: { type: 'herd', size: [4, 10] }, senses: { sight: 70, hearing: 100, smell: 110, fovDeg: 230 },
    temperament: { aggression: 0.3, fearfulness: 0.35, curiosity: 0.2 }, territory: { radius: 1000, defends: false },
    activity: 'diurnal', reproduction: { clutch: [4, 8], incubationDays: 6, maturityDays: 26, parentalCare: 0.6, season: [14, 22] },
    threat: { response: 'charge', flightDistance: 20 }, attack: { damage: 35, range: 3, cooldown: 2 }, health: 1000,
    taming: { possible: true, difficulty: 0.55, preferredFood: ['berries', 'fern_fronds'] }, habitat: ['snow', 'mountain'], tempRange: [-12, 22],
    locomotion: { plan: 'quadruped', stride: 1.8, turnRate: 1, swims: true, flies: false },
    audio: { pitch: 110, call: 'bellow' }, look: { base: 0x8a9598, belly: 0xd2cab0, accent: 0x4a5250, pattern: 'stripes', features: ['nasalBoss', 'frill', 'frillSpikes'] },
    huntsHumans: false,
  },
  troodon: {
    name: { 'pt-BR': 'Troodonte', en: 'Troodon' }, scientificName: 'Troodon formosus', clade: 'dinosaur',
    period: 'Cretáceo Superior (~77 Ma)', diet: 'omnivore', ecology: 'smallPredator',
    lengthM: 2.4, hipHeightM: 0.8, massKg: 50, walkSpeed: 1.6, runSpeed: 10, stamina: 10, foodNeed: 1.2, waterNeed: 1,
    social: { type: 'pack', size: [2, 4] }, senses: { sight: 110, hearing: 100, smell: 100, fovDeg: 160 },
    temperament: { aggression: 0.35, fearfulness: 0.45, curiosity: 0.85 }, territory: { radius: 400, defends: false },
    activity: 'nocturnal', reproduction: { clutch: [8, 16], incubationDays: 4, maturityDays: 12, parentalCare: 0.7, season: [10, 20] },
    threat: { response: 'mob', flightDistance: 16 }, attack: { damage: 10, range: 1.3, cooldown: 1 }, health: 80,
    taming: { possible: true, difficulty: 0.65, preferredFood: ['raw_meat', 'berries'] }, habitat: ['snow', 'mountain', 'plains'], tempRange: [-10, 30],
    locomotion: { plan: 'theropod', stride: 1, turnRate: 4, swims: false, flies: false },
    audio: { pitch: 800, call: 'chirp' }, look: { base: 0xa47a3a, belly: 0xd4b484, accent: 0x9a4a2a, pattern: 'countershade', features: ['longClaws'] },
    huntsHumans: true,
  },
  mosasaurus: {
    // Not a dinosaur: a giant marine squamate (a lizard related to monitors and snakes).
    // Paddle-shaped limbs, a long tail ending in a downturned crescent fluke (known
    // from exceptionally preserved mosasaurs), dark back and pale belly.
    name: { 'pt-BR': 'Mosassauro', en: 'Mosasaurus' }, scientificName: 'Mosasaurus hoffmannii', clade: 'squamate',
    period: 'Cretáceo Superior (~82–66 Ma)', diet: 'carnivore', ecology: 'apexPredator',
    lengthM: 12.5, hipHeightM: 1.3, massKg: 9000, walkSpeed: 2.2, runSpeed: 9, stamina: 20, foodNeed: 0.6, waterNeed: 0,
    social: { type: 'solitary', size: [1, 1] }, senses: { sight: 90, hearing: 60, smell: 140, fovDeg: 160 },
    temperament: { aggression: 0.75, fearfulness: 0.05, curiosity: 0.3 }, territory: { radius: 700, defends: true },
    activity: 'cathemeral', reproduction: { clutch: [1, 2], incubationDays: 8, maturityDays: 40, parentalCare: 0.1, season: [10, 18] },
    threat: { response: 'charge', flightDistance: 0 }, attack: { damage: 90, range: 4.5, cooldown: 2.4 }, health: 1500,
    taming: { possible: false, difficulty: 1, preferredFood: ['raw_fish'] }, habitat: ['ocean'], tempRange: [12, 34],
    locomotion: { plan: 'mosasaur', stride: 3, turnRate: 0.8, swims: true, flies: false, aquatic: true },
    audio: { pitch: 50, call: 'grunt' }, look: { base: 0x3a4448, belly: 0xb0a074, accent: 0x6a2a22, pattern: 'countershade', features: ['fluke'] },
    huntsHumans: true,
  },
  deinosuchus: {
    name: { 'pt-BR': 'Deinosuco', en: 'Deinosuchus' }, scientificName: 'Deinosuchus riograndensis', clade: 'crocodyliform',
    period: 'Cretáceo Superior (~82–73 Ma)', diet: 'carnivore', ecology: 'apexPredator',
    lengthM: 10.5, hipHeightM: 0.95, massKg: 4000, walkSpeed: 0.9, runSpeed: 4.2, stamina: 4, foodNeed: 0.4, waterNeed: 0.2,
    social: { type: 'solitary', size: [1, 1] }, senses: { sight: 70, hearing: 80, smell: 90, fovDeg: 200 },
    temperament: { aggression: 0.65, fearfulness: 0.05, curiosity: 0.1 }, territory: { radius: 350, defends: true },
    activity: 'cathemeral', reproduction: { clutch: [20, 40], incubationDays: 7, maturityDays: 40, parentalCare: 0.4, season: [10, 18] },
    threat: { response: 'charge', flightDistance: 0 }, attack: { damage: 75, range: 3.2, cooldown: 2.6 }, health: 1600,
    taming: { possible: false, difficulty: 1, preferredFood: ['raw_meat'] }, habitat: ['swamp', 'beach'], tempRange: [18, 40],
    locomotion: { plan: 'crocodyliform', stride: 1.3, turnRate: 0.8, swims: true, flies: false },
    audio: { pitch: 45, call: 'hiss' }, look: { base: 0x34382a, belly: 0x8c8a66, accent: 0x20231a, pattern: 'spots', features: ['scutes'] },
    huntsHumans: true,
  },
  megatherium: {
    name: { 'pt-BR': 'Megatério', en: 'Megatherium' }, scientificName: 'Megatherium americanum', clade: 'mammal',
    period: 'Pleistoceno (~2 Ma–12 mil anos)', diet: 'herbivore', ecology: 'megaHerbivore',
    lengthM: 6, hipHeightM: 1.9, massKg: 4000, walkSpeed: 1, runSpeed: 3, stamina: 8, foodNeed: 1.2, waterNeed: 1,
    social: { type: 'solitary', size: [1, 2] }, senses: { sight: 50, hearing: 90, smell: 130, fovDeg: 200 },
    temperament: { aggression: 0.25, fearfulness: 0.2, curiosity: 0.2 }, territory: { radius: 600, defends: false },
    activity: 'diurnal', reproduction: { clutch: [1, 1], incubationDays: 12, maturityDays: 40, parentalCare: 0.9, season: [8, 20], live: true },
    threat: { response: 'defend', flightDistance: 8 }, attack: { damage: 55, range: 3, cooldown: 2.2 }, health: 1500,
    taming: { possible: true, difficulty: 0.6, preferredFood: ['berries', 'fern_fronds'] }, habitat: ['forest', 'plains', 'jungle'], tempRange: [0, 32],
    locomotion: { plan: 'mammal', stride: 1.6, turnRate: 0.7, swims: false, flies: false },
    audio: { pitch: 70, call: 'grunt' }, look: { base: 0x8a6e44, belly: 0xa8906a, accent: 0x5a4630, pattern: 'plain', features: ['fur', 'shaggy', 'longClaws'] },
    huntsHumans: false,
  },
  smilodon: {
    name: { 'pt-BR': 'Smilodonte', en: 'Smilodon' }, scientificName: 'Smilodon populator', clade: 'mammal',
    period: 'Pleistoceno (~1 Ma–10 mil anos)', diet: 'carnivore', ecology: 'mesoPredator',
    lengthM: 2.1, hipHeightM: 0.85, massKg: 300, walkSpeed: 1.4, runSpeed: 11, stamina: 6, foodNeed: 1, waterNeed: 1,
    social: { type: 'pair', size: [1, 3] }, senses: { sight: 130, hearing: 140, smell: 130, fovDeg: 200 },
    temperament: { aggression: 0.6, fearfulness: 0.25, curiosity: 0.4 }, territory: { radius: 700, defends: true },
    activity: 'crepuscular', reproduction: { clutch: [1, 3], incubationDays: 4, maturityDays: 18, parentalCare: 0.8, season: [6, 16], live: true },
    threat: { response: 'charge', flightDistance: 6 }, attack: { damage: 42, range: 2, cooldown: 1.4 }, health: 380,
    taming: { possible: true, difficulty: 0.75, preferredFood: ['raw_meat'] }, habitat: ['plains', 'forest', 'mountain'], tempRange: [-4, 32],
    locomotion: { plan: 'mammal', stride: 1.4, turnRate: 2.4, swims: true, flies: false },
    audio: { pitch: 160, call: 'roar' }, look: { base: 0xa8875a, belly: 0xdcc8a2, accent: 0x2e2014, pattern: 'spots', features: ['fur', 'sabers'] },
    huntsHumans: true,
  },
  dodo: {
    name: { 'pt-BR': 'Dodô', en: 'Dodo' }, scientificName: 'Raphus cucullatus', clade: 'avialan',
    period: 'Holoceno (extinto ~1681)', diet: 'herbivore', ecology: 'smallHerbivore',
    lengthM: 0.75, hipHeightM: 0.22, massKg: 14, walkSpeed: 0.9, runSpeed: 3.2, stamina: 6, foodNeed: 1, waterNeed: 1,
    social: { type: 'flock', size: [3, 8] }, senses: { sight: 40, hearing: 40, smell: 30, fovDeg: 280 },
    temperament: { aggression: 0.05, fearfulness: 0.35, curiosity: 0.8 }, territory: { radius: 200, defends: false },
    activity: 'diurnal', reproduction: { clutch: [1, 1], incubationDays: 3, maturityDays: 8, parentalCare: 0.7, season: [6, 18] },
    threat: { response: 'flee', flightDistance: 5 }, attack: { damage: 2, range: 0.6, cooldown: 1.2 }, health: 30,
    taming: { possible: true, difficulty: 0.1, preferredFood: ['berries'] }, habitat: ['beach', 'jungle', 'forest'], tempRange: [16, 36],
    locomotion: { plan: 'bird', stride: 0.35, turnRate: 4, swims: false, flies: false },
    audio: { pitch: 700, call: 'honk' }, look: { base: 0x7d7a74, belly: 0xb2aca0, accent: 0xe8e2d2, pattern: 'countershade', features: ['feathers', 'beak', 'hookBeak', 'plump'] },
    huntsHumans: false,
  },
  anaconda: {
    name: { 'pt-BR': 'Sucuri', en: 'Green anaconda' }, scientificName: 'Eunectes murinus', clade: 'squamate',
    period: 'Atual (Holoceno)', diet: 'carnivore', ecology: 'mesoPredator',
    lengthM: 6.5, hipHeightM: 0.17, massKg: 100, walkSpeed: 0.6, runSpeed: 2.2, stamina: 6, foodNeed: 0.3, waterNeed: 0.4,
    social: { type: 'solitary', size: [1, 1] }, senses: { sight: 30, hearing: 40, smell: 140, fovDeg: 220 },
    temperament: { aggression: 0.45, fearfulness: 0.2, curiosity: 0.1 }, territory: { radius: 200, defends: false },
    activity: 'nocturnal', reproduction: { clutch: [10, 30], incubationDays: 8, maturityDays: 20, parentalCare: 0, season: [8, 16], live: true },
    threat: { response: 'defend', flightDistance: 3 }, attack: { damage: 30, range: 1.8, cooldown: 2 }, health: 260,
    taming: { possible: false, difficulty: 1, preferredFood: ['raw_meat'] }, habitat: ['swamp', 'jungle'], tempRange: [20, 40],
    locomotion: { plan: 'serpent', stride: 0.8, turnRate: 1.6, swims: true, flies: false },
    audio: { pitch: 400, call: 'hiss' }, look: { base: 0x6a4a2e, belly: 0xb8a070, accent: 0x1e1610, pattern: 'spots', features: [] },
    huntsHumans: true,
  },
};

export const SPECIES: Record<string, SpeciesDef> = Object.fromEntries(
  Object.entries(S).map(([id, def]) => [id, { id, ...def }]),
);

export const SPECIES_IDS = Object.keys(SPECIES);

export const isPredator = (s: SpeciesDef): boolean => s.diet === 'carnivore' || s.diet === 'piscivore';

/** Rough mass of the player, used for predator/prey size reasoning. */
export const HUMAN_MASS = 75;
