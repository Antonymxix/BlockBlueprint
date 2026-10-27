import { generate } from '../src/gen/generate';
import { defaultParams, STYLE_IDS, StyleId } from '../src/gen/params';
import { TABLE } from '../src/core/blocks';

const style = (process.argv[2] ?? 'medieval') as StyleId;
const seed = Number(process.argv[3] ?? 1);
const r = generate({ ...defaultParams(style, seed) });
const g = r.grid;
console.log(style, seed, r.info, `${g.w}x${g.h}x${g.l}`);

const sym = (id: number): string => {
  if (id === 0) return '.';
  const b = TABLE.base(id);
  if (b.includes('stairs')) return '<';
  if (b.includes('slab')) return '_';
  if (b.includes('glass') || b.includes('bars')) return 'o';
  if (b.includes('door')) return 'D';
  if (b.includes('log')) return 'L';
  if (b.includes('leaves')) return '%';
  if (b === 'water') return '~';
  if (b.includes('lantern') || b.includes('sea_lantern')) return '*';
  if (b === 'grass_block') return ',';
  if (b.includes('fence')) return '|';
  return '#';
};
const mode = process.argv[4] ?? 'top';
if (mode === 'top') {
  // top-down height map
  for (let z = 0; z < g.l; z++) {
    let line = '';
    for (let x = 0; x < g.w; x++) {
      let top = -1;
      for (let y = g.h - 1; y >= 0; y--) if (g.get(x, y, z) !== 0) {
        top = y;
        break;
      }
      line += top < 0 ? '.' : top <= 3 ? sym(g.get(x, top, z)) : String.fromCharCode(48 + Math.min(top - 3, 40)).replace(/[:;<=>?@\[\\\]^_`]/, '+');
    }
    console.log(line);
  }
} else if (mode.startsWith('x')) {
  const x = Number(mode.slice(1));
  for (let y = g.h - 1; y >= 0; y--) {
    let line = '';
    for (let z = 0; z < g.l; z++) line += sym(g.get(x, y, z));
    if (/[^.]/.test(line)) console.log(String(y).padStart(2) + ' ' + line);
  }
} else {
  const z = Number(mode);
  for (let y = g.h - 1; y >= 0; y--) {
    let line = '';
    for (let x = 0; x < g.w; x++) line += sym(g.get(x, y, z));
    if (/[^.]/.test(line)) console.log(String(y).padStart(2) + ' ' + line);
  }
}
const palette = new Map<string, number>();
for (let i = 0; i < g.data.length; i++) if (g.data[i]) palette.set(TABLE.base(g.data[i]), (palette.get(TABLE.base(g.data[i])) ?? 0) + 1);
console.log([...palette].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${k}:${v}`).join(' '));
void STYLE_IDS;
