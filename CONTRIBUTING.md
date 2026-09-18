# Contributing to ProctiraERP

Thank you for contributing. This repository contains a multi-tenant education platform, so changes must protect tenant boundaries, child and guardian data, historical records, and operational reliability.

## Development prerequisites

The committed manifests are authoritative:

- Node.js 20 or later (`package.json` requires `>=20.0.0`; CI uses Node 20).
- pnpm 10.33.2 through Corepack (`packageManager` in `package.json`).
- Docker when a change requires PostgreSQL, Redis, containers, or integration services.
- Flutter stable with Dart `>=3.11.5 <4.0.0` for Flutter work (`pubspec.yaml` files require `^3.11.5`).

Set up the JavaScript workspace from the repository root:

```bash
corepack enable
corepack prepare pnpm@10.33.2 --activate
pnpm install --frozen-lockfile
```

Do not install workspace dependencies with a different package manager. Use pnpm workspace filters for focused commands.

## Protect data and credentials

Never put secrets, access tokens, production records, or real student, child, guardian, health, disability, counselling, custody, academic, staff, or financial data in issues, pull requests, screenshots, fixtures, logs, or test output. Use synthetic, non-identifying examples and redact metadata as well as visible values.

Report suspected vulnerabilities privately as described in [SECURITY.md](SECURITY.md). Do not open a public issue for a security or privacy concern.

## Branch and worktree policy

Every change uses one branch for one task or cohesive vertical stack with shared acceptance criteria.

1. Start from the repository's approved base branch: `main` by default, or `develop` only for an active release workflow that requires it. Use a release branch as a PR base only after its protections and CI coverage are verified.
2. Before switching or creating a branch, inspect the current branch, status, remotes, and divergence from the approved base. Never carry unrelated changes into the task branch.
3. If a worktree is dirty, do not stash, reset, clean, or move another contributor's work automatically. Ask the owner or create a separate worktree from the approved base.
4. Name the branch `<type>/<issue-or-scope>-<slug>`. Allowed types are `feat`, `fix`, `security`, `refactor`, `chore`, `docs`, `test`, `migration`, `hotfix`, and `dependabot`.
5. Never develop, commit, or push task work directly on `main`, `master`, `develop`, or `release/**`.
6. Keep commits focused. Exclude secrets, unrelated formatting, generated output, and another task's changes.

Examples: `feat/SIS-142-guardian-enrollment`, `security/tenant-report-scope`, `docs/GOV-contribution-policy`.

## Validation

Select checks based on affected behavior and risk. The root manifest currently provides:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

When applicable, also run the Definition of Done checks and the relevant tenant-isolation suite:

```bash
pnpm check:dod:strict
pnpm test:tenant-isolation
```

For Flutter projects, run dependency resolution, static analysis, and tests from each affected project directory. Record exact commands, results, behavior verified, failures, and intentionally skipped checks with a reason. An affected-only or path-skipped CI job is not evidence that an applicable gate passed.

Changes to authentication, authorization, tenant/RLS behavior, sensitive exports, queues, storage, payments, migrations, or infrastructure require focused negative and failure-path tests. At minimum, consider unauthenticated, wrong-role, wrong-tenant/institution, stale/replayed request, concurrency, rollback, and recovery cases as applicable.

## Pull requests

Open a pull request against the approved base; do not bypass hooks or required checks. Use the [pull request template](.github/pull_request_template.md) and provide:

- linked task, problem, intended outcome, scope, and non-goals;
- affected modules, actors, institutions, and tenants;
- security, privacy, authorization, and tenant-isolation impact;
- schema/data migration, compatibility, rollout, and rollback impact;
- API and event compatibility;
- automated commands plus manual, UI, and operational evidence;
- observability, deployment, support, and unresolved risk.

At least one qualified approval is required. Changes to owned paths also require code-owner review. Security/privacy, tenant/RLS, migration, finance, government/statutory, and infrastructure changes require the relevant qualified specialist or code owner. Resolve every review conversation and rerun affected validation after changes.

The repository owner selects and configures the merge strategy; contributors must not assume squash, merge-commit, or rebase. Do not merge until required checks have execution evidence, approvals are present, and conflicts and review comments are resolved.

## After merge

Before cleanup, verify that the PR is reported as merged, the intended commit is reachable from the approved base, and required post-merge or deployment checks succeeded. Then confirm there is no uncommitted work, unpushed commit, unresolved feedback, or unique commit absent from the merged base.

Update the primary worktree using the repository-approved fast-forward-safe method. Remove a dedicated clean worktree without force, delete the remote branch through the provider or normal Git command, and delete the local branch with `git branch -d`. Never use force deletion without explicit approval after reviewing unmerged commits.

A branch reference alone uses little disk. Meaningful cleanup comes from safely removing a verified-clean task worktree and its branch-local dependency, build, and cache artifacts—not from deleting unmerged work.
