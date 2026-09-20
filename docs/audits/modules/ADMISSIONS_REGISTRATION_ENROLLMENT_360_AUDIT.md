# Admissions, Registration & Enrollment — 360° Module Audit

**Audit type:** Screen-by-screen UX, accessibility, functional, data, security and operations audit  
**Repository:** ProctiraErp  
**Audited branch/SHA:** `origin/main` / `12fe8de08215f0eac8bb128c06ada49b5462c1f4`  
**Audit date:** 2026-09-15  
**Evidence posture:** Source/configuration review; no production environment, user research, screen-reader session, mobile device session or live-provider execution was available  
**Module verdict:** **PARTIAL — useful vertical slice, not production-ready as a complete admissions service**

## 1. Executive summary

The module has materially more depth than a demo CRUD surface. It provides:

- a public multilingual registration portal;
- school discovery and map-based selection;
- a three-step applicant wizard with draft persistence;
- document selection and client/server validation;
- tracking-number plus date-of-birth status lookup;
- staff enquiry, application, interview, waitlist, seat, merit and offer screens;
- PostgreSQL-backed application and pipeline records with RLS;
- offer-fee and acceptance hooks; and
- an acceptance-to-student/enrollment handoff with mandatory class placement.

However, the journey is not yet a dependable production admissions service. The largest risks are:

1. **Public tenant authority is not trustworthy.** Public routes accept `x-tenant-id` or a configured default, allowing a caller-controlled context to determine where applicant PII is written/read.
2. **Uploaded documents are not durably stored.** Bytes are base64-encoded into the submit request, validated, then discarded; only metadata is persisted.
3. **Configurable forms are not reliably connected.** Applicant routes commonly pass an institution-type slug to an endpoint that expects an institution UUID, while server helpers silently replace failures with an empty form configuration.
4. **Production school/config data is incomplete.** The PostgreSQL repository persists applications but keeps institution and form-configuration sources as process-memory overlays.
5. **Failure states are routinely converted to empty/not-found states.** Applicants and staff cannot distinguish no data from backend failure.
6. **The workflow lacks applicant self-service lifecycle depth.** There is no authenticated save/resume across devices, correction request, withdrawal, appeal, offer acceptance portal, accessible offer document, consent history or communication preference flow.
7. **Live acceptance evidence is weak.** Public E2E submit/status is mostly skipped; the staff live chain soft-skips when the gateway is unavailable.

### Provisional scorecard

| Dimension                              | Score / 10 | Evidence-led assessment                                                                 |
| -------------------------------------- | ---------: | --------------------------------------------------------------------------------------- |
| Applicant journey completeness         |        5.5 | Apply and track exist; lifecycle after submit is shallow                                |
| Staff workflow completeness            |        6.5 | CRM, seat, merit, offer and enrollment functions exist                                  |
| Functional/data integrity              |        6.0 | Durable core application/pipeline, but document/config and atomicity gaps               |
| Usability and information architecture |        5.5 | Clear basic routes; staff hub is dense and weak for volume                              |
| Accessibility                          |        6.0 | Labels/axe coverage exist; WCAG 2.2/manual AT evidence absent                           |
| Responsive/mobile/offline              |        4.0 | Responsive CSS and session draft; no native/offline/durable cross-device flow           |
| Localization/RTL                       |        5.5 | Four portal locales including Arabic; staff CRM is English-only                         |
| Security/privacy                       |        4.0 | DOB tracking check and RLS are strengths; public tenant and file handling are high risk |
| Reliability/operations                 |        4.0 | Production factories exist; silent fallbacks and skipped live checks weaken confidence  |
| **Overall**                            |    **5.2** | **PARTIAL**                                                                             |

Scores are not production certification and must be revalidated with rendered captures, assistive technology, live PostgreSQL/Redis/object storage, provider integrations and representative users.

## 2. Actors, jobs and context

| Actor                        | Primary job                                                             |                Frequency/volume | Failure cost                                         |
| ---------------------------- | ----------------------------------------------------------------------- | ------------------------------: | ---------------------------------------------------- |
| Applicant/guardian           | Find a school, apply, upload evidence, track progress, respond to offer | Seasonal; potentially very high | Missed placement, duplicate travel, privacy exposure |
| Assisted-service clerk       | Enter an application for a low-literacy/offline family                  |      High during intake windows | Exclusion, duplicate/inaccurate records              |
| Admissions officer           | Triage, request evidence, schedule interview, decide status             |               Daily/high volume | Delay, unfair decision, missed SLA                   |
| Registrar                    | Convert accepted applicant into authoritative student/enrollment        |             Daily during intake | Duplicate student, wrong class/period                |
| Interviewer                  | See schedule and record outcome/score                                   |                        Seasonal | Incorrect merit result                               |
| Finance officer              | Issue/reconcile admission fee and payment                               |                       Per offer | Incorrect balance or enrollment before payment       |
| Principal/admissions manager | Configure seats, weights, quotas and approve lists                      |              Periodic/high risk | Over-enrollment, inequitable selection               |
| Guardian/parent portal user  | Review, accept/decline and pay an offer                                 |                       Per offer | Lost seat, disputed consent/payment                  |
| Auditor/support              | Reconstruct who changed decisions and why                               |                Exception-driven | Unresolved complaint or regulatory failure           |

### Context that must drive the design

- low-bandwidth phones and shared family devices;
- applicants without email or reliable connectivity;
- multilingual/RTL users and varying literacy;
- high-volume staff queues and keyboard-heavy clerical work;
- custody/guardian authority and child-data sensitivity;
- configurable admission policy by institution, board, grade, quota and period; and
- strict deadline, appeal and audit requirements.

## 3. Active surface inventory

### Applicant-facing routes

| Route/screen                         | Evidence                                                      | Status                            |
| ------------------------------------ | ------------------------------------------------------------- | --------------------------------- |
| `/` landing                          | Hero, fixed statistics, process explanation, apply/track CTAs | Active                            |
| `/schools`                           | Server-loaded map/list and derived filters                    | Active, silently empty on failure |
| `/apply/[institutionType]`           | Personal/guardian/configurable-field step                     | Active                            |
| `/apply/[institutionType]/documents` | Configured file slots and in-memory file selection            | Active, not durable upload        |
| `/apply/[institutionType]/review`    | Review, base64 conversion, submit                             | Active                            |
| `/apply/success`                     | Tracking-number confirmation                                  | Active                            |
| `/track`                             | Tracking number + DOB form                                    | Active                            |
| `/track/[trackingNumber]`            | Status details/not-found fallback                             | Active                            |

Evidence: `apps/registration-portal/src/app/**`; route inventory in `apps/registration-portal/e2e/01-registration-portal-smoke.spec.ts:8-47`.

### Staff-facing routes

| Route/screen                 | Evidence                                                | Status |
| ---------------------------- | ------------------------------------------------------- | ------ |
| `/admissions`                | Application, waitlist, interview hub and status actions | Active |
| `/admissions/[id]`           | Placement, offer, class and enrollment state            | Active |
| `/admissions/enquiries`      | Enquiries, stage, follow-up and conversion              | Active |
| `/admissions/seat-matrix`    | Seat capacity by institution/period/grade/quota         | Active |
| `/admissions/merit`          | Score entry, weighted ranking and merit list            | Active |
| Staff status/interview forms | Components embedded in hub                              | Active |

Evidence: `apps/web/src/app/(dashboard)/admissions/**`; actions in `apps/web/src/app/(dashboard)/admissions-actions.ts:1-259`.

### Backend lifecycle

- Public application, tracking, school finder, form configuration and language session routes: `packages/backend/registration/src/routes.ts:1-420`.
- Staff enquiry/seat/merit/offer routes: `packages/backend/registration/src/pipeline/routes.ts:1-420`.
- Core application validation and tracking response: `packages/backend/registration/src/registration-service.ts:1-336`.
- Enquiry → application → placement → merit → offer pipeline: `packages/backend/registration/src/pipeline/pipeline-service.ts:1-420`.
- Durable application and pipeline factories: `packages/backend/registration/src/create-registration-repository.ts:1-57`.
- Enrollment service and class placement invariant: `packages/backend/student/src/enrollment/enrollment-service.ts:1-181` and `db/sql/063_enrollment_class_placement.sql:1-8`.

## 4. Screen-by-screen audit

### A. Public landing page

**What works**

- Clear primary Apply and secondary Track actions.
- “How it works” content and responsive grids support first-time comprehension.
- Visible institution-type entry points.

**Gaps**

- Statistics (`12,847`, `2.5M`, `98%`) are hardcoded marketing claims, not measured service evidence.
- No admission-cycle dates, eligibility, fees, document checklist, accessibility help, assisted-service location or support escalation is loaded from policy.
- No institution/jurisdiction context is established before application begins.

Evidence: `apps/registration-portal/src/app/page.tsx:27-139`.

**Recommendation:** Replace fixed numbers with verified tenant/jurisdiction content, show cycle/deadline policy, expose “apply with assistance,” and require school/tenant selection before collecting PII.

### B. School finder and map

**What works**

- Search/filter/map shape, pagination contract and XSS-safe marker test exist.
- Responsive container and translated labels are present.

**Gaps**

- Server errors are caught and rendered as an empty institution list; users cannot distinguish no schools from outage.
- Filter options are derived only from the first result page, so values outside that page can disappear.
- Map-first interaction has no demonstrated keyboard/list equivalent, low-data mode or geolocation consent explanation.
- PostgreSQL repository retains institutions as in-memory seeded overlays, so production discovery may be empty or replica-inconsistent.

Evidence: `apps/registration-portal/src/app/schools/page.tsx:1-64`; `packages/backend/registration/src/pg-registration-repository.ts:1-90,195-239`; `apps/registration-portal/e2e/02-a11y-axe.spec.ts:19-35,70-112`.

### C. Personal and guardian information

**What works**

- Programmatic labels, required indicators, autocomplete, `aria-invalid`, responsive two-column layout and field-level alerts.
- Client validation for required fields, DOB, phone and email.
- Configurable text/select/other fields are rendered.

**Gaps**

- No field-level `aria-describedby` binding or page-level error summary/focus management.
- Name, address, phone and gender models are not jurisdiction-configurable enough for global use.
- Guardian relationship, legal authority, custody restrictions, consent and multiple guardians are absent.
- Institution selection is not a visible required field in the step; it depends on a query/draft from school finder.
- Custom-field review shows IDs rather than human labels.

Evidence: `apps/registration-portal/src/components/registration/personal-info-form.tsx:1-276`; `apps/registration-portal/src/components/registration/review-step.tsx:100-123`.

### D. Configurable form loading

**Critical integration gap**

The route segment is typically a symbolic type (`primary`, `secondary`, `tvet`, `preschool`), but the backend endpoint resolves form configuration by institution UUID. The server helper deliberately sends the symbolic value and silently returns an empty configuration when resolution fails. Required tenant-specific fields/documents can therefore disappear without warning.

Evidence: `apps/registration-portal/src/app/page.tsx:199-220`; `apps/registration-portal/src/app/apply/[institutionType]/page.tsx:13-25`; `apps/registration-portal/src/lib/server.ts:10-31`; `packages/backend/registration/src/routes.ts:350-390`.

**Recommendation:** Make the route institution-specific after school selection, fetch an immutable published form version, display version/deadline, and fail visibly if required policy cannot load.

### E. Documents

**What works**

- Type/size checks run in browser and backend.
- Document bytes are kept out of `sessionStorage`.
- Remove action has an accessible name.
- Refresh loss is detected and asks for re-upload.

**Critical functional gap**

Files are read completely into base64 and sent in JSON. The service validates metadata but persists only document metadata; content is discarded. This is not a document upload, virus-scanned evidence vault or durable verification workflow. Base64 also inflates payload size and memory usage.

Evidence: `apps/registration-portal/src/components/registration/document-upload.tsx:1-146`; `apps/registration-portal/src/components/registration/review-step.tsx:43-91,171-189`; `packages/backend/registration/src/registration-service.ts:45-86,221-286`; `packages/backend/registration/src/pg-registration-repository.ts:100-151`.

**Recommendation:** Use pre-signed multipart object upload, malware scanning, checksum, encryption, retention, tenant prefix, document status/version, reviewer actions, restricted download and deletion/legal-hold policy.

### F. Draft/save/resume

**What works**

- Form state survives route changes and refresh in the same tab/session.
- Draft is namespaced by institution type; file bytes are not persisted.

**Gaps**

- `sessionStorage` is not cross-device, cross-browser or durable save/resume.
- Quota/storage exceptions are silently ignored.
- No visible saved/saving/failed timestamp, expiry, conflict handling or “clear shared device” control.
- Sensitive applicant PII remains in browser storage until the tab/session ends or reset is called.

Evidence: `apps/registration-portal/src/components/registration/registration-context.tsx:1-193`.

### G. Review and submit

**What works**

- Revalidates institution, DOB, phone and email.
- Prevents double click while submitting.
- Shows uploaded metadata and missing-byte warning.

**Gaps**

- No confirmation of declarations, consent/privacy notice, guardian authority, accuracy attestation or terms version.
- Errors are flattened to a single message; backend field errors are parsed by the client but discarded by `submitRegistration`.
- No idempotency key; network timeout after durable submit can create duplicate applications on retry.
- Custom fields show identifiers instead of labels.
- No partial upload/retry progress or low-bandwidth mode.

Evidence: `apps/registration-portal/src/lib/api.ts:20-54,205-222`; `apps/registration-portal/src/components/registration/review-step.tsx:1-190`.

### H. Success/tracking-number handoff

**Strength:** CSPRNG tracking identifiers are used and the status lookup requires DOB.

**Gaps:** Tracking number is held in session storage with no verified email/SMS receipt, print/download, masked reminder/recovery or support path. Loss of the number makes the application effectively inaccessible.

Evidence: `packages/backend/registration/src/registration-service.ts:29-43`; `apps/registration-portal/src/components/registration/review-step.tsx:86-93`.

### I. Status tracking

**What works**

- Tracking-number format and DOB are validated.
- Backend uses the same not-found response for missing/mismatched DOB, reducing enumeration signal.
- Waitlist position and interview booking summaries are available in the service response.

**Gaps**

- The page catches every backend error and presents “not found,” masking outages, rate limits and configuration errors.
- Applicant-facing status vocabulary is coarse; no requested-action deadline, document deficiency, appointment details, offer/appeal action or contact channel.
- No recovery for a lost tracking number.
- No evidence of public endpoint abuse protection specific to tracking attempts.

Evidence: `apps/registration-portal/src/app/track/[trackingNumber]/page.tsx:1-82`; `packages/backend/registration/src/registration-service.ts:288-336`.

### J. Staff admissions hub

**What works**

- One hub exposes application status, interviews, waitlist and navigation to deeper screens.
- Empty states and semantic lists exist.

**Gaps**

- Not suitable for high volume: no server pagination, search, filter, saved view, assignment, SLA, bulk actions, column configuration or export.
- Three unrelated high-risk tasks share one page, increasing cognitive load.
- API clients use `throwOnError: false` and return empty arrays, so outages appear as “No applications in this gateway process yet.”
- Waitlist entries display truncated application IDs instead of applicant context.
- Date formatting uses server locale rather than tenant/user timezone policy.

Evidence: `apps/web/src/app/(dashboard)/admissions/page.tsx:1-167`; `apps/web/src/lib/api/admissions.ts:1-102`.

### K. Enquiries and follow-ups

**What works:** Source/stage, follow-up, owner, scores and idempotent enquiry conversion are represented.

**Gaps:** No Kanban/table volume mode, overdue queue, reminder worker, duplicate-person matching, communication history, consent/source attribution, loss reason, bulk assignment or conversion preview.

Evidence: `apps/web/src/app/(dashboard)/admissions-actions.ts:65-139`; `packages/backend/registration/src/pipeline/pipeline-service.ts:119-235`.

### L. Interview management

**What works:** Staff can create capacity-bounded slots and book applications; public tracking can receive booking summaries.

**Gaps:** No interviewer assignment, timezone/locale, reschedule/cancel/no-show, accessibility accommodation, online meeting, conflict detection, calendar integration, notification delivery or interviewer scoring screen was evidenced.

Evidence: `apps/web/src/app/(dashboard)/admissions/page.tsx:38-61,128-164`; `packages/backend/registration/src/routes.ts` staff interview routes after the public route section.

### M. Seat matrix and quota

**What works:** Seat capacity is modeled by institution, period, grade and quota with unique/indexed storage, and availability is checked during offer creation.

**Gaps:** No effective dating/versioning, approval, freeze, overbooking policy, reservation expiry, allocation reconciliation, jurisdiction quota rules or audit UI. “Quota” is a free string rather than governed policy.

Evidence: `db/sql/034_admissions_crm_schema.sql:62-82`; `packages/backend/registration/src/pipeline/pipeline-service.ts:237-271,340-420`.

### N. Merit list

**What works:** Weight sum validation, deterministic ranking, weights snapshot and persisted entries exist.

**Gaps:** No moderation/approval/publish state, tie policy UI, missing-score handling explanation, protected characteristics review, appeal/recalculation history, immutable published version or accessible applicant result notice.

Evidence: `packages/backend/registration/src/pipeline/pipeline-service.ts:273-338`; `apps/web/src/app/(dashboard)/admissions-actions.ts:141-181`.

### O. Application detail and placement

**What works:** Staff can bind period/grade/quota/scores and see offers; accepted flow requires class placement at enrollment.

**Gaps:** No complete application evidence/guardian/document review, change history, comments, assignment, decision rationale, checklist, duplicate match or side-by-side comparisons. Class choices appear only after placement exists.

Evidence: `apps/web/src/app/(dashboard)/admissions/[id]/page.tsx:1-47`; `packages/backend/student/src/enrollment/enrollment-service.ts:45-102`.

### P. Offer, fee, acceptance and decline

**What works:** Draft/send/accept/decline states, fee invoice hooks, payment assertion, offer document snapshot and enrollment handoff are modeled.

**Gaps**

- Applicant acceptance is primarily a staff action; no complete authenticated guardian offer screen and consent trail is demonstrated here.
- Offer fee uses major-unit `NUMERIC(12,2)` and defaults to INR.
- `classId` is optional in the offer pipeline while enrollment rejects missing class placement, allowing late acceptance failure.
- No provider-delivery proof for email/SMS/accessible PDF, no e-signature, expiry worker evidence, cancellation/refund UX or payment reconciliation screen in this module.

Evidence: `db/sql/034_admissions_crm_schema.sql:120-145`; `packages/backend/registration/src/pipeline/pipeline-service.ts:18-30,340-420`; `apps/web/src/app/(dashboard)/admissions-actions.ts:183-259`; `packages/backend/student/src/enrollment/enrollment-service.ts:45-75`.

### Q. Enrollment conversion

**What works:** Active institution, unique active enrollment and mandatory class/section are checked; status history is generated.

**Gaps:** The overall accept → student → enrollment → invoice transition requires explicit proof of one transaction or recoverable saga. No operator reconciliation screen is evidenced for partially created student/invoice/enrollment records. Admission-number issuance, guardian linking, consent transfer, health alerts and document transfer are not presented as one completed service blueprint.

Evidence: `packages/backend/student/src/enrollment/enrollment-service.ts:45-181`; `db/sql/063_enrollment_class_placement.sql:1-8`.

## 5. Security, privacy and data findings

| ID            | Severity | Finding                                                                                                               | Required closure                                                                                                               |
| ------------- | -------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| ADM-SEC-01    | **P0**   | Public route tenant is accepted from `x-tenant-id` or defaults to `default`; caller context can control PII partition | Resolve tenant only from trusted hostname/institution directory; reject missing/unknown tenant and ignore client tenant header |
| ADM-DOC-01    | **P0**   | Document bytes are submitted as base64 but not durably stored or scanned                                              | Object-storage upload, malware scan, encryption, checksum, RLS metadata, retention and controlled retrieval                    |
| ADM-CFG-01    | **P1**   | Institution-type slug is sent to UUID form-config route; failures silently become empty config                        | Published institution-specific form version and visible fail-closed loading/error state                                        |
| ADM-DATA-01   | **P1**   | PG school and form-config sources remain in-memory overlays                                                           | Durable institution/form config queries using authoritative tenant-scoped tables                                               |
| ADM-SUBMIT-01 | **P1**   | Public submit has no idempotency/retry key                                                                            | Durable idempotency record keyed to tenant/applicant/client request                                                            |
| ADM-PRIV-01   | **P1**   | No consent/guardian-authority/versioned privacy evidence in applicant flow                                            | Versioned declarations, guardian relationship/authority, purpose, retention and withdrawal record                              |
| ADM-AUDIT-01  | **P1**   | Staff does not see decision/change audit history                                                                      | Atomic audit/outbox and role-limited timeline with reason/evidence                                                             |
| ADM-OPS-01    | **P1**   | Silent fallbacks convert backend failure into empty/default/not-found UI                                              | Explicit dependency unavailable, retry, incident/support and stale-data states                                                 |

Primary evidence for public tenant fallback: `packages/backend/registration/src/routes.ts:99-125`.

## 6. Accessibility, localization and inclusive experience

### Strengths

- Portal has English, Arabic, Spanish and French catalogs.
- Arabic translations cover the principal apply/track journey.
- Labels, required semantics, alert roles and axe checks exist.
- Layouts use responsive breakpoints and logical `ms-*` spacing in some places.

Evidence: `apps/registration-portal/src/messages/ar.json:1-159`; `apps/registration-portal/src/middleware.ts:1-41`; `apps/registration-portal/e2e/02-a11y-axe.spec.ts:1-136`.

### Gaps

- Automated tests target WCAG 2.1 AA, not the required WCAG 2.2 AA baseline.
- No keyboard-only end-to-end, focus after validation/navigation, error-summary, forced-colors, 200%/400% reflow, reduced-motion, VoiceOver/TalkBack/NVDA/JAWS or accessible PDF evidence.
- Middleware sends direction headers, but rendered `dir` behavior and full component mirroring were not proven.
- Staff CRM is hardcoded English and uses unlocalized status/date/currency strings.
- No plain-language mode, assisted-service workflow, print form, SMS-only route or low-data non-map school finder.
- Gender and guardian models are culturally and legally narrow.

## 7. Responsive, mobile, offline and performance

- CSS grids adapt to phone/desktop, but no device matrix or mobile assistive-technology evidence exists.
- No admissions flow was located in the Flutter mobile application.
- Session draft is local to one tab/browser; there is no offline queue or cross-device resume.
- Document base64 processing has high memory/bandwidth cost and lacks progress/chunking.
- Staff lists load all applications; no virtualization/server pagination exists.
- Map bundle and client Leaflet behavior need route-level performance budgets.

## 8. Testing and operational evidence

### Existing evidence

- Applicant smoke routes and ungated axe checks.
- Validation tests and draft tests.
- Registration service/repository/access tests.
- PostgreSQL admissions stores and RLS migrations.
- A comprehensive staff E2E chain from enquiry through offer/payment/enrollment.

### Evidence gaps

- Applicant live submission is absent from the public Playwright flow.
- Public live tracking only tests a wrong-DOB not-found path and is skipped unless a backend flag is set.
- Staff live chain explicitly soft-skips if gateway health is unavailable.
- No production object storage, notification provider, PSP, PDF accessibility, load, chaos, restore or multi-replica evidence is tied to admissions.
- No representative applicant, guardian, clerk or admissions-officer usability research was available.

Evidence: `apps/registration-portal/e2e/01-registration-portal-smoke.spec.ts:1-52`; `apps/web/e2e/41-admissions-crm-write-smoke.spec.ts:1-220`.

## 9. Prioritized remediation roadmap

### Phase 0 — trust and data safety

1. Remove public `x-tenant-id`/`default` authority; use trusted tenant/institution resolution.
2. Replace JSON base64 documents with secure object-storage workflow.
3. Persist institution directory and published form/document configuration.
4. Add idempotent submission and duplicate-person/application detection.
5. Add consent, guardian authority, privacy notice/version and retention policy.

### Phase 1 — complete applicant lifecycle

1. Authenticated or OTP-bound cross-device save/resume.
2. Document checklist, scan/verification status and correction requests.
3. Interview details/reschedule/accommodation.
4. Offer view, accessible PDF, consent, accept/decline and payment.
5. Withdrawal, correction, appeal and support escalation.
6. Email/SMS/print tracking-number recovery with preference/consent.

### Phase 2 — high-volume staff operations

1. Server-paginated queue with search, filters, saved views and assignment.
2. SLA/overdue indicators and bulk actions with partial-result recovery.
3. Evidence/checklist/change timeline on application detail.
4. Governed seat/quota versions and merit approval/publish lifecycle.
5. Reconciliation queue for offer, invoice, student and enrollment saga failures.

### Phase 3 — inclusive and operational maturity

1. WCAG 2.2 AA manual AT/device evidence.
2. Full staff localization, RTL, timezone and currency policy.
3. Assisted-service and low-data modes.
4. Performance/load budgets for seasonal peaks.
5. Provider SLOs, observability, runbooks, backup/restore and support telemetry.

## 10. Behavior-level acceptance criteria

The module must not be called production-ready until all of the following are demonstrated:

1. **Trusted tenant:** anonymous requests cannot select tenant scope using a header; unknown host/institution is rejected.
2. **Durable draft:** an applicant resumes the same versioned draft on another device after OTP verification without exposing another family’s data.
3. **Documents:** uploaded bytes are encrypted, scanned, checksummed, tenant-scoped, versioned and retrievable only by authorized roles.
4. **Config integrity:** the exact published institution/form/document version used at submit is stored with the application.
5. **Idempotency:** a timeout/retry creates one application and one tracking number.
6. **Tracking privacy:** invalid/mismatched lookups reveal no applicant existence; rate limits and abuse alerts are proven.
7. **Applicant recovery:** outage, validation, provider delay, lost tracking number and requested correction each have explicit recoverable UX.
8. **Staff volume:** 10,000+ applications can be filtered, paged, assigned and bulk-processed keyboard-first within defined budgets.
9. **Decision governance:** merit weights, quota, seat matrix, moderation, approval, publication, correction and appeal are versioned/audited.
10. **Offer/payment:** applicant receives an accessible offer, accepts/declines with versioned consent, and payment is reconciled before enrollment.
11. **Enrollment saga:** accept → student → guardian link → invoice → enrollment → class placement either completes once or surfaces a recoverable reconciliation record.
12. **Accessibility:** critical applicant and staff journeys pass keyboard, screen-reader, zoom/reflow, forced-colors, RTL and mobile AT checks at WCAG 2.2 AA.
13. **Localization:** applicant and staff content, dates, names, addresses, statuses, currency and documents follow tenant locale/timezone policy.
14. **Operations:** live CI executes applicant submit/status and staff conversion without unexplained skips; load, backup/restore and provider-failure evidence is retained.
15. **Research:** representative applicants, assisted-service clerks and admissions officers complete critical journeys with measured task success and documented remediation.

## 11. Recommended product metrics

- application completion rate by device/language/connectivity band;
- median time and number of sessions to submit;
- save/resume recovery success;
- validation/error abandonment by field;
- document rejection and re-upload rate;
- application-to-decision and decision-to-enrollment time;
- staff touches per application;
- overdue interview/follow-up/decision count;
- duplicate application/student prevention rate;
- offer acceptance/payment reconciliation success;
- appeal/reversal rate and reasons;
- accessibility support incidents; and
- provider/API failure recovery success.

Analytics must never capture document content, free-text sensitive notes, custody/health details or raw identifiers.

## 12. Evidence index

Key source authorities used for this audit:

1. `apps/registration-portal/src/app/**` — applicant routes.
2. `apps/registration-portal/src/components/registration/**` — wizard, draft and upload behavior.
3. `apps/registration-portal/src/lib/api.ts` — portal/backend contract.
4. `apps/web/src/app/(dashboard)/admissions/**` — staff screens.
5. `apps/web/src/app/(dashboard)/admissions-actions.ts` — staff mutations.
6. `apps/web/src/lib/api/admissions.ts` — staff API behavior and silent fallbacks.
7. `packages/backend/registration/src/routes.ts` — public/staff route behavior.
8. `packages/backend/registration/src/registration-service.ts` — application validation/tracking.
9. `packages/backend/registration/src/pipeline/**` — enquiry, seat, merit, offer and enrollment orchestration.
10. `packages/backend/registration/src/pg-registration-repository.ts` — durable application path and in-memory overlays.
11. `packages/backend/student/src/enrollment/**` — authoritative enrollment lifecycle.
12. `db/sql/014_admissions_crm_schema.sql`, `034_admissions_crm_schema.sql`, `063_enrollment_class_placement.sql`, `065_enrollment_active_uniqueness.sql` — data constraints/RLS.
13. `apps/registration-portal/e2e/**` and `apps/web/e2e/41-admissions-crm-write-smoke.spec.ts` — behavioral evidence and skips.

## 13. Audit limitations and revalidation triggers

Not verified in this audit:

- rendered screenshots or tenant-theme visual quality;
- live production route reachability/configuration;
- PostgreSQL/Redis/object-store/provider behavior;
- hosted CI outcomes at the audited SHA;
- browser/device/screen-reader behavior;
- actual branch protection/reviewer evidence;
- real applicant/staff usability research; or
- jurisdiction-specific admission rules.

Revalidate this report after any change to portal routes, registration schemas, public tenant resolution, form configuration, document storage, admissions pipeline, offer/payment integration, enrollment handoff, RBAC, mobile/offline support or production deployment configuration.
