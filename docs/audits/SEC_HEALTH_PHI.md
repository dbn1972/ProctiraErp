# Security — Health PHI vault + field break-glass + institution scope

**Branch:** `cursor/health-phi-authz-56c3` (extends `cursor/health-phi-breakglass-56c3`)  
**Date (UTC):** 2026-09-13  
**Data classes:** PHI (counselling case notes, profile fields), meta (break-glass grants, access log)

## Vault baseline (prior)

| Check                                 | Pass       | Evidence                                                  |
| ------------------------------------- | ---------- | --------------------------------------------------------- |
| Profile PHI on PG when `DATABASE_URL` | ☑          | `012_health_screenings_profile_schema.sql` + `PgPhiStore` |
| Screenings on PG                      | ☑          | `health_screening_programs`                               |
| Tenant filters on list/get            | ☑          | SQL `tenant_id` predicates + skipIf live test             |
| Counselling unchanged encryption      | ☑          | `PgCounsellingStore` encrypts reason/case_notes/outcome   |
| Special-needs residual                | documented | PG since G-203; field ACL for findings **deferred**       |

## P0-09 field ACL + dual-control (merged #82)

| Check                                            | Pass | Evidence                                                         |
| ------------------------------------------------ | ---- | ---------------------------------------------------------------- |
| Field ACL on `counselling.case_notes`            | ☑    | Redacted `[REDACTED]` without grant; plaintext with active grant |
| Health-local grant table (not platform-admin BG) | ☑    | `health_phi_break_glass` via `049_*` + `PgBreakGlassStore`       |
| Dual-control: requester ≠ approver               | ☑    | DB CHECK + service `BusinessRuleError` on self-approve           |
| TTL on approved grants                           | ☑    | `expires_at`; max 240 minutes                                    |
| PHI access audit includes `break_glass_id`       | ☑    | `health_phi_access_log.break_glass_id` on unredact read          |
| Unit/route deny + allow + audit                  | ☑    | `phi-breakglass.test.ts`, `routes.test.ts`                       |

## W1-SEC-04 (D7) institution scope + scoped DEK (this slice)

| Check                                              | Pass | Evidence                                                              |
| -------------------------------------------------- | ---- | --------------------------------------------------------------------- |
| Break-glass on tip                                 | ☑    | **ALREADY-FIXED** — merged `10ec6b94` (#82); not re-litigated         |
| Institution-scoped PHI DEK (not single global key) | ☑    | `enc:v2` HMAC-derived key per `{tenantId, institutionId}`             |
| Legacy `enc:v1` read compat                        | ☑    | `phi-crypto.test.ts`, `phi-crypto-scoped.test.ts`                     |
| School-bound staff denied cross-institution PHI    | ☑    | `hasHealthAccess` + `institutionIds` JWT claim; `health-institution-authz.test.ts` |
| Enrollment institution lookup                      | ☑    | `pg-student-institution-lookup.ts` → `enrollments.institution_id`   |
| Gateway JWT → domain context (not D2 route guards) | ☑    | `health-ui-plugin.ts` passes `institutionIds`                         |

### Findings disposition

| Original finding              | Disposition     | Evidence                                      |
| ----------------------------- | --------------- | --------------------------------------------- |
| No break-glass                | **REFUTED**     | P0-09 on tip: `PgBreakGlassStore`, routes, tests |
| PHI single global key         | **CONFIRMED→FIX** | `enc:v2` scoped DEK in `phi-crypto.ts`      |
| No institution scoping        | **CONFIRMED→FIX** | `HealthAccessContext.institutionIds` + lookup |

**Waivers:** live IdP · device-farm · platform-admin BG unchanged by design  
**Sign-off:** W1-SEC-04 gaps closed for counselling/profile PHI crypto + school-bound authZ.
