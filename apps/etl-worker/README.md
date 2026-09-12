# ETL Worker

Standalone Fastify process that hosts `@proctira/backend-etl` (pipeline API + execution).

## Health probes

Deploy manifests (`infrastructure/k8s/base/etl-worker`, Helm `etlWorker`) probe:

| Path            | Purpose                           |
| --------------- | --------------------------------- |
| `/health/live`  | Liveness                          |
| `/health/ready` | Readiness (+ `persistence` field) |
| `/health`       | Legacy combined check (compat)    |

## Persistence

| Env                   | Behavior                                                                                                                                                              |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL` set    | Postgres document store (`etl_pipelines` / `etl_pipeline_runs`, SQL 046). Boot **fails closed** if the shared PG pool cannot be constructed — never silent in-memory. |
| `DATABASE_URL` unset  | In-memory repository for **local / unit tests only**. Emits a one-shot warning.                                                                                       |
| `REQUIRE_DATABASE=1`  | Forbid in-memory even when URL unset.                                                                                                                                 |
| `NODE_ENV=production` | In-memory forbidden unless `ALLOW_IN_MEMORY_IN_PRODUCTION=1` (emergency only).                                                                                        |

Compose / k8s always supply `DATABASE_URL` for deployed ETL.
