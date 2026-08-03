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

## Type 1 and time logs

Type 1 grid and time-log payloads are preserved but not decoded. Implementing either requires authoritative layout evidence, explicit state semantics, and verified complete/truncated fixtures; the viewer does not currently expose placeholder decoded models for them.
