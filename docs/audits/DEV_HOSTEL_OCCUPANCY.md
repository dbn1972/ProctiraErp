# Enterprise module development — Hostel occupancy

**Capability / module:** Hostel  
**Branch / tip:** `cursor/enterprise-score-uplift-56c3`  
**Date (UTC):** 2026-09-07  
**Peer parity target:** Hostels, bed assignments, leaves, visitors  
**Paired test audit:** pending WS6

## 0. Product contract

| Item                 | Content                                                                                |
| -------------------- | -------------------------------------------------------------------------------------- |
| Capability statement | Wardens manage hostel inventory, assignments, leaves, and visitors.                    |
| In scope             | SQL schema, Pg/in-memory repo, gateway mount, App Router hubs, sidebar, ungated smokes |
| Explicit non-goals   | Overlap enforcement in this tip                                                        |
| Roles                | Hostel warden / tenant admin                                                           |

| Nav         | Route                 | API                                               | Tables                                         |
| ----------- | --------------------- | ------------------------------------------------- | ---------------------------------------------- |
| Overview    | `/hostel`             | `/hostel/*`                                       | `hostel_*`                                     |
| Structure   | `/hostel/structure`   | `/hostel/blocks`, `/hostel/rooms`, `/hostel/beds` | `hostel_blocks`, `hostel_rooms`, `hostel_beds` |
| Assignments | `/hostel/assignments` | `/hostel/assignments`                             | `hostel_assignments`                           |
| Leaves      | `/hostel/leaves`      | `/hostel/leaves`                                  | `hostel_leaves`                                |
| Visitors    | `/hostel/visitors`    | `/hostel/visitors`                                | `hostel_visitors`                              |

## Build status

| Check                                    | Done | Evidence                            |
| ---------------------------------------- | ---- | ----------------------------------- |
| SQL `db/sql/008_hostel_schema.sql`       | ☑    |                                     |
| Gateway mount `createHostelRepository()` | ☑    | Pg when `DATABASE_URL`; else memory |
| Web shells + sidebar                     | ☑    |                                     |
| Live hostel create + list                | ☑    | `NewHostelForm` + `/hostel`         |
| Assignments list from API                | ☑    | `/hostel/assignments`               |
| Assignment create form                   | ☑    | `NewHostelAssignmentForm`           |
| Leaves + visitors create/list            | ☑    | `NewLeaveForm` / `NewVisitorForm`   |
| PgHostelStore                            | ☑    | `pg-hostel-repository.ts`           |
| Block/room/bed admin UI                  | ☑    | `/hostel/structure` + create forms  |

## Residual

Seed demo occupancy per cert school; WS6 enterprise pack. Tip CI currently blocked by GitHub billing/spending limit (jobs never start).
