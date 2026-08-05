# Binary decoding assumptions

This project does not bundle protected ISO 11783 text. The decoder exposes its evidence and refuses to guess when the package does not establish a layout.

## Implemented compact Type 2 layout

The first vertical slice implements the compact layout exercised by the
repository fixture and verified task-data packages:

- `GRD` A/B are the south-west latitude/longitude origin;
- `GRD` C/D are north-south/east-west cell sizes in degrees;
- `GRD` E/F are column/row counts, G is the binary stem, H is the declared
  byte count, and I is the grid type;
- the treatment-zone child defines an ordered list of PDVs;
- each PDV contributes one signed 32-bit integer, little-endian;
- record width is `4 × PDV count`;
- cell order is row-major from the declared south-west origin;
- display value is `(raw + offset) × scale`;
- PDV order is the XML child order and is never sorted by DDI.

The built-in data remains a synthetic, non-certification fixture. The viewer
does not infer alternative layouts when the declaration and byte length do not
support this record structure.

## Ambiguity policy

Before decode, the implementation records:

- grid type;
- rows, columns and expected cells;
- treatment-zone and ordered-PDV candidates;
- ordered PDV counts;
- expected bytes per cell and total bytes;
- actual binary length.

If treatment zones imply different PDV counts, references are unresolved, or the binary length matches more than one plausible layout, the decoder emits `GRID_LAYOUT_AMBIGUOUS` and leaves undecodable channels unavailable.

## Type 1 grids

Type 1 grid payloads are preserved but not decoded. Implementing that profile requires authoritative layout evidence and verified complete/truncated fixtures.

## Type 1 time logs

Type 1 time-log records are decoded using their companion XML template:

- every record starts with unsigned little-endian milliseconds-in-day and days since 1980-01-01;
- each PTN attribute present with an empty value is read from the binary in A-through-I order with its declared ISOXML integer width;
- binary latitude and longitude values are signed 32-bit integers scaled by 10,000,000;
- one unsigned byte declares the sparse DLV count, followed by an unsigned DLV index and signed little-endian 32-bit raw value for each entry;
- DLV order comes from the companion XML and values are not forward-filled into records where the channel is absent;
- DPD, DPT and DVP IDs are resolved inside their owning DVC because those object IDs are device-scoped.

The decoder preserves raw bytes, record offsets, raw channel values and explicit presence masks. Missing header/BIN counterparts, unsupported time-log types, invalid DLV indices, truncated records and resource-limit stops are reported without fabricating records.
