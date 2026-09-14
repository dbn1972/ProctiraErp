# W1-OPS-18 — Compose healthchecks for gateway, ETL worker, web

**Finding:** Root `docker-compose.yml` health-checked infra (Postgres, Redis, Kafka, RabbitMQ, MinIO) but not `api-gateway`, `etl-worker`, or `web`. Dependants used `condition: service_started`, so portals could start before upstream HTTP readiness.

**Branch:** `cursor/aud-w1-ops-18-compose-health-56c3`

## Remediation

### Production compose (`docker-compose.yml`)

| Service | Healthcheck | Probe |
| --- | --- | --- |
| `api-gateway` | `curl --fail` → `:3000/health/ready` | Readiness (DB/Redis fail-closed) |
| `etl-worker` | `curl --fail` → `:3010/health/ready` | Readiness (DB when configured) |
| `web` | `curl --fail` → `:3001/api/health` | App liveness/ready JSON |

`depends_on` → `condition: service_healthy` for:

- `web`, `registration-portal`, `admin-console`, `developer-portal` → `api-gateway`
- `public-website` → `api-gateway` **and** `web`

`etl-worker` has no compose dependants today; healthcheck still surfaces healthy/unhealthy in `docker compose ps`.

### Dev overlay (`docker-compose.dev.yml`)

Overlay replaces built images with `node:20-alpine` (no `curl`). Healthchecks override to Node 20 `fetch(...)` with `start_period: 180s` so cold `pnpm install` does not false-fail the gate. Base `depends_on: service_healthy` continues to apply when both files are merged.

## Residual (honest)

- Dockerfile `HEALTHCHECK` still probes `/health` (gateway) / `/health` (etl) / `/api/health` (web); compose uses readiness where available for dependant ordering.
- Kafka / Keycloak remain `service_started` (out of scope for this finding).
- Microservice file `infrastructure/docker/docker-compose.services.yml` unchanged (separate topology).
