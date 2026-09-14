# W1-OPS-17 — Production replica / PDB coherence

**Finding:** Replica policy diverged between Helm charts, production values, and
Kustomize overlays. Production could silently run single-replica for HA-required
services (`etl-worker`, `developer-portal`) depending on deploy path, and PDBs
did not cover all canonical services.

**Severity:** Medium (confirmed)  
**Branch:** `cursor/aud-w1-ops-17-replicas-56c3`

## Canonical policy

Source of truth: `infrastructure/ops/production-replica-policy.yaml`

| Service | replicas | HPA min–max | PDB minAvailable |
| --- | ---: | --- | ---: |
| api-gateway | 3 | 3–20 | 2 |
| web | 3 | 3–15 | 2 |
| etl-worker | 2 | 2–10 | 1 |
| registration-portal | 2 | 2–8 | 1 |
| public-website | 2 | 2–6 | 1 |
| admin-console | 2 | (static) | 1 |
| developer-portal | 2 | (static) | 1 |

Rules:

1. Production never runs HA services at replica count 1.
2. When HPA is enabled, `minReplicas ≥ replicas` (cannot scale below the HA floor).
3. `PDB.minAvailable ≥ 1` and `minAvailable < replicas` (voluntary disruption remains possible).
4. Thin chart (`proctira-service` / `deploy.yml`) may **exceed** floors with a uniform profile (`replicaCount: 3`).

## Remediation

| Surface | Change |
| --- | --- |
| Policy | Added `infrastructure/ops/production-replica-policy.yaml` |
| Kustomize production | Explicit replica + HPA patches for all HA services; PDBs for all seven |
| Kustomize base | `etl-worker` / `developer-portal` floor → 2; HPA for registration + public |
| Helm platform values | Production PDB blocks for all HA services; default floors for etl/developer → 2 |
| Helm platform templates | PDB (+ HPA where enabled) for etl, registration, public, admin, developer |
| Thin chart | Documented W1-OPS-17 floor; retains uniform `replicaCount: 3` (≥ policy) |
| CI gate | `tools/scripts/check-replica-policy.sh` wired from `helm-template-check.sh` |

## Evidence

```text
./tools/scripts/check-replica-policy.sh
check-replica-policy: W1-OPS-17 OK

./tools/scripts/helm-template-check.sh
# … includes W1-OPS-17 replica policy gate + ≥7 production PDBs
```

## Residual (honest)

- Thin chart still uses one `values-production.yaml` for all releases (uniform 3 replicas), which **exceeds** policy floors for portals/ETL rather than matching them exactly.
- Staging / development may still intentionally run single-replica (explicit overlays / values).
- Live cluster drift after manual `kubectl scale` is not detected by the static gate.
- Tip CI green is proven only after the path-filtered `Helm Template` workflow runs on this tip.
