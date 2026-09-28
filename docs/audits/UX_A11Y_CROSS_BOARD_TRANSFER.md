# UX and accessibility — cross-board transfers

**Date:** 2026-09-28  
**Captures:** Sunrise Public School tenant `…a501`, signed in as Priya Sharma (admin + principal), production `next build` / `next start`.

## What the viewed captures show

- Pending queue is a table (desktop) and cards (mobile): Aarav Mehta, Diya Sharma, Ananya Reddy, each Grade 9, school and board on the move, requested by Priya Sharma, status pills Submitted / Approved / Under review. Approve and Reject sit on the Under review row only. Status filter and empty copy (“No transfers match this filter…”) are on the Cancelled filter shots.
- Request form uses a Student combobox and named selects (receiving school, destination grade, class, academic period). No raw ids in those fields.
- Equivalency is a named table (CBSE Grade 9 Mathematics → ICSE Grade 9 Mathematics, marks max, credit factor, Active pill) with Edit / Delete and board/grade/subject selects.
- Detail (Ananya Reddy, Under review) shows a numbered stepper (done / current / upcoming), header Approve, Reject, and Cancel transfer, and a timeline “Priya Sharma submitted · 28 Sep 2026, 13:46” / “started review”. Desktop breadcrumb reads **Ananya Reddy**, not the shortened UUID. Mobile staff chrome has no breadcrumb trail; the page heading is the student name and the same actions are on screen.
- Missing id `…b799` shows “Transfer workflow unavailable”, the not-found message, and Try again. The shortened id remains in the breadcrumb because there is no student name to resolve.

## Accessibility

- Pending and detail headings are real `h1`s. Status pills include the visible word, not color alone.
- Stepper marks the current step with `aria-current="step"` and screen-reader text for done / current / upcoming.
- Reject and cancel use `ConfirmActionDialog` with a labelled Reason field.
- Detail errors use `role="alert"`.

## Disposition

Visual review of the ten PNGs under `docs/audits/captures/cross-board-transfer/`: **FULLY_CLOSED** for the coordinator UX list (named pickers, equivalency table, human status copy, stepper, student-name breadcrumb, pending table, header actions). A keyboard-only and screen-reader pass was not recorded: **EXTERNALLY_UNVERIFIED**. This is not a 10/10 design sign-off.
