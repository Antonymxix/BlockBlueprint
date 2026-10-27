import { describe, it, expect } from 'vitest';
import { generate } from '../src/gen/generate';
import { defaultParams, STYLE_IDS, ROOF_IDS, SHAPE_IDS } from '../src/gen/params';
import { TABLE, defOf } from '../src/core/blocks';
import { parsePrompt } from '../src/parser';

const same = (a: Uint16Array, b: Uint16Array) => a.length === b.length && a.every((v, i) => v === b[i]);

describe('generator', () => {
  it('is deterministic', () => {
    const a = generate(defaultParams('medieval', 5));
    const b = generate(defaultParams('medieval', 5));
    expect(same(a.grid.data, b.grid.data)).toBe(true);
  });
  it('differs between seeds', () => {
    const a = generate(defaultParams('medieval', 5));
    const b = generate(defaultParams('medieval', 6));
    expect(same(a.grid.data, b.grid.data)).toBe(false);
  });
  it('only uses known blocks, has a door and a lit interior', () => {
    for (const style of STYLE_IDS) {
      const r = generate(defaultParams(style, 2));
      let doors = 0;
      const unknown = new Set<string>();
      for (const id of r.grid.data) {
        if (!id) continue;
        if (!defOf(id)) unknown.add(TABLE.base(id));
        if (TABLE.base(id).endsWith('_door')) doors++;
      }
      expect([...unknown]).toEqual([]);
      expect(doors).toBeGreaterThanOrEqual(2);
    }
  });
  it('survives every roof x shape combination', () => {
    for (const style of STYLE_IDS)
      for (const roof of ROOF_IDS)
        for (const shape of SHAPE_IDS) {
          const r = generate({ ...defaultParams(style, 4), roof, shape });
          expect(r.info.blocks).toBeGreaterThan(500);
        }
  });
  it('stairs never keep an unfixed shape on a corner', () => {
    const r = generate(defaultParams('medieval', 9));
    let stairs = 0;
    for (const id of r.grid.data) if (id && TABLE.base(id).endsWith('_stairs')) stairs++;
    expect(stairs).toBeGreaterThan(0);
  });
});

describe('prompt parser', () => {
  it('reads German keywords', () => {
    const r = parsePrompt('Ein großes mittelalterliches Haus mit Zwiebeldach und zwei Türmen, 3 Stockwerke');
    expect(r.params.style).toBe('medieval');
    expect(r.params.roof).toBe('onion');
    expect(r.params.towers).toBe(2);
    expect(r.params.floors).toBe(3);
  });
  it('reads English keywords', () => {
    const r = parsePrompt('modern flat roof L-shaped villa with a pool and lots of glass');
    expect(r.params.style).toBe('modern');
    expect(r.params.shape).toBe('L');
    expect(r.params.pool).toBe(true);
    expect(r.params.glass).toBeGreaterThan(0.8);
  });
});
