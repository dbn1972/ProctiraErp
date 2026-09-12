# Security — Guardian relationship authZ (P0-03)

**Module / slice:** Parent portal relationship-scoped authority  
**Branch / tip:** `cursor/guardian-relationship-authz-56c3`  
**Date (UTC):** 2026-09-12  
**Data classes:** PII (guardian↔student link); consent metadata; financial (fee invoices) — not PHI vault  
**Paired product audit:** `docs/audits/PRODUCT_GUARDIAN_RELATIONSHIP_AUTHZ.md`

---

## 0. Inventory

| Route / API | AuthN | AuthZ | Data class | Notes |
| ----------- | ----- | ----- | ---------- | ----- |
| `decideConsent` (medical_treatment) | JWT parent | Active link + `canConsentMedical` | Consent | Linked without flag → 403 |
| `listInvoicesForParent` / `payInvoice` | JWT parent | Active link + `canViewFees` | Financial | List filtered; pay → 403 if flag false |
| Messaging / academic child reads | JWT parent | Active link only | PII | Unchanged binary link gate |
| Cross-tenant reads | JWT | Tenant scope | — | Existing 404 isolation |

---

## 1. Controls

| Check | Pass | Evidence |
| ----- | ---- | -------- |
| Unlinked → 404 on fee pay | ☑ | `relationship-scoped authority` + academic unlinked tests |
| RBAC / flag deny (403) | ☑ | Two-parent medical + fee deny unit tests |
| Cross-tenant IDOR blocked (API) | ☑ | Existing cross-tenant suite + fee pay tenant B 404 |
| Cross-guardian same-student deny | ☑ | `PARENT_PRIMARY` allow / `PARENT_LIMITED` deny |
| No secrets in git | ☑ | Flags only; no tokens |
| Input validation | ☑ | Optional booleans on `LinkChildSchema` |

---

## 2. Findings

### P0

| ID | Finding | Fix |
| -- | ------- | --- |
| — | None in this slice | — |

### P1 / P2

| ID | Sev | Finding | Fix / waiver |
| -- | --- | ------- | ------------ |
| G-AUTHZ-1 | P2 | Staff UI to edit flags post-link not shipped | Backlog; link-time optional flags + SQL columns |
| G-AUTHZ-2 | P2 | Court-order / custody document model out of scope | NON-GOAL this slice |

---

## 3. Sign-off

| Claim | Status |
| ----- | ------ |
| P0 cleared for relationship-scoped gates | ☑ |
| Safe to merge from security view (this slice) | ☑ |

**Residual risks:** Flag mutation after link requires staff/ops SQL or follow-up API; household multi-student custody graphs not modelled.
