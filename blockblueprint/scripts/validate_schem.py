#!/usr/bin/env python3
"""Independent validator for Sponge .schem files (v2 and v3). No dependencies.

Usage: python3 scripts/validate_schem.py file.schem [...]
Parses the gzip'd NBT with its own reader (not shared with the TypeScript exporter) and checks
what WorldEdit needs: required tags, array sizes, varint decoding and palette bounds.
"""
import gzip, struct, sys

def read_tag(b, o, t):
    if t == 1: return b[o], o + 1
    if t == 2: return struct.unpack_from('>h', b, o)[0], o + 2
    if t == 3: return struct.unpack_from('>i', b, o)[0], o + 4
    if t == 4: return struct.unpack_from('>q', b, o)[0], o + 8
    if t == 5: return struct.unpack_from('>f', b, o)[0], o + 4
    if t == 6: return struct.unpack_from('>d', b, o)[0], o + 8
    if t == 7:
        n = struct.unpack_from('>i', b, o)[0]; o += 4
        return bytes(b[o:o + n]), o + n
    if t == 8:
        n = struct.unpack_from('>H', b, o)[0]; o += 2
        return b[o:o + n].decode('utf-8'), o + n
    if t == 9:
        it = b[o]; n = struct.unpack_from('>i', b, o + 1)[0]; o += 5
        out = []
        for _ in range(n):
            v, o = read_tag(b, o, it); out.append(v)
        return out, o
    if t == 10:
        out = {}
        while True:
            tt = b[o]; o += 1
            if tt == 0: return out, o
            n = struct.unpack_from('>H', b, o)[0]; o += 2
            name = b[o:o + n].decode('utf-8'); o += n
            out[name], o = read_tag(b, o, tt)
    if t == 11:
        n = struct.unpack_from('>i', b, o)[0]; o += 4
        return list(struct.unpack_from('>%di' % n, b, o)), o + 4 * n
    if t == 12:
        n = struct.unpack_from('>i', b, o)[0]; o += 4
        return list(struct.unpack_from('>%dq' % n, b, o)), o + 8 * n
    raise ValueError('bad tag type %d' % t)

def varints(data, count):
    out, i = [], 0
    while len(out) < count:
        v = shift = 0
        while True:
            c = data[i]; i += 1
            v |= (c & 0x7F) << shift
            if not c & 0x80: break
            shift += 7
        out.append(v)
    return out, i

def check(path):
    errs = []
    raw = gzip.open(path, 'rb').read()
    assert raw[0] == 10, 'root is not a compound'
    n = struct.unpack_from('>H', raw, 1)[0]
    rname = raw[3:3 + n].decode()
    root, _ = read_tag(raw, 3 + n, 10)
    if rname == '' and 'Schematic' in root:
        ver, s = 3, root['Schematic']
    elif rname == 'Schematic':
        ver, s = 2, root
    else:
        return ['unknown root layout (name=%r keys=%r)' % (rname, list(root))]
    for k in ('Version', 'DataVersion', 'Width', 'Height', 'Length'):
        if k not in s: errs.append('missing ' + k)
    if errs: return errs
    w, h, l = s['Width'], s['Height'], s['Length']
    if s['Version'] != ver: errs.append('Version tag %s != %s' % (s['Version'], ver))
    if ver == 3:
        blocks = s['Blocks']; pal, data = blocks['Palette'], blocks['Data']
    else:
        pal, data = s['Palette'], s['BlockData']
        if s.get('PaletteMax') != len(pal): errs.append('PaletteMax %s != %d' % (s.get('PaletteMax'), len(pal)))
    ids, used = varints(data, w * h * l)
    if used != len(data): errs.append('trailing bytes in block data (%d of %d)' % (used, len(data)))
    if max(ids) >= len(pal): errs.append('palette index out of range')
    if sorted(pal.values()) != list(range(len(pal))): errs.append('palette values are not 0..n-1')
    inv = {v: k for k, v in pal.items()}
    if inv.get(0) != 'minecraft:air': errs.append('palette 0 is %r, expected air' % inv.get(0))
    off = s.get('Offset')
    if off is None or len(off) != 3: errs.append('Offset missing')
    print('%s: v%d %dx%dx%d palette=%d offset=%s dataVersion=%d' % (path, ver, w, h, l, len(pal), off, s['DataVersion']))
    return errs

bad = 0
for p in sys.argv[1:]:
    e = check(p)
    for x in e: print('  FAIL', x)
    if not e: print('  OK')
    bad += bool(e)
sys.exit(1 if bad else 0)
