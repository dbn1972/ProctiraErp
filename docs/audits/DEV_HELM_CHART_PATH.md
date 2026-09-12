# DEV note — P0-12 Helm chart path / deploy refs

**Date (UTC):** 2026-09-12  
**Branch:** `cursor/helm-chart-path-56c3`  
**Related:** G-501 (rename + `helm-template.yml`), G-724 (service hardening), G-707 (DR CronJobs)

## Verdict

**P0-12 closed for tip path-alignment.** Deploy and CI reference charts that exist in-repo; `helm template` dry-run passes locally via `tools/scripts/helm-template-check.sh` (same script invoked by `.github/workflows/helm-template.yml`).

| Check                                                            | Result                                                                  |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `deploy.yml` chart path `./infrastructure/helm/proctira-service` | Present (`Chart.yaml` + `values-{development,staging,production}.yaml`) |
| Umbrella `./infrastructure/helm/proctira-platform`               | Present; used by DR / restore-drill path filters                        |
| Legacy `infrastructure/helm/openemis-platform`                   | Absent (historical only; G-501 renamed)                                 |
| Spurious `infrastructure/helm/proctira/` (no suffix)             | Absent — not a deploy target                                            |
| `./tools/scripts/helm-template-check.sh`                         | PASS (lint + template + probe/HPA/ESO/DR asserts)                       |
| Secrets in chart/CI                                              | None — placeholders only (`ci-placeholder`, `ci-store`)                 |

## Evidence (agent run)

```text
./tools/scripts/helm-template-check.sh
==> lint ./infrastructure/helm/proctira-service
OK proctira-api-gateway / proctira-web / proctira-student
OK production profile
OK proctira-platform (… lines, ≥2 CronJobs)
helm-template-check: PASS
```

## Honesty / residuals

- **Not claimed:** live `helm upgrade` against a real cluster, External Secrets Operator store wiring, or tip CI green on this SHA until the path-filtered `Helm Template` workflow runs on the PR.
- **Path filter:** `helm-template.yml` runs when helm charts, deploy.yml, or `helm-template-check.sh` change — not on every tip PR. Local script is the always-available equivalent.
- **Umbrella vs thin chart:** production deploy uses per-service `proctira-service`; `proctira-platform` remains the umbrella (incl. DR CronJobs). Both must stay renderable.
- **Do not edit** `docs/plans/TASKS_ENTERPRISE_P0_P1_P2_GAPS.md` in this slice — parent marks OPEN→DONE.
