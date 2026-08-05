# Known limitations

The shipped version is a production-quality vertical slice, not a complete ISOXML implementation.

- Type 2 decoding is limited to the documented compact direct-value layout.
- Type 1 grids are preserved and reported, but not decoded.
- Type 1 time-log XML/BIN files are decoded and visualized; other time-log types, forward-filled state reconstruction, path interpolation, planned-versus-executed comparison and playback are not implemented.
- Executed operation presets are navigation aids, not agronomic classifications. DDIs can belong to several official device classes, and liming is recognized only from explicit lime/kalk evidence rather than guessed from a generic fertilizer channel.
- Executed usefulness filters are non-destructive navigation aids. Zero/constant checks apply the declared linear value presentation, single-location detection uses a five-metre bounding-box diagonal across valid positioned values, and the sparse threshold is fewer than three recorded values. Missing device value presentations can be hidden independently; raw integers and all other hidden channels remain available through **Show all**.
- Schema validation is `not checked` because official schemas are not bundled.
- The bundled DDI dictionary is generated from the public ISOBUS online database and currently includes all 765 entries from version 2026050501. Run `pnpm ddi:sync` to refresh names, definitions, units, ranges, bit resolutions, device classes, statuses and official record links.
- Device objects are visible and core references resolve, but the interactive device node graph is not implemented.
- ZIP import enforces aggregate retained-data limits but JSZip materializes an entry before the viewer knows its actual expanded size. Compression-ratio evidence is not exposed per entry.
- Direct multi-file selection is supported; a browser directory/folder picker is not currently exposed.
- Imports run in a dedicated worker, but there is no user-facing cancel action after a read has started.
- Exact raw XML and bytes are retained. The parsed object index does not model comments, processing instructions or exact mixed-text placement.
- XML line/column offsets are not yet emitted by `fast-xml-parser`; object paths are available.
- Grid georeferencing and cached raster rendering are axis-aligned. Display clipping to a field boundary is available; rotated grids are not implemented. Grids wider or taller than 8,192 cells use the bounded viewport-sampling fallback instead of a cached raster.
- Planned-versus-executed analysis and time animation remain future work. Active planned layers show a finite-value average and an area-weighted total only for recognized per-hectare or per-square-metre units, using the declared constant cell area and current display filters.
- Map PNG composition includes the current viewport, active cells, selected background, boundary and legend while omitting controls and the selected-cell outline. Remote tile pixels depend on provider CORS behavior; the UI suggests exporting without a background when the browser blocks them.
- Active planned/executed-channel CSV and planned-map PNG are the current user-facing data exports. Executed-map image export is not implemented. GeoJSON serialization exists as a library helper but is not yet wired to a control; validation and object-registry JSON exports are not implemented.
- Up to ten recent datasets are stored locally when browser quota and the configured size limits allow it.
- Package variants support a guarded subset of authoring: task/grid deletion, Type 2 PDV removal, DET creation inside an existing DVC, DET reassignment and compatible single-grid task merging.
- New DET authoring covers its ID, device object ID, type, designator, element number and parent object ID. Creating a new DVC or DOR/DPD/DPT graph is not available.
- Task merging requires the same resolved field, customer, farm, task status, grid origin, dimensions, cell size and orientation. Different fields cannot be merged into one TSK.
- Tasks with executed data, incomplete grids, ambiguous treatment zones and unsupported task children are blocked from transforms that would require rewriting them.
- Variant XML is semantically reserialized rather than byte-for-byte round-tripped. The untouched source dataset remains available separately.
- Duplicate package paths are all listed and retained under separate internal storage keys. Typed lookup uses the first exact path occurrence, and variant creation is blocked so a generated ZIP cannot silently collapse those occurrences.

The in-app support state and validation issues are the authority. Do not interpret visibility as proof of schema validity or standards conformance.
