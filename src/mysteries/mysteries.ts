import { PLANNED_SITES } from '../world/terrain';

/**
 * Optional environmental narrative. Documents, terminals, cave paintings and
 * a radio signal tell what happened at the research stations. Nothing here is
 * required to survive; a secret ending opens only to players who piece the
 * story together.
 */
export type DocKind = 'note' | 'terminal' | 'painting' | 'radio';

export interface DocDef {
  id: string;
  site: string;
  kind: DocKind;
  /** Terminals need a battery the first time they are read. */
  needs?: 'battery';
  /** Counts toward the secret ending. */
  key?: 'log' | 'painting';
}

export const DOCS: DocDef[] = [
  { id: 'outpost_note', site: 'ruin_plains_outpost', kind: 'note' },
  { id: 'outpost_log', site: 'ruin_plains_outpost', kind: 'terminal', needs: 'battery', key: 'log' },
  { id: 'jungle_note', site: 'ruin_jungle_lab', kind: 'note' },
  { id: 'jungle_log', site: 'ruin_jungle_lab', kind: 'terminal', needs: 'battery', key: 'log' },
  { id: 'swamp_note', site: 'ruin_swamp_station', kind: 'note' },
  { id: 'swamp_log', site: 'ruin_swamp_station', kind: 'terminal', needs: 'battery', key: 'log' },
  { id: 'observatory_radio', site: 'ruin_north_observatory', kind: 'radio' },
  { id: 'observatory_log', site: 'ruin_north_observatory', kind: 'terminal', needs: 'battery', key: 'log' },
  { id: 'dock_note', site: 'ruin_coast_dock', kind: 'note' },
  { id: 'bunker_note', site: 'ruin_volcano_bunker', kind: 'note' },
  { id: 'bunker_log', site: 'ruin_volcano_bunker', kind: 'terminal', needs: 'battery', key: 'log' },
  { id: 'painting_spine', site: 'cave_spine_east', kind: 'painting', key: 'painting' },
  { id: 'painting_ice', site: 'cave_north_ice', kind: 'painting', key: 'painting' },
  { id: 'painting_lava', site: 'cave_volcano_lava', kind: 'painting', key: 'painting' },
];

export const DOC_BY_ID: Record<string, DocDef> = Object.fromEntries(DOCS.map((d) => [d.id, d]));
export const LOG_COUNT = DOCS.filter((d) => d.key === 'log').length;
export const PAINTING_COUNT = DOCS.filter((d) => d.key === 'painting').length;

export interface MysteryData {
  read: string[];
  /** Terminals already powered with a battery. */
  powered: string[];
  /** One-time pickups taken (keycard, core, caches). */
  taken: string[];
  bunkerOpen: boolean;
  beaconPowered: boolean;
  ending: null | 'cross' | 'stay';
}

export function createMysteries(): MysteryData {
  return { read: [], powered: [], taken: [], bunkerOpen: false, beaconPowered: false, ending: null };
}

export function sanitizeMysteries(d: Partial<MysteryData> | undefined): MysteryData {
  const out = createMysteries();
  if (!d || typeof d !== 'object') return out;
  const ids = (a: unknown, valid?: (s: string) => boolean) => (Array.isArray(a) ? [...new Set(a.filter((x): x is string => typeof x === 'string' && (!valid || valid(x))))] : []);
  out.read = ids(d.read, (x) => x in DOC_BY_ID);
  out.powered = ids(d.powered, (x) => x in DOC_BY_ID);
  out.taken = ids(d.taken);
  out.bunkerOpen = d.bunkerOpen === true;
  out.beaconPowered = d.beaconPowered === true;
  out.ending = d.ending === 'cross' || d.ending === 'stay' ? d.ending : null;
  return out;
}

export type ReadResult = 'read' | 'already' | 'needsBattery';

export class Mysteries {
  constructor(public d: MysteryData) {}

  /** Reads a document; terminals consume a battery the first time. */
  read(docId: string, hasBattery: boolean, consumeBattery: () => boolean): ReadResult {
    const def = DOC_BY_ID[docId];
    if (!def) return 'already';
    if (def.needs === 'battery' && !this.d.powered.includes(docId)) {
      if (!hasBattery || !consumeBattery()) return 'needsBattery';
      this.d.powered.push(docId);
    }
    if (this.d.read.includes(docId)) return 'already';
    this.d.read.push(docId);
    return 'read';
  }

  logsRead(): number {
    return this.d.read.filter((id) => DOC_BY_ID[id]?.key === 'log').length;
  }

  paintingsSeen(): number {
    return this.d.read.filter((id) => DOC_BY_ID[id]?.key === 'painting').length;
  }

  take(id: string): boolean {
    if (this.d.taken.includes(id)) return false;
    this.d.taken.push(id);
    return true;
  }

  /** What is still missing to activate the beacon (empty = ready). */
  beaconMissing(hasCore: boolean): string[] {
    const missing: string[] = [];
    if (this.logsRead() < LOG_COUNT) missing.push('logs');
    if (this.paintingsSeen() < PAINTING_COUNT) missing.push('paintings');
    if (!hasCore) missing.push('core');
    if (!this.d.beaconPowered) missing.push('power');
    return missing;
  }

  /** Sites the decoded radio signal points to (stations not yet visited). */
  static radioTargets(discovered: Set<string>): { id: string; x: number; z: number }[] {
    return PLANNED_SITES.filter((s) => s.kind !== 'cave' && !discovered.has(s.id)).map((s) => ({ id: s.id, x: s.x, z: s.z }));
  }
}
