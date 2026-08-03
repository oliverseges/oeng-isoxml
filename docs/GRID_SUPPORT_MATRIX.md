# Grid support matrix

| Capability                     | Type 1      | Type 2 compact layout    |
| ------------------------------ | ----------- | ------------------------ |
| GRD metadata                   | raw         | typed                    |
| Dimensions/origin/cell size    | structural  | validated and bounded    |
| Treatment-zone lookup          | no          | channel declaration only |
| Direct values                  | no          | Int32LE per ordered PDV  |
| Multiple PDVs per cell         | no          | yes                      |
| Repeated DDI/different product | raw         | yes                      |
| VPN scaling/raw preservation   | no          | yes                      |
| Truncated/trailing bytes       | length only | complete-record recovery |
| Canvas visualization           | no          | yes                      |
| Cell hover/pin/table           | no          | yes                      |
| CSV/GeoJSON                    | no          | CSV UI; GeoJSON library  |
| Rotation                       | no          | no                       |

The Type 2 row describes the explicit layout in `BINARY_DECODING_NOTES.md`, not universal ISOXML Type 2 conformance.

The renderer uses channel-oriented typed arrays, compact active-layer masks, and viewport cell culling. Large visible ranges are rendered with a clearly labelled, bounded sampling stride; exact values remain available on pin and in the virtualized table. Quantile estimation for the optional extreme-outlier filter uses an evenly distributed sample capped at 100,000 finite non-zero values, then applies the derived bounds to every decoded cell. The decoder does not allocate missing tail records for truncated binaries. Declared grids above 5,000,000 cells are preserved but not decoded.
