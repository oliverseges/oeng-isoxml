# Domain model

## Preserved source and parsed index

Each dataset retains exact XML strings in `rawXmlByFile` and original byte arrays in `rawBytesByFile`. Those maps use an internal per-occurrence storage key, while the manifest keeps the original displayed package path; repeated paths therefore remain independently addressable. On top of that source, the parser creates an ordered element/attribute index:

```ts
interface IsoXmlObject {
  uid: string;
  id?: string;
  elementType: string;
  attributes: Record<string, string>;
  children: IsoXmlObject[];
  sourceFile: string;
  path: string;
  text?: string;
}
```

The index retains unknown elements, attributes, raw attribute strings and element order. It is not a byte-for-byte XML syntax tree: comments, processing instructions and exact mixed-text placement are available only in the preserved raw XML.

`ObjectRegistry.byId` stores arrays. Duplicate IDs remain evidence and `resolveOne` returns a target only when exactly one candidate of an allowed type exists.

## Grid model

`DecodedGrid` retains declared dimensions and byte evidence, independently identified `GridChannel` records, and channel-oriented typed arrays. For complete grids, every channel array has `decodedCellCount` entries. For truncated binaries, arrays contain complete records only; undecoded tail cells are represented by `expectedCellCount - decodedCellCount`, not sentinel allocations.

A channel ID combines task, treatment zone, PDV order, DDI, product and DET evidence. DDI alone is never a channel key.

Map analysis uses compact `Float64Array`/`Uint8Array` views for the active channel. Exact formatted values are decoded on demand for the hovered, selected, or visible table rows rather than allocating a display object for every cell.

## Value state

Every inspected value retains the raw signed integer, presentation ID/source, decimal-safe offset and scale, formatted text, unit, and confidence. A recorded zero is distinct from missing or invalid data. Presentation decimal declarations are accepted from 0 through 20; larger declarations are reported and safely fall back to zero display decimals.

## Validation issue

An issue has severity, category, stable code, unique evidence ID, message, explanation, file, object/path or byte offset, related objects, suggested action, recovery flag and incomplete-results flag. Informational notes do not count as actionable issues and do not turn a file into warning status.

Schema validity, reference validity, binary consistency, viewer support, and source retention remain separate dimensions.
