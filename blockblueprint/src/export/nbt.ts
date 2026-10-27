/**
 * Minimal NBT (Named Binary Tag) writer and reader. Big-endian, as used by Minecraft.
 * Written from scratch so the exporter has no dependencies.
 */

export const TAG = {
  End: 0,
  Byte: 1,
  Short: 2,
  Int: 3,
  Long: 4,
  Float: 5,
  Double: 6,
  ByteArray: 7,
  String: 8,
  List: 9,
  Compound: 10,
  IntArray: 11,
  LongArray: 12,
} as const;

export type NbtTag =
  | { type: typeof TAG.Byte; value: number }
  | { type: typeof TAG.Short; value: number }
  | { type: typeof TAG.Int; value: number }
  | { type: typeof TAG.Long; value: bigint }
  | { type: typeof TAG.Float; value: number }
  | { type: typeof TAG.Double; value: number }
  | { type: typeof TAG.ByteArray; value: Uint8Array }
  | { type: typeof TAG.String; value: string }
  | { type: typeof TAG.List; itemType: number; value: NbtTag[] }
  | { type: typeof TAG.Compound; value: Record<string, NbtTag> }
  | { type: typeof TAG.IntArray; value: number[] }
  | { type: typeof TAG.LongArray; value: bigint[] };

export const nbt = {
  byte: (value: number): NbtTag => ({ type: TAG.Byte, value }),
  short: (value: number): NbtTag => ({ type: TAG.Short, value }),
  int: (value: number): NbtTag => ({ type: TAG.Int, value }),
  long: (value: bigint): NbtTag => ({ type: TAG.Long, value }),
  float: (value: number): NbtTag => ({ type: TAG.Float, value }),
  double: (value: number): NbtTag => ({ type: TAG.Double, value }),
  byteArray: (value: Uint8Array): NbtTag => ({ type: TAG.ByteArray, value }),
  string: (value: string): NbtTag => ({ type: TAG.String, value }),
  list: (itemType: number, value: NbtTag[]): NbtTag => ({ type: TAG.List, itemType, value }),
  compound: (value: Record<string, NbtTag>): NbtTag => ({ type: TAG.Compound, value }),
  intArray: (value: number[]): NbtTag => ({ type: TAG.IntArray, value }),
  longArray: (value: bigint[]): NbtTag => ({ type: TAG.LongArray, value }),
};

class Writer {
  private buf = new Uint8Array(1 << 16);
  private view = new DataView(this.buf.buffer);
  private pos = 0;
  private enc = new TextEncoder();

  private ensure(n: number) {
    if (this.pos + n <= this.buf.length) return;
    let cap = this.buf.length;
    while (cap < this.pos + n) cap *= 2;
    const nb = new Uint8Array(cap);
    nb.set(this.buf.subarray(0, this.pos));
    this.buf = nb;
    this.view = new DataView(nb.buffer);
  }
  u8(v: number) {
    this.ensure(1);
    this.view.setUint8(this.pos++, v);
  }
  i16(v: number) {
    this.ensure(2);
    this.view.setInt16(this.pos, v, false);
    this.pos += 2;
  }
  u16(v: number) {
    this.ensure(2);
    this.view.setUint16(this.pos, v, false);
    this.pos += 2;
  }
  i32(v: number) {
    this.ensure(4);
    this.view.setInt32(this.pos, v, false);
    this.pos += 4;
  }
  i64(v: bigint) {
    this.ensure(8);
    this.view.setBigInt64(this.pos, v, false);
    this.pos += 8;
  }
  f32(v: number) {
    this.ensure(4);
    this.view.setFloat32(this.pos, v, false);
    this.pos += 4;
  }
  f64(v: number) {
    this.ensure(8);
    this.view.setFloat64(this.pos, v, false);
    this.pos += 8;
  }
  bytes(b: Uint8Array) {
    this.ensure(b.length);
    this.buf.set(b, this.pos);
    this.pos += b.length;
  }
  str(s: string) {
    const b = this.enc.encode(s);
    if (b.length > 65535) throw new Error('NBT string too long');
    this.u16(b.length);
    this.bytes(b);
  }
  payload(tag: NbtTag) {
    switch (tag.type) {
      case TAG.Byte:
        return this.u8(tag.value & 0xff);
      case TAG.Short:
        return this.i16(tag.value);
      case TAG.Int:
        return this.i32(tag.value);
      case TAG.Long:
        return this.i64(tag.value);
      case TAG.Float:
        return this.f32(tag.value);
      case TAG.Double:
        return this.f64(tag.value);
      case TAG.ByteArray:
        this.i32(tag.value.length);
        return this.bytes(tag.value);
      case TAG.String:
        return this.str(tag.value);
      case TAG.List:
        this.u8(tag.value.length ? tag.itemType : tag.itemType || TAG.End);
        this.i32(tag.value.length);
        for (const t of tag.value) this.payload(t);
        return;
      case TAG.Compound:
        for (const [k, v] of Object.entries(tag.value)) {
          this.u8(v.type);
          this.str(k);
          this.payload(v);
        }
        return this.u8(TAG.End);
      case TAG.IntArray:
        this.i32(tag.value.length);
        for (const n of tag.value) this.i32(n);
        return;
      case TAG.LongArray:
        this.i32(tag.value.length);
        for (const n of tag.value) this.i64(n);
        return;
    }
  }
  finish(): Uint8Array {
    return this.buf.slice(0, this.pos);
  }
}

/** Serialises a named root tag (normally a compound). */
export function writeNbt(rootName: string, root: NbtTag): Uint8Array {
  const w = new Writer();
  w.u8(root.type);
  w.str(rootName);
  w.payload(root);
  return w.finish();
}

class Reader {
  private view: DataView;
  pos = 0;
  private dec = new TextDecoder();
  constructor(private buf: Uint8Array) {
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  u8() {
    return this.view.getUint8(this.pos++);
  }
  i8() {
    return this.view.getInt8(this.pos++);
  }
  i16() {
    const v = this.view.getInt16(this.pos, false);
    this.pos += 2;
    return v;
  }
  u16() {
    const v = this.view.getUint16(this.pos, false);
    this.pos += 2;
    return v;
  }
  i32() {
    const v = this.view.getInt32(this.pos, false);
    this.pos += 4;
    return v;
  }
  i64() {
    const v = this.view.getBigInt64(this.pos, false);
    this.pos += 8;
    return v;
  }
  f32() {
    const v = this.view.getFloat32(this.pos, false);
    this.pos += 4;
    return v;
  }
  f64() {
    const v = this.view.getFloat64(this.pos, false);
    this.pos += 8;
    return v;
  }
  str() {
    const n = this.u16();
    const s = this.dec.decode(this.buf.subarray(this.pos, this.pos + n));
    this.pos += n;
    return s;
  }
  payload(type: number): NbtTag {
    switch (type) {
      case TAG.Byte:
        return nbt.byte(this.i8());
      case TAG.Short:
        return nbt.short(this.i16());
      case TAG.Int:
        return nbt.int(this.i32());
      case TAG.Long:
        return nbt.long(this.i64());
      case TAG.Float:
        return nbt.float(this.f32());
      case TAG.Double:
        return nbt.double(this.f64());
      case TAG.ByteArray: {
        const n = this.i32();
        const out = this.buf.slice(this.pos, this.pos + n);
        this.pos += n;
        return nbt.byteArray(out);
      }
      case TAG.String:
        return nbt.string(this.str());
      case TAG.List: {
        const itemType = this.u8();
        const n = this.i32();
        const items: NbtTag[] = [];
        for (let i = 0; i < n; i++) items.push(this.payload(itemType));
        return nbt.list(itemType, items);
      }
      case TAG.Compound: {
        const out: Record<string, NbtTag> = {};
        for (;;) {
          const t = this.u8();
          if (t === TAG.End) break;
          const k = this.str();
          out[k] = this.payload(t);
        }
        return nbt.compound(out);
      }
      case TAG.IntArray: {
        const n = this.i32();
        const out: number[] = [];
        for (let i = 0; i < n; i++) out.push(this.i32());
        return nbt.intArray(out);
      }
      case TAG.LongArray: {
        const n = this.i32();
        const out: bigint[] = [];
        for (let i = 0; i < n; i++) out.push(this.i64());
        return nbt.longArray(out);
      }
      default:
        throw new Error('Unknown NBT tag type ' + type + ' at byte ' + this.pos);
    }
  }
}

export function readNbt(bytes: Uint8Array): { name: string; tag: NbtTag } {
  const r = new Reader(bytes);
  const type = r.u8();
  if (type === TAG.End) throw new Error('Empty NBT');
  const name = r.str();
  return { name, tag: r.payload(type) };
}

// ---------------------------------------------------------------------------
// gzip helpers (CompressionStream exists in all current browsers and in Node 18+)
// ---------------------------------------------------------------------------

async function pump(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

export async function gzip(data: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('gzip');
  const w = cs.writable.getWriter();
  w.write(data as unknown as BufferSource);
  w.close();
  return pump(cs.readable);
}

export async function gunzip(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('gzip');
  const w = ds.writable.getWriter();
  w.write(data as unknown as BufferSource);
  w.close();
  return pump(ds.readable);
}
