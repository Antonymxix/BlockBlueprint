import { VoxelGrid } from '../core/grid';
import { AIR, B, Dir, stairs, slab, TABLE } from '../core/blocks';
import { RoofMat } from './styles';

export const TAG_ROOF = 1;

/** Places a roof block only into air and tags it, so later passes can tidy hidden pieces. */
export function putRoof(g: VoxelGrid, x: number, y: number, z: number, id: number): void {
  if (g.setIfAir(x, y, z, id)) g.setTag(x, y, z, TAG_ROOF);
}

type Mapper = (u: number, v: number) => [number, number];

export interface PitchedOpts {
  g: VoxelGrid;
  mat: RoofMat;
  /** Wing outer rectangle (grid coordinates, inclusive of walls). */
  x0: number;
  z0: number;
  w: number;
  d: number;
  /** Y of the ceiling slab; row 0 of the roof sits at this height. */
  Y: number;
  /** Cells that must stay free (rooms above, tower interiors). */
  blocked: (x: number, z: number) => boolean;
  /** Gable end fill. */
  fill?: (x: number, y: number, z: number, k: number, u: number, uMid: number) => number;
}

/** Gable roof with a 1:1 slope, overhang of one block, ridge along `axis`. */
export function gable(o: PitchedOpts, axis: 'x' | 'z'): void {
  const { g, mat, x0, z0, w, d, Y, blocked } = o;
  // u runs across the slopes, v along the ridge
  const a0 = axis === 'x' ? z0 : x0;
  const a1 = axis === 'x' ? z0 + d - 1 : x0 + w - 1;
  const v0 = axis === 'x' ? x0 : z0;
  const v1 = axis === 'x' ? x0 + w - 1 : z0 + d - 1;
  const map: Mapper = axis === 'x' ? (u, v) => [v, u] : (u, v) => [u, v];
  // slope facing: low side to high side
  const faceLow: Dir = axis === 'x' ? 'south' : 'east'; // stair on the low (a0) side ascends toward +u
  const faceHigh: Dir = axis === 'x' ? 'north' : 'west';

  const place = (u: number, v: number, y: number, id: number) => {
    const [x, z] = map(u, v);
    if (!blocked(x, z)) putRoof(g, x, y, z, id);
  };

  const uMid = (a0 + a1) / 2;
  for (let k = 0; ; k++) {
    const L = a0 - 1 + k;
    const R = a1 + 1 - k;
    if (L > R) break;
    const y = Y + k;
    for (let v = v0 - 1; v <= v1 + 1; v++) {
      if (L < R) {
        place(L, v, y, stairs(mat.family, faceLow));
        place(R, v, y, stairs(mat.family, faceHigh));
      } else {
        place(L, v, y, mat.block);
      }
    }
    // gable end walls
    if (k >= 1 && o.fill) {
      for (let u = L + 1; u <= R - 1; u++) {
        if (u < a0 || u > a1) continue;
        for (const v of [v0, v1]) {
          const [x, z] = map(u, v);
          if (blocked(x, z)) continue;
          if (g.isAir(x, y, z)) g.set(x, y, z, o.fill(x, y, z, k, u, uMid));
        }
      }
    }
    if (L >= R) {
      // ridge cap: slabs along the ridge
      for (let v = v0 - 1; v <= v1 + 1; v++) place(L, v, y + 1, slab(mat.family));
      break;
    }
    if (R - L === 1) {
      // even span: add a slab cap spanning both halves
      for (let v = v0 - 1; v <= v1 + 1; v++) {
        // two stairs meet; nothing more to add
      }
      break;
    }
  }
}

/** Hip roof: rings that shrink by one block per layer. */
export function hip(o: PitchedOpts): void {
  const { g, mat, x0, z0, w, d, Y, blocked } = o;
  const put = (x: number, y: number, z: number, id: number) => {
    if (!blocked(x, z)) putRoof(g, x, y, z, id);
  };
  for (let k = 0; ; k++) {
    const a = x0 - 1 + k;
    const b = x0 + w - 1 + 1 - k;
    const c0 = z0 - 1 + k;
    const c1 = z0 + d - 1 + 1 - k;
    if (a > b || c0 > c1) break;
    const y = Y + k;
    if (b - a <= 1 || c1 - c0 <= 1) {
      for (let z = c0; z <= c1; z++) for (let x = a; x <= b; x++) put(x, y, z, mat.block);
      for (let z = c0; z <= c1; z++) for (let x = a; x <= b; x++) put(x, y + 1, z, slab(mat.family));
      break;
    }
    for (let x = a + 1; x <= b - 1; x++) {
      put(x, y, c0, stairs(mat.family, 'south'));
      put(x, y, c1, stairs(mat.family, 'north'));
    }
    for (let z = c0 + 1; z <= c1 - 1; z++) {
      put(a, y, z, stairs(mat.family, 'east'));
      put(b, y, z, stairs(mat.family, 'west'));
    }
    put(a, y, c0, stairs(mat.family, 'east'));
    put(b, y, c0, stairs(mat.family, 'west'));
    put(a, y, c1, stairs(mat.family, 'east'));
    put(b, y, c1, stairs(mat.family, 'west'));
  }
}

/**
 * Mono-pitch roof. The slope rises toward `high`. Walls below the roof are extended with `fill`.
 */
export function shed(o: PitchedOpts, high: Dir): void {
  const { g, mat, x0, z0, w, d, Y, blocked } = o;
  const alongX = high === 'east' || high === 'west'; // slope across x
  const a0 = alongX ? x0 : z0;
  const a1 = alongX ? x0 + w - 1 : z0 + d - 1;
  const v0 = alongX ? z0 : x0;
  const v1 = alongX ? z0 + d - 1 : x0 + w - 1;
  const rising = high === 'east' || high === 'south';
  const span = a1 - a0 + 3; // overhang both sides
  const maxRise = 5;
  const run = Math.max(2, Math.ceil((span * 2) / (maxRise * 2)));
  const rows = (i: number) => 1 + Math.floor((i * 2) / run); // half-block height of column i
  const facing: Dir = high;

  for (let i = 0; i < span; i++) {
    const col = rising ? a0 - 1 + i : a1 + 1 - i;
    const T = rows(i);
    const prevT = i > 0 ? rows(i - 1) : T;
    const topY = T % 2 === 1 ? Y + (T - 1) / 2 : Y + T / 2 - 1;
    for (let v = v0 - 1; v <= v1 + 1; v++) {
      const x = alongX ? col : v;
      const z = alongX ? v : col;
      if (blocked(x, z)) continue;
      let id: number;
      if (T % 2 === 1) id = slab(mat.family);
      else if (T > prevT) id = stairs(mat.family, facing);
      else id = mat.block;
      putRoof(g, x, topY, z, id);
      // gable-end and side walls below the roof surface
      const onWall = col >= a0 && col <= a1 && (v === v0 || v === v1 || col === a0 || col === a1);
      if (onWall && o.fill) {
        for (let y = Y + 1; y < topY; y++) {
          if (g.isAir(x, y, z)) g.set(x, y, z, o.fill(x, y, z, y - Y, col, 0));
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Round roofs: cones and onion domes built as stacked shells.
// ---------------------------------------------------------------------------

export function shell(g: VoxelGrid, cx: number, cz: number, y0: number, profile: number[], block: number, blocked?: (x: number, z: number) => boolean): void {
  const maxR = Math.ceil(Math.max(...profile)) + 1;
  for (let k = 0; k < profile.length; k++) {
    const r = profile[k];
    const rn = k + 1 < profile.length ? profile[k + 1] : -1;
    for (let dz = -maxR; dz <= maxR; dz++)
      for (let dx = -maxR; dx <= maxR; dx++) {
        const dist = Math.hypot(dx, dz);
        if (dist > r + 0.5) continue;
        if (!(dist > r - 0.9 || dist > rn + 0.5)) continue;
        const x = cx + dx;
        const z = cz + dz;
        if (blocked && blocked(x, z)) continue;
        if (g.setIfAir(x, y0 + k, z, block)) g.setTag(x, y0 + k, z, TAG_ROOF);
      }
  }
}

export function coneProfile(R: number, height?: number): number[] {
  const h = height ?? Math.max(4, Math.round(R * 2.6));
  const out: number[] = [];
  for (let k = 0; k < h; k++) out.push(R * (1 - k / h));
  return out;
}

export function onionProfile(R0: number): number[] {
  const R1 = R0 + 2;
  const h = Math.round(R1 * 2.3 + 3);
  const out: number[] = [];
  for (let k = 0; k < h; k++) {
    const t = k / h;
    let r: number;
    if (t < 0.3) r = R0 + (R1 - R0) * Math.sin((t / 0.3) * (Math.PI / 2));
    else {
      const u = (t - 0.3) / 0.7;
      r = 0.45 + (R1 - 0.45) * Math.pow(1 - u, 3.4);
    }
    out.push(r);
  }
  return out;
}

export function setTip(g: VoxelGrid, x: number, y: number, z: number, kind: 'rod' | 'fence' | 'gold', fenceName: string, accent: number): number {
  if (kind === 'rod') {
    g.set(x, y, z, accent);
    g.set(x, y + 1, z, B('lightning_rod', { facing: 'up', powered: false, waterlogged: false }));
    g.set(x, y + 2, z, B('lightning_rod', { facing: 'up', powered: false, waterlogged: false }));
    return y + 2;
  }
  if (kind === 'gold') {
    g.set(x, y, z, B('gold_block'));
    g.set(x, y + 1, z, B(fenceName, { north: false, south: false, east: false, west: false, waterlogged: false }));
    g.set(x, y + 2, z, B(fenceName, { north: false, south: false, east: false, west: false, waterlogged: false }));
    return y + 2;
  }
  g.set(x, y, z, B(fenceName, { north: false, south: false, east: false, west: false, waterlogged: false }));
  g.set(x, y + 1, z, B(fenceName, { north: false, south: false, east: false, west: false, waterlogged: false }));
  g.set(x, y + 2, z, B('lightning_rod', { facing: 'up', powered: false, waterlogged: false }));
  return y + 2;
}

/** Removes roof cells that are completely buried (all six neighbours solid). */
export function pruneHidden(g: VoxelGrid): void {
  const rm: number[] = [];
  for (let y = 0; y < g.h; y++)
    for (let z = 0; z < g.l; z++)
      for (let x = 0; x < g.w; x++) {
        const i = g.idx(x, y, z);
        if (g.tag[i] !== TAG_ROOF || g.data[i] === AIR) continue;
        if (
          g.get(x + 1, y, z) !== AIR &&
          g.get(x - 1, y, z) !== AIR &&
          g.get(x, y, z + 1) !== AIR &&
          g.get(x, y, z - 1) !== AIR &&
          g.get(x, y + 1, z) !== AIR &&
          g.get(x, y - 1, z) !== AIR
        )
          rm.push(i);
      }
  for (const i of rm) g.data[i] = AIR;
  void TABLE;
}
