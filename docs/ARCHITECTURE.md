# OENG ISOXML Studio — Architecture

## Objective

OENG ISOXML Studio is a browser-first inspection and diagnostics workspace. Imported machinery data remains in the browser. The application preserves raw files and exact raw XML, then builds progressively more opinionated views without treating viewer support as proof of ISO 11783 compliance.

## Processing layers

1. **Raw package** — original names, paths, casing, bytes, media type, size and SHA-256.
2. **Parsed XML index** — ordered elements, unknown elements, unknown attributes and raw attribute strings. Exact source text is retained separately; comments, processing instructions and mixed-text placement are not represented by `IsoXmlObject`.
3. **Object registry** — IDs, duplicate-ID buckets, outgoing/incoming references and source paths.
4. **Resolved domain model** — tasks, fields, grids, treatment zones, process variables, products, value presentations and devices.
5. **Spatial model** — grid georeferencing, cell bounds and typed-array channel data.
6. **Visualization model** — lightweight layer descriptors and viewport rendering instructions.

Heavy byte arrays live in a repository, not the reactive UI store. Zustand only contains dataset and selection handles, visible-layer IDs, layout state and preferences.

## Module boundaries

| File/module                                 | Responsibility                                                  |
| ------------------------------------------- | --------------------------------------------------------------- |
| `lib/isoxml/file-loader.ts`                 | Multiple files, ZIP safety, path normalization and lookup       |
| `lib/isoxml/xml-parser.ts`                  | Secure ordered element/attribute parsing                        |
| `lib/isoxml/object-model.ts`                | Worker input schemas, IDs, flattening and structured issues     |
| `lib/isoxml/reference-resolver.ts`          | ID buckets, duplicate detection and typed reference resolution  |
| `lib/isoxml/grid-decoder.ts`                | Columnar compact Type 2 decoding with explicit layout evidence  |
| `lib/isoxml/timelog-adapters.ts`            | Scored adapter registry, selection and non-destructive override |
| `lib/isoxml/timelog-decoder.ts`             | Type 1 PTN/DLV binary decoding into sparse typed arrays         |
| `lib/isoxml/operation-groups.ts`            | Evidence-based executed-channel navigation presets              |
| `lib/isoxml/timelog-channel-quality.ts`     | Value/presence/location usefulness summaries                    |
| `lib/isoxml/ddi-*.ts`                       | Versioned public DDI snapshot and lookup boundary               |
| `lib/isoxml/value-decoder.ts`               | Raw-preserving decimal-safe presentation                        |
| `lib/isoxml/pipeline.ts`                    | Staged validation, domain summaries and manifest construction   |
| `lib/isoxml/spatial.ts`                     | Bounds, coordinates, hit testing and viewport cell ranges       |
| `components/viewer/MapWorkspace.tsx`        | Planned Leaflet/canvas lifecycle, filters and map-image export  |
| `components/viewer/TimeLogMapWorkspace.tsx` | Executed Leaflet/canvas lifecycle, points and map-image export  |
| `components/viewer/ViewerApp.tsx`           | Stable panel-grid placement and persisted workspace layout      |
| `components/viewer/BottomPanel.tsx`         | Virtualized data tables and resizable column presentation       |
| `components/viewer/map-rendering.ts`        | Grid rasterization and allocation-free point projection         |
| `lib/isoxml/export.ts`                      | CSV and GeoJSON serialization helpers                           |
| `lib/isoxml/package-transform.ts`           | Guarded cleanup/remap and compatible task-merge ZIP variants    |
| `components/viewer/*`                       | Workspace, virtualized tree/table, inspector, dialogs and state |

## Import flow

```text
File picker / drop / demo
        ↓
raw manifest + archive safety checks
        ↓
worker: XML parse → registry → references → validation
        ↓
worker: grid decode + scored time-log adapter selection
        ↓
dataset repository
        ↓
lightweight UI state → cached raster/batched Leaflet canvas + inspector/table
```

`ArrayBuffer` inputs and decoded typed arrays are transferred rather than cloned. Imports use a fresh worker that is terminated after success or failure. A manual time-log adapter change uses a separate short-lived worker and retains the original source unchanged. User-triggered cancellation is not implemented. Imported strings are rendered as text only. External entities, DTDs, archive traversal and oversized retained data are rejected.

Single shapefile overlay uploads are handled on the main thread before the ISOXML worker path. The viewer accepts either one ZIP containing a shapefile or one loose `.shp + .dbf + .shx` set, converts the latter to an in-memory ZIP, and attaches the first usable polygon to the current dataset as a boundary overlay. Imported overlays are preserved in the file manifest and exposed in the task tree so the user can choose which overlay drives clipping and map fit. Standalone shapefile datasets are intentionally out of scope.

## Package variant flow

```text
Current dataset → cleanup/remap plan → compatibility + risk preflight
        ↓                              ↘ optional in-memory continuation
rewrite TASKDATA, time-log headers      normal importer → merge-group editor
and supported Type 2 grid payloads                       ↓
        ↓                                  multi-group compatibility preflight
create ZIP → normal importer/validation → optional download
        ↓
store and select each variant while retaining its source dataset
```

Variant authoring is deliberately narrower than viewing. It can remove tasks,
grids, Type 2 PDVs and complete time logs; add a DET under an existing DVC;
reassign planned PDV and executed DLV device-element references; and process
multiple disjoint merge groups when each group's single grids and task context
are compatible. Executed edits require explicit acknowledgement. DLV order and
time-log record bytes are preserved, so individual executed channels cannot be
removed. The editor does not synthesize a new DVC/DOR/DPD/DPT graph.

## Initial vertical slice

The runnable slice covers local files and ZIPs, exact raw XML plus an ordered object index, task/product/treatment-zone/device/value-presentation relationships, Type 2 grids with independently selectable PDVs, Type 1 time logs with sparse DLV channels, decimal-safe scaling, Leaflet canvas rendering, selection inspection, file manifest, issue list and planned/executed CSV, GeoJSON, shapefile and map-image export. GeoJSON is also the intermediate format behind the shapefile path.

Planned and executed map containers are observed directly for size changes. Panel collapse, panel expansion, pointer resizing and responsive layout changes invalidate the Leaflet viewport and repaint the canvas without changing the active layer. Explicit CSS grid columns keep the map in the centre track even when either side panel is unmounted.

Planned-cell and executed-record tables use compact bounded column defaults followed by a non-data spacer that absorbs unused panel width. This keeps rows full-width without stretching Unit or Product cells. Header separators resize columns by pointer or keyboard; double-click restores the default width, while row virtualization continues to decode only visible values.

Type 1 grid decoding, non-Type-1 time-log layouts, schema validation and full interactive device graphs remain expansion points. The UI labels these as partial or unavailable instead of inferring data.

## Security and privacy

- No import is uploaded.
- The XML parser rejects `DOCTYPE` and entity declarations before parsing.
- ZIP paths are normalized and traversal entries are rejected.
- Selected-file limits are checked before browser reads. Aggregate retained-data limits are enforced while archive entries are expanded; JSZip must materialize an entry before its actual expanded size is known.
- Unknown content is text-escaped by React.
- The default map has no network basemap. OpenStreetMap streets and Esri imagery are explicit opt-ins with attribution.
- The worker never evaluates imported code or follows imported URLs.
