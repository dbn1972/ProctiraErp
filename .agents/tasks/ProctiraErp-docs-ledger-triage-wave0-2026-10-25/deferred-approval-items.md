# Wave 0 deferred approval items

Rows that stay OPEN/PARTIAL and must not enter a fast-mode batch without an owner, specialist or decision (326 rows). Boundaries come from the triage row (`boundary`) or the consolidation gate. Claimed in-flight rows (44) are listed in `defect-registry.md`, not here.

| Class | Rows | Route |
|---|---|---|
| BLOCKED_FOR_APPROVAL | 155 | specialist/owner approval (auth, tenancy, privacy, finance, audit, API contract, dependency) |
| NEEDS_DECISION | 72 | owner decision (DECISION_REGISTER.md / row notes / gate conflict) |
| SCHEMA_BATCH | 58 | own migration/schema batch with data specialist review |
| INFRA_BATCH | 41 | own infra/CI batch with platform review |

## BLOCKED_FOR_APPROVAL (155)

| id | sev | module | disposition | boundary |
|---|---|---|---|---|
| PRC-L202 | low | app-admin-console | OPEN | authentication (JWKS signature/issuer/audience verification in console shell; role catalogue D2) |
| PRC-M464 | medium | app-admin-console | OPEN | authentication/session lifecycle (refresh, upstream revoke, MFA/lockout via external auth service) |
| PRC-M013 | medium | app-api-gateway | PARTIAL | audit security control: same-transaction audit across grades/attendance/staff/student/scholarship/tenant-admin domains |
| PRC-M022 | medium | app-api-gateway | PARTIAL | authorization: approval-decider lookup (checkApprovalDecider) scans a truncated list |
| PRC-M026 | medium | app-api-gateway | PARTIAL | identity provisioning surface (SCIM over RolesService tenant directory) |
| PRC-M027 | medium | app-api-gateway | OPEN | authentication: dedicated hashed SCIM token + session/token revocation on deprovision |
| PRC-L006 | low | app-mobile | PARTIAL | new backend report API (tenant-scoped attendance aggregate contract) |
| PRC-L211 | low | app-mobile | OPEN | parent-portal API contract (guardian-scoped list routes need a studentId filter); parent-portal module is owned by in-flight fix/audit-parent-portal-batch |
| PRC-L213 | low | app-mobile | PARTIAL | auth/tenant membership endpoint (tenant isolation) |
| PRC-M031 | medium | app-mobile | OPEN | student API response contract (StudentResponseSchema has no class/section field) |
| PRC-M468 | medium | app-mobile | PARTIAL | attendance API contract + location PII capture |
| PRC-L048 | low | app-web | PARTIAL | staff record API contract (structured fields instead of customData) |
| PRC-L054 | low | app-web | PARTIAL | business rule source (tenant attendance threshold / grading scale) |
| PRC-L056 | low | app-web | PARTIAL | leave-balance/entitlement backend data contract |
| PRC-L078 | low | app-web | OPEN | tenant entitlement source (new backend /tenant/entitlements contract feeding client gating) |
| PRC-L236 | low | app-web | PARTIAL | new examination backend bulk-invigilators API contract |
| PRC-L254 | low | app-web | OPEN | authentication (server-side JWT signature verification or gateway /auth/me round-trip) |
| PRC-L256 | low | app-web | PARTIAL | statutory audit-retention rule + audit API contract |
| PRC-L264 | low | app-web | OPEN | audit trail integrity (server-side audit in tenant-admin handlers, same transaction) |
| PRC-L265 | low | app-web | OPEN | tenant resolution / tenant isolation |
| PRC-L268 | low | app-web | OPEN | financial: money representation contract (D1 minor units) across scholarship/admission-offer backend+client |
| PRC-L269 | low | app-web | PARTIAL | notification backend preference contract |
| PRC-L436 | low | app-web | PARTIAL | business rule (mandatory approval rationale) + exposure of applicant financial data |
| PRC-L532 | low | app-web | PARTIAL | public data exposure allow-list + rate limiting (privacy/security) |
| PRC-L544 | low | app-web | OPEN | auth/CSRF credential handling on offline replay + sync policy |
| PRC-L545 | low | app-web | PARTIAL | authentication (forged-token verification, PRC-L254) |
| PRC-M057 | medium | app-web | PARTIAL | authentication: external auth-service signup / signup-roles contract |
| PRC-M090 | medium | app-web | PARTIAL | financial: refund-by-payment backend contract |
| PRC-M121 | medium | app-web | OPEN | PHI authorization (permission gating, teacher section scope, PHI-read audit) |
| PRC-M130 | medium | app-web | OPEN | transport API contract (route/date/direction trip filters, assignment validation) |
| PRC-M132 | medium | app-web | PARTIAL | new public slug-addressed branding endpoint (unauthenticated tenant data, tenant resolution) |
| PRC-M133 | medium | app-web | PARTIAL | authentication: external auth-service response contract |
| PRC-M148 | medium | app-web | PARTIAL | student API contract (StudentListQuerySchema) |
| PRC-L274 | low | assessment | PARTIAL | authorization/privacy (per-student scoping of minor data, guardian access path) |
| PRC-L280 | low | audit | PARTIAL | authorization: gateway audit-logs scope mapping (tenant-admin access) |
| PRC-L284 | low | auth | OPEN | auth secrets / production boot validation (also infra-owned redirect + web-origin config) |
| PRC-L445 | low | auth | OPEN | authentication: local login disclosure/timing |
| PRC-M179 | medium | auth | PARTIAL | RBAC scope model (area/institution) — notes: needs new schema + shared-RBAC change |
| PRC-M497 | medium | auth | PARTIAL | authentication: gateway login handler must mint/verify a pre-MFA ticket (resolvePrimaryAuth/issueCompletionTicket) |
| PRC-M587 | medium | auth | PARTIAL | authentication + dependency change (XML-DSig verifying parser, e.g. @node-saml/node-saml) |
| PRC-M589 | medium | auth | PARTIAL | authentication: multi-replica external-IdP state store |
| PRC-L089 | low | communication | OPEN | frozen API contract: surfacing live-count errors changes the audience preview response shape (per row notes) |
| PRC-L446 | low | custom-field | OPEN | authorization for student/staff custom values |
| PRC-L449 | low | custom-field | OPEN | privacy erasure wiring + cross-domain entity existence checks |
| PRC-L457 | low | data-warehouse | OPEN | new GIS parsing dependency / PostGIS schema; package parked (mount-matrix G-924) |
| PRC-L548 | low | data-warehouse | OPEN | security policy (credential/raw-SQL intake) + import API schema change |
| PRC-L552 | low | data-warehouse | OPEN | tenant isolation (defence-in-depth repository contract) |
| PRC-L553 | low | data-warehouse | OPEN | privacy/consent and authorization policy (publish visibility gate) |
| PRC-M617 | medium | data-warehouse | OPEN | authentication/authorization + tenant binding (mount with tenant/auth plugin) |
| PRC-L291 | low | db | OPEN | provider integration / product decision (live mode) + schema CHECK |
| PRC-L292 | low | db | OPEN | cryptographic signing / KMS + transcript authenticity CHECK |
| PRC-L295 | low | db | PARTIAL | statutory/compliance retention policy (archival window ownership) |
| PRC-L463 | low | db | PARTIAL | product decision: wire consumers (student merge/search/transcript signing services) vs retire tables (schema) |
| PRC-M200 | medium | db | OPEN | cryptographic key management (HMAC/KMS) for audit chain |
| PRC-M201 | medium | db | PARTIAL | financial (payroll journal balancing business rule) |
| PRC-M202 | medium | db | PARTIAL | financial (fee ledger linkage) + schema |
| PRC-M203 | medium | db | OPEN | privacy/legal-hold policy across PII/PHI tables |
| PRC-M204 | medium | db | OPEN | privacy lifecycle (PII redaction, dual control) |
| PRC-M209 | medium | db | PARTIAL | design decision between 247 trigger+grant and fix/partials-close-back2 event table; runtime grant change |
| PRC-M214 | medium | db | OPEN | privacy (DPDP erasure/anonymisation path) |
| PRC-M215 | medium | db | PARTIAL | privacy retention/erasure + object storage deletion |
| PRC-M503 | medium | db | PARTIAL | financial (payment defaults, overpayment constraint) + PSP integration |
| PRC-L298 | low | developer-portal | OPEN | authentication: new inbound API-key auth strategy in the gateway |
| PRC-L559 | low | developer-portal | OPEN | privacy: payload redaction + retention policy (D5 retention config) |
| PRC-M218 | medium | developer-portal | OPEN | tenant lifecycle/provisioning (isolated sandbox tenant creation and teardown) |
| PRC-L098 | low | etl | OPEN | event contract (publishing pipeline events onto the bus) + notification/provider integration |
| PRC-L106 | low | fees | PARTIAL | external messaging integration + finance dunning |
| PRC-L471 | low | fees | PARTIAL | financial business rule + new fees API route |
| PRC-M246 | medium | fees | PARTIAL | financial + external PSP integration |
| PRC-M251 | medium | fees | PARTIAL | financial reconciliation business rule (settlement, matching key) + import-batch idempotency |
| PRC-M512 | medium | fees | PARTIAL | financial + external PSP/webhook |
| PRC-M261 | medium | github | OPEN | repository governance (CODEOWNERS, branch protection, org teams) |
| PRC-L112 | low | gradebook | OPEN | official transcript document content (statutory record; checksum/signature payload) |
| PRC-L310 | low | gradebook | PARTIAL | secrets / security policy |
| PRC-M268 | medium | gradebook | OPEN | grading/GPA business rules (period and workflow-status inclusion, term vs cumulative rank) |
| PRC-L312 | low | health | PARTIAL | authorization / institution-scope fail-closed policy on PHI read paths |
| PRC-L117 | low | hostel | PARTIAL | financial (integer-cents fee validation, money model Decision D1); date/uuid parts alone would be ELIGIBLE_LOW |
| PRC-M277 | medium | hostel | PARTIAL | business rule (room capacity enforcement) + new vacate/checkout workflow |
| PRC-L565 | low | infrastructure | OPEN | ops/DNS decision (DNS-01 ClusterIssuer provider + solver secret) recorded in ledger note |
| PRC-L566 | low | infrastructure | PARTIAL | authentication (gateway JWT secret boot guard under staging) |
| PRC-M522 | medium | infrastructure | PARTIAL | production network policy needs operator datastore location |
| PRC-M524 | medium | infrastructure | PARTIAL | gateway boot policy (security config guard) |
| PRC-M623 | medium | infrastructure | OPEN | DB role/RLS bypass credential split (owner decision per ledger note) |
| PRC-M624 | medium | infrastructure | OPEN | DR/retention economics decision (COMPLIANCE-only lock, PITR) per ledger note |
| PRC-L568 | low | install | OPEN | security policy: SSRF scheme/host restrictions |
| PRC-M625 | medium | install | OPEN | authentication: install token gate |
| PRC-L129 | low | library | PARTIAL | business rule (loan-limit policy) + cross-module student existence contract |
| PRC-L329 | low | lms | PARTIAL | secrets / security policy (production fail-closed signing secret) |
| PRC-M299 | medium | lms | OPEN | authorization (learner enrolment/section-membership checks; needs SIS enrolment source) |
| PRC-M302 | medium | lms | OPEN | needs an authoritative SIS roster source for LMS classes (cross-module data contract) |
| PRC-L332 | low | notification | OPEN | authorization: device ownership (user) check |
| PRC-L577 | low | notification | OPEN | auth/tenant middleware wiring for standalone server |
| PRC-M307 | medium | notification | OPEN | privacy: cross-service resolution of user email/phone (PII) |
| PRC-M308 | medium | notification | OPEN | frozen API/event contract + schema (notification status enum CHECK in db/sql/005_notifications_schema.sql:39) |
| PRC-L477 | low | plugin | OPEN | audit/tenant scope for platform registry operations |
| PRC-L479 | low | plugin | OPEN | authorization: tests must assert authz behaviour that PRC-M603 has not defined |
| PRC-M602 | medium | plugin | PARTIAL | security isolation boundary + dependency (isolated-vm or process isolation) |
| PRC-M603 | medium | plugin | OPEN | authorization: plugin register/install/enable role guard |
| PRC-M627 | medium | plugin | OPEN | permission consent / authorization on plugin install+enable |
| PRC-M628 | medium | plugin | PARTIAL | security policy: SSRF egress hardening (redirect handling, DNS rebinding) |
| PRC-M629 | medium | plugin | OPEN | privacy: event payload minimisation/masking policy |
| PRC-M606 | medium | policy | OPEN | authorization on security-policy create/activate/assign |
| PRC-M608 | medium | policy | OPEN | audit contract + auth actor context for a parked package |
| PRC-M630 | medium | policy | OPEN | security-policy evaluation semantics (precedence across types, stricter-wins) |
| PRC-L136 | low | privacy | PARTIAL | privacy/legal-hold state machine (statutory DPDP control) — needs privacy owner review; failing-first proof required |
| PRC-L336 | low | privacy | OPEN | authorization / separation of duties on privacy erasure + legal holds |
| PRC-M326 | medium | providers | OPEN | provider integrations (credentials, new client dependencies, payments) |
| PRC-L139 | low | registration | OPEN | anonymous session issuance on a public route (session-store / security policy) |
| PRC-L142 | low | registration | OPEN | authz role catalogue (admin roles incl. 'principal'; Decision D2 awaiting owner sign-off) + gateway wiring in domain-plugins.ts |
| PRC-M330 | medium | registration | PARTIAL | AV-scanning integration (security/infra) and upload transport contract |
| PRC-M332 | medium | registration | PARTIAL | security policy (mandatory bot control) + shared (Redis) rate-limit infra |
| PRC-M537 | medium | registration | PARTIAL | financial/enrolment side-effect atomicity (invoice void, enrolment, waitlist) |
| PRC-M538 | medium | registration | OPEN | privacy (DPDP parental consent/purpose, retention/erasure for minors' PII; schema) + guardian identity matching (auth) |
| PRC-L337 | low | report | PARTIAL | security policy: download signing secret fail-closed + user-bound token |
| PRC-L338 | low | report | PARTIAL | auth: tokenised emailed links vs session requirement; blocked by PRC-M338 |
| PRC-L339 | low | report | PARTIAL | tenant isolation: removing x-tenant-id header fallback in report tenant resolution |
| PRC-L340 | low | report | PARTIAL | audit/privacy control: domain audit of PII export downloads and schedule changes |
| PRC-L341 | low | report | PARTIAL | privacy: in-tenant recipient restriction for PII report export |
| PRC-L342 | low | report | PARTIAL | storage security config: SSE + production fail-closed for report blobs |
| PRC-M338 | medium | report | OPEN | external email/notification integration for PII report delivery |
| PRC-M348 | medium | scholarship | OPEN | business rule (scholarship eligibility enforcement at submit/approve) |
| PRC-M350 | medium | scholarship | OPEN | business process (approval routing Req 11.3) + cross-module workflow integration |
| PRC-M539 | medium | scholarship | PARTIAL | authorization (in-tenant IDOR binding) |
| PRC-M540 | medium | scholarship | PARTIAL | business rule (programme status transitions / slot policy) |
| PRC-L489 | low | shared-cdn | OPEN | dependency + external integration (AWS CloudFront SDK / CDN purge clients) |
| PRC-M633 | medium | shared-events | PARTIAL | tenant isolation: consumer-side topic tenant vs message tenant check |
| PRC-M359 | medium | shared-pdf-lite | OPEN | dependency/asset change: embedding a Unicode TrueType font (licensing) on official documents |
| PRC-M634 | medium | shared-storage | PARTIAL | tenant isolation: threading caller tenant through every storage caller |
| PRC-M368 | medium | staff | PARTIAL | financial (payroll posting) behaviour |
| PRC-M370 | medium | staff | PARTIAL | financial/payroll business rule (deduction policy for half-days and unpaid leave) |
| PRC-M373 | medium | staff | PARTIAL | authorization separation-of-duties (self-approval) and HR leave business rules (working-day counting, overlap, cancel/restore) |
| PRC-M378 | medium | staff | PARTIAL | privacy / field-level authorization on staff PII |
| PRC-M545 | medium | student | OPEN | authorization (in-plugin role checks on enrollment/certificate mutations) |
| PRC-L169 | low | tenant | OPEN | tenant resolution security: custom-domain ownership verification (DNS/HTTP challenge) gates host->tenant routing |
| PRC-L171 | low | tenant | OPEN | RBAC role catalogue: built-in role seed-drift reconciliation (DECISION_REGISTER group 2) |
| PRC-L369 | low | tenant | OPEN | tenant resolution boundary: caching public host->tenant mapping affects suspension/domain freshness |
| PRC-L372 | low | tenant | OPEN | auth (session invalidation) + privacy (decommission data export) |
| PRC-L173 | low | theme | OPEN | audit-event emission on parked packages; theme mount is G-605 PARKED (apps/api-gateway/src/mount-matrix.ts:571) |
| PRC-M392 | medium | theme | PARTIAL | gateway mount decision G-605 (/themes owned by platform-admin UI stub) |
| PRC-M394 | medium | theme | PARTIAL | gateway mount decision G-605 + CSS/URL injection security control |
| PRC-M395 | medium | theme | PARTIAL | gateway mount decision G-605 + platform/tenant authorization |
| PRC-M423 | medium | tools-migrations | PARTIAL | new dependency (mysql2) + legacy source access |
| PRC-M552 | medium | tools-migrations | PARTIAL | new dependency (kafkajs) + live Kafka/MySQL; event contract |
| PRC-M557 | medium | tools-migrations | PARTIAL | privacy/retention decision (default-on PII purge) |
| PRC-M430 | medium | tools-scripts | OPEN | design-token/brand colour changes (UX/a11y owner) + CI gate policy |
| PRC-M435 | medium | tools-scripts | OPEN | PHI deletion audit trail (privacy/audit chain) under BYPASSRLS role |
| PRC-M559 | medium | tools-scripts | PARTIAL | PHI deletion job semantics + DB role assertion (privacy/RLS) |
| PRC-M452 | medium | transport | PARTIAL | financial (fee amount/currency validation; money model Decision D1) |
| PRC-M453 | medium | transport | OPEN | business rules (vehicle capacity, route date windows, attendance membership) |
| PRC-L597 | low | ui-form-builder | PARTIAL | dependency addition (vitest-axe dev-dep in widget packages; lockfile change) |
| PRC-M458 | medium | workflow | OPEN | auth/tenant context wiring for standalone server |
| PRC-M459 | medium | workflow | PARTIAL | file-storage path trust and uploader identity (authz/security) |
| PRC-M460 | medium | workflow | OPEN | business rule: case lifecycle state machine (resolution record, no-skip review) |
| PRC-M461 | medium | workflow | OPEN | business rule: transition condition evaluator semantics |
| PRC-M638 | medium | workflow | OPEN | workflow business rules (FINAL/status handling, chained escalation) + concurrency |

## NEEDS_DECISION (72)

| id | sev | module | disposition | boundary |
|---|---|---|---|---|
| PRC-L527 | low | app-admin-console | PARTIAL | list paging contract (row notes: owner decision) |
| PRC-M008 | medium | app-api-gateway | OPEN | DECISION_REGISTER group 9 cites PRC-M008 (definition of attendance rate) |
| PRC-M016 | medium | app-api-gateway | OPEN | row notes: DPDP minimisation needs a product/retention decision for applicant student masters |
| PRC-M465 | medium | app-api-gateway | PARTIAL | metric definitions for board rollup (tied to PRC-M008, DECISION_REGISTER group 9) |
| PRC-L399 | low | app-developer-portal | OPEN | product/IA: delete dead (portal) layout vs build the four routes (row notes) |
| PRC-M467 | medium | app-install-wizard | PARTIAL | authentication/bootstrap secret source + where to persist the install lock (row notes) |
| PRC-L007 | low | app-mobile | PARTIAL | i18n scope decision (DECISION_REGISTER.md §4, unresolved) |
| PRC-L011 | low | app-mobile | PARTIAL | offline-first free-text fallback is a product/UX choice recorded in notes |
| PRC-M039 | medium | app-mobile | PARTIAL | product decision on exposing a sandbox-labelled payment flow (row notes: Needs decision); payment flow is also a finance boundary |
| PRC-M470 | medium | app-mobile | PARTIAL | security: pin values + rotation/break-glass plan from infra/security owner (notes: Needs decision) |
| PRC-L225 | low | app-registration-portal | PARTIAL | trusted public-origin / edge header policy (security) |
| PRC-L226 | low | app-registration-portal | OPEN | privacy: third-party OSM tile loading before consent (label binding itself is codeable a11y) |
| PRC-L038 | low | app-web | OPEN | product flag/scope decision for demo surfaces (DECISION_REGISTER.md §7, unresolved) |
| PRC-L231 | low | app-web | OPEN | list paging contract (row notes: owner decision on page/pageSize+search for pickers) |
| PRC-L251 | low | app-web | PARTIAL | UX semantics for create actions (confirm-before-dismiss, disable-after-success, rotate-vs-create) per row notes |
| PRC-L257 | low | app-web | OPEN | notification channel/template consistency product rules (row notes) |
| PRC-L260 | low | app-web | PARTIAL | bell-schedule/day-pattern semantics (timetable product rule, per notes) |
| PRC-L266 | low | app-web | OPEN | caching policy for authenticated reads (DECISION_REGISTER.md §8) |
| PRC-L273 | low | app-web | PARTIAL | i18n persistence/announcement policy (row notes: provider UX + per-user persistence owner decision) |
| PRC-L408 | low | app-web | PARTIAL | list paging contract (same owner decision as PRC-L231) |
| PRC-L421 | low | app-web | OPEN | [gate] Merged D6 PR #634 ledger table keeps L421 OPEN ("root cause is a live module/backend, not resolved by deletion"). Tip still has the backend cross-board transfer surface (packages/backend/student/src/enrollment/enrollment-routes.ts:523 "Shape consumed by the cross-board transfer dashboard", apps/api-gateway/src/rbac-registry.ts:48 GET /transfers/:id) and no decision endpoint. Closure-by-deletion contradicts th… |
| PRC-L424 | low | app-web | OPEN | product decision: add a map library dependency vs relabel (DECISION_REGISTER.md §7) |
| PRC-L439 | low | app-web | OPEN | [gate] Merged D6 PR #634 ledger table keeps L439 OPEN ("root cause is a live module/backend"). Tip grep finds no settings.general keys, but the owner disposition was explicit; closing it needs the owner to confirm the live settings surface needs no keys. |
| PRC-L534 | low | app-web | PARTIAL | product/IA: route the marketing pages vs delete the chrome |
| PRC-M129 | medium | app-web | OPEN | list paging/search contract (same owner decision as PRC-L231) |
| PRC-M146 | medium | app-web | PARTIAL | list-result contract rollout across ~90 clients (row notes: coordinated owner decision) |
| PRC-M152 | medium | app-web | OPEN | grading-scale product rule (row notes: owner decision on GPA scale) |
| PRC-M155 | medium | app-web | PARTIAL | UUID lookup vs free-text code decision shared with PRC-M290 (in-flight PR #654, NEEDS_DECISION); catalogue seed/migration |
| PRC-M160 | medium | assessment | OPEN | RBAC redesign (teacher subject/class ownership, read-vs-write and approval separation); notes: NEEDS OWNER DECISION |
| PRC-L275 | low | attendance | PARTIAL | owner decision: day-level counting and subject/period passthrough rules for the percentage |
| PRC-L442 | low | attendance | OPEN | owner decision: harden standalone-server.ts (auth/tenant/DB readiness) or retire the lab service from tools/scripts/services.json; hardening also touches auth |
| PRC-M169 | medium | attendance | PARTIAL | owner decision: surface 501 vs degrade-to-defaults for unconfigured institutions (visible API behaviour change) |
| PRC-M496 | medium | attendance | PARTIAL | owner decision: back-dating window policy (business rule) |
| PRC-M190 | medium | communication | OPEN | product definition of audienceType/audienceIds -> recipient expansion (enrolment/hostel/transport/guardian) is undefined; cross-module resolvers do not exist |
| PRC-M194 | medium | curriculum | OPEN | RBAC redesign (teacher subject/section ownership); notes: NEEDS OWNER DECISION |
| PRC-L450 | low | custom-field | OPEN | mount/persist decision for parked custom-field package; persistence needs schema |
| PRC-M211 | medium | db | OPEN | [gate] Title says nothing creates deliveries. At tip fan-out is opt-in: parseWebhookFanOutEvents returns [] when WEBHOOK_FANOUT_EVENTS is unset (packages/backend/developer-portal/src/webhook-event-fanout.ts:40), so by default no delivery is created. Default-on fan-out is a product/ops decision; migration 113 was not applied to a live DB (NOT VERIFIED). |
| PRC-M510 | medium | examination | PARTIAL | product decision: authoritative roll-number source (likely also a schema change) |
| PRC-L115 | low | health | PARTIAL | privacy decision: whether/how PHI before/after values may be captured in audit records; actor fallback is audit-policy |
| PRC-L313 | low | health | PARTIAL | ops/security decision on PHI root-key rotation blast radius |
| PRC-L472 | low | health | PARTIAL | quality-gate decision: coverage threshold values for the PHI package |
| PRC-L118 | low | hostel | OPEN | schema/API decision: link hostels to institutions or remove the filter (notes: NEEDS OWNER DECISION; Decision Register group 9) |
| PRC-L327 | low | library | PARTIAL | schema/API decision: add item institution or drop the filter (notes: NEEDS OWNER DECISION; Decision Register group 9) |
| PRC-M293 | medium | library | PARTIAL | provider/integration decision (notes: NEEDS OWNER DECISION) |
| PRC-L331 | low | lms | PARTIAL | identity mapping + DPDP erasure policy (notes: NEEDS OWNER DECISION; Decision Register group 5) |
| PRC-M310 | medium | notification | OPEN | product rules for quiet hours/digest (which classes bypass, digest cadence) are undefined |
| PRC-M529 | medium | notification | OPEN | recipient cap / parallelism policy undefined, and processEvent has no caller (PRC-M600) |
| PRC-M600 | medium | notification | OPEN | which events/schedules drive notifications (rule-engine activation changes user-visible sends) |
| PRC-L481 | low | plugin | OPEN | plugin registry lifecycle model (versioning/deprecate/remove) undefined for a parked package (PRC-L578) |
| PRC-M605 | medium | plugin-sdk | OPEN | row notes: owner decision — mount or remove plugin-sdk dev tooling |
| PRC-L578 | low | policy | OPEN | mount + persistence decision for parked plugin/policy packages; persistence needs schema |
| PRC-M610 | medium | policy | OPEN | row notes: data-model/ownership decision for platform-scope policies (also a tenant boundary) |
| PRC-L145 | low | report | OPEN | DECISION_REGISTER group 3 (tenant timezone source of truth, PRODUCT decision) |
| PRC-L488 | low | report | OPEN | row notes: NEEDS OWNER DECISION (delete-or-gate legacy report engine) |
| PRC-M349 | medium | scholarship | PARTIAL | product config decision (tenant timezone source for 'today'; GPA scale) per notes and Decision Register group 3 |
| PRC-L494 | low | shared-search-index | PARTIAL | which service(s) consume search-index (product scope) — no consumer exists |
| PRC-L364 | low | staff | OPEN | authorization role catalogue (Decision Register group 2); notes: NEEDS OWNER DECISION |
| PRC-L500 | low | staff | PARTIAL | owner decision (notes): harden or retire standalone server; hardening touches auth/tenant resolution |
| PRC-L166 | low | survey | OPEN | mount/persist decision for parked survey+theme packages (notes: do NOT mount); persistence also needs schema |
| PRC-M387 | medium | survey | PARTIAL | runtime enforcement depends on the parked-package mount decision (PRC-L166) |
| PRC-M388 | medium | survey | PARTIAL | runtime enforcement depends on the parked-package mount decision (PRC-L166) |
| PRC-M445 | medium | transport | PARTIAL | feature decision (notes): persist sandbox GPS/attendance-on-bus or hard-gate them off in production |
| PRC-M451 | medium | transport | PARTIAL | privacy/legal retention policy for child location and boarding data (Decision Register group 5); notes: NEEDS OWNER DECISION |
| PRC-L195 | low | ui-bulk-import | PARTIAL | i18n scope decision (DECISION_REGISTER.md §4 names PRC-L195) |
| PRC-L393 | low | ui-bulk-import | OPEN | BulkImport onImportConfirm contract (importId/idempotency) — owner decision per notes |
| PRC-M455 | medium | ui-bulk-import | OPEN | BulkImport validation contract (onFileValidate(file, mappings)) — owner decision per notes |
| PRC-L594 | low | ui-dashboards | OPEN | map library feature vs removing a public export (package API; register §7) |
| PRC-L596 | low | ui-dashboards | OPEN | timezone/locale policy (DECISION_REGISTER.md §3 names PRC-L596) |
| PRC-L200 | low | ui-file-upload | OPEN | FileUpload server-trust/scan contract (row notes: owner decision); file validation is a security control |
| PRC-L201 | low | ui-file-upload | OPEN | FileUpload component API (async result / scan status) — owner decision per notes |
| PRC-L520 | low | ui-form-builder | OPEN | mount-vs-remove decision for unused ui scaffolding packages |
| PRC-M637 | medium | ui-form-builder | OPEN | FormBuilder FieldType API (explicit renderers vs trimming the union) — owner decision per notes |

## SCHEMA_BATCH (58)

| id | sev | module | disposition | boundary |
|---|---|---|---|---|
| PRC-L529 | low | app-api-gateway | PARTIAL | workflow_ui_approvals needs decided_by/decision columns |
| PRC-L036 | low | app-web | PARTIAL | examination candidate schema field (board registration number) |
| PRC-M482 | medium | app-web | PARTIAL | scholarship program code column |
| PRC-L082 | low | assessment | OPEN | unique index on (tenant_id, lower(name)) needs a migration |
| PRC-L086 | low | billing | PARTIAL | shared @proctira/database document collection + control-plane migration |
| PRC-L286 | low | billing | PARTIAL | depends on PRC-M184 transaction/lock work (schema batch) + live PG |
| PRC-M184 | medium | billing | PARTIAL | unique plan-name index + multi-key tx in shared document collection |
| PRC-L289 | low | curriculum | PARTIAL | composite (tenant_id, id) FKs need a migration; reference checks touch tenant isolation |
| PRC-M592 | medium | data-warehouse | OPEN | new tables + RLS policies; mounting is a product decision (G-924 parked) |
| PRC-L091 | low | db | OPEN | RLS policy rewrite (forward migration) + EXPLAIN/perf tests |
| PRC-L092 | low | db | OPEN | table partitioning migration + retention purge job (data retention policy) |
| PRC-L093 | low | db | PARTIAL | audit trail mirroring (forward migration) + live-PG verification |
| PRC-L094 | low | db | OPEN | financial amount consistency CHECK + backfill reconciliation |
| PRC-L095 | low | db | OPEN | tenant-composite FKs (tenant isolation) migration |
| PRC-L293 | low | db | PARTIAL | audit trigger trust (security) forward migration + live-PG verification |
| PRC-L294 | low | db | PARTIAL | RLS policies + CI gate |
| PRC-L296 | low | db | OPEN | checksum-locked migration 090 |
| PRC-L297 | low | db | OPEN | authorization-derived FK semantics + index migration |
| PRC-L555 | low | db | PARTIAL | EXCLUDE/range constraint (btree_gist) migration |
| PRC-L557 | low | db | PARTIAL | view recreation over RLS table (forward migration) |
| PRC-M195 | medium | db | OPEN | tenant-composite FKs (tenant isolation) on money/PII edges |
| PRC-M196 | medium | db | OPEN | new tenant columns on global tables + background worker (product feature) |
| PRC-M197 | medium | db | PARTIAL | financial constraints + currency default (Decision D1) migration |
| PRC-M198 | medium | db | PARTIAL | SIS integrity constraints migration + live-PG verification |
| PRC-M206 | medium | db | OPEN | unique/EXCLUDE constraints migration with duplicate reconciliation |
| PRC-M207 | medium | db | PARTIAL | payroll uniqueness migration live verification |
| PRC-M208 | medium | db | OPEN | tenant-composite FKs (tenant isolation) |
| PRC-M212 | medium | db | OPEN | FK + retention migration on developer-portal tables |
| PRC-M213 | medium | db | PARTIAL | EXCLUDE constraint migration live verification |
| PRC-M216 | medium | db | OPEN | FK re-validation migration under FORCE RLS |
| PRC-M506 | medium | db | OPEN | column type migrations + EXCLUDE (btree_gist) |
| PRC-L097 | low | developer-portal | PARTIAL | durable tables for analytics/docs/ratings |
| PRC-L299 | low | developer-portal | OPEN | DB unique constraints / transactional limit guards (migration) |
| PRC-L464 | low | developer-portal | PARTIAL | durable delivery claim/lease state |
| PRC-M231 | medium | examination | PARTIAL | room_id normalization to rooms needs a migration + operator backfill |
| PRC-L107 | low | fees | PARTIAL | per-tenant invoice/receipt sequence needs a migration |
| PRC-L569 | low | install | OPEN | actor/ip/user-agent on install_bootstrap_runs needs columns; table itself not in db/sql (PRC-M626) |
| PRC-M626 | medium | install | OPEN | install_bootstrap_runs table/migration + secret-ref storage |
| PRC-L130 | low | library | OPEN | per-tenant uniqueness on library_items isbn/barcode needs a migration (plus duplicate reconciliation) |
| PRC-L132 | low | lms | OPEN | server-issued practice-item binding needs persisted issued-item state (migration) |
| PRC-M301 | medium | lms | OPEN | time-limit enforcement needs an attempt-start record (migration) |
| PRC-L576 | low | notification | OPEN | delivery claim needs a claimed/sending state; notifications.status CHECK allows only sent/delivered/read/failed (db/sql/005_notifications_schema.sql:39) |
| PRC-M325 | medium | privacy | PARTIAL | per-subject-table legal-hold triggers need migrations across domain tables |
| PRC-M335 | medium | registration | OPEN | optimistic version column / locked transactions on admission_enquiries and merit lists |
| PRC-L144 | low | report | OPEN | Idempotency-Key for generate needs a persisted key/column; stale-run reaper state |
| PRC-L147 | low | shared-database | OPEN | tenant offboarding/erasure (privacy lifecycle) + locked Prisma migration |
| PRC-L350 | low | shared-database | PARTIAL | column type migration (float->numeric) in examination domain |
| PRC-L152 | low | staff | OPEN | partial unique index excluding soft-deleted staff needs a migration |
| PRC-M381 | medium | staff | PARTIAL | dedicated offboard status column needs a staff migration |
| PRC-M548 | medium | student | PARTIAL | class_id FK and composite tenant FKs need a student migration; in-tenant reference checks touch tenant isolation |
| PRC-M389 | medium | tenant | OPEN | unique (tenant_id, revision) constraint + locked allocation |
| PRC-M396 | medium | timetable | PARTIAL | cross-bell-schedule exclusion needs a new migration (btree_gist range exclusion) |
| PRC-M400 | medium | timetable | PARTIAL | schema migration (db/sql/230) requires live-PG verification |
| PRC-M433 | medium | tools-scripts | OPEN | forward FK re-validation migration + waiver expiry |
| PRC-M443 | medium | transport | PARTIAL | UNIQUE(tenant_id, vehicle_id) relaxation needs a migration; device-key lifecycle is also a security control |
| PRC-M447 | medium | transport | PARTIAL | partial unique constraint for one active assignment needs a migration |
| PRC-M449 | medium | transport | OPEN | FK ON DELETE CASCADE -> RESTRICT/soft-delete needs a transport migration |
| PRC-M462 | medium | workflow | OPEN | active-instance-per-entity uniqueness + escalation outbox design |

## INFRA_BATCH (41)

| id | sev | module | disposition | boundary |
|---|---|---|---|---|
| PRC-M005 | medium | app-admin-console | PARTIAL | CI harness: seeded backend + platform-admin login |
| PRC-M012 | medium | app-api-gateway | OPEN | deployment overlays must set TRUSTED_PROXY_CIDRS; overlaps PRC-M524 (infrastructure, PARTIAL) |
| PRC-L216 | low | app-public-website | PARTIAL | edge proxy-hop count / edge rate limiting |
| PRC-L223 | low | app-public-website | PARTIAL | container image / base-image pinning policy |
| PRC-M568 | medium | app-registration-portal | PARTIAL | CI e2e backend/seed wiring |
| PRC-L263 | low | app-web | PARTIAL | CI e2e backend/seed wiring (shared with PRC-M568) |
| PRC-L290 | low | db | PARTIAL | migration apply posture default (tools/scripts/apply-sql.sh) + checksum-locked base DDL |
| PRC-L460 | low | db | PARTIAL | local compose / DB bootstrap roles |
| PRC-L108 | low | github | OPEN | CI workflow config (scheduled workflows) |
| PRC-L109 | low | github | OPEN | release pipeline (image tagging) |
| PRC-L110 | low | github | OPEN | CI workflow config (concurrency) |
| PRC-L111 | low | github | OPEN | dependency update automation (dependabot config) |
| PRC-L307 | low | github | PARTIAL | CI aggregate/release gating topology |
| PRC-L308 | low | github | OPEN | CI supply-chain verification |
| PRC-L309 | low | github | OPEN | CI lint/format gate scope |
| PRC-M255 | medium | github | OPEN | supply-chain signing + admission verification (deploy) |
| PRC-M258 | medium | github | OPEN | production DR / migration rollout |
| PRC-M513 | medium | github | OPEN | production deploy policy |
| PRC-M514 | medium | gradebook | PARTIAL | artifact storage durability (object storage / deploy paths) |
| PRC-L567 | low | infrastructure | PARTIAL | Kustomize PDB/replica config |
| PRC-M599 | medium | infrastructure | PARTIAL | Helm chart render-time guard |
| PRC-M303 | medium | lms | OPEN | production storage configuration / fail-closed boot behaviour (notes: needs external system) |
| PRC-L134 | low | ops | OPEN | observability alert rules (ops config) |
| PRC-L335 | low | ops | PARTIAL | compose service config |
| PRC-M311 | medium | ops | PARTIAL | local/dev compose topology |
| PRC-M312 | medium | ops | OPEN | observability scrape config/alert rules |
| PRC-M530 | medium | ops | PARTIAL | compose topology / provider defaults |
| PRC-M355 | medium | scholarship | OPEN | object storage + AV scanning (external systems) and production fail-closed config |
| PRC-L351 | low | shared-database | PARTIAL | CI workflow gate for Prisma-only deploy FORCE RLS |
| PRC-M612 | medium | shared-events | PARTIAL | RabbitMQ delayed-exchange plugin / broker config + publisher confirms |
| PRC-M366 | medium | shared-storage | PARTIAL | IaC bucket lifecycle/ILM rules |
| PRC-M543 | medium | staff | PARTIAL | scheduler/notification-service wiring (ops integration) |
| PRC-L176 | low | tools-load-test | PARTIAL | CI workflow wiring + live stack for k6 |
| PRC-M425 | medium | tools-migrations | PARTIAL | CI workflow job for @proctira/migrations |
| PRC-L380 | low | tools-scripts | PARTIAL | migration apply default posture (strict FK default) |
| PRC-L383 | low | tools-scripts | PARTIAL | backup/DR pipeline (helm env assertion, post-upload decrypt) |
| PRC-M428 | medium | tools-scripts | OPEN | CI aggregate topology / path filters |
| PRC-M429 | medium | tools-scripts | OPEN | CI gate needing seeded authenticated session |
| PRC-M431 | medium | tools-scripts | OPEN | CI evidence gates (gh api verification, CI wiring) |
| PRC-M434 | medium | tools-scripts | OPEN | CI workflow wiring |
| PRC-M558 | medium | tools-scripts | OPEN | CI coverage gate policy |
