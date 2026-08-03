# Security and privacy model

## Local processing

Selected files are read through browser file APIs and transferred to a dedicated worker. There is no upload route, database, telemetry payload or server-side parser. Up to ten recent datasets may also be stored in browser IndexedDB for local switching and reload recovery; users can remove one dataset or clear all from the dataset menu.

## Untrusted input controls

- XML containing `DOCTYPE` or `ENTITY` declarations is rejected.
- External entities and imported URLs are never resolved.
- Imported values render as React text, never as HTML.
- Selected and expanded files are capped at 128 MiB each.
- Retained package data is capped at 512 MiB across selected files, archive files and expanded entries, with at most 2,000 retained files.
- XML text is capped at 64 MiB, grid decoding at 5,000,000 declared cells, and presentation precision at 20 decimals.
- Absolute, drive-qualified and `..` archive paths are rejected.
- CRC checks are requested during ZIP extraction.
- SHA-256 is calculated locally for every manifest entry.
- Unknown files, elements and attributes are reported rather than discarded.

## Network behavior

The default map has no remote base layer. Enabling **Streets** requests OpenStreetMap tiles; enabling **Satellite** requests Esri World Imagery tiles. Both show attribution. No imported URL triggers a request.

The production Content Security Policy allows network connections only to the application origin and the two declared tile hosts. Development additionally allows WebSocket connections for hot reload.

## Response policy

The worker entry adds a Content Security Policy, clickjacking protection, content-type sniffing protection, a strict referrer policy and a restrictive permissions policy. The App Router requires inline bootstrap scripts; development additionally permits eval for the local module runtime, while production does not.

## Threats not yet fully mitigated

JSZip must decompress an entry before its actual expanded size can be counted, and per-entry compression ratios are not displayed. Inputs are bounded, but a package near the limits can still create substantial temporary browser memory pressure. Full adversarial fuzzing remains future hardening work.

IndexedDB persistence is best-effort: one dataset is limited to 100 MiB and stored recent datasets to 200 MiB total. Browser quota may be lower, in which case viewing still works for the current session.
