# DEV — Durable workers spine (P0-06)

**Capability / module:** Platform · durable background workers  
**Branch / tip:** `cursor/durable-workers-spine-56c3`  
**Date (UTC):** 2026-09-12  
**Peer parity target:** At least one domain publishes jobs to a durable queue and a worker can complete them after a crash/restart  
**Paired gap:** `docs/plans/TASKS_ENTERPRISE_P0_P1_P2_GAPS.md` · **P0-06** (this file is the DEV audit — do not edit the TASKS plan from this slice)

---

## 0. Product contract

| Item                 | Content                                                                                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Capability statement | Examination document generation jobs can be published via `@proctira/queue-abstraction` and processed by `workers/exam-document`, surviving consumer restart before ack. |
| Primary domain       | **Exam document generation** (admit cards / seating / certificates)                                                                                                      |
| In scope             | QueueDocumentTaskQueue bridge, InMemoryDurableQueueAdapter (restart proof), RabbitMQ-backed env wiring, exam-document worker entrypoint, gateway optional publisher      |
| Explicit non-goals   | Full multi-domain worker fleet; ETL persistence/probes (**P0-10**); report schedule durable tick (**residual**); notification delivery queue; workflow escalations       |
| Roles                | Platform/SRE (run worker + broker); exam ops staff (request generation via API)                                                                                          |

| Surface                        | Route / process                                    | Queue                                     | Tables / stores     |
| ------------------------------ | -------------------------------------------------- | ----------------------------------------- | ------------------- |
| API publish                    | `POST /examinations/:id/documents/generate`        | `tenant.{id}.exam.document.generate`      | document jobs       |
| Worker                         | `workers/exam-document` (`pnpm --filter … start`)  | consume `tenant.*.exam.document.generate` | same job rows + PDF |
| Restart-safe proof (no broker) | vitest in queue-abstraction + exam-document-worker | `InMemoryDurableQueueStore`               | in-memory job repos |

---

## 1–3 Build status

| Check                                                      | Done | Evidence                                                                                |
| ---------------------------------------------------------- | ---- | --------------------------------------------------------------------------------------- |
| Durable in-memory adapter (ack + reclaim on disconnect)    | ☑    | `packages/shared/queue-abstraction/src/adapters/in-memory-durable-adapter.ts`           |
| Adapter unit restart proof                                 | ☑    | `packages/shared/queue-abstraction/src/__tests__/in-memory-durable.test.ts`             |
| `QueueDocumentTaskQueue` implements `DocumentTaskQueue`    | ☑    | `packages/backend/examination/src/queue-document-task-queue.ts`                         |
| Env factory for gateway (`QUEUE_BACKEND` / `RABBITMQ_URL`) | ☑    | `packages/backend/examination/src/document-task-queue-factory.ts` + `domain-plugins.ts` |
| Worker package entrypoint                                  | ☑    | `workers/exam-document/` (`createExamDocumentWorker`, `src/main.ts`)                    |
| Worker + service restart-safe integration proof            | ☑    | `workers/exam-document/src/__tests__/restart-safe.test.ts`                              |
| RabbitMQ already in compose                                | ☑    | `docker-compose.yml` `rabbitmq` service — live path when env set                        |
| Workspace includes `workers/*`                             | ☑    | `pnpm-workspace.yaml`                                                                   |

---

## 4. How restart-safe proof works

1. Publisher and workers share an `InMemoryDurableQueueStore` (stand-in for RabbitMQ durability).
2. First worker leases the message and hangs mid-`processJob` (message is **in-flight**, not acked).
3. `worker.stop()` → adapter `disconnect()` **reclaims** in-flight → pending (crash semantics).
4. Second worker starts on the same store, redelivers, and `DocumentGenerationService.processJob` completes the job.

Live ops: set `QUEUE_BACKEND=rabbitmq` + `RABBITMQ_URL` / `RABBITMQ_EXCHANGE`; run gateway (publisher) and `pnpm --filter @proctira/exam-document-worker start` (consumer). Unacked messages redeliver after process death.

---

## 5. Dated NON-GOAL residuals (other P0-06 domains)

| Domain                        | Status (2026-09-12)                          | Notes                                                                                                       |
| ----------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Report schedule ticks         | **NON-GOAL** this slice                      | Still in-process `setTimeout` in `packages/backend/report/src/scheduler.ts` — promote via P1-WF / follow-up |
| Notification delivery queue   | **NON-GOAL** this slice                      | Optional `queuePublisher` remains; no dedicated worker entrypoint yet                                       |
| Workflow escalations          | **NON-GOAL** this slice                      | Tied to **P1-WF**                                                                                           |
| ETL worker persistence/probes | **NON-GOAL** this slice — owned by **P0-10** | Do not conflict; `apps/etl-worker` left unchanged                                                           |
| Attendance bulk consumer      | Residual                                     | Producer exists; competing consumer worker not part of P0-06 primary                                        |

---

## 6. How to verify

```bash
pnpm --filter @proctira/queue-abstraction test -- src/__tests__/in-memory-durable.test.ts
pnpm --filter @proctira/exam-document-worker test
```
