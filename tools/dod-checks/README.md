# Definition-of-Done CI Checks

Automated enforcement of the Multi-Tenant Product Platform Charter (Section 32 — Definition of Done).
Each check runs independently, can be invoked from the command line, and is wired into CI as a release gate.

## Charter Mapping

| Check ID                | Charter Reference     | What it Enforces                                                                        |
| ----------------------- | --------------------- | --------------------------------------------------------------------------------------- |
| `table-naming`          | §4 + §32              | Every Prisma `model` / `view` maps to a `<service>_<name>` table.                       |
| `cross-service-joins`   | §5 + §32              | No raw SQL JOINs span service boundaries.                                               |
| `tenant-id`             | §3 + §32              | Public service methods that touch persistence accept a `tenantId` argument.             |
| `audit-events`          | §28 + §32             | Services with write routes integrate with the audit trail (audit service or events).    |
| `api-schema`            | §6 + §32              | Every backend service that defines routes ships Typebox schemas (file or inline).       |
| `error-envelope`        | §6 + §32              | 4xx/5xx responses include `{ code, message, statusCode }`.                              |
| `i18n-readiness`        | §17 + §32             | Route handlers don't ship hardcoded English strings in `message` fields.                |

## Running the Checks

From the monorepo root:

```bash
# Run every check, write a JSON report, exit non-zero on any error.
pnpm check:dod

# Run a subset.
pnpm check:dod -- --only=table-naming,cross-service-joins

# Treat warnings as errors.
pnpm check:dod -- --strict

# Run a single check directly.
pnpm --filter @proctira/dod-checks check:i18n
```

The aggregator writes a structured JSON report to `tools/dod-checks/reports/dod-report.json`.
The schema is:

```jsonc
{
  "schemaVersion": 1,
  "generatedAt": "2025-01-15T12:00:00.000Z",
  "charterRef": "Section 32 (Definition of Done)",
  "totals": { "totalErrors": 0, "totalWarnings": 3, "totalFiles": 142 },
  "checks": [
    {
      "check": "table-naming",
      "title": "...",
      "filesScanned": 4,
      "durationMs": 18,
      "errorCount": 0,
      "warningCount": 0,
      "findings": []
    }
  ]
}
```

Other tooling (release dashboards, the developer portal) consumes this JSON
directly. Individual check scripts also exit with the standard convention:
`0` = pass, `1` = error finding(s), `2` = unexpected runtime failure.

## Extending the Checks

Each check lives in `src/checks/<id>.mjs` and exports `run<Id>Check()` plus a
CLI entrypoint. Add a new check by:

1. Creating `src/checks/<new-check>.mjs` that returns a populated `Report`.
2. Adding it to the `ALL_CHECKS` array in `bin/dod-check.mjs`.
3. Adding an `id` to `CHECK_IDS` in `src/lib/constants.mjs`.
4. Adding a unit test in `test/cases/`.

For checks that lend themselves to lint-time enforcement, prefer adding an
ESLint rule under `packages/eslint-plugin-proctira/src/rules/` so violations
surface during normal `pnpm lint`. The two layers complement each other:

- ESLint catches violations as developers type.
- The aggregator catches violations across the whole repo at PR / release time
  (and emits the JSON report for dashboards).

## CI Integration

`pnpm check:dod` runs in `.github/workflows/definition-of-done.yml` for every
PR and push to `main`. The job is wired to the broader CI pipeline defined in
task 31.3. The job:

1. Checks out the repo.
2. Installs dependencies.
3. Runs `pnpm check:dod`.
4. Runs `pnpm --filter @proctira/dod-checks test`.
5. Uploads the JSON report as a build artifact.

A non-zero exit fails the workflow and blocks the merge.

## Baseline (Pre-existing Violations)

When this tool was introduced, a baseline scan was committed in
`reports/baseline.json`. Teams owning each finding triage and resolve them
during the rollout. New PRs must not introduce additional findings.
