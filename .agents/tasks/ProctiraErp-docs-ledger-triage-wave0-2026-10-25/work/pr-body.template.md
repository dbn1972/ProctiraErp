## Summary

This PR closes Wave 0 of the audit-gap programme: it triages the ledger and changes nothing else. All 497 non-closed findings in `docs/audits/remediation/CANONICAL_LEDGER.csv` were triaged against tip `4c7fb8fe`. 44 of them are claimed by in-flight work and were excluded. Four parallel triage groups produced the proposals. A consolidation evidence gate checked them, and the accepted ones were applied to the CSV in one row-scoped scripted pass.

- 163 rows changed:
  - 11 STALE → FULLY_CLOSED
  - 4 DUPLICATE
  - 45 OPEN → PARTIAL
  - 103 PARTIAL rows got refreshed notes
- In each changed row only `disposition`, `latest_wave` (`wave0-triage-2026-10-25`) and `notes` changed. Every other line is byte-identical to the baseline (`work/csv-diff-check.json`, `all_pass: true`).
- Reports in `.agents/tasks/ProctiraErp-docs-ledger-triage-wave0-2026-10-25/`:
  - `baseline-assessment.md`
  - `defect-registry.md` (all 497 rows)
  - `deferred-approval-items.md`
  - `orphan-branches.md`
  - `wave1-batch-plan.md`
  - `evidence-manifest.json`
  - `work/*.json` (raw evidence)
- No application code, schema, infra, dependency, auth or test changes.

The source xlsx (`docs/audits/gap-analysis/Proctira_Code_Audit_Gaps.xlsx`) is not in the repo, its history or on the host. The orchestrator approved triaging on ledger data only: title, notes and evidence plus tip code. Fix steps, Acceptance and Needs were therefore unavailable, and the STALE bar was raised to "tip code resolves the title/notes exactly as stated, plus a passing test that was actually run".

Scope and non-goals: ledger triage and reporting only. No findings are fixed here. Wave 1 fixes run on their own batch branches (see `wave1-batch-plan.md`). `docs/audits/remediation/README.md` asks closers to put proof in the `evidence` column. This brief restricted edits to disposition, latest_wave and notes, so proof is recorded in `notes` using the established `Found already implemented at tip … disposition ALREADY_FIXED (STALE finding)` convention. The README status table (180/207/371) is stale and was not updated.

## Counts before → after (758 rows)

| Disposition | Before | After | Δ |
|---|---|---|---|
| OPEN | 291 | 241 | −50 |
| PARTIAL | 206 | 241 | +35 |
| FULLY_CLOSED | 260 | 271 | +11 |
| DUPLICATE | 1 | 5 | +4 |

Transitions:

| Transition | Rows |
|---|---|
| OPEN → FULLY_CLOSED | 5 |
| PARTIAL → FULLY_CLOSED | 6 |
| PARTIAL → DUPLICATE | 4 |
| OPEN → PARTIAL | 45 |
| PARTIAL → PARTIAL (notes only) | 103 |

STALE + DUPLICATE = 15 = rows moved to FULLY_CLOSED or DUPLICATE.

Triage results over the 497 rows:

| Result | Rows |
|---|---|
| STILL_OPEN | 288 |
| PARTIAL_CONFIRMED | 150 |
| CLAIMED | 44 |
| STALE | 11 |
| DUPLICATE | 4 |
| NOT_TRIAGED | 0 |

Claimed by in-flight work: 44 rows, all excluded from triage with no CSV change:

| Claimed by | Rows |
|---|---|
| PR #654 (institution) | 22 |
| `fix/audit-parent-portal-batch` | 11 |
| PR #633 (role catalogue) | 11 |

Rows still OPEN/PARTIAL, by eligibility:

| Eligibility | Rows |
|---|---|
| BLOCKED_FOR_APPROVAL | 155 |
| NEEDS_DECISION | 72 (the xlsx Needs column contributed 0 because the file is absent) |
| SCHEMA_BATCH | 58 |
| INFRA_BATCH | 41 |
| ELIGIBLE_LOW | 59 |
| ELIGIBLE_MEDIUM | 53 |

## Evidence gate (consolidation)

- **Completeness:** every group input row has exactly one triage entry (453 = 113 + 116 + 111 + 113). No row is NOT_TRIAGED.
- **STALE (14 proposed):**
  - Each proposal needed tip `file:line` evidence and a test with exit code 0 whose log exists. The medium rows M292, M382, M386, M549 and M211 were spot-opened at tip.
  - 11 were accepted. M292's production PG path (`pg-library-repository.ts:274-300`) honours `decrementAvailable` in code, but no PG test was run.
  - 3 were downgraded, with no CSV change:
    - PRC-L421 and PRC-L439 → STILL_OPEN / NEEDS_DECISION. The merged D6 PR #634 ledger table keeps both OPEN ("root cause is a live module/backend, not resolved by deletion"). For L421 the backend cross-board transfer surface is still at tip (`student/src/enrollment/enrollment-routes.ts:523`, `api-gateway/src/rbac-registry.ts:48`). The owner must reconcile.
    - PRC-M211 → PARTIAL_CONFIRMED / NEEDS_DECISION. Webhook fan-out is opt-in: `parseWebhookFanOutEvents` returns `[]` when `WEBHOOK_FANOUT_EVENTS` is unset (`developer-portal/src/webhook-event-fanout.ts:40`), so by default nothing creates deliveries. Migration 113 was not live-verified.
- **DUPLICATE (4):** the twins PRC-M132, L500, M381 and M543 all exist in the ledger and are PARTIAL, not DUPLICATE.
- **PRC-L563:** its PARTIAL_CONFIRMED notes refresh was **not written**. The row already has a CSV encoding anomaly (backslash-escaped quotes, which parse as 12 fields), and rewriting it would re-encode the line. It stays PARTIAL with its original bytes.

## Changed ledger rows (163)

__LEDGER_TABLE__

## Overlap with other ledger PRs

Edits are row-scoped: only changed lines differ, so conflicts are limited to the rows below.

- **#652 `docs/reconcile-ledger-649`:** MERGED, and its merge commit is this PR's base. It changed 17 rows (`triage-manifest.json` → `overlap_652`). Rows that this PR also changes: __OVERLAP_652__.
- **#630 `chore/canonical-gap-ledger`:** OPEN and CONFLICTING. It adds the CSV as a new file against an old base, so in raw diff terms it overlaps all __OVERLAP_630_ALL__ changed rows. Rows whose content actually differs between #630 and main (`overlap_630_effective_vs_main`, 112 rows) and that this PR also changes (__OVERLAP_630_N__): __OVERLAP_630__. If #630 is revived it must be rebased onto main after this PR, and these rows must be re-resolved.

## Baseline failures (pre-existing, not fixed)

Baseline at `4c7fb8fe`:

- typecheck: exit 0
- test: exit 0 (11,692 passed, 299 skipped, 0 failed)
- lint: **exit 1**. 27 packages fail with 133 errors, mostly `import/order` and `no-unused-vars`. The list is in `baseline-assessment.md`, and the log is `logs/baseline/lint.log` (gitignored).

These failures predate this PR. This PR changes no lintable source.

## Tests and verification evidence

- Triage targeted test runs: 39 distinct commands, all exit 0, every log present (`evidence-manifest.json` → `tests_run`). `~/bin/server-guard.sh` exited 0 before each run.
- `work/verify_ledger.py` (exit 0) checked:
  - 758 data rows
  - CRLF line endings and trailing newline kept
  - header and row order unchanged
  - changed ids == accepted proposals
  - only the 3 allowed columns differ, and their values equal the proposals
  - all other lines byte-identical to `4c7fb8fe`
  - before-counts match `ledger-before.json`
- `work/wave1_plan.py` (exit 0): the three Wave 1 file sets are pairwise disjoint.
- No test command ran during consolidation, because the change is limited to the ledger and docs.

Rollout and rollback: documentation only. Revert the ledger commit to roll back. No runtime, migration, API, event or tenant impact. Security/privacy impact: none (no code). Some PRC rows now read FULLY_CLOSED, and the evidence above backs each one.

## Not verified

- xlsx Fix steps / Acceptance / Needs, because the file is absent.
- Live/PG suites, because `DATABASE_URL`/`REDIS_URL` were unset. This covers:
  - the PG repository paths, including library `claimCopyForCheckout` (M292) and developer-portal migration 113 (M211)
  - the db rows from PR #650 (kept PARTIAL)
- Flutter/Dart tests (no toolchain), which affects the mobile rows and PRC-M254.
- Web/Flutter e2e, build-only gates and root `check:*` scripts.
- Why main CI is green while package lint fails at baseline.
- The Wave 1 expected file sets, which are planning estimates.

## Wave 1 (planned, separate PRs)

| Branch | Findings | Notes |
|---|---|---|
| `fix/app-web-batch1` | 12 | PRC-L255 salvaged from `fix/web-lows-L255` |
| `fix/ui-packages-batch1` | 2 | Only custom-field L447/L448 are eligible; every ui-* row needs a decision |
| `fix/platform-services-batch1` | 10 | etl, data-warehouse, notification, survey |

## Reviewer verdict

__REVIEW_VERDICT__
