# Extending the viewer

## Add an authorized DDI dictionary

Implement a versioned provider with:

```ts
interface DdiDictionaryProvider {
  id: string;
  version: string;
  source: string;
  lookup(ddi: number): DdiDefinition | undefined;
}
```

Never replace a raw DDI. Store the provider ID/version on every resolved label, keep unmatched channels usable, and test conflicts between dictionary versions. Do not commit licensed content unless distribution is authorized.

## Add a tile provider

Add providers as user preferences with URL template, attribution, min/max zoom, TMS flag and optional subdomains. Store secrets only in runtime environment settings; do not commit keys. Provider activation must remain explicit because it creates a network request.

## Add a time-log decoder adapter

Register a `TimeLogDecoderAdapter` in `lib/isoxml/timelog-adapters.ts` with a stable ID, user-facing label, evidence description, probe and decoder. The probe must return a 0–100 score, compatibility flag, automatic-selection permission and concrete reason. Only unique compatible adapters above the automatic threshold are selected without user input. Permissive or declaration-overriding adapters must set `autoSelectable: false`.

The decoder must preserve source data and return the common channel-oriented `DecodedTimeLog` model. Add tests for automatic selection, ambiguous/no-selection behavior, manual selection and incompatible rejection.

## Add another binary decoder

1. Document authoritative layout evidence.
2. Add a layout discriminator that can return `ambiguous`; do not silently pick a close match.
3. Decode to channel-oriented typed arrays.
4. Preserve raw bytes and raw integers.
5. Emit expected/actual byte evidence.
6. Add complete, truncated, trailing, signed, endian and property-based fixtures.
7. Update every support-matrix column independently.

## Write parser tests

Use small inline XML for ordering, unknown attributes and references. Use generated binary fixtures for record layouts. Tests must assert recovery state and raw preservation—not only formatted output.

## Add schema validation

Provide an adapter that accepts an authorized schema bundle. Schema results are a separate validation dimension; they must not overwrite structural, reference, binary or viewer-support status.
