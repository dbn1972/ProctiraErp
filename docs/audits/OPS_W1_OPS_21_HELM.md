# W1-OPS-21 — Helm validation path filters for probe contracts

**Finding:** `Helm Template` CI only path-filtered chart / deploy / check-script
paths. Changing gateway, ETL worker, or web probe handlers (or Docker
`HEALTHCHECK` paths) could break the contract that
`tools/scripts/helm-template-check.sh` asserts without triggering helm
lint/template.

**Branch:** `cursor/aud-w1-ops-21-helm-paths-56c3`

## Remediation

### Path filters (`.github/workflows/helm-template.yml`)

`pull_request` and `push` (main) now also match:

| Surface | Paths |
| --- | --- |
| Gateway probes | `apps/api-gateway/src/plugins/health.ts`, `health.test.ts`, `Dockerfile` |
| ETL worker probes | `apps/etl-worker/src/server.ts`, `server.test.ts`, `Dockerfile` |
| Web probes | `apps/web/src/app/api/health/**`, `Dockerfile` |
| Image HEALTHCHECK | `infrastructure/docker/Dockerfile.{api-gateway,etl-worker,web,backend-service,nextjs-app}`, `Dockerfile.fastify-base`, `Dockerfile.web-base` |

Existing chart / k8s / deploy / rollback / check-script filters unchanged.

### Check script (`tools/scripts/helm-template-check.sh`)

- **App source:** fail if gateway / ETL route string literals for `/health`,
  `/health/live`, `/health/ready` (and web `api/health` GET) are removed.
- **Dockerfiles:** fail if HEALTHCHECK lines no longer reference the expected
  probe paths.
- **Platform render:** assert api-gateway Deployment probes `/health/live` +
  `/health/ready` (etl-worker assert from W1-OPS-02 retained).
- Thin `proctira-service` chart still asserts `/health` (Fastify) and
  `/api/health` (web).

## Evidence

```text
./tools/scripts/helm-template-check.sh
==> W1-OPS-21 app probe contract sources
OK app + Dockerfile probe contracts (W1-OPS-21)
OK proctira-api-gateway / proctira-web / proctira-student
OK production profile
OK etl-worker probe paths (W1-OPS-02 B4)
OK api-gateway platform probe paths (W1-OPS-21)
OK proctira-platform (2663 lines, 2 CronJobs)
helm-template-check: PASS
```

## Residual (honest)

- Does not parse TypeScript ASTs — string-literal / file-presence greps only.
- Satellite Next apps (`registration-portal`, etc.) share `/api/health` via
  Dockerfile.nextjs-app; per-app route files are not individually gated.
- Tip CI green on this SHA is proven only after the path-filtered
  `Helm Template` workflow runs on the PR (or workflow_dispatch).
- Live `helm upgrade` / cluster probe behaviour is out of scope.
