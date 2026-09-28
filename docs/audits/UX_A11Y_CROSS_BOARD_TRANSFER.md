# UX and accessibility — cross-board transfers

**Date:** 2026-09-28

## UX

- Pending queue leads with the student name and school names (`resolveEntityLabel`).
- Empty, loading, and error states exist on `/transfers` and on the dashboard feature.
- Reject and cancel use `ConfirmActionDialog` and require a comment for reject.
- Equivalency editor is on the staff list page and states that only a tenant admin can save.
- Layout stacks on small screens (`flex-col`, `md:grid-cols-2`, table `overflow-x-auto`).

## Accessibility

- Pending and detail headings are real `h1`s.
- Stepper uses `aria-current="step"` and text "(current)" / "(done)", not color alone.
- Dialogs use the shared labelled confirm dialog. Comment fields have `<label htmlFor>`.
- Errors use `role="alert"` on the detail page.
- Loading region sets `aria-busy`.

## Captures

Production build (`next build` then `next start`), signed in, Postgres-backed:

- `docs/audits/captures/cross-board-transfer/desktop-pending-approvals.png`
- `docs/audits/captures/cross-board-transfer/desktop-detail-timeline.png`
- `docs/audits/captures/cross-board-transfer/desktop-equivalency-editor.png`
- `docs/audits/captures/cross-board-transfer/desktop-empty.png`
- `docs/audits/captures/cross-board-transfer/desktop-error.png`
- `docs/audits/captures/cross-board-transfer/mobile-pending-approvals.png`
- `docs/audits/captures/cross-board-transfer/mobile-detail-timeline.png`
- `docs/audits/captures/cross-board-transfer/mobile-equivalency-editor.png`
- `docs/audits/captures/cross-board-transfer/mobile-empty.png`
- `docs/audits/captures/cross-board-transfer/mobile-error.png`

Viewed: pending list shows Aarav and Diya by name; Diya's timeline lists review and reject comments; equivalency shows the CBSE→ICSE Mathematics row and the admin form; tenant B shows "No pending approvals"; a missing id shows "Transfer workflow unavailable". Mobile frames keep the same headings without horizontal overflow of the primary actions.

## Disposition

Visual review of that capture set: **FULLY_CLOSED**. A full keyboard-only and screen-reader pass was not recorded (**EXTERNALLY_UNVERIFIED**).
