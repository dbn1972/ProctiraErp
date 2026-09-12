# Product / IA — Health PHI vault

**Module / slice:** Move screenings + student-profile PHI off in-memory onto Postgres; **P0-09** field ACL + health-local break-glass for counselling case notes  
**Branch:** `cursor/health-phi-breakglass-56c3` (prior vault: `cursor/health-phi-vault-56c3`)  
**Date (UTC):** 2026-09-12

## Capability

When `DATABASE_URL` is set, measurements, allergies, conditions, vaccinations, insurance, and screening programs persist in Postgres (raw `pg`). Counselling remains on its existing PG store. **Counselling `caseNotes` are field-ACL redacted** unless the actor holds an active dual-control health break-glass grant (TTL); unredacted reads audit `break_glass_id` on `health_phi_access_log`.

## Scope

| In                                          | Out                                   |
| ------------------------------------------- | ------------------------------------- |
| SQL `012_*` + `PgPhiStore` + hybrid overlay | Platform-admin `/break-glass` rewrite |
| SQL `049_*` health break-glass + field ACL  | Special-needs findings field ACL      |
| SEC audit                                   | Parent-portal authZ / fees / backup   |
| SkipIf live smoke                           | Live IdP E2E · device-farm            |

## DoD

- [x] Unit / hybrid persistence flag + skipIf PG smoke
- [x] Field ACL redaction + break-glass dual-control + audit (`DEV_HEALTH_PHI_BREAKGLASS.md`)
- [ ] Tip CI + merge
