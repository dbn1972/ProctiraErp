# Gateway mount matrix (G-003)

**Date (UTC):** 2026-09-08  
**Source of truth (runtime):** `apps/api-gateway/src/domain-plugins.ts` → `DOMAIN_REGISTRAR_NAMES`  
**Source of truth (audit rows):** `apps/api-gateway/src/mount-matrix.ts`  
**Unit test:** `apps/api-gateway/src/gateway-mount-matrix.test.ts`

Documents which `packages/backend/*` plugins are live on the api-gateway under `/api/v1`, how they persist, and whether fine-grained RBAC (`rbacPlugin`) is wired.

Table columns: | Package | Mounted? | Prefix(es) | Persistence | RBAC wired? | Notes |

**RBAC note:** `rbacPlugin` is registered in `apps/api-gateway` (G-101). Mutating `/api/v1` routes are gated; G-105 records audit rows; G-106 suspends mutating access for suspended tenants.

**Auth note:** `@proctira/backend-auth` is mounted in `app.ts`, not via `DOMAIN_REGISTRARS`.

**Audit / billing / tenant:** Mounted in `app.ts` (G-105/G-106) — audit at `/audit-logs`, billing at `/billing`, tenant lifecycle at `/tenant-lifecycle` (platform-admin UI still owns `/tenants` and stub `/audit`).

## Mounted

| Package                       | Mounted? | Prefix(es)                                                                                        | Persistence                                                | RBAC wired? | Notes                                                                                                |
| ----------------------------- | -------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------- |
| `backend/student`             | Yes      | `/students`                                                                                       | Prisma + RLS (else in-memory)                              | No          | JWT only (G-101).                                                                                    |
| `backend/institution`         | Yes      | `/institutions`, `/academic-periods`, `/grades`, `/classes`, `/subjects`, `/institution-subjects`, `/infrastructure` (G-901) | Prisma + RLS (else in-memory); infrastructure raw-pg `027` + RLS (else tenant-partitioned in-memory) | Yes         | G-901: academics sub-domains mounted by `institutionPlugin`; in-memory Prisma look-alike without `DATABASE_URL` |
| `backend/staff`               | Yes      | `/staff`                                                                                          | Prisma + RLS (else in-memory)                              | No          | Profiles + assignments.                                                                              |
| `backend/attendance`          | Yes      | `/attendance`                                                                                     | Prisma + RLS (else in-memory)                              | No          |                                                                                                      |
| `backend/examination`         | Yes      | `/examinations`                                                                                   | Prisma + RLS (else in-memory)                              | No          | Exams + results + documents.                                                                         |
| `backend/assessment`          | Yes      | `/assessments`, `/grading-schemes`, `/assessment-items`, `/outcomes`, `/results`, `/report-cards` | Prisma + RLS (else in-memory); report-cards in-memory      | No          | G-210 report-card routes enabled (in-memory). Durable HTML also via `/gradebook/report-cards`.       |
| `backend/timetable`           | Yes      | `/timetable`                                                                                      | Raw pg `003` (else in-memory)                              | No          | No Prisma on this path.                                                                              |
| `backend/gradebook`           | Yes      | `/gradebook`                                                                                      | Raw pg `003`/`004` (else in-memory)                        | No          |                                                                                                      |
| `backend/lms`                 | Yes      | `/lms`                                                                                            | Raw pg `026` (else in-memory)                              | No          | G-801/G-802: board/school-scoped assignments · homework · quizzes · Spiral PAL.                      |
| `backend/scholarship`         | Yes      | `/scholarships`                                                                                   | Raw pg `016` (else in-memory + demo seed)                  | No          | G-204.                                                                                               |
| `backend/health`              | Yes      | `/health`                                                                                         | Mixed (pg counselling/PHI/special-needs when DATABASE_URL) | No          | Also mounts `healthUiPlugin` (G-203).                                                                |
| `backend/notification`        | Yes      | `/notifications`                                                                                  | Mixed (PG deliveries when DATABASE_URL; prefs/devices pg)  | No          | G-207; providers sandbox/WAIVED.                                                                     |
| `backend/transport`           | Yes      | `/transport`                                                                                      | Raw pg `006` (else in-memory)                              | No          | G-602 GPS + attendance-on-bus sandbox stubs. Live telematics residual.                               |
| `backend/communication`       | Yes      | `/communication`                                                                                  | Raw pg `007` (else in-memory)                              | No          | G-604 sandbox delivery adapter + send audit. Live Twilio/SES residual.                               |
| `backend/hostel`              | Yes      | `/hostel`                                                                                         | Raw pg `008` (else in-memory)                              | No          |                                                                                                      |
| `backend/library`             | Yes      | `/library`                                                                                        | Raw pg `009` (else in-memory)                              | No          | G-603 fines → fees ledger via shared FeesService.                                                    |
| `backend/parent-portal`       | Yes      | `/parent-portal`                                                                                  | Raw pg `010` (else in-memory)                              | No          |                                                                                                      |
| `backend/fees`                | Yes      | `/fees`                                                                                           | Raw pg `010`/`011` (else shared in-memory)                 | No          | G-201; sandbox PSP only (G-202 waived).                                                              |
| `backend/registration`        | Yes      | `/registrations`                                                                                  | Raw pg `014` (else in-memory)                              | No          | G-205.                                                                                               |
| `backend/developer-portal`    | Yes      | `/developer`                                                                                      | In-memory                                                  | Yes         | G-607 AuthZ + API keys/docs; gateway rate-limit; live IdP mint residual.                             |
| `backend/auth`                | Yes      | `/auth`                                                                                           | In-memory identity/session stores                          | Yes         | Mounted in `app.ts` (not `DOMAIN_REGISTRARS`).                                                       |
| `backend/audit`               | Yes      | `/audit-logs`                                                                                     | In-memory                                                  | Yes         | Mounted in `app.ts` (G-105); mutating onResponse trail.                                              |
| `backend/billing`             | Yes      | `/billing`                                                                                        | In-memory                                                  | No          | Mounted in `app.ts` (G-106).                                                                         |
| `backend/tenant`              | Yes      | `/tenant-lifecycle`, `/tenant` (G-910)                                                            | Postgres `control_plane_documents` (`022`, RLS) when `DATABASE_URL`; else in-memory | Yes (`tenant` → `user`) | Lifecycle mounted in `app.ts` (G-106); UI stub still owns `/tenants`. Registrar `tenant-admin` (G-910): `/tenant/{roles,permissions,users,settings}` for the web `/admin` console. |
| `(gateway) insights-ui`       | Yes      | `/reports`, `/data-warehouse`                                                                     | Postgres when `DATABASE_URL` (`020`; else in-memory)       | No          | Registrar `insights` (G-209). Real `report` / `data-warehouse` packages still unmounted.             |
| `(gateway) platform-admin-ui` | Yes      | `/tenants`, `/plugins`, `/break-glass`, `/plans`, `/themes`, `/platform`, `/audit`                | UI seed / stubs                                            | Yes         | Registrar `platform-admin` (G-104).                                                                  |
| `(gateway) workflow-ui`       | Yes      | `/workflows`                                                                                      | Postgres when `DATABASE_URL` (else UI seed)                | No          | Registrar `workflow`. Approvals persist (G-208). Engine mounted separately (`/workflow-engine`).     |
| `backend/workflow`            | Yes      | `/workflow-engine`                                                                                | Postgres when `DATABASE_URL` (`025`; else in-memory)       | No          | Registrar `workflow-engine` (G-715): definitions, instances, transitions + append-only audit, cases. |

## Unmounted / PARKED (G-605)

| Package                   | Mounted? | Prefix(es)           | Persistence | RBAC wired? | Notes                                                                                    |
| ------------------------- | -------- | -------------------- | ----------- | ----------- | ---------------------------------------------------------------------------------------- |
| `backend/admin-dashboard` | No       | `/admin/scalability` | n/a         | No          | Plugin not registered.                                                                   |
| `backend/custom-field`    | No       | `/custom-fields`     | n/a         | No          | **PARKED (G-605)** — in-memory only; no redesign UI/E2E.                                 |
| `backend/dashboards`      | No       | `/dashboards`        | n/a         | No          | **PARKED (G-605)** — needs AreaHierarchyResolver product wiring.                         |
| `backend/data-warehouse`  | No       | `/warehouses`        | n/a         | No          | Insights UI owns `/data-warehouse` (G-209).                                              |
| `backend/etl`             | No       | `/pipelines`         | n/a         | No          | Full ETL package unmounted; insights UI PG aggregates cover report/import smoke (G-209). |
| `backend/install`         | No       | `/install`           | n/a         | No          | Portal/demo scoped.                                                                      |
| `backend/plugin`          | No       | `/plugins`           | n/a         | No          | `/plugins` owned by platform-admin UI stub.                                              |
| `backend/policy`          | No       | `/policies`          | n/a         | No          | Residual beyond G-106 suspend gate.                                                      |
| `backend/report`          | No       | `/reports`           | n/a         | No          | Insights UI owns `/reports` (G-209).                                                     |
| `backend/survey`          | No       | `/surveys`           | n/a         | No          | **PARKED (G-605)** — plugin ready; no gateway product surface/E2E.                       |
| `backend/theme`           | No       | `/themes`            | n/a         | No          | **PARKED (G-605)** — `/themes` owned by platform-admin UI stub (prefix conflict).        |

## Registrar ↔ package map

| `DOMAIN_REGISTRARS.name` | Package / surface                                |
| ------------------------ | ------------------------------------------------ |
| `student`                | `backend/student`                                |
| `institution`            | `backend/institution`                            |
| `tenant-admin`           | `backend/tenant` (G-910)                         |
| `staff`                  | `backend/staff`                                  |
| `attendance`             | `backend/attendance`                             |
| `examination`            | `backend/examination`                            |
| `assessment`             | `backend/assessment`                             |
| `timetable`              | `backend/timetable`                              |
| `gradebook`              | `backend/gradebook`                              |
| `lms`                    | `backend/lms`                                    |
| `scholarship`            | `backend/scholarship`                            |
| `health`                 | `backend/health` (+ `healthUiPlugin`)            |
| `insights`               | `(gateway) insights-ui`                          |
| `platform-admin`         | `(gateway) platform-admin-ui`                    |
| `workflow`               | `(gateway) workflow-ui` (not `backend/workflow`) |
| `workflow-engine`        | `backend/workflow` (G-715)                       |
| `notification`           | `backend/notification`                           |
| `transport`              | `backend/transport`                              |
| `communication`          | `backend/communication`                          |
| `hostel`                 | `backend/hostel`                                 |
| `library`                | `backend/library`                                |
| `parent-portal`          | `backend/parent-portal`                          |
| `fees`                   | `backend/fees`                                   |
| `registration`           | `backend/registration`                           |
| `developer`              | `backend/developer-portal`                       |

## Maintenance

1. Adding a domain to `DOMAIN_REGISTRARS` → add/update a row in `mount-matrix.ts` and this doc; extend `EXPECTED_MOUNTED` / shrink `EXPECTED_UNMOUNTED` as needed.
2. Mounting a previously unmounted package → flip `mounted: true`, set prefixes/persistence, move between curated lists.
3. `gateway-mount-matrix.test.ts` fails if a new registrar name appears without a matrix row, or if curated mounted/unmounted lists drift from `MOUNT_MATRIX`.
