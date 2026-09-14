# Security — Privacy lifecycle (W1-SEC-06)

**Module / slice:** `@proctira/backend-privacy` + student destructive-delete gate  
**Branch / tip:** `cursor/aud-w1-sec-06-privacy-lifecycle-56c3`  
**Date (UTC):** 2026-09-14  
**Data classes:** PII (student/staff/user subject ids); legal-hold metadata  
**Paired test audit:** unit — `privacy-lifecycle-service.test.ts`, `privacy-lifecycle-migration.test.ts`, student delete/merge hold tests

---

## 0. Inventory

| Route / API | AuthN | AuthZ | Data class | Notes |
| ----------- | ----- | ----- | ---------- | ----- |
| Student `DELETE` / merge soft-delete | existing student authZ | existing + legal-hold gate | PII | Hold check before soft-delete |
| Privacy service (in-process) | N/A this slice | N/A this slice | PII metadata | No public HTTP admin UI yet |

---

## 1. Controls

| Check                                   | Pass | Evidence |
| --------------------------------------- | ---- | -------- |
| Destructive delete blocked on active hold | ☑ | `PrivacyLifecycleService.assertDestructiveDeleteAllowed` + student service tests |
| Erasure cannot enter destructive statuses under hold | ☑ | service tests (`in_progress` / resume refused) |
| Invalid erasure transitions fail-closed | ☑ | `ERASURE_TRANSITIONS` + unit tests |
| DB soft-delete trigger while hold active | ☑ | `db/sql/067_privacy_lifecycle_schema.sql` trigger |
| Cross-tenant IDOR blocked (API)         | ☐    | Residual — no privacy HTTP routes in this slice |
| Write audit events                      | ☐    | Residual — wire audit on hold/erasure writes |
| Tenant isolation suite cited/run        | ☐    | Residual — add when Pg repository lands |

---

## 2. Findings

### P0 / this slice

| ID        | Finding | Fix |
| --------- | ------- | --- |
| W1-SEC-06 (slice) | No legal hold / erasure status / delete blocking | SQL + `PrivacyLifecycleService` + student delete/merge gate |

### Remaining gaps (explicit — not claimed done)

| Gap | Sev | Notes |
| --- | --- | ----- |
| Anonymization / erasure **execution** (wipe/transform PII fields, cascade) | P0 residual | Status machine only; no worker that mutates subject data |
| Correction (rectification) request workflow | P1 residual | Not modeled |
| Tenant offboarding wipe beyond decommission retention clock | P1 residual | `TenantService.decommission` retention exists; no privacy-orchestrated purge checklist |
| Pg-backed privacy repository + RLS live tests | P1 residual | Schema shipped; runtime store is in-memory in gateway this slice |
| Privacy admin HTTP routes + RBAC (DPO roles) | P1 residual | Service exists; no Fastify routes yet |
| Staff/user delete paths + audit archival under hold | P2 residual | Student soft-delete + DB trigger covered; other domains not wired |
| Audit log events for place/release hold and erasure transitions | P2 residual | Should append to G-913 chain |

---

## 3. Sign-off

| Claim                            | Status |
| -------------------------------- | ------ |
| This W1-SEC-06 **slice** delivered | ☑ |
| Full W1-SEC-06 finding closed    | ☐ — residuals above |
| Safe to merge from security view | ☑ for the legal-hold + erasure state-machine slice |

**Residual risks:** In-memory privacy store does not survive process restart — legal holds must be persisted via Pg repository before production reliance. Until HTTP/admin wiring exists, holds are only creatable via in-process service calls.
