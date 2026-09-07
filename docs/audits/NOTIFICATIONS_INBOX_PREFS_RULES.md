# Enterprise production-ready — Notifications inbox / prefs / rules

**Module:** Notifications  
**Branch / tip:** `cursor/enterprise-score-uplift-56c3` @ `638e3fb+`  
**Date (UTC):** 2026-09-07  
**Paired build audit:** `docs/audits/DEV_NOTIFICATIONS_INBOX_PREFS.md`

## Scope

| Screen | Route                         |
| ------ | ----------------------------- |
| Inbox  | `/notifications`              |
| Rules  | `/admin/notification-rules`   |
| Prefs  | `/app/settings/notifications` |

## Evidence (in progress)

| Pillar           | Status | Evidence                                                                            |
| ---------------- | ------ | ----------------------------------------------------------------------------------- |
| Inventory smoke  | ☑      | `e2e/20-notifications-transport-inventory-smoke.spec.ts` (local 7/7 with transport) |
| UX route lists   | ☑      | dark/touch/a11y/capture include `/notifications`                                    |
| Multidevice PNGs | ☑      | `/opt/cursor/artifacts/campus-audit/notifications/` + `summary.json`                |
| Live write prefs | ☐      | gated                                                                               |
| Tip CI           | ☐      | GitHub spending limit — jobs do not start                                           |
| Security         | ☐      | pending                                                                             |

## Waivers

- Tip CI green: blocked by account billing/spending limit (annotation on Detect Affected Modules).
- Live IdP / device-farm: program-wide external.
