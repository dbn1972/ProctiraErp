# Security — W1-SEC-03 COMPLETE (guardian custody restrictions)

**Module / slice:** Parent portal — fail-closed custody + effective-dated court/restriction orders  
**Branch / tip:** `cursor/w1-sec-03-custody-complete-56c3`  
**Date (UTC):** 2026-09-14  
**Data classes:** PII (guardian↔student link, household membership, court-order refs); consent; financial  
**Builds on:** W1-SEC-03 PARTIAL `#110` / W3-C5 `#168` (household/custody graph); P0-03 relationship flags `#81`  
**Paired prior audit:** `docs/audits/SEC_GUARDIAN_HOUSEHOLD_CUSTODY.md` (PARTIAL)

---

## 0. Inventory

| Route / API | AuthN | AuthZ | Data class | Notes |
| ----------- | ----- | ----- | ---------- | ----- |
| Child reads / messaging / academic | JWT parent | Active link **+** effective custody overlap **+** no `blocks_all_access` restriction | PII | Missing custody → 404 (fail closed) |
| `listChildrenForParent` | JWT parent | Same custody + restriction filter | PII | Stale / unrestricted-missing links hidden |
| Fee list/pay | JWT parent | Custody + `canViewFees` + no active fee restriction | Financial | Restricted → 403 / empty list |
| Medical consent decide | JWT parent | Custody + `canConsentMedical` + no active medical restriction | Consent | Restricted → 403 |
| Staff restriction / custody provision | Service API | Not mounted in v1 UI — service methods for SQL/tests | — | Backlog: staff REST |

---

## 1. Controls

| Check | Pass | Evidence |
| ----- | ---- | -------- |
| Effective-dated restriction table | ☑ | `db/sql/076_guardian_custody_restrictions.sql` |
| Custody effective window enforced | ☑ | `listActiveCustodyHouseholdIdsForStudent` filters `effective_from` / `effective_to` |
| Missing custody denies access | ☑ | `hasHouseholdCustodyAccess` returns false when no active custody; unit test `denies access when custody data is missing` |
| Governed ops require non-restricted authority | ☑ | `assertParentAuthority` + fee list filter; unit test `suspends governed medical/fee authority…` |
| Cross-household deny retained | ☑ | Existing W1-SEC-03 cross-household suite |
| RLS on guardian_* + restrictions | ☑ | 076 ENABLE/FORCE + `tenant_isolation` (app_tenant_id when present) |
| Demo seed fail-closed compatible | ☑ | `076b_guardian_custody_demo_seed.sql` |
| No secrets in git | ☑ | Schema + service only |

---

## 2. Findings

### P0

| ID | Finding | Fix |
| --- | ------- | --- |
| W1-SEC-03 | Missing custody fail-opened; court/restriction orders absent | Fail closed; `guardian_custody_restrictions` + service gates |

### P1 / P2

| ID | Sev | Finding | Fix / waiver |
| -- | --- | ------- | ------------ |
| G-CUST-1 | P2 | Staff REST routes for household/restriction CRUD | Backlog; service methods exist |
| G-CUST-2 | P2 | Court-order document attachments / binary evidence store | NON-GOAL (ref string only) |

---

## 3. Sign-off

| Claim | Status |
| ----- | ------ |
| W1-SEC-03 PARTIAL → COMPLETE | ☑ |
| Effective-dated restrictions present | ☑ |
| Governed ops require explicit non-restricted authority | ☑ |
| Missing custody data denies access | ☑ |
| P0 cleared | ☑ |
| Safe to merge from security view (this slice) | ☑ |

**Residual risks:** Staff provisioning UI not shipped; restriction lift workflow is row `status='lifted'` / `effective_to` only (no dedicated staff console).
