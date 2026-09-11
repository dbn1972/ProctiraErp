# Release ops — world-class gaps 1–10 (W10 branch)

**Branch:** `cursor/w10-health-dw-ux-56c3`  
**PR:** https://github.com/dbn1972/ProctiraErp/pull/48  
**Base:** `main`

## Tip CI honesty

- Required tip checks must be SUCCESS on the merge commit before claiming shipped.
- Pre-fix tip `a78cb4cd` failed Lint / Charter (error-envelope) / E2E (duplicate `/me/pal` route).

## Migrations

- `db/sql/047_academic_rollover_runs_schema.sql` — rollover ledger + LMS modules (+ `academic_period_id` on assignments). Apply with existing SQL migration path (not Prisma-only).

## Externals

- IdP / PSP / Twilio / FCM / MapLibre / sealed PDF remain NON-GOAL (sandbox/honesty).

## Deploy

- App/API change; no image-signing required for merge of this PR beyond existing Supply Chain workflow rules.

## Rollback

- Revert merge commit; disable branding/rollover UI toggles; leave `047` tables in place (additive) or drop via follow-up DBA change if needed.

## Main tip CI follow-up (2026-09-11)

Merge commit `57b2e9bd` on `main` failed required **Lint** and **Type Check** (Unit/Build skipped). Follow-up branch `cursor/main-ci-green-56c3` fixes:

- Registration portal Next 15 `cookies()` / `headers()` must be awaited
- Tip ESLint import-order / unused schemas / unnecessary assertions
- `@proctira/backend-providers` missing `tsconfig.json` (parser + type-aware lint)
- No new provider secrets; sandbox facade unchanged

**Ship claim:** not ready until this follow-up’s required tip checks are SUCCESS on `main`.
