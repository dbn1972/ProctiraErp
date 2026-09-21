# Volume 5

Security and Compliance Control Matrix

Security controls, ownership, evidence, compliance mappings, threat coverage, and operational assurance requirements.

Version 1.0
Prepared: 23 April 2026
Status: Draft baseline specification

## Purpose

This document provides a formal specification for the product area named in the title. It is intended to be used by product, design, engineering, security, operations, legal, partner, and customer-facing teams as an implementation and governance baseline.

## Document structure

1. Executive security posture
1. Control model and ownership
1. Identity and access controls
1. Data protection controls
1. Application and platform security controls
1. Logging, audit, and monitoring controls
1. Operational resilience controls
1. Plugin, theme, and extension controls
1. Compliance mapping matrix
1. Evidence and review cadence
1. Exceptions and remediation governance

# 1. Executive security posture

The platform must be operated as a trust-first enterprise product. Security controls are distributed across product design, architecture, operations, legal, customer configuration, and evidence generation. This document provides the control matrix needed for consistent implementation and review.

- Security by default, least privilege, explicit trust boundaries, and auditable control operation.
- Product controls must distinguish platform-owned, customer-configurable, and operationally enforced controls.
- Every claim made in security or compliance materials must map to real control ownership and evidence.

# 2. Control model and ownership

# 3. Identity and access controls

- SSO, OIDC, SAML, MFA, step-up auth, session revocation, and service account scopes must be supported and governed.
- Admin boundaries must be explicit: platform admin, tenant admin, org admin, security admin, audit/compliance admin, support roles.
- Break-glass access requires approval, time-boxing, audit, and post-use review.
- Authorization policy changes are high-risk events and require audit plus appropriate review controls.

# 4. Data protection controls

- Encryption in transit and at rest is mandatory for supported deployments.
- Secrets must be centrally managed and never exposed to plugins, themes, or unapproved tooling.
- Tenant boundaries must be preserved in storage, cache, search, queues, analytics, backups, and exports.
- Data lifecycle must define retention, deletion, restore, legal hold, and export behavior.

# 5. Application and platform security controls

- Secure SDLC, dependency management, vulnerability remediation, and release gating are baseline controls.
- The platform must maintain a living threat model and abuse case catalog.
- All new extension points, adapters, and install modes require security review.
- Async processing must include retry, poison message handling, idempotency, and audit for sensitive replays.

# 6. Logging, audit, and monitoring controls

- Critical actions must be logged with actor, tenant, target, correlation ID, outcome, and timestamp.
- Audit records must include auth events, role changes, policy updates, exports, support access, plugin lifecycle, theme publish, install/bootstrap, and queue replays or redrive actions.
- Security telemetry must be routed to monitoring/SIEM with clear ownership and incident paths.
- Customers should have governed visibility into privileged access events where appropriate.

# 7. Operational resilience controls

- Backups, restore tests, disaster recovery drills, runbooks, SLOs, and incident classification are mandatory.
- Self-hosted editions require published upgrade, rollback, compatibility, and support boundaries.
- Capacity planning must include auth load, storage growth, queue throughput, plugin resource usage, and cross-region cost.

# 8. Plugin, theme, and extension controls

- Plugins must run through an approved sandbox or isolated runtime model.
- Plugins must declare permissions, compatible versions, hook usage, and tenant scope behavior.
- Themes may not suppress legal disclosures, hide security warnings, or alter auth-critical UX.
- Marketplace or partner-distributed extensions require verification, compatibility checks, support ownership, and revocation capability.

# 9. Compliance mapping matrix

The matrix below is a product-control mapping aid. It does not replace formal certification or legal interpretation.

# 10. Evidence and review cadence

- Evidence must be current, attributable, and tied to named control owners.
- Review cadence should include release-time review, quarterly control review, annual policy refresh, and post-incident reassessment.
- Any public compliance or trust statement requires proof path review before publication.

# 11. Exceptions and remediation governance

- Control exceptions must be documented with owner, scope, reason, expiry date, and remediation plan.
- High-risk exceptions require explicit security and leadership approval.
- Exceptions must never silently become the default operating model.

## Tables

### Table 1

| Control family         | Primary owner         | Secondary owner    | Evidence                                                  |
| ---------------------- | --------------------- | ------------------ | --------------------------------------------------------- |
| Identity and access    | Security engineering  | Product + ops      | Auth logs, role reviews, MFA configuration                |
| Data protection        | Platform engineering  | Security           | Encryption settings, key rotation records, storage policy |
| Application security   | Engineering           | Security           | Code review, dependency scans, release gates              |
| Audit and logging      | Audit/platform team   | Security + support | Immutable logs, exports, access records                   |
| Operational resilience | SRE/operations        | Engineering        | Backups, DR tests, runbooks, incident reports             |
| Extension security     | Platform architecture | Security           | Plugin reviews, manifests, approval records               |
| Legal/privacy          | Legal/privacy         | Product            | Published policies, DPA templates, review approvals       |

### Table 2

| Framework area             | Representative requirement            | Product control response                                                   | Evidence source                                 |
| -------------------------- | ------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------- |
| SOC 2 / ISO 27001          | Access control and least privilege    | Scoped roles, SSO/MFA, audited admin changes, break-glass policy           | Role reviews, access logs, policy history       |
| SOC 2 / ISO 27001          | Change management                     | Release gates, API review, migration controls, documented ownership        | Release records, change approvals               |
| GDPR / privacy laws        | Data minimization and rights handling | Clear data ownership, deletion/export workflows, published privacy notices | Support tickets, audit events, privacy runbooks |
| HIPAA / sensitive data use | Protected data safeguards             | Encryption, auditable access, role restriction, operator controls          | Config evidence, audit exports                  |
| Operational resilience     | Backup and recovery                   | Backup policy, DR targets, restore testing, runbooks                       | Restore test reports, DR drill evidence         |
| Extension governance       | Third-party code and permissions      | Plugin manifest review, sandbox, revocation, support boundaries            | Plugin approval records, marketplace logs       |
