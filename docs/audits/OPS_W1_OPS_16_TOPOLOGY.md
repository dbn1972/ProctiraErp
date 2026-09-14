# W1-OPS-16 — Canonical production topology

**Finding:** The repository advertised two conflicting production topologies:

1. **In-process gateway** — domain packages mount as Fastify plugins inside `apps/api-gateway` (compose root, mount matrix, architecture docs).
2. **Split-service** — standalone domain Deployments / compose services (`institution`, `student`, …) via `proctira-platform`, kustomize base, `docker-compose.services.yml`, and `deploy.yml` SERVICE_MAP entries that do not receive traffic when the gateway already supersedes their prefixes.

**Branch:** `cursor/aud-w1-ops-16-topology-56c3`

## Decision (canonical)

| Mode | Status | What runs |
| --- | --- | --- |
| **`in-process`** | **Canonical for production, staging, and root compose** | `api-gateway` (+ edge apps + `etl-worker`). Domains live under `/api/v1` via `domain-plugins.ts`. |
| **`split`** | **Non-prod / lab only** | Standalone `packages/backend/*` servers. Kept for experiments; must not be the default Helm/k8s/prod path. |

Canonical deployables (CI `deploy.yml` default / shared-package fan-out):

`api-gateway`, `web`, `registration-portal`, `etl-worker` (+ portals when those paths change).

Domain package changes redeploy **`api-gateway`**, not orphan `institution`/`student`/… releases.

## Remediation

| Surface | Change |
| --- | --- |
| Helm `proctira-platform` | `topology.mode: in-process`; all `*Service.enabled: false` by default and in production values |
| Kustomize | Domain services moved to `components/split-domain-services` (opt-in); production overlay stays canonical |
| Compose | Root `docker-compose.yml` = canonical; `docker-compose.services.yml` banner = NON-PROD |
| `deploy.yml` | Canonical SERVICE_MAP; split names only via explicit `workflow_dispatch` input |
| Gate | `tools/scripts/check-topology-canonical.sh` (+ Vitest) wired from `helm-template-check.sh` |

## Explicit non-goals

- Deleting standalone Dockerfiles, Helm templates, or lab compose (code kept, marked non-prod).
- Forcing a microservice cutover; that remains a future product decision.

## Evidence

- `docs/architecture/HIGH_LEVEL.md` — runtime honesty
- `docs/DEPLOYMENT_TOPOLOGY.md` — operator-facing map
- `infrastructure/helm/proctira-platform/values.yaml` — `topology.mode`
- `tools/scripts/check-topology-canonical.sh`

## Residual

Release matrix may still **build** split-domain images for lab use; production install must not enable them without an explicit topology override and operator acknowledgement.
