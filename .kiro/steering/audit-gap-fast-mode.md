---
inclusion: always
name: audit-gap-fast-mode
description: Lighter, batched workflow for closing findings from docs/audits/gap-analysis/Proctira_Code_Audit_Gaps.xlsx. Narrows task-branch-pr-workflow for audit-gap batches only.
---

# Audit-gap fast mode

Applies only to closing PRC-* findings from `docs/audits/gap-analysis/Proctira_Code_Audit_Gaps.xlsx`. For these batches this rule narrows `task-branch-pr-workflow`; everything not listed here still follows that workflow.

## Scope stays fixed

- Fix only what the finding's Fix steps and Acceptance describe. No unrelated work.
- Skip findings whose Needs column is `decision`; list them for the owner.
- Schema/migration and infra findings go to their own batch branches for specialist review.
- Status is `FIXED`, `PARTIAL` (list unmet steps), `STALE` (evidence no longer matches code), `DUPLICATE` (name the twin) or `SKIPPED` (reason). Never claim closure beyond evidence.

## Triage before fixing

- Verify each finding's cited file/line against the current base before opening work. Close `STALE`/`DUPLICATE` findings in the batch ledger without a branch.

## Batching

- Group similar findings (same module or same bug class) into one batch of about 10 findings: one branch, one worktree, one PR against `main` (`fix/<module>-batchN`). Never one PR per finding.
- One commit per PRC id (`... (PRC-H054)`); findings fixed together cite every id.
- Up to 3 batches run in parallel. Run `~/bin/server-guard.sh` before heavy commands; stop starting work when it fails.

## Validation

- Failing-first proof (test fails without the source change) is required for security, tenancy, privacy, finance, and data-integrity findings. Others need a regression test that passes.
- Per finding: affected package tests, `tsc --noEmit`, and eslint + prettier on changed files.
- Full suites run once per wave merge into the aggregation branch, not per finding.

## Review and merge

- One independent `semantic_reviewer` pass per batch branch. Fix blocking findings on the same branch; record non-blocking comments as PR follow-ups instead of another review round.
- The batch PR body carries a ledger table: PRC id, status, one-line fix, residuals. Write it once when the batch is complete.
- Merging to `main` still needs required CI and human approval. Never self-merge to `main`.
