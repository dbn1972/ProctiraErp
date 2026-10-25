# Wave 0 baseline results

- SHA: `4c7fb8fec961b49a8a7b70c05d22ebe30ad18e20` (merge commit of PR #652; origin/main tip at run time)
- Branch: `docs/ledger-triage-wave0` (worktree `.agents/worktrees/ledger-triage-wave0`)
- Node v20.20.2, pnpm 10.33.2 (matches `packageManager: pnpm@10.33.2`; engines node>=20, pnpm>=10)
- Env: DATABASE_URL / REDIS_URL / CI unset, so live/PG-backed tests self-skip (299 skipped tests total).

## Server guard

| When | Before | Exit |
|---|---|---|
| 2026-10-25T08:54:13+00:00 | install | 0 |
| 2026-10-25T08:54:28+00:00 | typecheck | 0 |
| 2026-10-25T08:57:36+00:00 | lint | 0 |
| 2026-10-25T09:01:30+00:00 | test | 0 |

All guard checks passed; no check was skipped for server-guard reasons.

## Commands

| Command | Exit | Duration (s) | Log |
|---|---|---|---|
| `pnpm -C <wt> install --frozen-lockfile` | 0 | 6 | `R/logs/baseline/install.log` |
| `pnpm -C <wt> exec turbo run typecheck --continue --concurrency=3 --summarize` | 0 | 173 | `R/logs/baseline/typecheck.log` |
| `pnpm -C <wt> exec turbo run lint --continue --concurrency=3 --summarize` | 1 | 208 | `R/logs/baseline/lint.log` |
| `pnpm -C <wt> exec turbo run test --continue --concurrency=2 --summarize` | 0 | 277 | `R/logs/baseline/test.log` |

Turbo run summaries: `R/logs/baseline/{typecheck,lint,test}-summary.json`. All typecheck/lint/test tasks were cache MISS (executed fresh); the "cached" counts in turbo output are `^build` dependency tasks reused from the typecheck run.

## Totals (83 workspace packages, root excluded)

| Check | PASS | FAIL | NO_SCRIPT | NOT_RUN |
|---|---|---|---|---|
| typecheck | 82 | 0 | 1 | 0 |
| lint | 53 | 27 | 3 | 0 |
| test | 83 | 0 | 0 | 0 |

Tests: 11692 passed, 299 skipped, 0 failed (vitest counts; `eslint-plugin-proctira` and `@proctira/dod-checks` use non-vitest runners and passed with exit 0).

NO_SCRIPT: typecheck — `eslint-plugin-proctira`; lint — `eslint-plugin-proctira`, `@proctira/backend-providers`, `@proctira/migrations`.

## Pre-existing failures (at baseline, not fixed in this wave)

Only lint fails: 27 packages, 133 errors total (warnings do not fail). Dominant rules: `import/order`, `@typescript-eslint/no-unused-vars`; also `no-misused-promises`, `no-redundant-type-constituents`, `no-unnecessary-type-assertion`, `import/no-duplicates`, `consistent-type-imports`, `restrict-template-expressions`, `no-unsafe-member-access`. Root `.eslintrc.json` has `root: true`, so the nested worktree does not inherit the primary checkout's config.

| Package | Exit | Totals | First error (file — line) |
|---|---|---|---|
| @proctira/api-gateway | 1 | 60 problems (5 errors, 55 warnings) | `apps/api-gateway/src/tenant-plan-quotas.ts` — `12:24  error  "free" is overridden by string in this union type  @typescript-eslint/no-redundant-type-constituents` |
| @proctira/backend-admin-dashboard | 1 | 2 problems (1 error, 1 warning) | `packages/backend/admin-dashboard/src/admin-dashboard-plugin.ts` — `7:1  error  `fastify` type import should occur before import of `fastify-plugin`  import/order` |
| @proctira/backend-assessment | 1 | 72 problems (3 errors, 69 warnings) | `packages/backend/assessment/src/routes.ts` — `27:1  error  There should be no empty line within import group  import/order` |
| @proctira/backend-attendance | 1 | 46 problems (2 errors, 44 warnings) | `packages/backend/attendance/src/ops-routes.ts` — `22:1  error  There should be no empty line within import group  import/order` |
| @proctira/backend-auth | 1 | 56 problems (2 errors, 54 warnings) | `packages/backend/auth/src/external-providers/provider-registry.ts` — `7:37  error  'ExternalProviderConfig' is defined but never used. Allowed unused vars must match /^_/u  @typescript-eslint/no-unused-vars` |
| @proctira/backend-billing | 1 | 48 problems (3 errors, 45 warnings) | `packages/backend/billing/src/entitlement-middleware.ts` — `228:12  error  Promise-returning function provided to return value where a void return was expected  @typescript-eslint/no-misused-promises` |
| @proctira/backend-custom-field | 1 | 33 problems (8 errors, 25 warnings) | `packages/backend/custom-field/src/custom-field-service.ts` — `28:1  error  `./custom-field-validator.js` import should occur before type import of `./schemas.js`  import/order` |
| @proctira/backend-developer-portal | 1 | 77 problems (1 error, 76 warnings) | `packages/backend/developer-portal/src/create-developer-portal-repository.ts` — `12:1  error  `./developer-portal-repository.js` type import should occur before import of `./hybrid-repository.js`  import/order` |
| @proctira/backend-examination | 1 | 80 problems (5 errors, 75 warnings) | `packages/backend/examination/src/document-task-queue-factory.ts` — `10:35  error  'packages/shared/queue-abstraction/src/index.ts' imported multiple times  import/no-duplicates` |
| @proctira/backend-institution | 1 | 87 problems (7 errors, 80 warnings) | `packages/backend/institution/src/area-hierarchy/area-hierarchy.routes.ts` — `18:1  error  All imports in the declaration are only used as types. Use `import type`  @typescript-eslint/consistent-type-imports` |
| @proctira/backend-plugin | 1 | 41 problems (12 errors, 29 warnings) | `packages/backend/plugin/src/extension-points/extension-point-registry.ts` — `14:1  error  `@proctira/common` import should occur before import of `uuid`  import/order` |
| @proctira/backend-policy | 1 | 32 problems (4 errors, 28 warnings) | `packages/backend/policy/src/in-memory-repository.ts` — `7:1  error  There should be at least one empty line between import groups  import/order` |
| @proctira/backend-privacy | 1 | 36 problems (1 error, 35 warnings) | `packages/backend/privacy/src/create-privacy-repository.ts` — `11:1  error  `./pg-privacy-repository.js` import should occur before type import of `./privacy-repository.js`  import/order` |
| @proctira/backend-student | 1 | 91 problems (2 errors, 89 warnings) | `packages/backend/student/src/audit/audit-service.ts` — `16:1  error  `./types.js` type import should occur after type import of `./diff.js`  import/order` |
| @proctira/backend-survey | 1 | 29 problems (1 error, 28 warnings) | `packages/backend/survey/src/survey-plugin.ts` — `20:1  error  `./routes.js` import should occur before type import of `./survey-repository.js`  import/order` |
| @proctira/backend-theme | 1 | 24 problems (1 error, 23 warnings) | `packages/backend/theme/src/theme-plugin.ts` — `12:1  error  `./routes.js` import should occur before type import of `./theme-repository.js`  import/order` |
| @proctira/backend-workflow | 1 | 50 problems (4 errors, 46 warnings) | `packages/backend/workflow/src/escalation-service.ts` — `13:1  error  `@proctira/events` type import should occur before import of `uuid`  import/order` |
| @proctira/auth | 1 | 3 problems (1 error, 2 warnings) | `packages/shared/auth/src/rbac.ts` — `14:25  error  'RoleAssignment' is defined but never used. Allowed unused vars must match /^_/u  @typescript-eslint/no-unused-vars` |
| @proctira/cdn | 1 | 2 problems (2 errors, 0 warnings) | `packages/shared/cdn/src/adapters/cloudfront.ts` — `41:11  error  'invalidationPaths' is assigned a value but never used  @typescript-eslint/no-unused-vars` |
| @proctira/secrets | 1 | 6 problems (3 errors, 3 warnings) | `packages/shared/secrets/src/factory.ts` — `8:1  error  `./types.js` type import should occur after import of `./adapters/vault-adapter.js`  import/order` |
| @proctira/storage | 1 | 2 problems (2 errors, 0 warnings) | `packages/shared/storage/src/factory.ts` — `7:1  error  `./adapters/s3-adapter.js` import should occur before type import of `./types.js`  import/order` |
| @proctira/ui-components | 1 | 23 problems (17 errors, 6 warnings) | `packages/ui/components/src/Accordion.tsx` — `3:1  error  `react` import should occur after import of `lucide-react`  import/order` |
| @proctira/ui-dashboards | 1 | 18 problems (18 errors, 0 warnings) | `packages/ui/dashboards/src/DashboardSection.tsx` — `23:1  error  There should be no empty line within import group  import/order` |
| @proctira/plugin-sdk | 1 | 63 problems (25 errors, 38 warnings) | `plugins/plugin-sdk/src/core/define-hook.ts` — `7:15  error  'HookContext' is defined but never used. Allowed unused vars must match /^_/u  @typescript-eslint/no-unused-vars` |
| @proctira/default-theme | 1 | 1 problem (1 error, 0 warnings) | `themes/default-theme/src/index.ts` — `27:1  error  `./dark.js` import should occur before import of `./light.js`  import/order` |
| @proctira/theme-sdk | 1 | 1 problem (1 error, 0 warnings) | `themes/theme-sdk/src/preview.ts` — `16:28  error  'ThemeAssets' is defined but never used. Allowed unused vars must match /^_/u  @typescript-eslint/no-unused-vars` |
| @proctira/install-cli | 1 | 2 problems (1 error, 1 warning) | `tools/install-cli/src/commands/validate.ts` — `17:10  error  'execSync' is defined but never used. Allowed unused vars must match /^_/u  @typescript-eslint/no-unused-vars` |

Full per-file output: `R/logs/baseline/lint.log`. Per-rule error counts per package are in `baseline-results.json` → `packages[].lint.error_rules`.

## In-flight work

| Item | State | Mergeable | Notes |
|---|---|---|---|
| #654 `fix/audit-institution-batch` | OPEN | CONFLICTING / DIRTY | OPEN, CONFLICTING / mergeStateStatus DIRTY: needs rebase/conflict resolution before merge. |
| #633 `fix/audit-role-catalogue-d2` | OPEN | MERGEABLE / BEHIND | OPEN, MERGEABLE but BEHIND main; no review decision. |
| #652 `docs/reconcile-ledger-649` | MERGED | UNKNOWN / UNKNOWN | MERGED 2026-10-25T08:50:19Z; merge commit 4c7fb8fe is the baseline SHA (origin/main tip at triage time). |
| #630 `chore/canonical-gap-ledger` | OPEN | CONFLICTING / DIRTY | OPEN, CONFLICTING / DIRTY as expected; last updated 2026-10-18. |
| `fix/audit-parent-portal-batch` (no PR) | local only | n/a | Last commit 2026-10-22T12:10:16Z (`6c05bbec`, PRC-M533); 6 ahead / 8 behind origin/main; not on origin; worktree clean. |

Open PRs: 14 total — #654, #633, #630 plus 11 Dependabot PRs (#660, #656, #645, #644, #643, #642, #641, #640, #639, #638, #636). Full list in `baseline-results.json` → `open_prs`.

## Tree hygiene

Turbo `^build` ran Next.js builds that rewrote 5 `next-env.d.ts` files (admin-console, developer-portal, install-wizard, public-website, registration-portal). Restored with `git -C <wt> checkout -- <file>`. Final `git status --porcelain`: only `?? .agents/tasks/ProctiraErp-docs-ledger-triage-wave0-2026-10-25/`.

## Not verified

- Live/PG-gated suites (`test:pg`, `test:live`, tenant-isolation integration/e2e) were not in scope; their tests skipped without DATABASE_URL/REDIS_URL.
- Web/Flutter e2e, build-only gates and root `check:*` scripts were not run (not part of typecheck/lint/test).
- Why main CI is green while package lint fails was not investigated (likely affected-only filtering); treat as an open question, not a finding.
