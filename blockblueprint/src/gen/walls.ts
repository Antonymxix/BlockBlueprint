import { AIR, B, Dir, DX, DZ, door as doorStateLocal } from '../core/blocks';
import { VoxelGrid } from '../core/grid';
import { Rng, hash3, makeRng } from '../core/rng';
import { Layout } from './layout';
import { StyleDef, WallCtx } from './styles';

export const GROUND_Y = 2; // y of the grass surface, first floor slab sits here

export interface BuildCtx {
  g: VoxelGrid;
  layout: Layout;
  style: StyleDef;
  ox: number;
  oz: number;
  seed: number;
  glass: number;
  rng: Rng;
}

/** Y of the floor slab of level f. */
export function floorY(style: StyleDef, f: number): number {
  return GROUND_Y + f * style.H;
}

const N4: Array<[number, number, Dir]> = [
  [0, -1, 'north'],
  [1, 0, 'east'],
  [0, 1, 'south'],
  [-1, 0, 'west'],
];

export interface WallInfo {
  isWall: boolean;
  normals: Dir[];
}

/** Classifies a cell of one level's footprint. A wall touches the outside by any of its 8 neighbours. */
export function classify(layout: Layout, f: number, x: number, z: number): WallInfo {
  const F = layout.F[f];
  const { gw, gl } = layout;
  const inF = (a: number, b: number) => a >= 0 && b >= 0 && a < gw && b < gl && F[b * gw + a] === 1;
  if (!inF(x, z)) return { isWall: false, normals: [] };
  const normals: Dir[] = [];
  for (const [dx, dz, d] of N4) if (!inF(x + dx, z + dz)) normals.push(d);
  let wall = normals.length > 0;
  if (!wall) {
    for (let dz = -1; dz <= 1 && !wall; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        if (!inF(x + dx, z + dz)) {
          wall = true;
          break;
        }
      }
  }
  return { isWall: wall, normals };
}

export interface Run {
  normal: Dir;
  axis: 'x' | 'z';
  cells: Array<[number, number]>;
}

/** Straight wall runs (single outward normal) of one level. */
export function findRuns(layout: Layout, f: number): Run[] {
  const { gw, gl } = layout;
  const info = new Map<number, WallInfo>();
  const get = (x: number, z: number): WallInfo => {
    if (x < 0 || z < 0 || x >= gw || z >= gl) return { isWall: false, normals: [] };
    const k = z * gw + x;
    let v = info.get(k);
    if (!v) {
      v = classify(layout, f, x, z);
      info.set(k, v);
    }
    return v;
  };
  const straight = (x: number, z: number, d: Dir) => {
    const w = get(x, z);
    return w.isWall && w.normals.length === 1 && w.normals[0] === d;
  };
  const seen = new Set<number>();
  const runs: Run[] = [];
  for (let z = 0; z < gl; z++)
    for (let x = 0; x < gw; x++) {
      const w = get(x, z);
      if (!w.isWall || w.normals.length !== 1) continue;
      const d = w.normals[0];
      const key = z * gw + x;
      if (seen.has(key * 4 + (d === 'north' ? 0 : d === 'east' ? 1 : d === 'south' ? 2 : 3))) continue;
      const alongX = d === 'north' || d === 'south';
      const stepX = alongX ? 1 : 0;
      const stepZ = alongX ? 0 : 1;
      // walk to the start
      let sx = x;
      let sz = z;
      while (straight(sx - stepX, sz - stepZ, d)) {
        sx -= stepX;
        sz -= stepZ;
      }
      const cells: Array<[number, number]> = [];
      let cx = sx;
      let cz = sz;
      while (straight(cx, cz, d)) {
        cells.push([cx, cz]);
        seen.add((cz * gw + cx) * 4 + (d === 'north' ? 0 : d === 'east' ? 1 : d === 'south' ? 2 : 3));
        cx += stepX;
        cz += stepZ;
      }
      runs.push({ normal: d, axis: alongX ? 'x' : 'z', cells });
    }
  return runs;
}

/**
 * Floors, walls, windows and the front door for every level of the layout.
 * Roofs are built separately.
 */
export function buildBody(c: BuildCtx): void {
  const { g, layout, style, ox, oz } = c;
  const H = style.H;
  const [wr0, wr1] = style.winRows;

  for (let f = 0; f < layout.levels; f++) {
    const Y = floorY(style, f);
    const F = layout.F[f];
    const { gw, gl } = layout;
    const runs = findRuns(layout, f);

    // run lookup: cell -> {run, index}
    const runOf = new Map<number, { run: Run; i: number; seg: number[]; kinds: number[] }>();
    for (const run of runs) {
      const n = run.cells.length;
      const first = run.cells[0];
      const rrng = makeRng(Math.floor(hash3(first[0], f, first[1], c.seed) * 4294967295));
      const isFrontRun = run.normal === layout.door.normal && f === 0 && run.cells.some(([x, z]) => x === layout.door.x && z === layout.door.z);
      const ops = style.openings(n, rrng, { glass: c.glass, front: isFrontRun, f });
      const seg = new Array<number>(n).fill(0);
      for (const o of ops) for (let i = o.start; i < o.start + o.len && i < n; i++) seg[i] = o.kind;
      // door clear zone on the ground floor
      if (isFrontRun) {
        const di = run.cells.findIndex(([x, z]) => x === layout.door.x && z === layout.door.z);
        for (let i = di - 2; i <= di + style.door.width + 1; i++) if (i >= 0 && i < n) seg[i] = 0;
      }
      // frame posts next to windows
      const frame = new Array<number>(n).fill(0);
      if (style.frame !== undefined) {
        for (let i = 0; i < n; i++) {
          if (seg[i] === 1 && (i === 0 || seg[i - 1] !== 1)) if (i - 1 >= 0 && seg[i - 1] === 0) frame[i - 1] = 1;
          if (seg[i] === 1 && (i === n - 1 || seg[i + 1] !== 1)) if (i + 1 < n && seg[i + 1] === 0) frame[i + 1] = 1;
        }
      }
      run.cells.forEach(([x, z], i) => runOf.set(z * gw + x, { run, i, seg, kinds: frame }));
    }

    for (let z = 0; z < gl; z++)
      for (let x = 0; x < gw; x++) {
        if (F[z * gw + x] !== 1) continue;
        const gx = x + ox;
        const gz = z + oz;
        const wi = classify(layout, f, x, z);
        const top = f === layout.levels - 1;
        const ctx0 = (ry: number, extra?: Partial<WallCtx>): WallCtx => {
          const ro = runOf.get(z * gw + x);
          const h = hash3(gx, Y + ry, gz, c.seed);
          return {
            f,
            ry,
            x: gx,
            y: Y + ry,
            z: gz,
            i: ro ? ro.i : 0,
            n: ro ? ro.run.cells.length : 1,
            normal: ro ? ro.run.normal : wi.normals[0] ?? 'south',
            seg: ro ? ro.seg[ro.i] : 0,
            h,
            axis: ro ? ro.run.axis : 'x',
            top,
            ...extra,
          };
        };

        // floor / belt course
        if (wi.isWall) {
          g.set(gx, Y, gz, f === 0 ? style.found(ctx0(0)) : style.plate(ctx0(0)));
        } else {
          g.set(gx, Y, gz, style.floor);
        }

        for (let ry = 1; ry < H; ry++) {
          if (!wi.isWall) {
            g.set(gx, Y + ry, gz, AIR);
            continue;
          }
          const ro = runOf.get(z * gw + x);
          const straight = wi.normals.length === 1 && ro !== undefined;
          const ctx = ctx0(ry);
          let id: number;
          if (!straight) {
            id = style.pillar(ctx);
          } else if (f === 0 && ry <= style.foundRows) {
            id = style.found(ctx);
          } else if (ro!.seg[ro!.i] === 1 && ry >= wr0 && ry <= wr1) {
            id = style.windowBlock(ctx);
          } else if (ro!.seg[ro!.i] === 2) {
            id = style.accent(ctx);
          } else if (ro!.kinds[ro!.i] === 1 && style.frame !== undefined) {
            id = style.frame;
          } else {
            id = style.wall(ctx);
          }
          g.set(gx, Y + ry, gz, id);
        }
      }
  }

  // ceiling of the last level of every column (attic floor / roof deck base)
  for (let f = 0; f < layout.levels; f++) {
    const Y = floorY(style, f + 1);
    const F = layout.F[f];
    const Fn = f + 1 < layout.levels ? layout.F[f + 1] : null;
    const { gw, gl } = layout;
    for (let z = 0; z < gl; z++)
      for (let x = 0; x < gw; x++) {
        if (F[z * gw + x] !== 1) continue;
        if (Fn && Fn[z * gw + x] === 1) continue;
        const wi = classify(layout, f, x, z);
        const gx = x + ox;
        const gz = z + oz;
        const h = hash3(gx, Y, gz, c.seed);
        const ro: WallCtx = {
          f: f + 1,
          ry: 0,
          x: gx,
          y: Y,
          z: gz,
          i: 0,
          n: 1,
          normal: wi.normals[0] ?? 'south',
          seg: 0,
          h,
          axis: wi.normals[0] === 'east' || wi.normals[0] === 'west' ? 'z' : 'x',
          top: true,
        };
        g.set(gx, Y, gz, wi.isWall ? style.plate(ro) : style.floor);
      }
  }

  placeDoor(c);
}

/** Cuts the front door into the ground-level wall run. */
function placeDoor(c: BuildCtx): void {
  const { g, layout, style, ox, oz } = c;
  const { door } = layout;
  const f = 0;
  const Y = floorY(style, f);
  const n = door.normal;
  const w = style.door.width;
  const cells: Array<[number, number]> = [];
  const alongX = n === 'north' || n === 'south';
  for (let k = 0; k < w; k++) cells.push(alongX ? [door.x + k, door.z] : [door.x, door.z + k]);
  cells.forEach(([x, z], k) => {
    const gx = x + ox;
    const gz = z + oz;
    g.set(gx, Y, gz, style.floor);
    const hinge = w === 2 ? (k === 0 ? 'left' : 'right') : 'left';
    g.set(gx, Y + 1, gz, doorStateLocal(style.door.name, n, 'lower', hinge));
    g.set(gx, Y + 2, gz, doorStateLocal(style.door.name, n, 'upper', hinge));
    // lintel
    const ctx: WallCtx = {
      f,
      ry: 3,
      x: gx,
      y: Y + 3,
      z: gz,
      i: 0,
      n: 1,
      normal: n,
      seg: 0,
      h: 0.5,
      axis: alongX ? 'x' : 'z',
      top: false,
    };
    g.set(gx, Y + 3, gz, style.wall(ctx));
    void B;
  });
  void DX;
  void DZ;
}
