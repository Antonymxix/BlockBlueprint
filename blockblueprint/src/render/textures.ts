import { makeRng, Rng, hash2 } from '../core/rng';

/**
 * Procedural 16x16 pixel textures. Nothing is loaded from disk, so there are no asset licences
 * to worry about and the whole atlas is generated in a few milliseconds.
 */

export const TILE = 16;
type RGB = [number, number, number];

class Tile {
  /** RGBA, row 0 = top. */
  readonly px = new Uint8ClampedArray(TILE * TILE * 4);
  rng: Rng;
  constructor(readonly name: string) {
    let h = 2166136261;
    for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619);
    this.rng = makeRng(h);
  }
  set(x: number, y: number, c: RGB, a = 255) {
    if (x < 0 || y < 0 || x >= TILE || y >= TILE) return;
    const i = (y * TILE + x) * 4;
    this.px[i] = c[0];
    this.px[i + 1] = c[1];
    this.px[i + 2] = c[2];
    this.px[i + 3] = a;
  }
  get(x: number, y: number): RGB {
    x = (x + TILE) % TILE;
    y = (y + TILE) % TILE;
    const i = (y * TILE + x) * 4;
    return [this.px[i], this.px[i + 1], this.px[i + 2]];
  }
  fill(c: RGB, a = 255) {
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) this.set(x, y, c, a);
  }
  rect(x0: number, y0: number, x1: number, y1: number, c: RGB, a = 255) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.set(x, y, c, a);
  }
}

const sh = (c: RGB, k: number): RGB => [Math.max(0, Math.min(255, c[0] * k)), Math.max(0, Math.min(255, c[1] * k)), Math.max(0, Math.min(255, c[2] * k))];
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

function speckle(t: Tile, base: RGB, amp = 0.12) {
  for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) t.set(x, y, sh(base, 1 + (t.rng() - 0.5) * 2 * amp));
}

function blotch(t: Tile, base: RGB, amp: number, scale = 3) {
  // value noise on a coarse grid, wrapped so the tile repeats
  const n = TILE / scale;
  const g: number[] = [];
  for (let i = 0; i < n * n; i++) g.push(t.rng());
  const at = (ix: number, iy: number) => g[((iy + n) % n) * n + ((ix + n) % n)];
  for (let y = 0; y < TILE; y++)
    for (let x = 0; x < TILE; x++) {
      const fx = x / scale;
      const fy = y / scale;
      const ix = Math.floor(fx);
      const iy = Math.floor(fy);
      const tx = fx - ix;
      const ty = fy - iy;
      const v = (at(ix, iy) * (1 - tx) + at(ix + 1, iy) * tx) * (1 - ty) + (at(ix, iy + 1) * (1 - tx) + at(ix + 1, iy + 1) * tx) * ty;
      t.set(x, y, sh(base, 1 + (v - 0.5) * 2 * amp + (t.rng() - 0.5) * amp * 0.6));
    }
}

function bricks(t: Tile, brick: RGB, mortar: RGB, rowH = 4, w = 8, amp = 0.1) {
  const rows = TILE / rowH;
  for (let r = 0; r < rows; r++) {
    const off = r % 2 === 0 ? 0 : w / 2;
    for (let y = 0; y < rowH; y++)
      for (let x = 0; x < TILE; x++) {
        const px = (x + off) % w;
        const edge = y === rowH - 1 || px === w - 1;
        const bx = Math.floor((x + off) / w);
        const tone = 1 + (hash2(bx, r, t.name.length) - 0.5) * 0.22;
        const c = edge ? sh(mortar, 1 + (t.rng() - 0.5) * 0.08) : sh(brick, tone * (1 + (t.rng() - 0.5) * 2 * amp));
        t.set(x, r * rowH + y, c);
      }
  }
}

function planks(t: Tile, base: RGB, dark: RGB) {
  for (let b = 0; b < 4; b++) {
    const shift = Math.floor(t.rng() * 16);
    const tone = 1 + (t.rng() - 0.5) * 0.14;
    for (let y = 0; y < 4; y++)
      for (let x = 0; x < TILE; x++) {
        const grain = Math.sin(((x + shift) * 0.9 + y * 2.3 + b * 5) * 0.8) * 0.045;
        let c = sh(base, tone * (1 + grain + (t.rng() - 0.5) * 0.07));
        if (y === 3) c = mix(c, dark, 0.55);
        if ((x + shift) % 16 === 0 && y < 3) c = mix(c, dark, 0.45);
        t.set(x, b * 4 + y, c);
      }
  }
}

function logSide(t: Tile, base: RGB, dark: RGB) {
  for (let x = 0; x < TILE; x++) {
    const col = 0.82 + t.rng() * 0.36;
    for (let y = 0; y < TILE; y++) {
      const streak = Math.sin(y * 0.5 + x * 1.7) * 0.05;
      t.set(x, y, sh(mix(base, dark, x % 4 === 0 ? 0.55 : 0.0), col + streak + (t.rng() - 0.5) * 0.08));
    }
  }
}

function logTop(t: Tile, bark: RGB, wood: RGB) {
  for (let y = 0; y < TILE; y++)
    for (let x = 0; x < TILE; x++) {
      const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
      if (d > 6.2) t.set(x, y, sh(bark, 0.9 + t.rng() * 0.2));
      else {
        const ring = Math.floor(d);
        t.set(x, y, sh(wood, ring % 2 === 0 ? 1.0 : 0.86 + (t.rng() - 0.5) * 0.05));
      }
    }
}

function cobble(t: Tile, base: RGB, moss = 0) {
  // Voronoi-ish cells
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < 9; i++) pts.push([t.rng() * TILE, t.rng() * TILE]);
  for (let y = 0; y < TILE; y++)
    for (let x = 0; x < TILE; x++) {
      let d1 = 1e9;
      let d2 = 1e9;
      let id = 0;
      for (let i = 0; i < pts.length; i++)
        for (const ox of [-TILE, 0, TILE])
          for (const oy of [-TILE, 0, TILE]) {
            const d = Math.hypot(x - pts[i][0] - ox, y - pts[i][1] - oy);
            if (d < d1) {
              d2 = d1;
              d1 = d;
              id = i;
            } else if (d < d2) d2 = d;
          }
      const edge = d2 - d1 < 1.1;
      let c = sh(base, 0.82 + hash2(id, 3, t.name.length) * 0.4 + (t.rng() - 0.5) * 0.08);
      if (edge) c = sh(base, 0.5);
      if (moss > 0 && hash2(id, 9, 4) < moss) c = mix(c, [78, 110, 52], 0.55);
      t.set(x, y, c);
    }
}

function stoneBricks(t: Tile, base: RGB, extra: 'none' | 'moss' | 'crack' = 'none') {
  for (let y = 0; y < TILE; y++)
    for (let x = 0; x < TILE; x++) {
      const row = y < 8 ? 0 : 1;
      const off = row === 0 ? 0 : 4;
      const mortarY = y === 7 || y === 15;
      const mortarX = (x + off) % 8 === 7 && !mortarY;
      const bx = Math.floor((x + off) / 8);
      let c = sh(base, 0.95 + (hash2(bx, row, 7) - 0.5) * 0.14 + (t.rng() - 0.5) * 0.08);
      if (mortarY || mortarX) c = sh(base, 0.68 + (t.rng() - 0.5) * 0.05);
      if (extra === 'moss' && hash2(x >> 1, y >> 1, 5) < 0.32) c = mix(c, [86, 118, 58], 0.6);
      if (extra === 'crack' && ((x * 3 + y * 5) % 17 === 0 || (x + y * 2) % 23 === 0)) c = sh(base, 0.6);
      t.set(x, y, c);
    }
}

function tiles(t: Tile, base: RGB, size: number, groove: number) {
  for (let y = 0; y < TILE; y++)
    for (let x = 0; x < TILE; x++) {
      const gx = x % size === size - 1 || x % size === 0;
      const gy = y % size === size - 1 || y % size === 0;
      let c = sh(base, 1 + (t.rng() - 0.5) * 0.1);
      if (gx || gy) c = sh(base, groove);
      const cell = hash2(Math.floor(x / size), Math.floor(y / size), 21);
      c = sh(c, 0.92 + cell * 0.16);
      t.set(x, y, c);
    }
}

function leaves(t: Tile, base: RGB, light: RGB, holes = 0.2) {
  for (let y = 0; y < TILE; y++)
    for (let x = 0; x < TILE; x++) {
      const v = t.rng();
      if (v < holes) {
        t.set(x, y, [0, 0, 0], 0);
        continue;
      }
      const lightSpot = hash2(x >> 1, y >> 1, 77) < 0.28;
      const c = sh(lightSpot ? light : base, 0.8 + t.rng() * 0.35);
      t.set(x, y, c);
    }
}

function glass(t: Tile, tint: RGB | null) {
  t.fill([0, 0, 0], 0);
  const edge: RGB = tint ? sh(tint, 1.0) : [215, 238, 240];
  for (let i = 0; i < TILE; i++) {
    t.set(i, 0, edge, 255);
    t.set(i, TILE - 1, edge, 255);
    t.set(0, i, edge, 255);
    t.set(TILE - 1, i, edge, 255);
  }
  if (tint) {
    for (let y = 1; y < TILE - 1; y++) for (let x = 1; x < TILE - 1; x++) t.set(x, y, tint, 150);
  } else {
    for (let y = 1; y < TILE - 1; y++) for (let x = 1; x < TILE - 1; x++) t.set(x, y, [190, 225, 235], 34);
  }
  // diagonal glints
  for (let k = 0; k < 4; k++) {
    t.set(2 + k, 3 + k, [255, 255, 255], 190);
    t.set(3 + k, 2 + k, [255, 255, 255], 120);
  }
  t.set(10, 11, [255, 255, 255], 170);
  t.set(11, 10, [255, 255, 255], 170);
}

function wool(t: Tile, base: RGB) {
  for (let y = 0; y < TILE; y++)
    for (let x = 0; x < TILE; x++) t.set(x, y, sh(base, 0.93 + hash2(x, y, 1) * 0.14 + ((x + y) % 3 === 0 ? 0.02 : 0)));
}

function concrete(t: Tile, base: RGB) {
  speckle(t, base, 0.025);
}

function flower(t: Tile, petal: RGB, center: RGB, stem: RGB = [58, 130, 40]) {
  t.fill([0, 0, 0], 0);
  for (let y = 7; y < 16; y++) t.set(7, y, stem);
  for (let y = 11; y < 14; y++) t.set(8, y, sh(stem, 1.1));
  t.set(6, 12, sh(stem, 1.1));
  for (let dy = -2; dy <= 2; dy++)
    for (let dx = -2; dx <= 2; dx++) {
      if (Math.abs(dx) + Math.abs(dy) > 3) continue;
      t.set(7 + dx, 4 + dy, petal);
    }
  t.set(7, 4, center);
  t.set(8, 4, center);
}

function tulip(t: Tile, petal: RGB) {
  t.fill([0, 0, 0], 0);
  for (let y = 6; y < 16; y++) t.set(7, y, [58, 130, 40]);
  t.set(6, 11, [58, 130, 40]);
  t.set(8, 12, [58, 130, 40]);
  t.rect(6, 2, 8, 5, petal);
  t.set(6, 2, [0, 0, 0], 0);
  t.set(8, 2, [0, 0, 0], 0);
  t.set(7, 2, sh(petal, 1.2));
}

function allium(t: Tile) {
  t.fill([0, 0, 0], 0);
  for (let y = 7; y < 16; y++) t.set(7, y, [70, 130, 55]);
  for (let dy = -3; dy <= 3; dy++)
    for (let dx = -3; dx <= 3; dx++) {
      if (dx * dx + dy * dy > 10) continue;
      if (t.rng() < 0.25) continue;
      t.set(7 + dx, 4 + dy, mix([160, 100, 210], [200, 150, 235], t.rng()));
    }
}

function shortGrass(t: Tile) {
  t.fill([0, 0, 0], 0);
  for (let i = 0; i < 9; i++) {
    const x = 1 + Math.floor(t.rng() * 14);
    const h = 5 + Math.floor(t.rng() * 8);
    const lean = Math.floor((t.rng() - 0.5) * 3);
    for (let k = 0; k < h; k++) {
      const c = sh([95, 160, 65], 0.8 + (k / h) * 0.4);
      t.set(x + Math.round((lean * k) / h), 15 - k, c);
    }
  }
}

type Painter = (t: Tile) => void;
export const PAINTERS: Record<string, Painter> = {};
const add = (name: string, p: Painter) => {
  PAINTERS[name] = p;
};

// --- terrain
add('grass_top', (t) => blotch(t, [104, 168, 66], 0.12, 4));
add('grass_side', (t) => {
  speckle(t, [134, 96, 67], 0.1);
  for (let x = 0; x < TILE; x++) {
    const h = 3 + Math.floor(hash2(x, 3, 9) * 3);
    for (let y = 0; y < h; y++) t.set(x, y, sh([104, 168, 66], 0.85 + t.rng() * 0.3));
  }
});
add('dirt', (t) => speckle(t, [134, 96, 67], 0.1));
add('coarse_dirt', (t) => {
  speckle(t, [119, 85, 59], 0.11);
  for (let i = 0; i < 12; i++) t.set(Math.floor(t.rng() * 16), Math.floor(t.rng() * 16), [150, 148, 144]);
});
add('podzol_top', (t) => {
  speckle(t, [92, 63, 24], 0.14);
  for (let i = 0; i < 18; i++) t.set(Math.floor(t.rng() * 16), Math.floor(t.rng() * 16), [122, 86, 38]);
});
add('podzol_side', (t) => {
  speckle(t, [134, 96, 67], 0.1);
  for (let x = 0; x < TILE; x++) {
    const h = 3 + Math.floor(hash2(x, 5, 9) * 3);
    for (let y = 0; y < h; y++) t.set(x, y, sh([92, 63, 24], 0.85 + t.rng() * 0.3));
  }
});
add('gravel', (t) => {
  speckle(t, [132, 127, 126], 0.1);
  for (let i = 0; i < 38; i++) {
    const c = t.rng() < 0.5 ? [96, 92, 92] : [165, 160, 158];
    t.set(Math.floor(t.rng() * 16), Math.floor(t.rng() * 16), c as RGB);
  }
});
add('path_top', (t) => blotch(t, [148, 122, 65], 0.1, 4));
add('path_side', (t) => {
  speckle(t, [134, 96, 67], 0.1);
  for (let x = 0; x < TILE; x++) for (let y = 0; y < 2; y++) t.set(x, y, sh([148, 122, 65], 0.9 + t.rng() * 0.2));
});
add('stone', (t) => blotch(t, [125, 125, 125], 0.07, 4));
add('cobblestone', (t) => cobble(t, [128, 128, 128]));
add('mossy_cobblestone', (t) => cobble(t, [118, 124, 112], 0.5));
add('stone_bricks', (t) => stoneBricks(t, [124, 124, 124]));
add('mossy_stone_bricks', (t) => stoneBricks(t, [118, 122, 114], 'moss'));
add('cracked_stone_bricks', (t) => stoneBricks(t, [120, 120, 120], 'crack'));
add('bricks', (t) => bricks(t, [152, 98, 84], [176, 168, 158], 4, 8, 0.06));
add('deepslate_bricks', (t) => stoneBricks(t, [72, 72, 76]));
add('deepslate_tiles', (t) => tiles(t, [58, 58, 62], 8, 0.7));
add('polished_deepslate', (t) => blotch(t, [74, 74, 78], 0.05, 4));
add('blackstone', (t) => blotch(t, [44, 38, 44], 0.14, 3));
add('polished_blackstone_bricks', (t) => stoneBricks(t, [52, 46, 54]));
add('nether_bricks', (t) => bricks(t, [48, 24, 30], [26, 12, 16], 4, 8, 0.1));
add('red_nether_bricks', (t) => bricks(t, [72, 8, 10], [42, 4, 6], 4, 8, 0.1));
add('quartz_block_side', (t) => {
  speckle(t, [236, 230, 224], 0.025);
  for (let y = 0; y < TILE; y++) t.set(15, y, [222, 216, 210]);
});
add('quartz_block_top', (t) => speckle(t, [237, 231, 225], 0.02));
add('sandstone', (t) => {
  blotch(t, [216, 203, 155], 0.04, 4);
  for (let x = 0; x < TILE; x++) {
    t.set(x, 3, [200, 187, 140]);
    t.set(x, 12, [200, 187, 140]);
  }
});
add('sandstone_top', (t) => blotch(t, [224, 214, 164], 0.04, 4));

// --- concrete / clay / wool
add('white_concrete', (t) => concrete(t, [207, 213, 214]));
add('light_gray_concrete', (t) => concrete(t, [125, 125, 115]));
add('gray_concrete', (t) => concrete(t, [55, 58, 62]));
add('black_concrete', (t) => concrete(t, [10, 12, 18]));
add('terracotta', (t) => speckle(t, [152, 94, 67], 0.03));
add('white_terracotta', (t) => {
  speckle(t, [214, 184, 162], 0.035);
  for (let i = 0; i < 10; i++) t.set(Math.floor(t.rng() * 16), Math.floor(t.rng() * 16), [196, 164, 142]);
});
add('orange_terracotta', (t) => speckle(t, [161, 83, 37], 0.03));
add('red_terracotta', (t) => speckle(t, [143, 61, 46], 0.03));
add('white_wool', (t) => wool(t, [233, 236, 236]));
add('red_wool', (t) => wool(t, [160, 39, 34]));
add('black_wool', (t) => wool(t, [20, 21, 25]));
add('blue_wool', (t) => wool(t, [53, 57, 157]));
add('yellow_wool', (t) => wool(t, [248, 197, 39]));
add('hay_block_side', (t) => {
  for (let y = 0; y < TILE; y++)
    for (let x = 0; x < TILE; x++) {
      const band = y % 8 < 2 ? [120, 92, 10] : [190, 160, 20];
      t.set(x, y, sh(band as RGB, 0.88 + (Math.sin(x * 1.3 + y * 0.4) * 0.5 + 0.5) * 0.2 + (t.rng() - 0.5) * 0.08));
    }
});
add('hay_block_top', (t) => {
  for (let y = 0; y < TILE; y++)
    for (let x = 0; x < TILE; x++) {
      const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
      t.set(x, y, sh(d > 6 ? [140, 110, 12] : [196, 166, 22], 0.9 + t.rng() * 0.2 - (Math.floor(d) % 2) * 0.08));
    }
});
add('mud_bricks', (t) => bricks(t, [139, 106, 82], [112, 84, 64], 4, 8, 0.05));
add('moss_block', (t) => blotch(t, [89, 109, 45], 0.14, 2));

// --- wood
const WOODS: Record<string, { plank: RGB; dark: RGB; bark: RGB; barkDark: RGB; stripped: RGB; top: RGB }> = {
  oak: { plank: [162, 130, 78], dark: [120, 94, 54], bark: [109, 85, 50], barkDark: [70, 54, 30], stripped: [177, 144, 86], top: [175, 144, 86] },
  spruce: { plank: [114, 84, 48], dark: [80, 58, 32], bark: [58, 37, 16], barkDark: [36, 22, 8], stripped: [115, 89, 52], top: [130, 98, 56] },
  dark_oak: { plank: [66, 43, 20], dark: [44, 28, 12], bark: [60, 46, 26], barkDark: [34, 26, 14], stripped: [72, 56, 36], top: [70, 48, 24] },
  birch: { plank: [192, 175, 121], dark: [150, 134, 88], bark: [216, 215, 210], barkDark: [80, 80, 78], stripped: [196, 176, 118], top: [200, 182, 128] },
  cherry: { plank: [226, 178, 172], dark: [186, 134, 130], bark: [54, 33, 44], barkDark: [36, 22, 30], stripped: [215, 145, 148], top: [228, 180, 174] },
};
for (const [w, c] of Object.entries(WOODS)) {
  add(w + '_planks', (t) => planks(t, c.plank, c.dark));
  add(w + '_log_side', (t) => {
    logSide(t, c.bark, c.barkDark);
    if (w === 'birch') for (let i = 0; i < 9; i++) t.set(Math.floor(t.rng() * 16), Math.floor(t.rng() * 16), [50, 50, 50]);
  });
  add(w + '_log_top', (t) => logTop(t, c.bark, c.top));
  add('stripped_' + w + '_log_side', (t) => logSide(t, c.stripped, sh(c.stripped, 0.78)));
  add('stripped_' + w + '_log_top', (t) => logTop(t, c.stripped, c.top));
  add(w + '_door_lower', (t) => {
    planks(t, c.plank, c.dark);
    t.rect(2, 2, 13, 13, sh(c.plank, 0.88));
    t.rect(3, 3, 12, 12, sh(c.plank, 1.02));
    t.rect(11, 14, 12, 14, [200, 200, 200]);
    for (let i = 0; i < TILE; i++) {
      t.set(0, i, sh(c.dark, 0.9));
      t.set(15, i, sh(c.dark, 0.9));
    }
  });
  add(w + '_door_upper', (t) => {
    planks(t, c.plank, c.dark);
    for (const [x, y] of [
      [3, 3],
      [9, 3],
      [3, 8],
      [9, 8],
    ])
      t.rect(x, y, x + 3, y + 3, [170, 205, 215]);
    t.rect(3, 3, 6, 3, [220, 240, 245]);
    t.rect(9, 3, 12, 3, [220, 240, 245]);
    for (let i = 0; i < TILE; i++) {
      t.set(0, i, sh(c.dark, 0.9));
      t.set(15, i, sh(c.dark, 0.9));
    }
  });
}
add('bookshelf', (t) => {
  planks(t, WOODS.oak.plank, WOODS.oak.dark);
  const cols: RGB[] = [
    [140, 30, 30],
    [40, 70, 130],
    [60, 120, 60],
    [170, 130, 40],
    [100, 60, 120],
    [200, 190, 170],
  ];
  for (const y0 of [1, 9]) {
    t.rect(1, y0, 14, y0 + 5, [60, 40, 20]);
    for (let x = 1; x < 15; ) {
      const w = 1 + Math.floor(t.rng() * 2);
      const c = cols[Math.floor(t.rng() * cols.length)];
      for (let xx = x; xx < Math.min(15, x + w); xx++) for (let y = y0; y <= y0 + 5; y++) t.set(xx, y, sh(c, 0.85 + t.rng() * 0.3));
      x += w;
    }
  }
});
add('crafting_table_top', (t) => {
  planks(t, WOODS.oak.plank, WOODS.oak.dark);
  for (let i = 0; i < TILE; i += 5) for (let k = 0; k < TILE; k++) {
    t.set(i + 1, k, [90, 66, 36]);
    t.set(k, i + 1, [90, 66, 36]);
  }
});
add('crafting_table_side', (t) => {
  planks(t, WOODS.oak.plank, WOODS.oak.dark);
  t.rect(0, 0, 15, 3, [110, 76, 40]);
  t.rect(3, 6, 12, 9, [70, 70, 75]);
  t.rect(4, 11, 6, 14, [150, 110, 60]);
});
add('barrel_side', (t) => {
  planks(t, WOODS.spruce.plank, WOODS.spruce.dark);
  for (const y of [2, 3, 12, 13]) for (let x = 0; x < TILE; x++) t.set(x, y, [60, 60, 66]);
});
add('barrel_top', (t) => {
  planks(t, WOODS.spruce.plank, WOODS.spruce.dark);
  t.rect(5, 5, 10, 10, [40, 28, 16]);
});

// --- metals
add('copper_block', (t) => blotch(t, [192, 107, 79], 0.05, 4));
const copperTile = (c: RGB) => (t: Tile) => {
  for (let y = 0; y < TILE; y++)
    for (let x = 0; x < TILE; x++) {
      const gx = x % 8 === 7 || x === 0;
      const gy = y % 8 === 7 || y === 0;
      let col = sh(c, 0.95 + hash2(x >> 3, y >> 3, 31) * 0.1 + (t.rng() - 0.5) * 0.05);
      if (gx || gy) col = sh(c, 0.78);
      t.set(x, y, col);
    }
};
add('cut_copper', copperTile([192, 107, 80]));
add('exposed_cut_copper', copperTile([161, 125, 103]));
add('weathered_cut_copper', copperTile([108, 153, 110]));
add('oxidized_cut_copper', copperTile([82, 162, 132]));
add('gold_block', (t) => {
  speckle(t, [246, 208, 61], 0.05);
  for (let i = 0; i < 14; i++) t.set(i, 2 + (i % 3), [255, 245, 150]);
  t.rect(0, 15, 15, 15, [200, 160, 30]);
  t.rect(15, 0, 15, 15, [210, 170, 40]);
});
add('iron_block', (t) => {
  speckle(t, [220, 220, 220], 0.04);
  t.rect(0, 15, 15, 15, [170, 170, 170]);
  t.rect(15, 0, 15, 15, [180, 180, 180]);
});
add('iron_bars', (t) => {
  t.fill([0, 0, 0], 0);
  for (let y = 0; y < TILE; y++) {
    t.set(7, y, [150, 152, 158]);
    t.set(8, y, [112, 114, 120]);
  }
  for (let x = 0; x < TILE; x++) {
    t.set(x, 7, [150, 152, 158]);
    t.set(x, 8, [112, 114, 120]);
  }
});
add('chain', (t) => {
  t.fill([0, 0, 0], 0);
  for (let y = 0; y < TILE; y++) {
    const link = y % 4 < 2;
    t.set(link ? 7 : 8, y, [70, 78, 92]);
    if (link) t.set(8, y, [96, 104, 118]);
  }
});

// --- glass and liquids
add('glass', (t) => glass(t, null));
const STAIN: Record<string, RGB> = {
  white: [235, 235, 235],
  black: [30, 30, 36],
  red: [190, 50, 50],
  light_blue: [90, 170, 225],
  gray: [100, 104, 108],
  yellow: [235, 210, 70],
  orange: [230, 130, 40],
  magenta: [190, 70, 190],
  purple: [130, 60, 190],
};
for (const [k, c] of Object.entries(STAIN)) add(k + '_stained_glass', (t) => glass(t, c));
add('water', (t) => {
  for (let y = 0; y < TILE; y++)
    for (let x = 0; x < TILE; x++) {
      const w = Math.sin(x * 0.6 + y * 0.3) * 0.5 + Math.sin(y * 0.9 - x * 0.2) * 0.5;
      t.set(x, y, sh([46, 110, 210], 0.92 + w * 0.08 + (t.rng() - 0.5) * 0.04), 185);
    }
});

// --- lights
add('sea_lantern', (t) => {
  for (let y = 0; y < TILE; y++)
    for (let x = 0; x < TILE; x++) {
      const gx = x % 8 === 0 || x % 8 === 7;
      const gy = y % 8 === 0 || y % 8 === 7;
      let c = sh([190, 225, 214], 0.94 + t.rng() * 0.1);
      if (gx && gy) c = [120, 160, 160];
      else if (gx || gy) c = [150, 190, 190];
      t.set(x, y, c);
    }
});
add('glowstone', (t) => {
  for (let y = 0; y < TILE; y++)
    for (let x = 0; x < TILE; x++) {
      const v = hash2(x >> 1, y >> 1, 123);
      t.set(x, y, mix([200, 120, 40], [255, 235, 140], v * 0.9 + t.rng() * 0.1));
    }
});
add('shroomlight', (t) => {
  for (let y = 0; y < TILE; y++)
    for (let x = 0; x < TILE; x++) {
      const v = hash2(x >> 1, y >> 1, 321);
      t.set(x, y, mix([200, 100, 40], [250, 190, 110], v));
    }
});
add('redstone_lamp_on', (t) => {
  for (let y = 0; y < TILE; y++)
    for (let x = 0; x < TILE; x++) {
      const edge = x < 2 || y < 2 || x > 13 || y > 13;
      t.set(x, y, edge ? [160, 110, 60] : sh([250, 214, 150], 0.9 + t.rng() * 0.15));
    }
});
add('lantern', (t) => {
  t.fill([0, 0, 0], 0);
  // painted for both the standing and the hanging box (y 0-8 of the block = tex rows 8-15)
  t.rect(5, 8, 10, 15, [58, 60, 66]);
  t.rect(6, 9, 9, 14, [255, 190, 90]);
  t.rect(7, 10, 8, 13, [255, 240, 170]);
  t.rect(6, 6, 9, 7, [58, 60, 66]);
  t.rect(7, 4, 8, 5, [58, 60, 66]);
  t.rect(7, 0, 8, 3, [70, 78, 92]);
});
add('soul_lantern', (t) => {
  t.fill([0, 0, 0], 0);
  t.rect(5, 8, 10, 15, [40, 46, 54]);
  t.rect(6, 9, 9, 14, [60, 190, 215]);
  t.rect(7, 10, 8, 13, [190, 245, 250]);
  t.rect(6, 6, 9, 7, [40, 46, 54]);
  t.rect(7, 4, 8, 5, [40, 46, 54]);
  t.rect(7, 0, 8, 3, [70, 78, 92]);
});
add('torch', (t) => {
  t.fill([0, 0, 0], 0);
  t.rect(7, 6, 8, 15, [121, 85, 40]);
  t.rect(7, 4, 8, 5, [255, 170, 40]);
  t.rect(7, 3, 8, 3, [255, 235, 140]);
});
add('soul_torch', (t) => {
  t.fill([0, 0, 0], 0);
  t.rect(7, 6, 8, 15, [90, 66, 40]);
  t.rect(7, 4, 8, 5, [60, 190, 215]);
  t.rect(7, 3, 8, 3, [190, 245, 250]);
});

// --- foliage
add('oak_leaves', (t) => leaves(t, [58, 112, 38], [86, 146, 52]));
add('spruce_leaves', (t) => leaves(t, [38, 78, 48], [58, 100, 62]));
add('dark_oak_leaves', (t) => leaves(t, [30, 74, 30], [46, 98, 42]));
add('birch_leaves', (t) => leaves(t, [96, 130, 46], [120, 158, 60]));
add('cherry_leaves', (t) => leaves(t, [232, 160, 196], [250, 200, 222], 0.28));
add('poppy', (t) => flower(t, [200, 30, 30], [40, 20, 10]));
add('dandelion', (t) => flower(t, [250, 220, 40], [230, 160, 20]));
add('cornflower', (t) => flower(t, [80, 110, 210], [230, 230, 250]));
add('azure_bluet', (t) => flower(t, [240, 240, 240], [240, 220, 80]));
add('oxeye_daisy', (t) => flower(t, [245, 245, 245], [240, 200, 40]));
add('red_tulip', (t) => tulip(t, [196, 40, 40]));
add('pink_tulip', (t) => tulip(t, [240, 150, 190]));
add('allium', allium);
add('short_grass', shortGrass);

export const TEXTURE_NAMES = Object.keys(PAINTERS);

export interface Atlas {
  /** RGBA pixels, size x size. */
  pixels: Uint8ClampedArray;
  size: number;
  uv(name: string): [number, number, number, number];
  has(name: string): boolean;
  /** Names of textures with transparent pixels (cutout candidates). */
}

export function buildAtlasPixels(): Atlas {
  const cols = 16;
  const rows = Math.ceil(TEXTURE_NAMES.length / cols);
  const size = Math.max(cols, 1 << Math.ceil(Math.log2(Math.max(cols, rows)))) * TILE;
  const pixels = new Uint8ClampedArray(size * size * 4);
  const index = new Map<string, number>();
  TEXTURE_NAMES.forEach((name, i) => {
    index.set(name, i);
    const t = new Tile(name);
    PAINTERS[name](t);
    const tx = (i % cols) * TILE;
    const ty = Math.floor(i / cols) * TILE;
    for (let y = 0; y < TILE; y++)
      for (let x = 0; x < TILE; x++) {
        const s = (y * TILE + x) * 4;
        const d = ((ty + y) * size + (tx + x)) * 4;
        pixels[d] = t.px[s];
        pixels[d + 1] = t.px[s + 1];
        pixels[d + 2] = t.px[s + 2];
        pixels[d + 3] = t.px[s + 3];
      }
  });
  // missing-texture tile (magenta checker) in the last slot
  const missing = TEXTURE_NAMES.length;
  const tx = (missing % cols) * TILE;
  const ty = Math.floor(missing / cols) * TILE;
  for (let y = 0; y < TILE; y++)
    for (let x = 0; x < TILE; x++) {
      const d = ((ty + y) * size + (tx + x)) * 4;
      const on = ((x >> 3) + (y >> 3)) % 2 === 0;
      pixels[d] = on ? 255 : 20;
      pixels[d + 1] = 0;
      pixels[d + 2] = on ? 255 : 20;
      pixels[d + 3] = 255;
    }
  const uv = (name: string): [number, number, number, number] => {
    const i = index.get(name) ?? missing;
    const u0 = ((i % cols) * TILE) / size;
    const v1 = 1 - (Math.floor(i / cols) * TILE) / size;
    const u1 = u0 + TILE / size;
    const v0 = v1 - TILE / size;
    return [u0, v0, u1, v1];
  };
  return { pixels, size, uv, has: (n) => index.has(n) };
}
