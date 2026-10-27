import { AIR, B, lantern, slab } from '../core/blocks';
import { Rng } from '../core/rng';
import { BuildCtx, classify, floorY } from './walls';
import { coneProfile, onionProfile, setTip, shell, TAG_ROOF } from './roofs';
import { WallCtx } from './styles';

export interface Tower {
  cx: number; // grid coordinates
  cz: number;
  r: number;
  top: number; // y of top plate
}

/** Convex corner cells of level 0 (building-local), sorted far-from-centre first. */
function cornerCandidates(c: BuildCtx, rng: Rng): Array<{ x: number; z: number }> {
  const { layout } = c;
  const out: Array<{ x: number; z: number; d: number }> = [];
  let sx = 0;
  let sz = 0;
  let n = 0;
  for (let z = 0; z < layout.gl; z++)
    for (let x = 0; x < layout.gw; x++) {
      if (layout.F[0][z * layout.gw + x] !== 1) continue;
      sx += x;
      sz += z;
      n++;
    }
  const mx = sx / Math.max(1, n);
  const mz = sz / Math.max(1, n);
  for (let z = 0; z < layout.gl; z++)
    for (let x = 0; x < layout.gw; x++) {
      const w = classify(layout, 0, x, z);
      if (!w.isWall || w.normals.length !== 2) continue;
      const [a, b] = w.normals;
      const perpendicular = (a === 'north' || a === 'south') !== (b === 'north' || b === 'south');
      if (!perpendicular) continue;
      out.push({ x, z, d: Math.hypot(x - mx, z - mz) + rng() * 0.5 });
    }
  out.sort((p, q) => q.d - p.d);
  return out;
}

export function buildTowers(c: BuildCtx, count: number): Tower[] {
  const { g, layout, style, ox, oz } = c;
  const H = style.H;
  const r = style.tower.r;
  const towers: Tower[] = [];
  if (count <= 0) return towers;

  const picks: Array<{ x: number; z: number }> = [];
  for (const cand of cornerCandidates(c, c.rng)) {
    if (picks.length >= count) break;
    if (picks.every((p) => Math.hypot(p.x - cand.x, p.z - cand.z) >= 2 * r + 5)) picks.push(cand);
  }

  for (const p of picks) {
    const cx = p.x + ox;
    const cz = p.z + oz;
    // levels of the house at this corner
    let hl = 0;
    for (let f = 0; f < layout.levels; f++) if (layout.F[f][p.z * layout.gw + p.x] === 1) hl = f + 1;
    const tLevels = hl + style.tower.extra;
    const top = floorY(style, tLevels);
    const inHouse = (x: number, z: number, f: number) => {
      const lx = x - ox;
      const lz = z - oz;
      if (f >= layout.levels || lx < 0 || lz < 0 || lx >= layout.gw || lz >= layout.gl) return false;
      return layout.F[f][lz * layout.gw + lx] === 1;
    };

    for (let f = 0; f <= tLevels; f++) {
      const Y = floorY(style, f);
      for (let dz = -r - 1; dz <= r + 1; dz++)
        for (let dx = -r - 1; dx <= r + 1; dx++) {
          const dist = Math.hypot(dx, dz);
          const x = cx + dx;
          const z = cz + dz;
          const isRing = dist <= r + 0.5 && dist > r - 0.5;
          const isIn = dist <= r - 0.5;
          if (!isRing && !isIn) continue;
          const lastPlate = f === tLevels;
          // below the house top the house itself owns these cells
          if (!lastPlate && inHouse(x, z, f)) continue;
          if (lastPlate && f < layout.levels && inHouse(x, z, f)) continue;
          const wc: WallCtx = {
            f,
            ry: 1,
            x,
            y: Y,
            z,
            i: 0,
            n: 1,
            normal: 'south',
            seg: 0,
            h: ((x * 73856093) ^ (Y * 19349663) ^ (z * 83492791)) % 1000 / 1000,
            axis: 'x',
            top: lastPlate,
          };
          if (wc.h < 0) wc.h = -wc.h;
          if (isRing) {
            g.set(x, Y, z, f === 0 ? style.found(wc) : style.tower.accent);
            if (lastPlate) continue;
            for (let ry = 1; ry < H; ry++) {
              wc.ry = ry;
              wc.y = Y + ry;
              const onAxis = (dx === 0 || dz === 0) && dist > r - 0.5 && dist <= r + 0.5;
              const [w0, w1] = style.winRows;
              if (onAxis && ry >= w0 && ry <= w1 && f > 0) g.set(x, Y + ry, z, style.tower.win);
              else if (f === 0 && ry <= style.foundRows) g.set(x, Y + ry, z, style.found(wc));
              else g.set(x, Y + ry, z, style.tower.wall(wc));
            }
          } else {
            g.set(x, Y, z, style.floor);
            if (lastPlate) continue;
            for (let ry = 1; ry < H; ry++) {
              g.set(x, Y + ry, z, AIR);
              g.setTag(x, Y + ry, z, 0);
            }
          }
        }
      // lamp in the middle of each level
      if (f < tLevels) {
        const ly = Y + H - 1;
        if (g.get(cx, ly, cz) === AIR && !inHouse(cx, cz, f)) g.set(cx, ly, cz, lantern(style.lamp, true));
      }
    }

    // doorway from the house into the tower (ground floor) through the nearest straight wall cell
    let best: { x: number; z: number; d: number } | null = null;
    for (let dz = -r; dz <= r; dz++)
      for (let dx = -r; dx <= r; dx++) {
        const x = cx + dx;
        const z = cz + dz;
        const dist = Math.hypot(dx, dz);
        if (dist > r - 0.5) continue;
        if (!inHouse(x, z, 0)) continue;
        const w = classify(layout, 0, x - ox, z - oz);
        if (!w.isWall || w.normals.length !== 1) continue;
        const dd = Math.abs(dist - 2);
        if (!best || dd < best.d) best = { x, z, d: dd };
      }
    if (best) {
      for (let ry = 1; ry <= 2; ry++) g.set(best.x, floorY(style, 0) + ry, best.z, AIR);
    }

    // top of the tower
    const tr = style.tower;
    const y0 = top + 1;
    if (tr.roof === 'flat') {
      for (let dz = -r - 1; dz <= r + 1; dz++)
        for (let dx = -r - 1; dx <= r + 1; dx++) {
          const dist = Math.hypot(dx, dz);
          if (dist <= r + 0.5 && dist > r - 0.5) {
            g.set(cx + dx, y0, cz + dz, tr.wall({ f: 0, ry: 0, x: cx + dx, y: y0, z: cz + dz, i: 0, n: 1, normal: 'south', seg: 0, h: 0.5, axis: 'x', top: true }));
            if ((dx + dz) % 2 === 0) g.set(cx + dx, y0 + 1, cz + dz, tr.wall({ f: 0, ry: 0, x: 0, y: 0, z: 0, i: 0, n: 1, normal: 'south', seg: 0, h: 0.5, axis: 'x', top: true }));
          }
        }
    } else {
      const prof = tr.roof === 'cone' ? coneProfile(r + 1.2, Math.round((r + 1) * (style.steep ? 3.4 : 2.6))) : onionProfile(r + 0.2);
      shell(g, cx, cz, y0, prof, tr.block);
      setTip(g, cx, y0 + prof.length, cz, tr.tip, style.fence, tr.accent);
    }
    towers.push({ cx, cz, r, top });
  }
  void B;
  void slab;
  void TAG_ROOF;
  return towers;
}
