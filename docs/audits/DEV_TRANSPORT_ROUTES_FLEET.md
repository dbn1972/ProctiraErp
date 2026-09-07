# Enterprise module development — Transport routes / fleet / assignments

**Capability / module:** Transport  
**Branch / tip:** `cursor/enterprise-score-uplift-56c3`  
**Date (UTC):** 2026-09-07  
**Peer parity target:** Routes, vehicles, driver/student assignments with overlap rules  
**Paired test audit:** `docs/audits/TRANSPORT_ROUTES_VEHICLES_ASSIGNMENTS.md` (pending WS6)

## 0. Product contract

| Item                 | Content                                                                          |
| -------------------- | -------------------------------------------------------------------------------- |
| Capability statement | Transport officers maintain routes/stops/vehicles and assignments.               |
| In scope             | SQL schema, Pg/in-memory repo, gateway mount, App Router list + create form, nav |
| Explicit non-goals   | GPS live tracking; full vehicle/assignment write UIs in this tip                 |
| Roles                | Transport officer / tenant admin                                                 |

| Nav         | Route                       | API                   | Tables                                |
| ----------- | --------------------------- | --------------------- | ------------------------------------- |
| Overview    | `/transport`                | `/transport/*`        | `transport_*`                         |
| Routes      | `/transport/routes`, `/new` | `/transport/routes`   | `transport_routes`, `transport_stops` |
| Vehicles    | `/transport/vehicles`       | `/transport/vehicles` | `transport_vehicles`                  |
| Assignments | `/transport/assignments`    | `*-assignments`       | driver + student assignment tables    |

## Build status

| Check                                       | Done | Evidence                                         |
| ------------------------------------------- | ---- | ------------------------------------------------ |
| SQL `db/sql/006_transport_schema.sql`       | ☑    |                                                  |
| Gateway mount `createTransportRepository()` | ☑    | Pg when `DATABASE_URL`; else in-memory           |
| `PgTransportRepository` + factory           | ☑    | `pg-transport-repository.ts`                     |
| Web shells + sidebar                        | ☑    |                                                  |
| Live create form + list from API            | ☑    | `transport.ts`, `NewRouteForm`, routes list page |
| Vehicle / assignment write UIs              | ☐    | follow-up                                        |

## Residual

Seed demo routes per cert school; vehicle/assignment forms; WS6 enterprise test pack.
