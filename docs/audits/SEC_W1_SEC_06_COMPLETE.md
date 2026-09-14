# Security — Privacy lifecycle complete (W1-SEC-06)

**Module / slice:** `@proctira/backend-privacy` + gateway shared store + queue job types  
**Branch / tip:** `cursor/w1-sec-06-privacy-complete-56c3`  
**Date (UTC):** 2026-09-14  
**Finding:** W1-SEC-06 — Privacy lifecycle lacks complete erasure/anonymization, legal hold, correction and tenant offboarding  
**Data classes:** PII subject ids; legal-hold / erasure / correction / offboard metadata  
**Paired tests:** `privacy-service.test.ts`, `privacy-anonymization.restart-safe.test.ts`, `privacy-migration.test.ts`  
**Prior foundation:** merged `#189`, `#196` — revalidated on tip; residuals closed below  

**Honesty:** No live DSAR export, no production wipe evidence, and no claim of full cross-domain PII cascade destruction.

---

## 0. Inventory

| Route / API | AuthN | AuthZ | Data class | Notes |
| ----------- | ----- | ----- | ---------- | ----- |
| `POST/GET /privacy/legal-holds` (+ release) | Gateway JWT + tenant | platform RBAC | PII metadata | Fail-closed gates for erase/delete |
| `POST/GET /privacy/erasure-requests` (+ transition/execute) | Gateway JWT + tenant | platform RBAC | PII metadata | Execute enqueues durable job or inline worker path |
| `POST/GET /privacy/correction-requests` (+ transition/apply) | Gateway JWT + tenant | platform RBAC | PII | Apply emits before/after audit |
| `POST/GET /privacy/tenant-offboard` | Gateway JWT + tenant | platform RBAC | tenant wipe meta | Hold checks fail-closed; checklist residual |
| Student soft-delete / merge | existing | + shared privacy hold gate | PII | Shared in-memory store with `/privacy` |
| Tenant permanent delete | existing | + shared privacy hold gate | tenant | Shared store |
| Mutation audit `/api/v1/privacy/*` | Gateway onSend | security-sensitive fail-closed | audit | Existing W1-SEC-10 path |

---

## 1. Controls

| Check | Pass | Evidence |
| ----- | ---- | -------- |
| Legal hold blocks erase/anonymize (fail-closed) | ☑ | `executeErasure` + `processAnonymizationJob` + transition-to-`in_progress` → `blocked_legal_hold` |
| Legal hold blocks tenant offboard wipe | ☑ | `requestTenantOffboardWipe` + `processTenantOffboardJob` |
| Correction path with audit before/after | ☑ | `applyCorrection` → `PrivacyAuditPort` / `RecordingPrivacyAuditPort` tests |
| Anonymization workers durable (not stub-only) | ☑ | `privacy.anonymization` job type + `createPrivacyAnonymizationWorker` + restart-safe vitest |
| Tenant offboard/wipe job with hold checks | ☑ | `privacy.tenant.offboard` + checklist via `ResidualTenantWipeExecutor` |
| Shared process store for hold gates | ☑ | `getSharedInMemoryPrivacyRepository` used by student, tenant lifecycle, privacy plugin |
| SQL additive + RLS/FORCE | ☑ | `067_privacy_legal_hold_erasure.sql`, `078_privacy_lifecycle_complete.sql` |
| No secrets in git | ☑ | — |
| Fake DSAR / prod wipe evidence avoided | ☑ | Residuals explicit below |

---

## 2. Delivered this slice

| Capability | Evidence |
| ---------- | -------- |
| Correction request workflow + apply audit | schemas, routes, service, unit tests |
| Durable anonymization job enqueue + worker | queue job types, publisher, restart-safe test |
| Tenant offboard wipe job + hold fail-closed | SQL table, service, routes, unit tests |
| Honest residual wipe executor | `ResidualTenantWipeExecutor` checklist domains |
| Gateway shared privacy repository | `domain-plugins.ts` + `app.ts` |
| Optional RabbitMQ publishers from env | `createPrivacyQueuePublishersFromEnv` |

---

## 3. Findings / residuals

### Closed vs prior residual note

| Prior gap | Status |
| --------- | ------ |
| Erasure execute stub / memory-only | Closed for durable job spine (queue when env set; restart-safe proof) |
| No correction workflow | Closed (status machine + audited apply) |
| No tenant offboard wipe orchestration | Closed with **scoped residual** checklist (see below) |

### Remaining residuals (explicit — not claimed done)

| Gap | Sev | Notes |
| --- | --- | ----- |
| Full cross-domain PII cascade wipe (student/staff/fees/health field mutation) | P1 residual | Default `RecordingSubjectAnonymizer` records token intent only; inject domain `SubjectAnonymizer` / `TenantWipeExecutor` for live purge |
| Pg-backed privacy repository + live RLS isolation suite | P1 residual | Schema `067`/`076` shipped; gateway still uses shared in-memory store |
| Dedicated privacy worker process in compose/ops runbook | P2 residual | Worker helpers exported; ops entrypoint can mirror `workers/exam-document` when funded |
| Staff/user destructive paths under hold | P2 residual | Student + tenant covered; other domains not wired |
| Live DSAR admin UI / production erasure evidence | NON-GOAL this slice | Do not claim |

---

## 4. How to verify

```bash
pnpm --filter @proctira/backend-privacy test
```

---

## 5. Sign-off

| Claim | Status |
| ----- | ------ |
| W1-SEC-06 regressed gaps addressed for hold / correction / durable anonymize / offboard job | ☑ |
| Full GDPR platform / cascade wipe / live DSAR | ☐ — residuals above |
| Safe to merge from security view for this complete slice | ☑ with residuals dated |

**Residual risks:** In-memory privacy store does not survive multi-replica restart until Pg repository lands; without `QUEUE_BACKEND`/`RABBITMQ_URL`, anonymization/offboard execute inline (same processor) and do not survive process death; default anonymizer/wipe executor do not mutate domain PII tables.
