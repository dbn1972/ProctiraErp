# W1-OPS-09 COMPLETE — Atomic rollback + single-wave progressive baseline

**Module / slice:** Helm deploy / rollback (supported single-wave mode)  
**Branch:** `cursor/w1-ops-09-rollback-complete-56c3`  
**Tip SHA:** `34fa25227f7ff8ceb053ef872d7f23f8a81537a2`  
**Date (UTC):** 2026-09-14  
**Prior status:** PARTIAL — `#178` landed `--atomic` deploy, `rollback.yml`, and
canary annotation hooks without a COMPLETE evidence pack, runbook, or
fail-closed apply gate; progressive delivery left as an unbounded residual.  
**Skill gate:** enterprise-release-ops (Definition of Ship)  
**Paired check:** `tools/scripts/deploy-rollback-check.sh` (via `helm-template.yml`)

---

## Finding

Deployment had no atomic rollback or progressive-delivery contract: failed
releases could leave a half-applied Helm revision, and there was no automated
rollback sibling to `deploy.yml`.

## Done criteria

| Criterion | Status |
| --------- | ------ |
| Documented + automated rollback path atomic for supported deploy mode | **Met** — `deploy.yml` `--atomic --wait`; `rollback.yml` (`helm rollback` or `--atomic` tag redeploy); runbook `docs/runbooks/deploy-rollback.md` |
| Progressive delivery **or** explicit single-wave with rollback documented | **Met** — supported mode is **single-wave** RollingUpdate `maxUnavailable: 0`; canary annotations opt-in hooks only (`enabled: false` default) |
| Fail-closed gates where applicable | **Met** — rollback `dry_run` defaults `true`; apply requires `secrets.KUBECONFIG` (explicit fail); static check refuses missing atomic/single-wave/runbook invariants |
| COMPLETE audit with tip SHA + honest residuals | **Met** — this document (no invented prod canary proof) |

## Artifacts

| Artifact | Path | Notes |
| -------- | ---- | ----- |
| Deploy | `.github/workflows/deploy.yml` | `--atomic --wait` per service release |
| Rollback workflow | `.github/workflows/rollback.yml` | `workflow_dispatch`; dry-run default; KUBECONFIG gate on apply |
| Chart baseline | `infrastructure/helm/proctira-service/values.yaml` | RollingUpdate `maxUnavailable: 0`; canary off |
| Canary hook | `templates/deployment.yaml` | Annotations only when `progressiveDelivery.canary.enabled=true` |
| Static gate | `tools/scripts/deploy-rollback-check.sh` | No cluster; YAML + helm template asserts |
| Runbook | `docs/runbooks/deploy-rollback.md` | Operator + Actions path |
| Chart docs | `infrastructure/helm/proctira-service/README.md` | Single-wave honesty |

## Verify

```bash
./tools/scripts/deploy-rollback-check.sh
```

Expected: `deploy-rollback-check: PASS`

## Residuals (honesty)

| Residual | Status |
| -------- | ------ |
| Production / staging cluster rollback **exercise** (live `helm rollback`) | **Not proven** — tip gate is dry-run / template only; requires Environment `KUBECONFIG` |
| Flagger / Argo Rollouts / mesh canary traffic split in production | **Not proven** — annotations are hooks; no controller or AnalysisTemplate in-repo |
| Blue/green or multi-wave progressive delivery as a ship path | **Out of scope** — explicit single-wave is the supported mode |
| Database / migration rollback | **Separate** — `docs/runbooks/database-migration-rollback.md` |
| Slack notify soft-fail without webhook | **Accepted** — notification only |

**Do not claim** production canary proof or live DR rollback from this tip SHA alone.

## Sign-off

| Claim | Status |
| ----- | ------ |
| PARTIAL → COMPLETE | ☑ |
| Atomic rollback path for single-wave Helm deploy | ☑ |
| Progressive contract explicit (single-wave + opt-in hooks) | ☑ |
| Fail-closed dry-run / KUBECONFIG apply gate | ☑ |
| Prod canary / live rollback exercise | ☐ residual (documented) |

**Ops claim:** Closed for the supported single-wave Helm deploy mode with
documented automated rollback and fail-closed plan-only defaults. Not a
production canary certification.
