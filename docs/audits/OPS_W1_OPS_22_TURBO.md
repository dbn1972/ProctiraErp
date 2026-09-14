# W1-OPS-22 — Turbo filter against PR merge-base

**Finding:** CI used `pnpm turbo run … --filter='...[HEAD~1]'` after checking out the PR head with `fetch-depth: 2`. That only selects packages touched in the tip commit, so packages changed in earlier commits of a multi-commit PR were omitted from typecheck / unit / build / integration filters.

**Branch:** `cursor/aud-w1-ops-22-turbo-filter-56c3`

## Remediation

1. Resolve filter base as `merge-base(HEAD, github.event.pull_request.base.sha || origin/main)` via `tools/scripts/resolve-turbo-filter-base.mjs`.
2. Checkout PR head with `fetch-depth: 0`, fetch the PR base SHA (and `origin/main` fallback), then run turbo with `--filter='${{ steps.turbo.outputs.filter }}'`.
3. Regression tests assert the resolver prefers PR base → merge-base (not `HEAD~1`) and that `.github/workflows/ci.yml` no longer contains turbo `...[HEAD~1]` filters.

## Evidence

| Check | Command / artifact |
| --- | --- |
| Unit | `node --test tools/scripts/resolve-turbo-filter-base.test.mjs` |
| Workflow | typecheck, unit-test, build, integration-test jobs in `.github/workflows/ci.yml` |
| Docs | `.github/README.md` affected-module section |

## Residual (honest)

- **Lint tip-only file list** still diffs `HEAD~1` on purpose so touching a package config does not fail the PR on pre-existing ESLint debt elsewhere in that package.
- **pr-check** affected summary already used `...[origin/main]`; left as-is (equivalent three-dot semantics once `origin/main` is fetched).
- Deploy/release `git diff HEAD~1` for image/service selection is out of scope for this item.
