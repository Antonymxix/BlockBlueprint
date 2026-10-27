import { describe, it, expect } from 'vitest';
import { writeVarint, readVarints, exportSchematic, parseSchematic, encodeBlocks } from '../src/export/schematic';
import { generate } from '../src/gen/generate';
import { defaultParams, STYLE_IDS } from '../src/gen/params';
import { TABLE } from '../src/core/blocks';

describe('varint', () => {
  it('round-trips edge values', () => {
    const vals = [0, 1, 127, 128, 255, 300, 16383, 16384, 70000, 2097151];
    const out: number[] = [];
    for (const v of vals) writeVarint(out, v);
    expect(readVarints(Uint8Array.from(out), vals.length)).toEqual(vals);
  });
  it('uses LEB128 bytes', () => {
    const out: number[] = [];
    writeVarint(out, 300);
    expect(out).toEqual([0xac, 0x02]);
  });
});

describe('schematic', () => {
  for (const style of STYLE_IDS) {
    for (const version of [2, 3] as const) {
      it(`${style} v${version} round-trips every cell`, async () => {
        const r = generate(defaultParams(style, 11));
        const gz = await exportSchematic(r.grid, { version, name: 't', author: 'x', origin: r.origin });
        expect(gz[0]).toBe(0x1f);
        expect(gz[1]).toBe(0x8b);
        const p = await parseSchematic(gz);
        expect(p.version).toBe(version);
        expect([p.width, p.height, p.length]).toEqual([r.grid.w, r.grid.h, r.grid.l]);
        expect(p.blocks.length).toBe(r.grid.data.length);
        for (let i = 0; i < r.grid.data.length; i++) {
          const id = r.grid.data[i];
          const want = id === 0 ? 'minecraft:air' : TABLE.state(id);
          if (p.blocks[i] !== want) throw new Error(`cell ${i}: ${p.blocks[i]} != ${want}`);
        }
      });
    }
  }
  it('palette index 0 is air', () => {
    const r = generate(defaultParams('cottage', 3));
    const e = encodeBlocks(r.grid);
    expect(e.palette.get('minecraft:air')).toBe(0);
  });
});
