import { VoxelGrid } from '../core/grid';
import { emission, lightBlock } from '../core/blocks';
import { LIGHT_COLORS } from './models';
import { TABLE } from '../core/blocks';

/**
 * Minecraft-style light: sky light (15 from above, decays by 1 per block sideways) and block
 * light from emitters. Block light is tracked per colour channel so a soul lantern can glow cyan
 * and a torch orange.
 */
export class LightField {
  readonly sky: Uint8Array;
  readonly br: Uint8Array;
  readonly bg: Uint8Array;
  readonly bb: Uint8Array;
  private readonly opac: Uint8Array;

  constructor(readonly g: VoxelGrid) {
    const n = g.w * g.h * g.l;
    this.sky = new Uint8Array(n);
    this.br = new Uint8Array(n);
    this.bg = new Uint8Array(n);
    this.bb = new Uint8Array(n);
    this.opac = new Uint8Array(n);
    for (let i = 0; i < n; i++) this.opac[i] = lightBlock(g.data[i]);
    this.computeSky();
    this.computeBlock();
  }

  private computeSky(): void {
    const { g, sky, opac } = this;
    for (let z = 0; z < g.l; z++)
      for (let x = 0; x < g.w; x++) {
        let cur = 15;
        for (let y = g.h - 1; y >= 0; y--) {
          const i = x + z * g.w + y * g.w * g.l;
          const o = opac[i];
          if (o >= 15) {
            cur = 0;
            sky[i] = 0;
            continue;
          }
          cur = Math.max(0, cur - o);
          sky[i] = cur;
        }
      }
    this.spread(sky);
  }

  private computeBlock(): void {
    const { g } = this;
    const n = g.data.length;
    for (let i = 0; i < n; i++) {
      const id = g.data[i];
      if (id === 0) continue;
      const e = emission(id);
      if (!e) continue;
      const col = LIGHT_COLORS[TABLE.base(id)] ?? [1, 0.75, 0.45];
      this.br[i] = Math.round(e * col[0]);
      this.bg[i] = Math.round(e * col[1]);
      this.bb[i] = Math.round(e * col[2]);
    }
    this.spread(this.br);
    this.spread(this.bg);
    this.spread(this.bb);
  }

  /** Flood fill: every lit cell passes (value - 1 - opacity) to its six neighbours. */
  private spread(field: Uint8Array): void {
    const { g, opac } = this;
    const w = g.w;
    const l = g.l;
    const h = g.h;
    const sy = w * l;
    let queue: number[] = [];
    for (let i = 0; i < field.length; i++) if (field[i] > 1) queue.push(i);
    // process highest values first (bucketed) so each cell settles once
    const buckets: number[][] = [];
    for (let v = 0; v <= 15; v++) buckets.push([]);
    for (const i of queue) buckets[field[i]].push(i);
    queue = [];
    for (let v = 15; v >= 2; v--) {
      const list = buckets[v];
      for (let k = 0; k < list.length; k++) {
        const i = list[k];
        if (field[i] !== v) continue;
        const x = i % w;
        const z = Math.floor(i / w) % l;
        const y = Math.floor(i / sy);
        const tryCell = (nx: number, ny: number, nz: number) => {
          if (nx < 0 || ny < 0 || nz < 0 || nx >= w || ny >= h || nz >= l) return;
          const j = nx + nz * w + ny * sy;
          const o = opac[j];
          if (o >= 15) return;
          const nv = v - 1 - o;
          if (nv > field[j]) {
            field[j] = nv;
            if (nv >= 2) buckets[nv].push(j);
          }
        };
        tryCell(x + 1, y, z);
        tryCell(x - 1, y, z);
        tryCell(x, y + 1, z);
        tryCell(x, y - 1, z);
        tryCell(x, y, z + 1);
        tryCell(x, y, z - 1);
      }
    }
  }

  skyAt(x: number, y: number, z: number): number {
    const g = this.g;
    if (y >= g.h) return 15;
    if (y < 0) return 0;
    if (x < 0 || z < 0 || x >= g.w || z >= g.l) return y >= 2 ? 15 : 0;
    return this.sky[x + z * g.w + y * g.w * g.l];
  }

  blockAt(x: number, y: number, z: number, out: [number, number, number]): void {
    const g = this.g;
    if (x < 0 || y < 0 || z < 0 || x >= g.w || y >= g.h || z >= g.l) {
      out[0] = out[1] = out[2] = 0;
      return;
    }
    const i = x + z * g.w + y * g.w * g.l;
    out[0] = this.br[i];
    out[1] = this.bg[i];
    out[2] = this.bb[i];
  }
}
