# Security — Privacy lifecycle complete (W1-SEC-06)

**Module / slice:** `@proctira/backend-privacy` + gateway `createPrivacyRepository()` + queue job types  
**Branch / tip:** `cursor/w1-sec-06-privacy-durable-56c3`  
**Date (UTC):** 2026-09-14  
**Finding:** W1-SEC-06 — Privacy lifecycle lacks complete erasure/anonymization, legal hold, correction and tenant offboarding  
**Data classes:** PII subject ids; legal-hold / erasure / correction / offboard metadata  
**Paired tests:** `privacy-service.test.ts`, `privacy-anonymization.restart-safe.test.ts`, `privacy-migration.test.ts`  
**Prior foundation:** merged `#189`, `#196` — revalidated; durable Pg factory + residual fail-closed closed below  

**Honesty:** No live DSAR export, no production wipe evidence, and no claim of full cross-domain PII cascade destruction. Default residual anonymizer/wipe mark jobs **`failed`**, never `completed`.

---

## 0. Inventory

| Route / API | AuthN | AuthZ | Data class | Notes |
| ----------- | ----- | ----- | ---------- | ----- |
| `POST/GET /privacy/legal-holds` (+ release) | Gateway JWT + tenant | platform RBAC | PII metadata | Fail-closed gates for erase/delete; `:id` requires tenant |
| `POST/GET /privacy/erasure-requests` (+ transition/execute) | Gateway JWT + tenant | platform RBAC | PII metadata | Execute enqueues durable job or inline worker path |
| `POST/GET /privacy/correction-requests` (+ transition/apply) | Gateway JWT + tenant | platform RBAC | PII | Apply emits before/after audit; tenant-bound ids |
| `POST/GET /privacy/tenant-offboard` | Gateway JWT + tenant | platform RBAC | tenant wipe meta | Hold checks fail-closed; residual → `failed` |
| Student soft-delete / merge | existing | + shared privacy hold gate | PII | Shared `createPrivacyRepository()` with `/privacy` |
| Tenant permanent delete | existing | + shared privacy hold gate | tenant | Shared factory instance |
| Mutation audit `/api/v1/privacy/*` | Gateway onSend | security-sensitive fail-closed | audit | Existing W1-SEC-10 path |

---

## 1. Controls

| Check | Pass | Evidence |
| ----- | ---- | -------- |
| Legal hold blocks erase/anonymize (fail-closed) | ☑ | `executeErasure` + `processAnonymizationJob` + transition-to-`in_progress` → `blocked_legal_hold` |
| Legal hold blocks tenant offboard wipe | ☑ | `requestTenantOffboardWipe` + `processTenantOffboardJob` |
| Residual anonymizer/wipe never marks `completed` | ☑ | `residualNote` or checklist `residual` → job status `failed`; erasure stays `in_progress` |
| Correction path with audit before/after | ☑ | `applyCorrection` → `PrivacyAuditPort` / `RecordingPrivacyAuditPort` tests |
| Anonymization workers durable (not stub-only) | ☑ | `privacy.anonymization` job type + tenant-bound worker + restart-safe vitest |
| Tenant offboard/wipe job with hold checks | ☑ | `privacy.tenant.offboard` + checklist via `ResidualTenantWipeExecutor` → `failed` |
| Tenant-bound find/update-by-id (IDOR) | ☑ | Repository + service + routes require `tenantId`; cross-tenant → not-found |
| Shared process store / Pg factory | ☑ | `createPrivacyRepository()` — Pg when `DATABASE_URL`, else `getSharedInMemoryPrivacyRepository()` |
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
| Honest residual wipe executor → `failed` | `ResidualTenantWipeExecutor` + service fail-closed |
| `PgPrivacyRepository` + factory | `pg-privacy-repository.ts`, `create-privacy-repository.ts` (067/078) |
| Gateway shared `createPrivacyRepository()` | `domain-plugins.ts` + `app.ts` single instance per module |
| Optional RabbitMQ publishers from env | `createPrivacyQueuePublishersFromEnv` |

---

## 3. Findings / residuals

### Closed vs prior residual note

| Prior gap | Status |
| --------- | ------ |
| Erasure execute stub / memory-only | Closed for durable job spine (queue when env set; restart-safe proof) |
| False `completed` on residual anonymizer/wipe | Closed — status `failed`, residual notes retained |
| ID ops without tenant bind | Closed — find/update-by-id + routes 401 without tenant |
| No Pg factory (memory-only gateway) | Closed — `createPrivacyRepository()` like hostel |
| No correction workflow | Closed (status machine + audited apply) |
| No tenant offboard wipe orchestration | Closed with **scoped residual** checklist → `failed` |

### Remaining residuals (explicit — not claimed done)

| Gap | Sev | Notes |
| --- | --- | ----- |
| Full cross-domain PII cascade wipe (student/staff/fees/health field mutation) | P1 residual | Default `RecordingSubjectAnonymizer` records token intent only; inject domain `SubjectAnonymizer` / `TenantWipeExecutor` for live purge — until then jobs stay `failed` |
| Live RLS isolation suite against Pg privacy tables | P1 residual | Schema `067`/`078` + `PgPrivacyRepository` shipped; live multi-tenant isolation suite still residual |
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
| W1-SEC-06 regressed gaps addressed for hold / correction / durable anonymize / offboard / residual fail-closed / tenant-bound ids / Pg factory | ☑ |
| Full GDPR platform / cascade wipe / live DSAR | ☐ — residuals above |
| Safe to merge from security view for this complete slice | ☑ with residuals dated |

**Residual risks:** Without `DATABASE_URL`, privacy uses shared in-memory (asserted via W1-SEC-12 policy) and does not survive multi-replica restart; without `QUEUE_BACKEND`/`RABBITMQ_URL`, anonymization/offboard execute inline (same processor) and do not survive process death; default anonymizer/wipe executor do not mutate domain PII tables and therefore mark jobs `failed` rather than `completed`.
