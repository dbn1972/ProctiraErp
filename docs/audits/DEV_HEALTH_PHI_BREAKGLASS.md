# DEV — Health PHI field ACL + break-glass (P0-09)

**Capability / module:** Health — counselling case-notes field ACL + dual-control break-glass  
**Branch / tip:** `cursor/health-phi-breakglass-56c3`  
**Owner / agent:** cloud agent  
**Date (UTC):** 2026-09-12  
**Peer parity target:** Ed-health privacy — temporary unredaction of sensitive notes requires dual control + audit (not platform-admin tenant BG)  
**Paired SEC audit:** `docs/audits/SEC_HEALTH_PHI.md`

## 0. Product contract

| Item                   | Content                                                                                                                                                                                                    |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Capability statement   | Staff with coarse health access see counselling **case notes** redacted unless they hold an active health-local break-glass grant (dual-control, TTL). Unredacted reads are audited with `break_glass_id`. |
| In scope (peer parity) | Field ACL on `counselling.case_notes`; `health_phi_break_glass` grants; extend `health_phi_access_log`                                                                                                     |
| Explicit non-goals     | Platform-admin `/break-glass` rewrite; parent-portal authZ; special-needs findings ACL (deferred); fees/money; backup evidence; gateway mount-matrix; TASKS edits                                          |
| Roles (RBAC)           | Request: health-authorized (`hasHealthAccess`). Approve/deny: `health_admin` / `system_admin`. Requester ≠ approver.                                                                                       |
| Boards impacted        | N/A (health privacy, not board marksheet)                                                                                                                                                                  |

Screen / API inventory:

| Nav / surface            | Route / API                                    | Tables                   | PII/PHI |
| ------------------------ | ---------------------------------------------- | ------------------------ | ------- |
| Counselling list (field) | `GET /health/counselling/sessions/student/:id` | `counselling_sessions`   | PHI     |
| Break-glass request      | `POST /health/break-glass`                     | `health_phi_break_glass` | meta    |
| Break-glass approve/deny | `POST /health/break-glass/:id/approve\|deny`   | `health_phi_break_glass` | meta    |
| PHI access audit         | `GET /health/phi-access`                       | `health_phi_access_log`  | meta    |

## 1. Domain model (SQL-first)

| Check                         | Done | Evidence                                        |
| ----------------------------- | ---- | ----------------------------------------------- |
| Versioned SQL under `db/sql/` | ☑    | `049_health_phi_breakglass_schema.sql`          |
| Constraints / indexes / FKs   | ☑    | status/duration checks; requester≠approver; RLS |
| Multi-board seed fixtures     | ☐    | N/A for this slice                              |
| Domain unit/property tests    | ☑    | `phi-breakglass.test.ts`, `routes.test.ts`      |
| Invariants documented         | ☑    | Dual-control + TTL + field path enum            |

## 2. API / services

| Check                           | Done | Evidence                                      |
| ------------------------------- | ---- | --------------------------------------------- |
| Tenant middleware on all routes | ☑    | Existing health tenant guard                  |
| Validation + typed errors       | ☑    | `CreateHealthBreakGlassRequestSchema`         |
| RBAC enforced                   | ☑    | Field ACL + approver roles                    |
| Cross-tenant deny               | ☑    | Existing tenant predicates + RLS on new table |

## 5. Observability & audit

| Check                                | Done | Evidence                                      |
| ------------------------------------ | ---- | --------------------------------------------- |
| PHI unredact writes `break_glass_id` | ☑    | `resourceType=counselling_session.case_notes` |

## Exit

Minimal DoD for P0-09 met in package `@proctira/backend-health` with unit/route proof. Tip CI / merge are parent release gates.
