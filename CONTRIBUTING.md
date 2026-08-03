# Contributing

Keep changes inspectable and evidence-backed.

1. Read the architecture, maintenance guide, binary notes and support matrix.
2. Add or update a synthetic fixture before a decoder change.
3. Preserve raw values, XML order and unknown content.
4. Never resolve product, PAN, DET or DVC from DDI alone.
5. Add unit, property and browser-flow coverage.
6. Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, and `pnpm test:e2e`.
7. Update each support-matrix dimension separately.

Refresh the attributed public DDI metadata only through `pnpm ddi:sync`. Do not add paid standards text, schemas or manufacturer documentation without clear authorization.
