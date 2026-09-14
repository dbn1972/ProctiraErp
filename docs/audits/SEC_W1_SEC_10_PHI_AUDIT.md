# Security — PHI read audit + gateway mutation audit (W1-SEC-10)

**Module / slice:** `@proctira/backend-health` PHI read trail · `api-gateway` mutation audit hook  
**Branch / tip:** `cursor/aud-w1-sec-10-phi-audit-56c3`  
**Date (UTC):** 2026-09-14  
**Data classes:** PHI (health reads) · PII / financial / custody (sensitive mutations)  
**Paired test audit:** unit — `phi-read-audit.test.ts`, `mutation-audit.test.ts`

---

## 0. Inventory

| Surface | AuthN | AuthZ | Data class | Notes |
| ------- | ----- | ----- | ---------- | ----- |
| HealthService PHI list/get | JWT / access context | health RBAC + guardian | PHI | `recordPhiReadAudit` before return |
| Gateway mutating `/api/v1/*` | JWT | RBAC registry | mixed | `onSend` → `persistMutationAudit` |

---

## 1. Controls

| Check | Pass | Evidence |
| ----- | ---- | -------- |
| PHI read auditor missing → fail closed in production | ☑ | `phi-read-audit.test.ts` · `PhiAuditUnavailableError` 503 |
| PHI auditor throw → fail closed in production | ☑ | wraps as `PhiAuditUnavailableError` |
| Explicit degrade `ALLOW_PHI_AUDIT_DEGRADE=1` | ☑ | missing/throw allowed only when flag set |
| Mutation audit failure always surfaced (logged) | ☑ | `app.ts` `request.log.error` — empty catch removed |
| Security-sensitive mutation audit fail closed in prod | ☑ | health/fees/scholarship/student/privacy/billing/… → 503 body |
| Explicit degrade `ALLOW_MUTATION_AUDIT_DEGRADE=1` | ☑ | `shouldFailClosedOnMutationAuditFailure` |
| No secrets in git | ☑ | flags documented in `.env.example` only |

---

## 2. Findings

### P0

| ID | Finding | Fix |
| --- | ------- | --- |
| W1-SEC-10 | PHI read audit silently no-oped when `logPhiAccess` missing; gateway mutation audit swallowed errors | Fail closed in production (or explicit degrade flags); log all mutation audit failures; 503 for sensitive paths |

### P1 / P2

| ID | Sev | Finding | Fix / waiver |
| --- | --- | ------- | ------------ |
| | | | |

---

## 3. Sign-off

| Claim | Status |
| ----- | ------ |
| P0 cleared | ☑ |
| P1 cleared or waived | ☑ (none) |
| Safe to merge from security view | ☑ |

**Residual risks:**

- **CLOSED for wired subset** — see `docs/audits/SEC_W1_SEC_10_COMPLETE.md` (same-txn audit for fees payments + health measurements; production degrade ignored).
- Remaining regulated routes still use post-hoc `onSend` (503 cannot roll back) — listed as residuals in the COMPLETE audit.
- `ALLOW_PHI_AUDIT_DEGRADE` must never be set in normal production; `ALLOW_MUTATION_AUDIT_DEGRADE` is ignored in production.
- Non-sensitive mutations (e.g. library/LMS) still log audit failures but do not fail closed — intentional scope bound to PHI/money/custody/privacy surfaces.
