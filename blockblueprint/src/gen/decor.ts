import { VoxelGrid } from '../core/grid';
import { AIR, B, Dir, DIRS, DX, DZ, TABLE, fence as fenceState, lantern, leaves, logAxis, slab, torch, water } from '../core/blocks';
import { Rng, chance, hash2, pick, rint } from '../core/rng';
import { Params } from './params';
import { StyleDef } from './styles';
import { BuildCtx, GROUND_Y, floorY } from './walls';
import { TAG_ROOF } from './roofs';

const Y_SURF = GROUND_Y; // grass surface y
const Y_ABOVE = GROUND_Y + 1;

function isBuilt(g: VoxelGrid, x: number, z: number): boolean {
  // any non-air block above the surface layer counts as built
  for (let y = Y_ABOVE; y < Math.min(g.h, Y_ABOVE + 3); y++) if (g.get(x, y, z) !== AIR) return true;
  return false;
}

export interface Plot {
  /** House footprint bounds in grid coordinates (level 0, including towers). */
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  doorX: number;
  doorZ: number;
  doorW: number;
}

// ---------------------------------------------------------------------------
// Entrance canopy
// ---------------------------------------------------------------------------

export function buildPorch(c: BuildCtx, plot: Plot): void {
  const { g, style } = c;
  if (style.id === 'castle') return;
  const Y = floorY(style, 0);
  const w = style.door.width;
  const x0 = plot.doorX - 1;
  const x1 = plot.doorX + w;
  const depth = 3;
  const roofY = Y + 3;
  for (let dz = 1; dz <= depth; dz++)
    for (let x = x0; x <= x1; x++) g.set(x, roofY, plot.doorZ + dz, slab(style.roof.family, 'bottom'));
  // posts at the two outer corners
  for (const x of [x0, x1]) {
    for (let y = Y + 1; y < roofY; y++) {
      g.set(x, y, plot.doorZ + depth, style.id === 'modern' ? B('black_concrete') : fenceState(style.fence.endsWith('_wall') ? 'oak_fence' : style.fence));
    }
    g.set(x, Y, plot.doorZ + depth, style.floor);
    // lantern hanging at the wall end of the canopy
    g.set(x, roofY - 1, plot.doorZ + 1, lantern(style.lamp, true));
  }
  // steps in front of the door
  for (let x = plot.doorX; x < plot.doorX + w; x++) {
    g.set(x, Y, plot.doorZ + 1, style.floor);
    g.set(x, Y, plot.doorZ + 2, style.floor);
  }
}

// ---------------------------------------------------------------------------
// Chimney
// ---------------------------------------------------------------------------

export function buildChimney(c: BuildCtx, wingX: number, wingZ: number, w: number, d: number, ridge: 'x' | 'z', Y: number): void {
  const { g, style } = c;
  const side = chance(c.rng, 0.5) ? 1 : -1;
  let cx: number;
  let cz: number;
  if (ridge === 'x') {
    cx = side > 0 ? wingX + w - 3 : wingX + 2;
    cz = wingZ + Math.floor(d / 2);
  } else {
    cz = side > 0 ? wingZ + d - 3 : wingZ + 2;
    cx = wingX + Math.floor(w / 2);
  }
  let top = Y;
  for (let y = Y; y < g.h; y++) if (g.get(cx, y, cz) !== AIR) top = y;
  const cap = top + 2;
  for (let y = Y + 1; y <= cap; y++) {
    g.set(cx, y, cz, style.chimney);
    g.setTag(cx, y, cz, 0);
  }
  g.set(cx, cap + 1, cz, B('stone_brick_slab', { type: 'bottom', waterlogged: false }));
}

// ---------------------------------------------------------------------------
// Trees
// ---------------------------------------------------------------------------

type TreeKind = StyleDef['tree'];

export function plantTree(g: VoxelGrid, x: number, z: number, kind: TreeKind, rng: Rng, groundY = Y_SURF): void {
  const leafName = kind + '_leaves';
  const logName = kind + '_log';
  const base = groundY + 1;
  const L = () => leaves(leafName);
  const log = logAxis(logName, 'y');
  const put = (px: number, py: number, pz: number) => {
    if (g.get(px, py, pz) === AIR) g.set(px, py, pz, L());
  };
  if (kind === 'spruce') {
    const h = rint(rng, 8, 12);
    for (let y = 0; y < h; y++) g.set(x, base + y, z, log);
    const radii = [3, 2, 3, 2, 2, 1, 2, 1, 1, 0];
    let ri = 0;
    for (let y = base + 2; y <= base + h; y++) {
      const r = Math.max(0, Math.round(radii[Math.min(ri++, radii.length - 1)] * Math.max(0.5, (base + h - y + 2) / (h - 1)) * 1.2));
      for (let dz = -r; dz <= r; dz++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) + Math.abs(dz) > r + (r > 1 ? 1 : 0)) continue;
          if (dx === 0 && dz === 0 && y <= base + h - 1) continue;
          put(x + dx, y, z + dz);
        }
    }
    put(x, base + h, z);
    put(x, base + h + 1, z);
    return;
  }
  const big = kind === 'cherry' || kind === 'dark_oak';
  const h = kind === 'birch' ? rint(rng, 6, 8) : rint(rng, 5, 7);
  for (let y = 0; y < h; y++) g.set(x, base + y, z, log);
  const top = base + h - 1;
  const R = big ? 3 : 2;
  for (let dy = -2; dy <= 1; dy++) {
    const r = dy >= 1 ? R - 2 : dy === 0 ? R - 1 : R;
    for (let dz = -r; dz <= r; dz++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) === r && Math.abs(dz) === r && r > 1 && chance(rng, 0.7)) continue;
        if (dx === 0 && dz === 0 && dy <= 0) continue;
        put(x + dx, top + dy, z + dz);
      }
  }
  put(x, top + 2, z);
  // a few hanging leaves for volume
  for (let i = 0; i < 4; i++) put(x + rint(rng, -R, R), top - 3, z + rint(rng, -R, R));
}

// ---------------------------------------------------------------------------
// Garden
// ---------------------------------------------------------------------------

export function buildGarden(c: BuildCtx, plot: Plot, p: Params): void {
  const { g, style, rng, seed } = c;
  const free = (x: number, z: number) => !isBuilt(g, x, z) && g.get(x, Y_SURF, z) === style.groundCover;

  // --- path from the door to the edge of the plot
  const pathCells = new Set<number>();
  const startZ = plot.doorZ + 1;
  const len = g.l - 1 - startZ;
  const amp = 1 + Math.floor(rng() * 2);
  const phase = rng() * Math.PI * 2;
  for (let z = startZ; z < g.l; z++) {
    const t = (z - startZ) / Math.max(1, len);
    const ramp = Math.min(1, (z - startZ) / 6);
    const off = Math.round(Math.sin(t * Math.PI * 2 + phase) * amp * ramp);
    for (let k = -1; k <= style.door.width; k++) {
      const x = plot.doorX + off + k;
      if (k === -1 || k === style.door.width) {
        if (hash2(x, z, seed) < 0.5) continue; // ragged edges
      }
      const cur = g.get(x, Y_SURF, z);
      if (cur !== style.groundCover && cur !== B('dirt')) continue;
      const blocks = style.path;
      const id = blocks[Math.floor(hash2(x, z, seed + 5) * blocks.length)];
      g.set(x, Y_SURF, z, id);
      pathCells.add(z * g.w + x);
    }
  }

  // --- flower beds hugging the house, and scattered ground cover
  const nearHouse = (x: number, z: number) => {
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (isBuilt(g, x + dx, z + dz)) return true;
    return false;
  };
  for (let z = 0; z < g.l; z++)
    for (let x = 0; x < g.w; x++) {
      if (!free(x, z) || pathCells.has(z * g.w + x)) continue;
      const hv = hash2(x, z, seed + 11);
      if (nearHouse(x, z)) {
        if (hv < 0.42 && !pathCells.has(z * g.w + x)) {
          const f = style.flowers[Math.floor(hash2(x, z, seed + 3) * style.flowers.length)];
          g.set(x, Y_ABOVE, z, B(f));
        }
      } else if (p.garden) {
        if (hv < 0.05) g.set(x, Y_ABOVE, z, B(style.flowers[Math.floor(hash2(x, z, seed + 2) * style.flowers.length)]));
        else if (hv < 0.2) g.set(x, Y_ABOVE, z, B('short_grass'));
      }
    }

  if (!p.garden) return;

  // --- fence around the plot (not for moated castles)
  if (!style.moat) {
    const f = Math.max(2, 3);
    const fx0 = f;
    const fz0 = f;
    const fx1 = g.w - 1 - f;
    const fz1 = g.l - 1 - f;
    const fenceId = fenceStateFor(style);
    for (let x = fx0; x <= fx1; x++)
      for (const z of [fz0, fz1]) {
        if (pathCells.has(z * g.w + x) || pathCells.has((z - 1) * g.w + x)) continue;
        if (g.get(x, Y_ABOVE, z) === AIR || TABLE.base(g.get(x, Y_ABOVE, z)).includes('grass') || isFlower(g.get(x, Y_ABOVE, z))) g.set(x, Y_ABOVE, z, fenceId);
      }
    for (let z = fz0; z <= fz1; z++)
      for (const x of [fx0, fx1]) {
        if (g.get(x, Y_ABOVE, z) === AIR || isFlower(g.get(x, Y_ABOVE, z)) || TABLE.base(g.get(x, Y_ABOVE, z)).includes('grass')) g.set(x, Y_ABOVE, z, fenceId);
      }
    // lamp posts at the gate
    for (const side of [-2, style.door.width + 1]) {
      const x = plot.doorX + side;
      const z = fz1;
      for (let y = Y_ABOVE; y < Y_ABOVE + 3; y++) g.set(x, y, z, fenceId);
      g.set(x, Y_ABOVE + 3, z, lantern(style.lamp, false));
    }
  }

  // --- trees
  const attempts = Math.floor((g.w * g.l) / 70) + 4;
  const placed: Array<[number, number]> = [];
  for (let i = 0; i < attempts; i++) {
    const x = rint(rng, 5, g.w - 6);
    const z = rint(rng, 5, g.l - 6);
    if (!free(x, z) || pathCells.has(z * g.w + x)) continue;
    // keep clear of the house, the path and other trees
    let ok = true;
    for (let dz = -3; dz <= 3 && ok; dz++)
      for (let dx = -3; dx <= 3; dx++) if (isBuilt(g, x + dx, z + dz) && TABLE.base(g.get(x + dx, Y_ABOVE, z + dz)) !== 'short_grass' && !isFlower(g.get(x + dx, Y_ABOVE, z + dz))) ok = false;
    if (!ok) continue;
    for (const [px, pz] of placed) if (Math.hypot(px - x, pz - z) < 6) ok = false;
    if (!ok) continue;
    for (let dz = -3; dz <= 3 && ok; dz++) for (let dx = -3; dx <= 3; dx++) if (pathCells.has((z + dz) * g.w + x + dx)) ok = false;
    if (!ok) continue;
    // moat/pool water check
    if (TABLE.base(g.get(x, Y_SURF, z)) === 'water') continue;
    g.set(x, Y_ABOVE, z, AIR);
    plantTree(g, x, z, style.tree, rng);
    placed.push([x, z]);
  }
}

function isFlower(id: number): boolean {
  if (id === AIR) return false;
  const b = TABLE.base(id);
  return ['poppy', 'dandelion', 'cornflower', 'allium', 'red_tulip', 'pink_tulip', 'azure_bluet', 'oxeye_daisy', 'short_grass'].includes(b);
}

function fenceStateFor(style: StyleDef): number {
  if (style.fence.endsWith('_wall')) return B(style.fence, { up: true, north: 'none', south: 'none', east: 'none', west: 'none', waterlogged: false });
  return fenceState(style.fence);
}

// ---------------------------------------------------------------------------
// Pool and moat
// ---------------------------------------------------------------------------

export function buildPool(c: BuildCtx, plot: Plot): void {
  const { g, style, rng } = c;
  const modern = style.id === 'modern';
  const pw = Math.min(11, Math.max(5, plot.x1 - plot.x0 - 6));
  const ph = 5;
  const cx = Math.floor((plot.x0 + plot.x1) / 2);
  const x0 = cx - Math.floor(pw / 2);
  const z1 = plot.z0 - 3;
  const z0 = z1 - ph + 1;
  if (z0 < 4) return;
  const rim = modern ? B('smooth_quartz') : B('cobblestone');
  for (let z = z0 - 1; z <= z1 + 1; z++)
    for (let x = x0 - 1; x <= x0 + pw; x++) {
      const inside = x >= x0 && x < x0 + pw && z >= z0 && z <= z1;
      const corner = inside && (x === x0 || x === x0 + pw - 1) && (z === z0 || z === z1) && !modern;
      if (inside && !corner) {
        g.set(x, 0, z, modern ? B('smooth_quartz') : B('stone'));
        g.set(x, 1, z, water());
        g.set(x, Y_SURF, z, water());
        g.set(x, Y_ABOVE, z, AIR);
      } else {
        g.set(x, Y_SURF, z, rim);
        g.set(x, Y_ABOVE, z, AIR);
      }
    }
  // underwater lights
  for (let z = z0 + 1; z < z1; z += 2)
    for (let x = x0 + 1; x < x0 + pw - 1; x += 3) g.set(x, 0, z, B('sea_lantern'));
  // loungers: slab + stair
  if (modern) {
    for (let i = 0; i < 2; i++) {
      const lx = x0 + 1 + i * 3;
      const lz = z0 - 3;
      g.set(lx, Y_SURF, lz, rim);
      g.set(lx, Y_ABOVE, lz, B('white_wool'));
      g.set(lx, Y_ABOVE, lz - 1, B('white_wool'));
    }
  }
  void rng;
}

export function buildMoat(c: BuildCtx, plot: Plot, towerR: number): void {
  const { g, style } = c;
  const inner = towerR + 3;
  const outer = inner + 2;
  const bx0 = plot.x0;
  const bx1 = plot.x1;
  const bz0 = plot.z0;
  const bz1 = plot.z1;
  for (let z = 0; z < g.l; z++)
    for (let x = 0; x < g.w; x++) {
      const dx = Math.max(bx0 - x, 0, x - bx1);
      const dz = Math.max(bz0 - z, 0, z - bz1);
      const d = Math.max(dx, dz);
      if (d < inner || d > outer) continue;
      g.set(x, 0, z, B('dirt'));
      g.set(x, 1, z, water());
      g.set(x, Y_SURF, z, water());
      g.set(x, Y_ABOVE, z, AIR);
    }
  // drawbridge in front of the door
  const w = style.door.width;
  for (let z = plot.doorZ + 1; z <= bz1 + outer + 1; z++)
    for (let x = plot.doorX - 1; x <= plot.doorX + w; x++) {
      if (TABLE.base(g.get(x, Y_SURF, z)) !== 'water') continue;
      g.set(x, Y_SURF, z, B('dark_oak_planks'));
      if (x === plot.doorX - 1 || x === plot.doorX + w) {
        g.set(x, Y_ABOVE, z, fenceState('dark_oak_fence'));
        if ((z - plot.doorZ) % 3 === 0) g.set(x, Y_ABOVE + 1, z, torch());
      }
    }
}

export function tidyRoofTags(g: VoxelGrid): void {
  void TAG_ROOF;
  void DIRS;
  void DX;
  void DZ;
  void pick;
}
