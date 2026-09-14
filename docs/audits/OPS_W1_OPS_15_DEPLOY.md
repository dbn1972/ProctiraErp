# OPS — W1-OPS-15 deploy secrets fail-closed (no greenwash)

**Module / slice:** `.github/workflows/deploy.yml` production / staging deploy honesty  
**Branch / tip:** `cursor/aud-w1-ops-15-deploy-skip-56c3` @ `4c77d41b40bc0f88f697ecfb71bd2988b31b0a84`  
**Date (UTC):** 2026-09-14  
**Paired check:** `tools/scripts/deploy-secrets-gate-check.sh` (wired via `helm-template.yml`)

---

## Finding

The Deploy workflow could report **success** while silently skipping image
build/push and Helm deploy when `REGISTRY_USERNAME` / `REGISTRY_PASSWORD` were
absent. `prepare` set `can_deploy=false`, emitted a `::warning::`, and left
`matrix-prep` / `build-images` / `deploy` skipped — GitHub Actions treats an
all-skipped dependency chain as a green run. That greenwashed production
pushes to `main` (and staging soft-skips) as if a deploy happened.

## Scope (this PR)

| Artifact | Path | Notes |
| -------- | ---- | ----- |
| Workflow | `.github/workflows/deploy.yml` | Production: `exit 1` in prepare when secrets missing; staging: explicit `deploy-secrets-gate` fails aggregate |
| Static check | `tools/scripts/deploy-secrets-gate-check.sh` | Asserts fail-closed + gate + forbids greenwash warning |
| CI wire | `.github/workflows/helm-template.yml` | Runs the check alongside helm/rollback gates |
| Docs | `docs/audits/OPS_W1_OPS_15_DEPLOY.md` | This evidence pack |

## Invariants

1. **Production** missing registry secrets → prepare fails (`exit 1`); workflow is red.
2. **Staging** (or any env) with `can_deploy != true` after a successful prepare → `deploy-secrets-gate` exits 1 so the workflow cannot soft-succeed.
3. Soft `::warning::…skipping image build/push and deploy` alone is **forbidden**.
4. Empty affected-service lists remain a no-op for build matrix only; they do not excuse missing secrets on a triggered Deploy run.

## Apply / verify

```bash
./tools/scripts/deploy-secrets-gate-check.sh
# or via Helm Template workflow path filters on deploy.yml
```

## Non-goals / residuals (honesty)

| Residual | Status |
| -------- | ------ |
| `KUBECONFIG` / Helm cluster reachability still fail later inside `deploy` when secrets *are* present | **Accepted** — separate from silent skip greenwash |
| Slack notify soft-fails without `SLACK_WEBHOOK_URL` | **Out of scope** — notification only |
| Forks / repos without registry secrets will see red Deploy runs | **By design** — honest; configure secrets or do not expect green Deploy |

## Rollback

Revert this PR to restore the previous soft-skip warning path (not recommended).

## Sign-off

**Ops claim:** Closed — production fail-closed; staging explicit skip + aggregate fail; static check prevents regression.
