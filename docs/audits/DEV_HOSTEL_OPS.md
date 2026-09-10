# Enterprise module development checklist

**Capability / module:** Hostel ops (G-921) — mess, gate pass, fees, attendance  
**Branch / tip:** `cursor/w9-g916-library-hostel-56c3`  
**Owner / agent:** Wave 9 cloud agent  
**Date (UTC):** 2026-09-09  
**Peer parity target:** Fedena-class hostel: mess, gate pass, fee on allotment, night roll  
**Paired test audit:** e2e `apps/web/e2e/49-hostel-ops-write-smoke.spec.ts` (not executed)

---

## 0. Product contract

See `PRODUCT_HOSTEL_OPS.md`. Non-goals: turnstiles, nutrition analytics, SIS period attendance merge.

---

## 1. Domain model (SQL-first)

| Check                       | Done | Evidence                                                                                            |
| --------------------------- | ---- | --------------------------------------------------------------------------------------------------- |
| Versioned SQL               | ☑    | `db/sql/040_hostel_ops_schema.sql`                                                                  |
| Constraints / indexes / FKs | ☑    | gate-pass window check; unique roll per block/date                                                  |
| Multi-board seed            | ☐    | waived — campus ops                                                                                 |
| Domain unit tests           | ☑    | `hostel-ops.test.ts`                                                                                |
| Invariants                  | ☑    | decide only from requested; roll unique per block+date; fee invoice optional when fees port missing |

---

## 2. API / services

| Check             | Done | Evidence                                  |
| ----------------- | ---- | ----------------------------------------- |
| Tenant middleware | ☑    | existing hostel routes + ops              |
| Validation        | ☑    | TypeBox                                   |
| RBAC              | ☑    | gateway `hostel` resource                 |
| 409/422 on rules  | ☑    | already-decided gate pass ConflictError   |
| Fees via port     | ☑    | HostelFeesPort injected in domain-plugins |
| Cross-tenant      | ☑    | in-memory tenant filters + RLS 040        |

---

## 3–7. UI / integration / security / test

Staff pages under `/hostel/mess`, `/hostel/gate-passes`, `/hostel/fees`, `/hostel/attendance`. Parent/student portal UIs deferred (other streams). Test skill / captures / tip CI **not** claimed.

**Verdict:** Ready w/ waivers (Playwright not run, no captures, tip CI not claimed).
