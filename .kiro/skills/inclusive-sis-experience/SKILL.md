---
name: inclusive-sis-experience
description: World-class UX, UI, design-system, accessibility, localization, responsive, mobile, offline, content, and workflow design for School/SIS ERP users. Use for screens, journeys, forms, dashboards, data grids, portals, Flutter, design tokens, usability, WCAG, RTL, low bandwidth, shared devices, and role-based experiences.
license: Proprietary
metadata:
  domain: school-sis-ux
  repository: ProctiraErp
  version: '1.0.0'
---

# Inclusive School/SIS experience skill

Apply this alongside `enterprise-school-sis-erp`. Design for real schools: high-volume clerical work, teachers with limited time, families with varying literacy and connectivity, children, multilingual public-sector users, accessibility needs and shared/mobile devices.

## Experience principles

1. Start with actor, job, context, frequency and risk—not a component or screenshot.
2. Prefer calm, predictable, role-specific workflows over dashboard density and decorative motion.
3. Make the safest/common path fast while keeping exceptions, correction and audit understandable.
4. Treat accessibility, localization, RTL, performance, responsive behavior and offline recovery as acceptance criteria.
5. Never expose sensitive student, custody, counselling, health, identity or finance data merely because a user can open the module.
6. Preserve user work through drafts, autosave, idempotency and explicit conflict resolution.
7. Reuse the canonical design system; do not clone primitives or import from the read-only Figma reference.

## Repository design system

- Canonical primitives: `@proctira/ui/components` under `packages/ui/components`.
- Design guidance: `packages/ui/README.md`.
- Theme tokens: reconcile `packages/ui/styles/theme.css`, app globals, Flutter and tenant overrides; do not create another token authority.
- Use semantic tokens, light/dark parity, reduced motion and `DirectionalIcon` for direction-dependent icons.
- Validate tenant theme overrides, not only defaults.

## Required UX workflow

For meaningful UI work:

1. Identify actors, devices, language/direction, connectivity, data volume, permissions and assistive technology.
2. Map the end-to-end journey and backstage handoffs before drawing screens.
3. Confirm the active router, auth/session provider and live API; do not enhance a placeholder or dead shell unknowingly.
4. Define information architecture and progressive disclosure by role.
5. Specify every state: loading, skeleton, empty, first-use, validation, forbidden, not-found, offline, stale, conflict, partial success, provider delay, retry and destructive confirmation.
6. Define keyboard flow, focus management, announcements, semantics, touch targets and error recovery.
7. Define responsive behavior for narrow mobile, tablet, laptop and high-density desktop.
8. Define locale behavior for dates, calendars, time zones, names, addresses, numbers, currencies, plurals, sorting and printable/exported content.
9. Add behavior-level acceptance scenarios and analytics that do not collect sensitive content.
10. Validate with representative users and state any research gap.

## School-specific patterns

- **Data entry:** minimize duplicate entry; use lookups, defaults, bulk actions, spreadsheet import with preview/validation and recoverable errors.
- **Attendance/grade entry:** keyboard-first grids, autosave visibility, offline queue status, class/period context and correction history.
- **Admissions/enrollment:** save-and-resume, document status, guardian relationship/custody handling, assisted-service mode and clear next steps.
- **Finance:** unambiguous currency, balances, allocation, receipt, reversal and reconciliation status; never rely on color alone.
- **Health/counselling:** privacy screen behavior, purpose/reason capture, restricted exports and discreet labels/notifications.
- **Government operations:** high-volume filters, bulk certification, submission status, rejection correction, immutable acknowledgement and audit evidence.
- **Portals:** relationship-based access, plain language, accessible documents, consent/preferences and multiple children/institutions.

## Accessibility baseline

Target WCAG 2.2 AA and include:

- Semantic structure, names/roles/values, keyboard-only completion and visible focus.
- Logical focus order, focus trap/return, skip mechanisms and no keyboard traps.
- Text zoom/reflow, orientation, target size, drag alternatives and reduced motion.
- Programmatic labels/instructions, error identification, summary and recovery.
- Accessible data tables/grids, charts, status messages, timeouts and session warnings.
- Contrast in all states, forced-colors/high-contrast resilience and no color-only meaning.
- Screen-reader and mobile assistive-technology evidence for critical journeys.
- Accessible generated PDFs, reports, emails and notifications when in scope.

Automated checks support but do not replace manual NVDA/JAWS/VoiceOver/TalkBack and keyboard review.

## Performance and offline UX

- Set route and interaction budgets; avoid large initial bundles and unnecessary client state.
- Prefer server pagination/virtualization for large rosters and ledgers.
- Make connectivity, queued writes, last sync, conflict and retry status explicit.
- Scope offline storage by tenant/user; protect sensitive data and clear it on logout/tenant change.
- Never imply success before a durable server acknowledgement for high-impact academic or financial actions.

## Validation

Choose applicable checks:

- Component/package tests, app typecheck and targeted interaction tests.
- `pnpm lint:a11y`, `pnpm check:contrast`, `pnpm check:i18n`.
- Authenticated Lighthouse/axe for representative role journeys when environment support exists.
- Light/dark, RTL, tenant theme, responsive and reduced-motion visual review.
- Flutter analyze/tests and device assistive-technology checks for mobile changes.

Report what was automated, manually verified, user-tested and still unverified.
