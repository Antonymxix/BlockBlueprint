/**
 * Block states and the render registry.
 *
 * Every distinct block state ("minecraft:oak_stairs[facing=east,half=bottom,...]") is interned
 * once and referred to by a small integer id. The voxel grid stores those ids.
 */

export type Props = Record<string, string | number | boolean>;

export class BlockTable {
  private strings: string[] = ['minecraft:air'];
  private bases: string[] = ['air'];
  private propsCache: Array<Record<string, string>> = [{}];
  private map = new Map<string, number>([['minecraft:air', 0]]);

  intern(name: string, props?: Props): number {
    const base = name.startsWith('minecraft:') ? name.slice(10) : name;
    let s = 'minecraft:' + base;
    let pr: Record<string, string> = {};
    if (props) {
      const keys = Object.keys(props).sort();
      if (keys.length) {
        for (const k of keys) pr[k] = String(props[k]);
        s += '[' + keys.map((k) => `${k}=${pr[k]}`).join(',') + ']';
      }
    }
    let id = this.map.get(s);
    if (id === undefined) {
      id = this.strings.length;
      this.strings.push(s);
      this.bases.push(base);
      this.propsCache.push(pr);
      this.map.set(s, id);
    }
    return id;
  }

  /** Full state string, e.g. minecraft:oak_stairs[facing=east,half=bottom] */
  state(id: number): string {
    return this.strings[id];
  }
  /** Name without namespace, e.g. oak_stairs */
  base(id: number): string {
    return this.bases[id];
  }
  props(id: number): Record<string, string> {
    return this.propsCache[id];
  }
  get size(): number {
    return this.strings.length;
  }
}

/** Shared table. Ids are stable for the lifetime of the page. */
export const TABLE = new BlockTable();

/** Shorthand: B('oak_stairs', {facing:'east'}) -> state id */
export function B(name: string, props?: Props): number {
  return TABLE.intern(name, props);
}

export const AIR = 0;

// ---------------------------------------------------------------------------
// Render registry
// ---------------------------------------------------------------------------

export type Kind =
  | 'cube'
  | 'leaves'
  | 'glass'
  | 'water'
  | 'slab'
  | 'stair'
  | 'pane'
  | 'fence'
  | 'wall'
  | 'torch'
  | 'lantern'
  | 'door'
  | 'carpet'
  | 'plant'
  | 'path'
  | 'chain'
  | 'rod'
  | 'bars';

export interface BlockDef {
  name: string;
  kind: Kind;
  top: string;
  side: string;
  bottom: string;
  /** Hides the faces of neighbouring blocks. */
  opaque: boolean;
  /** Light emitted, 0-15. */
  light: number;
  /** Tint applied to vertex colour (leaves, grass top). */
  tint?: [number, number, number];
  /** Used by the material list. */
  label: string;
}

export const DEFS = new Map<string, BlockDef>();

function titleCase(name: string): string {
  return name
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function def(name: string, kind: Kind, top: string, side: string, bottom: string, extra: Partial<BlockDef> = {}) {
  DEFS.set(name, {
    name,
    kind,
    top,
    side,
    bottom,
    opaque: kind === 'cube',
    light: 0,
    label: titleCase(name),
    ...extra,
  });
}

/** Full cube with one texture on all sides. */
function cube(name: string, tex = name, extra: Partial<BlockDef> = {}) {
  def(name, 'cube', tex, tex, tex, extra);
}
/** Full cube with separate top / side / bottom textures. */
function cube3(name: string, top: string, side: string, bottom: string, extra: Partial<BlockDef> = {}) {
  def(name, 'cube', top, side, bottom, extra);
}
/** Cube + slab + stairs family sharing one texture. */
function family(cubeName: string, famName: string, tex = cubeName, topTex = tex, bottomTex = tex) {
  cube3(cubeName, topTex, tex, bottomTex);
  def(famName + '_slab', 'slab', topTex, tex, bottomTex, { opaque: false, label: titleCase(famName) + ' Slab' });
  def(famName + '_stairs', 'stair', topTex, tex, bottomTex, { opaque: false, label: titleCase(famName) + ' Stairs' });
}
function log(name: string, tex = name) {
  cube3(name, tex + '_top', tex + '_side', tex + '_top');
}

// --- terrain
cube3('grass_block', 'grass_top', 'grass_side', 'dirt', { tint: [0.62, 0.86, 0.42] });
cube('dirt');
cube('coarse_dirt');
cube3('podzol', 'podzol_top', 'podzol_side', 'dirt');
cube('gravel');
cube('stone');
def('dirt_path', 'path', 'path_top', 'path_side', 'dirt', { opaque: false });
cube('moss_block');
cube('mud_bricks');

// --- stone family
family('cobblestone', 'cobblestone');
family('mossy_cobblestone', 'mossy_cobblestone');
family('stone_bricks', 'stone_brick');
cube('mossy_stone_bricks');
cube('cracked_stone_bricks');
family('bricks', 'brick');
family('deepslate_bricks', 'deepslate_brick');
family('deepslate_tiles', 'deepslate_tile');
cube('polished_deepslate');
family('blackstone', 'blackstone');
family('polished_blackstone_bricks', 'polished_blackstone_brick');
family('nether_bricks', 'nether_brick');
family('red_nether_bricks', 'red_nether_brick');
family('quartz_block', 'quartz', 'quartz_block_side', 'quartz_block_top', 'quartz_block_top');
family('smooth_quartz', 'smooth_quartz', 'quartz_block_top');
family('sandstone', 'sandstone', 'sandstone', 'sandstone_top', 'sandstone_top');
family('smooth_sandstone', 'smooth_sandstone', 'sandstone_top');
family('mud_brick_family', 'mud_brick', 'mud_bricks');
DEFS.delete('mud_brick_family');

// --- concrete, terracotta, wool
for (const c of ['white', 'light_gray', 'gray', 'black']) cube(c + '_concrete');
cube('terracotta');
for (const c of ['white', 'orange', 'red']) cube(c + '_terracotta');
for (const c of ['white', 'red', 'black', 'blue', 'yellow']) cube(c + '_wool');
for (const c of ['white', 'red', 'black', 'blue', 'yellow']) {
  def(c + '_carpet', 'carpet', c + '_wool', c + '_wool', c + '_wool', { opaque: false });
}
cube3('hay_block', 'hay_block_top', 'hay_block_side', 'hay_block_top');

// --- wood
family('oak_planks', 'oak');
family('spruce_planks', 'spruce');
family('dark_oak_planks', 'dark_oak');
family('birch_planks', 'birch');
family('acacia_planks', 'acacia');
family('cherry_planks', 'cherry');
for (const w of ['oak', 'spruce', 'dark_oak', 'birch', 'cherry']) {
  log(w + '_log');
  log('stripped_' + w + '_log');
  def(w + '_fence', 'fence', w + '_planks', w + '_planks', w + '_planks', { opaque: false });
  def(w + '_door', 'door', w + '_door_upper', w + '_door_lower', w + '_door_lower', { opaque: false });
}
for (const w of ['oak', 'spruce', 'dark_oak', 'birch', 'cherry']) {
  def(w + '_pressure_plate', 'carpet', w + '_planks', w + '_planks', w + '_planks', { opaque: false });
}
cube3('bookshelf', 'oak_planks', 'bookshelf', 'oak_planks');
cube3('crafting_table', 'crafting_table_top', 'crafting_table_side', 'oak_planks');
cube3('barrel', 'barrel_top', 'barrel_side', 'barrel_top');

// --- metals
cube('copper_block');
family('cut_copper', 'cut_copper');
family('exposed_cut_copper', 'exposed_cut_copper');
family('weathered_cut_copper', 'weathered_cut_copper');
family('oxidized_cut_copper', 'oxidized_cut_copper');
cube('gold_block');
cube('iron_block');
def('lightning_rod', 'rod', 'copper_block', 'copper_block', 'copper_block', { opaque: false });
def('iron_bars', 'bars', 'iron_bars', 'iron_bars', 'iron_bars', { opaque: false });
def('chain', 'chain', 'chain', 'chain', 'chain', { opaque: false });

// --- walls
def('cobblestone_wall', 'wall', 'cobblestone', 'cobblestone', 'cobblestone', { opaque: false });
def('stone_brick_wall', 'wall', 'stone_bricks', 'stone_bricks', 'stone_bricks', { opaque: false });
def('brick_wall', 'wall', 'bricks', 'bricks', 'bricks', { opaque: false });
def('deepslate_brick_wall', 'wall', 'deepslate_bricks', 'deepslate_bricks', 'deepslate_bricks', { opaque: false });
def('blackstone_wall', 'wall', 'blackstone', 'blackstone', 'blackstone', { opaque: false });
def('polished_blackstone_brick_wall', 'wall', 'polished_blackstone_bricks', 'polished_blackstone_bricks', 'polished_blackstone_bricks', { opaque: false });
def('nether_brick_fence', 'fence', 'nether_bricks', 'nether_bricks', 'nether_bricks', { opaque: false });

// --- glass
def('glass', 'glass', 'glass', 'glass', 'glass', { opaque: false });
for (const c of ['white', 'black', 'red', 'light_blue', 'gray', 'yellow', 'orange', 'magenta', 'purple']) {
  def(c + '_stained_glass', 'glass', c + '_stained_glass', c + '_stained_glass', c + '_stained_glass', { opaque: false });
}
def('glass_pane', 'pane', 'glass', 'glass', 'glass', { opaque: false });
for (const c of ['white', 'black', 'red', 'light_blue', 'gray', 'yellow', 'orange', 'magenta', 'purple']) {
  def(c + '_stained_glass_pane', 'pane', c + '_stained_glass', c + '_stained_glass', c + '_stained_glass', { opaque: false });
}
def('water', 'water', 'water', 'water', 'water', { opaque: false });

// --- lights
cube('sea_lantern', 'sea_lantern', { light: 15 });
cube('glowstone', 'glowstone', { light: 15 });
cube('shroomlight', 'shroomlight', { light: 15 });
cube('redstone_lamp', 'redstone_lamp_on', { light: 15 });
def('lantern', 'lantern', 'lantern', 'lantern', 'lantern', { opaque: false, light: 15 });
def('soul_lantern', 'lantern', 'soul_lantern', 'soul_lantern', 'soul_lantern', { opaque: false, light: 10 });
def('torch', 'torch', 'torch', 'torch', 'torch', { opaque: false, light: 14 });
def('soul_torch', 'torch', 'soul_torch', 'soul_torch', 'soul_torch', { opaque: false, light: 10 });

// --- foliage
for (const w of ['oak', 'spruce', 'dark_oak', 'birch', 'cherry']) {
  def(w + '_leaves', 'leaves', w + '_leaves', w + '_leaves', w + '_leaves', {
    opaque: false,
    tint: w === 'cherry' ? [1, 1, 1] : w === 'spruce' ? [0.38, 0.6, 0.38] : w === 'birch' ? [0.5, 0.75, 0.35] : [0.45, 0.75, 0.3],
  });
}
for (const f of ['poppy', 'dandelion', 'cornflower', 'allium', 'red_tulip', 'pink_tulip', 'azure_bluet', 'oxeye_daisy', 'short_grass']) {
  def(f, 'plant', f, f, f, { opaque: false, tint: f === 'short_grass' ? [0.62, 0.86, 0.42] : undefined });
}

export function defOf(id: number): BlockDef | undefined {
  return DEFS.get(TABLE.base(id));
}

/** Block ids whose faces fully hide neighbours. Cached by state id. */
const occCache: Array<boolean | undefined> = [];
export function isOpaque(id: number): boolean {
  if (id === 0) return false;
  let v = occCache[id];
  if (v === undefined) {
    const d = defOf(id);
    v = !!d && d.opaque;
    occCache[id] = v;
  }
  return v;
}

/** Light emitted by a state (0 for most). */
export function emission(id: number): number {
  if (id === 0) return 0;
  const d = defOf(id);
  if (!d) return 0;
  const p = TABLE.props(id);
  if ((d.name === 'redstone_lamp') && p.lit === 'false') return 0;
  return d.light;
}

/** How much block/sky light dims when passing through this block. 15 = fully blocked. */
export function lightBlock(id: number): number {
  if (id === 0) return 0;
  const d = defOf(id);
  if (!d) return 15;
  switch (d.kind) {
    case 'cube':
      return 15;
    case 'leaves':
      return 1;
    case 'water':
      return 2;
    case 'door':
      return 15;
    default:
      return 0;
  }
}

// ---------------------------------------------------------------------------
// Convenience state builders used by the generator
// ---------------------------------------------------------------------------

export type Dir = 'north' | 'south' | 'east' | 'west';
export const DIRS: Dir[] = ['north', 'east', 'south', 'west'];
export const DX: Record<Dir, number> = { north: 0, south: 0, east: 1, west: -1 };
export const DZ: Record<Dir, number> = { north: -1, south: 1, east: 0, west: 0 };
export const OPP: Record<Dir, Dir> = { north: 'south', south: 'north', east: 'west', west: 'east' };
export const CW: Record<Dir, Dir> = { north: 'east', east: 'south', south: 'west', west: 'north' };
export const CCW: Record<Dir, Dir> = { north: 'west', west: 'south', south: 'east', east: 'north' };

export function stairs(base: string, facing: Dir, half: 'bottom' | 'top' = 'bottom'): number {
  return B(base + '_stairs', { facing, half, shape: 'straight', waterlogged: false });
}
export function slab(base: string, type: 'bottom' | 'top' | 'double' = 'bottom'): number {
  return B(base + '_slab', { type, waterlogged: false });
}
export function logAxis(name: string, axis: 'x' | 'y' | 'z'): number {
  return B(name, { axis });
}
export function leaves(name: string): number {
  return B(name, { distance: 1, persistent: true, waterlogged: false });
}
export function door(name: string, facing: Dir, half: 'lower' | 'upper', hinge: 'left' | 'right' = 'left'): number {
  return B(name, { facing, half, hinge, open: false, powered: false });
}
export function lantern(name: 'lantern' | 'soul_lantern', hanging: boolean): number {
  return B(name, { hanging, waterlogged: false });
}
export function torch(name: 'torch' | 'soul_torch' = 'torch'): number {
  return B(name);
}
export function fence(name: string): number {
  return B(name, { north: false, south: false, east: false, west: false, waterlogged: false });
}
export function wall(name: string): number {
  return B(name, { up: true, north: 'none', south: 'none', east: 'none', west: 'none', waterlogged: false });
}
export function pane(name: string): number {
  return B(name, { north: false, south: false, east: false, west: false, waterlogged: false });
}
export function bars(): number {
  return B('iron_bars', { north: false, south: false, east: false, west: false, waterlogged: false });
}
export function water(): number {
  return B('water', { level: 0 });
}
export function lamp(): number {
  return B('redstone_lamp', { lit: true });
}
