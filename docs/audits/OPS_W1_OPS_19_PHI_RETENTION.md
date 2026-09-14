# OPS — W1-OPS-19 PHI-retention CronJob enforce (no silent dry-run)

**Module / slice:** Helm `dr.phiRetention` + `tools/scripts/phi-retention-job.mjs`  
**Branch / tip:** `cursor/aud-w1-ops-19-phi-retention-56c3`  
**Date (UTC):** 2026-09-14  
**Paired check:** `tools/scripts/helm-template-check.sh` + `node --test tools/scripts/__tests__/phi-retention-job.test.mjs`

---

## Finding

The PHI-retention CronJob defaulted to dry-run (`dr.phiRetention.apply: false` →
`RETENTION_DRY_RUN=1`) and the Node job also defaulted `RETENTION_DRY_RUN` to
`"1"` when unset. Production therefore scheduled retention that **never deleted**
expired PHI unless an operator remembered to flip `apply`.

## Scope (this PR)

| Artifact | Path | Notes |
| -------- | ---- | ----- |
| CronJob template | `infrastructure/helm/proctira-platform/templates/dr/phi-retention-cronjob.yaml` | Fail closed if `apply` not a bool; production requires `apply=true` |
| Base values | `…/values.yaml` | `apply: null` (refuse until overlay sets bool) |
| Production | `…/values-production.yaml` | `apply: true` → `RETENTION_DRY_RUN=0` |
| Staging / development | `…/values-staging.yaml`, `…/values-development.yaml` | `apply: false` → explicit `RETENTION_DRY_RUN=1` |
| Job script | `tools/scripts/phi-retention-job.mjs` | `resolveRetentionDryRun` — unset/invalid refuse |
| CI gate | `tools/scripts/helm-template-check.sh` | Staging dry-run + prod enforce + unset refuse |
| Docs | `docs/DATA_RETENTION.md`, `docs/BACKUP_RESTORE.md` | Honesty on required mode |
| Audit | `docs/audits/OPS_W1_OPS_19_PHI_RETENTION.md` | This evidence pack |

## Invariants

1. **Production** CronJob renders `RETENTION_DRY_RUN="0"` (enforces deletion).
2. **Sandbox** (staging/development) CronJob renders `RETENTION_DRY_RUN="1"` only via explicit `apply: false`.
3. **Unset** `dr.phiRetention.apply` (or non-bool) → `helm template` fails with `W1-OPS-19`.
4. **Production** with `apply=false` → `helm template` fails (no prod dry-run CronJob).
5. Job script refuses to run when `RETENTION_DRY_RUN` is unset or not `0`/`1`.

## Apply / verify

```bash
./tools/scripts/helm-template-check.sh
RETENTION_DRY_RUN=1 node --test tools/scripts/__tests__/phi-retention-job.test.mjs
```

## Non-goals / residuals (honesty)

| Residual | Status |
| -------- | ------ |
| Live cluster has not yet run an apply-mode deletion against production PHI | **Accepted** — manifests + CI gates closed; first prod Job after deploy is the operational proof |
| Minor-linked cutoff is documented but adult cutoff still drives count/delete SQL | **Pre-existing** — out of scope for W1-OPS-19 mode flip |
| Manual one-off dry-run in a production namespace requires a Job/env override, not the CronJob | **By design** |

## Rollback

Revert this PR to restore silent dry-run defaults (not recommended).

## Sign-off

| Claim | Status |
| ----- | ------ |
| Production CronJob does not default to dry-run | ☑ |
| Sandbox requires explicit `DRY_RUN=1` / `apply=false` | ☑ |
| Unset mode in prod values fails closed | ☑ |
| Script fails closed when `RETENTION_DRY_RUN` unset | ☑ |

**Ops claim:** Closed — production enforces deletion; sandbox dry-run is opt-in; unset refuse.
