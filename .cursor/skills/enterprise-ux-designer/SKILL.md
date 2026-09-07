---
name: enterprise-ux-designer
description: >-
  Enterprise UX / product-design review for ProctiraERP surfaces (IA, hierarchy,
  copy, empty states, responsive chrome, brand consistency). Use when the user
  asks for UX review, design critique, visual QA, or “designer pass” on modules
  (Parent portal, Campus services, Auth, etc.). Complements
  enterprise-module-production-ready (a11y/axe/captures) — this skill judges
  design quality, not only checklist automation.
---

# Enterprise UX Designer (Definition of Design Review)

This skill is the **Definition of Design Review**. It does **not** replace:

- `.cursor/skills/enterprise-module-development/SKILL.md` (build)
- `.cursor/skills/enterprise-module-production-ready/SKILL.md` (E2E / a11y / multidevice / security)

**Rule:** Automated axe/touch/dark checks ≠ a design review. A module can be a11y-green and still fail IA, hierarchy, or empty-state clarity.

## When this skill applies

Trigger on: UX review, design review, visual QA, designer pass, polish UI, improve UX, brand consistency, empty states, mobile chrome, parent portal look & feel — or when asked to do **both** production-ready testing **and** a designer review.

## Required workflow

1. Copy `docs/audits/templates/ENTERPRISE_UX_DESIGN_REVIEW.md` → `docs/audits/UX_<SCOPE>.md`.
2. Capture or reuse **desktop + tablet + mobile** PNGs (prefer `apps/web/scripts/capture-screens.mjs` with `CAPTURE_MODULES=…`).
3. **Actually look at the PNGs** (Read image tool / visual inspection). Do not score from route lists alone.
4. Score each screen **1–10** on the rubric below; list **must-fix** vs **nice-to-have**.
5. Implement **must-fix** items in the same session when scope allows; otherwise open residual with owner.
6. Update `docs/audits/SCREEN_BY_SCREEN_SCOREBOARD.md` only when design residuals change the honest score.
7. Attach key PNGs under `/opt/cursor/artifacts/<scope>-ux-review/` and cite them in the audit + PR walkthrough.

## Rubric (weight evenly unless noted)

| Dimension                    | Pass bar (≈9+)                                                                                      |
| ---------------------------- | --------------------------------------------------------------------------------------------------- |
| **Information architecture** | One primary job per view; nav labels match mental model; no staff chrome in parent/student surfaces |
| **Visual hierarchy**         | Title > primary action > secondary; scanning works in ≤3 seconds                                    |
| **Density & clutter**        | No decorative card spam; spacing rhythm consistent with redesign system                             |
| **Empty / loading / error**  | Honest empty copy + next action; loading not a blank flash; errors recoverable                      |
| **Mobile / tablet**          | Bottom or compact nav usable; CTAs ≥44/48px; no clipped primary actions; tables stack/scroll        |
| **Forms & feedback**         | Labels, validation, success confirmation; destructive actions confirmed                             |
| **Brand / system fit**       | Uses existing tokens/components; parent shell distinct from staff; no one-off wild styles           |
| **Copy**                     | Plain language; role-aware (“your child” vs “student”); no placeholder lorem                        |

## Severity

| Severity | Meaning                                 | Exit                           |
| -------- | --------------------------------------- | ------------------------------ |
| **P0**   | Blocks comprehension or task completion | Must fix before “UX reviewed”  |
| **P1**   | Confusing or inconsistent; harms trust  | Fix in-session or dated waiver |
| **P2**   | Polish                                  | Backlog OK                     |

## Honesty rules

- Do **not** claim “enterprise UX signed off” from CI green alone.
- Do **not** invent screenshots.
- Parent / guardian surfaces must **not** look like staff ERP with a different title.
- Campus staff modules may share staff shell; review for **task clarity** and **emergency / dual-confirm** affordances where relevant.
- Prefer fixing P0/P1 over writing long prose.

## Pairing with production-ready skill

| Production-ready proves            | UX designer judges                    |
| ---------------------------------- | ------------------------------------- |
| Routes in axe / dark / touch lists | Whether hierarchy and copy work       |
| Multidevice PNGs exist             | Whether those PNGs look right         |
| E2E journeys pass                  | Whether the happy path _feels_ guided |

Both skills’ audits should cross-link.
