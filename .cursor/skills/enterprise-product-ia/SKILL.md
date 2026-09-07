---
name: enterprise-product-ia
description: >-
  Enterprise product / information-architecture lock for ProctiraERP modules.
  Use before building or expanding a module: capability statement, roles,
  journeys, non-goals, nav map, success metrics. Trigger on product brief,
  scope lock, IA, roadmap slice, “what should parents/staff do”, or when
  starting a new module before enterprise-module-development.
---

# Enterprise Product / IA (Definition of Scope)

This skill is the **Definition of Scope**. Run **before** build.

Does **not** replace build / test / UX / security skills.

## When this skill applies

Trigger on: product brief, scope lock, IA, capability statement, non-goals, role journey, parent vs staff surface, “what are we building”, new module kickoff.

## Required workflow

1. Copy `docs/audits/templates/ENTERPRISE_PRODUCT_IA_CHECKLIST.md` → `docs/audits/PRODUCT_<MODULE>.md`.
2. Fill every section before writing schema or UI.
3. Get (or record) explicit non-goals and peer parity targets.
4. Hand off to `.cursor/skills/enterprise-module-development/SKILL.md`.

## Exit criteria

| Gate                                            | Required              |
| ----------------------------------------------- | --------------------- |
| Capability statement (1 paragraph)              | ☑                     |
| Primary personas + jobs-to-be-done              | ☑                     |
| In-scope / non-goals table                      | ☑                     |
| Nav → route → API → data map                    | ☑                     |
| RBAC / tenant boundaries (high level)           | ☑                     |
| Success metrics / DoD for the slice             | ☑                     |
| Explicit “staff shell vs parent shell” decision | ☑ when multi-audience |

## Honesty rules

- Do not start SQL/UI until PRODUCT audit exists for greenfield modules.
- Do not smuggle staff-operator jargon into parent/guardian products.
- Peer parity means named competitor capabilities, not vague “world class”.

## Gate order

`product/IA → build → UX → a11y → security → mobile (if any) → test → release`
