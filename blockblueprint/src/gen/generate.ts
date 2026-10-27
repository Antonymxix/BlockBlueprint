import { VoxelGrid, finalizeGrid } from '../core/grid';
import { AIR, B, TABLE, DEFS, Dir, defOf, door, lantern, slab, stairs } from '../core/blocks';
import { makeRng, Rng, pick } from '../core/rng';
import { Params, PRESETS, RoofId, ShapeId, clampParams } from './params';
import { Layout, Wing, makeLayout, resolveShape } from './layout';
import { StyleDef, makeStyle } from './styles';
import { BuildCtx, GROUND_Y, buildBody, classify, floorY } from './walls';
import { gable, hip, shed, shell, onionProfile, coneProfile, setTip, putRoof, pruneHidden } from './roofs';
import { buildTowers } from './towers';
import { Plot, buildChimney, buildGarden, buildMoat, buildPool, buildPorch } from './decor';
import { buildFurniture, buildLights, buildStairs } from './interior';

export interface GenInfo {
  style: StyleDef['id'];
  shape: ShapeId;
  roof: RoofId;
  levels: number;
  wings: number;
  towers: number;
  blocks: number;
}

export interface GenResult {
  grid: VoxelGrid;
  /** Paste origin (grid coordinates): front of the door at ground level. */
  origin: [number, number, number];
  params: Params;
  info: GenInfo;
  /** Number of lit decorative sources (lanterns etc.), useful for tests. */
  doorCell: [number, number, number];
}

function resolveRoof(p: Params): RoofId {
  if (p.roof !== 'auto') return p.roof;
  return PRESETS[p.style].defaults.roof;
}

/** Generates a complete plot: terrain, house, garden. Deterministic for a given parameter set. */
export function generate(input: Params): GenResult {
  const p = clampParams(input);
  const rng = makeRng(p.seed * 2654435761 + 12345);
  const style = makeStyle(p.style, rng);
  const shape = resolveShape(p, rng);
  const roof = resolveRoof(p);
  const layout = makeLayout(p, shape, roof, rng);

  const M = style.moat && p.ground ? 15 : 10;
  const towerExtra = p.towers > 0 ? style.tower.extra : 0;
  const maxLevels = layout.levels + towerExtra;
  const roofRoom = Math.round((style.tower.r + 1) * 3.6) + 6 + Math.ceil(Math.max(layout.gw, layout.gl) / 2);
  const gh = Math.min(256, floorY(style, maxLevels) + Math.max(roofRoom, 26));
  const ox = M + (p.towers > 0 ? style.tower.r : 0);
  const oz = M + (p.towers > 0 ? style.tower.r : 0);
  const gwTotal = layout.gw + 2 * ox;
  const glTotal = layout.gl + 2 * oz;
  const g = new VoxelGrid(gwTotal, gh, glTotal);

  const ctx: BuildCtx = { g, layout, style, ox, oz, seed: p.seed, glass: p.glass, rng };

  // --- terrain
  if (p.ground) {
    for (let z = 0; z < glTotal; z++)
      for (let x = 0; x < gwTotal; x++) {
        g.set(x, 0, z, B('dirt'));
        g.set(x, 1, z, B('dirt'));
        g.set(x, GROUND_Y, z, style.groundCover);
      }
  }

  // --- body and roofs
  buildBody(ctx);
  const towerList = buildRoofsAndTowers(ctx, p);
  void towerList;

  const dw = style.door.width;
  const plot: Plot = {
    x0: ox - (p.towers > 0 ? style.tower.r : 0),
    z0: oz - (p.towers > 0 ? style.tower.r : 0),
    x1: ox + layout.gw - 1 + (p.towers > 0 ? style.tower.r : 0),
    z1: oz + layout.gl - 1 + (p.towers > 0 ? style.tower.r : 0),
    doorX: layout.door.x + ox,
    doorZ: layout.door.z + oz,
    doorW: dw,
  };

  buildPorch(ctx, plot);

  // chimney on the main pitched roof
  const mw = layout.mainWing;
  const mainRoof = mw.roof;
  if ((mainRoof === 'gable' || mainRoof === 'hip' || mainRoof === 'shed') && style.id !== 'modern' && mw.f1 === layout.levels) {
    buildChimney(ctx, mw.x + ox, mw.z + oz, mw.w, mw.d, mw.ridge, floorY(style, mw.f1));
  }

  // --- interior and lights
  let reserved = new Set<string>();
  if (p.interior) reserved = buildStairs(ctx);
  buildLights(ctx, reserved);
  if (p.interior) buildFurniture(ctx, reserved);

  // --- grounds
  if (p.ground) {
    if (style.moat) buildMoat(ctx, plot, style.tower.r);
    if (p.pool && !style.moat) buildPool(ctx, plot);
    buildGarden(ctx, plot, p);
  }

  pruneHidden(g);
  finalizeGrid(g);

  const origin: [number, number, number] = [plot.doorX, GROUND_Y + 1, plot.doorZ + 4];
  const info: GenInfo = {
    style: p.style,
    shape,
    roof,
    levels: layout.levels,
    wings: layout.wings.length,
    towers: p.towers,
    blocks: g.count(),
  };
  return { grid: g, origin, params: p, info, doorCell: [plot.doorX, GROUND_Y + 1, plot.doorZ] };
}

// ---------------------------------------------------------------------------

function buildRoofsAndTowers(c: BuildCtx, p: Params) {
  const { g, layout, style, ox, oz } = c;
  const covered = (f1: number) => (x: number, z: number) => {
    const lx = x - ox;
    const lz = z - oz;
    if (lx < 0 || lz < 0 || lx >= layout.gw || lz >= layout.gl) return false;
    for (let l = f1; l < layout.levels; l++) if (layout.F[l][lz * layout.gw + lx] === 1) return true;
    return false;
  };

  // the main wing first so its roof wins the overlaps
  const order = layout.wings.slice().sort((a, b) => (b.main ? 1 : 0) - (a.main ? 1 : 0) || (b.f1 - a.f1));
  const resolved = new Map<Wing, RoofId>();
  for (const w of order) {
    let r = w.roof === 'auto' ? 'gable' : w.roof;
    if ((r === 'cone' || r === 'onion') && !w.main) r = 'hip';
    resolved.set(w, r);
    roofWing(c, w, r, covered(w.f1));
  }
  const towers = buildTowers(c, p.towers);
  void pick;
  return towers;
}

function roofWing(c: BuildCtx, w: Wing, kind: RoofId, blocked: (x: number, z: number) => boolean): void {
  const { g, style, ox, oz, layout } = c;
  const Y = floorY(style, w.f1);
  const x0 = w.x + ox;
  const z0 = w.z + oz;
  const mat = style.roof;
  const o = {
    g,
    mat,
    x0,
    z0,
    w: w.w,
    d: w.d,
    Y,
    blocked,
    fill: (x: number, y: number, z: number, k: number, u: number, uMid: number) => {
      const wc = {
        f: w.f1,
        ry: 1,
        x,
        y,
        z,
        i: 0,
        n: 1,
        normal: 'south' as Dir,
        seg: 0,
        h: ((x * 374761393 + y * 668265263 + z * 2147483647) >>> 0) / 4294967296,
        axis: (w.ridge === 'x' ? 'x' : 'z') as 'x' | 'z',
        top: true,
      };
      // small round-ish window in the gable end
      if (k === 2 && Math.abs(u - uMid) < 0.6 && style.id !== 'modern' && style.id !== 'castle') return style.windowBlock(wc);
      return style.wall(wc);
    },
  };

  switch (kind) {
    case 'flat':
      flatRoof(c, w, blocked);
      break;
    case 'gable':
      gable(o, w.ridge);
      break;
    case 'hip':
      hip(o);
      break;
    case 'shed': {
      // slope falls toward the door side (south) by default
      const highs: Dir[] = ['north', 'east', 'west', 'south'];
      const h = style.id === 'modern' ? (c.rng() < 0.6 ? 'north' : highs[Math.floor(c.rng() * 4)]) : 'north';
      shed(o, h);
      break;
    }
    case 'cone':
    case 'onion': {
      flatRoof(c, w, blocked);
      const R = Math.max(3, Math.floor(Math.min(w.w, w.d) / 2) - 1);
      const cx = x0 + Math.floor(w.w / 2);
      const cz = z0 + Math.floor(w.d / 2);
      const prof = kind === 'cone' ? coneProfile(R + 0.5, Math.round(R * 3.2)) : onionProfile(R - 0.8);
      const base = Y + 1 + (style.parapet === 'none' ? 0 : 1);
      const block = style.tower.block;
      shell(g, cx, cz, base, prof, block);
      setTip(g, cx, base + prof.length, cz, style.tower.tip, style.fence, style.tower.accent);
      break;
    }
    default:
      gable(o, w.ridge);
  }
  void layout;
}

function flatRoof(c: BuildCtx, w: Wing, blocked: (x: number, z: number) => boolean): void {
  const { g, style, ox, oz, layout } = c;
  const Y = floorY(style, w.f1);
  const x0 = w.x + ox;
  const z0 = w.z + oz;
  const mat = style.roof;
  const parapet = style.parapet;
  const wallAt = (x: number, z: number) => classify(layout, w.f1 - 1, x - ox, z - oz).isWall;
  const inRect = (x: number, z: number) => x >= x0 && z >= z0 && x < x0 + w.w && z < z0 + w.d;
  const over = parapet === 'rail' ? 1 : 0;
  for (let z = z0 - over; z < z0 + w.d + over; z++)
    for (let x = x0 - over; x < x0 + w.w + over; x++) {
      if (blocked(x, z)) continue;
      const inside = inRect(x, z);
      if (inside) {
        // deck: keep the plate on wall cells, roof block on rooms
        if (!wallAt(x, z)) g.set(x, Y, z, mat.block);
        // parapets sit on the outermost cells
        if (parapet === 'battlement' && wallAt(x, z)) {
          g.set(x, Y + 1, z, mat.block);
          if ((x + z) % 2 === 0) g.set(x, Y + 2, z, mat.block);
        }
      } else {
        g.set(x, Y, z, slab(mat.family, 'top'));
        const ring = x === x0 - 1 || z === z0 - 1 || x === x0 + w.w || z === z0 + w.d;
        if (ring && parapet === 'rail') {
          if (style.id === 'modern') g.set(x, Y + 1, z, B('glass_pane', { north: false, south: false, east: false, west: false, waterlogged: false }));
          else g.set(x, Y + 1, z, B(style.fence, { north: false, south: false, east: false, west: false, waterlogged: false }));
        }
      }
    }
  void TABLE;
  void DEFS;
  void defOf;
  void AIR;
  void door;
  void lantern;
  void stairs;
  void putRoof;
}
