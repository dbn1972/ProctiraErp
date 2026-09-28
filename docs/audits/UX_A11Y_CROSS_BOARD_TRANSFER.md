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

## Disposition

Design review from captures: **PARTIAL**. Keyboard and screen-reader behavior were implemented to the patterns above and covered by unit tests of labels, not by a recorded assistive-tech pass (**EXTERNALLY_UNVERIFIED** for a full WCAG audit).
