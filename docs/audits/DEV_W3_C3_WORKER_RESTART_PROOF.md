# DEV — W3-C3 Worker / consumer restart-safety proof

**Capability / module:** Platform · durable background workers & schedulers  
**Branch / tip:** `cursor/worker-restart-proof-56c3`  
**Date (UTC):** 2026-09-14  
**Peer parity target:** Every shipped queue consumer or job runner proves crash → reclaim → complete (or carries a dated NON-GOAL)

---

## 0. Product contract

| Item                 | Content                                                                                                                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Capability statement | Background workers and schedulers do not silently lose in-flight work on process death; each domain carries automated restart-safe evidence or an explicit NON-GOAL.                                     |
| Primary scope        | Queue-backed consumers (`@proctira/queue-abstraction`) + report job/schedule leasing + ETL scheduler hydration                                                                                          |
| In scope             | Re-verify tip gaps, add lease-expiry reclaim for report jobs (W3-C3), inventory gate test, schedule lease reclaim proof                                                                                 |
| Explicit non-goals   | Attendance bulk consumer worker (producer only); full RabbitMQ integration tests in CI (covered by in-memory durable adapter parity); PG `claimQueuedJob` (report jobs still in-memory repo on tip)    |
| Roles                | Platform/SRE (run workers + broker); module owners (keep proofs green when adding consumers)                                                                                                            |

---

## 1. Re-verification matrix (2026-09-14)

| Domain                | Worker / runner                         | Mechanism                              | Restart proof                                                                 | Verdict        |
| --------------------- | --------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------- | -------------- |
| Exam documents        | `workers/exam-document`                 | Durable queue + ack on success         | `workers/exam-document/src/__tests__/restart-safe.test.ts`                    | **PROVEN**     |
| Notification delivery | `notification-delivery-worker`        | Durable queue                          | `packages/backend/notification/src/delivery-restart-safe.test.ts`              | **PROVEN**     |
| Workflow escalation   | `escalation-worker`                     | Durable queue                          | `packages/backend/workflow/src/escalation-restart-safe.test.ts`               | **PROVEN**     |
| Student bulk import   | `student-import-worker`                 | Durable queue                          | `packages/backend/student/src/import/import-queue.durability.test.ts`         | **PROVEN**     |
| Webhook delivery      | `webhook-delivery-worker`               | Durable queue                          | `packages/backend/developer-portal/src/webhook-dispatch.durability.test.ts`   | **PROVEN**     |
| Report cards          | `report-card-worker`                    | Durable queue + `reclaimQueuedJobs`    | `packages/backend/assessment/src/report-card-queue.durability.test.ts`        | **PROVEN**     |
| Queue adapter spine   | `InMemoryDurableQueueAdapter`           | Reclaim in-flight on disconnect        | `packages/shared/queue-abstraction/src/__tests__/in-memory-durable.test.ts`   | **PROVEN**     |
| Report async jobs     | `ReportService.processReportJob`        | DB lease (`claimQueuedJob`)            | `packages/backend/report/src/job-leasing-cancellation.test.ts` (W3-C3 reclaim) | **PROVEN**     |
| Report schedules      | `CatalogueService.tickDueSchedules`     | Schedule lease via `claimDueSchedules` | `packages/backend/report/src/catalogue-service.test.ts` (W3-C3 lease reclaim) | **PROVEN**     |
| ETL pipelines         | `ETLService` + in-process scheduler     | `hydrateSchedules` after restart       | `packages/backend/etl/src/pipeline-scheduler.durability.test.ts`              | **PROVEN**     |
| Attendance bulk       | *(no worker entrypoint)*                | —                                      | —                                                                             | **NON-GOAL**   |

---

## 2. Tip gap closed in W3-C3

### Report jobs — lease expiry reclaim

**CONFIRMED tip:** `claimQueuedJob` only accepted `status === 'queued'`. A worker crash mid-`processReportJob` left jobs stuck in `processing` forever.

**Fix:** `InMemoryReportRepository.claimQueuedJob` reclaims jobs when `status === 'processing'` and `leaseExpiresAt <= now`. `findActiveJobByDedupeKey` ignores expired processing leases so dedupe submissions can resume.

**Evidence:** `packages/backend/report/src/job-leasing-cancellation.test.ts` — `W3-C3 report job restart after worker crash`.

### Report schedules — lease holds until expiry

Schedules already push `nextRunAt` into the future on claim (W2-JOB-08). A crashed tick replica cannot double-run; after lease expiry the schedule becomes due again.

**Evidence:** `catalogue-service.test.ts` — `W3-C3: reclaims a schedule lease after worker crash`.

---

## 3. Inventory gate (CI)

`packages/shared/testing/src/worker-restart-inventory.test.ts` fails when any required proof file is removed.

```bash
pnpm --filter @proctira/testing test -- src/worker-restart-inventory.test.ts
```

---

## 4. How to verify the full spine

```bash
pnpm --filter @proctira/queue-abstraction test -- src/__tests__/in-memory-durable.test.ts
pnpm --filter @proctira/exam-document-worker test
pnpm --filter @proctira/backend-notification test -- src/delivery-restart-safe.test.ts
pnpm --filter @proctira/backend-workflow test -- src/escalation-restart-safe.test.ts
pnpm --filter @proctira/backend-student test -- src/import/import-queue.durability.test.ts
pnpm --filter @proctira/backend-developer-portal test -- src/webhook-dispatch.durability.test.ts
pnpm --filter @proctira/backend-assessment test -- src/report-card-queue.durability.test.ts
pnpm --filter @proctira/backend-report test -- src/job-leasing-cancellation.test.ts src/catalogue-service.test.ts
pnpm --filter @proctira/backend-etl test -- src/pipeline-scheduler.durability.test.ts
pnpm --filter @proctira/testing test -- src/worker-restart-inventory.test.ts
```

Live ops: set `QUEUE_BACKEND=rabbitmq` + `RABBITMQ_URL`; unacked messages redeliver after consumer death (same semantics as `InMemoryDurableQueueAdapter.disconnect()` reclaim).

---

## 5. Dated NON-GOAL residuals

| Domain                  | Status (2026-09-14) | Notes                                                                 |
| ----------------------- | ------------------- | --------------------------------------------------------------------- |
| Attendance bulk consumer | **NON-GOAL**        | Producer exists; dedicated competing consumer worker not funded       |
| Report jobs PG store    | **Follow-up**       | `claimQueuedJob` proven in-memory; PG repository not on tip           |
