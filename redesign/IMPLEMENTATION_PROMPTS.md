# Claude Code Prompts — Implement the v2.0 Redesign, Screen by Screen

How to use: start Claude Code at the repo root (`ProctiraERP/`). Paste the **Master Prompt** once at the start of every session. Then run one **Screen Prompt** at a time from the checklist below. Keep sessions to 3–5 screens so context stays sharp.

---

## 1. Master Prompt (paste once per session)

```
You are implementing an approved UI redesign for ProctiraERP. The pixel-accurate
reference mockups live in `redesign/` as plain HTML/CSS:

- Design tokens:       redesign/shared/tokens.css   (colors, type scale, radii, shadows, dark theme)
- Component library:   redesign/shared/app.css      (sidebar, topbar, cards, tables, pills, forms,
                                                     entity-picker, tabs, empty states, stepper,
                                                     timeline, responsive rules)
- Shell behavior:      redesign/shared/app.js       (nav structure, command palette, mobile drawer)
- Browsable gallery:   redesign/index.html

The code targets:
- Web app:             apps/web        (Next.js App Router, Tailwind + shadcn/ui, tokens already
                                        migrated into src/styles/globals.css — indigo primary,
                                        navy sidebar, radius 0.625rem)
- Admin console:       apps/admin-console
- Registration portal: apps/registration-portal
- Public website:      apps/public-website
- Mobile app:          apps/mobile     (Flutter; theme already migrated in
                                        lib/core/theme/app_theme.dart; mockups in redesign/mobile/)

NON-NEGOTIABLE RULES
1. Read the mockup HTML for the screen BEFORE touching code. Match its layout,
   spacing, hierarchy, states, and copy as closely as the component stack allows.
2. Presentation changes only, unless the mockup encodes a UX fix (e.g. entity
   pickers instead of raw UUID inputs — then wire real data via existing API
   clients in apps/web/src/lib/api/ and src/lib/institutions/api.ts).
3. Use the existing token layer (CSS variables in globals.css) and shadcn/ui
   components — never hard-code colors that exist as tokens.
4. Never break contracts: keep i18n keys, aria labels/roles, test selectors,
   server actions, and data fetching intact. Update co-located tests when a
   label legitimately changes.
5. No spec leakage in UI text (no "Requirement 9.7"-style strings), no raw
   UUIDs visible to users, no "--" placeholder values — use skeletons or
   "Currently unavailable".
6. Responsive: verify the screen at 1280px, 768px, and 390px. Tables must
   degrade gracefully; primary actions must remain reachable on mobile.
7. After each screen: run `npx tsc --noEmit` (zero NEW errors — there are 79
   pre-existing errors in untouched test files) and the screen's co-located
   vitest tests. If Playwright is set up, screenshot the route at all three
   widths and visually compare against the mockup.
8. Commit per screen with message: `feat(ui): redesign <route> to v2.0 spec`.

ALREADY DONE (do not redo): globals.css tokens, sidebar (navy + icons),
header (⌘K search), login hero fix, Flutter app_theme.dart, dashboard page,
attendance marking pickers, assessments results/items pickers, staff
assignment pickers, transfer form copy.
```

---

## 2. Screen Prompt Template (run once per screen)

```
Implement screen: <SCREEN NAME>

Mockup:  redesign/<path>.html        ← read this file fully first
Code:    apps/<app>/<route or file>  ← current implementation

Steps:
1. Read the mockup HTML and list every UI element, state (empty/loading/error/
   filled), and responsive behavior it defines.
2. Read the current code for the route, including its _components, actions,
   and co-located tests.
3. Produce the new UI with the existing component stack (shadcn/ui + Tailwind
   tokens). Map mockup classes to code as follows:
   .card→Card, .pill→Badge variants, .btn-primary→Button,
   .btn-secondary→Button variant="outline", .entity-picker→Select/Combobox fed
   by real API data, .table patterns→Table with avatar person-cells and icon
   row actions, .empty→empty-state block with icon + CTA, .kpi→stat card,
   .stepper→step indicator, .filter-bar→inline filter row (not a filter card).
4. Keep all data wiring, validation, autosave, and server actions working.
5. Verify: tsc, co-located tests, and the three viewport widths.
Report: what changed, what you intentionally deviated on (and why), test results.
```

---

## 3. Screen-wise Checklist (suggested order)

### Phase 1 — Web app: auth (mockup → code)
| # | Mockup | Code route |
|---|--------|-----------|
| 1 | redesign/web/auth-login.html | apps/web/src/app/(auth)/login/ ✅ hero done — finish form panel |
| 2 | redesign/web/auth-signup.html | apps/web/src/app/(auth)/signup/ |
| 3 | redesign/web/auth-forgot-password.html | apps/web/src/app/(auth)/forgot-password/ |
| 4 | redesign/web/auth-reset-password.html | apps/web/src/app/(auth)/reset-password/ |
| 5 | redesign/web/auth-mfa.html | apps/web/src/app/(auth)/mfa/ |

### Phase 2 — Web app: people
| 6 | redesign/web/students-list.html | apps/web/src/app/(dashboard)/students/page.tsx |
| 7 | redesign/web/students-detail.html | …/students/[id]/page.tsx |
| 8 | redesign/web/students-new.html | …/students/new/ (check _components/student-form.tsx) |
| 9 | redesign/web/students-detail-edit.html | …/students/[id]/edit equivalent |
| 10 | redesign/web/students-import.html | …/students/import/page.tsx |
| 11 | redesign/web/students-transfer.html | …/students/[id]/transfer/ |
| 12 | redesign/web/staff-list.html | …/staff/page.tsx |
| 13 | redesign/web/staff-detail.html | …/staff/[id]/page.tsx |
| 14 | redesign/web/staff-new.html | …/staff (staff-form.tsx) |
| 15 | redesign/web/staff-assignment-new.html | …/staff/[id]/assignments/new/ ✅ pickers done — finish layout |
| 16 | redesign/web/staff-appraisal-new.html | …/staff/[id]/appraisals/new/ |

### Phase 3 — Web app: academics
| 17 | redesign/web/institutions-list.html | …/institutions/page.tsx |
| 18 | redesign/web/institutions-detail.html (+detail-overview) | …/institutions/[id]/ |
| 19 | redesign/web/institutions-new.html | …/institutions/new/page.tsx |
| 20 | redesign/web/institutions-detail-edit.html | …/institutions/[id]/edit |
| 21 | redesign/web/institutions-classes.html | …/institutions/[id]/classes/page.tsx |
| 22 | redesign/web/institutions-grades.html | …/institutions/[id]/grades/page.tsx |
| 23 | redesign/web/institutions-infrastructure.html | …/institutions/[id]/infrastructure/page.tsx |
| 24 | redesign/web/academic-periods-list.html | …/academic-periods/page.tsx |
| 25 | redesign/web/attendance-mark.html | …/attendance/ ✅ pickers done — finish roster UI (toggle buttons, last-5-days strip, summary header) |
| 26 | redesign/web/attendance-reports.html | …/attendance/reports/page.tsx |
| 27 | redesign/web/assessments-list.html | …/assessments/page.tsx |
| 28 | redesign/web/assessments-items.html | …/assessments/items/ ✅ pickers done — finish layout |
| 29 | redesign/web/assessments-scheme-new.html (+scheme-edit) | …/assessments/schemes/ |
| 30 | redesign/web/assessments-results.html | …/assessments/results/ ✅ pickers done — finish grid UI |
| 31 | redesign/web/examinations-list.html | …/examinations/page.tsx |
| 32 | redesign/web/examinations-new.html | …/examinations/new/page.tsx |
| 33 | redesign/web/examinations-detail.html | …/examinations/[id]/page.tsx |
| 34 | redesign/web/examinations-candidates.html | …/examinations/[id]/candidates/ |
| 35 | redesign/web/examinations-documents.html | …/examinations/[id]/documents/ |
| 36 | redesign/web/examinations-results.html | …/examinations/[id]/results/ |

### Phase 4 — Web app: services & insights
| 37–42 | redesign/web/scholarships-*.html | …/scholarships/… |
| 43–46 | redesign/web/health-*.html | …/health/… |
| 47–51 | redesign/web/workflows-*.html | …/workflows/… |
| 52–54 | redesign/web/reports-*.html | …/reports/… |
| 55–57 | redesign/web/data-warehouse-*.html | …/data-warehouse/… |
| 58–62 | redesign/web/admin-*.html | …/admin/… |
| 63 | redesign/web/public-track.html | apps/web/src/app/(public)/track/ |
| 64 | redesign/web/dashboard-overview.html | …/(dashboard)/page.tsx ✅ KPIs done — add trend chart + approvals panel when APIs allow |

### Phase 5 — Portals
| 65–77 | redesign/admin-console/*.html | apps/admin-console |
| 78–84 | redesign/registration/*.html | apps/registration-portal |
| 85–96 | redesign/website/*.html | apps/public-website |
| 97 | redesign/developer-portal/home.html | apps/developer-portal |
| 98 | redesign/install-wizard/home.html | apps/install-wizard |

### Phase 6 — Flutter mobile (different template)
For each of redesign/mobile/*.html (23 screens) → apps/mobile/lib/features/…:

```
Implement Flutter screen: <NAME>
Mockup: redesign/mobile/<name>.html (phone-frame HTML — read fully)
Code:   apps/mobile/lib/features/<feature>/presentation/<name>_screen.dart
Rules: theme is already migrated (lib/core/theme/app_theme.dart — indigo/teal,
18px cards, 16px buttons). Match the mockup's layout/widgets: m-list→Card+ListTile,
m-kpi→stat tiles, m-att toggles→SegmentedButton, sync-pill/offline-banner→
existing sync state from core/sync, geo banner→attendance_geofence_widget.
Keep BLoC/repository wiring intact. Run `flutter analyze` after each screen.
```

---

## 4. Verification prompt (run at the end of each phase)

```
Audit the screens completed this session against their mockups:
1. For each route, compare DOM structure/spacing/states to the mockup HTML.
2. Sweep for regressions: grep for raw UUID labels, "--" values, spec-text
   leakage ("Requirement N"), hard-coded hex colors that exist as tokens.
3. Run npx tsc --noEmit (no NEW errors) and the affected vitest suites.
4. Check 1280/768/390 widths for overflow, unreachable actions, or
   bottom-nav overlap.
Produce a pass/fail table with file:line for every issue found, then fix fails.
```
