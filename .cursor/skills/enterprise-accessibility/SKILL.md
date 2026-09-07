---
name: enterprise-accessibility
description: >-
  Enterprise accessibility specialist pass for ProctiraERP beyond axe route
  lists (keyboard, focus, screen reader, RTL, contrast, touch). Use for a11y
  audit, WCAG, keyboard-only, RTL, or parent/guardian accessibility sign-off.
---

# Enterprise Accessibility (Definition of A11y)

This skill is the **Definition of A11y**. axe-green ≠ specialist sign-off.

## When this skill applies

Trigger on: accessibility, a11y, WCAG, keyboard, screen reader, RTL, contrast, touch targets deep-dive, inclusive design — especially parent/guardian surfaces.

## Required workflow

1. Copy `docs/audits/templates/ENTERPRISE_ACCESSIBILITY_CHECKLIST.md` → `docs/audits/A11Y_<SCOPE>.md`.
2. Include module routes in axe/dark/touch lists (pair with production-ready).
3. Manual keyboard pass: tab order, focus visible, dialogs, skip links where relevant.
4. Contrast gate / brand tokens; no new icon-only unlabeled controls.
5. RTL smoke if locale enabled.
6. Screen-reader spot check on primary journey (or waiver with tool limits).
7. Fix P0/P1 in-session when scope allows.

## Severity

| Severity | Examples                                                            | Exit                |
| -------- | ------------------------------------------------------------------- | ------------------- |
| **P0**   | Unusable without pointer; missing names on primary CTAs; focus trap | Block a11y sign-off |
| **P1**   | Contrast fails; touch <44/48 on primary                             | Fix or waiver       |
| **P2**   | Nice-to-have landmarks / polish                                     | Backlog             |

## Honesty rules

- Automated axe alone is insufficient for “a11y signed off”.
- Capture evidence (notes + PNGs/video) for manual checks.
- Cross-link UX designer audit — a11y and UX are related but distinct.

## Related

- `.cursor/skills/enterprise-module-production-ready/SKILL.md` UX/a11y pillar
- `.cursor/skills/enterprise-ux-designer/SKILL.md`
- `apps/web/e2e/a11y-axe.spec.ts`, touch-target, dark-mode specs
