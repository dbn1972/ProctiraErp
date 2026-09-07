# Enterprise production-ready — Notifications inbox / prefs / rules

**Module:** Notifications  
**Branch / tip:** `cursor/campus-ws6-close-56c3` (closes WS6 on tip after `main` @ `083f56c`)  
**Date (UTC):** 2026-09-07  
**Paired build audit:** `docs/audits/DEV_NOTIFICATIONS_INBOX_PREFS.md`  
**Status:** **complete** (sandbox provider waiver)

## Scope

| Screen | Route                         |
| ------ | ----------------------------- |
| Inbox  | `/notifications`              |
| Rules  | `/admin/notification-rules`   |
| Prefs  | `/app/settings/notifications` |

## Evidence

| Pillar             | Status | Evidence                                                                                                           |
| ------------------ | ------ | ------------------------------------------------------------------------------------------------------------------ |
| Inventory smoke    | ☑      | `e2e/20-notifications-transport-inventory-smoke.spec.ts` (local 7/7 with transport)                                |
| UX route lists     | ☑      | dark/touch/a11y/capture include `/notifications`                                                                   |
| Backend unit       | ☑      | `@proctira/backend-notification` unit + sandbox SMS                                                                |
| SMS honesty        | ☑      | prefs banner + `GET /notifications/delivery-capabilities`                                                          |
| Email/push sandbox | ☑      | sandbox email/push senders + capabilities honesty                                                                  |
| Multidevice PNGs   | ☑      | `/opt/cursor/artifacts/campus-audit/notifications/` + `summary.json`                                               |
| Live write prefs   | ☑      | `e2e/20c-notifications-prefs-write-smoke.spec.ts` (PATCH + device register)                                        |
| Security           | ☑      | cross-tenant prefs isolation (same sub, different tenant → defaults)                                               |
| Opaque JWT `sub`   | ☑      | `notification_*` user columns TEXT (005 schema widen)                                                              |
| Tip CI             | ☑      | `main` @ `083f56c` — [CI run 34099917112](https://github.com/dbn1972/ProctiraErp/actions/runs/34099917112) (24/24) |
| WS6 replay         | ☑      | 2026-09-07 local: inventory + gated prefs **pass** (`ws6-close-evidence.json`)                                     |

## Waivers

- Live Twilio / FCM / SMTP: sandbox adapters + honesty banners until secrets present.
- Live IdP E2E / Android device-farm PNGs: program-wide external.
