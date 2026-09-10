# Enterprise product / IA checklist

**Module / slice:** Hostel ops (G-921, Wave 9 S2)  
**Branch / tip:** `cursor/w9-g916-library-hostel-56c3`  
**Date (UTC):** 2026-09-09  
**Owner / agent:** Cloud agent (library/hostel stream)

Copy of `docs/audits/templates/ENTERPRISE_PRODUCT_IA_CHECKLIST.md`. Completed before schema/UI.

---

## 1. Capability statement

A warden can publish mess plans (plan × meals × weekly menu) and subscribe residents, run a gate-pass workflow (request → approve/reject → out/in scan with overdue-return flag), price hostel fees per room type × term, and take nightly roll call per block. Fees may consume a hostel fee summary without this slice editing the fees package.

## 2. Personas & jobs

| Persona            | Job-to-be-done                                                         | Success looks like                                            |
| ------------------ | ---------------------------------------------------------------------- | ------------------------------------------------------------- |
| Warden / admin     | Approve gate passes, scan out/in, take roll                            | Invalid transitions rejected; attendance upsert is idempotent |
| Resident (student) | Request a gate pass (staff shell or later student portal)              | Pass moves pending → approved → out → in                      |
| Parent             | Request a gate pass on behalf of a resident (API `requestedBy=parent`) | Same workflow; parent portal UI is out of this stream         |
| Fees officer       | Read hostel fee structures                                             | `GET /hostel/fee-structures/summary` (fees package untouched) |
| Mess supervisor    | Maintain weekly menu and subscriptions                                 | Plan + weekday meal items + resident subscription             |

## 3. Scope

| In scope                                                                     | Non-goals                                                        |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Mess plans, weekly menu items, resident subscriptions                        | Kitchen inventory, POS, dietitian clinical notes                 |
| Gate pass request / approve / reject / out / in + overdue-return flag        | Biometric gates, GPS geofence                                    |
| Hostel fee structure per room type × term + summary route                    | Posting invoices into `packages/backend/fees`                    |
| Nightly hostel attendance per block per date (present/absent/leave + reason) | Linking to SIS period attendance (`packages/backend/attendance`) |
| Dual in-memory + pg stores                                                   | Parent/student portal pages (other streams)                      |

## 4. Peer parity

| Peer capability           | Our target this slice                             |
| ------------------------- | ------------------------------------------------- |
| Fedena / Camu hostel mess | Plan + meals + weekly menu + subscription         |
| Campus gate register      | Request → warden decision → out/in timestamps     |
| Hostel fee head           | Room-type × term amount, consumable by fees later |
| Night roll call           | Per-block per-date upsert, leave reason           |

## 5. Surface map

| Nav label      | Route                 | API                                       | Tables / events                                       | Shell (staff / parent / public)      |
| -------------- | --------------------- | ----------------------------------------- | ----------------------------------------------------- | ------------------------------------ |
| Overview       | `/hostel`             | `/hostel`                                 | `hostels`                                             | Staff                                |
| Mess           | `/hostel/mess`        | `/hostel/mess-plans`, menu, subscriptions | `mess_plans`, `mess_menu_items`, `mess_subscriptions` | Staff                                |
| Gate passes    | `/hostel/gate-passes` | `/hostel/gate-passes` + transitions       | `gate_passes`                                         | Staff (parent request via API field) |
| Fee structures | `/hostel/fees`        | `/hostel/fee-structures`, `/summary`      | `hostel_fee_structures`                               | Staff                                |
| Attendance     | `/hostel/attendance`  | `/hostel/attendance` upsert/list          | `hostel_attendance`                                   | Staff                                |

## 6. Roles & tenancy (high level)

| Role              | Can                                          | Cannot                                              |
| ----------------- | -------------------------------------------- | --------------------------------------------------- |
| admin / principal | manage hostel (mess, gate, fees, attendance) | Cross-tenant rows                                   |
| teacher / staff   | read hostel                                  | Approve gate passes / mutate fees                   |
| student           | `hostel:read` (existing)                     | Approve/reject/out/in (staff manage)                |
| parent            | no hostel write in this slice                | Parent-portal gate-pass UI (deferred; other stream) |

Tenant boundary notes: every new table has `tenant_id` + `tenant_isolation` RLS on `app.tenant_id` with `FORCE ROW LEVEL SECURITY`.

## 7. Success metrics / DoD

- [x] Product contract recorded before SQL
- [ ] SQL `db/sql/040_hostel_ops_schema.sql` with RLS
- [ ] Unit: gate-pass invalid transition rejected, attendance upsert idempotent, tenant isolation
- [ ] E2E spec: request → approve → mark out → mark in (`apps/web/e2e/49-hostel-ops-write-smoke.spec.ts`)

## 8. Handoff

| Next skill | Audit path                                                                                        |
| ---------- | ------------------------------------------------------------------------------------------------- |
| Build      | `docs/audits/DEV_HOSTEL_OPS.md`                                                                   |
| UX         | Staff cards/forms; dedicated capture deferred                                                     |
| Security   | Tenant isolation + RLS unit                                                                       |
| Test       | `49-hostel-ops-write-smoke.spec.ts` (list-only here)                                              |
| Release    | Register G-921 in gap audit (this stream must not edit `ENTERPRISE_FABLE51_PRODUCT_GAP_AUDIT.md`) |
