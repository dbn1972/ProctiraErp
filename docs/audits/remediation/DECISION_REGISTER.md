# Decision register — gaps that need an owner call, not code

Generated from `CANONICAL_LEDGER.csv`. These are OPEN/PARTIAL findings whose
wave notes say they are blocked on a decision (owner / legal / product / finance
/ platform), not on engineering effort. An agent cannot close them without the
decision. Each group below states the decision you need to make; once you
decide, the affected findings become codeable and move into the normal batch
queue.

> Re-triage note: some findings were parked as "owner decision" in the wave
> notes but are actually plain engineering work (writing tests, fixing an
> in-memory test fixture). Those are pulled OUT of this register into
> "Re-triage → codeable" at the bottom and will be worked as normal batches.

---

## 1. Money / currency model — 11 findings (FINANCE decision)

Examples: PRC-L087 (billing plan prices carry no currency; cents hard-wired),
PRC-L059 (transport fee amount validation client-only), PRC-L291 (fee-reminder
audit table hard-checks mode='sandbox').
**Decision needed:** What is the canonical money model? (a) single platform
currency, or multi-currency per tenant? (b) are amounts always integer minor
units (cents) with a currency code column? Answer sets the schema + validation
for all fee/billing findings.

## 2. Role / permission catalogue + realm — 14 + 5 findings (PLATFORM/IdP decision)

Examples: PRC-L174/L391/M237/M521/L276/L347 (role names used in code that do
NOT exist in the shipped Keycloak realm), PRC-L202 (UI authz on unsigned JWT).
**Decision needed:** Who owns the authoritative role catalogue, and will the
Keycloak realm export be extended to include the domain roles the code already
references (exam-officer, warden, bursar, transport roles, etc.)? Until the
realm defines them, these role gates can't be made real.

## 3. Timezone / locale policy — 3 findings (PRODUCT decision)

Examples: PRC-L426 (audit/schedule timestamps formatted in server local time),
PRC-L596 (WelcomeBanner uses browser locale at render).
**Decision needed:** What is the source of truth for a tenant's timezone, and
should all user-facing timestamps render in tenant TZ (not server/browser)?

## 4. i18n scope — 3 findings (PRODUCT decision)

Examples: PRC-L195 (hard-coded English strings across ui widgets).
**Decision needed:** Which surfaces must be localized now vs later, and what is
the target locale set? Drives how much string-externalization work to do.

## 5. Legal / counsel-supplied content — 9 findings (LEGAL decision)

Examples: PRC-L262 (DPDP privacy/terms copy), PRC-M214 (DPDP erasure/
anonymisation), PRC-M203 (legal-hold guard), PRC-M623 (PHI retention).
**Decision needed:** Counsel must supply the actual privacy/retention/erasure
policy text and rules. These MUST NOT be fabricated by an agent; code can wire
up whatever policy legal provides.

## 6. Legacy SPA / tooling removal — 45 findings (ARCHITECTURE decision)

Examples: PRC-L414/L415 (legacy Vite App.tsx + dead SPA feature pages),
PRC-L078 (FeatureFlagsProvider never fed entitlements), PRC-L441 (legacy
vite.config.ts). Many "weak client gating" findings live in this dead SPA.
**Decision needed:** Delete the unmounted legacy Vite SPA entirely? Most of
these findings evaporate if the dead code is removed; they are unverifiable
while it stays. One decision retires a large block.

## 7. Product flag / scope — 9 findings (PRODUCT decision)

Examples: PRC-L038 (demo/placeholder surfaces), PRC-M147 (fabricated dashboard
radar score), PRC-L067 ('working days' ignores holidays/Saturday schools).
**Decision needed:** For each placeholder/demo surface — hide behind a feature
flag until the backend ships, or build it now? And confirm business rules
(e.g. working-days calendar).

## 8. Caching policy — 1 finding (PLATFORM decision)

PRC-L266: authenticated reads use Next Data Cache revalidate 30/60.
**Decision needed:** no-store for authenticated reads, or per-tenant/user
cache-tags? Broad policy across many reads.

## 9. Data-scoping / validation ownership — ~15 findings (PRODUCT/PLATFORM)

Examples: PRC-L118 (hostel institutionId filter is a no-op), PRC-L120
(configurable facility condition options), PRC-M008 (attendance % computed 3
ways). **Decision needed:** confirm the intended scoping/business semantics so
the fix matches intent rather than guessing.

> Owner decisions recorded 2026-10-27 (entries 10-34 below). The repository
> owner (dbn1972) approved Option A for each of the 25 topics in
> `OWNER_DECISIONS_2026-10-26.md`. Owner authorization, verbatim:
>
> "The owner approved the RECOMMENDED option ("Option A") for every topic in `docs/audits/remediation/OWNER_DECISIONS_2026-10-26.md`. Approval excludes the parts that need owner-supplied inputs that do not exist yet: topic 6: needs a counsel-approved retention/erasure schedule; topic 8: the live payment-provider integration needs a provider choice and credentials; half-day/unpaid-leave deduction rules; topic 9: needs board-approved transcript/admit-card content and a licensed font; topic 13: needs one-line rules per item; topic 23: needs org team names; topic 25: needs a DNS provider, datastore CIDRs and the backup lock mode. Inside those topics, implement only the pieces whose recommended option does NOT depend on the missing input. Findings in the 29 module-level decisions that are not part of any of the 25 topics are NOT approved. These approvals lift the protected boundary restriction ONLY to the extent of the approved option. Anything beyond the option's text, or anything that weakens a control, is still BLOCKED_FOR_APPROVAL. Approved changes must tighten or add controls; they must never remove FORCE RLS, tenant scoping, audit or authz checks."
>
> Each entry quotes the approved option verbatim from the brief, states any
> scope exclusion with the missing input, and lists the findings it unblocks
> (from the brief's per-id boundary table, cross-checked against the
> owner-tracks batch plan). Nothing here closes a finding: ledger dispositions
> in `CANONICAL_LEDGER.csv` are unchanged until a fix lands with evidence.
>
> Still open (not approved): the 29 module-level decisions that are not part
> of any of the 25 topics: PRC-L120, PRC-L174, PRC-L240, PRC-L244, PRC-L253, PRC-L270, PRC-L276, PRC-L323, PRC-L325, PRC-L326, PRC-L333, PRC-L347, PRC-L391, PRC-L435, PRC-L448, PRC-L476, PRC-L483, PRC-L554, PRC-L572, PRC-L598, PRC-M182, PRC-M237, PRC-M289, PRC-M290, PRC-M409, PRC-M440, PRC-M521, PRC-M586, PRC-M604.

## 10. Topic 1 — Authentication and session policy: Option A approved 2026-10-27

**Date:** 2026-10-27. **Decider:** repository owner (dbn1972).
**Decision:** Option A (recommended), quoted verbatim from
`OWNER_DECISIONS_2026-10-26.md` topic 1:

> Verify JWT signature/issuer/audience (JWKS) in each BFF/console shell; mint a pre-MFA ticket in the gateway; dedicated hashed SCIM and API-key credentials; install token gate on by default. Consequence: new auth code paths and IdP config; sessions with bad or expired tokens start failing; SAML needs an XML-DSig dependency.

**Unblocked (19 of 21 topic 1 findings), by owner-tracks batch:**

- `t1-web-console-jwks-batch8`: PRC-L202, PRC-M464, PRC-L254, PRC-L544, PRC-L545, PRC-M133, PRC-M587
- `t1-gateway-identity-batch1`: PRC-M026, PRC-M027, PRC-L445, PRC-M497, PRC-M589, PRC-L298, PRC-L566
- `t1-install-tenant-batch2`: PRC-M467, PRC-M625, PRC-L139, PRC-L372
- `t1-secrets-report-storage-batch3`: PRC-L338

**Also unblocked (partial-fix residuals mapped to topic 1 by owner-tracks
`design.md` section 5, batch `t9-residuals-batch1`):** PRC-M262

**Still held (not unblocked by this approval):**

- PRC-M057 (`BLOCKED_FOR_APPROVAL`): Beyond topic 1 Option A text: the /auth/signup and /tenant/signup-roles contract of the external auth service is not defined by the approved option (JWKS verification, pre-MFA ticket, SCIM/API-key credentials, install token). Needs an owner decision on self-service signup.

**Not in the owner-tracks closure plan:** PRC-M489. Ledger
disposition stays as recorded.

## 11. Topic 2 — Secrets, signing keys and production fail-closed configuration: Option A approved 2026-10-27

**Date:** 2026-10-27. **Decider:** repository owner (dbn1972).
**Decision:** Option A (recommended), quoted verbatim from
`OWNER_DECISIONS_2026-10-26.md` topic 2:

> Production boot guard that refuses hard-coded or JWT_SECRET fallbacks, one secret per purpose from the secret manager, explicit CORS/proxy/SSRF allow-lists, SSE on report blobs, mandatory bot control on anonymous routes. Consequence: misconfigured environments stop booting instead of running insecurely; infra must supply the values.

**Unblocked (11 of 13 topic 2 findings), by owner-tracks batch:**

- `t1-secrets-report-storage-batch3`: PRC-L225, PRC-L310, PRC-L329, PRC-L337, PRC-L342
- `t1-gateway-identity-batch1`: PRC-L284, PRC-M524, PRC-M332
- `t1-tenant-isolation-batch4`: PRC-L548
- `t1-install-tenant-batch2`: PRC-L568
- `t1-plugin-policy-batch6`: PRC-M628

**Still held (not unblocked by this approval):**

- PRC-M470 (`WAITING_ON_INPUT`): Topic 2: needs the TLS pin set (primary + backup SPKI sha256 hashes) and the rotation/break-glass plan from the infra/security owner before mobile pinning can ship.

**Not in the owner-tracks closure plan:** PRC-L413. Ledger
disposition stays as recorded.

## 12. Topic 3 — Authorization model, ownership and separation of duties: Option A approved 2026-10-27

**Date:** 2026-10-27. **Decider:** repository owner (dbn1972).
**Decision:** Option A (recommended), quoted verbatim from
`OWNER_DECISIONS_2026-10-26.md` topic 3:

> Adopt ownership-scoped checks (teacher -> assigned subject/section, learner -> enrolment) enforced in each package plus the gateway, approve the D2 role catalogue, and require a second actor for self-approval/erasure. Consequence: some staff lose write access they have today; needs PR #633 role catalogue and an SIS enrolment source.

**Unblocked (23 of 23 topic 3 findings), by owner-tracks batch:**

- `t1-ownership-authz-batch9`: PRC-M022, PRC-L274, PRC-M160, PRC-M179, PRC-M194, PRC-M299, PRC-L142, PRC-M539, PRC-M632, PRC-L364, PRC-M373, PRC-M545, PRC-L171
- `t1-audit-integrity-batch5`: PRC-L280
- `t1-tenant-isolation-batch4`: PRC-L446, PRC-L332, PRC-L336
- `t1-plugin-policy-batch6`: PRC-L479, PRC-M603, PRC-M627, PRC-M606, PRC-M609, PRC-M630

**Also unblocked (partial-fix residuals mapped to topic 3 by owner-tracks
`design.md` section 5, batch `t9-residuals-batch1`):** PRC-L237, PRC-M015

## 13. Topic 4 — Tenant isolation, tenant resolution and provisioning: Option A approved 2026-10-27

**Date:** 2026-10-27. **Decider:** repository owner (dbn1972).
**Decision:** Option A (recommended), quoted verbatim from
`OWNER_DECISIONS_2026-10-26.md` topic 4:

> Tenant only from the verified token or a verified host mapping; repositories, storage keys and Kafka consumers check the caller tenant; custom domains need a DNS/HTTP challenge; sandbox tenants get real isolated provisioning. Consequence: callers relying on the header fallback break; needs failing-first cross-tenant tests per path.

**Unblocked (14 of 15 topic 4 findings), by owner-tracks batch:**

- `t1-web-console-jwks-batch8`: PRC-L213, PRC-L265
- `t1-install-tenant-batch2`: PRC-M132, PRC-M218, PRC-L169, PRC-L369
- `t1-tenant-isolation-batch4`: PRC-L552, PRC-M617, PRC-L581, PRC-M633, PRC-L497
- `t1-plugin-policy-batch6`: PRC-M610
- `t1-secrets-report-storage-batch3`: PRC-L339, PRC-M634

**Also unblocked (partial-fix residuals mapped to topic 4 by owner-tracks
`design.md` section 5, batch `t9-residuals-batch1`):** PRC-M614

**Not in the owner-tracks closure plan:** PRC-L101. Ledger
disposition stays as recorded.

## 14. Topic 5 — Audit trail integrity and audit retention: Option A approved 2026-10-27

**Date:** 2026-10-27. **Decider:** repository owner (dbn1972).
**Decision:** Option A (recommended), quoted verbatim from
`OWNER_DECISIONS_2026-10-26.md` topic 5:

> Same-transaction server-side audit for tenant-admin, grades, attendance, staff, student and PII export events; keyed chain via KMS; a platform-owned minimum retention that tenants cannot lower. Consequence: new audit wiring per domain and a key-management dependency; tenants lose the 1-month retention option.

**Unblocked (10 of 10 topic 5 findings), by owner-tracks batch:**

- `t1-audit-integrity-batch5`: PRC-M013, PRC-L256, PRC-L264, PRC-L295, PRC-L461, PRC-M200, PRC-L590
- `t1-plugin-policy-batch6`: PRC-L477, PRC-M608
- `t1-secrets-report-storage-batch3`: PRC-L340

**Also unblocked (partial-fix residuals mapped to topic 5 by owner-tracks
`design.md` section 5, batch `t9-residuals-batch1`):** PRC-M410

## 15. Topic 6 — Child-data privacy: consent, minimisation, retention and erasure (DPDP): Option A approved 2026-10-27

**Date:** 2026-10-27. **Decider:** repository owner (dbn1972).
**Decision:** Option A (recommended), quoted verbatim from
`OWNER_DECISIONS_2026-10-26.md` topic 6:

> Counsel approves a retention schedule and erasure/anonymisation rules per data class (applicants, minors' PII, location/boarding data, scholarship documents, staff PII, migration copies); engineering implements them with dual control and audit. Consequence: data deletion jobs and consent screens become mandatory; some data currently kept indefinitely is purged.

**Scope exclusion (not approved):** the parts that need owner-supplied
inputs that do not exist yet. Missing input, as recorded by the owner:
"a counsel-approved retention/erasure schedule" (the counsel-approved retention periods and erasure/anonymisation rules per data class). Only the pieces whose recommended
option does not depend on this input are approved.

**Unblocked (11 of 20 topic 6 findings), by owner-tracks batch:**

- `t2-privacy-minimisation-batch2`: PRC-L226, PRC-L532, PRC-L449, PRC-L559, PRC-L331, PRC-L136, PRC-M538, PRC-L341, PRC-M378
- `t2-phi-legalhold-batch1`: PRC-M203, PRC-M204

**Also unblocked (partial-fix residuals mapped to topic 6 by owner-tracks
`design.md` section 5, batch `t9-residuals-batch1`):** PRC-M535

**Still held (not unblocked by this approval):**

- PRC-M016 (`WAITING_ON_INPUT`): Topic 6 exclusion: needs the counsel-approved retention period and erasure rule for applicant student masters (with guardian PII) when an admission offer is declined or expires.
- PRC-M468 (`WAITING_ON_INPUT`): Topic 6 exclusion: needs a DPO/counsel rule on whether device location may be captured with attendance marks and for how long it is retained.
- PRC-L553 (`WAITING_ON_INPUT`): Topic 6 exclusion: needs a counsel-approved consent/visibility rule for publishing data-warehouse snapshots (which data classes may be published, to whom, with what consent basis).
- PRC-M214 (`WAITING_ON_INPUT`): Topic 6 exclusion: needs the counsel-approved erasure/anonymisation rule for consent records (what is kept as proof of consent vs anonymised, and when).
- PRC-M215 (`WAITING_ON_INPUT`): Topic 6 exclusion: needs the counsel-approved retention period for scholarship supporting documents (income/caste certificates) and the post-decision erasure rule.
- PRC-M307 (`BLOCKED_FOR_APPROVAL`): Beyond topic 6 Option A text: resolving user email/phone across services is a new cross-service PII directory contract, not a retention/erasure rule; no approved option defines it.
- PRC-M629 (`WAITING_ON_INPUT`): Topic 6 exclusion: needs the counsel-approved minimisation/masking rule per data class for event payloads handed to plugin handlers.
- PRC-M557 (`WAITING_ON_INPUT`): Topic 6 exclusion: "migration copies" is one of the data classes in Option A's schedule; needs the counsel-approved retention window for the legacy-migration staging schema before purge can be default-on.
- PRC-M451 (`WAITING_ON_INPUT`): Topic 6 exclusion: needs the counsel-approved retention window for child GPS pings and boarding records, and the masking rule for live-map history.
- PRC-L092 (`WAITING_ON_INPUT`): Topic 6 exclusion: partition + purge needs counsel/DPO-approved retention windows for transport GPS pings, notification delivery log, ingest events and outbox rows.
- PRC-L147 (`WAITING_ON_INPUT`): Topic 6 exclusion: an offboarding/erasure path through append-only tenant_theme_versions needs the counsel-approved tenant-offboarding erasure rule.

## 16. Topic 7 — Health (PHI) access, audit and deletion controls: Option A approved 2026-10-27

**Date:** 2026-10-27. **Decider:** repository owner (dbn1972).
**Decision:** Option A (recommended), quoted verbatim from
`OWNER_DECISIONS_2026-10-26.md` topic 7:

> Fail closed on scope lookup errors, record ids plus field names (not values) in audit, audit every retention deletion, split retention and backup credentials, set PHI coverage thresholds. Consequence: some PHI screens return 403 on lookup failure; ops gets a second DB role.

**Unblocked (7 of 8 topic 7 findings), by owner-tracks batch:**

- `t2-phi-legalhold-batch1`: PRC-M121, PRC-L115, PRC-L312, PRC-L472, PRC-M623, PRC-M435, PRC-M559

**Still held (not unblocked by this approval):**

- PRC-L313 (`BLOCKED_FOR_APPROVAL`): Beyond topic 7 Option A text: the option covers fail-closed scope, field-name-only audit, deletion audit, credential split and coverage thresholds; PHI root-key rotation cadence and blast-radius policy are not in it. Needs an ops/security decision on root-key rotation.

## 17. Topic 8 — Money model, fees, payments, refunds and payroll rules: Option A approved 2026-10-27

**Date:** 2026-10-27. **Decider:** repository owner (dbn1972).
**Decision:** Option A (recommended), quoted verbatim from
`OWNER_DECISIONS_2026-10-26.md` topic 8:

> Apply D1 to scholarship, admission offers, hostel and transport amounts; integrate one live PSP with webhooks and payment-targeted, idempotent refunds; define reconciliation matching keys; define half-day/unpaid-leave deduction and balanced payroll journals. Consequence: schema and API changes in fees/payroll; sandbox-only flows stop being shown as real.

**Scope exclusion (not approved):** the parts that need owner-supplied
inputs that do not exist yet. Missing input, as recorded by the owner:
"the live payment-provider integration needs a provider choice and credentials; half-day/unpaid-leave deduction rules" (a payment-provider choice and its credentials (for the live PSP integration and webhooks), and the half-day/unpaid-leave deduction rules). Only the pieces whose recommended
option does not depend on this input are approved.

**Unblocked (13 of 17 topic 8 findings), by owner-tracks batch:**

- `t3-fees-payments-batch1`: PRC-L268, PRC-M090, PRC-M202, PRC-M503, PRC-L106, PRC-L471, PRC-M246, PRC-M251
- `t3-payroll-statutory-batch2`: PRC-M201, PRC-L117, PRC-M537, PRC-M368, PRC-M452

**Also unblocked (partial-fix residuals mapped to topic 8 by owner-tracks
`design.md` section 5, batch `t9-residuals-batch1`):** PRC-M532, PRC-M535

**Still held (not unblocked by this approval):**

- PRC-M039 (`WAITING_ON_INPUT`): Topic 8 exclusion: exposing a real parent payment flow on mobile needs the live payment-provider choice and credentials; the copy-honesty half is already fixed.
- PRC-L291 (`WAITING_ON_INPUT`): Topic 8 exclusion: relaxing the fee-reminder audit CHECK from mode='sandbox' needs a live messaging/payment provider choice and credentials so real sends exist.
- PRC-M512 (`WAITING_ON_INPUT`): Topic 8 exclusion: live PSP adapter + webhook needs the payment-provider choice, merchant credentials and webhook signing secret.
- PRC-M370 (`WAITING_ON_INPUT`): Topic 8 exclusion: needs the half-day and unpaid-leave deduction rules (fraction of daily rate per half-day; which leave types are unpaid; rounding).

## 18. Topic 9 — Statutory records, results release and grading rules: Option A approved 2026-10-27

**Date:** 2026-10-27. **Decider:** repository owner (dbn1972).
**Decision:** Option A (recommended), quoted verbatim from
`OWNER_DECISIONS_2026-10-26.md` topic 9:

> Board-approved transcript/admit-card content with KMS-signed checksums; results read only from published marks; registration/roll number as a real field; embed a licensed Unicode font; GPA by period and approved status with a tenant-configured scale. Consequence: schema fields, a font asset and signing keys; documents change visibly.

**Scope exclusion (not approved):** the parts that need owner-supplied
inputs that do not exist yet. Missing input, as recorded by the owner:
"board-approved transcript/admit-card content and a licensed font" (board-approved transcript/admit-card content and a licensed Unicode font). Only the pieces whose recommended
option does not depend on this input are approved.

**Unblocked (6 of 8 topic 9 findings), by owner-tracks batch:**

- `t3-payroll-statutory-batch2`: PRC-L036, PRC-M152, PRC-L292, PRC-M510, PRC-M268, PRC-M343

**Also unblocked (partial-fix residuals mapped to topic 9 by owner-tracks
`design.md` section 5, batch `t9-residuals-batch1`):** PRC-M515

**Still held (not unblocked by this approval):**

- PRC-L112 (`WAITING_ON_INPUT`): Topic 9 exclusion: needs board-approved transcript content (fields, layout, institution/student identifiers, course-result rows) before the official PDF can change.
- PRC-M359 (`WAITING_ON_INPUT`): Topic 9 exclusion: needs a licensed Unicode TrueType font (Devanagari/Odia/₹ coverage) and its licence for embedding in official PDFs.
- PRC-L555 (`WAITING_ON_INPUT`): Topic 9 exclusion (board-approved content): the overlap EXCLUDE (270_grading_scale_band_overlap_excl.sql) and the E1/E2 nine-band split (db/seeds/003:84-98) already landed; the residual is the gap/coverage rule. Needs the board-approved contiguity granularity and [0,100] coverage rule per board scale.

## 19. Topic 10 — New or changed backend API and event contracts: Option A approved 2026-10-27

**Date:** 2026-10-27. **Decider:** repository owner (dbn1972).
**Decision:** Option A (recommended), quoted verbatim from
`OWNER_DECISIONS_2026-10-26.md` topic 10:

> Approve additive endpoints/fields only (versioned where a frozen shape changes), each with a contract test and a client switch-over. Consequence: backend work per domain; frozen response shapes stay compatible.

**Unblocked (16 of 16 topic 10 findings), by owner-tracks batch:**

- `t4-lists-ui-contracts-batch2`: PRC-L006, PRC-L211, PRC-L224, PRC-M134
- `t4-api-contracts-batch1`: PRC-M031, PRC-L048, PRC-L056, PRC-L078, PRC-L236, PRC-M130, PRC-M148, PRC-M482, PRC-L089, PRC-L098, PRC-M302, PRC-M308

## 20. Topic 11 — List paging and list-result contract: Option A approved 2026-10-27

**Date:** 2026-10-27. **Decider:** repository owner (dbn1972).
**Decision:** Option A (recommended), quoted verbatim from
`OWNER_DECISIONS_2026-10-26.md` topic 11:

> page/pageSize (max 100) + search on picker endpoints, and a typed list result that distinguishes failure from empty, rolled out by module. Consequence: pickers and long lists change behaviour (paged, explicit error state).

**Unblocked (5 of 5 topic 11 findings), by owner-tracks batch:**

- `t4-lists-ui-contracts-batch2`: PRC-L527, PRC-L231, PRC-L408, PRC-M129, PRC-M146

**Also unblocked (partial-fix residuals mapped to topic 11 by owner-tracks
`design.md` section 5, batch `t9-residuals-batch1`):** PRC-L140, PRC-L143, PRC-L330, PRC-M515

## 21. Topic 12 — Attendance, calendar and timezone rules: Option A approved 2026-10-27

**Date:** 2026-10-27. **Decider:** repository owner (dbn1972).
**Decision:** Option A (recommended), quoted verbatim from
`OWNER_DECISIONS_2026-10-26.md` topic 12:

> One documented attendance-rate formula (LATE counts as present, day-level), tenant timezone for all 'today' and schedule math, a tenant-configurable back-dating window, explicit defaults for unconfigured institutions. Consequence: some dashboards show different percentages after the change.

**Unblocked (10 of 10 topic 12 findings), by owner-tracks batch:**

- `t5-attendance-calendar-batch1`: PRC-M008, PRC-M465, PRC-L054, PRC-L260, PRC-L275, PRC-M169, PRC-M496, PRC-L145, PRC-M349, PRC-L596

**Also unblocked (partial-fix residuals mapped to topic 12 by owner-tracks
`design.md` section 5, batch `t9-residuals-batch1`):** PRC-M534

## 22. Topic 13 — Operational business rules (library, hostel, transport, scholarship, workflow): Option A approved 2026-10-27

**Date:** 2026-10-27. **Decider:** repository owner (dbn1972).
**Decision:** Option A (recommended), quoted verbatim from
`OWNER_DECISIONS_2026-10-26.md` topic 13:

> Owner supplies each rule (one line per item below); engineering enforces it server-side with tests. Consequence: requests that succeed today may be rejected (over-capacity, ineligible, invalid transition).

**Scope exclusion (not approved):** the parts that need owner-supplied
inputs that do not exist yet. Missing input, as recorded by the owner:
"one-line rules per item" (the owner's one-line rule for each item in the topic 13 table). Only the pieces whose recommended
option does not depend on this input are approved.

**Unblocked:** none of the 13 topic 13 findings; every item needs the missing input above.

**Still held (not unblocked by this approval):**

- PRC-L436 (`WAITING_ON_INPUT`): Topic 13 exclusion: needs the owner's one-line rule for this item (is an approval rationale mandatory, and may approvers see applicant financial data).
- PRC-M209 (`WAITING_ON_INPUT`): Topic 13 exclusion: needs the owner's one-line rule for this item (choose the 247 trigger+grant design or the partials-close event-table design).
- PRC-L118 (`WAITING_ON_INPUT`): Topic 13 exclusion: needs the owner's one-line rule for this item (link hostels to institutions, or drop the institution filter).
- PRC-M277 (`WAITING_ON_INPUT`): Topic 13 exclusion: needs the owner's one-line rule for this item (room-capacity enforcement and the vacate/checkout flow).
- PRC-L129 (`WAITING_ON_INPUT`): Topic 13 exclusion: needs the owner's one-line rule for this item (loan-limit policy per borrower type).
- PRC-L327 (`WAITING_ON_INPUT`): Topic 13 exclusion: needs the owner's one-line rule for this item (add an institution to library items, or drop the filter).
- PRC-M348 (`WAITING_ON_INPUT`): Topic 13 exclusion: needs the owner's one-line rule for this item (scholarship eligibility checks at submit and at approve).
- PRC-M350 (`WAITING_ON_INPUT`): Topic 13 exclusion: needs the owner's one-line rule for this item (scholarship approval routing (Req 11.3) and workflow integration).
- PRC-M540 (`WAITING_ON_INPUT`): Topic 13 exclusion: needs the owner's one-line rule for this item (programme status transitions and slot policy).
- PRC-M453 (`WAITING_ON_INPUT`): Topic 13 exclusion: needs the owner's one-line rule for this item (vehicle capacity, route date windows and bus-attendance membership).
- PRC-M460 (`WAITING_ON_INPUT`): Topic 13 exclusion: needs the owner's one-line rule for this item (case lifecycle state machine (resolution record, no-skip review)).
- PRC-M461 (`WAITING_ON_INPUT`): Topic 13 exclusion: needs the owner's one-line rule for this item (transition condition evaluator semantics).
- PRC-M638 (`WAITING_ON_INPUT`): Topic 13 exclusion: needs the owner's one-line rule for this item (FINAL/status handling and chained escalation).

## 23. Topic 14 — Notification behaviour rules: Option A approved 2026-10-27

**Date:** 2026-10-27. **Decider:** repository owner (dbn1972).
**Decision:** Option A (recommended), quoted verbatim from
`OWNER_DECISIONS_2026-10-26.md` topic 14:

> Activate the rule engine for an approved event list, define audience expansion per audience type, honour quiet hours except for safety classes, keep at least one channel mandatory for critical categories. Consequence: users start receiving (and stop receiving) messages they get today.

**Unblocked (6 of 6 topic 14 findings), by owner-tracks batch:**

- `t5-notifications-locale-batch2`: PRC-L257, PRC-L269, PRC-M190, PRC-M310, PRC-M529, PRC-M600

## 24. Topic 15 — Parked packages: mount with persistence or retire: Option A approved 2026-10-27

**Date:** 2026-10-27. **Decider:** repository owner (dbn1972).
**Decision:** Option A (recommended), quoted verbatim from
`OWNER_DECISIONS_2026-10-26.md` topic 15:

> Retire packages with no consumer (search-index, legacy report engine, plugin-sdk dev tooling) and keep the rest parked until a product owner schedules mount + schema + authz. Consequence: findings on retired code close by deletion; the rest stay blocked.

**Unblocked (3 of 14 topic 15 findings), by owner-tracks batch:**

- `t5-surfaces-retire-batch3`: PRC-M605, PRC-L488, PRC-L494

**Still held (not unblocked by this approval):**

- PRC-L450 (`BLOCKED_FOR_APPROVAL`): Topic 15 Option A keeps this package parked "until a product owner schedules mount + schema + authz"; mounting or persisting it is beyond the approved option text.
- PRC-L457 (`BLOCKED_FOR_APPROVAL`): Topic 15 Option A keeps this package parked "until a product owner schedules mount + schema + authz"; mounting or persisting it is beyond the approved option text.
- PRC-L481 (`BLOCKED_FOR_APPROVAL`): Topic 15 Option A keeps this package parked "until a product owner schedules mount + schema + authz"; mounting or persisting it is beyond the approved option text.
- PRC-L578 (`BLOCKED_FOR_APPROVAL`): Topic 15 Option A keeps this package parked "until a product owner schedules mount + schema + authz"; mounting or persisting it is beyond the approved option text.
- PRC-L166 (`BLOCKED_FOR_APPROVAL`): Topic 15 Option A keeps this package parked "until a product owner schedules mount + schema + authz"; mounting or persisting it is beyond the approved option text.
- PRC-M387 (`BLOCKED_FOR_APPROVAL`): Topic 15 Option A keeps this package parked "until a product owner schedules mount + schema + authz"; mounting or persisting it is beyond the approved option text.
- PRC-M388 (`BLOCKED_FOR_APPROVAL`): Topic 15 Option A keeps this package parked "until a product owner schedules mount + schema + authz"; mounting or persisting it is beyond the approved option text.
- PRC-L173 (`BLOCKED_FOR_APPROVAL`): Topic 15 Option A keeps this package parked "until a product owner schedules mount + schema + authz"; mounting or persisting it is beyond the approved option text.
- PRC-M392 (`BLOCKED_FOR_APPROVAL`): Topic 15 Option A keeps this package parked "until a product owner schedules mount + schema + authz"; mounting or persisting it is beyond the approved option text.
- PRC-M394 (`BLOCKED_FOR_APPROVAL`): Topic 15 Option A keeps this package parked "until a product owner schedules mount + schema + authz"; mounting or persisting it is beyond the approved option text.
- PRC-M395 (`BLOCKED_FOR_APPROVAL`): Topic 15 Option A keeps this package parked "until a product owner schedules mount + schema + authz"; mounting or persisting it is beyond the approved option text.

## 25. Topic 16 — Standalone/lab servers: Option A approved 2026-10-27

**Date:** 2026-10-27. **Decider:** repository owner (dbn1972).
**Decision:** Option A (recommended), quoted verbatim from
`OWNER_DECISIONS_2026-10-26.md` topic 16:

> Retire them from tools/scripts/services.json; the gateway is the only runtime. Consequence: local lab entry points disappear.

**Unblocked (4 of 4 topic 16 findings), by owner-tracks batch:**

- `t1-uploads-standalone-batch7`: PRC-L442, PRC-L577, PRC-L500, PRC-M458

## 26. Topic 17 — Placeholder, demo and dead surfaces (product/IA): Option A approved 2026-10-27

**Date:** 2026-10-27. **Decider:** repository owner (dbn1972).
**Decision:** Option A (recommended), quoted verbatim from
`OWNER_DECISIONS_2026-10-26.md` topic 17:

> Hide demo/placeholder surfaces behind flags off by default, delete dead routes/layouts, keep sandbox GPS and stub ISBN provider off in production, confirm L421/L439 closure (or keep open) explicitly. Consequence: some screens disappear for users until built.

**Unblocked (10 of 14 topic 17 findings), by owner-tracks batch:**

- `t5-surfaces-retire-batch3`: PRC-L399, PRC-L011, PRC-L038, PRC-L424, PRC-L534, PRC-L463, PRC-M211, PRC-M293, PRC-M445, PRC-L594

**Still held (not unblocked by this approval):**

- PRC-L421 (`WAITING_ON_INPUT`): Topic 17 Option A says "confirm L421/L439 closure (or keep open) explicitly"; the approval does not say which. Needs the owner to state close-as-STALE or keep-open.
- PRC-L439 (`WAITING_ON_INPUT`): Topic 17 Option A says "confirm L421/L439 closure (or keep open) explicitly"; the approval does not say which. Needs the owner to state close-as-STALE or keep-open.
- PRC-M155 (`BLOCKED_FOR_APPROVAL`): Beyond topic 17 Option A text: UUID lookup vs free-text code is the same choice as unapproved module decision PRC-M290; hide/delete does not resolve it.
- PRC-L520 (`BLOCKED_FOR_APPROVAL`): Beyond topic 15/17 Option A text: topic 17 deletes dead routes/layouts and topic 15's retire list is explicit (search-index, legacy report engine, plugin-sdk tooling); neither approves deleting UI packages. Needs the owner to choose mount or remove for form-builder, language-switcher, notification-bell and motion-gate (form-builder is also extended by approved topic 19 work, PRC-M637).

## 27. Topic 18 — File upload trust and malware scanning: Option A approved 2026-10-27

**Date:** 2026-10-27. **Decider:** repository owner (dbn1972).
**Decision:** Option A (recommended), quoted verbatim from
`OWNER_DECISIONS_2026-10-26.md` topic 18:

> Server sniffs type and scans every upload before it is usable; storage paths and uploader come from the server; FileUpload exposes an async scan status. Consequence: needs an AV service; uploads become asynchronous.

**Unblocked (4 of 4 topic 18 findings), by owner-tracks batch:**

- `t1-uploads-standalone-batch7`: PRC-M330, PRC-L200, PRC-L201, PRC-M459

**Also unblocked (partial-fix residuals mapped to topic 18 by owner-tracks
`design.md` section 5, batch `t9-residuals-batch1`):** PRC-L589

## 28. Topic 19 — Shared UI component API contracts: Option A approved 2026-10-27

**Date:** 2026-10-27. **Decider:** repository owner (dbn1972).
**Decision:** Option A (recommended), quoted verbatim from
`OWNER_DECISIONS_2026-10-26.md` topic 19:

> Add importId/idempotency and onFileValidate(file, mappings); trim FormBuilder field types to the ones rendered. Consequence: breaking prop changes for package consumers.

**Unblocked (3 of 3 topic 19 findings), by owner-tracks batch:**

- `t4-lists-ui-contracts-batch2`: PRC-L393, PRC-M455, PRC-M637

## 29. Topic 20 — Product behaviour defaults: authenticated caching and duplicate submits: Option A approved 2026-10-27

**Date:** 2026-10-27. **Decider:** repository owner (dbn1972).
**Decision:** Option A (recommended), quoted verbatim from
`OWNER_DECISIONS_2026-10-26.md` topic 20:

> no-store for authenticated reads (or per-tenant/user cache tags where measured), and disable-after-success plus an idempotency key on create forms. Consequence: more gateway reads; no stale cross-session data; double-submits rejected.

**Unblocked (2 of 2 topic 20 findings), by owner-tracks batch:**

- `t5-notifications-locale-batch2`: PRC-L251, PRC-L266

## 30. Topic 21 — Localisation scope: Option A approved 2026-10-27

**Date:** 2026-10-27. **Decider:** repository owner (dbn1972).
**Decision:** Option A (recommended), quoted verbatim from
`OWNER_DECISIONS_2026-10-26.md` topic 21:

> Localise mobile and shared UI widgets first for the approved locale set; persist locale per user and announce changes. Consequence: string-externalisation work across packages.

**Unblocked (3 of 3 topic 21 findings), by owner-tracks batch:**

- `t5-notifications-locale-batch2`: PRC-L007, PRC-L273, PRC-L195

## 31. Topic 22 — Dependency additions and external integrations: Option A approved 2026-10-27

**Date:** 2026-10-27. **Decider:** repository owner (dbn1972).
**Decision:** Option A (recommended), quoted verbatim from
`OWNER_DECISIONS_2026-10-26.md` topic 22:

> Approve per item after supply-chain review (pinned versions, lockfile change in its own PR). Consequence: lockfile changes and new runtime services to operate.

**Unblocked (6 of 7 topic 22 findings), by owner-tracks batch:**

- `t6-deps-integrations-batch1`: PRC-M602, PRC-M338, PRC-L489, PRC-M423, PRC-M552, PRC-L597

**Still held (not unblocked by this approval):**

- PRC-M326 (`WAITING_ON_INPUT`): Topic 22 approves live provider clients per item, but the provider choice and credentials for SMS/email/push/PSP do not exist yet (topic 8 exclusion covers the PSP). Needed: chosen SMS, email, push and payment providers plus sandbox+live credentials in the secret manager.

## 32. Topic 23 — Repository governance and design-token gates: Option A approved 2026-10-27

**Date:** 2026-10-27. **Decider:** repository owner (dbn1972).
**Decision:** Option A (recommended), quoted verbatim from
`OWNER_DECISIONS_2026-10-26.md` topic 23:

> Replace the personal-interim CODEOWNERS waiver with org teams; change the 10 failing token pairs to meet AA. Consequence: review routing changes; visible colour changes.

**Scope exclusion (not approved):** the parts that need owner-supplied
inputs that do not exist yet. Missing input, as recorded by the owner:
"org team names" (the GitHub org team names that replace the personal-interim CODEOWNERS waiver). Only the pieces whose recommended
option does not depend on this input are approved.

**Unblocked (1 of 2 topic 23 findings), by owner-tracks batch:**

- `t6-deps-integrations-batch1`: PRC-M430

**Still held (not unblocked by this approval):**

- PRC-M261 (`WAITING_ON_INPUT`): Topic 23 exclusion: needs the GitHub org team names (at least two owners per domain) to replace the personal-interim CODEOWNERS waiver and configure branch protection.

## 33. Topic 24 — Data migration tooling and seeds: Option A approved 2026-10-27

**Date:** 2026-10-27. **Decider:** repository owner (dbn1972).
**Decision:** Option A (recommended), quoted verbatim from
`OWNER_DECISIONS_2026-10-26.md` topic 24:

> Fix generate-uuids semantics first, then add DB-backed tests in CI; define seed data classification and re-baseline seed checksums in a migration batch. Consequence: seed checksums change (apply-sql ledger).

**Unblocked (4 of 4 topic 24 findings), by owner-tracks batch:**

- `t6-seed-checksums-batch2`: PRC-L462, PRC-L556
- `t6-deps-integrations-batch1`: PRC-M419, PRC-M553

## 34. Topic 25 — Infrastructure operating decisions: Option A approved 2026-10-27

**Date:** 2026-10-27. **Decider:** repository owner (dbn1972).
**Decision:** Option A (recommended), quoted verbatim from
`OWNER_DECISIONS_2026-10-26.md` topic 25:

> Pick the DNS provider and solver secret, document datastore CIDRs, move backups to COMPLIANCE object lock with PITR. Consequence: infra cost and an immutable-backup retention commitment.

**Scope exclusion (not approved):** the parts that need owner-supplied
inputs that do not exist yet. Missing input, as recorded by the owner:
"a DNS provider, datastore CIDRs and the backup lock mode" (the DNS provider (and solver secret), the production datastore CIDRs, and the backup Object Lock mode). Only the pieces whose recommended
option does not depend on this input are approved.

**Unblocked:** none of the 3 topic 25 findings; every item needs the missing input above.

**Still held (not unblocked by this approval):**

- PRC-L565 (`WAITING_ON_INPUT`): Topic 25 exclusion: needs the DNS-01 provider for wildcard TLS (*.proctira.io) and the solver secret name/source for the cert-manager ClusterIssuer.
- PRC-M522 (`WAITING_ON_INPUT`): Topic 25 exclusion: needs the production datastore network locations (CIDRs or in-cluster selectors for Postgres, Redis, Kafka, RabbitMQ) for the NetworkPolicy egress rules.
- PRC-M624 (`WAITING_ON_INPUT`): Topic 25 exclusion: needs the backup Object Lock mode decision (COMPLIANCE vs GOVERNANCE), retention days and PITR window/budget.

---

## Re-triage → codeable (NOT real decisions) — ~16 findings

Parked as "owner" but actually plain engineering (tests / fixtures):
PRC-L228 (gradebook component tests), PRC-L253 (sw.js test harness), PRC-L476
(in-memory Prisma look-alike divergence), and similar. These are being pulled
back into the normal codeable batch queue.

---

### How to use this

Answer the groups above (even a one-line call per group). Each answer unblocks
its findings, which then move into the batch queue with the decision recorded
in the finding's ledger `notes`. Groups 1, 2, 5, and 6 unblock the most findings
per decision — those are the highest-leverage calls.
