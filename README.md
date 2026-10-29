# BlockBlueprint

Procedural Minecraft house generator with a lit 3D preview and Sponge `.schem` export for WorldEdit.
Describe a house in plain English or German, tweak it, watch it build, and paste it into your world.

![Medieval house](docs/medieval.png)

| | |
|---|---|
| ![Castle](docs/castle.png) | ![Fairytale](docs/fairytale.png) |
| ![Modern](docs/modern.png) | ![Night](docs/night.png) |

## Features

- **Six styles**: modern, medieval, cottage, castle, fairytale, villain lair
- **Roof forms**: flat (with rail or battlements), gable, hip, shed (sloped), cone and onion domes
- **House shapes**: box, L, T, U, and stacked cantilever boxes for modern houses; round corner towers
- **Details**: porch, chimney, window rhythm, timber framing, garden, pool, castle moat with drawbridge, furnished interior with stairs
- **Prompt box**: `a large medieval house with an onion roof and two towers` (German keywords work too)
- **Preview in the browser (Three.js)**:
  - procedural 16x16 texture atlas, no external assets
  - Minecraft-style flood-fill light, sky light and coloured block light (soul lanterns glow cyan)
  - smooth vertex ambient occlusion, sun and moon with shadow maps, day and night slider, stars, clouds
  - bloom on emissive blocks, block-by-block build animation, PNG screenshot
- **Export**: Sponge schematic **v2 and v3**, hand-written NBT, gzip and varint encoder (no dependencies), with correct stair shapes and fence/pane connections baked in (WorldEdit pastes states as-is)

## Run

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # 22 tests: varint, schematic round trip, generator invariants, parser
npm run build
npx vite-node scripts/export_samples.ts && python3 scripts/validate_schem.py out/*.schem
```

## Use in Minecraft

1. Download `.schem` from the export section (try v3 first, v2 for older WorldEdit versions).
2. Copy it to `plugins/WorldEdit/schematics/` (server) or `config/worldedit/schematics/` (Fabric/Forge).
3. Stand where the front door should be and run `//schem load <name>` then `//paste`.

The paste origin is the point in front of the door at ground level.

> **Status:** The files are validated by round-trip tests and by an independent Python parser, but I have not yet loaded them in a running Minecraft client. Targets Java Edition 1.20.x (DataVersion 3700). Reports of block-state problems are welcome.

## How it works

```
prompt -> parser -> Params -> generate() -> VoxelGrid -> mesher -> Three.js
                                         \-> Sponge writer -> .schem
```

- `src/gen`: layout (wings, floors), walls and window rhythm, roofs, towers, decor, interior. Everything is seeded and deterministic.
- `src/core`: block registry (interned state strings), voxel grid, stair/connection fix-up pass.
- `src/render`: texture painters, box models, light field, mesher with AO, scene.
- `src/export`: NBT, varint, Sponge v2/v3 writer and reader.

## Roadmap

- LLM-backed prompt parser (same interface as the rule-based one)
- Wave Function Collapse for facade details
- Steep roofs with dormers, window sills and lintels

MIT licensed.
