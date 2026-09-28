# Enterprise security & tenancy checklist

**Module / slice:** Institutions reactivate  
**Branch / tip:** `cursor/institution-reactivate-d00d`  
**Date (UTC):** 2026-09-28  
**Data classes:** school operational status; reason is operational text, not PHI  
**Paired test audit:** `apps/api-gateway/src/institution-reactivate.test.ts`

## 0. Inventory

| Route / API                                | AuthN | AuthZ                | Data class  | Notes           |
| ------------------------------------------ | ----- | -------------------- | ----------- | --------------- |
| `POST /api/v1/institutions/:id/reactivate` | JWT   | `institution:update` | operational | reason required |

## 1. Controls

| Check                   | Pass | Evidence                                                                   |
| ----------------------- | ---- | -------------------------------------------------------------------------- |
| Unauthenticated → 401   | ☑    | gateway `onRequest` auth hook (same as deactivate)                         |
| RBAC deny               | ☑    | parent role → 403 `FORBIDDEN` in `institution-reactivate.test.ts`          |
| Cross-tenant IDOR (API) | ☑    | other tenant JWT → 404 `NOT_FOUND`                                         |
| Cross-tenant IDOR (UI)  | ☐    | UI uses the session tenant; no second-tenant browser session in this slice |
| Write audit             | ☑    | actor, reason, before/after status on the audit row                        |
| Secrets                 | ☑    | no tokens committed                                                        |
| Input validation        | ☑    | reason 1–500, UUID path param                                              |

## 2. Findings

No P0. UI cross-tenant walk is not separately browser-proven in this slice; API deny is proven. Disposition for the API control: evidence in the gateway unit test. Live browser proof is tracked with the Playwright spec.
