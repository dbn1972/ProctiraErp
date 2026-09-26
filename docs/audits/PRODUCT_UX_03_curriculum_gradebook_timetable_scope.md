# UX-3 — Curriculum / gradebook / timetable cross-institution navigation: scope brief

Source task: `docs/audits/GAP_CLOSURE_TASKLIST_20260925.md`, task UX-3. This is a decision brief only — no implementation. Per the tasklist's own instruction, do not build anything speculative from this; it exists to give the user (or whoever owns the go/no-go) enough to decide whether a follow-up implementation task should exist at all, and if so, roughly how big it is.

## What exists today

Curriculum, gradebook, and timetable each have a working per-institution page nested under `apps/web/src/app/(dashboard)/institutions/[id]/{curriculum,gradebook,timetable}/page.tsx`. These are not thin stubs — curriculum takes subject/grade/period filters and shows syllabus units with lesson plans and coverage %; gradebook scopes to a section and drives grade entry, approval/lock/publish, GPA, and report-card generation; timetable auto-resolves the active academic period and shows the institution's full weekly meeting grid. A staff member who knows which institution they want is well served by these pages.

There is no institution switcher. Getting from "I want institution B's curriculum" to that page today means: open the generic `/institutions` list (paginated, 20 per page, built for admin browsing), find and click the school, land on its Overview tab, then navigate to Curriculum. Repeat per school. This is a real, tedious workflow for anyone who has to check more than one or two institutions in a sitting — it is not a strawman.

Whether that workflow is a real problem depends entirely on who has to do it, which is the crux of this brief.

## Who would actually need a cross-institution view

The data model genuinely supports one staff member holding active assignments at multiple institutions at once — this is not hypothetical. `packages/backend/auth/src/institution-assignments.ts` resolves a user's `institutions` JWT claim from `staff_assignments` joined to date-bounded, status-active rows, and the code's own doc comment names the exact scenario: a headmaster running a second school as an "additional charge," which expires automatically when the assignment's `end_date` passes. This is tested (`pg-institution-assignments.live.test.ts` asserts a principal with two active assignments resolves both institution IDs).

But here is the part worth being precise about, because it changes what the "fix" should even look like: for that exact persona, the gateway's `decideInstitutionScope` does not return cross-institution data when `institutionId` is omitted — it auto-injects just their primary institution (`allowed[0]`). So a two-school headmaster calling any of these APIs today, without explicitly specifying which school on every request, silently only ever sees one of their two schools. That is arguably a sharper, more urgent gap than "there's no dashboard for it" — it means the multi-institution persona this feature would be for doesn't get correct default behavior from the APIs the feature would call, regardless of whether a UI exists.

Two other roles were checked and don't have this problem the same way: board/tenant admins are exempt from institution scoping entirely (any call without `institutionId` already returns tenant-wide results at the service layer, since `institutionId` is an optional filter, not a required one, in curriculum/gradebook/timetable's list endpoints and repositories) — so an admin persona already has what they need from existing APIs today, modulo UI. A single-institution staffer has nothing to gain from a cross-institution view by definition.

## What a top-level view would need to show

Assuming the target persona is the multi-institution staff member (not admins, who are closer to already-served, and not single-institution staff, who don't need this):

- A landing surface listing only the institutions that user has active access to right now (their `institutions` claim), not a generic paginated admin browser of every institution in the tenant.
- For curriculum: probably a per-institution summary (coverage % per institution, maybe flagged if a school is behind), not a merged cross-institution unit list — units are naturally institution-specific (different subjects/grades/periods per school), so "all my curriculum in one flat list" is less useful than "here's where each of my schools stands, pick one to go deeper."
- For gradebook: similar — likely a cross-institution status board (which sections need entries approved/locked/published across all my schools this term), since the actual data-entry work still has to happen per-section.
- For timetable: least obviously useful as a merged view — a weekly grid naturally belongs to one institution's schedule; a cross-institution timetable page would probably be a status list ("today's substitution gaps across my schools") rather than a real merged grid.

In all three cases, the more valuable shape looks like a status/triage rollup across the user's own institutions, not a literal merge of each per-institution page's existing table into one giant table.

## Do the existing per-institution pages already satisfy the need?

For single-institution staff: yes, adequately — there is nothing to gain from a cross-institution view. For admins: the curriculum/gradebook/timetable APIs themselves already return tenant-wide results when they omit `institutionId` (admins are exempt from the scope gate), so a UI for them is mostly a rendering exercise, not a new backend capability. Separately, admins also already have one kind of purpose-built cross-institution view today — the `/reports` board-rollup panel — though it is a different endpoint (board-scoped enrolment/attendance/fees/LMS aggregates), not curriculum/gradebook/timetable data (see precedent below).

For the multi-institution staff persona specifically: no. Not because the per-institution pages are bad, but because there is currently no way for that persona to see "status across the schools I actually cover" without manually repeating the full list → click → overview → tab navigation once per school, and even the underlying APIs default them to only one school if they don't think to pass an explicit `institutionId` on every call. This is a real, named-in-code, tested persona with a real gap, not a manufactured one.

## Precedent to build from, and its limits

`apps/web/src/app/(dashboard)/reports` already has one genuinely cross-institution view: a board summary panel that aggregates enrolment/attendance/fees/LMS-completion across every institution under a board, with a per-school breakdown. It's a reasonable structural pattern (resolve a set of institution IDs the caller is entitled to, aggregate/list across them) but it has two limits worth knowing before treating it as a template: it's driven by manual board-ID text entry rather than a picker, and its per-school breakdown carries only name/enrolment, not the other aggregated metrics — so even this precedent doesn't yet show "compare school A vs school B" in one glance.

## Rough size if this is wanted

Backend: for curriculum and gradebook, the list endpoints already accept an optional `institutionId` and already return tenant-wide-if-omitted at the repository layer — the missing piece is a gateway-level allowance for the multi-institution-staff role to legitimately query "all institutions I'm assigned to" in one call (today only board/tenant admins get that by virtue of being exempt from scoping). That's a scoping-logic change in `decideInstitutionScope` plus a small new query mode, not a new subsystem. Timetable has two endpoints (conflicts, attendance-periods) that hard-require `institutionId` and would stay per-institution regardless.

Frontend: one new top-level page per module (or one shared "my institutions" landing page with three tabs) plus whatever new aggregation queries the backend change above unlocks. Given the existing per-institution pages already have the underlying data-fetching and rendering logic, this leans toward "assemble a rollup view from data already fetchable per institution, once per school in the user's assignment set, and merge client-side" as the cheapest version — no new persistence, a modest new gateway-permission path, and three new (or one shared, three-tab) page components.

Overall: this reads as a small-to-medium, well-bounded feature, not a rearchitecture — but it is not zero, and it specifically only pays off for the multi-institution staff persona, so the go/no-go really hinges on how common that persona is in the customer base this product targets, which is a product-market question, not something in this repository to answer.

## Recommendation

Do not build this speculatively. Two things worth deciding first, in order:
1. Is the multi-institution "additional charge" persona (the one the auth layer already names and tests) common enough among target customers to justify a dedicated rollup view, or is it a rare enough edge case that "browse per-institution" is an acceptable, if mildly tedious, workflow for it?
2. Independent of (1): the `decideInstitutionScope` default-to-primary-only behavior for that persona is arguably a small correctness gap worth fixing on its own even without a new UI — a two-school headmaster silently defaulting to seeing only one school's data on any call that omits `institutionId` is a plausible source of quiet confusion today, separate from whether a dedicated cross-institution page ever gets built.

This brief does not recommend a go/no-go on the larger UI feature — that's the product decision to escalate. It does flag (2) above as worth a maintainer's attention regardless of that decision, since it's a narrower, cheaper fix with its own independent justification.
