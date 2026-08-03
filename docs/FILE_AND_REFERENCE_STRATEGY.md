# File and reference resolution

## Package rules

- Preserve the original relative path, filename casing and bytes for each unique path.
- Match conventional ISOXML filenames case-insensitively, but warn when casing differs.
- Canonical lookup keys use normalized `/` separators and uppercase basenames.
- Never flatten archive paths for preservation; only lookup indexes are normalized.
- Reject absolute, drive-qualified and `..` archive entries.
- Report every unused or unknown file as an informational note.
- Hash files with browser `SubtleCrypto` using SHA-256.

## Reference rules

1. Register all ID-bearing objects without overwriting duplicates.
2. Record candidate reference attributes on the parsed object index.
3. Resolve only when exactly one matching ID and an allowed target type are available.
4. Keep broken, wrong-type and ambiguous references as explicit issue records.
5. Derive incoming-reference lists after outgoing resolution.
6. Do not synthesize PAN, PDT, DET or DVC associations from DDI alone.

The compact ISOXML attribute vocabulary depends on element type. The decoder uses element-scoped attribute maps; unknown attributes remain in `attributes`.

## Binary lookup

Grid filenames are resolved from the declared path first, then a case-insensitive basename, and finally by a unique declared-byte-length match when filenames were changed during transfer. Missing, truncated and trailing data remain explicit issues; only complete records are decoded.

Duplicate paths remain separate manifest occurrences with distinct internal storage keys, so every raw byte/XML occurrence remains addressable. Typed lookup uses the first exact path occurrence. Package transformation is blocked until duplicates are resolved so a generated ZIP cannot silently collapse evidence.
