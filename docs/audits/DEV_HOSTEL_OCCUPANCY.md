# Enterprise module development — Hostel occupancy

**Capability / module:** Hostel  
**Branch / tip:** `cursor/enterprise-score-uplift-56c3`  
**Date (UTC):** 2026-09-07  
**Peer parity target:** Hostels, bed assignments, leaves, visitors  
**Paired test audit:** pending WS6

## 0. Product contract

| Item                 | Content                                                                              |
| -------------------- | ------------------------------------------------------------------------------------ |
| Capability statement | Wardens manage hostel inventory, assignments, leaves, and visitors.                  |
| In scope             | SQL schema, gateway mount (in-memory repo), App Router hubs, sidebar, ungated smokes |
| Explicit non-goals   | Block/room/bed CRUD UI; overlap enforcement in this tip                              |
| Roles                | Hostel warden / tenant admin                                                         |

| Nav         | Route                 | API                   | Tables               |
| ----------- | --------------------- | --------------------- | -------------------- |
| Overview    | `/hostel`             | `/hostel/*`           | `hostel_*`           |
| Assignments | `/hostel/assignments` | `/hostel/assignments` | `hostel_assignments` |
| Leaves      | `/hostel/leaves`      | `/hostel/leaves`      | `hostel_leaves`      |
| Visitors    | `/hostel/visitors`    | `/hostel/visitors`    | `hostel_visitors`    |

## Build status

| Check                                  | Done | Evidence                       |
| -------------------------------------- | ---- | ------------------------------ |
| SQL `db/sql/008_hostel_schema.sql`     | ☑    |                                |
| Gateway mount InMemoryHostelRepository | ☑    | domain-plugins                 |
| Web shells + sidebar                   | ☑    |                                |
| Live hostel create + list              | ☑    | `NewHostelForm` + `/hostel`    |
| Assignments list from API              | ☑    | `/hostel/assignments`          |
| PgHostelStore                          | ☐    | follow-up                      |
| Block/room/bed admin UI                | ☐    | follow-up                      |

## Residual

Wire block/room/bed CRUD + Pg store; seed demo occupancy per cert school.
