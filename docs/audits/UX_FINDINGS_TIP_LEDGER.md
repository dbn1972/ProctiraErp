# UX findings — tip ledger (orchestrator)

**Purpose:** Honest disposition of UX gap themes after Waves **W1–W13**, pinned to tip `main`.  
**Source file:** `proctira-design/UX_FINDINGS.md` is **not in-repo**. This ledger reconstructs from merged PR evidence + tip residual scans across `apps/web`, `apps/mobile`, `apps/admin-console`, `apps/public-website`, `apps/registration-portal`.  
**Tip SHA (Phase 0 pin):** `e04de049` (`fix(web): clear leftover UUID-primary labels and inputs (W13) (#408)`)  
**Updated (UTC):** 2026-09-26T12:43Z  
**Orchestrator run:** `bc-c03978a9-1637-47e1-89c8-cce4f6b5119b`  
**Honesty:** Do **not** claim all ~304 original findings `FULLY_CLOSED` without row-level proof below. Theme rollups may be `PARTIAL` even when high-severity surfaces closed.

Disposition vocabulary: `FULLY_CLOSED` | `PARTIAL` | `OPEN` | `NEEDS_API` | `DEFERRED`

---

## Live status (orchestrator)

| Metric                          | Count | Notes                                                                                                                           |
| ------------------------------- | ----: | ------------------------------------------------------------------------------------------------------------------------------- |
| Theme buckets tracked           |    14 | See § Theme rollup                                                                                                              |
| Themes `FULLY_CLOSED`           |     3 | W4 inert highs; W6 student route state; W12 visitor legal banners                                                               |
| Themes `PARTIAL`                |     8 | Confirm, UUID labels/pickers, colour-status, scaffold copy, empty≠error, mobile honesty, website residual, leftover UUID inputs |
| Themes `OPEN` / worker-owned    |     4 | Mobile studentId plumbing; admin residual confirms/filters; auth/reg privacy; web dashboard colour/UUID leftovers               |
| Themes `NEEDS_API`              |     4 | Mobile doc upload + notif cloud sync; parent child picker enrichment; fees class-name API; profile cloud prefs                  |
| Themes `DEFERRED` / collision   |     2 | Attendance UX (#386); gateway institutionId (#401)                                                                              |
| Worker PRs open (this campaign) |     0 | Workers launching in parallel — fill as PRs appear                                                                              |
| Merged this campaign            |     0 | Phase 0 docs PR pending                                                                                                         |

### Worker ownership matrix

| Lane                    | Path allowlist                                                                                       | Owns themes                                                                      | Status            | PR                             |
| ----------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------- | ------------------------------ |
| **Orchestrator**        | `docs/audits/UX_FINDINGS_TIP_LEDGER.md` only (+ tiny docs fixes)                                     | Ledger live counts                                                               | Phase 0 in flight | `cursor/ux-orch-w0-tip-ledger` |
| **Mobile worker**       | `apps/mobile/**` only                                                                                | MOB-*, studentId plumbing, parent shells → existing APIs, profile/routes honesty | Launching         | —                              |
| **Admin worker**        | `apps/admin-console/**` only                                                                         | ADM-* colour text, UUID filters→pickers, break-glass/decommission confirm        | Launching         | —                              |
| **Auth/Public worker**  | `apps/web/src/app/(auth)/**`, `(public)/**`, `apps/public-website/**`, `apps/registration-portal/**` | AUTH-_, WWW-_, REG-* MFA/oauth/reset, legal residual, i18n/DOB-in-URL            | Launching         | —                              |
| **Web residual worker** | `apps/web` dashboard/parent/student **except** auth/public                                           | WEB-* colour residuals, UUID leftovers, missed confirms; skip attendance         | Launching         | —                              |

### Collision avoid (still open — do not take)

| PR          | Branch                                      | Why skip                                                    |
| ----------- | ------------------------------------------- | ----------------------------------------------------------- |
| #386        | `ux/attendance-review`                      | Owns attendance module UX (+ form/i18n/list-result touches) |
| #401        | `fix/GAP-institution-scope-multi-injection` | Gateway `institutionId` injection                           |
| #388 / #387 | docs / institution reference lookups        | Unrelated unless worker paths intersect                     |

Merge preference order when Aggregate green: **docs ledger → mobile → admin-console → auth/website/registration → web-dashboard**.

---

## Merged waves already on tip (do not redo)

| Wave | PR   | Theme closed (scope of that PR)                                                                        | Tip disposition for theme                                  |
| ---- | ---- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| W1   | #393 | `ConfirmActionDialog` on fees/scholarships/exams/gradebook/admissions/parent consents/offers/campaigns | `PARTIAL` — more confirms remain                           |
| W2   | #395 | Raw UUID primary labels → `resolveEntityLabel` / name maps                                             | `PARTIAL`                                                  |
| W3   | #399 | Free-text UUID → `EntitySearchSelect` where directories load                                           | `PARTIAL`                                                  |
| W4   | #397 | Inert / dead controls wired or removed                                                                 | `FULLY_CLOSED` for listed highs                            |
| W5   | #398 | Scaffold / API-path / SQL-path user-visible copy                                                       | `PARTIAL` — honesty banners stay where feature unreal      |
| W6   | #400 | `(student)/loading.tsx` + `error.tsx` + route-state test                                               | `FULLY_CLOSED` for student boundary                        |
| W7   | #402 | Colour-only status → text/icon labels (admin timeline, transfers, heatmap, exam status)                | `PARTIAL` — residuals remain                               |
| W8   | #403 | Residual UUID-primary library/assessments/board/audit/workflows                                        | `PARTIAL`                                                  |
| W9   | #404 | Remaining destructive/money confirms (comms/fees/hostel/transport/reports/…)                           | `PARTIAL`                                                  |
| W10  | #405 | List failure ≠ empty (`fetchList` / `ListLoadFailure`); drift BASELINE 126→**118**                     | `PARTIAL`                                                  |
| W11  | #406 | Mobile profile identity + honest API-blocked actions                                                   | `PARTIAL` / `NEEDS_API`                                    |
| W12  | #407 | Public-website Privacy/Terms/Cookies visitor-facing last-reviewed                                      | `FULLY_CLOSED` for visitor banners; code comments residual |
| W13  | #408 | Leftover UUID-primary labels/inputs (hostel beds, timetable, exams new, …)                             | `PARTIAL`                                                  |

---

## Theme rollup (post W1–W13)

| id              | theme                                     | severity | disposition  | evidence                                                                                                                                                                            | next wave / owner                |
| --------------- | ----------------------------------------- | -------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| T-CONFIRM       | Confirm before money / irreversible       | high     | PARTIAL      | #393 #404; admin lifecycle still single-submit with reason only (`lifecycle-actions.tsx`)                                                                                           | Admin + Web residual             |
| T-UUID-LABEL    | Raw / truncated UUID as primary label     | high     | PARTIAL      | #395 #403 #408; tip still has `slice(0,8)` on admissions waitlist, transport attendance, timetable substitutions, attendance report filters (#386 owns attendance), audit secondary | Web residual (skip #386 paths)   |
| T-UUID-PICKER   | UUID paste inputs vs searchable pickers   | high     | PARTIAL      | #399 #403 #408; tip leftovers: fees structures/netting/dunning Invoice UUID, hostel mess Student UUID, admissions interview Institution UUID, campaign Hostel/Route UUID            | Web residual                     |
| T-INERT         | Dead / inert primary controls             | high     | FULLY_CLOSED | #397 listed surfaces                                                                                                                                                                | —                                |
| T-SCAFFOLD      | Scaffold / API / SQL developer copy in UI | med–high | PARTIAL      | #398; honesty banners retained by design until feature real                                                                                                                         | Auth/Public + Web (honesty only) |
| T-ROUTE-STATE   | Loading / error route boundaries          | high     | FULLY_CLOSED | #400 student + prior parent                                                                                                                                                         | —                                |
| T-COLOUR        | Colour-only / unclear status              | high     | PARTIAL      | #402; tip progress bars / enum pills still colour-coded; admin largely uses `StatusBadge` post-W7                                                                                   | Admin (residual) + Web residual  |
| T-EMPTY-ERR     | Failure collapsed to empty list           | high     | PARTIAL      | #405; `list-result.drift.test.ts` **BASELINE=118** remaining collapses                                                                                                              | Web residual (incremental)       |
| T-MOBILE-HONEST | Mobile fake identity / false save claims  | high     | PARTIAL      | #406                                                                                                                                                                                | Mobile worker                    |
| T-MOBILE-API    | Mobile features blocked on missing APIs   | high     | NEEDS_API    | #406 scholarship upload + notif cloud sync; home tiles omit `studentId` query                                                                                                       | Mobile W17–W20                   |
| T-WWW-LEGAL     | Public legal operator-launch banners      | high     | FULLY_CLOSED | #407 visitor banners; JSDoc still says “before public launch” (non-user)                                                                                                            | Auth/Public polish optional      |
| T-ATTENDANCE    | Attendance module UX                      | high     | DEFERRED     | Open #386 owns module                                                                                                                                                               | Skip until #386 merges           |
| T-GATEWAY       | institutionId query injection on writes   | high     | DEFERRED     | Open #401                                                                                                                                                                           | Skip                             |
| T-PRODUCT       | Cross-institution nav / reference lookups | product  | DEFERRED     | #394 brief; #387/#388 open                                                                                                                                                          | Product — not UI gap lane        |

---

## Finding rows (tip residual + closed evidence)

Columns: **id/route** · **theme** · **severity** · **disposition** · **evidence** · **next wave**

### Closed / largely closed on tip

| id/route                                                                                                                                                   | theme         | severity | disposition  | evidence                   | next wave                       |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | -------- | ------------ | -------------------------- | ------------------------------- |
| staff+parent fees pay/refund                                                                                                                               | confirm       | high     | FULLY_CLOSED | #393 `ConfirmActionDialog` | —                               |
| scholarships approve/reject/retry                                                                                                                          | confirm       | high     | FULLY_CLOSED | #393                       | —                               |
| exam publish / gradebook approve-lock-publish                                                                                                              | confirm       | high     | FULLY_CLOSED | #393                       | —                               |
| admissions offer send/accept/decline                                                                                                                       | confirm       | high     | FULLY_CLOSED | #393                       | —                               |
| parent consents + offer accept                                                                                                                             | confirm       | high     | FULLY_CLOSED | #393                       | —                               |
| campaign sandbox send                                                                                                                                      | confirm       | high     | FULLY_CLOSED | #393                       | —                               |
| circular ack / emergency blast / dunning / bulk invoice / leave / stop remove / report schedule delete / program close / notif-rule delete / period delete | confirm       | high     | FULLY_CLOSED | #404                       | —                               |
| parent+staff list UUID primary labels (fees/health/hostel/transport/exam/staff/scholarship)                                                                | uuid-label    | high     | FULLY_CLOSED | #395                       | —                               |
| W3 picker forms (fees/hostel/health/staff/transport/exam)                                                                                                  | uuid-picker   | high     | FULLY_CLOSED | #399                       | —                               |
| scholarships Edit; health screening CTA; MFA resend; remove inert More                                                                                     | inert         | high     | FULLY_CLOSED | #397                       | —                               |
| hostel/transport/institutions/gradebook/parent fees scaffold copy                                                                                          | scaffold      | med      | FULLY_CLOSED | #398 listed                | —                               |
| `(student)` loading/error boundaries                                                                                                                       | route-state   | high     | FULLY_CLOSED | #400                       | —                               |
| admin recent actions StatusBadge; institution activity pills; transfer steppers; attendance heatmap a11y; exam status humanize                             | colour        | high     | FULLY_CLOSED | #402                       | —                               |
| library/assessments/board/audit/workflows UUID primary                                                                                                     | uuid-label    | high     | FULLY_CLOSED | #403                       | —                               |
| library/campaigns/health special-needs+counselling empty≠error                                                                                             | empty-err     | high     | FULLY_CLOSED | #405                       | —                               |
| mobile profile displayName/email; scholarship upload honesty; notif snackbar honesty; parent messages no API path                                          | mobile-honest | high     | FULLY_CLOSED | #406 UI honesty            | NEEDS_API for real upload/cloud |
| `/privacy` `/terms` `/cookies` last-reviewed banners                                                                                                       | www-legal     | high     | FULLY_CLOSED | #407                       | —                               |
| hostel bed empty; timetable meeting empty; exam new offline; admissions merit placeholder; various job labels                                              | uuid-label    | high     | FULLY_CLOSED | #408 listed                | —                               |

### OPEN / PARTIAL — UI-closeable (worker lanes)

| id/route                                                                      | theme       | severity | disposition      | evidence                                                                                             | next wave                    |
| ----------------------------------------------------------------------------- | ----------- | -------- | ---------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------- |
| `admin-console` tenants lifecycle decommission/offboard                       | confirm     | high     | OPEN             | `lifecycle-actions.tsx` — reason required but no second-step confirm dialog                          | Admin                        |
| `admin-console` break-glass approve/deny/revoke                               | confirm     | med      | PARTIAL          | Dialog+reason exists (`approval-actions.tsx`); verify copy/a11y vs web `ConfirmActionDialog` pattern | Admin                        |
| `admin-console` UUID filter fields / tenant pickers residual                  | uuid-picker | med      | OPEN             | Tip scan — StatusBadge OK; filter inputs may still take raw ids                                      | Admin                        |
| `admin-console` colour-only residuals beyond W7 home timeline                 | colour      | med      | PARTIAL          | W7 closed home timeline; scan for remaining dots without text                                        | Admin                        |
| `fees/_components/structures-workspace.tsx` Class/Grade/Student UUIDs         | uuid-picker | high     | OPEN             | tip labels `Class UUID`, `Student UUIDs (comma-separated)`                                           | Web residual                 |
| `fees/_components/scholarship-netting-form.tsx` Student/Invoice UUID          | uuid-picker | high     | OPEN             | tip                                                                                                  | Web residual                 |
| `fees/_components/dunning-console.tsx` Invoice UUID                           | uuid-picker | med      | OPEN             | tip                                                                                                  | Web residual                 |
| `hostel/_components/mess-ops-forms.tsx` Student UUID                          | uuid-picker | high     | OPEN             | tip                                                                                                  | Web residual                 |
| `admissions/_components/new-interview-slot-form.tsx` Institution UUID         | uuid-picker | high     | OPEN             | tip                                                                                                  | Web residual                 |
| `communication/_components/new-campaign-form.tsx` Hostel/Route UUID           | uuid-picker | med      | OPEN             | tip                                                                                                  | Web residual                 |
| `admissions/page.tsx` waitlist `applicationId.slice(0,8)`                     | uuid-label  | med      | OPEN             | tip                                                                                                  | Web residual                 |
| `transport/_components/attendance-panel.tsx` student/route truncations        | uuid-label  | med      | OPEN             | tip                                                                                                  | Web residual                 |
| `institutions/.../timetable/substitutions/page.tsx` staff/meeting truncations | uuid-label  | med      | OPEN             | tip                                                                                                  | Web residual                 |
| `fees/.../reconciliation-workspace.tsx` batch/invoice truncations             | uuid-label  | low–med  | OPEN             | tip secondary lines                                                                                  | Web residual W16             |
| curriculum / institutions progress bars colour-only                           | colour      | med      | PARTIAL          | `curriculum-panel.tsx`, `institutions/page.tsx` muted bars                                           | Web residual                 |
| SCREAMING_SNAKE / raw enum status pills residual                              | colour      | med      | PARTIAL          | e.g. scholarship review uses `replace(/_/g,' ')`; others may not                                     | Web residual                 |
| list collapse BASELINE **118**                                                | empty-err   | high     | PARTIAL          | `list-result.drift.test.ts`                                                                          | Web residual (batch convert) |
| destructive actions missed by W9 (if any tip scan finds)                      | confirm     | med      | OPEN             | Re-audit non-attendance dashboard mutations without `ConfirmActionDialog`                            | Web residual                 |
| `attendance/**` report UUID columns / colour                                  | uuid/colour | high     | DEFERRED         | #386 open                                                                                            | Skip                         |
| `(auth)` MFA/oauth/reset residual UX                                          | auth        | med      | OPEN             | Auth/Public lane                                                                                     | Auth/Public                  |
| registration track `?dob=` in URL                                             | privacy     | high     | OPEN             | `track/[trackingNumber]/page.tsx` reads DOB from searchParams                                        | Auth/Public                  |
| registration i18n completeness residual                                       | i18n        | med      | OPEN             | Auth/Public lane                                                                                     | Auth/Public                  |
| public-website JSDoc / compliance operator copy residual                      | scaffold    | low      | PARTIAL          | User banners closed #407; comments still operator-facing                                             | Auth/Public optional         |
| mobile home tiles → `/assessments` etc. without `studentId`                   | mobile      | high     | OPEN             | `home_screen.dart` routes vs router `queryParameters['studentId']`                                   | Mobile W17                   |
| mobile parent children selector                                               | mobile      | high     | OPEN / NEEDS_API | Wire to existing parent-portal APIs if present                                                       | Mobile W18                   |
| mobile parent messages/fees                                                   | mobile      | high     | OPEN / NEEDS_API | Existing APIs only; honest empty if missing                                                          | Mobile W18                   |
| mobile attendance pickers/submit                                              | mobile      | med      | DEFERRED         | Skip while #386 owns attendance story                                                                | Mobile W19 skip              |
| mobile profile language/theme routes / prefs                                  | mobile      | med      | OPEN / NEEDS_API | Persist only if prefs API exists; else honesty                                                       | Mobile W20                   |

### NEEDS_API / product (not UI-only)

| id/route                                           | theme      | severity | disposition         | evidence                        | next wave                 |
| -------------------------------------------------- | ---------- | -------- | ------------------- | ------------------------------- | ------------------------- |
| mobile scholarship document upload                 | mobile-api | high     | NEEDS_API           | #406 disabled + honesty         | Product / API then Mobile |
| mobile notification cloud sync                     | mobile-api | med      | NEEDS_API           | #406 device-local honesty       | API then Mobile           |
| mobile / web parent child display names enrichment | uuid-label | med      | NEEDS_API / PARTIAL | W2 fallbacks; SIS name fields   | API                       |
| fees dues-by-class class name                      | uuid-label | med      | NEEDS_API           | #408 note — label softened only | API                       |
| mobile profile cloud write                         | mobile-api | med      | NEEDS_API           | #406 device-local               | API                       |
| live PSP / WhatsApp / Open Library / GPS           | scaffold   | —        | DEFERRED            | External / sandbox              | Release-ops honesty       |
| cross-institution curriculum rollup                | product    | —        | DEFERRED            | #394                            | Product decision          |

---

## Buckets for workers (Phase 1+)

### UI-closeable OPEN/PARTIAL highs (ship next)

1. **Admin** — decommission/offboard confirm; residual colour/UUID filters.
2. **Web residual** — fees/hostel/admissions/comms UUID inputs; truncated primary labels outside attendance; colour/enum leftovers; empty≠error BASELINE ratchet.
3. **Auth/Public** — DOB-in-URL; MFA/oauth/reset; registration i18n.
4. **Mobile** — pass `studentId` from home tiles; parent selector + messages/fees against existing APIs; profile routes honesty.

### NEEDS_API (continue only with thin client wiring to existing routes)

- Mobile W17–W20 as session allows; no new domains.

### Product build / deferred

- Attendance (#386), gateway (#401), cross-institution product (#394/#387/#388), live providers.

---

## Count honesty (do not inflate)

| Claim                              | Status                                                                                          |
| ---------------------------------- | ----------------------------------------------------------------------------------------------- |
| “All ~304 FULLY_CLOSED”            | **Forbidden** — source file absent; tip residuals prove otherwise                               |
| High UI-closeable themes exhausted | **False** until Admin + Web residual + Auth/Public + Mobile OPEN rows above clear               |
| W1–W13 themes                      | Mostly **PARTIAL** with listed FULLY_CLOSED sub-surfaces                                        |
| This ledger                        | Phase 0 reconstruction; workers must update dispositions with PR# + file:line when closing rows |

---

## Orchestrator changelog

| UTC               | Event                                                             |
| ----------------- | ----------------------------------------------------------------- |
| 2026-09-26T12:43Z | Phase 0 ledger created at tip `e04de049`; worker PRs not yet open |
| _(append)_        | Worker PR opened / Aggregate / squash-merge / disposition updates |
