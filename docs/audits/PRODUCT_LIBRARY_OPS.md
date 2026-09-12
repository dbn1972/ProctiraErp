# Enterprise product / IA checklist

**Module / slice:** Library ops (G-916, Wave 9 S2)  
**Branch / tip:** `cursor/w9-g916-library-hostel-56c3`  
**Date (UTC):** 2026-09-09  
**Owner / agent:** Cloud agent (library/hostel stream)

Copy of `docs/audits/templates/ENTERPRISE_PRODUCT_IA_CHECKLIST.md`. Completed before schema/UI.

---

## 1. Capability statement

A librarian can import a title from an ISBN, place and fulfil holds when copies are out, check a copy in or out by barcode, and assess a capped per-day overdue fine then mark it paid. Students and parents can search a read-only OPAC catalogue. Fees may consume a library fines summary without this slice editing the fees package.

## 2. Personas & jobs

| Persona           | Job-to-be-done                                                           | Success looks like                                                                      |
| ----------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| Librarian / admin | Catalog by ISBN, circulate by barcode, queue holds, collect fines        | Hold becomes ready when a copy returns; barcode checkout; fine assessed and marked paid |
| Student           | Find a title in OPAC; request a hold via staff (or later student portal) | OPAC search returns tenant catalogue rows                                               |
| Parent / guardian | Look up a title in OPAC                                                  | `library:read` on `GET /library/opac/search`                                            |
| Fees officer      | See open library fines for a student                                     | `GET /library/fines/summary` (port-style; fees package untouched)                       |

## 3. Scope

| In scope                                                                            | Non-goals                                                                                                                                                     |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ISBN lookup adapter: stub (default) + Open Library HTTP via `LIBRARY_ISBN_PROVIDER` | Live Open Library in unit tests (never call the network)                                                                                                      |
| Holds/reservations queue per title with position + ready expiry                     | Inter-library loan, MARC ingest, RFID                                                                                                                         |
| Copy barcode/accession + lookup + scan checkout/return                              | Physical scanner hardware drivers                                                                                                                             |
| OPAC read-only search for staff/student/parent                                      | Full student/parent portal OPAC shells (`apps/web/(student)` / `(parent)` not in this stream)                                                                 |
| Per-tenant fine policy (cents/day + cap), assess, list, mark paid, summary route    | Editing `packages/backend/fees`; live PSP posting beyond existing G-603 optional ledger port                                                                  |
| Dual in-memory + pg stores                                                          | Prisma for this path                                                                                                                                          |
| Circulation desk (checkout / return / renew) — **ships** (P2-LIB)                   | **Acquisitions** (vendors, POs, receiving, fund encumbrance, serials claiming) — **dated NON-GOAL 2026-09-12** (PRD-017); see `DEV_P2_LIB_CIRCULATION_ACQ.md` |

## 4. Peer parity

| Peer capability                         | Our target this slice                                                                          |
| --------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Follett Destiny / Koha ISBN cataloguing | Lookup fills title/author; librarian confirms before save                                      |
| Koha holds queue                        | FIFO position; first queued hold becomes `ready` when a copy returns; expires if not collected |
| Barcode circulation                     | Checkout/return by accession/barcode                                                           |
| Public OPAC                             | Read-only search of the tenant catalogue                                                       |
| Overdue fines with cap                  | Policy-driven amount, staff mark paid                                                          |

## 5. Surface map

| Nav label   | Route                  | API                                                  | Tables / events                          | Shell (staff / parent / public)           |
| ----------- | ---------------------- | ---------------------------------------------------- | ---------------------------------------- | ----------------------------------------- |
| Catalog     | `/library`             | `GET/POST /library/items`, `GET /library/isbn/:isbn` | `library_items`, `library_copies`        | Staff                                     |
| Title       | `/library/[id]`        | `GET /library/items/:id`, holds                      | `library_holds`                          | Staff                                     |
| Circulation | `/library/circulation` | checkout/return + barcode                            | `library_loans`, `library_copies`        | Staff                                     |
| Overdues    | `/library/overdues`    | `GET /library/overdues`                              | `library_loans`                          | Staff                                     |
| Fines       | `/library/fines`       | assess / list / pay / summary                        | `library_fine_policies`, `library_fines` | Staff                                     |
| OPAC        | `/library/opac`        | `GET /library/opac/search?q=`                        | `library_items`                          | Staff (read-only); parent/student via API |

## 6. Roles & tenancy (high level)

| Role              | Can                                                 | Cannot                                      |
| ----------------- | --------------------------------------------------- | ------------------------------------------- |
| admin / principal | manage library (catalog, holds, fines, circulation) | Cross-tenant rows                           |
| teacher / staff   | read library (OPAC, catalog)                        | Assess fines / mutate catalog unless manage |
| student           | `library:read` including OPAC                       | Assess fines, mutate catalog                |
| parent            | `library:read` including OPAC (G-916)               | Staff circulation writes                    |

Tenant boundary notes: every new table has `tenant_id` + `tenant_isolation` RLS on `app.tenant_id` with `FORCE ROW LEVEL SECURITY`. In-memory store filters by `tenantId`.

## 7. Success metrics / DoD

- [x] Product contract recorded before SQL
- [ ] SQL `db/sql/039_library_ops_schema.sql` with RLS
- [ ] Unit: hold queue order + expiry, fine cap, barcode lookup, tenant isolation
- [ ] E2E spec: hold → copy returned → hold ready → checkout by barcode → overdue → assess fine → mark paid (`apps/web/e2e/48-library-ops-write-smoke.spec.ts`)
- [ ] Gateway: parent + student OPAC read

## 8. Handoff

| Next skill | Audit path                                                                                                  |
| ---------- | ----------------------------------------------------------------------------------------------------------- |
| Build      | `docs/audits/DEV_LIBRARY_OPS.md`                                                                            |
| UX         | Staff shells reuse campus cards/forms; dedicated UX capture deferred (no browser in this stream)            |
| Security   | Tenant isolation tests in package + RLS unit                                                                |
| Test       | `48-library-ops-write-smoke.spec.ts` (list-only in this stream; live `E2E_BACKEND_READY` not executed here) |
| Release    | Register G-916 in gap audit (this stream must not edit `ENTERPRISE_FABLE51_PRODUCT_GAP_AUDIT.md`)           |
