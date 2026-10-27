import { B, Dir, logAxis, door as doorState, bars, pane, stairs, slab } from '../core/blocks';
import { Rng, pick, rint } from '../core/rng';
import { StyleId } from './params';

export interface WallCtx {
  f: number;
  /** Row above the floor slab, 1 .. H-1. */
  ry: number;
  x: number;
  y: number;
  z: number;
  /** Index inside the wall run and run length. */
  i: number;
  n: number;
  normal: Dir;
  /** 0 = plain, 1 = window, 2 = accent panel. */
  seg: number;
  /** Stable per-cell random in [0,1). */
  h: number;
  /** Axis the wall runs along. */
  axis: 'x' | 'z';
  top: boolean;
}

export interface Opening {
  start: number;
  len: number;
  kind: 1 | 2;
}

export interface RoofMat {
  /** Stair/slab family name, e.g. "dark_oak" -> dark_oak_stairs. */
  family: string;
  /** Full block used for ridges and flat decks. */
  block: number;
  /** Block used under overhangs and trims (optional). */
  trim: number;
}

export interface StyleDef {
  id: StyleId;
  /** Storey height: floor slab + (H-1) rows of space. */
  H: number;
  foundRows: number;
  found(c: WallCtx): number;
  wall(c: WallCtx): number;
  accent(c: WallCtx): number;
  pillar(c: WallCtx): number;
  /** Block for wall cells in the slab row (belt course). */
  plate(c: WallCtx): number;
  windowBlock(c: WallCtx): number;
  winRows: [number, number];
  openings(n: number, rng: Rng, o: { glass: number; front: boolean; f: number }): Opening[];
  floor: number;
  light: 'lantern' | 'sea_lantern' | 'glowstone' | 'soul_lantern';
  roof: RoofMat;
  steep: boolean;
  /** Parapet on flat roofs: 'battlement' | 'rail' | 'none' */
  parapet: 'battlement' | 'rail' | 'none';
  tower: {
    r: number;
    extra: number;
    roof: 'cone' | 'onion' | 'flat';
    block: number;
    accent: number;
    tip: 'rod' | 'fence' | 'gold';
    wall(c: WallCtx): number;
    win: number;
  };
  door: { name: string; width: 1 | 2 };
  path: number[];
  fence: string;
  tree: 'oak' | 'spruce' | 'birch' | 'cherry' | 'dark_oak';
  flowers: string[];
  groundCover: number;
  /** Timber posts next to windows (medieval look). */
  frame?: number;
  chimney: number;
  lamp: 'lantern' | 'soul_lantern';
  moat: boolean;
}

function wpick(h: number, table: Array<[number, number]>): number {
  let t = 0;
  for (const [, w] of table) t += w;
  let r = h * t;
  for (const [id, w] of table) {
    if (r < w) return id;
    r -= w;
  }
  return table[table.length - 1][0];
}

/** Evenly centred window rhythm. */
export function rhythm(n: number, ww: number, gap: number, kind: 1 | 2 = 1, margin = 1): Opening[] {
  const out: Opening[] = [];
  const usable = n - margin * 2;
  if (usable < ww) return out;
  let k = Math.floor((usable + gap) / (ww + gap));
  if (k < 1) return out;
  const total = k * ww + (k - 1) * gap;
  const start = margin + Math.floor((usable - total) / 2);
  for (let j = 0; j < k; j++) out.push({ start: start + j * (ww + gap), len: ww, kind });
  return out;
}

export function makeStyle(id: StyleId, rng: Rng): StyleDef {
  switch (id) {
    case 'modern':
      return modern(rng);
    case 'medieval':
      return medieval(rng);
    case 'cottage':
      return cottage(rng);
    case 'castle':
      return castle(rng);
    case 'fairytale':
      return fairytale(rng);
    case 'lair':
      return lair(rng);
  }
}

// ---------------------------------------------------------------------------

function modern(rng: Rng): StyleDef {
  const white = B('white_concrete');
  const gray = B('light_gray_concrete');
  const black = B('black_concrete');
  const dgray = B('gray_concrete');
  const wood = B(pick(rng, ['spruce_planks', 'dark_oak_planks', 'acacia_planks']));
  const glass = B(pick(rng, ['glass', 'glass', 'light_blue_stained_glass']));
  const H = 5;
  return {
    id: 'modern',
    H,
    foundRows: 1,
    found: () => dgray,
    wall: (c) => (c.h < 0.06 ? gray : white),
    accent: () => wood,
    pillar: () => black,
    plate: () => black,
    windowBlock: () => glass,
    winRows: [1, H - 2],
    openings(n, r, o) {
      const out: Opening[] = [];
      let i = 1;
      while (i < n - 1) {
        const left = n - 1 - i;
        let len = rint(r, 3, 6);
        if (left - len < 2) len = left;
        if (len < 2) break;
        const t = r();
        if (t < o.glass) out.push({ start: i, len, kind: 1 });
        else if (t < o.glass + (1 - o.glass) * 0.45) out.push({ start: i, len, kind: 2 });
        i += len + 1;
      }
      return out;
    },
    floor: B('smooth_quartz'),
    light: 'sea_lantern',
    roof: { family: 'smooth_quartz', block: dgray, trim: white },
    steep: false,
    parapet: 'rail',
    tower: { r: 3, extra: 1, roof: 'flat', block: dgray, accent: black, tip: 'rod', wall: () => white, win: glass },
    door: { name: 'dark_oak_door', width: 2 },
    path: [B('smooth_quartz'), B('light_gray_concrete')],
    fence: 'dark_oak_fence',
    tree: pick(rng, ['birch', 'oak'] as const),
    flowers: ['allium', 'oxeye_daisy', 'cornflower'],
    groundCover: B('grass_block'),
    chimney: B('gray_concrete'),
    lamp: 'lantern',
    moat: false,
  };
}

function medieval(rng: Rng): StyleDef {
  const plaster = B('white_terracotta');
  const beam = 'dark_oak_log';
  const roofFam = pick(rng, ['dark_oak', 'brick', 'stone_brick', 'spruce']);
  const roofBlock = B(roofFam === 'brick' ? 'bricks' : roofFam === 'stone_brick' ? 'stone_bricks' : roofFam + '_planks');
  const H = 4;
  const post = logAxis(beam, 'y');
  return {
    id: 'medieval',
    H,
    foundRows: 1,
    found: (c) => (c.h < 0.25 ? B('mossy_cobblestone') : B('cobblestone')),
    wall: (c) => {
      // timber posts frame the windows (rhythm), plaster between
      if (c.seg === 1 || c.ry === 0) return plaster;
      return c.h < 0.05 ? B('bricks') : plaster;
    },
    accent: () => B('dark_oak_planks'),
    pillar: () => post,
    plate: (c) => logAxis(beam, c.axis),
    windowBlock: () => pane('glass_pane'),
    winRows: [2, 3],
    openings: (n) => rhythm(n, 2, 3),
    floor: B('spruce_planks'),
    light: 'lantern',
    roof: { family: roofFam, block: roofBlock, trim: B('dark_oak_planks') },
    steep: false,
    parapet: 'none',
    tower: { r: 3, extra: 1, roof: 'cone', block: roofBlock, accent: B('dark_oak_planks'), tip: 'fence', wall: () => B('stone_bricks'), win: pane('glass_pane') },
    door: { name: 'spruce_door', width: 1 },
    path: [B('cobblestone'), B('gravel'), B('mossy_cobblestone')],
    fence: 'dark_oak_fence',
    tree: pick(rng, ['oak', 'spruce'] as const),
    flowers: ['poppy', 'dandelion', 'azure_bluet'],
    groundCover: B('grass_block'),
    frame: post,
    chimney: B('cobblestone'),
    lamp: 'lantern',
    moat: false,
  };
}

function cottage(rng: Rng): StyleDef {
  const roofFam = pick(rng, ['dark_oak', 'brick', 'stone_brick']);
  const roofBlock = B(roofFam === 'brick' ? 'bricks' : roofFam === 'stone_brick' ? 'stone_bricks' : 'dark_oak_planks');
  const H = 4;
  return {
    id: 'cottage',
    H,
    foundRows: 1,
    found: (c) => (c.h < 0.3 ? B('mossy_cobblestone') : B('cobblestone')),
    wall: (c) => logAxis('spruce_log', c.axis),
    accent: (c) => logAxis('spruce_log', c.axis),
    pillar: () => logAxis('stripped_oak_log', 'y'),
    plate: (c) => logAxis('stripped_oak_log', c.axis),
    windowBlock: () => pane('glass_pane'),
    winRows: [2, 3],
    openings: (n) => rhythm(n, 2, 3),
    floor: B('oak_planks'),
    light: 'lantern',
    roof: { family: roofFam, block: roofBlock, trim: B('spruce_planks') },
    steep: true,
    parapet: 'none',
    tower: { r: 3, extra: 1, roof: 'cone', block: roofBlock, accent: B('spruce_planks'), tip: 'fence', wall: () => B('cobblestone'), win: pane('glass_pane') },
    door: { name: 'oak_door', width: 1 },
    path: [B('dirt_path'), B('gravel'), B('coarse_dirt')],
    fence: 'oak_fence',
    tree: pick(rng, ['oak', 'birch'] as const),
    flowers: ['poppy', 'dandelion', 'cornflower', 'azure_bluet', 'red_tulip'],
    groundCover: B('grass_block'),
    chimney: B('cobblestone'),
    lamp: 'lantern',
    moat: false,
  };
}

function castle(rng: Rng): StyleDef {
  const H = 5;
  const slate = pick(rng, ['deepslate_tile', 'dark_oak', 'stone_brick'] as const);
  const slateBlock = B(slate === 'deepslate_tile' ? 'deepslate_tiles' : slate === 'dark_oak' ? 'dark_oak_planks' : 'stone_bricks');
  const stone = (c: WallCtx) => (c.h < 0.12 ? B('mossy_stone_bricks') : c.h < 0.26 ? B('cracked_stone_bricks') : B('stone_bricks'));
  return {
    id: 'castle',
    H,
    foundRows: 2,
    found: (c) => (c.h < 0.3 ? B('mossy_cobblestone') : B('cobblestone')),
    wall: stone,
    accent: stone,
    pillar: () => B('stone_bricks'),
    plate: () => B('stone_bricks'),
    windowBlock: () => bars(),
    winRows: [2, 3],
    openings: (n) => rhythm(n, 1, 4),
    floor: B('dark_oak_planks'),
    light: 'lantern',
    roof: { family: 'stone_brick', block: B('stone_bricks'), trim: B('stone_bricks') },
    steep: false,
    parapet: 'battlement',
    tower: { r: 3, extra: 2, roof: 'cone', block: slateBlock, accent: B('dark_oak_planks'), tip: 'fence', wall: stone, win: bars() },
    door: { name: 'dark_oak_door', width: 2 },
    path: [B('cobblestone'), B('gravel'), B('stone_bricks')],
    fence: 'cobblestone_wall',
    tree: pick(rng, ['oak', 'spruce'] as const),
    flowers: ['poppy', 'dandelion'],
    groundCover: B('grass_block'),
    chimney: B('stone_bricks'),
    lamp: 'lantern',
    moat: true,
  };
}

function fairytale(rng: Rng): StyleDef {
  const H = 5;
  const domeBlock = B(pick(rng, ['oxidized_cut_copper', 'oxidized_cut_copper', 'red_nether_bricks', 'gold_block']));
  const roofFam = pick(rng, ['brick', 'cherry', 'oxidized_cut_copper']);
  const roofBlock = B(roofFam === 'brick' ? 'bricks' : roofFam === 'cherry' ? 'cherry_planks' : 'oxidized_cut_copper');
  const plaster = B(pick(rng, ['white_terracotta', 'smooth_sandstone']));
  return {
    id: 'fairytale',
    H,
    foundRows: 1,
    found: () => B('stone_bricks'),
    wall: (c) => (c.h < 0.06 ? B('white_concrete') : plaster),
    accent: () => B('cherry_planks'),
    pillar: () => B('stripped_cherry_log'),
    plate: (c) => logAxis('cherry_log', c.axis),
    windowBlock: () => pane('glass_pane'),
    winRows: [2, H - 1],
    openings: (n) => rhythm(n, 1, 3),
    floor: B('cherry_planks'),
    light: 'lantern',
    roof: { family: roofFam, block: roofBlock, trim: B('cherry_planks') },
    steep: true,
    parapet: 'rail',
    tower: { r: 3, extra: 1, roof: 'onion', block: domeBlock, accent: B('gold_block'), tip: 'rod', wall: () => plaster, win: pane('glass_pane') },
    door: { name: 'cherry_door', width: 1 },
    path: [B('smooth_sandstone'), B('dirt_path'), B('sandstone')],
    fence: 'cherry_fence',
    tree: 'cherry',
    flowers: ['pink_tulip', 'allium', 'azure_bluet', 'red_tulip', 'poppy', 'cornflower'],
    groundCover: B('grass_block'),
    chimney: B('stone_bricks'),
    lamp: 'lantern',
    moat: false,
  };
}

function lair(rng: Rng): StyleDef {
  const H = 5;
  const red = B('red_stained_glass_pane', { north: false, south: false, east: false, west: false, waterlogged: false });
  return {
    id: 'lair',
    H,
    foundRows: 2,
    found: (c) => (c.h < 0.4 ? B('blackstone') : B('polished_blackstone_bricks')),
    wall: (c) =>
      wpick(c.h, [
        [B('polished_blackstone_bricks'), 62],
        [B('blackstone'), 18],
        [B('deepslate_bricks'), 14],
        [B('red_nether_bricks'), 6],
      ]),
    accent: () => B('red_nether_bricks'),
    pillar: () => B('deepslate_tiles'),
    plate: () => B('nether_bricks'),
    windowBlock: () => red,
    winRows: [2, H - 1],
    openings: (n) => rhythm(n, 1, 3),
    floor: B('polished_deepslate'),
    light: 'soul_lantern',
    roof: { family: 'deepslate_tile', block: B('deepslate_tiles'), trim: B('nether_bricks') },
    steep: true,
    parapet: 'battlement',
    tower: { r: 3, extra: 2, roof: 'cone', block: B('blackstone'), accent: B('red_nether_bricks'), tip: 'fence', wall: () => B('polished_blackstone_bricks'), win: red },
    door: { name: 'dark_oak_door', width: 2 },
    path: [B('coarse_dirt'), B('gravel'), B('blackstone')],
    fence: 'nether_brick_fence',
    tree: pick(rng, ['dark_oak', 'spruce'] as const),
    flowers: ['poppy'],
    groundCover: B('podzol'),
    chimney: B('blackstone'),
    lamp: 'soul_lantern',
    moat: false,
  };
}

// small re-exports used by generators
export { stairs, slab, doorState };
