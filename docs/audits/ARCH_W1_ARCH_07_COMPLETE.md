# Architecture — W1-ARCH-07 COMPLETE (graceful shutdown)

**Module / slice:** process SIGTERM/SIGINT drain for gateway · ETL worker · backend standalones · exam-document worker · shared DB/pool close  
**Branch / tip:** `cursor/w1-arch-07-shutdown-complete-56c3` @ `00f3b10e9e9feec0d04fdfe95c94d36ea60ccc32` (implementation; docs tip follows)  
**Date (UTC):** 2026-09-14  
**Paired finding:** W1-ARCH-07 (medium) PARTIAL → COMPLETE  
**Prior evidence:** PR #237 · `docs/audits/ARCH_W1_ARCH_07_SHUTDOWN.md` @ `05e45752f763e14394623e17d08934f9cf26f42f`

---

## 0. Inventory

| Surface | Drain / refuse | Bounded close | Notes |
| ------- | -------------- | ------------- | ----- |
| `apps/api-gateway` | `registerGracefulShutdown` → `app.close()` (Fastify stops listen + waits in-flight; `return503OnClosing`) | `closeDatabaseResources` → tracing | ETL mounted; plugin `onClose` runs execute drain |
| `apps/etl-worker` | same HTTP step + ETL `stopAcceptingAndDrain` | DB → tracing | Scheduler tick + HTTP `/execute` |
| Backend `standalone-server.ts` (×9) | HTTP → DB | pools via `closeDatabaseResources` | Existing #237 wiring |
| `workers/exam-document` | `worker.stop()` then DB | queue disconnect + pools | Existing #237 wiring |
| `@proctira/common` | ordered steps + timeout + second-signal force exit | n/a | `SHUTDOWN_TIMEOUT_MS` (default 15s) |
| `@proctira/database` | n/a | Prisma + replica + shared pg pools | `closeDatabaseResources()` |

---

## 1. Controls

| Check | Pass | Evidence |
| ----- | ---- | -------- |
| SIGTERM/SIGINT register + ordered close | ☑ | `graceful-shutdown.test.ts`, `etl-worker` `server.shutdown.test.ts` |
| Scheduler tick drain | ☑ | `pipeline-scheduler.test.ts` — `stopAndDrain waits for an in-flight tick` |
| HTTP `/execute` in-flight drain | ☑ | `etl-service.test.ts` — `drains an in-flight /execute and refuses new work` |
| Refuse new execute after shutdown gate | ☑ | same + `routes.test.ts` — POST execute → **503** `SERVICE_UNAVAILABLE` |
| Refuse scheduled `executePipelineWithRetry` after gate | ☑ | `etl-service.test.ts` |
| DB/pool aggregation close | ☑ | `close-database-resources.test.ts` |
| Plugin wires drain on Fastify `onClose` | ☑ | `etl-plugin.ts` → `stopAcceptingAndDrain()` |

Local unit runs (this agent): `@proctira/backend-etl`, `@proctira/common`, `@proctira/database`, `@proctira/etl-worker` — green for suites above.

---

## 2. Findings closed

| ID | Was | Fix |
| --- | --- | --- |
| W1-ARCH-07 residual #2 | API `POST …/execute` not part of scheduler-only drain | `ETLService.withExecutionGate` + `stopAcceptingAndDrain()` refuses new work and awaits in-flight API/scheduled runs before tick drain / DB close |
| W1-ARCH-07 (PARTIAL) | Medium disposition after #237 | Disposition **COMPLETE** with honest residuals below |

---

## 3. Residuals (honest)

| ID | Sev | Finding | Waiver |
| --- | --- | ------- | ------ |
| residual | P2 | Generic in-flight HTTP (non-execute) uses Fastify default `close()` + process `SHUTDOWN_TIMEOUT_MS`; no per-route custom drain budget | Accepted — process wall-clock still bounds `app.close()` |
| residual | P2 | Brokers/clients opened outside hooked `onClose` paths remain owner-package responsibility | Accepted — no invented Kafka drain |
| residual | P2 | Next.js / Flutter / install-wizard process exits out of finding scope | Accepted (same as PARTIAL) |
| residual | — | **No production / live k8s SIGTERM soak** invented | Unit/handler harness only |

---

## 4. Sign-off

| Claim | Status |
| ----- | ------ |
| Done-when: SIGTERM drains in-flight gateway/ETL/workers and refuses new work | ☑ (harness) |
| Done-when: bounded resources (pools/timers) close | ☑ |
| Done-when: tests prove drain behavior | ☑ |
| Tip CI / prod SIGTERM proof | ☐ not claimed |

**Residual risks:** Cluster termination traces and tip CI on the merge commit are not part of this COMPLETE package. Generic HTTP beyond ETL execute remains Fastify-default under the process shutdown budget.
