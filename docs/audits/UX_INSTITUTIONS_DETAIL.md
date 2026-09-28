# Enterprise UX design review

**Module:** Institutions detail  
**Date (UTC):** 2026-09-28  
**Captures viewed:** `docs/audits/captures/institutions-detail/*-desktop-prototype-vs-live.png` and the mobile pairs (prototype left, live right).

## 0. Inventory

| Screen | Prototype | Live |
| ------ | --------- | ---- |
| Overview | `detail-overview.html` | `/institutions/:id/overview` |
| Classes | `detail-classes.html` | `/institutions/:id/classes` |
| Grades | `detail-grades.html` | `/institutions/:id/grades` |
| Schedule | `detail-schedule.html` | `/institutions/:id/schedule` |
| Section | `detail-schedule-section.html` | `/institutions/:id/schedule/:sectionId` |

Review-only controls (screen-state chips, UX review button) are removed from prototype captures and are absent from the app (Playwright asserts count 0).

## 1. Rubric scores (1–10)

Not scored. A numeric 10 is not claimed from these captures.

## 2. Findings

| Area | Prototype | Live | Fix | Disposition |
| ---- | --------- | ---- | --- | ----------- |
| Layout | Hero, tabs, KPI grid, two-column facts | Same regions inside the staff shell | Hero medium from overview facts | **PARTIAL** — shell chrome and real row counts differ from the static sample |
| Typography / colour | Prototype tokens | App primary, emerald/amber pills | Existing design system, not a second token file | **PARTIAL** |
| Components | Chips, tables, status pills | Same roles: chips, tables, Published/Draft pills, confirm dialogs | Sections count and meetings count added | **PARTIAL** |
| Copy | Sample activity and class names | Seeded Sunrise copy, including "Term 2 timetable published" | No prototype review copy shipped | **PARTIAL** |
| Data | Illustrative 12 even grades, 8 class rows | Live aggregates (students 1,240, staff 84, attendance 94%, rooms 46; Grade 8 holds most enrollments) | Overview API | **FULLY_CLOSED** as honest data; visual bars will not match the sample |
| Functionality | Assign, roster, publish, withdraw, report | Wired to APIs; report route; confirm on withdraw and unpublish | e2e 16d | **FULLY_CLOSED** on the exercised path |
| States | Filled / empty / loading / error chips | Real empty, loading, and error UI | Chips not shipped | **FULLY_CLOSED** |
| A11y | Prototype labels | Headings, table headers, button names, dialog | No axe run this session | **PARTIAL** |
| Security | n/a in prototype | Tenant 404 / parent 403 on overview | Gateway tests | **FULLY_CLOSED** for that route |

## 3. Decisions / changes landed

- Second grades column is **View**, not a second "Sections" header. The prototype duplicated the header; the link is "View sections".
- Grade 8 utilization above 100% is the seed (most generated students are Grade 8), not a colour bug.
- Breadcrumb institution id resolves client-side; the section UUID segment still shortens to `00000000…` until that fetch pattern is extended. Disposition for that crumb: **OPEN**.

## 4. Sign-off

UX reviewed against the captures above. Not a production-ready design sign-off.
