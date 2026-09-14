# Deployment topology (W1-OPS-16)

## Canonical (production)

**In-process API gateway.** Domain logic from `packages/backend/*` is mounted inside `apps/api-gateway` under `/api/v1`. Do not run parallel standalone domain pods for those prefixes in production — the gateway already excludes them from the service-router proxy set.

```text
Clients → web / portals → api-gateway (in-process domains) → Postgres / Redis / S3
                         ↘ etl-worker
```

| Layer | Deployable | Chart / compose |
| --- | --- | --- |
| API | `api-gateway` | `proctira-service` (deploy.yml) or platform umbrella |
| UI | `web`, portals | same |
| Worker | `etl-worker` | same |
| Data | Postgres, Redis, object store | external / compose infra |

**Source of truth for mounts:** `docs/audits/GATEWAY_MOUNT_MATRIX.md`.

## Non-prod / lab (split-service)

Standalone domain services exist for experiments and future cutovers:

| Artifact | Role |
| --- | --- |
| `infrastructure/docker/docker-compose.services.yml` | Lab compose — **not** production |
| Helm `institutionService` … `reportService` | Rendered only when `*.enabled=true` (defaults **off**) |
| `infrastructure/k8s/components/split-domain-services` | Opt-in kustomize component |
| `Dockerfile.backend-service` | Builds lab images |

Enable split Helm mode only with an explicit override (example):

```bash
helm template proctira ./infrastructure/helm/proctira-platform \
  --set topology.mode=split \
  --set institutionService.enabled=true \
  # … other domain services as needed
```

## CI honesty

`tools/scripts/check-topology-canonical.sh` fails when production Helm values or the production kustomize overlay reintroduce enabled split-domain services as the default path.

`tools/scripts/check-replica-policy.sh` (W1-OPS-17) fails when production Helm / Kustomize drift below the HA floors in `infrastructure/ops/production-replica-policy.yaml` (min replicas + PDB coherence).
