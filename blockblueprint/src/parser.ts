import { Params, StyleId, RoofId, ShapeId, defaultParams, clampParams } from './gen/params';

/**
 * Rule-based prompt parser (German + English keywords). It turns a free-text description into
 * generator parameters. It is deliberately deterministic and offline; an LLM can replace it later
 * behind the same signature.
 */
export interface ParseResult {
  params: Params;
  /** Human readable list of what was recognised, shown as chips in the UI. */
  matched: string[];
}

const STYLES: Array<[StyleId, RegExp]> = [
  ['modern', /\b(modern|modernes?|contemporary|villa|minimalist\w*|beton|concrete|glass house|glashaus)\b/i],
  ['medieval', /\b(medieval|mittelalter\w*|fachwerk|timber[- ]?fram\w*|tudor|town ?house)\b/i],
  ['cottage', /\b(cottage|cabin|blockhaus|log ?cabin|h[uü]tte|landhaus|bungalow)\b/i],
  ['castle', /\b(castle|burg|schloss|festung|fortress|keep|zitadelle)\b/i],
  ['fairytale', /\b(fairy ?tale|m[aä]rchen\w*|fantasy|disney|pastel|zwiebel\w*|onion)\b/i],
  ['lair', /\b(lair|villain|schurken\w*|evil|b[oö]se\w*|dark ?tower|hideout|versteck|blackstone|nether)\b/i],
];

const ROOFS: Array<[RoofId, RegExp]> = [
  ['onion', /\b(zwiebel\w*|onion|dome|kuppel)\b/i],
  ['cone', /\b(kegel\w*|cone|conical|spitz\w*|spire|pointed)\b/i],
  ['shed', /\b(pult\w*|schr[aä]g\w*|shed|mono-?pitch\w*|slanted|sloped|lean-?to)\b/i],
  ['flat', /\b(flach\w*|flat|zinnen|battlement\w*)\b/i],
  ['hip', /\b(walm\w*|hip(ped)?|zelt\w*|pyramid\w*)\b/i],
  ['gable', /\b(sattel\w*|gable\w*|giebel\w*|pitched|steil\w*)\b/i],
];

const SHAPES: Array<[ShapeId, RegExp]> = [
  ['U', /\b(u-?f[oö]rmig\w*|u-?shape\w*|courtyard|innenhof|hufeisen\w*)\b/i],
  ['T', /\b(t-?f[oö]rmig\w*|t-?shape\w*)\b/i],
  ['L', /\b(l-?f[oö]rmig\w*|l-?shape\w*|winkel\w*)\b/i],
  ['box', /\b(w[uü]rfel\w*|quader\w*|box|rectang\w*|rechteckig\w*|compact|kompakt)\b/i],
];

const NUM_WORDS: Record<string, number> = {
  ein: 1, eine: 1, einen: 1, one: 1, zwei: 2, two: 2, drei: 3, three: 3, vier: 4, four: 4, fuenf: 5, 'fünf': 5, five: 5, null: 0, no: 0, kein: 0, keine: 0, zero: 0,
};

function num(tok: string | undefined): number | null {
  if (!tok) return null;
  const t = tok.toLowerCase();
  if (/^\d+$/.test(t)) return Number(t);
  return NUM_WORDS[t] ?? null;
}

export function parsePrompt(text: string, seed = 1): ParseResult {
  const t = text.trim();
  const matched: string[] = [];
  let style: StyleId = 'medieval';
  let styleHit = false;
  for (const [id, re] of STYLES) {
    if (re.test(t)) {
      style = id;
      styleHit = true;
      matched.push(`style: ${id}`);
      break;
    }
  }
  if (!styleHit && t) matched.push('style: medieval (default)');
  const p = defaultParams(style, seed);

  for (const [id, re] of ROOFS) {
    if (re.test(t)) {
      p.roof = id;
      matched.push(`roof: ${id}`);
      break;
    }
  }
  for (const [id, re] of SHAPES) {
    if (re.test(t)) {
      p.shape = id;
      matched.push(`shape: ${id}`);
      break;
    }
  }

  const fl = t.match(/(\d+|ein|eine|zwei|drei|vier|f[uü]nf|one|two|three|four|five)[- ]?(?:st[oö]ck\w*|geschoss\w*|etagen?|floors?|stor(?:e)?ys?|levels?)/i);
  const f = num(fl?.[1]?.replace('ü', 'ü'));
  if (f !== null && f >= 1) {
    p.floors = f;
    matched.push(`floors: ${f}`);
  } else if (/\b(einst[oö]ckig\w*|single[- ]stor\w*|bungalow)\b/i.test(t)) {
    p.floors = 1;
    matched.push('floors: 1');
  }

  const tw = t.match(/(\d+|ein|eine|einen|zwei|drei|vier|one|two|three|four|kein|keine|no)[- ]?(?:t[uü]rm\w*|towers?)/i);
  const twn = num(tw?.[1]);
  if (twn !== null) {
    p.towers = twn;
    matched.push(`towers: ${twn}`);
  }
  if (/\b(ohne t[uü]rme?|no towers?|without towers?)\b/i.test(t)) {
    p.towers = 0;
    matched.push('towers: 0');
  }

  const dim = t.match(/(\d{2})\s*(?:x|×|mal|by)\s*(\d{2})/i);
  if (dim) {
    p.width = Math.max(Number(dim[1]), Number(dim[2]));
    p.depth = Math.min(Number(dim[1]), Number(dim[2]));
    matched.push(`size: ${dim[1]}×${dim[2]}`);
  } else if (/\b(gro[sß]\w*|huge|large|big|riesig\w*|massive|gewaltig\w*|mansion|anwesen)\b/i.test(t)) {
    p.width = Math.round(p.width * 1.3);
    p.depth = Math.round(p.depth * 1.3);
    matched.push('size: large');
  } else if (/\b(klein\w*|small|tiny|winzig\w*|cozy|gem[uü]tlich\w*)\b/i.test(t)) {
    p.width = Math.round(p.width * 0.75);
    p.depth = Math.round(p.depth * 0.75);
    matched.push('size: small');
  }

  if (/\b(pool|schwimmbad|schwimmbecken|swimming)\b/i.test(t)) {
    p.pool = true;
    matched.push('pool');
  }
  if (/\b(ohne pool|no pool)\b/i.test(t)) p.pool = false;
  if (/\b(ohne garten|no garden|kein garten)\b/i.test(t)) {
    p.garden = false;
    matched.push('no garden');
  } else if (/\b(garten|garden|park)\b/i.test(t)) p.garden = true;
  if (/\b(viel glas|lots of glass|glasfront|gl[aä]sern\w*|floor-to-ceiling|panorama)\b/i.test(t)) {
    p.glass = 0.85;
    matched.push('lots of glass');
  } else if (/\b(wenig glas|few windows|kleine fenster)\b/i.test(t)) p.glass = 0.15;
  if (/\b(leer|empty inside|ohne einrichtung|no interior)\b/i.test(t)) {
    p.interior = false;
    matched.push('no interior');
  }
  return { params: clampParams(p), matched };
}
