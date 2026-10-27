import { generate } from '../src/gen/generate';
import { defaultParams, STYLE_IDS, ROOF_IDS, SHAPE_IDS } from '../src/gen/params';
import { TABLE, DEFS } from '../src/core/blocks';

let bad = 0;
const t0 = Date.now();
let n = 0;
for (const style of STYLE_IDS) {
  for (const seed of [1, 2, 3]) {
    for (const roof of ROOF_IDS) {
      for (const shape of SHAPE_IDS) {
        if ((seed + roof.length + shape.length) % 4 !== 0 && !(seed === 1)) continue;
        const p = { ...defaultParams(style, seed), roof, shape };
        try {
          const r = generate(p);
          n++;
          const unknown = new Set<string>();
          for (let i = 0; i < r.grid.data.length; i++) {
            const id = r.grid.data[i];
            if (id && !DEFS.has(TABLE.base(id))) unknown.add(TABLE.base(id));
          }
          if (unknown.size) {
            bad++;
            console.log('UNKNOWN', style, seed, roof, shape, [...unknown].join(','));
          }
        } catch (e) {
          bad++;
          console.log('FAIL', style, seed, roof, shape, (e as Error).message.split('\n')[0]);
        }
      }
    }
  }
}
console.log('done', n, 'bad', bad, (Date.now() - t0) + 'ms');
