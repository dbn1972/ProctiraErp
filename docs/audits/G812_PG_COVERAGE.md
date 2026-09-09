# G-812 — Postgres / integration test coverage

## Closed in this wave

| Package | Suite | Notes |
|---------|-------|-------|
| `examination` | `pg-examination-repository.test.ts` | create → findById same tenant → cross-tenant null; skips without `DATABASE_URL` |
| `institution` | `pg-institution-repository.test.ts` | same pattern |

Both run under the G-807 CI step (`turbo run test --filter='./packages/backend/*'` with `DATABASE_URL`).

## Follow-ups (mounted long-tail / parked)

admin-dashboard, custom-field, dashboards (parked), data-warehouse, developer-portal, etl, install, plugin, policy, report, survey, theme — add `pg-*-repository.test.ts` smokes when those packages gain durable stores or are un-parked.
