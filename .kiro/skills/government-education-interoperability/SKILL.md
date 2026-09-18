---
name: government-education-interoperability
description: Government, ministry, district, school-board, statutory reporting, education standards, public-sector procurement, and interoperability engineering for School/SIS ERP. Use for CBSE, ICSE, state boards, UDISE+, APAAR, DIKSHA, NDEAR, jurisdiction profiles, regulatory returns, OneRoster, Ed-Fi, SIF, CEDS, LTI, SCORM, xAPI, data exchange, and sovereign deployments.
license: Proprietary
metadata:
  domain: government-education
  repository: ProctiraErp
  version: '1.0.0'
---

# Government education and interoperability skill

Apply this alongside `enterprise-school-sis-erp`. This skill does not assume one country, board or current regulation. For an implementation, verify current official specifications and effective dates; never encode a remembered policy as law.

## Public-sector principles

1. Model regulation and board policy as versioned, effective-dated configuration with provenance and approval—not tenant forks.
2. Preserve source submissions, transformations, validation results, acknowledgements, rejections, corrections and resubmissions as auditable evidence.
3. Design for ministry→state→district→block→institution scope, delegated administration and least privilege.
4. Support low bandwidth, intermittent connectivity, bulk data collection, assisted workflows, multilingual content and accessible public services.
5. Separate statutory identifiers from internal IDs; define issuance, verification, correction, merge and deactivation.
6. Use open, versioned contracts and canonical mappings rather than ad hoc spreadsheets whenever an applicable standard exists.
7. Treat data residency, sovereignty, retention, child privacy, procurement, accessibility, DR and exit portability as first-class requirements.

## Jurisdiction profile

Before government or board work, document:

- Country/state/board, authority, legal basis, effective period and source URL/document.
- School hierarchy, institution types, academic calendars, grades/programs and curriculum/grading rules.
- Required identifiers and demographic definitions, including permitted unknown/not-disclosed values.
- Attendance, progression, examination, certificate and records-transfer rules.
- Finance, scholarship, payroll, safeguarding and special-needs reporting obligations.
- Languages, scripts, RTL needs, date/calendar/time-zone and number/currency conventions.
- Data residency, retention, consent/guardian, disclosure, correction, deletion/legal-hold and audit rules.
- Submission schedule, certification roles, signing, acknowledgement, correction and appeal process.
- Hosting, offline, scale, accessibility, security, DR, support and source-code/exit requirements.

When requirements differ, create a versioned jurisdiction/board adapter and conformance suite. Do not scatter `if board === ...` through domain services or UI.

## India and school-board lens

When in scope, explicitly evaluate current official requirements for CBSE, CISCE/ICSE, relevant state boards, UDISE+, APAAR, DIKSHA and NDEAR-aligned architecture. Confirm terminology, schemas, APIs, consent/legal basis and effective dates from authoritative sources before coding. Keep the core product board-neutral and implement configurable profiles/adapters.

## Interoperability strategy

Evaluate fit before adopting a standard:

- **Roster and learning:** OneRoster, LTI 1.3/Advantage, SCORM, xAPI.
- **Education data:** Ed-Fi, SIF, CEDS or jurisdiction-specific canonical models.
- **Identity/federation:** OIDC/OAuth2, SAML where mandated, verifiable credentials where justified.
- **Documents/data:** accessible PDF, CSV with explicit schema, signed JSON APIs, webhooks and bulk object exchange.

For every contract define:

- Version, profile, canonical mapping, identifiers, code sets and effective dates.
- Authentication, authorization, tenant/institution scope, signing/encryption and key rotation.
- Pagination, rate limits, idempotency, ordering, replay and duplicate handling.
- Validation, quarantine, partial failure, acknowledgement, reconciliation and provenance.
- Backward compatibility, deprecation, sandbox/certification fixtures and contract tests.
- Data minimization, retention, observability, support ownership and exit/export.

OpenAPI availability alone is not conformance. Keep documented security semantics aligned with runtime behavior.

## Statutory reporting lifecycle

A government return is complete only when users can:

1. Select the correct jurisdiction, period and institution population.
2. Preview source coverage, definitions and data-quality exceptions.
3. Resolve or formally accept exceptions with reason and authority.
4. Freeze/certify an immutable submission snapshot.
5. Sign and submit through a retry-safe channel.
6. Receive and retain acknowledgement/rejection evidence.
7. Correct and resubmit without erasing prior submissions.
8. Reconcile accepted totals to operational records.
9. Produce audit, access and retention evidence.

## Procurement and deployment review

Assess multi-year support, open standards, portability, vendor exit, data ownership, localization, accessibility, security controls, sovereign/on-prem/cloud deployment, offline continuity, capacity, RPO/RTO, observability, service desk, training and total cost. Distinguish repository assets from independently verified certifications or operating evidence.

## Required output

For a government/board request provide jurisdiction assumptions, official-source verification status, configurable rules, data mapping, submission lifecycle, security/privacy, conformance tests, migration/reconciliation, rollout and unresolved legal/policy questions. Never claim statutory compliance without evidence from the applicable authority and deployment.
