# Enterprise module development checklist

**Capability / module:** Institutions — reactivate  
**Branch / tip:** `cursor/institution-reactivate-d00d` (live Playwright passed locally against Sunrise seed; Vasundhara left `inactive`)  
**Owner / agent:** cloud agent  
**Date (UTC):** 2026-09-28  
**Peer parity target:** A registrar can return an inactive school to ACTIVE the same way they deactivated it, with a reason and an audit row.  
**Paired test audit:** `docs/audits/SEC_INSTITUTIONS_REACTIVATE.md`

## 0. Product contract

| Item                 | Content                                                                                                                                                                                                                                  |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Capability statement | A principal with `institution:update` can reactivate an inactive institution. The school returns to ACTIVE, the deactivation reason is cleared, new enrollments are allowed again, and the directory status pill and row counts refresh. |
| In scope             | `POST /api/v1/institutions/:id/reactivate`, list overflow menu, detail header control, audit row, Playwright keyboard path.                                                                                                              |
| Explicit non-goals   | No new SQL table. Deactivate does not emit an outbox or `institution.deactivated` runtime event, so reactivate does not add one. Seeded Vasundhara Enclave stays inactive.                                                               |
| Roles (RBAC)         | `institution:update` (principal, admin via manage). Parent → 403. Cross-tenant → 404.                                                                                                                                                    |
| Boards impacted      | CBSE ☐ ICSE ☐ State ☐ Other: status is board-neutral                                                                                                                                                                                     |

| Nav / surface       | Route                        | API                                 | Tables                                                            | PII                 |
| ------------------- | ---------------------------- | ----------------------------------- | ----------------------------------------------------------------- | ------------------- |
| Institutions list ⋮ | `/institutions`              | `POST /institutions/:id/reactivate` | `institutions.status`, `custom_data.__profile.deactivationReason` | school name, reason |
| Detail header       | `/institutions/:id/overview` | same                                | same                                                              | same                |

## 1. Domain model

No new migration. Status already lives on `institutions.status`. Deactivation reason stays in the `__profile` envelope. Reactivate sets status `ACTIVE` and `deactivationReason` null. Deactivate does not delete enrollments, staff, or attendance, so reactivate does not rewrite them. `EnrollmentService.createEnrollment` already rejects a non-ACTIVE institution; `isActive` flips back to true.

## 2. API

| Check             | Done | Evidence                                                |
| ----------------- | ---- | ------------------------------------------------------- |
| Tenant middleware | ☑    | `findById(id, tenantId)` → 404                          |
| Validation        | ☑    | reason required, min 1, max 500, same as deactivate     |
| RBAC              | ☑    | inventory rule `institution.reactivate` action `update` |
| Wrong state       | ☑    | already ACTIVE → 422 `BUSINESS_RULE_ERROR`              |
| Cross-tenant      | ☑    | gateway test 404                                        |

## 3. UI

List menu shows Reactivate only for `INACTIVE`. Detail header shows Reactivate when the school is inactive (deactivate itself stays on the list menu). ConfirmActionDialog collects a reason. Success toast, `router.refresh()`, list fetch remains `cache: 'no-store'`.

## 4. Cross-module

Enrollment guard follows status. Directory row metrics hide counts while inactive and show them again when active. Reporting-today KPI is today's attendance, not the active-school count, so it does not move with this write. Schools KPI is the catalog total and stays stable.

## 5. Observability

Audit row: actor (`userId` / `userName`), reason, before status/reason, after status/reason. Metadata action `institution.reactivate`. No outbox (deactivate does not emit one).

## 6. Security

See `docs/audits/SEC_INSTITUTIONS_REACTIVATE.md`.
