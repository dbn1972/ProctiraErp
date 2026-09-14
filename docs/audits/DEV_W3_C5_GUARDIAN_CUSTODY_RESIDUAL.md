# DEV — W3-C5 Guardian household / custody residual

**Verdict:** FIX — W3-TEST-03 import regression + live Postgres custody invariants  
**Branch:** `cursor/guardian-custody-residual-56c3`  
**Builds on:** W1-SEC-03 `#110` (household/custody graph + unit authZ)

---

## 1. Re-verification

| Gap | Tip status | W3-C5 action |
| --- | ---------- | ------------ |
| Household + custody SQL (`054`) | ☑ merged `#110` | Re-verified — no schema change |
| Cross-household 404 authZ (service) | ☑ unit tests | Re-verified — logic unchanged |
| Live Postgres custody persistence | ✗ missing from W3-TEST-01 | **Added** 2 live cases |
| `pg-parent-portal-repository.live.test.ts` parse | ✗ W3-TEST-03 regression | **Fixed** broken import block |

**Soft-merge items (already on tip):** P0-03 relationship flags, `hasHouseholdCustodyAccess` gate on all parent reads, SEC audit `docs/audits/SEC_GUARDIAN_HOUSEHOLD_CUSTODY.md`.

---

## 2. Confirmed hole closed

**W3-TEST-03 merge bug:** `requireLiveDatabaseUrl` was inserted inside an `import { … }` block in `pg-parent-portal-repository.live.test.ts`, making the live suite unparseable and blocking the live gate from exercising parent-portal Postgres proofs.

**Fix:** Move `DATABASE_URL` resolution after imports; add W3-C5 live invariants:

1. Repository — household/member/custody persist; `custody_type = 'none'` excluded; tenant B sees empty lists.
2. Service — `ParentPortalService` cross-household deny (`NotFoundError`) on live `PgParentPortalRepository`.

**Evidence:** `packages/backend/parent-portal/src/pg-parent-portal-repository.live.test.ts`

---

## 3. Residual (unchanged, P2 backlog)

| ID | Item |
| -- | ---- |
| G-CUST-1 | Staff REST routes for household CRUD |
| G-CUST-2 | Court-order document attachments (NON-GOAL) |
| — | Custody `effective_to` automation |

---

## 4. Sign-off

| Claim | Status |
| ----- | ------ |
| W1-SEC-03 model present on tip | ☑ |
| Live Postgres custody invariant proof | ☑ (W3-C5) |
| Unit custody authZ suite green | ☑ (24 tests) |
