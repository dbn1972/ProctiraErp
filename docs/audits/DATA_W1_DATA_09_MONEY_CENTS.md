# DATA — W1-DATA-09 money cents residual (fees / billing)

**Module / slice:** Fees PG money mapping + billing plan prices  
**Branch / tip:** `cursor/aud-w1-data-09-money-cents-56c3`  
**Date (UTC):** 2026-09-14  

## Finding

Residual `Number(bigint)` / `Math.round(Number(…))` on fees money paths (and billing `Type.Number` plan prices labeled cents) violate integer-minor-unit guarantees.

## Scope

- `pgIntegerCents` / `pgOptionalIntegerCents` in `@proctira/common`
- Fees PG mappers + SUM aggregates + recon CSV
- Billing plan prices → `Type.Integer` + service assert
- Regression tests

## Non-goals

Monorepo-wide sweep; **scholarship NUMERIC major units** (closed in `DATA_W1_DATA_09_COMPLETE.md`); admissions `fee_amount NUMERIC`.

## Sign-off

Certified w/ waivers (fees/billing residual only). Superseded for scholarships by `DATA_W1_DATA_09_COMPLETE.md`.
