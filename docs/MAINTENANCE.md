# Maintenance guide

## Non-negotiable invariants

- Preserve imported raw XML and bytes; typed views may be partial but must never silently replace source evidence.
- Identify channels by their composite `channelId`, never by DDI alone.
- Decode only layouts established by declarations and tested evidence. Ambiguity is an issue, not a fallback guess.
- Keep large payloads in the dataset repository and typed arrays, not Zustand or per-cell React objects.
- Treat `info` as a note. Only `warning` and `error` contribute to actionable issue counts and file warning state.
- Apply current display filters consistently to cell painting, legend range, visible/filtered counts, and dose summaries.
- Variant creation must pass preflight, use the normal importer afterward, and leave the source dataset available.

## Resource boundaries

Shared import, XML, grid, and presentation limits live in `lib/isoxml/limits.ts`; recent-dataset persistence limits live in `lib/isoxml/repository.ts`.

Keep the main-thread preflight in `lib/isoxml/import-client.ts` aligned with worker-side limits. The worker remains the authority because callers can bypass the UI.

## Derived metadata

`IsoXmlDataset` contains both evidence and summaries. When parser/reference behavior changes, update `refreshDatasetReferenceMetadata` so restored IndexedDB datasets refresh objects, issues, file statuses, task issue counts, and support summaries together.

When adding an issue code:

1. Choose the least severe accurate level.
2. Include evidence, impact, recovery state, and a concrete action.
3. Add the code to `docs/VALIDATION_RULES.md`.
4. Test issue uniqueness and any derived counts/statuses it affects.

## Performance checks

- Canvas painting should iterate the current viewport range, not every decoded cell.
- Virtualized tables should construct only visible row display values.
- Avoid storing arrays of decoded display objects for a whole channel; use compact numeric/mask arrays and decode exact text on demand.
- Test truncated data without allocating the undeclared tail.
- Include adversarial dimensions, precision, counts, and paths in parser/import tests.

## Verification order

```bash
pnpm format
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

Run `pnpm fixtures:generate` only when fixture generation changes. Run `pnpm ddi:sync` only when intentionally refreshing the public online snapshot, then review its version, entry count, source links, generated core file, and DDI tests.

For UI changes, verify at least dark/light appearance, narrow layout, keyboard focus, map pin/coordinate behavior, import dialogs, recent-dataset deletion, CSV download, map PNG download, and an imported package with no decoded grid channel.
