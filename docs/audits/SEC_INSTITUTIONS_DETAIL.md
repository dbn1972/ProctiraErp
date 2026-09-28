# Enterprise security & tenancy checklist

**Module:** Institutions detail  
**Date (UTC):** 2026-09-28

## 0. Inventory

- `GET /api/v1/institutions/:id/overview`
- Class teacher assignment (`PUT /classes/:id`) requires a staff id in the same tenant
- Section withdraw / unpublish already behind timetable auth; UI adds a confirm step only

## 1. Controls

| Control                    | Evidence                                                              | Disposition                    |
| -------------------------- | --------------------------------------------------------------------- | ------------------------------ |
| Cross-tenant institution   | `institution-overview.test.ts` returns null / Fastify 404             | **FULLY_CLOSED**               |
| Parent role                | same file, 403 when roles lack `institution:read`                     | **FULLY_CLOSED**               |
| Cross-tenant class teacher | `class-service.test.ts` NotFound                                      | **FULLY_CLOSED**               |
| IDOR on section withdraw   | Not re-proved in this session beyond existing timetable routes        | **PARTIAL**                    |
| Secrets                    | No new secrets. Local JWT is the dev secret                           | **FULLY_CLOSED** for this diff |
| PII                        | Overview returns counts and contact already stored on the institution | **PARTIAL**                    |

## 2. Findings

No new raw UUID is rendered as the sole label on the five screens' primary tables. Schedule section breadcrumb still shows a shortened UUID (**OPEN**, layout chrome).

## 3. Sign-off

Not a claim that the module is secure beyond the tests named above.
