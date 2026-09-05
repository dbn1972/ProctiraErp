# Definition-of-Done Baseline

This document records the pre-existing Definition-of-Done findings present at
the time the new aggregator (`tools/dod-checks/`) was introduced. Each row
identifies an owner team and a triage status.

The aggregator compares each run against `baseline.json` and fails CI only when
new error debt is introduced. Existing errors are tracked here and resolved
incrementally; new PRs must not increase the totals below.

## Summary (auto-captured in `reports/baseline.json`)

| Check                  | Errors | Warnings | Notes                                                            |
| ---------------------- | -----: | -------: | ---------------------------------------------------------------- |
| `table-naming`        |      0 |        0 | All Prisma models are service-prefixed.|
| `cross-service-joins` |      0 |        0 | No raw SQL JOINs across services.|
| `tenant-id`           |     55 |        0 | Service methods that touch persistence without declaring tenantId.|
| `audit-events`        |      0 |       46 | Several services lack audit-trail emission on writes.|
| `api-schema`          |      0 |        0 | Auth invite schemas now publish TypeBox (resolved).|
| `error-envelope`      |     53 |        0 | Stub/legacy routes still return non-envelope 4xx bodies.|
| `i18n-readiness`      |      0 |      415 | Hardcoded English `message` fields in route handlers.|

## Triage Plan

### tenant-id (55 errors)

Owners: each backend service team.

Categories observed in the baseline:

1. **Platform-level resources** (e.g. billing plans, audit recording) — the
   entity is intentionally cross-tenant. Action: refactor the method to accept
   an explicit `PlatformContext` and tag the class with the
   `@PlatformService` decorator (whitelisted by the check).
2. **Methods that already receive a `tenantId` indirectly** through nested
   filter/input objects whose type alias hides the field. Action: rename the
   parameter so the heuristic detects it, or adopt the convention
   `input: { tenantId: string, … }` (already accepted).
3. **Genuine gaps** — service code that performs persistence with the wrong
   scope. Action: fix in a follow-up PR scoped to the owning service.

### audit-events (33 warnings)

Owners: assessment, attendance, auth, billing, custom-field, examination,
institution, plugin, policy, registration, scholarship, staff, student,
survey, tenant, theme, transport, workflow.

Action: import the audit producer from `@proctira/backend-audit` (or the
shared event bus once available) and emit a `record/{create,update,delete}`
event from each write handler. Tracking issue: link to the per-service tasks
in tasks.md.

### api-schema (0 errors)

Resolved: `@proctira/backend-auth` invite schemas now export TypeBox definitions
(`InviteUserInputSchema` / `InviteUserResponseSchema`).

### error-envelope (53 errors)

Owners: alumni, canteen, finance, hostel, inventory, library, lms, and related
stub route packages; also admin-dashboard scalability routes.

Action: replace non-envelope 4xx/5xx bodies with the standard
`{ code, message, statusCode }` envelope (or shared `AppError` helper).

### i18n-readiness (415 warnings)

Owners: each backend service team.

Most findings are short technical strings that surface in dev-tools but do
reach end users in some flows. Action: introduce route-level i18n keys via
`@proctira/i18n` and migrate hardcoded strings in batches per service. This
is tracked separately under the i18n epic and is allowed to lag the strict
gate (warnings only).

## Re-baseline policy

If the platform team agrees that a class of findings should be permanently
allow-listed, update `tools/dod-checks/src/lib/constants.mjs` (or the
relevant check) and re-run:

```bash
pnpm --filter @proctira/dod-checks check -- --update-baseline
```

Commit the regenerated `baseline.json` alongside the constants change so the
audit trail is preserved.
