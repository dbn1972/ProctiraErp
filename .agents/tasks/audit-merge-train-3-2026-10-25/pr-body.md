## Summary

Merge train for the 2026-10-25 audit-gap closure (Wave 0 ledger triage + Wave 1 + Wave 2). It combines 10 independently reviewed PRs into one branch, so CI runs once and main takes a single squash merge. The repo allows squash merge only, and main has moved since the PRs opened.

| PR   | Branch                       | Head merged | Scope                                                          |
| ---- | ---------------------------- | ----------- | -------------------------------------------------------------- |
| #662 | docs/ledger-triage-wave0     | c9e1e5e9    | Wave 0 ledger triage (163 rows) + reports                      |
| #661 | fix/ui-packages-batch1       | 4ac37697    | custom-field (L447, L448)                                      |
| #663 | fix/platform-services-batch1 | dc756c34    | etl / data-warehouse / notification / survey                   |
| #664 | fix/app-web-batch1           | 82928a6e    | apps/web (incl. reopened L259)                                 |
| #665 | fix/tooling-shared-batch1    | 7bbd3682    | dod-checks / tooling                                           |
| #666 | fix/academics-batch1         | 3c58bebb    | lms / attendance / shared-database                             |
| #667 | fix/tooling-shared-batch2    | 4b073c7c    | shared cdn / migrations tooling / eslint plugin                |
| #668 | fix/school-ops-batch1        | c220f5cc    | plugin / report / workflow / registration / theme / plugin-sdk |
| #669 | fix/academics-batch2         | a8a0ba46    | assessment / timetable / gradebook / curriculum                |
| #670 | fix/school-ops-batch2        | 84032282    | transport / hostel / staff / student import                    |

Each source PR keeps its own ledger table, dispositions CSV (`docs/audits/remediation/*_DISPOSITIONS_2026-10-25.csv`), verification.md and an APPROVED independent `semantic_reviewer` verdict. Combined: about 44 FIXED, 28 PARTIAL, plus STALE/DUPLICATE closures from Wave 0. Everything that needs approval (auth/tenancy/RLS, schema, finance/statutory, contracts, infra, deps) stayed unfixed and is listed in `deferred-approval-items.md` and in each dispositions CSV.

## How it was built

- Base `origin/main` eee619c7. The 10 head SHAs above were merged with `git merge --no-ff`, with no rebase, so reviewed commits keep their SHAs.
- No two source PRs touch the same file (checked pairwise), and all 10 merges were conflict-free.
- #662's earlier conflict with #654 (`CANONICAL_LEDGER.csv`: #654 normalised CRLF→LF) was already resolved on #662 by a row-level 3-way merge. That merge kept #654's 21 rows and Wave 0's 163 rows; no row was changed on both sides.
- The integration diff vs main equals the union of the 10 PR diffs. No new code was written here.

## Local evidence on the train head (all exit 0)

- `pnpm install --frozen-lockfile`
- `pnpm turbo run typecheck --continue`: 136/136 tasks
- `pnpm turbo run test --continue --concurrency=4`: 137/137 tasks
- `pnpm run check:dod`: 31 errors, under the baseline of 32 (no regression)
- `pnpm run check:brand-strings`: 0 violations
- ESLint on the 203 changed code files, in batches of 25 like CI: 0 errors (warnings only)
- `prettier --check` on changed files: clean

## Not verified here

- Live-Postgres and integration suites, Playwright e2e, and the Tenant Isolation release gate. These run in CI on this PR.
- Mobile/device tests and production-like performance tests.

## Security / migration / API impact

- No schema migrations, dependency changes, CI/infra config changes or frozen-contract changes.
- Tenancy-adjacent edit needing code-owner sign-off: the `tools/dod-checks` platform-scope list sync in #668 (c220f5cc).
- The new 401 for a missing `sub` in transport (L392, #670) needs security-owner acknowledgement.

## Rollout / rollback

Squash-merge this PR. To roll back, revert the single squash commit. After merge, close the 10 source PRs as superseded by this one, then reconcile `CANONICAL_LEDGER.csv` from the dispositions CSVs in a follow-up.

## Known issue

Commits on the source branches are authored as `review <review@local>` because of the shared git config on the agent host. Please set the correct identity, or choose the squash commit author at merge time.
