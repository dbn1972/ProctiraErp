# W1-OPS-24 — Reusable setup + observability validation wired

## Finding

Reusable setup (`.github/workflows/reusable-setup.yml`) and observability validation
(`tools/scripts/validate-observability.mjs`) existed but were disconnected from
active workflows — easy to rot without failing CI.

## Closed

- Added composite `.github/actions/setup-node-pnpm` for in-job Node/pnpm setup
- `reusable-setup.yml` wraps that composite and smoke-checks the toolchain
- `actionlint.yml` **calls** `uses: ./.github/workflows/reusable-setup.yml` and
  runs `assert-reusable-ci-assets.mjs` (+ unit tests) whenever reusable paths change
- `observability-config.yml` runs `validate-observability.mjs` after composite setup
- `pr-check.yml` affected-summary uses the composite action
- `validate-observability.mjs` updated to current artefacts (`.tpl`, all alert files)
- Fail-closed gate: `pnpm check:reusable-ci-assets` fails if any asset loses callers

## Residual (honest)

- Most heavy CI jobs still inline pnpm/setup-node rather than the composite
  (cost/risk of a broad refactor); the call + assert gate prevents disconnection
- Composite cannot replace `workflow_call` filesystem isolation; that is why both
  the composite (in-job) and the reusable workflow (cross-workflow smoke) exist
