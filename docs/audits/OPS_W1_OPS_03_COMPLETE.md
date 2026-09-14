# OPS — W1-OPS-03 COMPLETE (gateway readiness fail-closed)

**Module / slice:** `apps/api-gateway` `GET /health`, `/health/live`, `/health/ready`  
**Branch / tip:** `cursor/w1-ops-03-readiness-complete-56c3` @ `8ba3883611ff9dc13a8cf0b38a49b83c12ec8d73`  
**Date (UTC):** 2026-09-14  
**Skill gate:** enterprise-release-ops (Definition of Ship — ops honesty)  
**Prior status:** PARTIAL (`#101` DB probe; Redis residual closed by W3-C1 `#171`; combined `/health` still HTTP 200 when unready)  
**This status:** **COMPLETE**

## Finding (closed)

Gateway readiness always returned **200** and reported downstream dependencies as **`unknown`** (no real probes). Orchestrators and Dockerfile `HEALTHCHECK` (`curl --fail /health`) could mark the process healthy while Postgres/Redis were down or never probed.

## Remediation

| Surface | Behaviour |
| --- | --- |
| `GET /health/ready` | Probes Postgres when `DATABASE_URL` set (or required in production / `REQUIRE_DATABASE=1`) and Redis when `REDIS_URL` set; **503** when any critical configured dep fails |
| `GET /health` | Same readiness probe; **503** when unready (so image HEALTHCHECK fail-closes); body includes `checks.readiness.details.{database,redis}` |
| `GET /health/live` | Cheap process-up only — **no** dependency probes |
| Dependency statuses | `up` / `down` / `in-memory` / `required-missing` / `not-configured` — **never** `unknown` |
| Production | `DATABASE_URL` required (W1-SEC-12); `ALLOW_IN_MEMORY_IN_PRODUCTION` does not greenwash readiness |
| Prior merges | `#101` (W1-OPS-03 DB), `#171` (W3-C1 Redis) |

### This branch delta

- Combined `GET /health` returns **503** when readiness is down (aligns Dockerfile HEALTHCHECK with `/health/ready` fail-closed).
- Unit coverage for healthy HTTP paths (DB+Redis `up` → 200) and unhealthy `/health` → 503.

## Evidence

```bash
pnpm --filter @proctira/api-gateway exec vitest run src/plugins/health.test.ts src/app.test.ts
```

| Case | Result |
| --- | --- |
| In-memory / Redis not-configured → 200, no `unknown` | Pass |
| DB probe fail → `/health/ready` 503 `database:down` | Pass |
| Redis probe fail → `/health/ready` 503 `redis:down` | Pass |
| Both probes succeed → `/health/ready` 200 `up`/`up` | Pass |
| DB down → `/health` 503 `unhealthy` | Pass |
| Probes succeed → `/health` 200 `healthy` | Pass |
| `/health/live` does not call probes | Pass |
| Production missing `DATABASE_URL` / SEC-12 escape | Pass |
| `app.test.ts` readiness assertion (no `unknown`) | Pass |

## Tip SHA

```
8ba3883611ff9dc13a8cf0b38a49b83c12ec8d73
```

Prior remediation: `929a674b` (#101), `83f75d21` (#171).

## Residuals (honest)

| Residual | Status |
| --- | --- |
| Kafka / RabbitMQ / MinIO / Keycloak not probed by gateway readiness | **Accepted** — critical path is Postgres (+ Redis when configured); other infra is compose/k8s service health |
| Shared `@proctira/database` `runReadinessProbe` is DB-only (no Redis); gateway keeps its own Redis-aware probe | **Accepted** — ETL/worker use shared helper; gateway is the Redis consumer for rate-limit/idempotency |
| Live Postgres/Redis probe against a real cluster in tip CI | **Not claimed** — unit injects probe doubles; default probes use `pg`/`ioredis` with timeout |
| Standalone domain `/ready` pods (split topology) | **Out of scope** — canonical prod is in-process gateway (see W1-OPS-16) |
| Tip CI green on merge / main follow-up | **Not claimed here** — verify after merge |

## Rollback

Revert this tip (and retain `#101`/`#171` behaviour if only the `/health` 503 delta is unwanted). Reverting past `#101` re-opens always-200 + `unknown` greenwash.

## Sign-off

**Ops claim:** W1-OPS-03 PARTIAL → **COMPLETE** with documented residuals. Ready for PR review; ship only after tip CI SUCCESS on the merge commit.
