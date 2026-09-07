# Enterprise module development — Notifications inbox / prefs / rules

**Capability / module:** Notifications · inbox · preferences · devices · rules  
**Branch / tip:** `cursor/enterprise-score-uplift-56c3`  
**Date (UTC):** 2026-09-07  
**Peer parity target:** Multi-channel prefs (email/in-app/push/webhook/SMS), device registration, admin rules hub  
**Paired test audit:** `docs/audits/NOTIFICATIONS_INBOX_PREFS_RULES.md` (pending WS6)

## 0. Product contract

| Item                 | Content                                                                                                     |
| -------------------- | ----------------------------------------------------------------------------------------------------------- |
| Capability statement | Users manage channel prefs; devices register for push; staff open an inbox hub; admins reach rules catalog. |
| In scope             | Prefs GET/PATCH, devices CRUD, SMS channel enum, gateway mount, web inbox + rules shells, sidebar           |
| Explicit non-goals   | Full interactive rules editor UI; live SMS carrier proof                                                    |
| Roles                | Self prefs/devices; inbox all auth; rules tenant admin                                                      |

| Nav / surface | Route                         | API                                    | Tables                     | PII |
| ------------- | ----------------------------- | -------------------------------------- | -------------------------- | --- |
| Inbox         | `/notifications`              | GET `/notifications/user/:id`          | `notifications`            | Yes |
| Rules         | `/admin/notification-rules`   | `/notifications/rules`                 | (in-memory rules)          | Low |
| Prefs         | `/app/settings/notifications` | GET/PATCH `/notifications/preferences` | `notification_preferences` | Yes |
| Devices       | mobile API                    | `/notifications/devices`               | `notification_devices`     | Yes |

## 1–3 Build status

| Check                                      | Done | Evidence                                          |
| ------------------------------------------ | ---- | ------------------------------------------------- |
| SQL `db/sql/005_notifications_schema.sql`  | ☑    | prefs + devices + TEXT user ids for JWT `sub`     |
| Prefs/devices store + unit tests           | ☑    | `prefs-store.ts`, `prefs-store.test.ts`           |
| SMS in DeliveryChannelSchema               | ☑    | schemas + web CHANNELS                            |
| Gateway mount                              | ☑    | `domain-plugins` notification registrar           |
| Web shells + sidebar                       | ☑    | App Router + `nav.notifications`                  |
| Live inbox from `GET /user/:userId`        | ☑    | `notifications-inbox.ts` + inbox page             |
| SMS sandbox sender + honesty banner        | ☑    | `sandbox-sms-sender.ts` + prefs Alert             |
| `GET /notifications/delivery-capabilities` | ☑    | SMS mode + honesty note                           |
| Live prefs write smoke                     | ☑    | `e2e/20c-notifications-prefs-write-smoke.spec.ts` |

## Residual

- Pg-backed notification _delivery_ rows still follow-up (prefs/devices PG when DATABASE_URL).
- Interactive rules editor UI.
- Live Twilio (or equivalent) adapter.
