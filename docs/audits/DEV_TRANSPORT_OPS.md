# Enterprise module development — Transport ops (G-920)

**Capability / module:** Transport — stops, GPS ingest + live map, bus attendance, alerts, fee link  
**Branch / tip:** `cursor/w9-g920-transport-56c3`  
**Owner / agent:** Cloud agent (G-920)  
**Date (UTC):** 2026-09-09  
**Peer parity target:** Stops + live last-known GPS (SVG, not a map SDK), trip boarding, delay/geofence/missed-pickup rules, stop-distance fee line via Fees (G-903)  
**Dev session:** not using hooks state file  
**Paired test audit:** deferred (resource discipline: no Playwright / full E2E run)

Copy of `docs/audits/templates/ENTERPRISE_MODULE_DEV_CHECKLIST.md`.

---

## 0. Product contract

| Item                   | Content                                                                           |
| ---------------------- | --------------------------------------------------------------------------------- |
| Capability statement   | See `docs/audits/PRODUCT_TRANSPORT_OPS.md`                                        |
| In scope (peer parity) | Stops CRUD, GPS batch + live SVG map, trip attendance, alert evaluator, fees port |
| Explicit non-goals     | MapLibre/Leaflet; anonymous device ingest; channel dispatch; parent live map      |
| Roles (RBAC)           | Gateway resource `transport` (existing); writes need JWT tenant                   |
| Boards impacted        | CBSE ☐ ICSE ☐ State ☐ Other: N/A (campus ops)                                     |

Screen / API inventory:

| Nav / surface | Route                          | API                                          | Tables                            | PII                 |
| ------------- | ------------------------------ | -------------------------------------------- | --------------------------------- | ------------------- |
| Stops         | `/transport/routes/[id]/stops` | `/transport/stops`                           | `transport_stops`                 | stop names          |
| Live map      | `/transport/live`              | `GET /transport/live`, `POST /transport/gps` | `transport_gps_pings`             | lat/lng             |
| Attendance    | `/transport/attendance`        | `/transport/attendance`                      | `transport_bus_attendance`        | student ids         |
| Alerts        | `/transport/alerts`            | `/transport/alerts*`                         | `transport_alert_*`               | student/vehicle ids |
| Fees          | `/transport/fees`              | `/transport/fee-structures`                  | `transport_fee_*` + fees invoices | student + amounts   |

---

## 1. Domain model (SQL-first)

| Check                         | Done | Evidence                                                             |
| ----------------------------- | ---- | -------------------------------------------------------------------- |
| Versioned SQL under `db/sql/` | ☑    | `db/sql/045_transport_ops_schema.sql`                                |
| Constraints / indexes / FKs   | ☑    | unique deviceId+pingId; trip unique; FKs to 006 tables               |
| Multi-board seed fixtures     | ☐    | waived — campus ops, not board-specific                              |
| Domain unit/property tests    | ☑    | `alert-evaluator.test.ts`; existing overlap property                 |
| Invariants documented         | ☑    | idempotent GPS; one attendance row per student/trip; fee link status |

**Entities**

- `transport_vehicle_devices` — `device_id` + SHA-256 `device_key_hash` per vehicle
- `transport_gps_pings` — UNIQUE `(tenant_id, device_id, ping_id)`
- `transport_bus_attendance` — UNIQUE `(tenant_id, route_id, trip_date, direction, student_id)`
- `transport_alert_rules` — `kind` in delay_minutes \| geofence_exit \| missed_pickup
- `transport_alerts` — evaluator output; acknowledge columns
- `transport_fee_structures` — band by route/stop/distance; optional `fees_structure_id`
- `transport_fee_links` — `invoiced` \| `pending` \| `skipped`

---

## 2. API / services

| Check                              | Done | Evidence                                                |
| ---------------------------------- | ---- | ------------------------------------------------------- |
| Tenant middleware on all routes    | ☑    | existing transport plugin + `getTenantId`               |
| Validation + typed errors          | ☑    | TypeBox schemas in `schemas.ts`                         |
| RBAC enforced                      | ☑    | existing `/transport` → resource `transport`            |
| Conflict / rule failures → 409/422 | ☑    | duplicate device; assignment overlap                    |
| Idempotent writes where needed     | ☑    | GPS unique (deviceId, pingId) returns existing          |
| Cross-tenant deny test             | ☐    | E2E gated spec includes tenant B GET deny; not executed |

**Fees integration:** `TransportFeesPort` injected by gateway (same pattern as parent-portal / library). `createFeeStructure` + `bulkInvoiceClass` when available; else `createInvoice` titled line; if port missing → `pending` link. `FeesService.createInvoice` does **not** accept `structureId` — structure-linked invoices go through `bulkInvoiceClass`.

---

## 3. UI (redesign)

| Screen     | Empty/loading/error | Write works | Board-aware | Evidence                       |
| ---------- | ------------------- | ----------- | ----------- | ------------------------------ |
| Stops      | ☑                   | ☑           | n/a         | `/transport/routes/[id]/stops` |
| Live map   | ☑                   | GPS via API | n/a         | inline SVG; OSM links          |
| Attendance | ☑                   | ☑           | n/a         | trip form                      |
| Alerts     | ☑                   | acknowledge | n/a         | list + evaluate                |
| Fees       | ☑                   | ☑           | n/a         | fee band form                  |

**Live map:** equirectangular SVG of lat/lng. No MapLibre/Leaflet. Each stop/bus has `https://www.openstreetmap.org/?mlat=&mlon=#map=17/...`. Auto-refresh: `router.refresh()` on an interval.

---

## 4. Cross-module integration

| Dependency                           | Integrated | Evidence                                             |
| ------------------------------------ | ---------- | ---------------------------------------------------- |
| Fees (G-903)                         | ☑          | gateway injects `FeesService` into `transportPlugin` |
| Existing routes/vehicles/stops (006) | ☑          | FKs from 045                                         |
| Parent portal                        | ☐          | non-goal                                             |

---

## 5. Observability & audit

| Check                               | Done | Evidence                                                                           |
| ----------------------------------- | ---- | ---------------------------------------------------------------------------------- |
| Structured logs on writes           | ☐    | uses existing Fastify/request logs; no new logger calls                            |
| Audit trail for sensitive mutations | ☐    | fee invoices inherit fees ledger; transport_fee_links is the transport-side record |
| Async job status (if exports)       | n/a  |                                                                                    |

---

## 6. Security & compliance

| Check                                | Done | Evidence                               |
| ------------------------------------ | ---- | -------------------------------------- |
| Tenant isolation                     | ☑    | RLS 045 + repo tenant filters          |
| RBAC matrix documented               | ☑    | PRODUCT §6                             |
| Export download auth                 | n/a  |                                        |
| Issued records immutable / versioned | n/a  | GPS pings append-only (unique ping_id) |

Device keys stored as SHA-256 hex only; plaintext returned once at registration.

---

## 7. Hand-off to production-ready **test** skill

| Check                                  | Done | Evidence                 |
| -------------------------------------- | ---- | ------------------------ |
| Test checklist copied & filled         | ☐    | deferred                 |
| Live write E2E (`E2E_BACKEND_READY=1`) | ☐    | spec added, **not run**  |
| Desktop + tablet + mobile captures     | ☐    | no browser in this slice |
| Tip CI green                           | ☐    | not claimed              |
| Scoreboard updated honestly            | ☐    |                          |

---

## Exit — capability 10/10

| Gate                            | Pass |
| ------------------------------- | ---- | --------------------------------------------------- |
| Peer parity for this slice      | ☐    | SVG map is a documented substitute, not peer GPS UX |
| Live SQL + seeds                | ☐    | schema shipped; not applied on a live cert DB here  |
| Live API writes                 | ☐    | unit + inject tests; live E2E not run               |
| UI inventory complete           | ☑    | staff pages added                                   |
| Rules tests green               | ☑    | evaluator unit tests                                |
| Board artifacts (if applicable) | n/a  |                                                     |
| Security evidence               | ☐    | RLS unit + code review; no live IDOR run            |
| Test skill complete             | ☐    |                                                     |
| CI green                        | ☐    |                                                     |

**Residuals / waivers (dated):**

| Residual                       | Owner                     | Date       |
| ------------------------------ | ------------------------- | ---------- |
| No MapLibre — SVG + OSM links  | G-920                     | 2026-09-09 |
| Anonymous device GPS ingest    | deferred — RLS tenant GUC | 2026-09-09 |
| Alert channel dispatch         | deferred                  | 2026-09-09 |
| Playwright / captures / tip CI | resource discipline       | 2026-09-09 |

**Verdict:** ☐ Not ready · ☑ Ready w/ waivers · ☐ **10/10 product slice**
