# LMS / LTI epic plan (peer-gap slice #9)

**Updated (UTC):** 2026-09-07  
**Status:** Plan only — **no LMS product, routes, or adapters in this slice**.  
**Queue exit:** Separate plan (this document). Implementation is a later epic.

## Problem

Schools expect grade and roster sync with an external LMS (Canvas, Moodle, Google Classroom, etc.). ProctiraERP today owns SIS gradebook and enrollment; it does **not** implement LTI or LMS APIs. Marketplace/admin entitlement labels that mention LMS must not be read as shipped product.

## Non-goals (explicit)

- Building a full LMS (courses, assignments, discussion, content authoring)
- Live Canvas / Moodle / Google Classroom connectors in this plan PR
- Claiming SSO/SCIM complete via LTI alone
- Invented screenshots or fake “LTI ready” UI

## Recommended standard

**LTI 1.3 / Advantage** (IMS Global):

| Capability | Role | Notes |
| ---------- | ---- | ----- |
| OIDC login | Platform or Tool | Prefer Tool first (launch into Proctira from LMS) |
| Names and Roles Provisioning (NRPS) | Roster sync | Tenant-scoped; map LMS course ↔ Proctira section |
| Assignment and Grade Services (AGS) | Grade push/pull | Depends on hardened gradebook write audit |
| Deep Linking | Optional | Later phase |

## Dependencies (must be green before build)

1. SIS gradebook harden (RBAC, tenancy, write audit) — queue #1  
2. Stable section / enrollment APIs with tenant isolation  
3. Secrets / IdP story for client credentials per tenant (external waiver until live IdP)  
4. Observability: outbound LTI call metrics + failure audit

## Phased milestones (future build PRs)

| Phase | Deliverable | Exit |
| ----- | ----------- | ---- |
| A | Tool registration model (tenant, client_id, JWKS, deployment) + DEV contract | Schema + unit tests; no live LMS |
| B | OIDC login + resource-link launch (read-only landing) | E2E against LMS sandbox or recorded fixtures |
| C | NRPS roster import (dry-run + apply) | Cross-tenant deny tests |
| D | AGS grade passback for one assignment type | Gradebook write audit linked |
| E | Admin UI for registrations + launch diagnostics | Honest “sandbox vs live” mode badge |

## Waivers / residuals

| Item | Status |
| ---- | ------ |
| Live LMS vendor sandbox credentials | External — date when available |
| Device-farm mobile LMS deep links | Deferred |
| Full content / assignment authoring | Out of scope forever for this epic |

## Honesty

Closing queue slice **#9** means this plan exists and is linked from `PEER_GAP_CLOSURE_QUEUE.md`. It does **not** mean LMS/LTI is product-complete.
