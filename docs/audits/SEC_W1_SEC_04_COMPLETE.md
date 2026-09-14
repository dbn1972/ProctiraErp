# Security — W1-SEC-04 COMPLETE (PHI KMS envelope + institution deny-on-missing)

**Module / slice:** `@proctira/backend-health` PHI crypto + health access  
**Branch / tip:** `cursor/w1-sec-04-phi-complete-56c3`  
**Date (UTC):** 2026-09-14  
**Data classes:** PHI (counselling / profile / special-needs / nurse notes)  
**Paired test audit:** `phi-envelope.test.ts`, `phi-crypto.test.ts`, `phi-crypto-scoped.test.ts`, `health-institution-authz.test.ts`, `phi-breakglass.test.ts`

---

## 0. Inventory

| Surface | AuthN | AuthZ | Data class | Notes |
| ------- | ----- | ------ | ---------- | ----- |
| `encryptPhi` / `decryptPhi` | N/A | envelope provider | PHI at rest | enc:v1/v2/v3 |
| HealthService student PHI CRUD | JWT | RBAC + institution scope + field ACL | PHI | deny-on-missing-scope |
| Counselling `caseNotes` | JWT | coarse + field ACL + purpose + break-glass | PHI | `[REDACTED]` default |
| Gateway health mount boot | process env | fail-closed config | ops | `assertPhiEnvelopeConfigured` + `ensurePhiEnvelopeProvider` |

---

## 1. Controls

| Check | Pass | Evidence |
| ----- | ---- | -------- |
| Production refuses silent env-only `PHI_ENCRYPTION_KEY` | ☑ | `phi-envelope.test.ts`, `phi-crypto.test.ts` → `PhiEnvelopeMisconfiguredError` |
| KMS envelope provider interface (injectable client) | ☑ | `PhiKmsClient`, `KmsPhiEnvelopeProvider`, `createPhiEnvelopeProvider` |
| Rotatable key version in DEK / ciphertext (`enc:v3`) | ☑ | `PHI_KMS_KEY_VERSION` → `enc:v3:{version}:…` |
| CI local-stub KMS without calling AWS | ☑ | `LocalStubPhiKmsClient` + `PHI_ENVELOPE_PROVIDER=local-stub` |
| Deny school-bound health roles when institution scope missing | ☑ | `hasHealthAccess` + `health-institution-authz.test.ts` |
| Authoritative assignments override JWT (`staff_assignments`) | ☑ | `findActorInstitutionAssignments` + in-memory seed tests |
| Student institution from enrollments (authoritative resource scope) | ☑ | `pg-student-institution-lookup.ts` |
| Field ACL + purpose gate on counselling case notes | ☑ | `applyCounsellingCaseNotesAcl` + `allowsCounsellingCaseNotesPurpose` |
| Legacy enc:v1/v2 decrypt preserved | ☑ | `phi-crypto-scoped.test.ts` |

---

## 2. Findings

### P0

| ID | Finding | Fix |
| --- | ------- | --- |
| W1-SEC-04 residual | PHI used process-env master only; empty JWT institutions elevated school staff to tenant-wide | KMS/fail-closed envelope provider; deny-on-missing-scope; authoritative staff assignment lookup |

### P1 / P2

| ID | Sev | Finding | Fix / waiver |
| --- | --- | ------- | ------------ |
| residual-aws | P2 | Real AWS KMS (`@aws-sdk/client-kms`) not invoked in CI | **Honest residual** — interface + local-stub prove fail-closed path; gateway injects real client when AWS is available. Prod still refuses env-only. |

---

## 3. Sign-off

| Claim | Status |
| ----- | ------ |
| P0 cleared | ☑ |
| P1 cleared or waived | ☑ (AWS live call waived for CI; fail-closed prod config enforced) |
| W1-SEC-04 PARTIAL → COMPLETE | ☑ |
| Safe to merge from security view | ☑ |

**Residual risks:**

- Live AWS KMS GenerateDataKey/Decrypt is not exercised in this CI environment; operators must wire a real `PhiKmsClient` (or IAM role + SDK adapter) at deploy time. Misconfiguration fails closed at boot.
- `ALLOW_PHI_KMS_STUB=1` and `ALLOW_PLAINTEXT_PHI=1` must never be set in normal production.
- Historical `enc:v1` / `enc:v2` ciphertext remains readable with the unwrapped root; re-encrypt to `enc:v3` on key rotation is an ops playbook residual.
- Authoritative assignment SQL depends on `staff.custom_data.userId` linkage; when the join is unavailable the service falls back to JWT claims but still denies empty scope for school-bound roles.

## Follow-up (KMS client injection)

PARTIAL residual closed: gateway health boot now calls `createPhiKmsClientFromEnv()`
and injects the client into `ensurePhiEnvelopeProvider`.

- `AwsKmsPhiClient` wraps `@aws-sdk/client-kms`
- CI / non-AWS: `PHI_KMS_CLIENT=local-stub` + `ALLOW_PHI_KMS_STUB=1`
- Evidence: `aws-kms-phi-client.test.ts`; `apps/api-gateway/src/domain-plugins.ts` health mount

