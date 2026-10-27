import { AIR, TABLE, DEFS, isOpaque, Dir, DX, DZ, CCW, DIRS, OPP, B } from './blocks';

/**
 * Dense voxel grid of block-state ids. Index layout matches the Sponge schematic spec:
 * index = x + z * width + y * width * length
 */
export class VoxelGrid {
  readonly data: Uint16Array;
  /** Per-cell tag used by the generator (e.g. "roof"). Not exported. */
  readonly tag: Uint8Array;

  constructor(
    readonly w: number,
    readonly h: number,
    readonly l: number,
  ) {
    this.data = new Uint16Array(w * h * l);
    this.tag = new Uint8Array(w * h * l);
  }

  idx(x: number, y: number, z: number): number {
    return x + z * this.w + y * this.w * this.l;
  }

  inBounds(x: number, y: number, z: number): boolean {
    return x >= 0 && y >= 0 && z >= 0 && x < this.w && y < this.h && z < this.l;
  }

  get(x: number, y: number, z: number): number {
    if (x < 0 || y < 0 || z < 0 || x >= this.w || y >= this.h || z >= this.l) return AIR;
    return this.data[x + z * this.w + y * this.w * this.l];
  }

  set(x: number, y: number, z: number, id: number): void {
    if (x < 0 || y < 0 || z < 0 || x >= this.w || y >= this.h || z >= this.l) return;
    this.data[x + z * this.w + y * this.w * this.l] = id;
  }

  /** Set only when the target cell is air. */
  setIfAir(x: number, y: number, z: number, id: number): boolean {
    if (x < 0 || y < 0 || z < 0 || x >= this.w || y >= this.h || z >= this.l) return false;
    const i = x + z * this.w + y * this.w * this.l;
    if (this.data[i] !== AIR) return false;
    this.data[i] = id;
    return true;
  }

  isAir(x: number, y: number, z: number): boolean {
    return this.get(x, y, z) === AIR;
  }

  setTag(x: number, y: number, z: number, t: number): void {
    if (x < 0 || y < 0 || z < 0 || x >= this.w || y >= this.h || z >= this.l) return;
    this.tag[x + z * this.w + y * this.w * this.l] = t;
  }

  getTag(x: number, y: number, z: number): number {
    if (x < 0 || y < 0 || z < 0 || x >= this.w || y >= this.h || z >= this.l) return 0;
    return this.tag[x + z * this.w + y * this.w * this.l];
  }

  /** Filled box, inclusive corners. */
  fill(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, id: number): void {
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++)
      for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++)
        for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) this.set(x, y, z, id);
  }

  count(): number {
    let n = 0;
    for (let i = 0; i < this.data.length; i++) if (this.data[i] !== AIR) n++;
    return n;
  }

  /** Tight bounds of non-air cells, or null when empty. */
  bounds(): { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number } | null {
    let x0 = Infinity,
      y0 = Infinity,
      z0 = Infinity,
      x1 = -1,
      y1 = -1,
      z1 = -1;
    for (let y = 0; y < this.h; y++)
      for (let z = 0; z < this.l; z++)
        for (let x = 0; x < this.w; x++) {
          if (this.data[x + z * this.w + y * this.w * this.l] === AIR) continue;
          if (x < x0) x0 = x;
          if (y < y0) y0 = y;
          if (z < z0) z0 = z;
          if (x > x1) x1 = x;
          if (y > y1) y1 = y;
          if (z > z1) z1 = z;
        }
    return x1 < 0 ? null : { x0, y0, z0, x1, y1, z1 };
  }
}

// ---------------------------------------------------------------------------
// Post-processing: replicate the state updates the game would do on placement.
// WorldEdit pastes blocks as-is, so stair corners and fence/pane connections
// must already be right in the file.
// ---------------------------------------------------------------------------

function isStair(id: number): boolean {
  return id !== 0 && TABLE.base(id).endsWith('_stairs');
}

function canTakeShape(g: VoxelGrid, x: number, y: number, z: number, facing: Dir, half: string, side: Dir): boolean {
  const n = g.get(x + DX[side], y, z + DZ[side]);
  if (!isStair(n)) return true;
  const p = TABLE.props(n);
  return p.facing !== facing || p.half !== half;
}

/** Same algorithm as Minecraft's StairBlock.getStairsShape. */
export function fixStairShapes(g: VoxelGrid): void {
  for (let y = 0; y < g.h; y++)
    for (let z = 0; z < g.l; z++)
      for (let x = 0; x < g.w; x++) {
        const id = g.data[x + z * g.w + y * g.w * g.l];
        if (!isStair(id)) continue;
        const p = TABLE.props(id);
        const facing = p.facing as Dir;
        const half = p.half;
        let shape = 'straight';

        const front = g.get(x + DX[facing], y, z + DZ[facing]);
        if (isStair(front) && TABLE.props(front).half === half) {
          const f1 = TABLE.props(front).facing as Dir;
          const sameAxis = (f1 === facing || f1 === OPP[facing]);
          if (!sameAxis && canTakeShape(g, x, y, z, facing, half, OPP[f1])) {
            shape = f1 === CCW[facing] ? 'outer_left' : 'outer_right';
          }
        }
        if (shape === 'straight') {
          const back = g.get(x - DX[facing], y, z - DZ[facing]);
          if (isStair(back) && TABLE.props(back).half === half) {
            const f2 = TABLE.props(back).facing as Dir;
            const sameAxis = (f2 === facing || f2 === OPP[facing]);
            if (!sameAxis && canTakeShape(g, x, y, z, facing, half, f2)) {
              shape = f2 === CCW[facing] ? 'inner_left' : 'inner_right';
            }
          }
        }
        if (shape !== p.shape) {
          g.data[x + z * g.w + y * g.w * g.l] = B(TABLE.base(id), { ...p, shape });
        }
      }
}

function connects(g: VoxelGrid, x: number, y: number, z: number, self: string, kind: 'fence' | 'pane' | 'wall', face: Dir): boolean {
  const n = g.get(x, y, z);
  if (n === AIR) return false;
  const nb = TABLE.base(n);
  const d = DEFS.get(nb);
  if (!d) return false;
  if (kind === 'fence') {
    if (nb.endsWith('_fence')) return nb === self || (!self.includes('nether') && !nb.includes('nether'));
    if (nb.endsWith('_fence_gate')) return true;
    return d.kind === 'cube' && d.opaque;
  }
  if (kind === 'pane') {
    if (d.kind === 'pane' || d.kind === 'bars') return true;
    return d.kind === 'cube' && d.opaque;
  }
  // wall
  if (d.kind === 'wall') return true;
  return d.kind === 'cube' && d.opaque;
}

/** Sets north/east/south/west connection flags on fences, panes, bars and walls. */
export function fixConnections(g: VoxelGrid): void {
  for (let y = 0; y < g.h; y++)
    for (let z = 0; z < g.l; z++)
      for (let x = 0; x < g.w; x++) {
        const id = g.data[x + z * g.w + y * g.w * g.l];
        if (id === AIR) continue;
        const base = TABLE.base(id);
        const d = DEFS.get(base);
        if (!d) continue;
        if (d.kind !== 'fence' && d.kind !== 'pane' && d.kind !== 'bars' && d.kind !== 'wall') continue;
        const kind: 'fence' | 'pane' | 'wall' = d.kind === 'bars' ? 'pane' : (d.kind as 'fence' | 'pane' | 'wall');
        const props: Record<string, string | boolean> = { ...TABLE.props(id) };
        let changed = false;
        let anyConn = false;
        for (const dir of DIRS) {
          const c = connects(g, x + DX[dir], y, z + DZ[dir], base, kind, dir);
          const val: string | boolean = kind === 'wall' ? (c ? 'low' : 'none') : c;
          if (props[dir] !== String(val)) changed = true;
          props[dir] = val;
          if (c) anyConn = true;
        }
        if (kind === 'wall') {
          // post stays up unless it is a straight line without anything above
          const above = g.get(x, y + 1, z);
          const nsStraight = props.north === 'low' && props.south === 'low' && props.east === 'none' && props.west === 'none';
          const ewStraight = props.east === 'low' && props.west === 'low' && props.north === 'none' && props.south === 'none';
          const up = above !== AIR || !(nsStraight || ewStraight);
          if (props.up !== String(up)) changed = true;
          props.up = up;
          if (above !== AIR && DEFS.get(TABLE.base(above))?.kind === 'wall') {
            for (const dir of DIRS) if (props[dir] === 'low') props[dir] = 'low';
          }
        }
        void anyConn;
        if (changed) g.data[x + z * g.w + y * g.w * g.l] = B(base, props as Record<string, string | boolean>);
      }
}

export function finalizeGrid(g: VoxelGrid): void {
  fixStairShapes(g);
  fixConnections(g);
}

export { isOpaque };
