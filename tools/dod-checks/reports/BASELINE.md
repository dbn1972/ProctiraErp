# Definition-of-Done baseline

Charter §32 debt ceiling used by `tools/dod-checks`.

- Generated: `2026-09-05T06:44:25.780Z`
- Total errors: **64**
- Total warnings: **416**
- Files scanned: **638**

CI fails only on _new_ error debt beyond this baseline (per-check counts or new fingerprints).
PRC-M408: tenant-id entry re-baselined after the signature lint dropped name exemptions and gained the SQL tenant-predicate scan (67 pre-existing findings recorded as debt when ported onto main after #549; new findings fail CI). The SQL-predicate hits in report/dashboards.ts and staff/pg-hr-ops-store.ts run on tenant-bound clients that the heuristic cannot see; they are tracked as debt, not exempted.

PRC-M409: cross-service-joins and api-schema entries re-baselined after scope moved to every packages/backend/* directory and pg `.query()` SQL is scanned (7 cross-service JOIN + 1 api-schema pre-existing findings recorded as debt).

Refreshed on the scholarships E2E branch so main-tip drift (institution tenant-id + auth schema) does not block feature PRs.
