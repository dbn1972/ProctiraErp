# W1-OPS-23 — Manual release same-SHA CI gate

**Finding:** `.github/workflows/release.yml` gated automatic releases on
`workflow_run` CI success, but `workflow_dispatch` **bypassed** that gate
(`if: workflow_dispatch || conclusion == success` with no same-SHA proof step).
Operators could build/push images for a SHA that never passed CI.

**Branch:** `cursor/aud-w1-ops-23-release-gate-56c3`  
**Date (UTC):** 2026-09-14  
**Skill gate:** enterprise-release-ops (Definition of Ship)

## Remediation

| Surface | Change |
| --- | --- |
| `release.yml` `ci-gate` | Manual path checks out `require-same-sha-ci.mjs` and fails closed unless proof exists for `github.sha` |
| Permissions | `actions: read` + `checks: read` so the gate can query workflow runs / check-runs |
| Script | `tools/scripts/require-same-sha-ci.mjs` — primary: successful `CI` `workflow_run`; fallback: `CI Aggregate` / verify-results check-run |
| Tests | `tools/scripts/require-same-sha-ci.test.mjs` |
| Docs | `.github/README.md` documents the non-bypass rule |

### Fail-closed cases

- No CI workflow_runs **and** no check-runs for the SHA → refuse
- CI runs only `failure` / `cancelled` / `in_progress` → refuse
- Lint-only green check-runs (no aggregate) → refuse
- GitHub API / token errors → refuse (do not soft-succeed)

### Unchanged

- `workflow_run` path still requires `github.event.workflow_run.conclusion == 'success'`
  before `ci-gate` runs (same-SHA by construction of the trigger).

## Evidence

```bash
node --test tools/scripts/require-same-sha-ci.test.mjs
rg -n "W1-OPS-23|require-same-sha-ci|bypasses this gate" .github/workflows/release.yml
```

Expected: tests pass; `bypasses this gate` comment **removed**; manual step present.

## Residual (honest)

| Residual | Status |
| --- | --- |
| `deploy.yml` may still soft-enter on `workflow_dispatch` without this script | **Out of scope** for W1-OPS-23 (release only; see W1-OPS-01 / deploy follow-ups) |
| Gate trusts GitHub Actions API honesty for the queried SHA | **Accepted** |
| Sparse checkout of the gate script uses the release ref; script must exist on that SHA after merge | **By design** — first merge lands the script on `main` |

## Sign-off

| Claim | Status |
| --- | --- |
| Manual release cannot bypass same-SHA CI | ☑ |
| Missing CI fails closed | ☑ |
| Ship claim for this finding | Ready (ops gate closed; tip CI on merge is parent ship gate) |
