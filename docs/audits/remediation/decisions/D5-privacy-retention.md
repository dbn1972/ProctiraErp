# Decision D5 — Privacy / DPDP / retention content (DRAFT, team to review)

**Decided by:** owner (interim) · **Status:** ACCEPTED as DRAFT — legal/counsel
to review and replace before production.

> IMPORTANT: The text below is an AI-drafted starting point modelled on India's
> Digital Personal Data Protection Act, 2023 (DPDP) structure and common SIS
> privacy practice. It is NOT legal advice and has not been reviewed by counsel.
> It exists so the product stops shipping generic English boilerplate and has a
> DPDP-shaped placeholder the legal team edits. Do not represent it as final.

## Decision
Ship the drafted DPDP-aligned privacy/terms/retention content below as the
default, clearly marked as a draft pending legal review, and wire the retention
rules into config so counsel-supplied values can replace them without code
changes. Findings in Group 5 that are purely "content missing" are closed by
adding this content; findings that need a real erasure/anonymisation mechanism
are closed by implementing the mechanism against configurable policy (not by
inventing legal rules).

## Findings
- PRC-L262 (privacy/terms copy) — closed by adding the drafted content.
- PRC-M214 (DPDP erasure/anonymisation) — implement erasure/anonymisation
  against a configurable retention policy; default rules below.
- PRC-M203 (legal-hold guard) — honour `tenants.legal_hold` to block
  erasure/retention deletion; covered by the mechanism, policy values below.
- PRC-L256 (audit retention floor) — set the configurable default below.
- Others referencing DPDP copy use the same source.

## Drafted content (placeholder — legal to finalise)

### Privacy notice (summary)
- **Who we are / data fiduciary:** the educational institution (tenant) is the
  Data Fiduciary; the platform operator is a Data Processor acting on the
  institution's documented instructions.
- **Personal data we process:** student, guardian and staff identity and
  contact details, academic records, attendance, assessment, fee and payment
  records, and health records where the institution records them.
- **Purposes:** delivering school information services — enrolment, academics,
  attendance, assessment, fees, communication, and statutory reporting.
- **Lawful basis:** performance of the education service and the institution's
  legal obligations; consent where required (e.g. certain communications).
- **Children's data:** processed on behalf of the institution; guardian consent
  is the default basis for a minor's data, consistent with DPDP's treatment of
  children. No behavioural tracking or targeted advertising to children.
- **Data principal rights:** access, correction, completion, erasure, grievance
  redressal, and nomination, exercised through the institution.
- **Grievance / DPO contact:** `[institution DPO contact — tenant-configurable]`.
- **Retention:** personal data is kept only as long as needed for the purposes
  above or as required by law; see the retention schedule.
- **Security:** tenant isolation, access controls, encryption in transit, and
  audit logging.

### Terms of use (summary)
Acceptable-use, institution-owned data, service-availability, and
limitation-of-liability sections — `[counsel to supply jurisdiction-specific
terms]`. The draft must not assert guarantees counsel has not approved.

### Retention schedule (DEFAULTS — configurable per tenant, counsel to confirm)
| Data category | Default retention | Notes |
|---|---|---|
| Audit logs | 24 months (min 12) | PRC-L256: floor raised from 1 month; configurable, not below 12 months |
| Student academic records | Duration of enrolment + 7 years | Statutory/record-keeping; confirm per jurisdiction |
| Fee / payment records | 8 years | Financial record-keeping norm; confirm |
| Health records | Duration of enrolment + as required by law | Sensitive; confirm |
| Communication logs | 18 months | Operational |
| Consent records | Life of relationship + 3 years | DPDP evidence of consent |

### Erasure / anonymisation (mechanism, policy-driven)
- On a verified erasure request (and absent a legal hold), personal data is
  either deleted or irreversibly anonymised, except records a law requires be
  retained, which are locked from further processing until their retention
  expires.
- **Legal hold:** if `tenants.legal_hold` (or a per-record hold) is set,
  erasure and retention-deletion are blocked and the request is queued.
- All retention periods and the erasure mode (delete vs anonymise) are
  configuration, so counsel-supplied values replace these defaults without code
  changes.

## Guardrail
Everything above is a reviewable draft. The implementing PR must render it with
a visible "draft — pending legal review" marker and must NOT claim legal
compliance. Counsel's later edits are content/config changes, not code changes.
