export type StyleId = 'modern' | 'medieval' | 'cottage' | 'castle' | 'fairytale' | 'lair';
export type RoofId = 'auto' | 'flat' | 'gable' | 'hip' | 'shed' | 'cone' | 'onion';
export type ShapeId = 'auto' | 'box' | 'L' | 'T' | 'U';

export const STYLE_IDS: StyleId[] = ['modern', 'medieval', 'cottage', 'castle', 'fairytale', 'lair'];
export const ROOF_IDS: RoofId[] = ['auto', 'flat', 'gable', 'hip', 'shed', 'cone', 'onion'];
export const SHAPE_IDS: ShapeId[] = ['auto', 'box', 'L', 'T', 'U'];

export interface Params {
  style: StyleId;
  floors: number; // 1-5
  width: number; // 11-45, outer wall to wall
  depth: number; // 9-41
  glass: number; // 0-1 share of glazing
  roof: RoofId;
  shape: ShapeId;
  towers: number; // 0-4 round corner towers
  pool: boolean;
  garden: boolean;
  interior: boolean;
  ground: boolean;
  seed: number;
}

export const LIMITS = {
  floors: [1, 5],
  width: [11, 45],
  depth: [9, 41],
  towers: [0, 4],
} as const;

export interface StylePreset {
  id: StyleId;
  label: string;
  blurb: string;
  defaults: Omit<Params, 'seed' | 'ground' | 'interior' | 'garden' | 'style'> & { garden?: boolean };
}

export const PRESETS: Record<StyleId, StylePreset> = {
  modern: {
    id: 'modern',
    label: 'Modern',
    blurb: 'Concrete, glass and cantilevered floors',
    defaults: { floors: 2, width: 25, depth: 19, glass: 0.55, roof: 'flat', shape: 'box', towers: 0, pool: true },
  },
  medieval: {
    id: 'medieval',
    label: 'Medieval',
    blurb: 'Timber-framed town house',
    defaults: { floors: 2, width: 21, depth: 15, glass: 0.4, roof: 'gable', shape: 'L', towers: 0, pool: false },
  },
  cottage: {
    id: 'cottage',
    label: 'Cottage',
    blurb: 'Log cabin with a stone chimney',
    defaults: { floors: 1, width: 15, depth: 11, glass: 0.4, roof: 'gable', shape: 'box', towers: 0, pool: false },
  },
  castle: {
    id: 'castle',
    label: 'Castle',
    blurb: 'Keep with battlements and round towers',
    defaults: { floors: 3, width: 29, depth: 25, glass: 0.2, roof: 'flat', shape: 'box', towers: 4, pool: false },
  },
  fairytale: {
    id: 'fairytale',
    label: 'Fairytale',
    blurb: 'Pastel walls and onion domes',
    defaults: { floors: 2, width: 23, depth: 17, glass: 0.45, roof: 'hip', shape: 'T', towers: 2, pool: false },
  },
  lair: {
    id: 'lair',
    label: 'Villain Lair',
    blurb: 'Blackstone, red glass and spires',
    defaults: { floors: 3, width: 23, depth: 19, glass: 0.3, roof: 'gable', shape: 'T', towers: 2, pool: false },
  },
};

export function defaultParams(style: StyleId = 'modern', seed = 1): Params {
  const d = PRESETS[style].defaults;
  return {
    style,
    floors: d.floors,
    width: d.width,
    depth: d.depth,
    glass: d.glass,
    roof: d.roof,
    shape: d.shape,
    towers: d.towers,
    pool: d.pool,
    garden: true,
    interior: true,
    ground: true,
    seed,
  };
}

export function clampParams(p: Params): Params {
  const c = (v: number, [lo, hi]: readonly [number, number]) => Math.max(lo, Math.min(hi, Math.round(v)));
  return {
    ...p,
    floors: c(p.floors, LIMITS.floors),
    width: c(p.width, LIMITS.width),
    depth: c(p.depth, LIMITS.depth),
    towers: c(p.towers, LIMITS.towers),
    glass: Math.max(0, Math.min(1, p.glass)),
    seed: Math.abs(Math.floor(p.seed)) % 1000000007,
  };
}
