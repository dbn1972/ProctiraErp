# W1-OPS-24 COMPLETE

| Field | Value |
| --- | --- |
| Finding | W1-OPS-24 |
| Title | Reusable setup and observability-validation assets are disconnected from active workflows. |
| Status | **COMPLETE** (code Done-when met on `origin/main`) |
| Tip SHA |  (short ) |
| Closure mode | Audit pack after code review; no invented production evidence |

## Done-when evidence

- Reusable setup + observability validation asserts wired in active workflows
- Audit: `OPS_W1_OPS_24_REUSABLE.md`
- Prior merge: #222

## Honest residuals

- Some heavy CI jobs still inline setup (accepted)
- Tip Aggregate CI green not claimed

## Sign-off

PARTIAL → COMPLETE for repository Done-when on tip `7daf039d`. Tip CI Aggregate green is **not** claimed by this pack alone.

---

## Re-audit residual fix (2026-09-14)

Pinned re-audit noted the reusable-asset checker could sit outside the main
required CI graph. Tip now adds always-on job `reusable-ci-assets` to
`.github/workflows/ci.yml` and requires it from `ci-aggregate` via
`REUSABLE_CI_ASSETS_RESULT` so dead `reusable-setup.yml` / composite /
`validate-observability.mjs` callers fail closed on tip CI (not only actionlint).

```bash
node tools/scripts/assert-reusable-ci-assets.mjs
node --test tools/scripts/assert-reusable-ci-assets.test.mjs tools/scripts/ci-aggregate-gate.test.mjs
```

