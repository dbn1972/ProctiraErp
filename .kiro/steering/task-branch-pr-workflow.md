---
inclusion: always
name: task-branch-pr-workflow
description: Mandatory branch isolation, pull request, review, merge, and post-merge cleanup workflow for every ProctiraErp change-producing task.
---

# Task branch, PR, review, merge, and cleanup workflow

Apply this workflow to every task that changes code, configuration, schemas, infrastructure, documentation, Kiro assets, or tests.

## 1. Isolate the work

- Use one branch for one task or one cohesive vertical stack that shares acceptance criteria and will be reviewed and released together. Split independent concerns into separate branches and PRs.
- Start from the repository's approved base branch: `main` by default, or `develop` only when the active release workflow requires it. Use a release branch as a PR base only after verifying that pull-request CI triggers, required checks, and branch protection cover that release pattern.
- Before creating or switching branches, inspect the current branch, worktree status, remotes, and base divergence. Never carry unrelated local changes into the task branch.
- If the current worktree is dirty, do not automatically stash, reset, clean, or move another user's work. Ask for a decision or create a separate worktree from the approved base.
- Use a short branch name: `<type>/<issue-or-scope>-<slug>`, where type is `feat`, `fix`, `security`, `refactor`, `chore`, `docs`, `test`, `migration`, or `hotfix`. Examples: `feat/SIS-142-guardian-enrollment`, `security/tenant-report-scope`, `docs/branch-pr-workflow`.
- Never develop, commit, or push task changes directly on `main`, `master`, `develop`, or a release branch.

## 2. Develop and validate on the branch

- Keep changes within the branch's declared scope. Open a separate branch if an unrelated defect or improvement is discovered.
- Make focused commits with messages that explain intent. Do not mix generated artifacts, unrelated formatting, secrets, or another task's changes.
- Rebase or merge the latest approved base according to repository policy before final validation; never rewrite shared history without explicit approval.
- Run risk-appropriate targeted checks during development and every applicable full CI/release gate before merge. A path-filtered or skipped job is not passing evidence: verify whether it applies and run/document the equivalent check when CI did not execute it.
- Record commands, behavior verified, failures, skipped checks and why they are inapplicable, migrations, and environment-dependent evidence.

## 3. Open the pull request

- Push the branch with upstream tracking and open a PR against the approved base. Never bypass hooks or required checks.
- The PR must state: problem/outcome, scope and non-goals, linked task, affected modules/actors/tenants, security/privacy and migration impact, API/event compatibility, tests and manual evidence, UI evidence when applicable, rollout/rollback, operational impact, and unresolved risks.
- Keep the PR reviewable. Split broad unrelated changes rather than hiding them in one large PR.

## 4. Review and merge

- Do not merge until required CI checks pass, every applicable gate has execution evidence rather than an unexplained skip, conflicts are resolved, review comments are closed, and at least one qualified reviewer approves.
- Require the relevant specialist or code owner for security/privacy, tenant/RLS, data migration, finance, government/statutory, infrastructure, or other high-risk changes.
- Address review feedback on the same task branch and rerun affected validation. Do not bypass review with a direct base-branch push.
- Use the repository-approved merge strategy. If no strategy is configured, ask the repository owner rather than assuming squash, merge-commit, or rebase.
- After merge, verify the PR reports `merged`, the intended commit is reachable from the base branch, and required post-merge/deployment checks succeeded before cleanup.

## 5. Clean up only after verified merge

1. Confirm the task branch has no uncommitted work, unpushed commits, unresolved review changes, or unique commits absent from the merged base.
2. Switch the primary worktree to the base branch and update it using the repository-approved fast-forward-safe method.
3. If a dedicated task worktree was used, confirm it is clean and points to the merged branch, leave that worktree, remove it without force, and verify no worktree still has the task branch checked out.
4. Delete the remote task branch through the PR provider's delete action or `git push origin --delete <branch>`.
5. Delete the local branch with `git branch -d <branch>`; do not use `-D` unless the user explicitly approves after reviewing unmerged commits.
6. Prune stale worktree and remote-tracking references, then remove only branch-specific generated output or caches after confirming they contain no source or evidence that must be retained.

Deleting a Git branch reference saves little disk by itself. The meaningful disk cleanup is removal of the verified-clean branch worktree and its branch-local dependency/build/cache artifacts. Never delete an unmerged branch merely to save space.

Emergency fixes still use a hotfix branch and PR. Any authorized emergency bypass must be explicit, minimal, audited, followed by retrospective review, and reconciled back into the normal base branch.
