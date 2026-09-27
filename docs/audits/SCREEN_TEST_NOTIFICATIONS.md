# Notifications — screen-by-screen test (Sunrise demo tenant)

**Branch:** `cursor/screen-test-academic-ops-c645`  
**Date (UTC):** 2026-09-27  
**Tenant:** `00000000-0000-4000-8000-00000000a501` (`sunrise-public-school`)  
**Seed:** no in-app notification rows for subject `neha.verma`.  
**Session:** HS256 staff cookie, role `SUPER_ADMIN`, subject `neha.verma`.  
**Stack:** Postgres 16, api-gateway `:3000`, Next.js dev `:3001`.

`GET /api/v1/notifications/preferences` returned **200** with category channel defaults (email, in-app, and push on; webhook and SMS off) for academic, attendance, examination, workflow, and system.

This is a route walk. It is not a production-ready or 10/10 claim. Preferences were not saved.

## Aggregate

| Result  | Count |
| ------- | ----: |
| PASS    |     2 |
| FAIL    |     0 |
| BLOCKED |     0 |
| SKIPPED |     0 |

## Route table

| Route                        | Primary action        | Result   | What the screen showed                                                                                                                                                                                                               |
| ---------------------------- | --------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/notifications`             | List notifications    | **PASS** | Heading “Notifications”. Honest empty: “No notifications yet.” Links to Preferences and Notification rules.                                                                                                                          |
| `/notifications/preferences` | Read channel settings | **PASS** | Heading “Notification preferences”. Gateway `GET /notifications/preferences` is 200 with the five categories and channel flags above. The page renders that client form after hydration (loading skeleton first). Nothing was saved. |

## UX fixes in this walk

None. Empty inbox copy and the preferences loader already name the channels. No raw UUID, inert control, or scaffold banner on these two routes.

## Residual

- Device registration for push was not exercised.
- Admin notification rules live under `/admin/notification-rules` and are recorded in the admin walk.
