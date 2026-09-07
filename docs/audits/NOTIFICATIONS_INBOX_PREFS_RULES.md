# Enterprise production-ready — Notifications inbox / prefs / rules

**Module:** Notifications  
**Branch / tip:** `cursor/enterprise-score-uplift-56c3` @ tip  
**Date (UTC):** 2026-09-07  
**Paired build audit:** `docs/audits/DEV_NOTIFICATIONS_INBOX_PREFS.md`

## Scope

| Screen | Route                         |
| ------ | ----------------------------- |
| Inbox  | `/notifications`              |
| Rules  | `/admin/notification-rules`   |
| Prefs  | `/app/settings/notifications` |

## Evidence (in progress)

| Pillar             | Status | Evidence                                                                            |
| ------------------ | ------ | ----------------------------------------------------------------------------------- |
| Inventory smoke    | ☑      | `e2e/20-notifications-transport-inventory-smoke.spec.ts` (local 7/7 with transport) |
| UX route lists     | ☑      | dark/touch/a11y/capture include `/notifications`                                    |
| Backend unit       | ☑      | `@proctira/backend-notification` 129 tests (incl. sandbox SMS)                      |
| SMS honesty        | ☑      | prefs banner + `GET /notifications/delivery-capabilities`                           |
| Email/push sandbox | ☑      | sandbox email/push senders + capabilities honesty                                   |
| Multidevice PNGs   | ☑      | `/opt/cursor/artifacts/campus-audit/notifications/` + `summary.json`                |
| Live write prefs   | ☑      | `e2e/20c-notifications-prefs-write-smoke.spec.ts` (PATCH + device register)         |
| Security           | ☑      | cross-tenant prefs isolation (same sub, different tenant → defaults)                |
| Opaque JWT `sub`   | ☑      | `notification_*` user columns TEXT (005 schema widen)                               |
| Tip CI             | ☐      | GitHub spending limit — jobs do not start                                           |

## Waivers

- Tip CI green: blocked by account billing/spending limit (annotation on Detect Affected Modules).
- Live IdP / device-farm / Twilio: program-wide external.
