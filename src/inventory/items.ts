/** Item catalogue. Weight in kg. */
export type ItemCategory = 'resource' | 'food' | 'tool' | 'weapon' | 'ammo' | 'clothing' | 'medical' | 'building' | 'special';
export type EquipSlot = 'head' | 'body' | 'legs' | 'back';

export interface ItemDef {
  id: string;
  category: ItemCategory;
  weight: number;
  maxStack: number;
  /** Tools/weapons: damage per hit and gathering power. */
  damage?: number;
  gather?: Partial<Record<'wood' | 'stone' | 'fiber' | 'meat', number>>;
  durability?: number;
  equip?: EquipSlot;
  /** Clothing: degrees of cold protection; backpack: extra capacity kg. */
  insulation?: number;
  armor?: number;
  capacity?: number;
  food?: { hunger: number; thirst?: number; health?: number; sickChance?: number };
  heal?: number;
  stopsBleeding?: boolean;
  lightRadius?: number;
}

const I = (id: string, category: ItemCategory, weight: number, maxStack: number, extra: Partial<ItemDef> = {}): ItemDef => ({ id, category, weight, maxStack, ...extra });

export const ITEMS: Record<string, ItemDef> = Object.fromEntries(
  [
    I('wood', 'resource', 1.2, 50),
    I('stone', 'resource', 1.5, 50),
    I('fiber', 'resource', 0.1, 99),
    I('flint', 'resource', 0.4, 50),
    I('clay', 'resource', 1, 50),
    I('hide', 'resource', 1.5, 20),
    I('bone', 'resource', 0.6, 30),
    I('obsidian', 'resource', 0.8, 30),
    I('sulfur', 'resource', 0.5, 30),
    I('metal_ore', 'resource', 2, 30),
    I('metal_scrap', 'resource', 1, 30),
    I('ice', 'resource', 1, 20),
    I('herb', 'resource', 0.05, 50),
    I('cycad_fronds', 'food', 0.3, 30, { food: { hunger: 0.05 } }),
    I('fern_fronds', 'food', 0.2, 30, { food: { hunger: 0.04 } }),
    I('berries', 'food', 0.1, 40, { food: { hunger: 0.08, thirst: 0.03 } }),
    I('raw_meat', 'food', 0.5, 20, { food: { hunger: 0.15, sickChance: 0.35 } }),
    I('cooked_meat', 'food', 0.4, 20, { food: { hunger: 0.35, health: 4 } }),
    I('raw_fish', 'food', 0.4, 20, { food: { hunger: 0.12, sickChance: 0.25 } }),
    I('egg', 'food', 0.3, 12, { food: { hunger: 0.1 } }),
    I('waterskin', 'tool', 0.3, 1),
    I('waterskin_full', 'food', 1.3, 1, { food: { hunger: 0, thirst: 0.5 } }),
    I('stone_axe', 'tool', 1.6, 1, { damage: 14, gather: { wood: 3, stone: 1 }, durability: 150 }),
    I('stone_pickaxe', 'tool', 1.8, 1, { damage: 12, gather: { stone: 3, wood: 1 }, durability: 150 }),
    I('stone_knife', 'tool', 0.5, 1, { damage: 10, gather: { meat: 3, fiber: 2 }, durability: 120 }),
    I('spear', 'weapon', 1.8, 1, { damage: 26, durability: 100 }),
    I('obsidian_spear', 'weapon', 2, 1, { damage: 40, durability: 160 }),
    I('bow', 'weapon', 1, 1, { damage: 0, durability: 200 }),
    I('arrow', 'ammo', 0.05, 40, { damage: 22 }),
    I('torch', 'tool', 0.6, 5, { damage: 6, lightRadius: 14, durability: 300 }),
    I('bandage', 'medical', 0.1, 10, { heal: 15, stopsBleeding: true }),
    I('herbal_poultice', 'medical', 0.15, 10, { heal: 30, stopsBleeding: true }),
    I('hide_hood', 'clothing', 0.6, 1, { equip: 'head', insulation: 3, armor: 0.05 }),
    I('hide_tunic', 'clothing', 2, 1, { equip: 'body', insulation: 7, armor: 0.12 }),
    I('hide_leggings', 'clothing', 1.4, 1, { equip: 'legs', insulation: 4, armor: 0.08 }),
    I('fur_coat', 'clothing', 3, 1, { equip: 'body', insulation: 15, armor: 0.1 }),
    I('backpack', 'clothing', 1.5, 1, { equip: 'back', capacity: 25 }),
    I('trap_snare', 'tool', 0.8, 5),
    I('field_journal', 'special', 0.3, 1),
    I('research_scanner', 'tool', 1.2, 1),
    // v0.2
    I('rope', 'resource', 0.2, 30),
    I('metal_ingot', 'resource', 1.2, 20),
    I('crystal', 'resource', 0.4, 20),
    I('fossil', 'special', 2, 10),
    I('dino_egg', 'special', 2, 4, { food: { hunger: 0.25 } }),
    I('feed_mix', 'food', 0.4, 20, { food: { hunger: 0.06 } }),
    I('metal_axe', 'tool', 1.8, 1, { damage: 22, gather: { wood: 5, stone: 1 }, durability: 400 }),
    I('metal_pickaxe', 'tool', 2, 1, { damage: 18, gather: { stone: 5, wood: 1 }, durability: 400 }),
    I('metal_knife', 'tool', 0.5, 1, { damage: 16, gather: { meat: 5, fiber: 3 }, durability: 350 }),
    I('metal_spear', 'weapon', 2, 1, { damage: 48, durability: 300 }),
    I('splint', 'medical', 0.4, 5, { heal: 5 }),
    I('antidote', 'medical', 0.2, 5, { heal: 5 }),
    I('spyglass', 'tool', 0.8, 1),
    I('compass', 'tool', 0.2, 1),
    I('radio_receiver', 'tool', 1, 1),
    I('battery', 'special', 0.6, 5),
    I('flare', 'tool', 0.3, 5),
    I('keycard', 'special', 0.05, 1),
    I('calibration_core', 'special', 3, 1),
  ].map((d) => [d.id, d]),
);

export const isItem = (id: string): boolean => id in ITEMS;
