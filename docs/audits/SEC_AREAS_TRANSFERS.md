# Enterprise security & tenancy checklist

**Module / slice:** Area labels (`GET /api/v1/areas/tree`) and transfer detail (`GET /api/v1/transfers/:id`)
**Branch / tip:** `cursor/transfers-areas-rbac-e554`
**Date (UTC):** 2026-09-27
**Data classes:** PII (student name on a transfer) / operational (area names)
**Paired test audit:** `apps/api-gateway/src/rbac-enforcement.test.ts`, `packages/backend/student/src/enrollment/enrollment-routes.test.ts`

---

## 0. Inventory

| Route / API                 | AuthN | AuthZ                                                 | Data class  | Notes                                                                                    |
| --------------------------- | ----- | ----------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------- |
| `GET /api/v1/areas/tree`    | JWT   | `institution:read` (teacher, staff, principal, admin) | operational | Parent is denied. Tree is filtered by the JWT tenant.                                    |
| `GET /api/v1/transfers/:id` | JWT   | `student:read`                                        | PII         | Missing id and another tenant's id both return 404. HR officer (no student read) is 403. |

---

## 1. Controls

| Check                                   | Pass | Evidence                                                                        |
| --------------------------------------- | ---- | ------------------------------------------------------------------------------- |
| Unauthenticated → sign-in / 401         | ☑    | Gateway inject without a bearer token on `GET /areas/tree`                      |
| RBAC deny / hide                        | ☑    | Parent 403 on areas; HR officer 403 on transfers                                |
| Cross-tenant IDOR blocked (API)         | ☑    | Area tree omits the other tenant's name; transfer id from another tenant is 404 |
| Cross-tenant IDOR blocked (UI)          | ☐    | Not exercised in a browser this slice                                           |
| Write audit events (money/consent/PHI)  | ☑    | Read-only routes; no new write                                                  |
| No secrets/tokens in git or client logs | ☑    | No credentials added                                                            |
| Tenant isolation suite cited/run        | ☑    | Route test + gateway RBAC test (in-memory). Live Postgres RLS not re-run here   |
| Input validation / abuse basics         | ☑    | Transfer id must be a UUID or the route returns 400                             |

---

## 2. Findings

### P0

| ID  | Finding                      | Fix |
| --- | ---------------------------- | --- |
| —   | None open on these two reads | —   |

### P1 / P2

| ID   | Sev | Finding                                                                            | Fix / waiver            |
| ---- | --- | ---------------------------------------------------------------------------------- | ----------------------- |
| UI-1 | P2  | Cross-tenant deny is proven on the API, not on the institution or transfer screens | Browser pass still open |

---

## 3. Sign-off

| Claim                            | Status                                                                             |
| -------------------------------- | ---------------------------------------------------------------------------------- |
| P0 cleared                       | ☑                                                                                  |
| P1 cleared or waived             | ☑ UI cross-tenant remains P2                                                       |
| Safe to merge from security view | ☑ for the API slice; not a production-ready claim for the whole institution module |

**Residual risks:** Approval and equivalency lists on the transfer payload are empty because `transfer_records` does not store that workflow. The dashboard must not treat an empty list as a completed approval chain beyond the recorded transfer itself.
