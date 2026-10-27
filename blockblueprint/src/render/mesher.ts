import { VoxelGrid } from '../core/grid';
import { TABLE, isOpaque } from '../core/blocks';
import { hash2 } from '../core/rng';
import { Atlas } from './textures';
import { Model, getModel } from './models';
import { LightField } from './light';

export interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  /** Ambient occlusion shade, one float per vertex. */
  ao: Float32Array;
  /** Block light colour, 3 floats per vertex (0-1). */
  blockLight: Float32Array;
  skyLight: Float32Array;
  /** Build order for the construction animation. */
  order: Float32Array;
  indices: Uint32Array;
}

class Builder {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  ao: number[] = [];
  bl: number[] = [];
  sl: number[] = [];
  ord: number[] = [];
  idx: number[] = [];
  n = 0;
  finish(): MeshData {
    return {
      positions: new Float32Array(this.pos),
      normals: new Float32Array(this.nor),
      uvs: new Float32Array(this.uv),
      ao: new Float32Array(this.ao),
      blockLight: new Float32Array(this.bl),
      skyLight: new Float32Array(this.sl),
      order: new Float32Array(this.ord),
      indices: new Uint32Array(this.idx),
    };
  }
}

// Face definitions: normal, 4 corners as [x,y,z] selectors (0 = low, 1 = high), uv selectors.
type Sel = 0 | 1;
interface FaceDef {
  n: [number, number, number];
  c: Array<[Sel, Sel, Sel]>;
  /** For each corner: u and v as functions of the position fractions. */
  uv: (x: number, y: number, z: number) => [number, number];
}
const FACES: FaceDef[] = [
  // +x
  {
    n: [1, 0, 0],
    c: [
      [1, 0, 1],
      [1, 0, 0],
      [1, 1, 0],
      [1, 1, 1],
    ],
    uv: (x, y, z) => [1 - z, y],
  },
  // -x
  {
    n: [-1, 0, 0],
    c: [
      [0, 0, 0],
      [0, 0, 1],
      [0, 1, 1],
      [0, 1, 0],
    ],
    uv: (x, y, z) => [z, y],
  },
  // +y
  {
    n: [0, 1, 0],
    c: [
      [0, 1, 1],
      [1, 1, 1],
      [1, 1, 0],
      [0, 1, 0],
    ],
    uv: (x, y, z) => [x, 1 - z],
  },
  // -y
  {
    n: [0, -1, 0],
    c: [
      [0, 0, 0],
      [1, 0, 0],
      [1, 0, 1],
      [0, 0, 1],
    ],
    uv: (x, y, z) => [x, z],
  },
  // +z
  {
    n: [0, 0, 1],
    c: [
      [0, 0, 1],
      [1, 0, 1],
      [1, 1, 1],
      [0, 1, 1],
    ],
    uv: (x, y, z) => [x, y],
  },
  // -z
  {
    n: [0, 0, -1],
    c: [
      [1, 0, 0],
      [0, 0, 0],
      [0, 1, 0],
      [1, 1, 0],
    ],
    uv: (x, y, z) => [1 - x, y],
  },
];

const AO_LEVELS = [0.45, 0.65, 0.82, 1.0];

export interface MeshResult {
  solid: MeshData;
  blend: MeshData;
  faces: number;
}

export function buildMeshes(g: VoxelGrid, light: LightField, atlas: Atlas): MeshResult {
  const solid = new Builder();
  const blend = new Builder();
  const tmpL: [number, number, number] = [0, 0, 0];
  const EPS = 0.02 / atlas.size;

  const opaqueAt = (x: number, y: number, z: number) => {
    if (x < 0 || y < 0 || z < 0 || x >= g.w || y >= g.h || z >= g.l) return false;
    return isOpaque(g.data[x + z * g.w + y * g.w * g.l]);
  };

  /** Light of one cell as [sky, r, g, b] normalised. Opaque cells fall back to the centre value. */
  const sample = (x: number, y: number, z: number, fb: number[] | null, out: number[]) => {
    if (opaqueAt(x, y, z) && fb) {
      out[0] = fb[0];
      out[1] = fb[1];
      out[2] = fb[2];
      out[3] = fb[3];
      return;
    }
    out[0] = light.skyAt(x, y, z) / 15;
    light.blockAt(x, y, z, tmpL);
    out[1] = tmpL[0] / 15;
    out[2] = tmpL[1] / 15;
    out[3] = tmpL[2] / 15;
  };

  let faces = 0;
  const center = [0, 0, 0, 0];
  const a = [0, 0, 0, 0];
  const b = [0, 0, 0, 0];
  const c = [0, 0, 0, 0];
  const d = [0, 0, 0, 0];

  for (let y = 0; y < g.h; y++)
    for (let z = 0; z < g.l; z++)
      for (let x = 0; x < g.w; x++) {
        const id = g.data[x + z * g.w + y * g.w * g.l];
        if (id === 0) continue;
        const model = getModel(id);
        if (!model) continue;
        const B = model.layer === 'blend' ? blend : solid;
        const order = y + hash2(x, z, 91) * 0.98;

        if (model.cross) {
          emitCross(B, model, x, y, z, order, atlas, light, tmpL);
          faces += 2;
          continue;
        }

        let boxes = model.boxes;
        if (model.cull === 'water') {
          const above = g.get(x, y + 1, z);
          if (TABLE.base(above) === 'water') boxes = [{ ...boxes[0], y1: 1 }];
        }

        for (const box of boxes) {
          for (let f = 0; f < 6; f++) {
            const fd = FACES[f];
            const [nx, ny, nz] = fd.n;
            // does this face lie on the cell boundary?
            const along = nx !== 0 ? (nx > 0 ? box.x1 : box.x0) : ny !== 0 ? (ny > 0 ? box.y1 : box.y0) : nz > 0 ? box.z1 : box.z0;
            const onEdge = nx + ny + nz > 0 ? along >= 0.999 : along <= 0.001;
            let sx = x;
            let sy = y;
            let sz = z;
            if (onEdge) {
              const nid = g.get(x + nx, y + ny, z + nz);
              if (shouldCull(model, nid)) continue;
              sx += nx;
              sy += ny;
              sz += nz;
            }
            const tex = box.tex[f];
            const [u0, v0, u1, v1] = atlas.uv(tex);

            // light sampling plane
            sample(sx, sy, sz, null, center);
            // tangent axes
            const t1 = nx !== 0 ? 1 : 0; // y axis for x faces? decide per face below
            void t1;
            let ax: [number, number, number];
            let bx: [number, number, number];
            if (nx !== 0) {
              ax = [0, 1, 0];
              bx = [0, 0, 1];
            } else if (ny !== 0) {
              ax = [1, 0, 0];
              bx = [0, 0, 1];
            } else {
              ax = [1, 0, 0];
              bx = [0, 1, 0];
            }
            const base = B.n;
            const corners: number[][] = [];
            const aoVals: number[] = [];
            for (let k = 0; k < 4; k++) {
              const sel = fd.c[k];
              const px = sel[0] ? box.x1 : box.x0;
              const py = sel[1] ? box.y1 : box.y0;
              const pz = sel[2] ? box.z1 : box.z0;
              // offsets toward this vertex along the two tangent axes
              const sa = ax[0] ? (px > 0.5 ? 1 : -1) : ax[1] ? (py > 0.5 ? 1 : -1) : pz > 0.5 ? 1 : -1;
              const sb = bx[0] ? (px > 0.5 ? 1 : -1) : bx[1] ? (py > 0.5 ? 1 : -1) : pz > 0.5 ? 1 : -1;
              const s1x = sx + ax[0] * sa;
              const s1y = sy + ax[1] * sa;
              const s1z = sz + ax[2] * sa;
              const s2x = sx + bx[0] * sb;
              const s2y = sy + bx[1] * sb;
              const s2z = sz + bx[2] * sb;
              const cx = s1x + bx[0] * sb;
              const cy = s1y + bx[1] * sb;
              const cz = s1z + bx[2] * sb;
              const o1 = opaqueAt(s1x, s1y, s1z);
              const o2 = opaqueAt(s2x, s2y, s2z);
              const oc = opaqueAt(cx, cy, cz);
              let aoI = o1 && o2 ? 0 : 3 - (+o1 + +o2 + +oc);
              if (!onEdge) aoI = 3;
              const ao = AO_LEVELS[aoI];
              sample(s1x, s1y, s1z, center, a);
              sample(s2x, s2y, s2z, center, b);
              sample(cx, cy, cz, o1 && o2 ? center : center, c);
              if (o1 && o2) {
                c[0] = center[0];
                c[1] = center[1];
                c[2] = center[2];
                c[3] = center[3];
              }
              d[0] = (center[0] + a[0] + b[0] + c[0]) / 4;
              d[1] = (center[1] + a[1] + b[1] + c[1]) / 4;
              d[2] = (center[2] + a[2] + b[2] + c[2]) / 4;
              d[3] = (center[3] + a[3] + b[3] + c[3]) / 4;
              let sky = d[0];
              let r = d[1];
              let gg = d[2];
              let bl = d[3];
              if (model.glow) {
                // emitters shine on their own faces
                r = Math.max(r, model.glow[0] * 2.2);
                gg = Math.max(gg, model.glow[1] * 2.2);
                bl = Math.max(bl, model.glow[2] * 2.2);
                sky = 1;
              }
              const uvf = fd.uv(px, py, pz);
              const U = u0 + EPS + uvf[0] * (u1 - u0 - 2 * EPS);
              const V = v0 + EPS + uvf[1] * (v1 - v0 - 2 * EPS);
              B.pos.push(x + px, y + py, z + pz);
              B.nor.push(nx, ny, nz);
              B.uv.push(U, V);
              B.ao.push(model.glow ? 1 : ao);
              B.bl.push(r, gg, bl);
              B.sl.push(sky);
              B.ord.push(order);
              corners.push([ao]);
              aoVals.push(ao);
            }
            if (aoVals[1] + aoVals[3] > aoVals[0] + aoVals[2]) B.idx.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
            else B.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
            B.n += 4;
            faces++;
          }
        }
      }
  return { solid: solid.finish(), blend: blend.finish(), faces };
}

function shouldCull(model: Model, nid: number): boolean {
  if (nid === 0) return false;
  if (isOpaque(nid)) return true;
  switch (model.cull) {
    case 'opaque':
    case 'none':
      return false;
    case 'same': {
      const nm = getModel(nid);
      return !!nm && nm.family === model.family;
    }
    case 'water':
      return TABLE.base(nid) === 'water';
    case 'leaves':
      return TABLE.base(nid).endsWith('_leaves');
  }
}

function emitCross(B: Builder, model: Model, x: number, y: number, z: number, order: number, atlas: Atlas, light: LightField, tmpL: [number, number, number]) {
  const [u0, v0, u1, v1] = atlas.uv(model.cross!);
  const sky = light.skyAt(x, y, z) / 15;
  light.blockAt(x, y, z, tmpL);
  const quads: Array<[number, number, number, number, number, number]> = [
    [0.1, 0.1, 0.9, 0.9, 1, 0],
    [0.9, 0.1, 0.1, 0.9, 0, 1],
  ];
  void quads;
  const diag = [
    [
      [0.12, 0.12],
      [0.88, 0.88],
    ],
    [
      [0.88, 0.12],
      [0.12, 0.88],
    ],
  ];
  for (const [[ax, az], [bx, bz]] of diag) {
    for (const flip of [false, true]) {
      const base = B.n;
      const pts: Array<[number, number, number, number, number]> = [
        [ax, 0, az, 0, 0],
        [bx, 0, bz, 1, 0],
        [bx, 1, bz, 1, 1],
        [ax, 1, az, 0, 1],
      ];
      const nrm: [number, number, number] = flip ? [az - bz, 0, bx - ax] : [bz - az, 0, ax - bx];
      for (const [px, py, pz, uu, vv] of pts) {
        B.pos.push(x + px, y + py, z + pz);
        B.nor.push(0, 1, 0);
        void nrm;
        B.uv.push(u0 + (flip ? 1 - uu : uu) * (u1 - u0), v0 + vv * (v1 - v0));
        B.ao.push(1);
        B.bl.push(tmpL[0] / 15, tmpL[1] / 15, tmpL[2] / 15);
        B.sl.push(sky);
        B.ord.push(order);
      }
      if (flip) B.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
      else B.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      B.n += 4;
    }
  }
}
