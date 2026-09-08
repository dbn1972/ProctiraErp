# SIS Master schedule — test notes (WS2)

**Paired DEV audit:** `docs/audits/DEV_SIS_MASTER_SCHEDULE.md`  
**Date (UTC):** 2026-09-06  
**Artifacts:** `/opt/cursor/artifacts/sis-schedule-audit/`

## Inventory

| Screen                         | Route                                     | Role      | Auth  | Notes                            |
| ------------------------------ | ----------------------------------------- | --------- | ----- | -------------------------------- |
| Institutions · Schedule        | `/institutions/[id]/schedule`             | Registrar | Login | Sections list + create + publish |
| Section roster                 | `/institutions/[id]/schedule/[sectionId]` | Registrar | Login | Enroll/withdraw                  |
| Attendance · published periods | `/attendance?institutionId=`              | Clerk     | Login | Read-only meeting slots          |

## Automated

| Suite                      | Spec                                             | Gate                  |
| -------------------------- | ------------------------------------------------ | --------------------- |
| Ungated inventory → /login | `e2e/23-master-schedule-inventory-smoke.spec.ts` | Always                |
| Authenticated inventory    | same file                                        | `E2E_BACKEND_READY=1` |
| Domain conflict engine     | `@proctira/backend-timetable` vitest             | Always                |

## Unit results (this agent)

```
Test Files  3 passed (3)
Tests       20 passed (20)
```

## Seed verify (live Postgres)

Applied `db/seeds/004_sis_master_schedule_demo.sql`:

| Entity              | Count                    |
| ------------------- | ------------------------ |
| Rooms (seed marker) | 3                        |
| Sections            | 2 (1 PUBLISHED, 1 DRAFT) |
| Meetings            | 3                        |
| Enrollments         | 3                        |

## Residuals

- Gated live write E2E (create section → enroll → room conflict 409 → publish)
- Multidevice PNG captures when web stack available
- Teacher cannot publish RBAC deny
