# Parent portal screen test — Sunrise Public School

**Tenant:** `00000000-0000-4000-8000-00000000a501` (slug `sunrise-public-school`)  
**Bind:** HS256 session the same way as the E2E tenant helper (`sub` + `tenantId` + `X-Tenant-ID`). Actors `parent-mehta` and `parent-sharma`. Not tenant `00000000-0000-4000-8000-000000000001`.  
**Seed:** `db/seeds/006_sunrise_public_school_demo.sql` (1 pending consent, 1 approved, 2 open invoices, 1 paid).  
**Walk:** Next.js on `:3001` against the Postgres-backed gateway. Attendance skipped.  
**Unit check:** `apps/web/src/app/(parent)/parent/sunrise-screens.test.tsx` (8 passed).

Cross-tenant check: `parent-mehta` bound to `00000000-0000-4000-8000-000000000001` listed no children. `parent-mehta` requesting Diya Sharma’s grades returned 404.

This is a screen walk, not a production-ready or 10/10 claim.

## Route table

| Route                         | Actor         | Result  | What showed                                                                                                                                                                                             |
| ----------------------------- | ------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/parent`                     | parent-mehta  | PASS    | Welcome. 1 linked child: SPS-NID-001 · Aarav Mehta, Father · Active. Links to messages, consents, fees, offers.                                                                                         |
| `/parent`                     | parent-sharma | PASS    | 1 linked child: SPS-NID-002 · Diya Sharma, Mother · Active.                                                                                                                                             |
| `/parent/messages`            | parent-mehta  | PASS    | Empty state first (“No conversations yet”), child select shows Aarav. After creating a thread, the list shows “Screen test — Aarav homework”.                                                           |
| `/parent/messages/{threadId}` | parent-mehta  | PASS    | Subject, Aarav, Open, both message bodies, reply form.                                                                                                                                                  |
| `/parent/messages`            | parent-sharma | PASS    | Empty conversations. Child select shows Diya.                                                                                                                                                           |
| `/parent/consents`            | parent-mehta  | PASS    | “School photo and media consent”, Pending, Aarav, Approve and Deny. Confirm dialogs covered in the unit test (cancel does not decide; approve confirm calls the action). Live row left pending.         |
| `/parent/consents`            | parent-sharma | PASS    | “Grade 9 field trip consent”, Approved, Diya. No Approve/Deny.                                                                                                                                          |
| `/parent/fees`                | parent-mehta  | PASS    | Remaining ₹45,000.00, “1 open invoice”, Term 1 tuition, Pay (sandbox). Instalment card: “No instalment schedule yet.” No receipts. Pay confirm covered in the unit test; the live invoice was not paid. |
| `/parent/fees`                | parent-sharma | PASS    | Remaining ₹0.00, “0 open invoices”, Term 1 transport Paid, receipt SPS-RCT-2026-0001. No pay button.                                                                                                    |
| `/parent/offers`              | both          | PASS    | “No open offers for your account email right now.” Seed has no sent offer, so Accept was not on the page. Unit test opened “Accept this offer?” and did not submit.                                     |
| `/parent/grades`              | both          | PASS    | Selected child (one link, no switcher). “No published grades or report cards yet.”                                                                                                                      |
| `/parent/homework`            | both          | PASS    | “No published homework yet.”                                                                                                                                                                            |
| `/parent/timetable`           | both          | PASS    | “No published class meetings yet.”                                                                                                                                                                      |
| `/parent/calendar`            | both          | PASS    | “No holidays or events have been published yet.”                                                                                                                                                        |
| `/parent/notices`             | both          | PASS    | “There are no school notices right now.”                                                                                                                                                                |
| `/parent/lms`                 | both          | PASS    | “No published LMS assignments yet.”                                                                                                                                                                     |
| `/parent/library`             | both          | PASS    | Search prompt, “No loans for this child.”, “No holds for this child.”                                                                                                                                   |
| `/parent/pal`                 | both          | PASS    | “No practice plan yet.”                                                                                                                                                                                 |
| `/parent/report-cards`        | both          | PASS    | “No completed report cards yet.”                                                                                                                                                                        |
| `/parent/attendance`          | —             | SKIPPED | Out of scope for this pass.                                                                                                                                                                             |

Child switcher stays hidden when a parent has one linked child. The unit test switches Aarav → Diya when two links are passed.

## Fixes in this pass

| Bug                                                   | File                                                | What changed                                                                                               |
| ----------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Instalment card said the schedule could not be loaded | `parent/fees/page.tsx`                              | Parent read uses `?scope=parent` (`fees.read.self`). An empty schedule shows “No instalment schedule yet.” |
| “0 open invoice s”                                    | `parent/fees/page.tsx`                              | Plural is one string: “0 open invoices”.                                                                   |
| Deny confirm said the request stays pending           | `consents/_components/consent-decision-buttons.tsx` | Copy now says the denial is recorded immediately.                                                          |

`academic-frame.tsx` and `parent/library/page.tsx` belong to open PR #381 and were not edited. Attendance files were not edited.
