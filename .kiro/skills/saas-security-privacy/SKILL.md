---
name: saas-security-privacy
description: Enterprise multi-tenant SaaS architecture, IAM, authorization, child-data privacy, security engineering, threat modeling, compliance controls, secrets, audit, retention, tenant lifecycle, entitlements, billing, and secure SDLC for School/SIS ERP. Use for auth, RBAC/ABAC/ReBAC, RLS, sensitive records, APIs, webhooks, files, payments, privacy, incidents, or production security review.
license: Proprietary
metadata:
  domain: saas-security-privacy
  repository: ProctiraErp
  version: '1.0.0'
---

# SaaS security and privacy skill

Apply this alongside `enterprise-school-sis-erp`. Security and privacy are system properties and operating processes, not role names, middleware presence, policy documents or marketing claims.

## Trust model

Treat these as distinct boundaries:

- Platform operator, tenant, administrative area, institution, user, guardian relationship and service account.
- Control plane versus tenant data plane.
- Browser/mobile/offline device, gateway, domain package, worker, database, cache, queue, object storage and external provider.
- Public admissions/portal endpoints versus authenticated staff operations.
- Sensitive child, custody, identity, health, counselling, disability, safeguarding, academic and financial records.

Tenant context must originate from authenticated trusted context and scope every query, transaction, cache key, search index, event, job, report/export, object key, metric/log and webhook.

## Mandatory security workflow

For a significant change:

1. Identify assets, actors, trust boundaries, entry points, abuse cases and attacker goals.
2. Classify data and define purpose, legal/contractual basis, minimum fields, access and retention.
3. Define authentication, session/MFA and service identity.
4. Define deny-by-default authorization across permission, area, institution, ownership/guardian relationship, record state and sensitive field.
5. Define validation, transaction/concurrency, idempotency, replay and rate/abuse controls.
6. Define secrets/keys, cryptographic primitives, rotation, revocation and compromise recovery.
7. Define audit, detection, alerting, incident response and evidence retention.
8. Define secure migration, rollout, rollback and deletion/export behavior.
9. Add negative tests: unauthenticated, wrong role, wrong institution/area, wrong relationship, cross-tenant, stale token, replay and object-ID guessing.

Use a lightweight STRIDE/LINDDUN-style threat model where applicable and record mitigations and residual risk.

## Authorization standard

- UI visibility is convenience, never enforcement.
- Centralize permission semantics but enforce in backend route/service boundaries.
- Validate referenced entities belong to the authenticated tenant and allowed scope.
- Use relationship-based rules for guardians/students and purpose/field rules for restricted records.
- Require step-up authentication or dual control for exceptional exports, impersonation, key operations and high-impact finance/identity actions.
- Audit access to highly sensitive records, not only mutations.
- Avoid super-admin bypass in ordinary code paths; make break-glass time-bound, reasoned and alerted.

## Privacy and child-data lifecycle

Implement operational controls for notice/consent where applicable, purpose limitation, minimization, correction, access/export, deletion/anonymization, retention, legal hold, breach response and tenant offboarding. Preserve records that must legally remain without retaining unnecessary identifiers. Do not promise GDPR, DPDP, FERPA, COPPA or any certification from generic controls alone; map controls to the actual jurisdiction and deployment.

## Secure SaaS platform

- Provision tenants idempotently; define plan/entitlement, quota, suspension, export and deletion states.
- Keep entitlement checks separate from authorization and school fee accounting.
- Fail closed in production when database, RLS, distributed rate limit, idempotency, queue, secrets or required provider controls are unavailable.
- Permit memory/console adapters only through explicit test/development configuration.
- Use cryptographic RNG, established hashes/HMAC/signatures, timing-safe comparison and managed secret storage. Never invent cryptography.
- Show credentials once, store only appropriate verifier material, support rotation/revocation and audit usage.
- Sign webhooks, prevent replay, isolate tenants, bound retries and provide delivery history/replay.
- Validate uploads by type/size/content; scan where required; use scoped signed URLs, encryption and lifecycle policies.
- Use decimal/minor-unit money, immutable reversible postings and provider webhook reconciliation.

## Secure delivery and operations

Assess dependency/SCA, secret scanning, SAST, container/IaC scanning, SBOM, provenance/signing, DAST, penetration testing, security headers/CSP, patch SLAs and vulnerability disclosure. CI configuration is evidence only when the gate runs and is enforced.

Require durable append-only audit with actor, tenant, scope, purpose/reason, safe diff, request/correlation ID and timestamp. Exclude tokens, secrets and sensitive content from logs and high-cardinality metrics.

## Repository-specific red flags to revalidate

- Fine-grained mutation authorization is not universally established by global JWT verification.
- RLS safety depends on the sanctioned tenant transaction connection.
- Rate limiting can fall back to process memory and idempotency can disable when Redis is unavailable.
- `packages/backend/developer-portal/src/developer-portal-service.ts` contained non-cryptographic key/hash/HMAC helpers in the audited commit.
- Durable privacy execution and central audit persistence were not proven by policy/audit package presence.

These are point-in-time hypotheses; inspect current code before acting.

## Security review output

Lead with exploitable/credible findings ordered critical/high/medium/low. Include evidence, trust boundary, attack/failure path, affected data/actors, preconditions, impact, smallest safe remediation, tests, rollout and residual risk. Separate confirmed vulnerability, design gap and unverified control.
