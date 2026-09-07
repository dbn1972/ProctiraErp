# Product / IA — Health PHI vault

**Module / slice:** Move screenings + student-profile PHI off in-memory onto Postgres  
**Branch:** `cursor/health-phi-vault-56c3`  
**Date (UTC):** 2026-09-07

## Capability

When `DATABASE_URL` is set, measurements, allergies, conditions, vaccinations, insurance, and screening programs persist in Postgres (raw `pg`). Counselling remains on its existing PG store. Special-needs entities stay in-memory (documented residual).

## Scope

| In                                          | Out              |
| ------------------------------------------- | ---------------- |
| SQL `012_*` + `PgPhiStore` + hybrid overlay | Special-needs PG |
| SEC audit                                   | Live IdP E2E     |
| SkipIf live smoke                           | Device-farm      |

## DoD

- [x] Unit / hybrid persistence flag + skipIf PG smoke
- [ ] Tip CI + merge
