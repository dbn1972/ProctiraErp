# DEV — Kill silent in-memory fallback (P0-05)

**Capability / module:** Platform persistence honesty  
**Branch / tip:** `cursor/kill-memory-fallback-56c3`  
**Date (UTC):** 2026-09-12  
**Peer parity target:** Deployed services never discard writes into process memory when `DATABASE_URL` is configured  
**Paired gap:** `docs/plans/TASKS_ENTERPRISE_P0_P1_P2_GAPS.md` · **P0-05**

---

## 0. Product contract

| Item                 | Content                                                                                                                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Capability statement | When `DATABASE_URL` is set, repository factories construct Postgres-backed stores or **hard-fail** at boot/composition. Silent `InMemory*` fallback is forbidden for production-capable modules.              |
| In scope             | Shared policy (`@proctira/database` persistence policy), fees, admissions/registration, notifications, health, attendance, ETL, plus other gateway-mounted factories that share the same fall-through pattern |
| Explicit non-goals   | Removing `InMemory*` classes used by unit/property tests; making hybrid health delegate memory disappear for non-PHI helpers; fixing P0-10 ETL probe mismatch                                                 |
| Roles                | Platform / SRE (boot fail-closed); developers (omit `DATABASE_URL` for unit tests)                                                                                                                            |

---

## 1. Inventory (pre-fix)

Factories that could reach `InMemory*` **even when `DATABASE_URL` was set** (pool/`createPg*` returned null, or no policy call):

| Module                                                                                                                                                                    | Factory                                         | Pre-fix risk                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | -------------------------------------- |
| fees                                                                                                                                                                      | `createFeesRepository`                          | `if (pool) return Pg` else memory      |
| admissions                                                                                                                                                                | `createRegistrationRepository` / CRM / pipeline | same fall-through                      |
| notifications                                                                                                                                                             | `createNotificationStack`, prefs store          | fall-through / prefs skipped policy    |
| health                                                                                                                                                                    | `createHealthRepository`                        | hybrid with null PG overlays           |
| attendance                                                                                                                                                                | `createAttendanceOpsStore`                      | pool-null → memory                     |
| ETL                                                                                                                                                                       | `createPipelineRepository`                      | **no** `assertInMemoryFallbackAllowed` |
| staff leave                                                                                                                                                               | `createStaffLeaveRepository`                    | **no** policy                          |
| transport / hostel / library / scholarship / communication / LMS / parent-portal / timetable / gradebook / billing / audit / workflow / tenant / report / curriculum / HR | create-\* factories                             | same `if (pool)` fall-through          |

G-714 already refused memory in **production** / `REQUIRE_DATABASE=1` when URL was **unset**. P0-05 closes the residual: URL **set** ⇒ never memory.

---

## 2. Fix

| Check                                                          | Done | Evidence                                                                          |
| -------------------------------------------------------------- | ---- | --------------------------------------------------------------------------------- |
| `assertInMemoryFallbackAllowed` throws when `DATABASE_URL` set | ☑    | `packages/shared/database/src/persistence-policy.ts`                              |
| `assertPostgresRepositoryAvailable` on PG path                 | ☑    | same + factory call sites                                                         |
| ETL + staff-leave wired to policy                              | ☑    | `etl/.../pg-pipeline-repository.ts`, `staff/.../pg-leave-repository.ts`           |
| Unit/integration fail-closed tests                             | ☑    | `persistence-policy.test.ts`; `apps/api-gateway/src/kill-memory-fallback.test.ts` |

---

## 3. Honesty table — memory still allowed **only when `DATABASE_URL` unset**

| Domain / factory                                                                                                                                                              | Memory when URL unset? | Notes / residual                                                                                                                                                               |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| fees                                                                                                                                                                          | Yes                    | Shared in-process ledger for unit tests / no-DB gateway                                                                                                                        |
| registration / admissions CRM / pipeline                                                                                                                                      | Yes                    | Unit + property tests construct `InMemory*` directly                                                                                                                           |
| notification stack + prefs                                                                                                                                                    | Yes                    | Rules/templates may still use hybrid memory **delegate** under PG deliveries                                                                                                   |
| health                                                                                                                                                                        | Yes                    | Without URL: full in-memory hybrid. With URL: PG counselling/PHI/special-needs/nurse required; `InMemoryHealthRepository` remains a **delegate** for non-overlaid helpers only |
| attendance (+ ops)                                                                                                                                                            | Yes                    | Prisma attendance when URL set                                                                                                                                                 |
| ETL pipelines                                                                                                                                                                 | Yes                    | Memory OK for unit tests only                                                                                                                                                  |
| staff leave / HR / appraisals / training                                                                                                                                      | Yes                    |                                                                                                                                                                                |
| transport, hostel, library, scholarship, communication, LMS, parent-portal, timetable, gradebook, billing, audit, workflow, tenant, report, curriculum, institution academics | Yes                    | Same policy                                                                                                                                                                    |
| Explicit test doubles                                                                                                                                                         | Always                 | Tests that `new InMemory*()` directly — intentional                                                                                                                            |
| Standalone server demos that hard-code `InMemory*`                                                                                                                            | Residual               | e.g. some `standalone-server.ts` files ignore factories — not production gateway path                                                                                          |
| Student import queue                                                                                                                                                          | Residual               | `InMemoryImportQueue` default in plugin when no queue injected (jobs not durable) — out of P0-05 factory scope                                                                 |
| Registration public session store                                                                                                                                             | Residual               | `InMemorySessionStore` for apply sessions                                                                                                                                      |
| Report-card PDF artifact store                                                                                                                                                | Disk/memory by design  | Not a domain DB factory                                                                                                                                                        |

---

## 4. How to verify

```bash
# Policy unit tests
pnpm --filter @proctira/database exec vitest run src/persistence-policy.test.ts

# Factory fail-closed integration
pnpm --filter @proctira/api-gateway exec vitest run src/kill-memory-fallback.test.ts
```

With `DATABASE_URL` set in a real deploy, omitting Postgres connectivity still **fails composition** rather than serving an empty memory ledger.

---

## 5. Residual

- Hybrid notification/health still keep in-memory **delegates** for entities not yet on SQL; durable slices fail-closed.
- P0-10 (ETL probes) is separate.
- Do **not** claim TASKS row closed in the gap register from this doc alone (register edits were out of scope for this branch).
