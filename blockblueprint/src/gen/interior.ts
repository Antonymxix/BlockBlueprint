import { AIR, B, Dir, DX, DZ, OPP, CW, lantern, slab, stairs, fence as fenceState } from '../core/blocks';
import { Rng, chance, rint } from '../core/rng';
import { BuildCtx, classify, floorY } from './walls';

interface Cell {
  x: number; // building-local
  z: number;
}

function isInterior(c: BuildCtx, f: number, x: number, z: number): boolean {
  const { layout } = c;
  if (f < 0 || f >= layout.levels) return false;
  if (x < 0 || z < 0 || x >= layout.gw || z >= layout.gl) return false;
  if (layout.F[f][z * layout.gw + x] !== 1) return false;
  return !classify(layout, f, x, z).isWall;
}

/** Cells reserved by the staircase (grid coordinates), so furniture and lamps keep out. */
export type Reserved = Set<string>;
const key = (x: number, z: number) => x + ',' + z;

/**
 * Finds a place for a switchback staircase: a (H+1) x 2 block of cells that is interior on every level.
 * Returns the placement or null.
 */
function findStairSpot(c: BuildCtx): { alongX: boolean; u0: number; v0: number } | null {
  const { layout, style } = c;
  const H = style.H;
  const L = layout.levels;
  const fits = (alongX: boolean, a: number, b: number): boolean => {
    for (let du = 0; du <= H; du++)
      for (let dv = 0; dv < 2; dv++) {
        const x = alongX ? a + du : b + dv;
        const z = alongX ? b + dv : a + du;
        for (let f = 0; f < L; f++) if (!isInterior(c, f, x, z)) return false;
      }
    return true;
  };
  // prefer the back of the house, away from the door
  for (let b = 0; b < layout.gl; b++)
    for (let a = 0; a < layout.gw; a++) if (fits(true, a, b)) return { alongX: true, u0: a, v0: b };
  for (let b = 0; b < layout.gw; b++)
    for (let a = 0; a < layout.gl; a++) if (fits(false, a, b)) return { alongX: false, u0: a, v0: b };
  return null;
}

/** Builds the switchback stair between all levels. Returns reserved grid cells. */
export function buildStairs(c: BuildCtx): Reserved {
  const { g, layout, style, ox, oz } = c;
  const reserved: Reserved = new Set();
  const L = layout.levels;
  if (L < 2) return reserved;
  const spot = findStairSpot(c);
  if (!spot) return reserved;
  const H = style.H;
  const base = style.roof.family === 'x' ? 'oak' : stairBase(style.floor);

  for (let f = 0; f < L - 1; f++) {
    const Y = floorY(style, f);
    const up = f % 2 === 0;
    for (let j = 0; j < H; j++) {
      // lane A for even flights (running +), lane B for odd flights (running -)
      const u = up ? spot.u0 + j : spot.u0 + H - j;
      const v = up ? spot.v0 : spot.v0 + 1;
      const x = (spot.alongX ? u : v) + ox;
      const z = (spot.alongX ? v : u) + oz;
      const facing: Dir = spot.alongX ? (up ? 'east' : 'west') : up ? 'south' : 'north';
      g.set(x, Y + 1 + j, z, stairs(base, facing));
      reserved.add(key(x, z));
      // open the slab above the climbing flight (headroom)
      if (j >= 1 && j <= H - 2) g.set(x, Y + H, z, AIR);
    }
    // landing cells
    const lu = up ? spot.u0 + H : spot.u0;
    const lv = up ? spot.v0 : spot.v0 + 1;
    reserved.add(key((spot.alongX ? lu : lv) + ox, (spot.alongX ? lv : lu) + oz));
    // railing next to the opening on the upper floor
  }
  // reserve both lanes fully
  for (let du = 0; du <= H; du++)
    for (let dv = 0; dv < 2; dv++) {
      const x = (spot.alongX ? spot.u0 + du : spot.v0 + dv) + ox;
      const z = (spot.alongX ? spot.v0 + dv : spot.u0 + du) + oz;
      reserved.add(key(x, z));
    }
  return reserved;
}

function stairBase(floorId: number): string {
  void floorId;
  return 'oak';
}

// ---------------------------------------------------------------------------
// Lights
// ---------------------------------------------------------------------------

export function buildLights(c: BuildCtx, reserved: Reserved): void {
  const { g, layout, style, ox, oz } = c;
  const H = style.H;
  for (let f = 0; f < layout.levels; f++) {
    const Y = floorY(style, f);
    const ceilY = Y + H;
    for (let z = 0; z < layout.gl; z++)
      for (let x = 0; x < layout.gw; x++) {
        if (!isInterior(c, f, x, z)) continue;
        const gx = x + ox;
        const gz = z + oz;
        if (((gx + 2) % 6 !== 0) || ((gz + 2) % 6 !== 0)) continue;
        if (reserved.has(key(gx, gz))) continue;
        // only below an existing ceiling
        if (g.get(gx, ceilY, gz) === AIR) continue;
        if (g.get(gx, ceilY - 1, gz) !== AIR) continue;
        if (style.light === 'sea_lantern') g.set(gx, ceilY - 1, gz, B('sea_lantern'));
        else g.set(gx, ceilY - 1, gz, lantern(style.light === 'soul_lantern' ? 'soul_lantern' : 'lantern', true));
      }
  }
}

// ---------------------------------------------------------------------------
// Furniture
// ---------------------------------------------------------------------------

export function buildFurniture(c: BuildCtx, reserved: Reserved): void {
  const { g, layout, style, ox, oz, rng } = c;
  const H = style.H;
  const woodBase = style.id === 'lair' || style.id === 'castle' ? 'dark_oak' : style.id === 'modern' ? 'birch' : style.id === 'fairytale' ? 'cherry' : 'spruce';
  const plate = woodBase + '_pressure_plate';
  const rugs = ['red_carpet', 'blue_wool', 'white_carpet', 'yellow_carpet'];
  for (let f = 0; f < layout.levels; f++) {
    const Y = floorY(style, f);
    const cells: Cell[] = [];
    for (let z = 0; z < layout.gl; z++)
      for (let x = 0; x < layout.gw; x++) if (isInterior(c, f, x, z) && !reserved.has(key(x + ox, z + oz))) cells.push({ x, z });
    if (cells.length < 12) continue;
    const used = new Set<string>();
    const free = (x: number, z: number) => {
      const k = key(x + ox, z + oz);
      return isInterior(c, f, x, z) && !reserved.has(k) && !used.has(k);
    };
    const mark = (x: number, z: number) => used.add(key(x + ox, z + oz));
    const nearWall = (x: number, z: number): Dir | null => {
      for (const d of ['north', 'south', 'east', 'west'] as Dir[]) {
        const nx = x + DX[d];
        const nz = z + DZ[d];
        if (nx < 0 || nz < 0 || nx >= layout.gw || nz >= layout.gl) return d;
        if (layout.F[f][nz * layout.gw + nx] !== 1 || classify(layout, f, nx, nz).isWall) return d;
      }
      return null;
    };
    // door area stays clear
    if (f === 0) {
      for (let dz = -3; dz <= 0; dz++) for (let dx = -2; dx <= style.door.width + 1; dx++) mark(layout.door.x + dx, layout.door.z + dz);
    }
    const shuffle = cells.slice();
    for (let i = shuffle.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [shuffle[i], shuffle[j]] = [shuffle[j], shuffle[i]];
    }
    // rug in the middle
    const mid = cells[Math.floor(cells.length / 2)];
    const rug = rugs[rint(rng, 0, rugs.length - 1)];
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!free(mid.x + dx, mid.z + dz)) continue;
        if (g.get(mid.x + dx + ox, Y + 1, mid.z + dz + oz) !== AIR) continue;
        g.set(mid.x + dx + ox, Y + 1, mid.z + dz + oz, B(rug));
        if (dx === 0 && dz === 0) continue;
      }
    let tables = 0;
    let shelves = 0;
    let props = 0;
    const maxTables = Math.max(1, Math.floor(cells.length / 60));
    for (const cell of shuffle) {
      const { x, z } = cell;
      if (!free(x, z)) continue;
      const wallDir = nearWall(x, z);
      if (wallDir && shelves < 3 && chance(rng, 0.25)) {
        // bookshelf, 2 high, against the wall
        if (g.get(x + ox, Y + 1, z + oz) === AIR && g.get(x + ox, Y + 2, z + oz) === AIR) {
          g.set(x + ox, Y + 1, z + oz, B('bookshelf'));
          g.set(x + ox, Y + 2, z + oz, B('bookshelf'));
          mark(x, z);
          shelves++;
          continue;
        }
      }
      if (wallDir && props < 4 && chance(rng, 0.18)) {
        if (g.get(x + ox, Y + 1, z + oz) === AIR) {
          g.set(x + ox, Y + 1, z + oz, B(chance(rng, 0.5) ? 'barrel' : 'crafting_table', chance(rng, 0.5) ? undefined : undefined));
          mark(x, z);
          props++;
          continue;
        }
      }
      if (!wallDir && tables < maxTables && chance(rng, 0.2)) {
        // table with two chairs
        const dirs: Dir[] = ['east', 'west', 'north', 'south'];
        const d = dirs[rint(rng, 0, 3)];
        const a = { x: x + DX[d], z: z + DZ[d] };
        const b = { x: x - DX[d], z: z - DZ[d] };
        if (!free(a.x, a.z) || !free(b.x, b.z)) continue;
        if (g.get(x + ox, Y + 1, z + oz) !== AIR) continue;
        g.set(x + ox, Y + 1, z + oz, fenceState(woodBase + '_fence'));
        g.set(x + ox, Y + 2, z + oz, B(plate, { powered: false }));
        // chairs: stair high-back faces away from the table
        if (g.get(a.x + ox, Y + 1, a.z + oz) === AIR) g.set(a.x + ox, Y + 1, a.z + oz, stairs(woodBase, d));
        if (g.get(b.x + ox, Y + 1, b.z + oz) === AIR) g.set(b.x + ox, Y + 1, b.z + oz, stairs(woodBase, OPP[d]));
        mark(x, z);
        mark(a.x, a.z);
        mark(b.x, b.z);
        tables++;
      }
    }
    void H;
    void slab;
    void CW;
  }
}
