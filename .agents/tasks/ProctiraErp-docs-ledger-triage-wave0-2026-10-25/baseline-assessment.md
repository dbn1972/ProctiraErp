# Wave 0 baseline assessment

- Baseline SHA: `4c7fb8fec961b49a8a7b70c05d22ebe30ad18e20` (merge commit of PR #652 `docs/reconcile-ledger-649`). Still the `origin/main` tip when consolidation ran (`git fetch` + `git rev-parse origin/main`, 2026-10-25).
- Branch: `docs/ledger-triage-wave0`. Worktree: `/home/ec2-user/ProctiraErp/.agents/worktrees/ledger-triage-wave0`. The primary checkout was not touched.
- Toolchain: Node v20.20.2 and pnpm 10.33.2. These match `packageManager: pnpm@10.33.2` and engines `node>=20`, `pnpm>=10`.
- Environment: `DATABASE_URL`, `REDIS_URL` and `CI` were unset, so live/PG-backed tests skip themselves (299 tests skipped at baseline).
- Ledger before: 758 rows, CRLF, trailing newline, sha256 `80f7968b…978da`. OPEN 291, PARTIAL 206, FULLY_CLOSED 260, DUPLICATE 1 (`work/ledger-before.json`).
- The xlsx `docs/audits/gap-analysis/Proctira_Code_Audit_Gaps.xlsx` is missing from the worktree, from every local and remote branch, from git history and from the host. The orchestrator approved triaging on ledger data only. Fix steps, Acceptance and Needs are therefore null for every row. NEEDS_DECISION was taken from `DECISION_REGISTER.md` and the row notes, not from a Needs column (`work/triage-manifest.json` → `xlsx`, `triage_policy`).

## Baseline checks

`~/bin/server-guard.sh` exited 0 before each command: install 08:54:13, typecheck 08:54:28, lint 08:57:36, test 09:01:30. Its output is in `logs/baseline/guard-*.out`.

| Command (run from the worktree) | Exit | Duration | Log |
|---|---|---|---|
| `pnpm install --frozen-lockfile` | 0 | 6 s | `logs/baseline/install.log` |
| `pnpm exec turbo run typecheck --continue --concurrency=3 --summarize` | 0 | 173 s | `logs/baseline/typecheck.log` |
| `pnpm exec turbo run lint --continue --concurrency=3 --summarize` | **1** | 208 s | `logs/baseline/lint.log` |
| `pnpm exec turbo run test --continue --concurrency=2 --summarize` | 0 | 277 s | `logs/baseline/test.log` |

Key excerpts from the logs (logs are gitignored and referenced by path under this run dir):

```text
typecheck.log:  Tasks:    136 successful, 136 total      Time: 2m53.025s
lint.log:       Tasks:    107 successful, 134 total      Time: 3m27.708s
lint.log:      Failed:    @proctira/api-gateway#lint, @proctira/auth#lint, … (27 packages)
test.log:       Tasks:    137 successful, 137 total      Time: 4m35.798s
```

Per-package totals across 83 workspace packages:

| Check | PASS | FAIL | NO_SCRIPT |
|---|---|---|---|
| typecheck | 82 | 0 | 1 |
| lint | 53 | 27 | 3 |
| test | 83 | 0 | 0 |

Tests: 11,692 passed, 299 skipped, 0 failed. Details are in `work/baseline-results.{json,md}`.

## Pre-existing failures (not fixed in this wave)

Lint is the only failing check. 27 packages report 133 errors between them (warnings do not fail the run). Most errors are `import/order` and `@typescript-eslint/no-unused-vars`. The first error in each package is listed in `work/baseline-results.md`.

| Package | Errors | Rules |
|---|---|---|
| @proctira/api-gateway | 5 | no-redundant-type-constituents 5 |
| @proctira/backend-admin-dashboard | 1 | import/order 1 |
| @proctira/backend-assessment | 3 | import/order 2, no-unused-vars 1 |
| @proctira/backend-attendance | 2 | import/order 2 |
| @proctira/backend-auth | 2 | no-unused-vars 1, import/order 1 |
| @proctira/backend-billing | 3 | no-misused-promises 3 |
| @proctira/backend-custom-field | 8 | no-unused-vars 5, import/order 2, no-unnecessary-type-assertion 1 |
| @proctira/backend-developer-portal | 1 | import/order 1 |
| @proctira/backend-examination | 5 | import/order 3, import/no-duplicates 2 |
| @proctira/backend-institution | 7 | import/order 2, no-unused-vars 2, no-unnecessary-type-assertion 2, consistent-type-imports 1 |
| @proctira/backend-plugin | 12 | import/order 6, no-unused-vars 3, no-misused-promises 2, no-unnecessary-type-assertion 1 |
| @proctira/backend-policy | 4 | import/order 2, no-unused-vars 2 |
| @proctira/backend-privacy | 1 | import/order 1 |
| @proctira/backend-student | 2 | import/order 2 |
| @proctira/backend-survey | 1 | import/order 1 |
| @proctira/backend-theme | 1 | import/order 1 |
| @proctira/backend-workflow | 4 | import/order 2, no-unused-vars 2 |
| @proctira/auth | 1 | no-unused-vars 1 |
| @proctira/cdn | 2 | no-unused-vars 2 |
| @proctira/secrets | 3 | import/order 3 |
| @proctira/storage | 2 | import/order 2 |
| @proctira/ui-components | 17 | import/order 17 |
| @proctira/ui-dashboards | 18 | import/order 17, no-unsafe-member-access 1 |
| @proctira/plugin-sdk | 25 | no-unused-vars 13, import/order 10, no-misused-promises 1, restrict-template-expressions 1 |
| @proctira/default-theme | 1 | import/order 1 |
| @proctira/theme-sdk | 1 | no-unused-vars 1 |
| @proctira/install-cli | 1 | no-unused-vars 1 |

Main CI is green even though these lint tasks fail. The cause was not investigated (affected-only filtering is the likely reason). Treat this as an open question, not a finding.

## Open PRs and in-flight work

The baseline captured the state at 09:07. It was rechecked with `gh pr list --state open` during consolidation and nothing had changed.

| Item | State | Mergeable | Ledger relevance |
|---|---|---|---|
| #654 `fix/audit-institution-batch` | OPEN | CONFLICTING / DIRTY | Claims 22 institution rows, which were excluded from triage. PRC-M155 (app-web) cross-references PRC-M290 in this PR. |
| #633 `fix/audit-role-catalogue-d2` | OPEN | MERGEABLE / BEHIND | Claims 11 rbac/role rows, which were excluded from triage. |
| #652 `docs/reconcile-ledger-649` | MERGED 2026-10-25T08:50:19Z | n/a | Its merge commit is the baseline. It changed 17 ledger rows. None of the 17 is changed here (`work/pr-overlap.json`). |
| #630 `chore/canonical-gap-ledger` | OPEN | CONFLICTING / DIRTY | Adds CANONICAL_LEDGER.csv as a new file against an old base, so it touches every row. 112 rows differ from main, and 16 of those are changed here. |
| `fix/audit-parent-portal-batch` (no PR) | local only, `6c05bbec` 2026-10-22 | 6 ahead / 8 behind | Claims 11 parent-portal rows, which were excluded. PRC-L083's residual is in a parent-portal file. |
| Dependabot | 11 OPEN | #660 #656 #645 #644 #643 #642 #641 #640 #639 #638 #636 | No ledger impact |

Wave 1 batch branches were already created from this baseline while consolidation ran:

- `fix/app-web-batch1`: worktree created, no commits yet.
- `fix/platform-services-batch1`: plan written, no commits yet.
- `fix/ui-packages-batch1`: 2 commits, for PRC-L447 and PRC-L448.

`wave1-batch-plan.md` matches these branches.

## Tree hygiene

The turbo `^build` step rewrote 5 `next-env.d.ts` files during the baseline. They were restored with `git checkout --`. Before the consolidation commits, `git status --porcelain` showed only `M docs/audits/remediation/CANONICAL_LEDGER.csv` and the untracked run dir.
