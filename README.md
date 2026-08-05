# OENG ISOXML Studio

A browser-first engineering workspace for inspecting ISOXML task data. The current production vertical slice imports local files and ZIP packages; preserves raw XML and bytes; resolves core task/product/device/value-presentation relationships; decodes a documented Type 2 multi-PDV grid profile and Type 1 time logs; renders planned and executed channels through Leaflet canvases; and traces a selected value back to its XML object and binary offset.

**[Try OENG ISOXML Studio in your browser](https://oliverseges.github.io/oeng-isoxml/)** — the bundled synthetic demo opens automatically, and files you import remain in your browser.

This project does **not** claim ISO 11783 conformance. The bundled public DDI metadata is a versioned convenience snapshot; the official ISOBUS database remains authoritative. Schema validation and additional binary layouts still require verified external inputs and fixtures.

## What works now

- Local multi-file and ZIP import in a dedicated browser worker, plus drag and drop.
- Archive traversal, DTD/entity, individual-file, aggregate-package, file-count, grid-cell and presentation-precision protections.
- Exact raw XML preservation plus an ordered element/attribute object index. Comments, processing instructions and mixed-text placement are not modeled separately.
- Duplicate/broken reference diagnostics.
- Compact Type 2 grid decoding with ordered Int32LE PDVs and typed-array column storage.
- Native time-log adapter registry with evidence-scored automatic selection, a dedicated inspector tab with per-adapter probe evidence, a manual chooser for uncertain layouts, and Type 1 PTN/DLV decoding.
- Three PDVs per cell and repeated DDI channels with different products.
- Raw integer preservation and decimal-safe VPN/DVP scaling.
- Canvas grid and executed-point rendering on Leaflet, complete value cards on cell/point hover, persistent click selection, field boundary, described map controls, and streets/satellite backgrounds retained through the full supported zoom range.
- Executed-channel filtering by exact DDI, evidence-based operation presets, and configurable usefulness checks for empty, missing-presentation, all-zero, constant, unpositioned, single-location and sparse channels.
- Dataset-tree scope filtering for planned data, executed data, or both, combinable with Issues, Spatial and search filters.
- Executed tree rows show the DDI code and dictionary name; device context remains available in the row description.
- Product, DET, PDV, VPN and binary-offset inspection.
- All 765 public DDI entries from ISOBUS Data Dictionary version 2026050501, including definitions, units, bit resolutions, ranges, device classes and links to the correct official record.
- Manifest hashes, severity-sorted validation details, multi-file raw source, active planned/executed-channel CSV export and planned-map PNG export.
- Non-destructive package variants: remove tasks, grids or Type 2 PDVs; add a
  DET to an existing DVC; remap DET references; or merge compatible single-grid
  tasks. Generated ZIPs are downloaded, re-imported, selected for preview and
  kept beside the source.
- Dark/light appearance, resizable/collapsible panels and keyboard focus.

See [support matrix](docs/SUPPORT_MATRIX.md) and [known limitations](docs/KNOWN_LIMITATIONS.md) before using the viewer for production decisions.

## Run locally

Requirements: Node.js 22.13+ and pnpm 10+.

```bash
pnpm install
pnpm dev
```

Open `http://localhost:3000`. A clearly labeled synthetic three-channel fixture loads automatically; use **Import** or drag files onto the workspace.

The committed demo fixture and DDI snapshot are ready to use. `pnpm fixtures:generate`, `pnpm icons:generate`, and `pnpm ddi:sync` are maintenance commands, not startup requirements; the DDI refresh command uses the network.

## Verify

```bash
pnpm test
pnpm exec playwright install chromium
pnpm test:e2e
pnpm lint
pnpm typecheck
pnpm build
```

## Architecture and standards boundaries

- [Architecture](docs/ARCHITECTURE.md)
- [Domain model](docs/DOMAIN_MODEL.md)
- [File and reference strategy](docs/FILE_AND_REFERENCE_STRATEGY.md)
- [Binary decoding notes](docs/BINARY_DECODING_NOTES.md)
- [Support matrix](docs/SUPPORT_MATRIX.md)
- [Element support matrix](docs/ELEMENT_SUPPORT_MATRIX.md)
- [Grid support matrix](docs/GRID_SUPPORT_MATRIX.md)
- [Time-log support matrix](docs/TIMELOG_SUPPORT_MATRIX.md)
- [Security and privacy](docs/SECURITY_AND_PRIVACY.md)
- [Extension guide](docs/EXTENDING.md)
- [Maintenance guide](docs/MAINTENANCE.md)
- [Validation catalogue](docs/VALIDATION_RULES.md)

The UI uses technically specific identities: a process-data layer is keyed by DDI, PDV order, product/PAN evidence, DET, task, grid and source—not DDI alone.

## Resource limits

Imports are intentionally bounded for browser safety: 128 MiB per selected or expanded file, 512 MiB of retained package data, 2,000 retained files, 64 MiB of XML text, 5,000,000 declared grid cells, 2,000,000 decoded time-log records, 10,000,000 decoded time-log value slots, and 20 value-presentation decimal places. Recent-dataset persistence has separate limits documented in [Security and privacy](docs/SECURITY_AND_PRIVACY.md).

## Synthetic fixture

`public/demo` is generated by `scripts/generate-fixtures.mjs`. It is legally distributable synthetic data, not a certification fixture. Its binary record layout is documented in `docs/BINARY_DECODING_NOTES.md`.

## Deployment

The application builds to Cloudflare Worker-compatible ESM through the Sites/Vinext adapter. No database, upload bucket, analytics or imported-data API is configured.

The public demo is also built as a static single-page app and deployed to GitHub Pages from `main` by `.github/workflows/pages.yml`:

```bash
pnpm build:pages
```

Docker can be used for a conventional local production server:

```bash
docker build -t oeng-isoxml-studio .
docker run --rm -p 3000:3000 oeng-isoxml-studio
```

## License and standards material

The original source code and synthetic fixture are available under the [MIT License](LICENSE). You may use, modify and redistribute them, including commercially, as long as the copyright and license notice are retained. Attribution to **Oliver Engermann / OENG ISOXML Studio** is appreciated anywhere the project is presented to end users.

No paid standards text or official schemas are bundled. The generated DDI snapshot contains metadata published by the public ISOBUS online database, retains its source/version, and links every entry back to the official record. Refresh it with `pnpm ddi:sync`; do not manually guess record URLs.
