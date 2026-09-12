# DEV — Workflow escalation durable schedules (P1-WF)

**Capability / module:** Workflow engine · durable escalation via queue-abstraction  
**Branch / tip:** `cursor/workflow-escalation-wire-dd02`  
**Date (UTC):** 2026-09-12  
**Peer parity target:** Timeout escalations survive publisher/consumer restart (same bar as P0-06 exam documents)  
**Paired gap:** `docs/plans/TASKS_ENTERPRISE_P0_P1_P2_GAPS.md` · **P1-WF** (TASKS file not edited from this slice)

---

## 0. Product contract

| Item                 | Content                                                                                                                                                                                                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Capability statement | When a workflow instance sits in a state past its escalation rule duration, a delayed job on `@proctira/queue-abstraction` can fire `EscalationService.processEscalation` after a consumer crash/restart. Gateway mounts `escalationPublisher` on `/workflow-engine` when queue env is set. |
| Primary domain       | **Workflow escalation** (Req 13.6)                                                                                                                                                                                                                                                          |
| In scope             | `QueueEscalationPublisher`, env factory, gateway wire, consume helper, restart-safe unit proof, well-known job types                                                                                                                                                                        |
| Explicit non-goals   | Dedicated `workers/` package deploy unit; report schedule durable tick (alternate P1-WF path — deferred while escalation preferred); full notification delivery worker                                                                                                                      |
| Roles                | Platform/SRE (run queue + consumer); workflow assignees (see escalated state)                                                                                                                                                                                                               |

| Surface                        | Route / process                                 | Queue                                  | Stores             |
| ------------------------------ | ----------------------------------------------- | -------------------------------------- | ------------------ |
| API schedule                   | Engine transitions / create instance with rules | `tenant.{id}.workflow.escalation`      | workflow instances |
| Consumer helper                | `createWorkflowEscalationWorker`                | consume `tenant.*.workflow.escalation` | same + audit       |
| Restart-safe proof (no broker) | vitest in `@proctira/backend-workflow`          | `InMemoryDurableQueueStore`            | in-memory workflow |

---

## 1–3 Build status

| Check                                                       | Done | Evidence                                                                                  |
| ----------------------------------------------------------- | ---- | ----------------------------------------------------------------------------------------- |
| Well-known job types on queue-abstraction                   | ☑    | `WORKFLOW_ESCALATION_JOB_TYPE` / `_CONSUME_TOPIC` / `_NOTIFY_TYPE` in `queue-abstraction` |
| `QueueEscalationPublisher` implements `EscalationPublisher` | ☑    | `packages/backend/workflow/src/queue-escalation-publisher.ts`                             |
| Env factory (`QUEUE_BACKEND` / `RABBITMQ_URL`)              | ☑    | `escalation-publisher-factory.ts`                                                         |
| Gateway wire on `workflow-engine` registrar                 | ☑    | `apps/api-gateway/src/domain-plugins.ts`                                                  |
| Consume helper                                              | ☑    | `escalation-worker.ts`                                                                    |
| Restart-safe unit proof                                     | ☑    | `escalation-restart-safe.test.ts`                                                         |
| Publisher unit tests                                        | ☑    | `queue-escalation-publisher.test.ts`                                                      |

---

## 4. How restart-safe proof works

1. `WorkflowService` + `QueueEscalationPublisher` share an `InMemoryDurableQueueStore`.
2. Transition into a state with an escalation rule publishes a durable job.
3. First worker leases the message and hangs mid-`processEscalation` (in-flight, not acked).
4. `worker.stop()` → adapter `disconnect()` reclaims in-flight → pending (crash semantics).
5. Second worker starts on the same store, redelivers, and `EscalationService.processEscalation` moves the instance to the escalate-to state with `SYSTEM_ESCALATION` audit.

Live ops: set `QUEUE_BACKEND=rabbitmq` + `RABBITMQ_URL`; run gateway (publisher) and a process that calls `createWorkflowEscalationWorker` (consumer).

---

## 5. Dated NON-GOAL residuals

| Domain                       | Status (2026-09-12)     | Notes                                                             |
| ---------------------------- | ----------------------- | ----------------------------------------------------------------- |
| Report schedule durable tick | **NON-GOAL this slice** | Still in-process `setTimeout` in report `scheduler.ts`            |
| Dedicated worker package     | Residual                | Helper exported from workflow package; deploy packaging follow-up |

---

## 6. How to verify

```bash
pnpm --filter @proctira/backend-workflow test -- src/queue-escalation-publisher.test.ts src/escalation-restart-safe.test.ts
```
