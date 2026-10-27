import { VoxelGrid } from '../core/grid';
import { TABLE } from '../core/blocks';
import { nbt, writeNbt, gzip, gunzip, readNbt, TAG, NbtTag } from './nbt';

/** Minecraft 1.20.4. Newer versions upgrade the block states on load. */
export const DATA_VERSION = 3700;

export type SchemVersion = 2 | 3;

export interface ExportOptions {
  version?: SchemVersion;
  name?: string;
  author?: string;
  /** Paste origin inside the grid. Offset = -origin so that //paste puts this point at your feet. */
  origin?: [number, number, number];
}

/** Unsigned LEB128 varint as used by the Sponge format. */
export function writeVarint(out: number[], value: number): void {
  let v = value >>> 0;
  while ((v & ~0x7f) !== 0) {
    out.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  out.push(v);
}

export function readVarints(bytes: Uint8Array, count: number): number[] {
  const out: number[] = [];
  let i = 0;
  while (i < bytes.length && out.length < count) {
    let v = 0;
    let shift = 0;
    for (;;) {
      const b = bytes[i++];
      v |= (b & 0x7f) << shift;
      if ((b & 0x80) === 0) break;
      shift += 7;
      if (shift > 35) throw new Error('Varint too long');
    }
    out.push(v >>> 0);
  }
  return out;
}

export interface Encoded {
  palette: Map<string, number>;
  data: Uint8Array;
}

/** Palette + varint data in index order (x fastest, then z, then y). */
export function encodeBlocks(grid: VoxelGrid): Encoded {
  const palette = new Map<string, number>();
  palette.set('minecraft:air', 0);
  const local = new Map<number, number>(); // state id -> palette index
  local.set(0, 0);
  const bytes: number[] = [];
  const d = grid.data;
  for (let i = 0; i < d.length; i++) {
    const id = d[i];
    let p = local.get(id);
    if (p === undefined) {
      const s = TABLE.state(id);
      let q = palette.get(s);
      if (q === undefined) {
        q = palette.size;
        palette.set(s, q);
      }
      p = q;
      local.set(id, p);
    }
    writeVarint(bytes, p);
  }
  return { palette, data: Uint8Array.from(bytes) };
}

function paletteTag(palette: Map<string, number>): NbtTag {
  const o: Record<string, NbtTag> = {};
  for (const [k, v] of palette) o[k] = nbt.int(v);
  return nbt.compound(o);
}

/** Builds the uncompressed NBT bytes of a Sponge schematic. */
export function buildSchematicNbt(grid: VoxelGrid, opts: ExportOptions = {}): Uint8Array {
  const version = opts.version ?? 3;
  const { palette, data } = encodeBlocks(grid);
  const origin = opts.origin ?? [0, 0, 0];
  const offset = [-origin[0], -origin[1], -origin[2]];

  const metadata = nbt.compound({
    Name: nbt.string(opts.name ?? 'BlockBlueprint house'),
    Author: nbt.string(opts.author ?? 'BlockBlueprint'),
    Date: nbt.long(BigInt(Date.now())),
  });

  if (version === 2) {
    const schem = nbt.compound({
      Version: nbt.int(2),
      DataVersion: nbt.int(DATA_VERSION),
      Metadata: metadata,
      Width: nbt.short(grid.w),
      Height: nbt.short(grid.h),
      Length: nbt.short(grid.l),
      Offset: nbt.intArray(offset),
      PaletteMax: nbt.int(palette.size),
      Palette: paletteTag(palette),
      BlockData: nbt.byteArray(data),
    });
    return writeNbt('Schematic', schem);
  }

  const schem = nbt.compound({
    Version: nbt.int(3),
    DataVersion: nbt.int(DATA_VERSION),
    Metadata: metadata,
    Width: nbt.short(grid.w),
    Height: nbt.short(grid.h),
    Length: nbt.short(grid.l),
    Offset: nbt.intArray(offset),
    Blocks: nbt.compound({
      Palette: paletteTag(palette),
      Data: nbt.byteArray(data),
      BlockEntities: nbt.list(TAG.Compound, []),
    }),
  });
  return writeNbt('', nbt.compound({ Schematic: schem }));
}

/** gzip-compressed .schem file. */
export async function exportSchematic(grid: VoxelGrid, opts: ExportOptions = {}): Promise<Uint8Array> {
  return gzip(buildSchematicNbt(grid, opts));
}

// ---------------------------------------------------------------------------
// Reader, used by the tests and by the validation script to prove a round trip.
// ---------------------------------------------------------------------------

export interface ParsedSchematic {
  version: number;
  dataVersion: number;
  width: number;
  height: number;
  length: number;
  offset: number[];
  /** Block state strings per cell, same layout as VoxelGrid. */
  blocks: string[];
  palette: Record<string, number>;
}

function asCompound(t: NbtTag | undefined, what: string): Record<string, NbtTag> {
  if (!t || t.type !== TAG.Compound) throw new Error(`Expected compound for ${what}`);
  return t.value;
}
function num(t: NbtTag | undefined, what: string): number {
  if (!t || (t.type !== TAG.Int && t.type !== TAG.Short && t.type !== TAG.Byte)) throw new Error(`Expected number for ${what}`);
  return t.value;
}

export async function parseSchematic(gz: Uint8Array): Promise<ParsedSchematic> {
  const raw = await gunzip(gz);
  const { name, tag } = readNbt(raw);
  let root = asCompound(tag, 'root');
  let version: number;
  if (root.Schematic && name === '') {
    root = asCompound(root.Schematic, 'Schematic');
    version = 3;
  } else if (name === 'Schematic') {
    version = 2;
  } else {
    throw new Error('Not a Sponge schematic (root name "' + name + '")');
  }
  if (num(root.Version, 'Version') !== version) throw new Error('Version mismatch');
  const width = num(root.Width, 'Width');
  const height = num(root.Height, 'Height');
  const length = num(root.Length, 'Length');
  let paletteTag: NbtTag | undefined;
  let dataTag: NbtTag | undefined;
  if (version === 3) {
    const blocks = asCompound(root.Blocks, 'Blocks');
    paletteTag = blocks.Palette;
    dataTag = blocks.Data;
  } else {
    paletteTag = root.Palette;
    dataTag = root.BlockData;
  }
  const palette: Record<string, number> = {};
  for (const [k, v] of Object.entries(asCompound(paletteTag, 'Palette'))) palette[k] = num(v, 'palette entry');
  if (!dataTag || dataTag.type !== TAG.ByteArray) throw new Error('Missing block data');
  const total = width * height * length;
  const idxs = readVarints(dataTag.value, total);
  if (idxs.length !== total) throw new Error(`Block data has ${idxs.length} entries, expected ${total}`);
  const rev: string[] = [];
  for (const [k, v] of Object.entries(palette)) rev[v] = k;
  const blocks = idxs.map((i) => {
    const s = rev[i];
    if (s === undefined) throw new Error('Palette index out of range: ' + i);
    return s;
  });
  const off = root.Offset && root.Offset.type === TAG.IntArray ? root.Offset.value : [0, 0, 0];
  return {
    version,
    dataVersion: num(root.DataVersion, 'DataVersion'),
    width,
    height,
    length,
    offset: off,
    blocks,
    palette,
  };
}
