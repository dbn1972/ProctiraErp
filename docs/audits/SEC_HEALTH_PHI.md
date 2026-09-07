# Security — Health PHI vault

**Branch:** `cursor/health-phi-vault-56c3`  
**Date (UTC):** 2026-09-07

| Check                                 | Pass       | Evidence                                                  |
| ------------------------------------- | ---------- | --------------------------------------------------------- |
| Profile PHI on PG when `DATABASE_URL` | ☑          | `012_health_screenings_profile_schema.sql` + `PgPhiStore` |
| Screenings on PG                      | ☑          | `health_screening_programs`                               |
| Tenant filters on list/get            | ☑          | SQL `tenant_id` predicates + skipIf live test             |
| Counselling unchanged                 | ☑          | `PgCounsellingStore` still wired                          |
| Special-needs residual                | documented | Still in-memory (out of this slice exit)                  |

**Waivers:** live IdP · device-farm · special-needs PG (deferred)
