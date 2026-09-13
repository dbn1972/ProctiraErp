# Security — Guardian household / custody model (W1-SEC-03 / D8)

**Module / slice:** Parent portal household custody graph + cross-household authZ  
**Branch / tip:** `cursor/guardian-custody-model-56c3`  
**Date (UTC):** 2026-09-13  
**Data classes:** PII (guardian↔student link, household membership); consent metadata; financial  
**Builds on:** P0-03 relationship-scoped authority (`#81`) — flags remain; this slice adds household graph

---

## 0. Inventory

| Route / API                         | AuthN      | AuthZ                                              | Data class | Notes                                      |
| ----------------------------------- | ---------- | -------------------------------------------------- | ---------- | ------------------------------------------ |
| Child reads / messaging / academic  | JWT parent | Active link + household custody overlap            | PII        | Cross-household → 404 (no existence leak)  |
| `listChildrenForParent`             | JWT parent | Filters links failing custody overlap              | PII        | Stale cross-household links hidden         |
| Fee list/pay + medical consent      | JWT parent | P0-03 flags **and** household custody gate         | Fin/consent| Unchanged 403 semantics on flag deny       |
| Staff household/custody provision   | JWT staff  | Not mounted in v1 slice — service methods for SQL/tests | —      | Backlog: staff UI + routes                 |
| Cross-tenant reads                  | JWT        | Tenant scope                                       | —          | Existing 404 isolation (unchanged)         |

---

## 1. Controls

| Check                                       | Pass | Evidence                                                       |
| ------------------------------------------- | ---- | -------------------------------------------------------------- |
| P0-03 relationship flags still on tip       | ☑    | `origin/main` `#81` — `canConsentMedical` / `canViewFees`      |
| Household + custody SQL model               | ☑    | `db/sql/054_guardian_household_custody.sql`                     |
| Cross-household deny (404)                  | ☑    | `household custody authZ (W1-SEC-03)` unit tests               |
| Backward compat (no custody rows → link-only)| ☑   | `preserves pre-custody link-only behaviour` test               |
| Cross-tenant IDOR unchanged                 | ☑    | Existing cross-tenant suite                                    |
| No secrets in git                           | ☑    | Schema + flags only                                            |

---

## 2. Findings

### P0

| ID  | Finding            | Fix |
| --- | ------------------ | --- |
| —   | None in this slice | —   |

### P1 / P2

| ID        | Sev | Finding                              | Fix / waiver                          |
| --------- | --- | ------------------------------------ | ------------------------------------- |
| G-CUST-1  | P2  | Staff REST routes for household CRUD | Backlog; SQL + service methods exist  |
| G-CUST-2  | P2  | Court-order document attachments     | NON-GOAL (same as P0-03 G-AUTHZ-2)    |

---

## 3. Sign-off

| Claim                                              | Status |
| -------------------------------------------------- | ------ |
| W1-SEC-03 (D8) household/custody model present     | ☑      |
| Cross-household negative authZ proved              | ☑      |
| Safe to merge from security view (this slice)      | ☑      |

**Residual risks:** Staff provisioning UI not shipped; custody effective-date transitions not automated.
