# Owner decision brief — 2026-10-26

Decision brief for the repository owner. It lists every non-closed finding that Wave 0 triage or the Wave 1-2 batch dispositions (merged in PR #673) classified `NEEDS_DECISION` or `BLOCKED_FOR_APPROVAL`, grouped by the decision that unblocks it, plus the `SCHEMA_BATCH` and `INFRA_BATCH` items grouped into proposed specialist batches.

Nothing in this document closes a finding. Ledger dispositions stay as recorded in `CANONICAL_LEDGER.csv` until a fix lands with evidence. Recommended options are proposals for the owner, not decisions.

Sources: Wave 0 triage (`triage-group-1..4.json`, `deferred-approval-items.md` in the Wave 0 triage folder under `.agents/tasks/`), the nine `*_DISPOSITIONS_2026-10-25.csv` files, `DECISION_REGISTER.md` and the ledger title/notes. Boundary text below is quoted from those sources and shortened.

## Scope and counts

| Class                                                     | Findings |
| --------------------------------------------------------- | -------- |
| NEEDS_DECISION (Wave 0, incl. 3 consolidation-gate items) | 72       |
| BLOCKED_FOR_APPROVAL (Wave 0 + batch CSVs)                | 173      |
| Decision topics total                                     | 245      |
| SCHEMA_BATCH (Wave 0)                                     | 58       |
| INFRA_BATCH (Wave 0)                                      | 41       |

Of the 245 decision items, 227 come from Wave 0 and 18 were first classified `BLOCKED_FOR_APPROVAL` by a Wave 1-2 batch. PRC-L036 and PRC-M482 are `SCHEMA_BATCH` in Wave 0 and `BLOCKED_FOR_APPROVAL` in app_web_batch1, so they appear once in a topic and once in the schema section.

## Topic summary

| #   | Topic                                                                                                                                                          | Findings | Specialist reviewer                                                               |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------- |
| 1   | [Authentication and session policy](#1-authentication-and-session-policy)                                                                                      | 21       | Security/IAM specialist (auth code owner); PR #633 owner for role names           |
| 2   | [Secrets, signing keys and production fail-closed configuration](#2-secrets-signing-keys-and-production-fail-closed-configuration)                             | 13       | Security specialist + platform/infra owner                                        |
| 3   | [Authorization model, ownership and separation of duties](#3-authorization-model-ownership-and-separation-of-duties)                                           | 23       | Security/authz specialist + domain code owners; PR #633 owner                     |
| 4   | [Tenant isolation, tenant resolution and provisioning](#4-tenant-isolation-tenant-resolution-and-provisioning)                                                 | 15       | Tenancy/RLS specialist                                                            |
| 5   | [Audit trail integrity and audit retention](#5-audit-trail-integrity-and-audit-retention)                                                                      | 10       | Security/audit specialist + compliance owner                                      |
| 6   | [Child-data privacy: consent, minimisation, retention and erasure (DPDP)](#6-child-data-privacy-consent-minimisation-retention-and-erasure-dpdp)               | 20       | Privacy/DPO + legal counsel                                                       |
| 7   | [Health (PHI) access, audit and deletion controls](#7-health-phi-access-audit-and-deletion-controls)                                                           | 8        | Privacy specialist + security + health domain owner                               |
| 8   | [Money model, fees, payments, refunds and payroll rules](#8-money-model-fees-payments-refunds-and-payroll-rules)                                               | 17       | Finance owner + security (PSP) + data specialist for schema                       |
| 9   | [Statutory records, results release and grading rules](#9-statutory-records-results-release-and-grading-rules)                                                 | 8        | Examination/statutory owner + board-compliance reviewer; data specialist for L036 |
| 10  | [New or changed backend API and event contracts](#10-new-or-changed-backend-api-and-event-contracts)                                                           | 16       | API owner per domain + frontend owner; parent-portal batch owner for L211         |
| 11  | [List paging and list-result contract](#11-list-paging-and-list-result-contract)                                                                               | 5        | API owner + UX owner                                                              |
| 12  | [Attendance, calendar and timezone rules](#12-attendance-calendar-and-timezone-rules)                                                                          | 10       | Academics product owner + attendance domain owner                                 |
| 13  | [Operational business rules (library, hostel, transport, scholarship, workflow)](#13-operational-business-rules-library-hostel-transport-scholarship-workflow) | 13       | Product owner per module                                                          |
| 14  | [Notification behaviour rules](#14-notification-behaviour-rules)                                                                                               | 6        | Product owner (communications) + privacy for recipient data                       |
| 15  | [Parked packages: mount with persistence or retire](#15-parked-packages-mount-with-persistence-or-retire)                                                      | 14       | Architecture owner + product owner                                                |
| 16  | [Standalone/lab servers](#16-standalonelab-servers)                                                                                                            | 4        | Architecture owner + security                                                     |
| 17  | [Placeholder, demo and dead surfaces (product/IA)](#17-placeholder-demo-and-dead-surfaces-productia)                                                           | 14       | Product/IA owner + UX owner                                                       |
| 18  | [File upload trust and malware scanning](#18-file-upload-trust-and-malware-scanning)                                                                           | 4        | Security specialist + UI platform owner                                           |
| 19  | [Shared UI component API contracts](#19-shared-ui-component-api-contracts)                                                                                     | 3        | UI platform owner                                                                 |
| 20  | [Product behaviour defaults: authenticated caching and duplicate submits](#20-product-behaviour-defaults-authenticated-caching-and-duplicate-submits)          | 2        | Platform owner + UX owner                                                         |
| 21  | [Localisation scope](#21-localisation-scope)                                                                                                                   | 3        | Product owner + UX/localisation reviewer                                          |
| 22  | [Dependency additions and external integrations](#22-dependency-additions-and-external-integrations)                                                           | 7        | Dependency/supply-chain owner + security                                          |
| 23  | [Repository governance and design-token gates](#23-repository-governance-and-design-token-gates)                                                               | 2        | Repository owner + UX/a11y owner                                                  |
| 24  | [Data migration tooling and seeds](#24-data-migration-tooling-and-seeds)                                                                                       | 4        | Data/migration specialist                                                         |
| 25  | [Infrastructure operating decisions](#25-infrastructure-operating-decisions)                                                                                   | 3        | Platform/SRE owner                                                                |

## Topics

### 1. Authentication and session policy

Decision needed: Decide how every web, console and service entry point proves identity: verified tokens only, plus the IdP-side lifecycle (refresh, revoke, pre-MFA ticket, SAML signature, dedicated SCIM/API-key credentials, install token).

Options:

- Option A (recommended): Verify JWT signature/issuer/audience (JWKS) in each BFF/console shell; mint a pre-MFA ticket in the gateway; dedicated hashed SCIM and API-key credentials; install token gate on by default. Consequence: new auth code paths and IdP config; sessions with bad or expired tokens start failing; SAML needs an XML-DSig dependency.
- Option B: Gateway /auth/me round trip per request instead of local verification. Consequence: simpler client code, extra latency and a hard dependency on the gateway for every page.
- Option C: Defer. Consequence: UI and BFF authorisation keep trusting unsigned payloads; findings stay open.

Specialist reviewer: Security/IAM specialist (auth code owner); PR #633 owner for role names.

Unblocks 21 findings:

| id       | sev    | module             | ledger  | class                | boundary                                                                                                                 |
| -------- | ------ | ------------------ | ------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| PRC-L202 | low    | app-admin-console  | OPEN    | BLOCKED_FOR_APPROVAL | authentication (JWKS signature/issuer/audience verification in console shell; role catalogue D2)                         |
| PRC-M464 | medium | app-admin-console  | OPEN    | BLOCKED_FOR_APPROVAL | authentication/session lifecycle (refresh, upstream revoke, MFA/lockout via external auth service)                       |
| PRC-M026 | medium | app-api-gateway    | PARTIAL | BLOCKED_FOR_APPROVAL | identity provisioning surface (SCIM over RolesService tenant directory)                                                  |
| PRC-M027 | medium | app-api-gateway    | OPEN    | BLOCKED_FOR_APPROVAL | authentication: dedicated hashed SCIM token + session/token revocation on deprovision                                    |
| PRC-M467 | medium | app-install-wizard | PARTIAL | NEEDS_DECISION       | authentication/bootstrap secret source + where to persist the install lock (row notes)                                   |
| PRC-L254 | low    | app-web            | OPEN    | BLOCKED_FOR_APPROVAL | authentication (server-side JWT signature verification or gateway /auth/me round-trip)                                   |
| PRC-L544 | low    | app-web            | OPEN    | BLOCKED_FOR_APPROVAL | auth/CSRF credential handling on offline replay + sync policy                                                            |
| PRC-L545 | low    | app-web            | PARTIAL | BLOCKED_FOR_APPROVAL | authentication (forged-token verification, PRC-L254)                                                                     |
| PRC-M057 | medium | app-web            | PARTIAL | BLOCKED_FOR_APPROVAL | authentication: external auth-service signup / signup-roles contract                                                     |
| PRC-M133 | medium | app-web            | PARTIAL | BLOCKED_FOR_APPROVAL | authentication: external auth-service response contract                                                                  |
| PRC-M489 | medium | app-web            | PARTIAL | BLOCKED_FOR_APPROVAL | The gateway auth-fallback tests are an auth boundary (L254/L265). The "dedicated suites" acceptance is undefined beyond… |
| PRC-L445 | low    | auth               | OPEN    | BLOCKED_FOR_APPROVAL | authentication: local login disclosure/timing                                                                            |
| PRC-M497 | medium | auth               | PARTIAL | BLOCKED_FOR_APPROVAL | authentication: gateway login handler must mint/verify a pre-MFA ticket (resolvePrimaryAuth/issueCompletionTicket)       |
| PRC-M587 | medium | auth               | PARTIAL | BLOCKED_FOR_APPROVAL | authentication + dependency change (XML-DSig verifying parser, e.g. @node-saml/node-saml)                                |
| PRC-M589 | medium | auth               | PARTIAL | BLOCKED_FOR_APPROVAL | authentication: multi-replica external-IdP state store                                                                   |
| PRC-L298 | low    | developer-portal   | OPEN    | BLOCKED_FOR_APPROVAL | authentication: new inbound API-key auth strategy in the gateway                                                         |
| PRC-L566 | low    | infrastructure     | PARTIAL | BLOCKED_FOR_APPROVAL | authentication (gateway JWT secret boot guard under staging)                                                             |
| PRC-M625 | medium | install            | OPEN    | BLOCKED_FOR_APPROVAL | authentication: install token gate                                                                                       |
| PRC-L139 | low    | registration       | OPEN    | BLOCKED_FOR_APPROVAL | anonymous session issuance on a public route (session-store / security policy)                                           |
| PRC-L338 | low    | report             | PARTIAL | BLOCKED_FOR_APPROVAL | auth: tokenised emailed links vs session requirement; blocked by PRC-M338                                                |
| PRC-L372 | low    | tenant             | OPEN    | BLOCKED_FOR_APPROVAL | auth (session invalidation) + privacy (decommission data export)                                                         |

### 2. Secrets, signing keys and production fail-closed configuration

Decision needed: Decide whether every signing/download secret and security setting (CORS, trusted proxy CIDRs, SSRF allow-lists, pins, storage SSE, bot control) must fail closed in production, and where each secret comes from.

Options:

- Option A (recommended): Production boot guard that refuses hard-coded or JWT_SECRET fallbacks, one secret per purpose from the secret manager, explicit CORS/proxy/SSRF allow-lists, SSE on report blobs, mandatory bot control on anonymous routes. Consequence: misconfigured environments stop booting instead of running insecurely; infra must supply the values.
- Option B: Keep fallbacks but log a warning. Consequence: no deployment friction; the insecure defaults stay reachable.
- Option C: Defer.

Specialist reviewer: Security specialist + platform/infra owner.

Unblocks 13 findings:

| id       | sev    | module                  | ledger  | class                | boundary                                                                                           |
| -------- | ------ | ----------------------- | ------- | -------------------- | -------------------------------------------------------------------------------------------------- |
| PRC-M470 | medium | app-mobile              | PARTIAL | NEEDS_DECISION       | security: pin values + rotation/break-glass plan from infra/security owner (notes: Needs decision) |
| PRC-L225 | low    | app-registration-portal | PARTIAL | NEEDS_DECISION       | trusted public-origin / edge header policy (security)                                              |
| PRC-L413 | low    | app-web                 | PARTIAL | BLOCKED_FOR_APPROVAL | Dev-capture secret-source policy (minting SUPER_ADMIN JWTs; security policy).                      |
| PRC-L284 | low    | auth                    | OPEN    | BLOCKED_FOR_APPROVAL | auth secrets / production boot validation (also infra-owned redirect + web-origin config)          |
| PRC-L548 | low    | data-warehouse          | OPEN    | BLOCKED_FOR_APPROVAL | security policy (credential/raw-SQL intake) + import API schema change                             |
| PRC-L310 | low    | gradebook               | PARTIAL | BLOCKED_FOR_APPROVAL | secrets / security policy                                                                          |
| PRC-M524 | medium | infrastructure          | PARTIAL | BLOCKED_FOR_APPROVAL | gateway boot policy (security config guard)                                                        |
| PRC-L568 | low    | install                 | OPEN    | BLOCKED_FOR_APPROVAL | security policy: SSRF scheme/host restrictions                                                     |
| PRC-L329 | low    | lms                     | PARTIAL | BLOCKED_FOR_APPROVAL | secrets / security policy (production fail-closed signing secret)                                  |
| PRC-M628 | medium | plugin                  | PARTIAL | BLOCKED_FOR_APPROVAL | security policy: SSRF egress hardening (redirect handling, DNS rebinding)                          |
| PRC-M332 | medium | registration            | PARTIAL | BLOCKED_FOR_APPROVAL | security policy (mandatory bot control) + shared (Redis) rate-limit infra                          |
| PRC-L337 | low    | report                  | PARTIAL | BLOCKED_FOR_APPROVAL | security policy: download signing secret fail-closed + user-bound token                            |
| PRC-L342 | low    | report                  | PARTIAL | BLOCKED_FOR_APPROVAL | storage security config: SSE + production fail-closed for report blobs                             |

### 3. Authorization model, ownership and separation of duties

Decision needed: Decide the authorization model beyond role-only gates: teacher subject/section ownership, in-package checks on every mutating route, IDOR binding, separation of duties for approvals/erasure, and the authoritative role catalogue (Decision D2).

Options:

- Option A (recommended): Adopt ownership-scoped checks (teacher -> assigned subject/section, learner -> enrolment) enforced in each package plus the gateway, approve the D2 role catalogue, and require a second actor for self-approval/erasure. Consequence: some staff lose write access they have today; needs PR #633 role catalogue and an SIS enrolment source.
- Option B: Keep role-only gates and add only in-package checks that mirror the gateway. Consequence: smaller change; any teacher can still edit any class's data.
- Option C: Defer.

Specialist reviewer: Security/authz specialist + domain code owners; PR #633 owner.

Unblocks 23 findings:

| id       | sev    | module          | ledger  | class                | boundary                                                                                                                 |
| -------- | ------ | --------------- | ------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| PRC-M022 | medium | app-api-gateway | PARTIAL | BLOCKED_FOR_APPROVAL | authorization: approval-decider lookup (checkApprovalDecider) scans a truncated list                                     |
| PRC-L274 | low    | assessment      | PARTIAL | BLOCKED_FOR_APPROVAL | authorization/privacy (per-student scoping of minor data, guardian access path)                                          |
| PRC-M160 | medium | assessment      | OPEN    | NEEDS_DECISION       | RBAC redesign (teacher subject/class ownership, read-vs-write and approval separation); notes: NEEDS OWNER DECISION      |
| PRC-L280 | low    | audit           | PARTIAL | BLOCKED_FOR_APPROVAL | authorization: gateway audit-logs scope mapping (tenant-admin access)                                                    |
| PRC-M179 | medium | auth            | PARTIAL | BLOCKED_FOR_APPROVAL | RBAC scope model (area/institution) — notes: needs new schema + shared-RBAC change                                       |
| PRC-M194 | medium | curriculum      | OPEN    | NEEDS_DECISION       | RBAC redesign (teacher subject/section ownership); notes: NEEDS OWNER DECISION                                           |
| PRC-L446 | low    | custom-field    | OPEN    | BLOCKED_FOR_APPROVAL | authorization for student/staff custom values                                                                            |
| PRC-M299 | medium | lms             | OPEN    | BLOCKED_FOR_APPROVAL | authorization (learner enrolment/section-membership checks; needs SIS enrolment source)                                  |
| PRC-L332 | low    | notification    | OPEN    | BLOCKED_FOR_APPROVAL | authorization: device ownership (user) check                                                                             |
| PRC-L479 | low    | plugin          | OPEN    | BLOCKED_FOR_APPROVAL | authorization: tests must assert authz behaviour that PRC-M603 has not defined                                           |
| PRC-M603 | medium | plugin          | OPEN    | BLOCKED_FOR_APPROVAL | authorization: plugin register/install/enable role guard                                                                 |
| PRC-M627 | medium | plugin          | OPEN    | BLOCKED_FOR_APPROVAL | permission consent / authorization on plugin install+enable                                                              |
| PRC-M606 | medium | policy          | OPEN    | BLOCKED_FOR_APPROVAL | authorization on security-policy create/activate/assign                                                                  |
| PRC-M609 | medium | policy          | OPEN    | BLOCKED_FOR_APPROVAL | Boundary: security-policy change. Applying per-type rule schemas (policy schemas.ts) to the untyped CreatePolicySchema.… |
| PRC-M630 | medium | policy          | OPEN    | BLOCKED_FOR_APPROVAL | security-policy evaluation semantics (precedence across types, stricter-wins)                                            |
| PRC-L336 | low    | privacy         | OPEN    | BLOCKED_FOR_APPROVAL | authorization / separation of duties on privacy erasure + legal holds                                                    |
| PRC-L142 | low    | registration    | OPEN    | BLOCKED_FOR_APPROVAL | authz role catalogue (admin roles incl. 'principal'; Decision D2 awaiting owner sign-off) + gateway wiring in domain-pl… |
| PRC-M539 | medium | scholarship     | PARTIAL | BLOCKED_FOR_APPROVAL | authorization (in-tenant IDOR binding)                                                                                   |
| PRC-M632 | medium | scholarship     | PARTIAL | BLOCKED_FOR_APPROVAL | Boundary: authz/IDOR. Document verify/reject routes load application :id but DocumentService.decide never checks row.ap… |
| PRC-L364 | low    | staff           | OPEN    | NEEDS_DECISION       | authorization role catalogue (Decision Register group 2); notes: NEEDS OWNER DECISION                                    |
| PRC-M373 | medium | staff           | PARTIAL | BLOCKED_FOR_APPROVAL | authorization separation-of-duties (self-approval) and HR leave business rules (working-day counting, overlap, cancel/r… |
| PRC-M545 | medium | student         | OPEN    | BLOCKED_FOR_APPROVAL | authorization (in-plugin role checks on enrollment/certificate mutations)                                                |
| PRC-L171 | low    | tenant          | OPEN    | BLOCKED_FOR_APPROVAL | RBAC role catalogue: built-in role seed-drift reconciliation (DECISION_REGISTER group 2)                                 |

### 4. Tenant isolation, tenant resolution and provisioning

Decision needed: Approve removing client-supplied tenant fallbacks (x-tenant-id), defence-in-depth tenant predicates in repositories/storage/event consumers, and the host-to-tenant resolution rules (custom-domain verification, caching, sandbox tenants).

Options:

- Option A (recommended): Tenant only from the verified token or a verified host mapping; repositories, storage keys and Kafka consumers check the caller tenant; custom domains need a DNS/HTTP challenge; sandbox tenants get real isolated provisioning. Consequence: callers relying on the header fallback break; needs failing-first cross-tenant tests per path.
- Option B: Rely on RLS alone and keep header fallbacks for internal callers. Consequence: less code; single layer of defence.
- Option C: Defer.

Specialist reviewer: Tenancy/RLS specialist.

Unblocks 15 findings:

| id       | sev    | module           | ledger  | class                | boundary                                                                                                                 |
| -------- | ------ | ---------------- | ------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| PRC-L213 | low    | app-mobile       | PARTIAL | BLOCKED_FOR_APPROVAL | auth/tenant membership endpoint (tenant isolation)                                                                       |
| PRC-L265 | low    | app-web          | OPEN    | BLOCKED_FOR_APPROVAL | tenant resolution / tenant isolation                                                                                     |
| PRC-M132 | medium | app-web          | PARTIAL | BLOCKED_FOR_APPROVAL | new public slug-addressed branding endpoint (unauthenticated tenant data, tenant resolution)                             |
| PRC-L552 | low    | data-warehouse   | OPEN    | BLOCKED_FOR_APPROVAL | tenant isolation (defence-in-depth repository contract)                                                                  |
| PRC-M617 | medium | data-warehouse   | OPEN    | BLOCKED_FOR_APPROVAL | authentication/authorization + tenant binding (mount with tenant/auth plugin)                                            |
| PRC-M218 | medium | developer-portal | OPEN    | BLOCKED_FOR_APPROVAL | tenant lifecycle/provisioning (isolated sandbox tenant creation and teardown)                                            |
| PRC-L101 | low    | etl              | PARTIAL | BLOCKED_FOR_APPROVAL | Boundary: tenant isolation. Plan stop rule triggered: a probe showed InMemoryPipelineRepository.updateExecution(id, {te… |
| PRC-M610 | medium | policy           | OPEN    | NEEDS_DECISION       | row notes: data-model/ownership decision for platform-scope policies (also a tenant boundary)                            |
| PRC-L339 | low    | report           | PARTIAL | BLOCKED_FOR_APPROVAL | tenant isolation: removing x-tenant-id header fallback in report tenant resolution                                       |
| PRC-L581 | low    | shared-database  | PARTIAL | BLOCKED_FOR_APPROVAL | Boundary: tenant-isolation API change. Reads are already scope-required (packages/shared/database/src/pg-document-store… |
| PRC-M633 | medium | shared-events    | PARTIAL | BLOCKED_FOR_APPROVAL | tenant isolation: consumer-side topic tenant vs message tenant check                                                     |
| PRC-M634 | medium | shared-storage   | PARTIAL | BLOCKED_FOR_APPROVAL | tenant isolation: threading caller tenant through every storage caller                                                   |
| PRC-L497 | low    | shared-testing   | PARTIAL | BLOCKED_FOR_APPROVAL | Boundary: tenancy write path. Residual needs a new Postgres persistence adapter writing under RLS / tenant GUC.          |
| PRC-L169 | low    | tenant           | OPEN    | BLOCKED_FOR_APPROVAL | tenant resolution security: custom-domain ownership verification (DNS/HTTP challenge) gates host->tenant routing         |
| PRC-L369 | low    | tenant           | OPEN    | BLOCKED_FOR_APPROVAL | tenant resolution boundary: caching public host->tenant mapping affects suspension/domain freshness                      |

### 5. Audit trail integrity and audit retention

Decision needed: Decide whether domain mutations must write a server-side audit record in the same transaction, whether the hash chain is keyed (HMAC/KMS), and what statutory minimum audit retention applies.

Options:

- Option A (recommended): Same-transaction server-side audit for tenant-admin, grades, attendance, staff, student and PII export events; keyed chain via KMS; a platform-owned minimum retention that tenants cannot lower. Consequence: new audit wiring per domain and a key-management dependency; tenants lose the 1-month retention option.
- Option B: Keep the gateway body-hash audit and tenant-controlled retention. Consequence: no work; audit stays forgeable and can be shortened.

Specialist reviewer: Security/audit specialist + compliance owner.

Unblocks 10 findings:

| id       | sev    | module          | ledger  | class                | boundary                                                                                                                 |
| -------- | ------ | --------------- | ------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| PRC-M013 | medium | app-api-gateway | PARTIAL | BLOCKED_FOR_APPROVAL | audit security control: same-transaction audit across grades/attendance/staff/student/scholarship/tenant-admin domains   |
| PRC-L256 | low    | app-web         | PARTIAL | BLOCKED_FOR_APPROVAL | statutory audit-retention rule + audit API contract                                                                      |
| PRC-L264 | low    | app-web         | OPEN    | BLOCKED_FOR_APPROVAL | audit trail integrity (server-side audit in tenant-admin handlers, same transaction)                                     |
| PRC-L295 | low    | db              | PARTIAL | BLOCKED_FOR_APPROVAL | statutory/compliance retention policy (archival window ownership)                                                        |
| PRC-L461 | low    | db              | PARTIAL | BLOCKED_FOR_APPROVAL | Boundary: audit hash-chain write path + CI config. Chained audit writes need the audit service hash path; dropping the…  |
| PRC-M200 | medium | db              | OPEN    | BLOCKED_FOR_APPROVAL | cryptographic key management (HMAC/KMS) for audit chain                                                                  |
| PRC-L477 | low    | plugin          | OPEN    | BLOCKED_FOR_APPROVAL | audit/tenant scope for platform registry operations                                                                      |
| PRC-M608 | medium | policy          | OPEN    | BLOCKED_FOR_APPROVAL | audit contract + auth actor context for a parked package                                                                 |
| PRC-L340 | low    | report          | PARTIAL | BLOCKED_FOR_APPROVAL | audit/privacy control: domain audit of PII export downloads and schedule changes                                         |
| PRC-L590 | low    | student         | PARTIAL | BLOCKED_FOR_APPROVAL | Boundary: DB schema/migration (durable hash-chained audit store) plus audit-control design. student/src/audit/* is in-m… |

### 6. Child-data privacy: consent, minimisation, retention and erasure (DPDP)

Decision needed: Supply the retention periods, erasure/anonymisation rules, parental consent capture and legal-hold semantics (Decision D5, counsel-supplied) so code can implement them.

Options:

- Option A (recommended): Counsel approves a retention schedule and erasure/anonymisation rules per data class (applicants, minors' PII, location/boarding data, scholarship documents, staff PII, migration copies); engineering implements them with dual control and audit. Consequence: data deletion jobs and consent screens become mandatory; some data currently kept indefinitely is purged.
- Option B: Engineering proposes defaults for counsel to ratify later. Consequence: faster start; risk of rework and of shipping unapproved policy.
- Option C: Defer.

Specialist reviewer: Privacy/DPO + legal counsel.

Unblocks 20 findings:

| id       | sev    | module                  | ledger  | class                | boundary                                                                                                                 |
| -------- | ------ | ----------------------- | ------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| PRC-M016 | medium | app-api-gateway         | OPEN    | NEEDS_DECISION       | row notes: DPDP minimisation needs a product/retention decision for applicant student masters                            |
| PRC-M468 | medium | app-mobile              | PARTIAL | BLOCKED_FOR_APPROVAL | attendance API contract + location PII capture                                                                           |
| PRC-L226 | low    | app-registration-portal | OPEN    | NEEDS_DECISION       | privacy: third-party OSM tile loading before consent (label binding itself is codeable a11y)                             |
| PRC-L532 | low    | app-web                 | PARTIAL | BLOCKED_FOR_APPROVAL | public data exposure allow-list + rate limiting (privacy/security)                                                       |
| PRC-L449 | low    | custom-field            | OPEN    | BLOCKED_FOR_APPROVAL | privacy erasure wiring + cross-domain entity existence checks                                                            |
| PRC-L553 | low    | data-warehouse          | OPEN    | BLOCKED_FOR_APPROVAL | privacy/consent and authorization policy (publish visibility gate)                                                       |
| PRC-M203 | medium | db                      | OPEN    | BLOCKED_FOR_APPROVAL | privacy/legal-hold policy across PII/PHI tables                                                                          |
| PRC-M204 | medium | db                      | OPEN    | BLOCKED_FOR_APPROVAL | privacy lifecycle (PII redaction, dual control)                                                                          |
| PRC-M214 | medium | db                      | OPEN    | BLOCKED_FOR_APPROVAL | privacy (DPDP erasure/anonymisation path)                                                                                |
| PRC-M215 | medium | db                      | PARTIAL | BLOCKED_FOR_APPROVAL | privacy retention/erasure + object storage deletion                                                                      |
| PRC-L559 | low    | developer-portal        | OPEN    | BLOCKED_FOR_APPROVAL | privacy: payload redaction + retention policy (D5 retention config)                                                      |
| PRC-L331 | low    | lms                     | PARTIAL | NEEDS_DECISION       | identity mapping + DPDP erasure policy (notes: NEEDS OWNER DECISION; Decision Register group 5)                          |
| PRC-M307 | medium | notification            | OPEN    | BLOCKED_FOR_APPROVAL | privacy: cross-service resolution of user email/phone (PII)                                                              |
| PRC-M629 | medium | plugin                  | OPEN    | BLOCKED_FOR_APPROVAL | privacy: event payload minimisation/masking policy                                                                       |
| PRC-L136 | low    | privacy                 | PARTIAL | BLOCKED_FOR_APPROVAL | privacy/legal-hold state machine (statutory DPDP control) — needs privacy owner review; failing-first proof required     |
| PRC-M538 | medium | registration            | OPEN    | BLOCKED_FOR_APPROVAL | privacy (DPDP parental consent/purpose, retention/erasure for minors' PII; schema) + guardian identity matching (auth)   |
| PRC-L341 | low    | report                  | PARTIAL | BLOCKED_FOR_APPROVAL | privacy: in-tenant recipient restriction for PII report export                                                           |
| PRC-M378 | medium | staff                   | PARTIAL | BLOCKED_FOR_APPROVAL | privacy / field-level authorization on staff PII                                                                         |
| PRC-M557 | medium | tools-migrations        | PARTIAL | BLOCKED_FOR_APPROVAL | privacy/retention decision (default-on PII purge)                                                                        |
| PRC-M451 | medium | transport               | PARTIAL | NEEDS_DECISION       | privacy/legal retention policy for child location and boarding data (Decision Register group 5); notes: NEEDS OWNER DEC… |

### 7. Health (PHI) access, audit and deletion controls

Decision needed: Decide PHI read authorisation (fail-closed institution scope, teacher section scope), whether PHI before/after values may enter audit records, how PHI deletions are audited, KMS rotation and the BYPASSRLS credential split.

Options:

- Option A (recommended): Fail closed on scope lookup errors, record ids plus field names (not values) in audit, audit every retention deletion, split retention and backup credentials, set PHI coverage thresholds. Consequence: some PHI screens return 403 on lookup failure; ops gets a second DB role.
- Option B: Keep current fallbacks and document the risk. Consequence: no change.

Specialist reviewer: Privacy specialist + security + health domain owner.

Unblocks 8 findings:

| id       | sev    | module         | ledger  | class                | boundary                                                                                                               |
| -------- | ------ | -------------- | ------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| PRC-M121 | medium | app-web        | OPEN    | BLOCKED_FOR_APPROVAL | PHI authorization (permission gating, teacher section scope, PHI-read audit)                                           |
| PRC-L115 | low    | health         | PARTIAL | NEEDS_DECISION       | privacy decision: whether/how PHI before/after values may be captured in audit records; actor fallback is audit-policy |
| PRC-L312 | low    | health         | PARTIAL | BLOCKED_FOR_APPROVAL | authorization / institution-scope fail-closed policy on PHI read paths                                                 |
| PRC-L313 | low    | health         | PARTIAL | NEEDS_DECISION       | ops/security decision on PHI root-key rotation blast radius                                                            |
| PRC-L472 | low    | health         | PARTIAL | NEEDS_DECISION       | quality-gate decision: coverage threshold values for the PHI package                                                   |
| PRC-M623 | medium | infrastructure | OPEN    | BLOCKED_FOR_APPROVAL | DB role/RLS bypass credential split (owner decision per ledger note)                                                   |
| PRC-M435 | medium | tools-scripts  | OPEN    | BLOCKED_FOR_APPROVAL | PHI deletion audit trail (privacy/audit chain) under BYPASSRLS role                                                    |
| PRC-M559 | medium | tools-scripts  | PARTIAL | BLOCKED_FOR_APPROVAL | PHI deletion job semantics + DB role assertion (privacy/RLS)                                                           |

### 8. Money model, fees, payments, refunds and payroll rules

Decision needed: Confirm the D1 money representation (integer minor units + currency) everywhere, live payment-provider integration, refund/reconciliation rules, and payroll deduction and journal rules.

Options:

- Option A (recommended): Apply D1 to scholarship, admission offers, hostel and transport amounts; integrate one live PSP with webhooks and payment-targeted, idempotent refunds; define reconciliation matching keys; define half-day/unpaid-leave deduction and balanced payroll journals. Consequence: schema and API changes in fees/payroll; sandbox-only flows stop being shown as real.
- Option B: Keep sandbox adapters and bookkeeping-only refunds, label them clearly. Consequence: no PSP work; finance flows remain non-production.

Specialist reviewer: Finance owner + security (PSP) + data specialist for schema.

Unblocks 17 findings:

| id       | sev    | module       | ledger  | class                | boundary                                                                                                                 |
| -------- | ------ | ------------ | ------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| PRC-M039 | medium | app-mobile   | PARTIAL | NEEDS_DECISION       | product decision on exposing a sandbox-labelled payment flow (row notes: Needs decision); payment flow is also a financ… |
| PRC-L268 | low    | app-web      | OPEN    | BLOCKED_FOR_APPROVAL | financial: money representation contract (D1 minor units) across scholarship/admission-offer backend+client              |
| PRC-M090 | medium | app-web      | PARTIAL | BLOCKED_FOR_APPROVAL | financial: refund-by-payment backend contract                                                                            |
| PRC-L291 | low    | db           | OPEN    | BLOCKED_FOR_APPROVAL | provider integration / product decision (live mode) + schema CHECK                                                       |
| PRC-M201 | medium | db           | PARTIAL | BLOCKED_FOR_APPROVAL | financial (payroll journal balancing business rule)                                                                      |
| PRC-M202 | medium | db           | PARTIAL | BLOCKED_FOR_APPROVAL | financial (fee ledger linkage) + schema                                                                                  |
| PRC-M503 | medium | db           | PARTIAL | BLOCKED_FOR_APPROVAL | financial (payment defaults, overpayment constraint) + PSP integration                                                   |
| PRC-L106 | low    | fees         | PARTIAL | BLOCKED_FOR_APPROVAL | external messaging integration + finance dunning                                                                         |
| PRC-L471 | low    | fees         | PARTIAL | BLOCKED_FOR_APPROVAL | financial business rule + new fees API route                                                                             |
| PRC-M246 | medium | fees         | PARTIAL | BLOCKED_FOR_APPROVAL | financial + external PSP integration                                                                                     |
| PRC-M251 | medium | fees         | PARTIAL | BLOCKED_FOR_APPROVAL | financial reconciliation business rule (settlement, matching key) + import-batch idempotency                             |
| PRC-M512 | medium | fees         | PARTIAL | BLOCKED_FOR_APPROVAL | financial + external PSP/webhook                                                                                         |
| PRC-L117 | low    | hostel       | PARTIAL | BLOCKED_FOR_APPROVAL | financial (integer-cents fee validation, money model Decision D1); date/uuid parts alone would be ELIGIBLE_LOW           |
| PRC-M537 | medium | registration | PARTIAL | BLOCKED_FOR_APPROVAL | financial/enrolment side-effect atomicity (invoice void, enrolment, waitlist)                                            |
| PRC-M368 | medium | staff        | PARTIAL | BLOCKED_FOR_APPROVAL | financial (payroll posting) behaviour                                                                                    |
| PRC-M370 | medium | staff        | PARTIAL | BLOCKED_FOR_APPROVAL | financial/payroll business rule (deduction policy for half-days and unpaid leave)                                        |
| PRC-M452 | medium | transport    | PARTIAL | BLOCKED_FOR_APPROVAL | financial (fee amount/currency validation; money model Decision D1)                                                      |

### 9. Statutory records, results release and grading rules

Decision needed: Define the content and authenticity of official documents (transcripts, admit cards), the results publication filter, the authoritative roll/registration number, Unicode rendering on official PDFs and the GPA/grade-scale rules.

Options:

- Option A (recommended): Board-approved transcript/admit-card content with KMS-signed checksums; results read only from published marks; registration/roll number as a real field; embed a licensed Unicode font; GPA by period and approved status with a tenant-configured scale. Consequence: schema fields, a font asset and signing keys; documents change visibly.
- Option B: Keep current documents and mark them unofficial. Consequence: no work; documents cannot be used as statutory records.

Specialist reviewer: Examination/statutory owner + board-compliance reviewer; data specialist for L036.

Unblocks 8 findings:

| id       | sev    | module          | ledger  | class                | boundary                                                                                                                 |
| -------- | ------ | --------------- | ------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| PRC-L036 | low    | app-web         | PARTIAL | BLOCKED_FOR_APPROVAL | Needs a board registration number field on the candidate (DB schema).                                                    |
| PRC-M152 | medium | app-web         | OPEN    | NEEDS_DECISION       | grading-scale product rule (row notes: owner decision on GPA scale)                                                      |
| PRC-L292 | low    | db              | OPEN    | BLOCKED_FOR_APPROVAL | cryptographic signing / KMS + transcript authenticity CHECK                                                              |
| PRC-M510 | medium | examination     | PARTIAL | NEEDS_DECISION       | product decision: authoritative roll-number source (likely also a schema change)                                         |
| PRC-L112 | low    | gradebook       | OPEN    | BLOCKED_FOR_APPROVAL | official transcript document content (statutory record; checksum/signature payload)                                      |
| PRC-M268 | medium | gradebook       | OPEN    | BLOCKED_FOR_APPROVAL | grading/GPA business rules (period and workflow-status inclusion, term vs cumulative rank)                               |
| PRC-M343 | medium | report          | PARTIAL | BLOCKED_FOR_APPROVAL | Boundary: business rule (results release) and source-table choice. Binding exam_results to exam_marks_entries (double-e… |
| PRC-M359 | medium | shared-pdf-lite | OPEN    | BLOCKED_FOR_APPROVAL | dependency/asset change: embedding a Unicode TrueType font (licensing) on official documents                             |

### 10. New or changed backend API and event contracts

Decision needed: Approve the additive endpoints and fields the clients need (entitlements, bulk invigilators, student class/section, staff structured fields, leave balance, trip filters, report aggregates, roster source, program code) and the few response-shape changes to frozen contracts.

Options:

- Option A (recommended): Approve additive endpoints/fields only (versioned where a frozen shape changes), each with a contract test and a client switch-over. Consequence: backend work per domain; frozen response shapes stay compatible.
- Option B: Approve shape changes in place. Consequence: faster, but breaks existing consumers of frozen contracts.
- Option C: Defer; clients keep workarounds.

Specialist reviewer: API owner per domain + frontend owner; parent-portal batch owner for L211.

Unblocks 16 findings:

| id       | sev    | module                  | ledger  | class                | boundary                                                                                                                 |
| -------- | ------ | ----------------------- | ------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| PRC-L006 | low    | app-mobile              | PARTIAL | BLOCKED_FOR_APPROVAL | new backend report API (tenant-scoped attendance aggregate contract)                                                     |
| PRC-L211 | low    | app-mobile              | OPEN    | BLOCKED_FOR_APPROVAL | parent-portal API contract (guardian-scoped list routes need a studentId filter); parent-portal module is owned by in-f… |
| PRC-M031 | medium | app-mobile              | OPEN    | BLOCKED_FOR_APPROVAL | student API response contract (StudentResponseSchema has no class/section field)                                         |
| PRC-L224 | low    | app-registration-portal | OPEN    | BLOCKED_FOR_APPROVAL | Boundary: user-visible behaviour + cross-lane API contract. Rotating submissionKey on edit (apps/registration-portal/sr… |
| PRC-L048 | low    | app-web                 | PARTIAL | BLOCKED_FOR_APPROVAL | staff record API contract (structured fields instead of customData)                                                      |
| PRC-L056 | low    | app-web                 | PARTIAL | BLOCKED_FOR_APPROVAL | leave-balance/entitlement backend data contract                                                                          |
| PRC-L078 | low    | app-web                 | OPEN    | BLOCKED_FOR_APPROVAL | tenant entitlement source (new backend /tenant/entitlements contract feeding client gating)                              |
| PRC-L236 | low    | app-web                 | PARTIAL | BLOCKED_FOR_APPROVAL | new examination backend bulk-invigilators API contract                                                                   |
| PRC-M130 | medium | app-web                 | OPEN    | BLOCKED_FOR_APPROVAL | transport API contract (route/date/direction trip filters, assignment validation)                                        |
| PRC-M134 | medium | app-web                 | PARTIAL | BLOCKED_FOR_APPROVAL | Streaming body cap is tied to the gateway body-limit contract.                                                           |
| PRC-M148 | medium | app-web                 | PARTIAL | BLOCKED_FOR_APPROVAL | student API contract (StudentListQuerySchema)                                                                            |
| PRC-M482 | medium | app-web                 | PARTIAL | BLOCKED_FOR_APPROVAL | Real program code column (backend field/schema).                                                                         |
| PRC-L089 | low    | communication           | OPEN    | BLOCKED_FOR_APPROVAL | frozen API contract: surfacing live-count errors changes the audience preview response shape (per row notes)             |
| PRC-L098 | low    | etl                     | OPEN    | BLOCKED_FOR_APPROVAL | event contract (publishing pipeline events onto the bus) + notification/provider integration                             |
| PRC-M302 | medium | lms                     | OPEN    | BLOCKED_FOR_APPROVAL | needs an authoritative SIS roster source for LMS classes (cross-module data contract)                                    |
| PRC-M308 | medium | notification            | OPEN    | BLOCKED_FOR_APPROVAL | frozen API/event contract + schema (notification status enum CHECK in db/sql/005_notifications_schema.sql:39)            |

### 11. List paging and list-result contract

Decision needed: Choose one list contract (page/pageSize/search with a cap, and an error-vs-empty result type) and decide whether it rolls out across the ~90 web clients in one coordinated change.

Options:

- Option A (recommended): page/pageSize (max 100) + search on picker endpoints, and a typed list result that distinguishes failure from empty, rolled out by module. Consequence: pickers and long lists change behaviour (paged, explicit error state).
- Option B: Raise server caps and keep fetch-all. Consequence: no client change; large tenants keep slow pages.

Specialist reviewer: API owner + UX owner.

Unblocks 5 findings:

| id       | sev    | module            | ledger  | class          | boundary                                                                                |
| -------- | ------ | ----------------- | ------- | -------------- | --------------------------------------------------------------------------------------- |
| PRC-L527 | low    | app-admin-console | PARTIAL | NEEDS_DECISION | list paging contract (row notes: owner decision)                                        |
| PRC-L231 | low    | app-web           | OPEN    | NEEDS_DECISION | list paging contract (row notes: owner decision on page/pageSize+search for pickers)    |
| PRC-L408 | low    | app-web           | PARTIAL | NEEDS_DECISION | list paging contract (same owner decision as PRC-L231)                                  |
| PRC-M129 | medium | app-web           | OPEN    | NEEDS_DECISION | list paging/search contract (same owner decision as PRC-L231)                           |
| PRC-M146 | medium | app-web           | PARTIAL | NEEDS_DECISION | list-result contract rollout across ~90 clients (row notes: coordinated owner decision) |

### 12. Attendance, calendar and timezone rules

Decision needed: Fix one definition of attendance rate, the tenant timezone source of truth (Decision Register group 3), the back-dating window, bell-schedule/day-pattern semantics and what unconfigured institutions get.

Options:

- Option A (recommended): One documented attendance-rate formula (LATE counts as present, day-level), tenant timezone for all 'today' and schedule math, a tenant-configurable back-dating window, explicit defaults for unconfigured institutions. Consequence: some dashboards show different percentages after the change.
- Option B: Keep per-screen formulas and server/browser time. Consequence: no change; figures stay inconsistent.

Specialist reviewer: Academics product owner + attendance domain owner.

Unblocks 10 findings:

| id       | sev    | module          | ledger  | class                | boundary                                                                                                        |
| -------- | ------ | --------------- | ------- | -------------------- | --------------------------------------------------------------------------------------------------------------- |
| PRC-M008 | medium | app-api-gateway | OPEN    | NEEDS_DECISION       | DECISION_REGISTER group 9 cites PRC-M008 (definition of attendance rate)                                        |
| PRC-M465 | medium | app-api-gateway | PARTIAL | NEEDS_DECISION       | metric definitions for board rollup (tied to PRC-M008, DECISION_REGISTER group 9)                               |
| PRC-L054 | low    | app-web         | PARTIAL | BLOCKED_FOR_APPROVAL | business rule source (tenant attendance threshold / grading scale)                                              |
| PRC-L260 | low    | app-web         | PARTIAL | NEEDS_DECISION       | bell-schedule/day-pattern semantics (timetable product rule, per notes)                                         |
| PRC-L275 | low    | attendance      | PARTIAL | NEEDS_DECISION       | owner decision: day-level counting and subject/period passthrough rules for the percentage                      |
| PRC-M169 | medium | attendance      | PARTIAL | NEEDS_DECISION       | owner decision: surface 501 vs degrade-to-defaults for unconfigured institutions (visible API behaviour change) |
| PRC-M496 | medium | attendance      | PARTIAL | NEEDS_DECISION       | owner decision: back-dating window policy (business rule)                                                       |
| PRC-L145 | low    | report          | OPEN    | NEEDS_DECISION       | DECISION_REGISTER group 3 (tenant timezone source of truth, PRODUCT decision)                                   |
| PRC-M349 | medium | scholarship     | PARTIAL | NEEDS_DECISION       | product config decision (tenant timezone source for 'today'; GPA scale) per notes and Decision Register group 3 |
| PRC-L596 | low    | ui-dashboards   | OPEN    | NEEDS_DECISION       | timezone/locale policy (DECISION_REGISTER.md §3 names PRC-L596)                                                 |

### 13. Operational business rules (library, hostel, transport, scholarship, workflow)

Decision needed: Confirm the domain rules the code should enforce: loan limits, room capacity and vacate flow, vehicle capacity and route windows, scholarship eligibility and slots, approval routing and case/transition state machines, and the hostel/library institution scope.

Options:

- Option A (recommended): Owner supplies each rule (one line per item below); engineering enforces it server-side with tests. Consequence: requests that succeed today may be rejected (over-capacity, ineligible, invalid transition).
- Option B: Keep permissive behaviour and surface warnings only. Consequence: no rejections; data quality issues remain.

Specialist reviewer: Product owner per module.

Unblocks 13 findings:

| id       | sev    | module      | ledger  | class                | boundary                                                                                                                |
| -------- | ------ | ----------- | ------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| PRC-L436 | low    | app-web     | PARTIAL | BLOCKED_FOR_APPROVAL | business rule (mandatory approval rationale) + exposure of applicant financial data                                     |
| PRC-M209 | medium | db          | PARTIAL | BLOCKED_FOR_APPROVAL | design decision between 247 trigger+grant and fix/partials-close-back2 event table; runtime grant change                |
| PRC-L118 | low    | hostel      | OPEN    | NEEDS_DECISION       | schema/API decision: link hostels to institutions or remove the filter (notes: NEEDS OWNER DECISION; Decision Register… |
| PRC-M277 | medium | hostel      | PARTIAL | BLOCKED_FOR_APPROVAL | business rule (room capacity enforcement) + new vacate/checkout workflow                                                |
| PRC-L129 | low    | library     | PARTIAL | BLOCKED_FOR_APPROVAL | business rule (loan-limit policy) + cross-module student existence contract                                             |
| PRC-L327 | low    | library     | PARTIAL | NEEDS_DECISION       | schema/API decision: add item institution or drop the filter (notes: NEEDS OWNER DECISION; Decision Register group 9)   |
| PRC-M348 | medium | scholarship | OPEN    | BLOCKED_FOR_APPROVAL | business rule (scholarship eligibility enforcement at submit/approve)                                                   |
| PRC-M350 | medium | scholarship | OPEN    | BLOCKED_FOR_APPROVAL | business process (approval routing Req 11.3) + cross-module workflow integration                                        |
| PRC-M540 | medium | scholarship | PARTIAL | BLOCKED_FOR_APPROVAL | business rule (programme status transitions / slot policy)                                                              |
| PRC-M453 | medium | transport   | OPEN    | BLOCKED_FOR_APPROVAL | business rules (vehicle capacity, route date windows, attendance membership)                                            |
| PRC-M460 | medium | workflow    | OPEN    | BLOCKED_FOR_APPROVAL | business rule: case lifecycle state machine (resolution record, no-skip review)                                         |
| PRC-M461 | medium | workflow    | OPEN    | BLOCKED_FOR_APPROVAL | business rule: transition condition evaluator semantics                                                                 |
| PRC-M638 | medium | workflow    | OPEN    | BLOCKED_FOR_APPROVAL | workflow business rules (FINAL/status handling, chained escalation) + concurrency                                       |

### 14. Notification behaviour rules

Decision needed: Decide which events and schedules drive notifications, audience expansion, quiet hours/digest rules, channel opt-out limits and recipient caps.

Options:

- Option A (recommended): Activate the rule engine for an approved event list, define audience expansion per audience type, honour quiet hours except for safety classes, keep at least one channel mandatory for critical categories. Consequence: users start receiving (and stop receiving) messages they get today.
- Option B: Leave the rule engine dormant. Consequence: no new sends; preferences stay ignored.

Specialist reviewer: Product owner (communications) + privacy for recipient data.

Unblocks 6 findings:

| id       | sev    | module        | ledger  | class                | boundary                                                                                                                 |
| -------- | ------ | ------------- | ------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| PRC-L257 | low    | app-web       | OPEN    | NEEDS_DECISION       | notification channel/template consistency product rules (row notes)                                                      |
| PRC-L269 | low    | app-web       | PARTIAL | BLOCKED_FOR_APPROVAL | notification backend preference contract                                                                                 |
| PRC-M190 | medium | communication | OPEN    | NEEDS_DECISION       | product definition of audienceType/audienceIds -> recipient expansion (enrolment/hostel/transport/guardian) is undefine… |
| PRC-M310 | medium | notification  | OPEN    | NEEDS_DECISION       | product rules for quiet hours/digest (which classes bypass, digest cadence) are undefined                                |
| PRC-M529 | medium | notification  | OPEN    | NEEDS_DECISION       | recipient cap / parallelism policy undefined, and processEvent has no caller (PRC-M600)                                  |
| PRC-M600 | medium | notification  | OPEN    | NEEDS_DECISION       | which events/schedules drive notifications (rule-engine activation changes user-visible sends)                           |

### 15. Parked packages: mount with persistence or retire

Decision needed: For each parked package (theme G-605, data-warehouse G-924, plugin, policy, survey, custom-field, search-index, legacy report engine, plugin-sdk dev tooling) decide mount-with-persistence or retire.

Options:

- Option A (recommended): Retire packages with no consumer (search-index, legacy report engine, plugin-sdk dev tooling) and keep the rest parked until a product owner schedules mount + schema + authz. Consequence: findings on retired code close by deletion; the rest stay blocked.
- Option B: Mount all with persistence now. Consequence: large schema/authz workload across several specialist reviews.

Specialist reviewer: Architecture owner + product owner.

Unblocks 14 findings:

| id       | sev    | module              | ledger  | class                | boundary                                                                                                        |
| -------- | ------ | ------------------- | ------- | -------------------- | --------------------------------------------------------------------------------------------------------------- |
| PRC-L450 | low    | custom-field        | OPEN    | NEEDS_DECISION       | mount/persist decision for parked custom-field package; persistence needs schema                                |
| PRC-L457 | low    | data-warehouse      | OPEN    | BLOCKED_FOR_APPROVAL | new GIS parsing dependency / PostGIS schema; package parked (mount-matrix G-924)                                |
| PRC-L481 | low    | plugin              | OPEN    | NEEDS_DECISION       | plugin registry lifecycle model (versioning/deprecate/remove) undefined for a parked package (PRC-L578)         |
| PRC-M605 | medium | plugin-sdk          | OPEN    | NEEDS_DECISION       | row notes: owner decision — mount or remove plugin-sdk dev tooling                                              |
| PRC-L578 | low    | policy              | OPEN    | NEEDS_DECISION       | mount + persistence decision for parked plugin/policy packages; persistence needs schema                        |
| PRC-L488 | low    | report              | OPEN    | NEEDS_DECISION       | row notes: NEEDS OWNER DECISION (delete-or-gate legacy report engine)                                           |
| PRC-L494 | low    | shared-search-index | PARTIAL | NEEDS_DECISION       | which service(s) consume search-index (product scope) — no consumer exists                                      |
| PRC-L166 | low    | survey              | OPEN    | NEEDS_DECISION       | mount/persist decision for parked survey+theme packages (notes: do NOT mount); persistence also needs schema    |
| PRC-M387 | medium | survey              | PARTIAL | NEEDS_DECISION       | runtime enforcement depends on the parked-package mount decision (PRC-L166)                                     |
| PRC-M388 | medium | survey              | PARTIAL | NEEDS_DECISION       | runtime enforcement depends on the parked-package mount decision (PRC-L166)                                     |
| PRC-L173 | low    | theme               | OPEN    | BLOCKED_FOR_APPROVAL | audit-event emission on parked packages; theme mount is G-605 PARKED (apps/api-gateway/src/mount-matrix.ts:571) |
| PRC-M392 | medium | theme               | PARTIAL | BLOCKED_FOR_APPROVAL | gateway mount decision G-605 (/themes owned by platform-admin UI stub)                                          |
| PRC-M394 | medium | theme               | PARTIAL | BLOCKED_FOR_APPROVAL | gateway mount decision G-605 + CSS/URL injection security control                                               |
| PRC-M395 | medium | theme               | PARTIAL | BLOCKED_FOR_APPROVAL | gateway mount decision G-605 + platform/tenant authorization                                                    |

### 16. Standalone/lab servers

Decision needed: Decide whether the standalone attendance, staff, notification and workflow servers are retired or hardened (auth, tenant, DB readiness).

Options:

- Option A (recommended): Retire them from tools/scripts/services.json; the gateway is the only runtime. Consequence: local lab entry points disappear.
- Option B: Harden each server. Consequence: duplicate auth/tenant wiring to maintain.

Specialist reviewer: Architecture owner + security.

Unblocks 4 findings:

| id       | sev    | module       | ledger  | class                | boundary                                                                                                                 |
| -------- | ------ | ------------ | ------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| PRC-L442 | low    | attendance   | OPEN    | NEEDS_DECISION       | owner decision: harden standalone-server.ts (auth/tenant/DB readiness) or retire the lab service from tools/scripts/ser… |
| PRC-L577 | low    | notification | OPEN    | BLOCKED_FOR_APPROVAL | auth/tenant middleware wiring for standalone server                                                                      |
| PRC-L500 | low    | staff        | PARTIAL | NEEDS_DECISION       | owner decision (notes): harden or retire standalone server; hardening touches auth/tenant resolution                     |
| PRC-M458 | medium | workflow     | OPEN    | BLOCKED_FOR_APPROVAL | auth/tenant context wiring for standalone server                                                                         |

### 17. Placeholder, demo and dead surfaces (product/IA)

Decision needed: Decide for each placeholder or dead surface whether to build it, hide it behind a flag, or delete it, and confirm the two D6 items Wave 0 kept open.

Options:

- Option A (recommended): Hide demo/placeholder surfaces behind flags off by default, delete dead routes/layouts, keep sandbox GPS and stub ISBN provider off in production, confirm L421/L439 closure (or keep open) explicitly. Consequence: some screens disappear for users until built.
- Option B: Build the missing features now. Consequence: map library, routes and backends to fund.

Specialist reviewer: Product/IA owner + UX owner.

Unblocks 14 findings:

| id       | sev    | module               | ledger  | class                | boundary                                                                                                                 |
| -------- | ------ | -------------------- | ------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| PRC-L399 | low    | app-developer-portal | OPEN    | NEEDS_DECISION       | product/IA: delete dead (portal) layout vs build the four routes (row notes)                                             |
| PRC-L011 | low    | app-mobile           | PARTIAL | NEEDS_DECISION       | offline-first free-text fallback is a product/UX choice recorded in notes                                                |
| PRC-L038 | low    | app-web              | OPEN    | NEEDS_DECISION       | product flag/scope decision for demo surfaces (DECISION_REGISTER.md §7, unresolved)                                      |
| PRC-L421 | low    | app-web              | OPEN    | NEEDS_DECISION       | Merged D6 PR #634 ledger table keeps L421 OPEN ("root cause is a live module/backend, not resolved by deletion"). Tip s… |
| PRC-L424 | low    | app-web              | OPEN    | NEEDS_DECISION       | product decision: add a map library dependency vs relabel (DECISION_REGISTER.md §7)                                      |
| PRC-L439 | low    | app-web              | OPEN    | NEEDS_DECISION       | Merged D6 PR #634 ledger table keeps L439 OPEN ("root cause is a live module/backend"). Tip grep finds no settings.gene… |
| PRC-L534 | low    | app-web              | PARTIAL | NEEDS_DECISION       | product/IA: route the marketing pages vs delete the chrome                                                               |
| PRC-M155 | medium | app-web              | PARTIAL | NEEDS_DECISION       | UUID lookup vs free-text code decision shared with PRC-M290 (in-flight PR #654, NEEDS_DECISION); catalogue seed/migrati… |
| PRC-L463 | low    | db                   | PARTIAL | BLOCKED_FOR_APPROVAL | product decision: wire consumers (student merge/search/transcript signing services) vs retire tables (schema)            |
| PRC-M211 | medium | db                   | OPEN    | NEEDS_DECISION       | Title says nothing creates deliveries. At tip fan-out is opt-in: parseWebhookFanOutEvents returns [] when WEBHOOK_FANOU… |
| PRC-M293 | medium | library              | PARTIAL | NEEDS_DECISION       | provider/integration decision (notes: NEEDS OWNER DECISION)                                                              |
| PRC-M445 | medium | transport            | PARTIAL | NEEDS_DECISION       | feature decision (notes): persist sandbox GPS/attendance-on-bus or hard-gate them off in production                      |
| PRC-L594 | low    | ui-dashboards        | OPEN    | NEEDS_DECISION       | map library feature vs removing a public export (package API; register §7)                                               |
| PRC-L520 | low    | ui-form-builder      | OPEN    | NEEDS_DECISION       | mount-vs-remove decision for unused ui scaffolding packages                                                              |

### 18. File upload trust and malware scanning

Decision needed: Decide the server-side trust contract for uploads: content sniffing, AV scanning, storage path ownership and the scan status the UI receives.

Options:

- Option A (recommended): Server sniffs type and scans every upload before it is usable; storage paths and uploader come from the server; FileUpload exposes an async scan status. Consequence: needs an AV service; uploads become asynchronous.
- Option B: Extension and size checks only. Consequence: no new service; malicious files remain possible.

Specialist reviewer: Security specialist + UI platform owner.

Unblocks 4 findings:

| id       | sev    | module         | ledger  | class                | boundary                                                                                                 |
| -------- | ------ | -------------- | ------- | -------------------- | -------------------------------------------------------------------------------------------------------- |
| PRC-M330 | medium | registration   | PARTIAL | BLOCKED_FOR_APPROVAL | AV-scanning integration (security/infra) and upload transport contract                                   |
| PRC-L200 | low    | ui-file-upload | OPEN    | NEEDS_DECISION       | FileUpload server-trust/scan contract (row notes: owner decision); file validation is a security control |
| PRC-L201 | low    | ui-file-upload | OPEN    | NEEDS_DECISION       | FileUpload component API (async result / scan status) — owner decision per notes                         |
| PRC-M459 | medium | workflow       | PARTIAL | BLOCKED_FOR_APPROVAL | file-storage path trust and uploader identity (authz/security)                                           |

### 19. Shared UI component API contracts

Decision needed: Decide the public API of BulkImport (import id/idempotency, re-validation on mapping change) and FormBuilder field types (implement vs trim the union).

Options:

- Option A (recommended): Add importId/idempotency and onFileValidate(file, mappings); trim FormBuilder field types to the ones rendered. Consequence: breaking prop changes for package consumers.
- Option B: Keep current props and document limits.

Specialist reviewer: UI platform owner.

Unblocks 3 findings:

| id       | sev    | module          | ledger | class          | boundary                                                                                        |
| -------- | ------ | --------------- | ------ | -------------- | ----------------------------------------------------------------------------------------------- |
| PRC-L393 | low    | ui-bulk-import  | OPEN   | NEEDS_DECISION | BulkImport onImportConfirm contract (importId/idempotency) — owner decision per notes           |
| PRC-M455 | medium | ui-bulk-import  | OPEN   | NEEDS_DECISION | BulkImport validation contract (onFileValidate(file, mappings)) — owner decision per notes      |
| PRC-M637 | medium | ui-form-builder | OPEN   | NEEDS_DECISION | FormBuilder FieldType API (explicit renderers vs trimming the union) — owner decision per notes |

### 20. Product behaviour defaults: authenticated caching and duplicate submits

Decision needed: Decide the caching policy for authenticated reads (Decision Register group 8) and the UX rule for create actions (confirm-before-dismiss, disable-after-success, idempotent retry).

Options:

- Option A (recommended): no-store for authenticated reads (or per-tenant/user cache tags where measured), and disable-after-success plus an idempotency key on create forms. Consequence: more gateway reads; no stale cross-session data; double-submits rejected.
- Option B: Keep revalidate 30/60 and current forms. Consequence: no change; stale data and duplicate records stay possible.

Specialist reviewer: Platform owner + UX owner.

Unblocks 2 findings:

| id       | sev | module  | ledger  | class          | boundary                                                                                                        |
| -------- | --- | ------- | ------- | -------------- | --------------------------------------------------------------------------------------------------------------- |
| PRC-L251 | low | app-web | PARTIAL | NEEDS_DECISION | UX semantics for create actions (confirm-before-dismiss, disable-after-success, rotate-vs-create) per row notes |
| PRC-L266 | low | app-web | OPEN    | NEEDS_DECISION | caching policy for authenticated reads (DECISION_REGISTER.md §8)                                                |

### 21. Localisation scope

Decision needed: Decide which surfaces are localised now, the target locale set, and whether locale is persisted per user (Decision Register group 4).

Options:

- Option A (recommended): Localise mobile and shared UI widgets first for the approved locale set; persist locale per user and announce changes. Consequence: string-externalisation work across packages.
- Option B: English-only for now. Consequence: no work; findings stay open.

Specialist reviewer: Product owner + UX/localisation reviewer.

Unblocks 3 findings:

| id       | sev | module         | ledger  | class          | boundary                                                                                            |
| -------- | --- | -------------- | ------- | -------------- | --------------------------------------------------------------------------------------------------- |
| PRC-L007 | low | app-mobile     | PARTIAL | NEEDS_DECISION | i18n scope decision (DECISION_REGISTER.md §4, unresolved)                                           |
| PRC-L273 | low | app-web        | PARTIAL | NEEDS_DECISION | i18n persistence/announcement policy (row notes: provider UX + per-user persistence owner decision) |
| PRC-L195 | low | ui-bulk-import | PARTIAL | NEEDS_DECISION | i18n scope decision (DECISION_REGISTER.md §4 names PRC-L195)                                        |

### 22. Dependency additions and external integrations

Decision needed: Approve new dependencies and external services: sandbox isolation for plugins, vitest-axe, mysql2, kafkajs, CDN purge clients, live provider clients and report e-mail delivery.

Options:

- Option A (recommended): Approve per item after supply-chain review (pinned versions, lockfile change in its own PR). Consequence: lockfile changes and new runtime services to operate.
- Option B: Remove the stubbed features instead. Consequence: fewer dependencies; the features go away.

Specialist reviewer: Dependency/supply-chain owner + security.

Unblocks 7 findings:

| id       | sev    | module           | ledger  | class                | boundary                                                                     |
| -------- | ------ | ---------------- | ------- | -------------------- | ---------------------------------------------------------------------------- |
| PRC-M602 | medium | plugin           | PARTIAL | BLOCKED_FOR_APPROVAL | security isolation boundary + dependency (isolated-vm or process isolation)  |
| PRC-M326 | medium | providers        | OPEN    | BLOCKED_FOR_APPROVAL | provider integrations (credentials, new client dependencies, payments)       |
| PRC-M338 | medium | report           | OPEN    | BLOCKED_FOR_APPROVAL | external email/notification integration for PII report delivery              |
| PRC-L489 | low    | shared-cdn       | OPEN    | BLOCKED_FOR_APPROVAL | dependency + external integration (AWS CloudFront SDK / CDN purge clients)   |
| PRC-M423 | medium | tools-migrations | PARTIAL | BLOCKED_FOR_APPROVAL | new dependency (mysql2) + legacy source access                               |
| PRC-M552 | medium | tools-migrations | PARTIAL | BLOCKED_FOR_APPROVAL | new dependency (kafkajs) + live Kafka/MySQL; event contract                  |
| PRC-L597 | low    | ui-form-builder  | PARTIAL | BLOCKED_FOR_APPROVAL | dependency addition (vitest-axe dev-dep in widget packages; lockfile change) |

### 23. Repository governance and design-token gates

Decision needed: Decide CODEOWNERS/branch-protection teams and whether to fix the baselined WCAG AA contrast pairs by changing brand colours.

Options:

- Option A (recommended): Replace the personal-interim CODEOWNERS waiver with org teams; change the 10 failing token pairs to meet AA. Consequence: review routing changes; visible colour changes.
- Option B: Keep the waiver and the contrast baseline.

Specialist reviewer: Repository owner + UX/a11y owner.

Unblocks 2 findings:

| id       | sev    | module        | ledger | class                | boundary                                                           |
| -------- | ------ | ------------- | ------ | -------------------- | ------------------------------------------------------------------ |
| PRC-M261 | medium | github        | OPEN   | BLOCKED_FOR_APPROVAL | repository governance (CODEOWNERS, branch protection, org teams)   |
| PRC-M430 | medium | tools-scripts | OPEN   | BLOCKED_FOR_APPROVAL | design-token/brand colour changes (UX/a11y owner) + CI gate policy |

### 24. Data migration tooling and seeds

Decision needed: Decide the semantics of legacy-migration tooling (generate-uuids legacy id, DB-backed tests) and the expected seed data/classification, including checksum-locked cert seeds.

Options:

- Option A (recommended): Fix generate-uuids semantics first, then add DB-backed tests in CI; define seed data classification and re-baseline seed checksums in a migration batch. Consequence: seed checksums change (apply-sql ledger).
- Option B: Freeze tooling as-is for the one-off migration.

Specialist reviewer: Data/migration specialist.

Unblocks 4 findings:

| id       | sev    | module           | ledger  | class                | boundary                                                                                                                 |
| -------- | ------ | ---------------- | ------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| PRC-L462 | low    | db               | PARTIAL | BLOCKED_FOR_APPROVAL | Boundary: business data classification decision. 'Wrong sector/ownership' and teardown have no defined expected values…  |
| PRC-L556 | low    | db               | PARTIAL | BLOCKED_FOR_APPROVAL | Boundary: SCHEMA_BATCH / migration specialist. Cert and colocated seeds are checksum-ledgered by tools/scripts/apply-sq… |
| PRC-M419 | medium | tools-migrations | OPEN    | BLOCKED_FOR_APPROVAL | Boundary: depends on PRC-M553 (DB-backed tests would fail until generate-uuids is fixed) and needs a migrated live Post… |
| PRC-M553 | medium | tools-migrations | OPEN    | BLOCKED_FOR_APPROVAL | Boundary: DB schema/migration semantics. tools/migrations/src/generate-uuids.ts:110-123 ALTER TABLE ADD COLUMN _legacy_… |

### 25. Infrastructure operating decisions

Decision needed: Decide the DNS-01 provider for wildcard TLS, the production datastore locations for NetworkPolicy egress, and backup lock mode / PITR economics.

Options:

- Option A (recommended): Pick the DNS provider and solver secret, document datastore CIDRs, move backups to COMPLIANCE object lock with PITR. Consequence: infra cost and an immutable-backup retention commitment.
- Option B: Keep current settings. Consequence: wildcard TLS and egress stay unresolved.

Specialist reviewer: Platform/SRE owner.

Unblocks 3 findings:

| id       | sev    | module         | ledger  | class                | boundary                                                                                 |
| -------- | ------ | -------------- | ------- | -------------------- | ---------------------------------------------------------------------------------------- |
| PRC-L565 | low    | infrastructure | OPEN    | BLOCKED_FOR_APPROVAL | ops/DNS decision (DNS-01 ClusterIssuer provider + solver secret) recorded in ledger note |
| PRC-M522 | medium | infrastructure | PARTIAL | BLOCKED_FOR_APPROVAL | production network policy needs operator datastore location                              |
| PRC-M624 | medium | infrastructure | OPEN    | BLOCKED_FOR_APPROVAL | DR/retention economics decision (COMPLIANCE-only lock, PITR) per ledger note             |

## Approval checklist

- [ ] Approve topic 1 (Authentication and session policy), option A or another option → unblocks 21 findings
- [ ] Approve topic 2 (Secrets, signing keys and production fail-closed configuration), option A or another option → unblocks 13 findings
- [ ] Approve topic 3 (Authorization model, ownership and separation of duties), option A or another option → unblocks 23 findings
- [ ] Approve topic 4 (Tenant isolation, tenant resolution and provisioning), option A or another option → unblocks 15 findings
- [ ] Approve topic 5 (Audit trail integrity and audit retention), option A or another option → unblocks 10 findings
- [ ] Approve topic 6 (Child-data privacy: consent, minimisation, retention and erasure (DPDP)), option A or another option → unblocks 20 findings
- [ ] Approve topic 7 (Health (PHI) access, audit and deletion controls), option A or another option → unblocks 8 findings
- [ ] Approve topic 8 (Money model, fees, payments, refunds and payroll rules), option A or another option → unblocks 17 findings
- [ ] Approve topic 9 (Statutory records, results release and grading rules), option A or another option → unblocks 8 findings
- [ ] Approve topic 10 (New or changed backend API and event contracts), option A or another option → unblocks 16 findings
- [ ] Approve topic 11 (List paging and list-result contract), option A or another option → unblocks 5 findings
- [ ] Approve topic 12 (Attendance, calendar and timezone rules), option A or another option → unblocks 10 findings
- [ ] Approve topic 13 (Operational business rules (library, hostel, transport, scholarship, workflow)), option A or another option → unblocks 13 findings
- [ ] Approve topic 14 (Notification behaviour rules), option A or another option → unblocks 6 findings
- [ ] Approve topic 15 (Parked packages: mount with persistence or retire), option A or another option → unblocks 14 findings
- [ ] Approve topic 16 (Standalone/lab servers), option A or another option → unblocks 4 findings
- [ ] Approve topic 17 (Placeholder, demo and dead surfaces (product/IA)), option A or another option → unblocks 14 findings
- [ ] Approve topic 18 (File upload trust and malware scanning), option A or another option → unblocks 4 findings
- [ ] Approve topic 19 (Shared UI component API contracts), option A or another option → unblocks 3 findings
- [ ] Approve topic 20 (Product behaviour defaults: authenticated caching and duplicate submits), option A or another option → unblocks 2 findings
- [ ] Approve topic 21 (Localisation scope), option A or another option → unblocks 3 findings
- [ ] Approve topic 22 (Dependency additions and external integrations), option A or another option → unblocks 7 findings
- [ ] Approve topic 23 (Repository governance and design-token gates), option A or another option → unblocks 2 findings
- [ ] Approve topic 24 (Data migration tooling and seeds), option A or another option → unblocks 4 findings
- [ ] Approve topic 25 (Infrastructure operating decisions), option A or another option → unblocks 3 findings

Each approval should be recorded in `DECISION_REGISTER.md` (or `decisions/`) and in the affected ledger rows' notes before a batch picks the findings up.

## Specialist batches (schema and infrastructure)

These need their own batch branches and specialist review under the audit-gap fast-mode rule, not an owner decision. Groupings are proposals.

### SCHEMA_BATCH (58)

#### S1. Tenant-composite FKs and RLS policy hardening (11)

Reviewer: Tenancy/RLS + data specialist.

| id       | sev    | module        | ledger  | boundary                                                                                                         |
| -------- | ------ | ------------- | ------- | ---------------------------------------------------------------------------------------------------------------- |
| PRC-L289 | low    | curriculum    | PARTIAL | composite (tenant_id, id) FKs need a migration; reference checks touch tenant isolation                          |
| PRC-L091 | low    | db            | OPEN    | RLS policy rewrite (forward migration) + EXPLAIN/perf tests                                                      |
| PRC-L095 | low    | db            | OPEN    | tenant-composite FKs (tenant isolation) migration                                                                |
| PRC-L294 | low    | db            | PARTIAL | RLS policies + CI gate                                                                                           |
| PRC-L297 | low    | db            | OPEN    | authorization-derived FK semantics + index migration                                                             |
| PRC-L557 | low    | db            | PARTIAL | view recreation over RLS table (forward migration)                                                               |
| PRC-M195 | medium | db            | OPEN    | tenant-composite FKs (tenant isolation) on money/PII edges                                                       |
| PRC-M208 | medium | db            | OPEN    | tenant-composite FKs (tenant isolation)                                                                          |
| PRC-M216 | medium | db            | OPEN    | FK re-validation migration under FORCE RLS                                                                       |
| PRC-M548 | medium | student       | PARTIAL | class_id FK and composite tenant FKs need a student migration; in-tenant reference checks touch tenant isolation |
| PRC-M433 | medium | tools-scripts | OPEN    | forward FK re-validation migration + waiver expiry                                                               |

#### S2. Uniqueness, EXCLUDE and race constraints (13)

Reviewer: Data specialist.

| id       | sev    | module           | ledger  | boundary                                                                                              |
| -------- | ------ | ---------------- | ------- | ----------------------------------------------------------------------------------------------------- |
| PRC-L082 | low    | assessment       | OPEN    | unique index on (tenant_id, lower(name)) needs a migration                                            |
| PRC-L555 | low    | db               | PARTIAL | EXCLUDE/range constraint (btree_gist) migration                                                       |
| PRC-M206 | medium | db               | OPEN    | unique/EXCLUDE constraints migration with duplicate reconciliation                                    |
| PRC-M213 | medium | db               | PARTIAL | EXCLUDE constraint migration live verification                                                        |
| PRC-M506 | medium | db               | OPEN    | column type migrations + EXCLUDE (btree_gist)                                                         |
| PRC-L299 | low    | developer-portal | OPEN    | DB unique constraints / transactional limit guards (migration)                                        |
| PRC-L130 | low    | library          | OPEN    | per-tenant uniqueness on library_items isbn/barcode needs a migration (plus duplicate reconciliation) |
| PRC-M335 | medium | registration     | OPEN    | optimistic version column / locked transactions on admission_enquiries and merit lists                |
| PRC-L152 | low    | staff            | OPEN    | partial unique index excluding soft-deleted staff needs a migration                                   |
| PRC-M389 | medium | tenant           | OPEN    | unique (tenant_id, revision) constraint + locked allocation                                           |
| PRC-M396 | medium | timetable        | PARTIAL | cross-bell-schedule exclusion needs a new migration (btree_gist range exclusion)                      |
| PRC-M447 | medium | transport        | PARTIAL | partial unique constraint for one active assignment needs a migration                                 |
| PRC-M462 | medium | workflow         | OPEN    | active-instance-per-entity uniqueness + escalation outbox design                                      |

#### S3. Finance, billing and payroll constraints (7)

Reviewer: Finance owner + data specialist.

| id       | sev    | module  | ledger  | boundary                                                                |
| -------- | ------ | ------- | ------- | ----------------------------------------------------------------------- |
| PRC-L086 | low    | billing | PARTIAL | shared @proctira/database document collection + control-plane migration |
| PRC-L286 | low    | billing | PARTIAL | depends on PRC-M184 transaction/lock work (schema batch) + live PG      |
| PRC-M184 | medium | billing | PARTIAL | unique plan-name index + multi-key tx in shared document collection     |
| PRC-L094 | low    | db      | OPEN    | financial amount consistency CHECK + backfill reconciliation            |
| PRC-M197 | medium | db      | PARTIAL | financial constraints + currency default (Decision D1) migration        |
| PRC-M207 | medium | db      | PARTIAL | payroll uniqueness migration live verification                          |
| PRC-L107 | low    | fees    | PARTIAL | per-tenant invoice/receipt sequence needs a migration                   |

#### S4. Durable state, claim/lease and lifecycle columns (15)

Reviewer: Data specialist + domain owners.

| id       | sev    | module           | ledger  | boundary                                                                                                                 |
| -------- | ------ | ---------------- | ------- | ------------------------------------------------------------------------------------------------------------------------ |
| PRC-L529 | low    | app-api-gateway  | PARTIAL | workflow_ui_approvals needs decided_by/decision columns                                                                  |
| PRC-M592 | medium | data-warehouse   | OPEN    | new tables + RLS policies; mounting is a product decision (G-924 parked)                                                 |
| PRC-M196 | medium | db               | OPEN    | new tenant columns on global tables + background worker (product feature)                                                |
| PRC-M212 | medium | db               | OPEN    | FK + retention migration on developer-portal tables                                                                      |
| PRC-L097 | low    | developer-portal | PARTIAL | durable tables for analytics/docs/ratings                                                                                |
| PRC-L464 | low    | developer-portal | PARTIAL | durable delivery claim/lease state                                                                                       |
| PRC-L569 | low    | install          | OPEN    | actor/ip/user-agent on install_bootstrap_runs needs columns; table itself not in db/sql (PRC-M626)                       |
| PRC-M626 | medium | install          | OPEN    | install_bootstrap_runs table/migration + secret-ref storage                                                              |
| PRC-L132 | low    | lms              | OPEN    | server-issued practice-item binding needs persisted issued-item state (migration)                                        |
| PRC-M301 | medium | lms              | OPEN    | time-limit enforcement needs an attempt-start record (migration)                                                         |
| PRC-L576 | low    | notification     | OPEN    | delivery claim needs a claimed/sending state; notifications.status CHECK allows only sent/delivered/read/failed (db/sql… |
| PRC-L144 | low    | report           | OPEN    | Idempotency-Key for generate needs a persisted key/column; stale-run reaper state                                        |
| PRC-M381 | medium | staff            | PARTIAL | dedicated offboard status column needs a staff migration                                                                 |
| PRC-M443 | medium | transport        | PARTIAL | UNIQUE(tenant_id, vehicle_id) relaxation needs a migration; device-key lifecycle is also a security control              |
| PRC-M449 | medium | transport        | OPEN    | FK ON DELETE CASCADE -> RESTRICT/soft-delete needs a transport migration                                                 |

#### S5. Audit, retention and privacy schema (6)

Reviewer: Data specialist + privacy/audit reviewer.

| id       | sev    | module          | ledger  | boundary                                                                   |
| -------- | ------ | --------------- | ------- | -------------------------------------------------------------------------- |
| PRC-L092 | low    | db              | OPEN    | table partitioning migration + retention purge job (data retention policy) |
| PRC-L093 | low    | db              | PARTIAL | audit trail mirroring (forward migration) + live-PG verification           |
| PRC-L293 | low    | db              | PARTIAL | audit trigger trust (security) forward migration + live-PG verification    |
| PRC-L296 | low    | db              | OPEN    | checksum-locked migration 090                                              |
| PRC-M325 | medium | privacy         | PARTIAL | per-subject-table legal-hold triggers need migrations across domain tables |
| PRC-L147 | low    | shared-database | OPEN    | tenant offboarding/erasure (privacy lifecycle) + locked Prisma migration   |

#### S6. Domain fields and column type corrections (6)

Reviewer: Data specialist + domain owners.

| id       | sev    | module          | ledger  | boundary                                                             |
| -------- | ------ | --------------- | ------- | -------------------------------------------------------------------- |
| PRC-L036 | low    | app-web         | PARTIAL | examination candidate schema field (board registration number)       |
| PRC-M482 | medium | app-web         | PARTIAL | scholarship program code column                                      |
| PRC-M198 | medium | db              | PARTIAL | SIS integrity constraints migration + live-PG verification           |
| PRC-M231 | medium | examination     | PARTIAL | room_id normalization to rooms needs a migration + operator backfill |
| PRC-L350 | low    | shared-database | PARTIAL | column type migration (float->numeric) in examination domain         |
| PRC-M400 | medium | timetable       | PARTIAL | schema migration (db/sql/230) requires live-PG verification          |

### INFRA_BATCH (41)

#### I1. CI workflow gates and aggregate topology (12)

Reviewer: Platform/CI owner.

| id       | sev    | module           | ledger  | boundary                                           |
| -------- | ------ | ---------------- | ------- | -------------------------------------------------- |
| PRC-L108 | low    | github           | OPEN    | CI workflow config (scheduled workflows)           |
| PRC-L110 | low    | github           | OPEN    | CI workflow config (concurrency)                   |
| PRC-L307 | low    | github           | PARTIAL | CI aggregate/release gating topology               |
| PRC-L309 | low    | github           | OPEN    | CI lint/format gate scope                          |
| PRC-L351 | low    | shared-database  | PARTIAL | CI workflow gate for Prisma-only deploy FORCE RLS  |
| PRC-L176 | low    | tools-load-test  | PARTIAL | CI workflow wiring + live stack for k6             |
| PRC-M425 | medium | tools-migrations | PARTIAL | CI workflow job for @proctira/migrations           |
| PRC-M428 | medium | tools-scripts    | OPEN    | CI aggregate topology / path filters               |
| PRC-M429 | medium | tools-scripts    | OPEN    | CI gate needing seeded authenticated session       |
| PRC-M431 | medium | tools-scripts    | OPEN    | CI evidence gates (gh api verification, CI wiring) |
| PRC-M434 | medium | tools-scripts    | OPEN    | CI workflow wiring                                 |
| PRC-M558 | medium | tools-scripts    | OPEN    | CI coverage gate policy                            |

#### I2. CI e2e harness with seeded backend (3)

Reviewer: Platform/CI owner + QA.

| id       | sev    | module                  | ledger  | boundary                                          |
| -------- | ------ | ----------------------- | ------- | ------------------------------------------------- |
| PRC-M005 | medium | app-admin-console       | PARTIAL | CI harness: seeded backend + platform-admin login |
| PRC-M568 | medium | app-registration-portal | PARTIAL | CI e2e backend/seed wiring                        |
| PRC-L263 | low    | app-web                 | PARTIAL | CI e2e backend/seed wiring (shared with PRC-M568) |

#### I3. Supply chain and release pipeline (7)

Reviewer: Security/supply-chain owner.

| id       | sev    | module             | ledger  | boundary                                               |
| -------- | ------ | ------------------ | ------- | ------------------------------------------------------ |
| PRC-L223 | low    | app-public-website | PARTIAL | container image / base-image pinning policy            |
| PRC-L109 | low    | github             | OPEN    | release pipeline (image tagging)                       |
| PRC-L111 | low    | github             | OPEN    | dependency update automation (dependabot config)       |
| PRC-L308 | low    | github             | OPEN    | CI supply-chain verification                           |
| PRC-M255 | medium | github             | OPEN    | supply-chain signing + admission verification (deploy) |
| PRC-M513 | medium | github             | OPEN    | production deploy policy                               |
| PRC-M599 | medium | infrastructure     | PARTIAL | Helm chart render-time guard                           |

#### I4. Production deploy, DR and migration rollout (4)

Reviewer: SRE + data specialist.

| id       | sev    | module        | ledger  | boundary                                                                                |
| -------- | ------ | ------------- | ------- | --------------------------------------------------------------------------------------- |
| PRC-L290 | low    | db            | PARTIAL | migration apply posture default (tools/scripts/apply-sql.sh) + checksum-locked base DDL |
| PRC-M258 | medium | github        | OPEN    | production DR / migration rollout                                                       |
| PRC-L380 | low    | tools-scripts | PARTIAL | migration apply default posture (strict FK default)                                     |
| PRC-L383 | low    | tools-scripts | PARTIAL | backup/DR pipeline (helm env assertion, post-upload decrypt)                            |

#### I5. Edge, proxy and replica configuration (3)

Reviewer: Security + platform owner.

| id       | sev    | module             | ledger  | boundary                                                                                      |
| -------- | ------ | ------------------ | ------- | --------------------------------------------------------------------------------------------- |
| PRC-M012 | medium | app-api-gateway    | OPEN    | deployment overlays must set TRUSTED_PROXY_CIDRS; overlaps PRC-M524 (infrastructure, PARTIAL) |
| PRC-L216 | low    | app-public-website | PARTIAL | edge proxy-hop count / edge rate limiting                                                     |
| PRC-L567 | low    | infrastructure     | PARTIAL | Kustomize PDB/replica config                                                                  |

#### I6. Storage, broker and external-system fail-closed config (6)

Reviewer: Platform owner + security.

| id       | sev    | module         | ledger  | boundary                                                                                     |
| -------- | ------ | -------------- | ------- | -------------------------------------------------------------------------------------------- |
| PRC-M514 | medium | gradebook      | PARTIAL | artifact storage durability (object storage / deploy paths)                                  |
| PRC-M303 | medium | lms            | OPEN    | production storage configuration / fail-closed boot behaviour (notes: needs external system) |
| PRC-M355 | medium | scholarship    | OPEN    | object storage + AV scanning (external systems) and production fail-closed config            |
| PRC-M612 | medium | shared-events  | PARTIAL | RabbitMQ delayed-exchange plugin / broker config + publisher confirms                        |
| PRC-M366 | medium | shared-storage | PARTIAL | IaC bucket lifecycle/ILM rules                                                               |
| PRC-M543 | medium | staff          | PARTIAL | scheduler/notification-service wiring (ops integration)                                      |

#### I7. Observability and local compose (6)

Reviewer: SRE.

| id       | sev    | module | ledger  | boundary                                |
| -------- | ------ | ------ | ------- | --------------------------------------- |
| PRC-L460 | low    | db     | PARTIAL | local compose / DB bootstrap roles      |
| PRC-L134 | low    | ops    | OPEN    | observability alert rules (ops config)  |
| PRC-L335 | low    | ops    | PARTIAL | compose service config                  |
| PRC-M311 | medium | ops    | PARTIAL | local/dev compose topology              |
| PRC-M312 | medium | ops    | OPEN    | observability scrape config/alert rules |
| PRC-M530 | medium | ops    | PARTIAL | compose topology / provider defaults    |

## Notes

- PRC-L421 and PRC-L439: app_web_batch1 reported them STALE, but the Wave 0 consolidation gate keeps them `NEEDS_DECISION` because merged PR #634 (Decision D6) kept them OPEN. The ledger keeps them OPEN until the owner confirms (topic 17).
- PRC-L211 touches the parent-portal module claimed by the in-flight parent-portal batch; role-name items (topic 3) depend on PR #633.
- Some PARTIAL rows carry a residual that is itself blocked on approval (for example PRC-M166, PRC-M515, PRC-L330, PRC-L333, PRC-M409, PRC-M410, PRC-M551, PRC-L448, PRC-L554). They are not counted above; their residuals are in the ledger notes.
