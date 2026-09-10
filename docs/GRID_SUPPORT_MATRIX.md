# Grid support matrix

| Capability                      | Type 1      | Type 2 compact layout    |
| ------------------------------- | ----------- | ------------------------ |
| GRD metadata                    | raw         | typed                    |
| Dimensions/origin/cell size     | structural  | validated and bounded    |
| Treatment-zone lookup           | no          | channel declaration only |
| Direct values                   | no          | Int32LE per ordered PDV  |
| Multiple PDVs per cell          | no          | yes                      |
| Repeated DDI/different product  | raw         | yes                      |
| VPN scaling/raw preservation    | no          | yes                      |
| Truncated/trailing bytes        | length only | complete-record recovery |
| Canvas visualization            | no          | yes                      |
| Cell hover/select/GPS pin/table | no          | yes                      |
| CSV/Shapefile/GeoJSON           | no          | CSV UI; Shapefile UI; GeoJSON UI      |
| Rotation                        | no          | no                       |

The Type 2 row describes the explicit layout in `BINARY_DECODING_NOTES.md`, not universal ISOXML Type 2 conformance.

The renderer uses channel-oriented typed arrays and compact active-layer masks. Axis-aligned grids up to 8,192 rows and columns are colorized into a north-up one-pixel-per-cell raster only when the channel, classification, or filters change; pan frames then scale one cached image instead of repainting every cell. Pathological dimensions fall back to viewport culling with a bounded sampling stride. Canvas backing storage is reused and Leaflet move events are coalesced to one redraw per animation frame. Exact values remain available through constant-time geographic cell hit testing, selection, and the virtualized table.

Selecting a planned cell shows its centre coordinate without drawing a map pin. A standalone GPS pin is placed only through the one-shot pin control and only on empty map space; selecting a cell clears it. This keeps the selection outline as the only marker on a data cell.

Quantile estimation for the optional extreme-outlier filter uses an evenly distributed sample capped at 100,000 finite non-zero values, then applies the derived bounds to every decoded cell. The decoder does not allocate missing tail records for truncated binaries. Declared grids above 5,000,000 cells are preserved but not decoded.
