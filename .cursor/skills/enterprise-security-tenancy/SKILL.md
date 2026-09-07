---
name: enterprise-security-tenancy
description: >-
  Enterprise security and multi-tenant isolation review for ProctiraERP
  (IDOR, RBAC, PHI/PII, secrets, audit logs). Use for security audit, tenancy,
  cross-tenant deny, Health/Scholarships/fees/parent messaging, or before
  claiming a sensitive module is production-ready.
---

# Enterprise Security & Tenancy (Definition of Secure)

This skill is the **Definition of Secure**. Complements production-ready §Security with deeper evidence for sensitive domains.

## When this skill applies

Trigger on: security review, tenancy, IDOR, RBAC, PHI, PII, parent messaging, fees, Health, Scholarships, secrets, audit log — or when production-ready marks security incomplete.

## Required workflow

1. Copy `docs/audits/templates/ENTERPRISE_SECURITY_TENANCY_CHECKLIST.md` → `docs/audits/SEC_<MODULE>.md`.
2. Inventory sensitive routes/APIs and data classes (public / PII / PHI / financial).
3. Prove: unauth redirect, RBAC deny, cross-tenant deny (API + UI where applicable).
4. Check secrets, client logs, screenshot/PII leakage, audit events for writes.
5. Cite `tools/tenant-isolation-tests` when backend touched.
6. Fix P0s in-session or dated waiver with owner + risk.

## Severity

| Severity | Examples                                                       | Exit          |
| -------- | -------------------------------------------------------------- | ------------- |
| **P0**   | Cross-tenant read/write; unauth PHI/fee access; secrets in git | Block merge   |
| **P1**   | Missing audit on money/consent writes; weak RBAC               | Fix or waiver |
| **P2**   | Hardening / defense-in-depth                                   | Backlog OK    |

## Honesty rules

- Empty list ≠ isolation proved — attempt cross-tenant ID.
- Sandbox providers do not waive authZ tests.
- Do not paste live tokens/PHI into audits or PR text.

## Related

- Test skill security pillar: `.cursor/skills/enterprise-module-production-ready/SKILL.md`
- Tenant gate: `tools/tenant-isolation-tests/`
