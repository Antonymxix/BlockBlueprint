import { writeFileSync, mkdirSync } from 'node:fs';
import { generate } from '../src/gen/generate';
import { defaultParams, STYLE_IDS } from '../src/gen/params';
import { exportSchematic } from '../src/export/schematic';

mkdirSync('out', { recursive: true });
for (const style of STYLE_IDS)
  for (const version of [2, 3] as const) {
    const r = generate(defaultParams(style, 7));
    const gz = await exportSchematic(r.grid, { version, name: style, author: 'BlockBlueprint', origin: r.origin });
    writeFileSync(`out/${style}_v${version}.schem`, gz);
  }
console.log('wrote out/*.schem');
