# Security — Health PHI vault + field break-glass

**Branch:** `cursor/health-phi-breakglass-56c3` (extends `cursor/health-phi-vault-56c3`)  
**Date (UTC):** 2026-09-12  
**Data classes:** PHI (counselling case notes), meta (break-glass grants, access log)

## Vault baseline (prior)

| Check                                 | Pass       | Evidence                                                  |
| ------------------------------------- | ---------- | --------------------------------------------------------- |
| Profile PHI on PG when `DATABASE_URL` | ☑          | `012_health_screenings_profile_schema.sql` + `PgPhiStore` |
| Screenings on PG                      | ☑          | `health_screening_programs`                               |
| Tenant filters on list/get            | ☑          | SQL `tenant_id` predicates + skipIf live test             |
| Counselling unchanged encryption      | ☑          | `PgCounsellingStore` encrypts reason/case_notes/outcome   |
| Special-needs residual                | documented | PG since G-203; field ACL for findings **deferred**       |

## P0-09 field ACL + dual-control (this slice)

| Check                                            | Pass | Evidence                                                         |
| ------------------------------------------------ | ---- | ---------------------------------------------------------------- |
| Field ACL on `counselling.case_notes`            | ☑    | Redacted `[REDACTED]` without grant; plaintext with active grant |
| Health-local grant table (not platform-admin BG) | ☑    | `health_phi_break_glass` via `049_*` + `PgBreakGlassStore`       |
| Dual-control: requester ≠ approver               | ☑    | DB CHECK + service `BusinessRuleError` on self-approve           |
| TTL on approved grants                           | ☑    | `expires_at`; max 240 minutes                                    |
| PHI access audit includes `break_glass_id`       | ☑    | `health_phi_access_log.break_glass_id` on unredact read          |
| Unit/route deny + allow + audit                  | ☑    | `phi-breakglass.test.ts`, `routes.test.ts`                       |

### Inventory (new / changed)

| Route / API                                  | AuthZ                                      | Data class |
| -------------------------------------------- | ------------------------------------------ | ---------- |
| `GET …/counselling/sessions/student/:id`     | Coarse health + field ACL                  | PHI        |
| `POST /health/break-glass`                   | `hasHealthAccess`                          | meta       |
| `POST /health/break-glass/:id/approve\|deny` | `health_admin` / `system_admin` + dual-ctl | meta       |
| `GET /health/phi-access`                     | health admin/officer (existing)            | meta       |

### Findings

| Sev | Finding                                              | Fix / waiver                            |
| --- | ---------------------------------------------------- | --------------------------------------- |
| —   | None blocking for this slice                         | —                                       |
| P2  | Special-needs `findings` field ACL not in this slice | Deferred; same grant machinery reusable |

**Waivers:** live IdP · device-farm · platform-admin BG unchanged by design  
**Sign-off:** P0 field dual-control path safe to merge from security view for counselling case notes.
