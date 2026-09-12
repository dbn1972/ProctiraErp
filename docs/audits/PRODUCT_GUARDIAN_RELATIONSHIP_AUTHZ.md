# Enterprise product / IA — Guardian relationship authZ (P0-03)

**Module / slice:** Parent portal — relationship-scoped guardian authority  
**Branch / tip:** `cursor/guardian-relationship-authz-56c3`  
**Date (UTC):** 2026-09-12  
**Owner / agent:** Cursor cloud agent

---

## 1. Capability statement

Guardians linked to the same student can hold distinct custody/authority flags (`is_primary`, `can_consent_medical`, `can_view_fees`). Medical consent decisions and fee list/pay are gated on those flags so a secondary contact without authority cannot act as if they were the primary fee/medical decision-maker.

## 2. Personas & jobs

| Persona                      | Job-to-be-done                                                    | Success looks like                                                |
| ---------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------- |
| Primary guardian             | Decide medical consents; view/pay fees                            | Flags true → allow                                                |
| Limited / secondary guardian | Stay linked for messaging/academics without medical/fee authority | Flags false → 403 on gated actions                                |
| Staff                        | Assign link authority when linking                                | Optional flags on link API; defaults preserve today’s full access |

## 3. Scope

| In scope                                      | Non-goals                                      |
| --------------------------------------------- | ---------------------------------------------- |
| SQL authority columns on `parent_child_links` | Full household/custody court-order model       |
| Enforce medical decide + fee view/pay gates   | Health PHI vault / break-glass (P0-09)         |
| Cross-guardian allow/deny unit tests          | Finance float guards / money integrity (P0-07) |
| PRODUCT + SEC notes                           | UI redesign of parent settings                 |

## 4. Surface map

| Surface        | API / path                          | Data                                   |
| -------------- | ----------------------------------- | -------------------------------------- |
| Link child     | `POST …/children`                   | `parent_child_links` + authority flags |
| Decide consent | `POST …/consents/:id/decide`        | medical → `can_consent_medical`        |
| List/pay fees  | `GET …/fees`, `POST …/fees/:id/pay` | `can_view_fees`                        |

## 5. Roles & tenancy

| Role                    | Can                                    | Cannot                        |
| ----------------------- | -------------------------------------- | ----------------------------- |
| Linked guardian + flag  | Gated action                           | —                             |
| Linked guardian − flag  | Messaging / academic reads (unchanged) | Medical decide / fee view-pay |
| Unlinked / other tenant | —                                      | 404 (no existence leak)       |

## 6. Success metrics / DoD

- [x] Schema flags with backward-compatible defaults
- [x] ≥1 enforced scoped gate (medical + fees)
- [x] Two-parent allow/deny tests; unlinked/cross-tenant remain green
- [x] PRODUCT + SEC audits (this file + `SEC_GUARDIAN_RELATIONSHIP_AUTHZ.md`)

## 7. Handoff

| Next skill | Audit path                                       |
| ---------- | ------------------------------------------------ |
| Security   | `docs/audits/SEC_GUARDIAN_RELATIONSHIP_AUTHZ.md` |
| Test       | `packages/backend/parent-portal` vitest          |
