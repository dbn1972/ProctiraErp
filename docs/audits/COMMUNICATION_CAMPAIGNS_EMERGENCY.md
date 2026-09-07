# Enterprise production-ready — Communication campaigns / emergency

**Module:** Communication  
**Branch / tip:** `cursor/enterprise-score-uplift-56c3` @ tip  
**Date (UTC):** 2026-09-07  
**Paired build audit:** `docs/audits/DEV_COMMUNICATION_CAMPAIGNS.md`

## Evidence (in progress)

| Pillar                | Status | Evidence                                                               |
| --------------------- | ------ | ---------------------------------------------------------------------- |
| Inventory smoke       | ☑      | `e2e/21-campus-comms-hostel-library-inventory-smoke.spec.ts`           |
| UX route lists        | ☑      | dark/touch/a11y/capture                                                |
| Backend unit          | ☑      | `@proctira/backend-communication` 13 tests (incl. Pg + send)           |
| Audience preview      | ☑      | live hostel/route counts when `DATABASE_URL`                           |
| Sandbox send/dispatch | ☑      | campaigns + emergency honesty notes                                    |
| Multidevice PNGs      | ☑      | `/opt/cursor/artifacts/campus-audit/communication/`                    |
| Signed JWT e2e helper | ☑      | `setupGatewayTenantSession` (HS256, no gateway weaken)                 |
| Campus write smoke    | ☑      | `e2e/21c-campus-comms-write-smoke.spec.ts` (gated)                     |
| Live campaign create  | ☑      | local chromium + `E2E_BACKEND_READY=1` + signed JWT                    |
| Live emergency draft  | ☑      | local chromium dual-confirm draft smoke                                |
| Dual-confirm 2-actor  | ☑      | API e2e: create → confirm A → confirm B → sandbox dispatch             |
| Empty JSON body POST  | ☑      | gateway parser treats `Content-Type: application/json` + empty as `{}` |
| Live campaign send    | ☑      | `POST /campaigns/:id/send` sandbox honesty (gated API e2e)             |
| Cross-tenant deny     | ☑      | tenant B cannot send/confirm tenant A campaign/emergency (404)         |
| Tip CI                | ☐      | billing block (jobs never start)                                       |

## Waivers

- Tip CI green: GitHub spending limit (annotation on Detect Affected Modules).
- Live Twilio/FCM/SMTP: explicit sandbox honesty until secrets present.
