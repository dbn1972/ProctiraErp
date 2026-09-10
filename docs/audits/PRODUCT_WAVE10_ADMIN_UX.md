# Enterprise product / IA — Wave 10 (admin + parent UX)

**Module / slice:** Notifications prefs & rules, role-aware home dashboard, batch-3 UX backlog  
**Branch / tip:** `cursor/enterprise-score-uplift-56c3`  
**Date (UTC):** 2026-09-10  
**Owner / agent:** Cursor cloud agent (Wave 10)

---

## 1. Capability statement

Staff and guardians can manage notification delivery preferences from a first-class dashboard route, tenant administrators can create and maintain event-driven notification rules without calling the API directly, and every signed-in user sees a role-appropriate snapshot on the home dashboard with a path into full role dashboards. Residual Wave 9 UX items (UUID breadcrumbs, timetable prerequisite links) are closed so operators are not lost in empty states.

## 2. Personas & jobs

| Persona                      | Job-to-be-done                                    | Success looks like                                                |
| ---------------------------- | ------------------------------------------------- | ----------------------------------------------------------------- |
| Any staff user               | Tune email/push/SMS/quiet hours                   | `/notifications/preferences` loads, saves round-trip              |
| Tenant admin                 | Configure alert rules for entity events           | Rules list + create/toggle/delete on `/admin/notification-rules`  |
| Principal / teacher / parent | See relevant KPIs on login                        | Home dashboard section matches role; link to `/reports/dashboard` |
| Timetable operator           | Know what to configure when generation is blocked | Empty states link to academic periods and bell schedules          |

## 3. Scope

| In scope                                                              | Non-goals                                             |
| --------------------------------------------------------------------- | ----------------------------------------------------- |
| G-1001 `/notifications/preferences` route; fix inbox broken link      | Mobile Flutter prefs parity (separate slice)          |
| G-1002 Rules CRUD UI wired to `/notifications/rules` + templates list | Visual rule builder / drag-drop conditions            |
| G-1003 Role-aware home section using existing `getRoleDashboard`      | Custom per-user widget layout editor                  |
| G-1004 B3-004/005/011 breadcrumb UUID shorten + timetable deep links  | B3-006 entity search pickers; B3-007 map label polish |

## 4. Peer parity

| Peer capability                          | Our target this slice                        |
| ---------------------------------------- | -------------------------------------------- |
| PowerSchool alert subscriptions          | Per-channel category prefs page              |
| Infinite Campus notification rules admin | List + create + active toggle + delete       |
| Parent portal home widgets               | Role dashboard cards on home for parent role |

## 5. Surface map

| Nav label          | Route                        | API                                                         | Tables / events                                | Shell          |
| ------------------ | ---------------------------- | ----------------------------------------------------------- | ---------------------------------------------- | -------------- |
| Preferences        | `/notifications/preferences` | GET/PATCH `/notifications/preferences`                      | `notification_preferences`                     | staff          |
| Notification rules | `/admin/notification-rules`  | CRUD `/notifications/rules`, GET `/notifications/templates` | `notification_rules`, `notification_templates` | staff admin    |
| Home role snapshot | `/`                          | GET `/reports/dashboard?role=`                              | reports scaffold                               | staff / parent |
| Academic periods   | `/academic-periods`          | institution APIs                                            | Prisma periods                                 | staff          |

## 6. Roles & tenancy

| Role                   | Can                                | Cannot                           |
| ---------------------- | ---------------------------------- | -------------------------------- |
| Any authenticated user | Edit own notification preferences  | Edit another user's prefs        |
| Tenant admin           | CRUD notification rules for tenant | See other tenants' rules         |
| Parent                 | See parent dashboard cards on home | Load principal dashboard widgets |
| Teacher / principal    | See matching role dashboard cards  | Cross-tenant dashboard data      |

Tenant boundary: all gateway calls use JWT `tenantId`; prefs keyed by `(tenantId, userId)`.

## 7. Success metrics / DoD

- [ ] Inbox "Preferences" link resolves (no 404)
- [ ] Admin can create a rule and see it in the list
- [ ] Home page renders role dashboard cards when gateway is live
- [ ] Breadcrumbs shorten UUID segments; timetable empty states include setup links
- [ ] Page matrix covers new `/notifications/preferences` route
- [ ] Smoke e2e includes preferences route

## 8. Handoff

| Next skill | Audit path                                          |
| ---------- | --------------------------------------------------- |
| Build      | this PR (`G-1001`–`G-1004`)                         |
| UX         | extend `WAVE9_BATCH3_UX_REVIEW.md` residual closure |
| Security   | tenant-scoped rules + prefs (existing gateway RBAC) |
| Test       | `WAVE10_GAP_CLOSURE_TEST_EVIDENCE.md` (optional)    |
