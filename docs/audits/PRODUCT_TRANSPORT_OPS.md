# Enterprise product / IA checklist

**Module / slice:** Transport ops (Wave 9 / G-920) — stops, GPS ingest + live map, bus attendance, alerts, fee link  
**Branch / tip:** `cursor/w9-g920-transport-56c3`  
**Date (UTC):** 2026-09-09  
**Owner / agent:** Cloud agent (G-920)

Copy of `docs/audits/templates/ENTERPRISE_PRODUCT_IA_CHECKLIST.md`. Scope lock before schema/UI.

---

## 1. Capability statement

A tenant transport officer can maintain ordered route stops (name, lat/lng, scheduled times), assign students to a stop, ingest GPS pings from a per-vehicle device key so the last ping per bus is visible on a live map, mark boarded / alighted / absent for a trip (route × date × pickup|drop), configure delay / geofence / missed-pickup alert rules that evaluate against pings and attendance, and attach a route/stop-distance fee band so assigning a student to a stop posts a fee line through the existing Fees service (G-903) or records a pending link when that API is not wired.

## 2. Personas & jobs

| Persona                     | Job-to-be-done                                 | Success looks like                                         |
| --------------------------- | ---------------------------------------------- | ---------------------------------------------------------- |
| Transport officer           | Keep stop lists and student stop seats current | Ordered stops CRUD; assignment includes `stopId`           |
| Fleet / telematics operator | See where buses are without a map SDK          | Device-key GPS batch ingest; live SVG map + OSM deep links |
| Attendant / driver (staff)  | Record who boarded this trip                   | Trip roster with boarded / alighted / absent + counts      |
| Registrar / fees clerk      | Charge transport by stop distance              | Fee band → FeesService invoice (or honest pending link)    |
| Parent (out of this slice)  | See bus location                               | Non-goal this slice (staff shell only)                     |

## 3. Scope

| In scope                                                                    | Non-goals                                                                                         |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Ordered stops CRUD + student stop assignment UI                             | Native MapLibre / Leaflet / Google Maps (no new npm map deps)                                     |
| `POST /transport/gps` batch ingest (device key, idempotent deviceId+pingId) | Anonymous telematics without tenant JWT (FORCE RLS needs tenant GUC; device-only ingest deferred) |
| `GET /transport/live` last ping per vehicle + live SVG map                  | Live cellular provider / hardware GPS adapter                                                     |
| Trip bus attendance (pickup/drop) + summary                                 | RFID / scanner hardware (G-602 stub remains for that path)                                        |
| Alert rules + evaluator (unit-tested) + acknowledge list                    | SMS/email channel delivery (channels stored; dispatch deferred)                                   |
| Transport fee bands linked via FeesService                                  | Changing FeesService.createInvoice to accept `structureId`                                        |
| Staff dashboard under `/transport/*`                                        | Parent portal live map                                                                            |

## 4. Peer parity

| Peer capability                                       | Our target this slice                               |
| ----------------------------------------------------- | --------------------------------------------------- |
| Stop sequence + scheduled times (Versa Trans / Tyler) | Ordered stops with lat/lng + pickup/drop times      |
| Live GPS on a map                                     | Inline SVG projection + OSM deep link (no MapLibre) |
| Boarding attendance                                   | Per-trip status + counts                            |
| Delay / geofence / missed pickup alerts               | Rules + evaluator; in-app list + acknowledge        |
| Transport fee by distance/stop                        | Fee band + FeesService invoice or pending link      |

## 5. Surface map

| Nav label      | Route                          | API                                               | Tables / events                                    | Shell (staff / parent / public) |
| -------------- | ------------------------------ | ------------------------------------------------- | -------------------------------------------------- | ------------------------------- |
| Transport      | `/transport`                   | `/transport/*`                                    | overview                                           | staff                           |
| Routes         | `/transport/routes`            | `/transport/routes`                               | `transport_routes`                                 | staff                           |
| Route stops    | `/transport/routes/[id]/stops` | `/transport/stops`, `/transport/routes/:id/stops` | `transport_stops`                                  | staff                           |
| Live map       | `/transport/live`              | `GET /transport/live`, `POST /transport/gps`      | `transport_gps_pings`, `transport_vehicle_devices` | staff                           |
| Bus attendance | `/transport/attendance`        | `/transport/attendance`                           | `transport_bus_attendance`                         | staff                           |
| Alerts         | `/transport/alerts`            | `/transport/alert-rules`, `/transport/alerts`     | `transport_alert_rules`, `transport_alerts`        | staff                           |
| Transport fees | `/transport/fees`              | `/transport/fee-structures`                       | `transport_fee_structures`, `transport_fee_links`  | staff                           |
| Assignments    | `/transport/assignments`       | `/transport/student-assignments`                  | `transport_student_assignments` + fee link         | staff                           |

## 6. Roles & tenancy (high level)

| Role                         | Can                                                       | Cannot                                   |
| ---------------------------- | --------------------------------------------------------- | ---------------------------------------- |
| SUPER_ADMIN / tenant admin   | All transport writes                                      | Cross-tenant rows                        |
| Staff with `transport` write | Stops, GPS device register, attendance, rules, fees bands | Other tenants’ pings/alerts              |
| Staff with `transport` read  | Live map, lists                                           | Device key plaintext after issue; writes |
| Device (header key)          | Batch ping when JWT tenant matches registered device      | Cross-tenant deviceId                    |

Tenant boundary notes: every 045 table has `tenant_id`, ENABLE + FORCE RLS, `USING`/`WITH CHECK` on `app.tenant_id` (same contract as 036). GPS ingest still requires a tenant JWT so `withPgTenant` can bind RLS; the device key is a second factor bound to a vehicle in that tenant.

## 7. Success metrics / DoD

- [ ] Stops CRUD + assign student to a stop
- [ ] GPS batch ingest idempotent by deviceId+pingId; live map shows last ping
- [ ] Bus attendance mark + summary counts
- [ ] Alert evaluator unit-tested with synthetic pings
- [ ] Assign-to-stop creates a FeesService invoice **or** a pending `transport_fee_links` row
- [ ] E2E spec: ungated heading + env-gated stop → assign → GPS ping visible (not executed here)
- [ ] Gateway + web `tsc --noEmit` clean

## 8. Handoff

| Next skill | Audit path                                                               |
| ---------- | ------------------------------------------------------------------------ |
| Build      | `docs/audits/DEV_TRANSPORT_OPS.md`                                       |
| UX         | `docs/audits/UX_TRANSPORT_OPS.md`                                        |
| A11y       | `docs/audits/A11Y_TRANSPORT_OPS.md`                                      |
| Security   | `docs/audits/SEC_TRANSPORT_OPS.md`                                       |
| Test       | deferred — no Playwright/full E2E in this worktree (resource discipline) |
| Release    | not claimed                                                              |

---

## 9. P2-TRANSPORT honesty residual — live GPS (2026-09-12) — append only

**Register close:** `P2-TRANSPORT` → **DONE-with-dated-NON-GOAL** on `docs/audits/WAIVER_BOARD_P1_P2_2026-09-12.md`.  
**Does not rewrite** G-920 scope above. Live cellular / hardware GPS was already a §3 non-goal; this dates it for the P2 register.

| Tip proves                                                                                      | Dated NON-GOAL (2026-09-12)                                    |
| ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Ordered stops, trip boarding/alighted/absent, alert rules, transport fee bands                  | Live **cellular telematics provider** / hardware GPS adapter   |
| `POST /transport/gps` batch ingest + `GET /transport/live` last ping on **SVG** map + OSM links | MapLibre / Leaflet / Google Maps SDK (**PRD-010** still holds) |
| `db/sql/045_transport_ops_schema.sql`, `/transport/*`, `54-transport-ops-write-smoke.spec.ts`   | Parent portal live map (still out of G-920)                    |

**Forbidden claims:** live GPS hardware complete; MapLibre peer map. Re-open when a funded telematics adapter epic lands.
