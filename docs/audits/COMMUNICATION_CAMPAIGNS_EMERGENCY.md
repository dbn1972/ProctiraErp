# Enterprise production-ready — Communication campaigns / emergency

**Module:** Communication  
**Branch / tip:** `cursor/enterprise-score-uplift-56c3` @ `d150224`  
**Date (UTC):** 2026-09-07  
**Paired build audit:** `docs/audits/DEV_COMMUNICATION_CAMPAIGNS.md`

## Evidence (in progress)

| Pillar                | Status | Evidence                                                     |
| --------------------- | ------ | ------------------------------------------------------------ |
| Inventory smoke       | ☑      | `e2e/21-campus-comms-hostel-library-inventory-smoke.spec.ts` |
| UX route lists        | ☑      | dark/touch/a11y/capture                                      |
| Backend unit          | ☑      | `@proctira/backend-communication` 13 tests (incl. Pg + send) |
| Audience preview      | ☑      | live hostel/route counts when `DATABASE_URL`                 |
| Sandbox send/dispatch | ☑      | campaigns + emergency honesty notes                          |
| Multidevice PNGs      | ☑      | `/opt/cursor/artifacts/campus-audit/communication/`          |
| Tip CI                | ☐      | billing block (jobs never start)                             |
| Dual-confirm E2E      | ☐      | pending authenticated write run                              |

## Waivers

- Tip CI green: GitHub spending limit (annotation on Detect Affected Modules).
- Live Twilio/FCM/SMTP: explicit sandbox honesty until secrets present.
