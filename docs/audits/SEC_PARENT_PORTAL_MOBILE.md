# Enterprise security & tenancy checklist

**Module / slice:** Mobile parent portal children, messages, consents, fees  
**Branch / tip:** `cursor/mobile-parent-children-570e`  
**Date (UTC):** 2026-09-27  
**Data classes:** PII (child name, class), financial (invoice amounts), consent metadata  
**Paired test audit:** `docs/audits/MOBILE_PARENT_CHILDREN.md`

Copy of `docs/audits/templates/ENTERPRISE_SECURITY_TENANCY_CHECKLIST.md`.

---

## 0. Inventory

| Route / API | AuthN | AuthZ | Data class | Notes |
| ----------- | ----- | ----- | ---------- | ----- |
| `GET /api/v1/parent-portal/children` | Session Bearer | Parent actor from JWT; tenant from server context | PII | Mobile client sends no tenant id argument |
| `GET /api/v1/students/:id` | Session Bearer | Existing student route | PII | Best-effort name lookup for linked ids only. Failure stays "Name unavailable" |
| `GET /api/v1/parent-portal/children/:studentId/timetable` | Session Bearer | Parent link check on server | PII | Class label from `sectionName` |
| `GET /api/v1/parent-portal/messages/threads` | Session Bearer | Parent's threads; client filters `studentId` | PII | |
| `GET /api/v1/parent-portal/consents` | Session Bearer | Parent's consents; client filters `studentId` | PII | Read only on mobile |
| `GET /api/v1/parent-portal/fees/invoices` | Session Bearer | Default parent scope (not `scope=staff`) | Financial | Read only on mobile |

---

## 1. Controls

| Check                                   | Pass | Evidence |
| --------------------------------------- | ---- | -------- |
| Unauthenticated → sign-in / 401         | ☐    | Not re-proven live. Mobile router still sends unauthenticated users to `/login`. |
| RBAC deny / hide                        | ☐    | Server enforces parent actor. Mobile does not call `scope=staff`. |
| Cross-tenant IDOR blocked (API)         | ☐    | Backend unchanged. `tools/tenant-isolation-tests` not re-run. Existing parent routes take tenant from request context and actor from JWT. |
| Cross-tenant IDOR blocked (UI)          | ☐    | Home has no tenant field. Repository methods have no tenant parameter. Unit test asserts no `tenantId` query, no `X-Tenant-ID` set by the repository itself. |
| Write audit events (money/consent/PHI)  | ☑    | This slice does not write fees, consents, or messages. |
| No secrets/tokens in git or client logs | ☑    | Errors surface `message` only. No tokens committed. |
| Tenant isolation suite cited/run        | ☐    | Not run. Backend routes were not modified. |
| Input validation / abuse basics         | ☑    | Empty `studentId` is rejected before the list calls. Child id is a query param chosen from the server list. |

---

## 2. Findings

### P0

None introduced in this client. Cross-tenant proof was not repeated against a live API, so isolation is not claimed closed.

### P1

| ID | Finding | Disposition |
| --- | --- | --- |
| SEC-PP-M1 | Name lookup uses `GET /students/:id`, which is a broader student API than the parent link list | PARTIAL — only ids from `listChildren` are requested; 403/404 becomes "Name unavailable" |

### P2

Session Dio interceptor still attaches `X-Tenant-ID` from the signed-in tenant, matching the rest of the mobile app. This feature does not accept a tenant override.

---

## 3. Sign-off

**Secure claim:** not made. Disposition for this slice: **PARTIAL**.
