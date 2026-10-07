# Definition-of-Done baseline

Charter §32 debt ceiling used by `tools/dod-checks`.

- Generated: `2026-10-07T11:51:53.622Z`
- Total errors: **32** (cross-service-joins 7, tenant-id 21, api-schema 2, error-envelope 2)
- Total warnings: **769**
- Files scanned: **1318**

CI fails only on _new_ error debt beyond this baseline (per-check counts or new fingerprints).
Every error entry in `baseline.json` carries a per-entry `reason`; an entry without one fails the gate.

PRC-M408: tenant-id signature lint dropped name exemptions and gained the SQL tenant-predicate scan.

PRC-M409: cross-service-joins and api-schema scope moved to every packages/backend/\* directory and pg `.query()` SQL is scanned.

PR #579 (re-baselined from 78 to 32 errors after merging main). 46 findings were false positives, fixed in the check rather than baselined:

- 31 tenant-id signature hits on platform-scoped records (billing plan catalogue, developer accounts/sandboxes/submissions/marketplace/docs, plugin registry, audit retention sweep), plus a `typeof` capability probe, a destructured `tenantId`, and a forwarded tenant parameter. The platform registry is `src/lib/platform-scope.mjs`.
- 15 tenant-id SQL-predicate hits that run on tenant-bound clients through a same-file wrapper (`this.query(tenantId, …)`, `this.run(tenantId, cb)`), through non-exported functions called only inside `withPgTenant`, or as SQL fragments whose every use site is tenant-bound (report/dashboards.ts, report/providers.ts, staff/pg-hr-ops-store.ts, gradebook, timetable).

The remaining 32 are real pre-existing debt. Each `reason` field in `baseline.json` says why it is tolerated and what fixes it.
