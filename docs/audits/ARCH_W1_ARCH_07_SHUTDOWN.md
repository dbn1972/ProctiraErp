# W1-ARCH-07 — Graceful shutdown for ETL / workers / bounded resources

**Finding:** Graceful shutdown remains incomplete, especially for ETL and
bounded resource closure. Medium, disposition **partial**.

**Branch:** `cursor/aud-w1-arch-07-shutdown-56c3`  
**Tip:** `05e45752f763e14394623e17d08934f9cf26f42f`
**Date (UTC):** 2026-09-14  
**Paired tests:** `graceful-shutdown.test.ts`, `close-database-resources.test.ts`,
`pipeline-scheduler.test.ts` (stopAndDrain), `server.shutdown.test.ts` (etl-worker)

---

## Remediation

Extended existing close helpers rather than inventing a parallel lifecycle framework.

### Shared coordinator — `@proctira/common`

`registerGracefulShutdown` / `runShutdownSteps`:

| Behavior | Detail |
| --- | --- |
| Signals | `SIGINT` + `SIGTERM` (injectable `processRef` for tests) |
| Order | Named steps run **sequentially** (HTTP → DB → tracing) |
| Timeout | `SHUTDOWN_TIMEOUT_MS` (default **15s**, clamp 1s–5m) |
| Second signal | Force `exit(1)` while first close is in flight |
| Step failure | Logged; remaining steps still run |

### Database close aggregation — `@proctira/database`

`closeDatabaseResources()` wraps existing helpers in order:

1. `disconnectPrisma()`
2. `disconnectReadReplica()`
3. `closeSharedPgPools()`

### ETL drain

`PipelineScheduler.stopAndDrain()` clears the interval and **awaits** an in-flight
tick before Fastify `onClose` returns. `etlPlugin` uses `stopAndDrain` so process
shutdown does not tear down pools mid-tick.

### Entrypoints wired

| Surface | Close order |
| --- | --- |
| `apps/api-gateway/src/server.ts` | `app.close()` (queues/timers via existing `onClose`) → DB → `shutdownTracing` |
| `apps/etl-worker/src/server.ts` | HTTP (scheduler drain) → DB → tracing |
| Backend `standalone-server.ts` (×9) | HTTP → DB |
| `workers/exam-document/src/main.ts` | `worker.stop()` (queue disconnect) → DB |

Fastify plugins already disconnect durable queue publishers / Redis rate-limit /
audit retention timers on `onClose`; those paths are invoked by the HTTP step.

---

## Evidence

| Check | Pass | Evidence |
| --- | --- | --- |
| Handlers register | ☑ | `graceful-shutdown.test.ts`, `etl-worker` `server.shutdown.test.ts` |
| Ordered close + mid-step failure continues | ☑ | `runShutdownSteps` unit cases |
| Timeout force path | ☑ | hang step rejects after budget |
| Second-signal force exit | ☑ | registration test |
| ETL tick drain | ☑ | `stopAndDrain waits for an in-flight tick` |
| DB close export | ☑ | `closeDatabaseResources` export + no-op when unused |

Local unit runs (this agent): `@proctira/common`, `@proctira/database`,
`@proctira/backend-etl`, `@proctira/etl-worker` — green for the suites above.

**Not claimed:** tip CI on the merge commit, live k8s SIGTERM soak, or production
pod termination traces.

---

## Residuals

1. **In-flight HTTP requests** rely on Fastify’s default `close()` behavior; no
   custom per-route drain budget beyond the process `SHUTDOWN_TIMEOUT_MS`.
2. **ETL pipeline executions started outside the scheduler tick** (API
   `execute`) are not cancelled on SIGTERM — only the scheduler tick is drained.
3. **Kafka / other brokers** outside queue-abstraction handles already hooked in
   gateway `onClose` are unchanged; residual if a package opens connections
   without an `onClose` hook.
4. **Next.js / Flutter / install-wizard** process exits were out of finding
   scope (backend ETL/workers/bounded resources).
5. **Production evidence** (cluster drain logs) not invented — unit/handler
   registration only.
