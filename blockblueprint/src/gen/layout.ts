import { Dir } from '../core/blocks';
import { Rng, rint, chance } from '../core/rng';
import { Params, RoofId, ShapeId } from './params';

/** A rectangular block of rooms. x/z are building-local, w/d are outer wall to outer wall. */
export interface Wing {
  x: number;
  z: number;
  w: number;
  d: number;
  /** First floor (inclusive) and last floor (exclusive) this wing occupies. */
  f0: number;
  f1: number;
  roof: RoofId;
  /** Gable ridge axis; for hip/others unused. */
  ridge: 'x' | 'z';
  main?: boolean;
}

export interface Layout {
  gw: number;
  gl: number;
  wings: Wing[];
  levels: number;
  /** Footprint per level: 1 where a room exists. Indexed [level][z * gw + x]. */
  F: Uint8Array[];
  door: { x: number; z: number; normal: Dir };
  mainWing: Wing;
  shape: ShapeId;
}

const MIN_WING = 7;

export function resolveShape(p: Params, rng: Rng): ShapeId {
  if (p.shape !== 'auto') return p.shape;
  const r = rng();
  return r < 0.4 ? 'box' : r < 0.6 ? 'L' : r < 0.8 ? 'T' : 'U';
}

/**
 * Turns the parameters into a list of wings. All coordinates are non-negative and
 * relative to the building's own corner, so the caller can offset them into the grid.
 */
export function makeLayout(p: Params, shape: ShapeId, roof: RoofId, rng: Rng): Layout {
  const W = p.width;
  const D = p.depth;
  const n = p.floors;
  const wings: Wing[] = [];
  let door = { x: 0, z: 0, normal: 'south' as Dir };

  const longAxis = (w: number, d: number): 'x' | 'z' => (w >= d ? 'x' : 'z');

  if (shape === 'box') {
    if (p.style === 'modern' && n >= 2) {
      // Stacked boxes with cantilevers.
      wings.push({ x: 0, z: 0, w: W, d: D, f0: 0, f1: 1, roof: 'flat', ridge: 'x', main: true });
      let prev = { x: 0, z: 0, w: W, d: D };
      for (let f = 1; f < n; f++) {
        const w2 = Math.max(MIN_WING + 2, Math.round(prev.w * (0.62 + rng() * 0.28)));
        const d2 = Math.max(MIN_WING + 2, Math.round(prev.d * (0.7 + rng() * 0.25)));
        // Keep the stair area (back-left of the main block) covered by every floor.
        const minX = Math.max(-2, prev.x - 3);
        const maxX = Math.min(prev.x + prev.w - w2 + 3, W - w2 + 2);
        let x2 = rint(rng, Math.min(minX, maxX), Math.max(minX, maxX));
        const minZ = Math.max(-2, prev.z - 2);
        const maxZ = Math.min(prev.z + prev.d - d2 + 2, D - d2 + 2);
        let z2 = rint(rng, Math.min(minZ, maxZ), Math.max(minZ, maxZ));
        if (f === 1 && chance(rng, 0.5)) x2 = 0 + (chance(rng, 0.5) ? 0 : W - w2);
        // stair area x: 1..H+2, z: 1..3 must stay inside
        x2 = Math.min(x2, 2);
        z2 = Math.min(z2, 2);
        wings.push({ x: x2, z: z2, w: w2, d: d2, f0: f, f1: f + 1, roof: 'flat', ridge: 'x' });
        prev = { x: x2, z: z2, w: w2, d: d2 };
      }
      // Normalise so min x/z are 0 (cantilevers may be negative).
      let mx = 0;
      let mz = 0;
      for (const w of wings) {
        mx = Math.min(mx, w.x);
        mz = Math.min(mz, w.z);
      }
      for (const w of wings) {
        w.x -= mx;
        w.z -= mz;
      }
      const m = wings[0];
      door = { x: m.x + Math.floor(m.w / 2), z: m.z + m.d - 1, normal: 'south' };
    } else {
      wings.push({ x: 0, z: 0, w: W, d: D, f0: 0, f1: n, roof, ridge: longAxis(W, D), main: true });
      door = { x: Math.floor(W / 2), z: D - 1, normal: 'south' };
    }
  } else if (shape === 'L') {
    const d1 = Math.max(MIN_WING, Math.round(D * 0.55));
    const w2 = Math.max(MIN_WING, Math.round(W * 0.4));
    const flip = chance(rng, 0.5);
    const mainX = 0;
    const sideX = flip ? W - w2 : 0;
    wings.push({ x: mainX, z: D - d1, w: W, d: d1, f0: 0, f1: n, roof, ridge: 'x', main: true });
    wings.push({ x: sideX, z: 0, w: w2, d: D, f0: 0, f1: Math.max(1, n - (n > 2 ? 1 : 0)), roof, ridge: 'z' });
    // Door on the long front facade, away from the side wing.
    const cx = flip ? Math.floor((W - w2) / 2) : w2 + Math.floor((W - w2) / 2);
    door = { x: cx, z: D - 1, normal: 'south' };
  } else if (shape === 'T') {
    const d1 = Math.max(MIN_WING, Math.round(D * 0.5));
    const w2 = Math.max(MIN_WING, Math.round(W * 0.4));
    wings.push({ x: 0, z: D - d1, w: W, d: d1, f0: 0, f1: n, roof, ridge: 'x', main: true });
    wings.push({ x: Math.floor((W - w2) / 2), z: 0, w: w2, d: D, f0: 0, f1: n, roof, ridge: 'z' });
    // Door left of the stem so it is not hidden inside the T.
    door = { x: Math.max(3, Math.floor((W - w2) / 4)), z: D - 1, normal: 'south' };
    if (door.x < 3) door.x = 3;
  } else {
    // U: back wing plus two side wings opening to the south, door on the courtyard side.
    const d1 = Math.max(MIN_WING, Math.round(D * 0.4));
    const w2 = Math.max(MIN_WING, Math.min(Math.round(W * 0.3), Math.floor((W - 7) / 2)));
    wings.push({ x: 0, z: 0, w: W, d: d1, f0: 0, f1: n, roof, ridge: 'x', main: true });
    wings.push({ x: 0, z: 0, w: w2, d: D, f0: 0, f1: n, roof, ridge: 'z' });
    wings.push({ x: W - w2, z: 0, w: w2, d: D, f0: 0, f1: n, roof, ridge: 'z' });
    door = { x: Math.floor(W / 2), z: d1 - 1, normal: 'south' };
  }

  let gw = 0;
  let gl = 0;
  let levels = 0;
  for (const w of wings) {
    gw = Math.max(gw, w.x + w.w);
    gl = Math.max(gl, w.z + w.d);
    levels = Math.max(levels, w.f1);
  }
  const F: Uint8Array[] = [];
  for (let f = 0; f < levels; f++) {
    const a = new Uint8Array(gw * gl);
    for (const w of wings) {
      if (f < w.f0 || f >= w.f1) continue;
      for (let z = w.z; z < w.z + w.d; z++) for (let x = w.x; x < w.x + w.w; x++) a[z * gw + x] = 1;
    }
    F.push(a);
  }
  return { gw, gl, wings, levels, F, door, mainWing: wings[0], shape };
}
