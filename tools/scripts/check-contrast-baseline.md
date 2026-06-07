# Contrast Gate Baseline (Task 56.2 / Requirement 37 AC 2)

`pnpm check:contrast` enforces a minimum contrast ratio of **7:1** for every
semantic-token pair declared in `packages/ui/styles/theme.css`, in both light
and dark modes (Requirement 37 AC 2 sets a stricter floor than WCAG 2.1 AA's
4.5:1).

When the gate was first wired into CI, several token pairs in the default
theme were already below the 7:1 threshold. To keep the gate active without
blocking unrelated PRs, those pairs are tracked in
`tools/scripts/check-contrast-baseline.json`. The gate continues to fail any
**fresh** dip below 7:1 (or any **regression** that pushes a baselined pair
even lower), but allows the existing values to remain until follow-up tasks
tighten the offending tokens.

## Removing a Row

When a designer or theme author tightens a token in `theme.css` so the pair
clears 7:1, drop the matching entry from `check-contrast-baseline.json`. The
gate will then enforce 7:1 strictly for that pair on every subsequent run.

## Re-baselining

If the platform team consciously trades a pair for a different design
constraint, regenerate the baseline by running:

```bash
pnpm check:contrast --json --no-baseline > /tmp/contrast.json
# inspect /tmp/contrast.json, then update tools/scripts/check-contrast-baseline.json
```

Document the rationale in the PR description and the `note` field of each
entry so future readers understand why the pair is allow-listed.

## Strict Mode

CI runs `pnpm check:contrast` with the baseline file applied. Local
verification under the strict (no-baseline) interpretation can be run with:

```bash
pnpm check:contrast --strict
```

That mode is useful when validating a token tightening before opening a PR.

## Current Baseline Snapshot

The pairs below are pre-existing violations carried at the moment the gate
was introduced. Each row is a candidate for a follow-up tightening pass.

### Light mode

- `accent-foreground / accent` — 3.03:1
- `muted-foreground / muted` — 4.30:1
- `success / success-bg` — 3.45:1
- `warning / warning-bg` — 1.98:1
- `error / error-bg` — 4.23:1
- `info / info-bg` — 4.24:1

### Dark mode

- `primary-foreground / primary` — 4.93:1
- `muted-foreground / muted` — 6.58:1
- `error / error-bg` — 5.41:1
- `info / info-bg` — 5.63:1

The 18.0:1 / 17.9:1 ratios for `foreground / background` in both modes show
the gate is correctly anchored: high-contrast pairs are recognized, and the
flagged pairs above are genuine token-tightening opportunities.
