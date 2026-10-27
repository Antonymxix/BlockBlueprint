import { TABLE, defOf, BlockDef } from '../core/blocks';

export interface Box {
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
  /** Texture per face: +x, -x, +y, -y, +z, -z. */
  tex: [string, string, string, string, string, string];
}

export interface Model {
  boxes: Box[];
  layer: 'solid' | 'blend';
  /** Which neighbours hide a boundary face of this block. */
  cull: 'opaque' | 'same' | 'leaves' | 'water' | 'none';
  /** Crossed quads instead of boxes (flowers, grass). */
  cross?: string;
  /** Emitted light colour (0-1) for self-lit blocks. */
  glow?: [number, number, number];
  /** Family key used for "same" culling (glass next to glass). */
  family?: string;
}

const px = (n: number) => n / 16;

function mkBox(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, top: string, side: string, bottom: string): Box {
  return { x0, y0, z0, x1, y1, z1, tex: [side, side, top, bottom, side, side] };
}

export const LIGHT_COLORS: Record<string, [number, number, number]> = {
  lantern: [1.0, 0.7, 0.38],
  torch: [1.0, 0.68, 0.34],
  sea_lantern: [0.72, 0.96, 1.0],
  glowstone: [1.0, 0.86, 0.52],
  shroomlight: [1.0, 0.62, 0.32],
  redstone_lamp: [1.0, 0.76, 0.46],
  soul_lantern: [0.3, 0.85, 1.0],
  soul_torch: [0.3, 0.85, 1.0],
};

const cache = new Map<number, Model | null>();

export function getModel(id: number): Model | null {
  if (id === 0) return null;
  let m = cache.get(id);
  if (m !== undefined) return m;
  m = build(id);
  cache.set(id, m);
  return m;
}

function build(id: number): Model | null {
  const d = defOf(id);
  const props = TABLE.props(id);
  if (!d) {
    return { boxes: [mkBox(0, 0, 0, 1, 1, 1, '__missing', '__missing', '__missing')], layer: 'solid', cull: 'opaque' };
  }
  const glow = LIGHT_COLORS[d.name];
  const base: Partial<Model> = glow ? { glow } : {};
  switch (d.kind) {
    case 'cube': {
      const b = mkBox(0, 0, 0, 1, 1, 1, d.top, d.side, d.bottom);
      if (props.axis === 'x') b.tex = [d.top, d.top, d.side, d.side, d.side, d.side];
      else if (props.axis === 'z') b.tex = [d.side, d.side, d.side, d.side, d.top, d.top];
      return { ...base, boxes: [b], layer: 'solid', cull: 'opaque' };
    }
    case 'leaves':
      return { boxes: [mkBox(0, 0, 0, 1, 1, 1, d.top, d.side, d.bottom)], layer: 'solid', cull: 'leaves' };
    case 'glass':
      return { boxes: [mkBox(0, 0, 0, 1, 1, 1, d.top, d.side, d.bottom)], layer: 'blend', cull: 'same', family: 'glass' };
    case 'water':
      return { boxes: [mkBox(0, 0, 0, 1, 0.875, 1, d.top, d.side, d.bottom)], layer: 'blend', cull: 'water', family: 'water' };
    case 'slab': {
      const t = props.type;
      const y0 = t === 'top' ? 0.5 : 0;
      const y1 = t === 'bottom' ? 0.5 : 1;
      return { ...base, boxes: [mkBox(0, y0, 0, 1, y1, 1, d.top, d.side, d.bottom)], layer: 'solid', cull: t === 'double' ? 'opaque' : 'none' };
    }
    case 'stair':
      return { ...base, boxes: stairBoxes(d, props), layer: 'solid', cull: 'none' };
    case 'path':
      return { boxes: [mkBox(0, 0, 0, 1, px(15), 1, d.top, d.side, d.bottom)], layer: 'solid', cull: 'none' };
    case 'carpet':
      return { boxes: [mkBox(0, 0, 0, 1, px(1), 1, d.top, d.side, d.bottom)], layer: 'solid', cull: 'none' };
    case 'torch':
      return { ...base, boxes: [mkBox(px(7), 0, px(7), px(9), px(10), px(9), d.top, d.side, d.bottom)], layer: 'solid', cull: 'none' };
    case 'lantern': {
      const hang = props.hanging === 'true';
      const o = hang ? px(1) : 0;
      const boxes: Box[] = [
        mkBox(px(5), o, px(5), px(11), o + px(7), px(11), d.top, d.side, d.bottom),
        mkBox(px(6), o + px(7), px(6), px(10), o + px(9), px(10), d.top, d.side, d.bottom),
      ];
      if (hang) boxes.push(mkBox(px(7), px(10), px(7), px(9), 1, px(9), 'chain', 'chain', 'chain'));
      return { ...base, boxes, layer: 'solid', cull: 'none' };
    }
    case 'chain':
      return { boxes: [mkBox(px(7), 0, px(7), px(9), 1, px(9), 'chain', 'chain', 'chain')], layer: 'solid', cull: 'none' };
    case 'rod':
      return {
        boxes: [mkBox(px(7), 0, px(7), px(9), px(12), px(9), d.top, d.side, d.bottom), mkBox(px(6), px(12), px(6), px(10), 1, px(10), d.top, d.side, d.bottom)],
        layer: 'solid',
        cull: 'none',
      };
    case 'door': {
      const f = props.facing;
      const tex = props.half === 'upper' ? d.top : d.side;
      const t = px(3);
      let b: Box;
      if (f === 'east') b = mkBox(0, 0, 0, t, 1, 1, tex, tex, tex);
      else if (f === 'south') b = mkBox(0, 0, 0, 1, 1, t, tex, tex, tex);
      else if (f === 'north') b = mkBox(0, 0, 1 - t, 1, 1, 1, tex, tex, tex);
      else b = mkBox(1 - t, 0, 0, 1, 1, 1, tex, tex, tex);
      return { boxes: [b], layer: 'solid', cull: 'none' };
    }
    case 'fence': {
      const boxes: Box[] = [mkBox(px(6), 0, px(6), px(10), 1, px(10), d.top, d.side, d.bottom)];
      const arm = (x0: number, z0: number, x1: number, z1: number) => {
        boxes.push(mkBox(x0, px(6), z0, x1, px(9), z1, d.top, d.side, d.bottom));
        boxes.push(mkBox(x0, px(12), z0, x1, px(15), z1, d.top, d.side, d.bottom));
      };
      if (props.north === 'true') arm(px(7), 0, px(9), px(6));
      if (props.south === 'true') arm(px(7), px(10), px(9), 1);
      if (props.west === 'true') arm(0, px(7), px(6), px(9));
      if (props.east === 'true') arm(px(10), px(7), 1, px(9));
      return { boxes, layer: 'solid', cull: 'none' };
    }
    case 'wall': {
      const boxes: Box[] = [];
      if (props.up !== 'false') boxes.push(mkBox(px(4), 0, px(4), px(12), 1, px(12), d.top, d.side, d.bottom));
      const arm = (x0: number, z0: number, x1: number, z1: number, tall: boolean) => boxes.push(mkBox(x0, 0, z0, x1, tall ? 1 : px(14), z1, d.top, d.side, d.bottom));
      if (props.north !== 'none') arm(px(5), 0, px(11), px(4), props.north === 'tall');
      if (props.south !== 'none') arm(px(5), px(12), px(11), 1, props.south === 'tall');
      if (props.west !== 'none') arm(0, px(5), px(4), px(11), props.west === 'tall');
      if (props.east !== 'none') arm(px(12), px(5), 1, px(11), props.east === 'tall');
      return { boxes, layer: 'solid', cull: 'none' };
    }
    case 'pane':
    case 'bars': {
      const isBars = d.kind === 'bars';
      const boxes: Box[] = [];
      const t = isBars ? px(2) : px(2);
      const lo = 0.5 - t / 2;
      const hi = 0.5 + t / 2;
      const n = props.north === 'true';
      const s = props.south === 'true';
      const e = props.east === 'true';
      const w = props.west === 'true';
      if ((!n && !s && !e && !w) || (n && s && e && w)) boxes.push(mkBox(lo, 0, lo, hi, 1, hi, d.top, d.side, d.bottom));
      if (n) boxes.push(mkBox(lo, 0, 0, hi, 1, 0.5, d.top, d.side, d.bottom));
      if (s) boxes.push(mkBox(lo, 0, 0.5, hi, 1, 1, d.top, d.side, d.bottom));
      if (w) boxes.push(mkBox(0, 0, lo, 0.5, 1, hi, d.top, d.side, d.bottom));
      if (e) boxes.push(mkBox(0.5, 0, lo, 1, 1, hi, d.top, d.side, d.bottom));
      if (n && !s && !e && !w) boxes.push(mkBox(lo, 0, 0.5, hi, 1, 0.5 + 0.0625, d.top, d.side, d.bottom));
      return { boxes, layer: isBars ? 'solid' : 'blend', cull: 'none', family: 'pane' };
    }
    case 'plant':
      return { boxes: [], layer: 'solid', cull: 'none', cross: d.side };
  }
}

function stairBoxes(d: BlockDef, p: Record<string, string>): Box[] {
  const top = p.half === 'top';
  const f = p.facing;
  const shape = p.shape ?? 'straight';
  const y0 = top ? 0.5 : 0;
  const y1 = top ? 1 : 0.5;
  const uy0 = top ? 0 : 0.5;
  const uy1 = top ? 0.5 : 1;
  const boxes: Box[] = [mkBox(0, y0, 0, 1, y1, 1, d.top, d.side, d.bottom)];
  // quadrants: [x half (0 low,1 high)][z half]
  const q = new Set<string>();
  const add = (qx: number, qz: number) => q.add(qx + ',' + qz);
  const half = (dir: string) => {
    if (dir === 'east') [0, 1].forEach((z) => add(1, z));
    if (dir === 'west') [0, 1].forEach((z) => add(0, z));
    if (dir === 'north') [0, 1].forEach((x) => add(x, 0));
    if (dir === 'south') [0, 1].forEach((x) => add(x, 1));
  };
  // left/right of the facing direction (counter-clockwise = left)
  const left: Record<string, string> = { north: 'west', west: 'south', south: 'east', east: 'north' };
  const right: Record<string, string> = { north: 'east', east: 'south', south: 'west', west: 'north' };
  const corner = (dirA: string, dirB: string) => {
    const x = dirA === 'east' || dirB === 'east' ? 1 : 0;
    const z = dirA === 'south' || dirB === 'south' ? 1 : 0;
    add(x, z);
  };
  const opp: Record<string, string> = { north: 'south', south: 'north', east: 'west', west: 'east' };
  if (shape === 'straight') half(f);
  else if (shape === 'outer_left') corner(f, left[f]);
  else if (shape === 'outer_right') corner(f, right[f]);
  else if (shape === 'inner_left') {
    half(f);
    corner(opp[f], left[f]);
  } else if (shape === 'inner_right') {
    half(f);
    corner(opp[f], right[f]);
  } else half(f);
  // merge quadrants into boxes
  const has = (x: number, z: number) => q.has(x + ',' + z);
  const used = new Set<string>();
  const emit = (x0: number, z0: number, x1: number, z1: number) => boxes.push(mkBox(x0, uy0, z0, x1, uy1, z1, d.top, d.side, d.bottom));
  for (let z = 0; z < 2; z++)
    for (let x = 0; x < 2; x++) {
      const k = x + ',' + z;
      if (!has(x, z) || used.has(k)) continue;
      // try to extend along x
      if (x === 0 && has(1, z) && !used.has('1,' + z)) {
        used.add(k);
        used.add('1,' + z);
        emit(0, z * 0.5, 1, z * 0.5 + 0.5);
        continue;
      }
      // along z
      if (z === 0 && has(x, 1) && !used.has(x + ',1')) {
        used.add(k);
        used.add(x + ',1');
        emit(x * 0.5, 0, x * 0.5 + 0.5, 1);
        continue;
      }
      used.add(k);
      emit(x * 0.5, z * 0.5, x * 0.5 + 0.5, z * 0.5 + 0.5);
    }
  return boxes;
}
