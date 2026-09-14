# Security — Privacy lifecycle (W1-SEC-06 slice)

**Module / slice:** `@proctira/backend-privacy` + tenant/student destructive-delete gates  
**Branch / tip:** `cursor/aud-w1-sec-06-privacy-lifecycle-56c3`  
**Date (UTC):** 2026-09-14  
**Finding:** W1-SEC-06 (high) — Privacy lifecycle lacks erasure/anonymization, legal hold, correction, tenant offboarding  
**Data classes:** PII subject ids; legal-hold / erasure metadata  
**Paired tests:** `privacy-service.test.ts`, `privacy-migration.test.ts`, `tenant-service.test.ts`, student delete/merge hold tests  
**Prior foundation:** merged `#189`

---

## 0. Inventory

| Surface | AuthN / AuthZ | Data class | Notes |
| ------- | ------------- | ---------- | ----- |
| `PrivacyService` (in-process) | caller-supplied | PII metadata | No public HTTP admin UI this slice |
| Student soft-delete / merge | existing student RBAC + hold gate | PII | `assertDestructiveDeleteAllowed` |
| Tenant permanent delete | existing tenant RBAC + hold gate | tenant wipe | `TenantService.deleteTenant` |
| SQL trigger on `students` | DB | PII | Blocks soft/hard delete under active hold |

---

## 1. Scope delivered (this vertical slice)

| Capability | Evidence |
| ---------- | -------- |
| Tenant `legal_hold` column + hold/erasure tables + RLS/FORCE | `db/sql/067_privacy_legal_hold_erasure.sql` |
| Student soft-delete DB trigger under hold | same migration |
| Erasure request status machine | `PrivacyService` + transitions |
| Fail-closed erasure execution under hold | `executeErasure` → `blocked_legal_hold` |
| Fail-closed tenant delete under hold | `TenantService.deleteTenant` + `legalHold` flag |
| Fail-closed student soft-delete / merge under hold | `StudentService` guard + gateway wiring |
| `@proctira/backend-privacy` package | `packages/backend/privacy` |

---

## 2. Remaining gaps (explicit — NOT claimed done)

| Gap | Sev | Notes |
| --- | --- | ----- |
| Anonymization / erasure **execution** (field wipe, cascade) | P0 residual | `executeErasure` is stub after hold check |
| Correction / rectification workflow | P1 residual | Not modeled |
| Tenant offboarding orchestration beyond retention clock | P1 residual | Decommission + hold gate only; no certifiable wipe checklist |
| Pg-backed privacy repository + live RLS tests | P1 residual | Schema shipped; gateway uses in-memory store |
| Privacy admin HTTP routes + DPO RBAC | P1 residual | Plugin exported, not mounted |
| Shared process-wide privacy store (student + tenant same instance) | P2 residual | Separate in-memory instances in gateway today |
| Staff/user delete paths under hold | P2 residual | Student + tenant covered |
| Audit-chain events for hold/erasure transitions | P2 residual | Should append to G-913 |

---

## 3. Sign-off

| Claim | Status |
| ----- | ------ |
| This W1-SEC-06 **slice** delivered | ☑ |
| Full W1-SEC-06 finding closed | ☐ — residuals above |
| Safe to merge from security view for this slice | ☑ |

**Honesty:** foundation + fail-closed delete/erasure gates only — not full GDPR platform readiness. In-memory privacy store does not survive process restart; persist via Pg repository before production reliance.
