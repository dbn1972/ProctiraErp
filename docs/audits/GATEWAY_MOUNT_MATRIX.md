# Gateway mount matrix (G-003)

**Date (UTC):** 2026-09-08  
**Source of truth (runtime):** `apps/api-gateway/src/domain-plugins.ts` → `DOMAIN_REGISTRAR_NAMES`  
**Source of truth (audit rows):** `apps/api-gateway/src/mount-matrix.ts`  
**Unit test:** `apps/api-gateway/src/gateway-mount-matrix.test.ts`

Documents which `packages/backend/*` plugins are live on the api-gateway under `/api/v1`, how they persist, and whether fine-grained RBAC (`rbacPlugin`) is wired.

**RBAC note:** As of this audit, `rbacPlugin` is **not** registered in `apps/api-gateway` (gap G-101). Mounted domains enforce JWT presence only.

**Auth note:** `@proctira/backend-auth` is mounted in `app.ts`, not via `DOMAIN_REGISTRARS`.

**Fees:** There is no `packages/backend/fees` package yet (gap G-201); parent-portal reads fees SQL when present.

## Mounted

| Package | Mounted? | Prefix(es) | Persistence | RBAC wired? | Notes |
| --- | --- | --- | --- | --- | --- |
| `backend/student` | Yes | `/students` | Prisma + RLS (else in-memory) | No | JWT only (G-101). |
| `backend/institution` | Yes | `/institutions` | Prisma + RLS (else in-memory) | No | |
| `backend/staff` | Yes | `/staff` | Prisma + RLS (else in-memory) | No | Profiles + assignments. |
| `backend/attendance` | Yes | `/attendance` | Prisma + RLS (else in-memory) | No | |
| `backend/examination` | Yes | `/examinations` | Prisma + RLS (else in-memory) | No | Exams + results + documents. |
| `backend/assessment` | Yes | `/assessments`, `/grading-schemes`, `/assessment-items`, `/outcomes`, `/results` | Prisma + RLS (else in-memory) | No | Report-card repos unwired; routes disabled. |
| `backend/timetable` | Yes | `/timetable` | Raw pg `003` (else in-memory) | No | No Prisma on this path. |
| `backend/gradebook` | Yes | `/gradebook` | Raw pg `003`/`004` (else in-memory) | No | |
| `backend/scholarship` | Yes | `/scholarships` | Raw pg `016` (else in-memory + demo seed) | No | G-204. |
| `backend/health` | Yes | `/health` | Mixed (pg counselling/PHI; special-needs in-memory) | No | Also mounts `healthUiPlugin`. |
| `backend/notification` | Yes | `/notifications` | Mixed (deliveries in-memory; prefs/devices pg `005`) | No | G-207. |
| `backend/transport` | Yes | `/transport` | Raw pg `006` (else in-memory) | No | |
| `backend/communication` | Yes | `/communication` | Raw pg `007` (else in-memory) | No | |
| `backend/hostel` | Yes | `/hostel` | Raw pg `008` (else in-memory) | No | |
| `backend/library` | Yes | `/library` | Raw pg `009` (else in-memory) | No | |
| `backend/parent-portal` | Yes | `/parent-portal` | Raw pg `010` (else in-memory) | No | |
| `backend/registration` | Yes | `/registrations` | Raw pg `014` (else in-memory) | No | G-205. |
| `backend/auth` | Yes | `/auth` | In-memory identity/session stores | No | Mounted in `app.ts` (not `DOMAIN_REGISTRARS`). `rbacPlugin` exported but unused. |
| `(gateway) insights-ui` | Yes | `/reports`, `/data-warehouse` | UI seed / in-process aggregates | No | Registrar `insights`. Real `report` / `data-warehouse` packages unmounted (G-209). |
| `(gateway) platform-admin-ui` | Yes | `/tenants`, `/plugins`, `/break-glass`, `/plans`, `/themes`, `/platform`, `/audit` | UI seed / stubs | No | Registrar `platform-admin` (G-104). |
| `(gateway) workflow-ui` | Yes | `/workflows` | UI seed | No | Registrar `workflow`. Real `backend/workflow` unmounted (G-208). |

## Unmounted

| Package | Mounted? | Prefix(es) | Persistence | RBAC wired? | Notes |
| --- | --- | --- | --- | --- | --- |
| `backend/admin-dashboard` | No | `/admin/scalability` | n/a | No | Plugin not registered. |
| `backend/audit` | No | `/audit` | n/a | No | `/audit` owned by platform-admin UI stub (G-105). |
| `backend/billing` | No | `/billing` | n/a | No | G-106. |
| `backend/custom-field` | No | `/custom-fields` | n/a | No | G-605. |
| `backend/dashboards` | No | `/dashboards` | n/a | No | G-605. |
| `backend/data-warehouse` | No | `/warehouses` | n/a | No | Insights UI owns `/data-warehouse` (G-209). |
| `backend/developer-portal` | No | `/developer` | n/a | No | Other Portals honesty-demo. |
| `backend/etl` | No | `/pipelines` | n/a | No | G-209. |
| `backend/install` | No | `/install` | n/a | No | Portal/demo scoped. |
| `backend/plugin` | No | `/plugins` | n/a | No | `/plugins` owned by platform-admin UI stub. |
| `backend/policy` | No | `/policies` | n/a | No | G-106. |
| `backend/report` | No | `/reports` | n/a | No | Insights UI owns `/reports` (G-209). |
| `backend/survey` | No | `/surveys` | n/a | No | G-605. |
| `backend/tenant` | No | `/tenants` | n/a | No | Lifecycle plugin unmounted; UI stub owns `/tenants`. Shared `@proctira/tenant` still resolves JWT tenant. |
| `backend/theme` | No | `/themes` | n/a | No | G-605; UI stub owns `/themes`. |
| `backend/workflow` | No | `/workflows` | n/a | No | Real plugin unmounted; `workflow-ui` seed is live (G-208). |

## Registrar ↔ package map

| `DOMAIN_REGISTRARS.name` | Package / surface |
| --- | --- |
| `student` | `backend/student` |
| `institution` | `backend/institution` |
| `staff` | `backend/staff` |
| `attendance` | `backend/attendance` |
| `examination` | `backend/examination` |
| `assessment` | `backend/assessment` |
| `timetable` | `backend/timetable` |
| `gradebook` | `backend/gradebook` |
| `scholarship` | `backend/scholarship` |
| `health` | `backend/health` (+ `healthUiPlugin`) |
| `insights` | `(gateway) insights-ui` |
| `platform-admin` | `(gateway) platform-admin-ui` |
| `workflow` | `(gateway) workflow-ui` (not `backend/workflow`) |
| `notification` | `backend/notification` |
| `transport` | `backend/transport` |
| `communication` | `backend/communication` |
| `hostel` | `backend/hostel` |
| `library` | `backend/library` |
| `parent-portal` | `backend/parent-portal` |
| `registration` | `backend/registration` |

## Maintenance

1. Adding a domain to `DOMAIN_REGISTRARS` → add/update a row in `mount-matrix.ts` and this doc; extend `EXPECTED_MOUNTED` / shrink `EXPECTED_UNMOUNTED` as needed.
2. Mounting a previously unmounted package → flip `mounted: true`, set prefixes/persistence, move between curated lists.
3. `gateway-mount-matrix.test.ts` fails if a new registrar name appears without a matrix row, or if curated mounted/unmounted lists drift from `MOUNT_MATRIX`.
