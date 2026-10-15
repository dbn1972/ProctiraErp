# @proctira/database

Shared Prisma schema/client and the shared node-pg pool (`getSharedPgPool`, `src/pg-pool.ts`).

## Operator note: shared pool query timeouts

Every pool returned by `getSharedPgPool()` applies three timeout caps. They are
resolved once per process from env by `resolvePgPoolConfig()`, so a value applies to
every shared-pool consumer in that process.

| Env var                    | Applied as                                   | Default | `0`      |
| -------------------------- | -------------------------------------------- | ------- | -------- |
| `PG_STATEMENT_TIMEOUT_MS`  | server `statement_timeout`                   | 30000   | disabled |
| `PG_QUERY_TIMEOUT_MS`      | node-pg client `query_timeout`               | 30000   | disabled |
| `PG_IDLE_IN_TX_TIMEOUT_MS` | server `idle_in_transaction_session_timeout` | 60000   | disabled |

- Accepted values: `0` (disabled; the role/database default applies) or 1000–600000 ms.
  Anything else (non-numeric, under 1000, over 600000) falls back to the default.
- A statement that exceeds the cap fails: server-side with SQLSTATE `57014`
  (`canceling statement due to statement timeout`), client-side with node-pg
  `Query read timeout`. An idle-in-transaction session is terminated (`25P03`).
- Set the client and server caps together. If only one is raised, the lower one
  still cuts the query off.

### Workloads that may need a higher cap

These consumers use the shared pool and can legitimately run statements longer
than 30s on large tenants:

| Workload                                 | Package                    | Process     |
| ---------------------------------------- | -------------------------- | ----------- |
| Report generation, catalogue, dashboards | `packages/backend/report`  | api-gateway |
| Privacy / DSAR erasure executor          | `packages/backend/privacy` | api-gateway |
| ETL pipelines                            | `packages/backend/etl`     | etl-worker  |

Symptoms of a cap that is too low: those jobs fail with `57014` or
`Query read timeout` in logs where they previously completed.

### Where to set it

No Helm values, overlay or env file sets these variables today, so every
deployment runs with the defaults above. To change them, add the variables to
the workload's `env:` map in `infrastructure/helm/proctira-platform/values-<env>.yaml`
(for example `etlWorker.env` or `apiGateway.env`; the deployment templates render
each key into the container env). Because report and privacy run inside the
api-gateway process, raising the cap there raises it for every gateway request.
Prefer a bounded value (for example `300000`) over `0`, and keep the
idle-in-transaction cap enabled.
