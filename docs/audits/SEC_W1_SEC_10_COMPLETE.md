# Security — W1-SEC-10 COMPLETE (atomic regulated mutation audit)

**Module / slice:** `api-gateway` mutation audit · `@proctira/backend-audit` same-txn helpers · fees payment · health measurement  
**Branch / tip:** `cursor/w1-sec-10-audit-complete-56c3`  
**Date (UTC):** 2026-09-14  
**Data classes:** PHI (health measurements) · financial (fees payments) · PII / custody / privacy (residual post-hoc)  
**Paired test audit:** `txn-mutation-audit.test.ts` · `mutation-audit.test.ts`  
**Prior slice:** `docs/audits/SEC_W1_SEC_10_PHI_AUDIT.md` (PARTIAL — fail-closed onSend only)

---

## 0. Inventory

| Surface | AuthN | AuthZ | Data class | Atomic audit? |
| ------- | ----- | ----- | ---------- | ------------- |
| `POST /api/v1/health/measurements` | JWT | health RBAC | PHI | **Yes** — same `withPgTenant` txn as insert (`appendAuditEntryOnClient`) |
| `POST /api/v1/fees/payments` (+ pay-invoice) | JWT | fees RBAC | financial | **Yes** — same txn as payment/receipt/ledger |
| Other regulated mutations (allergies, privacy, billing, student, scholarship, …) | JWT | domain RBAC | mixed | **No** — residual post-hoc `onSend` (503 cannot roll back) |
| PHI **reads** | JWT | health + guardian | PHI | N/A (read path; prior fail-closed slice) |

---

## 1. Controls

| Check | Pass | Evidence |
| ----- | ---- | -------- |
| Regulated state + audit commit atomically (wired routes) | ☑ | `runRegulatedMutationInTxn` / `appendAuditEntryOnClient` inside fees + health PG writers |
| Forced audit failure commits neither domain nor audit | ☑ | `txn-mutation-audit.test.ts` — ROLLBACK leaves durable maps empty |
| Forced outbox failure commits neither | ☑ | same test file — outbox enqueue throw rolls back |
| No production bypass for mutation audit degrade | ☑ | `isMutationAuditDegradeAllowed` always false when `NODE_ENV=production` |
| Gateway skips duplicate onSend when atomic marker set | ☑ | `wasRegulatedMutationAuditCommitted` + `Symbol.for('proctira.mutationAuditCommitted')` |
| Post-hoc onSend still fail-closed for unwired sensitive paths in prod | ☑ | existing `persistMutationAudit` path |
| Optional mutation-audit outbox builder | ☑ | `buildMutationAuditOutboxEntry` / `MUTATION_AUDIT_JOB_TYPE` |
| No secrets in git | ☑ | flags documented in `.env.example` only |

---

## 2. Findings

### P0 (closed this slice)

| ID | Finding | Fix |
| --- | ------- | --- |
| W1-SEC-10 residual | Mutation audit ran on `onSend` after domain commit; 503 could not roll back unaudited write | Same-txn audit for regulated subset; production degrade flag ignored |

### Honest residuals (subset not yet atomic)

| Route / surface | Sev | Notes |
| --------------- | --- | ----- |
| Health allergies / conditions / vaccinations / insurance / counselling / special-needs / break-glass writes | P1 | Still gateway post-hoc only |
| Fees invoices / plans / refunds / credit notes / write-offs / concessions / recon | P1 | Only `recordPaymentOnInvoice` is same-txn |
| Scholarship award / netting mutations | P1 | Post-hoc |
| Privacy legal-hold / erasure transitions | P1 | In-memory store — no shared PG txn yet |
| Billing + tenant-lifecycle mutations | P1 | Post-hoc |
| Student / parent / registration / staff / platform mutations | P1 | Post-hoc |
| Fees payment **adapter** charge inside txn `build` | P2 | External charge may succeed before COMMIT; DB+audit still roll back together on audit failure (pre-existing charge-before-commit shape) |
| Mutation-audit outbox **relay worker** | P2 | Builder + job type shipped; relay→`audit_log` consumer not required when writers use `appendAuditEntryOnClient` directly |

---

## 3. Sign-off

| Claim | Status |
| ----- | ------ |
| PARTIAL → COMPLETE for acceptance (atomic + no prod bypass + forced failure rolls back) | ☑ for wired subset |
| All regulated routes atomic | ☐ — residuals listed above |
| Safe to merge from security view | ☑ with residuals documented |

**Residual risks:** Unwired regulated routes can still acknowledge via post-hoc audit or 503 after durable write; extend `appendAuditInTxn` binders using the same helper. Production must never rely on `ALLOW_MUTATION_AUDIT_DEGRADE` (ignored).
