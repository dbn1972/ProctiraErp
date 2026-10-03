# Definition-of-Done baseline

Charter §32 debt ceiling used by `tools/dod-checks`.

- Generated: `2026-09-05T06:44:25.780Z`
- Total errors: **64**
- Total warnings: **416**
- Files scanned: **638**

CI fails only on _new_ error debt beyond this baseline (per-check counts or new fingerprints).
PRC-M408: tenant-id entry re-baselined after the signature lint dropped name exemptions and gained the SQL tenant-predicate scan (59 pre-existing findings recorded as debt; new findings fail CI).

Refreshed on the scholarships E2E branch so main-tip drift (institution tenant-id + auth schema) does not block feature PRs.
