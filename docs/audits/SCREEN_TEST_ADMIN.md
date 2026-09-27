# Admin — screen-by-screen test (Sunrise demo tenant)

**Branch:** `cursor/screen-test-workflows-admin-c645`  
**Date (UTC):** 2026-09-27  
**Tenant:** `00000000-0000-4000-8000-00000000a501` (`sunrise-public-school`)  
**Seed:** tenant row name Sunrise Public School, slug `sunrise-public-school`. No directory users and no notification rules. Built-in roles come from the tenant admin service.  
**Session:** HS256 staff cookie, role `SUPER_ADMIN`, subject `neha.verma`.  
**Stack:** Postgres 16, api-gateway `:3000`, Next.js dev `:3001`.

This is the web `/admin` console, not `apps/admin-console`. It is not a production-ready or 10/10 claim. No user was invited, no role was created, and tenant settings were not saved.

## Aggregate

| Result  | Count |
| ------- | ----: |
| PASS    |     6 |
| FAIL    |     0 |
| BLOCKED |     0 |
| SKIPPED |     0 |

## Route table

| Route                       | Primary action                   | Result   | What the screen showed                                                                                                                                                                                                                                                                                 |
| --------------------------- | -------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/admin`                    | Open the console                 | **PASS** | Cards for Users, Roles, Permissions, Tenant, plus Billing, Audit logs, and Tenant lifecycle. The forced “ops stub / UI scaffold” banner is gone while `GET /tenant/settings` is live.                                                                                                                  |
| `/admin/users`              | List users                       | **PASS** | Honest empty: “0 accounts (0 active)” and “No users yet. Invite your first teammate.” Invite was not submitted. The seed does not create directory users.                                                                                                                                              |
| `/admin/roles`              | List roles                       | **PASS** | Named built-ins: Administrator, Guardian, Principal, Staff, Super Administrator, Teacher, each with a permission count.                                                                                                                                                                                |
| `/admin/permissions`        | List permissions                 | **PASS** | “22 granular permissions” with role names in the Granted by column (Administrator, Principal, Teacher, Guardian, Staff, Super Administrator).                                                                                                                                                          |
| `/admin/tenant`             | See slug `sunrise-public-school` | **PASS** | Identity line **Sunrise Public School · sunrise-public-school**. Copy states settings have not been saved, so the form still shows product defaults (`ProctiraERP`, locale `en`, timezone `UTC`) until save. The raw tenant id and the 1 Jan 1970 “last saved” stamp are not shown. Nothing was saved. |
| `/admin/notification-rules` | List rules                       | **PASS** | Honest empty: “No rules yet. Create your first event-driven delivery rule.” New rule was not submitted.                                                                                                                                                                                                |

## UX fixes in this walk

- Admin home no longer calls itself an ops stub when the school admin API responds.
- Tenant identity shows the directory name and slug. Unsaved epoch timestamps are not labeled as a save time.
- `GET/PUT /tenant/settings` now includes `directoryName` and `slug` from the tenants row under the signed-in tenant.

## Residual

- Saving tenant settings, inviting a user, and creating a notification rule were not submitted.
- `GET /api/v1/tenants/:id` still returns 403 for this staff session (platform administrator). The slug on this screen comes from the settings payload, not that route.
- Billing, audit logs, and tenant lifecycle are linked from the hub and were not walked here.
