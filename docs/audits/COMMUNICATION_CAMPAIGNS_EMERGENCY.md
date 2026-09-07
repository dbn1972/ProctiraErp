# Enterprise production-ready — Communication campaigns / emergency

**Module:** Communication  
**Branch / tip:** `cursor/campus-ws6-close-56c3` (closes WS6 on tip after `main` @ `083f56c`)  
**Date (UTC):** 2026-09-07  
**Paired build audit:** `docs/audits/DEV_COMMUNICATION_CAMPAIGNS.md`  
**Status:** **complete** (sandbox provider waiver)

## Evidence

| Pillar                | Status | Evidence                                                                                                           |
| --------------------- | ------ | ------------------------------------------------------------------------------------------------------------------ |
| Inventory smoke       | ☑      | `e2e/21-campus-comms-hostel-library-inventory-smoke.spec.ts`                                                       |
| UX route lists        | ☑      | dark/touch/a11y/capture                                                                                            |
| Backend unit          | ☑      | `@proctira/backend-communication` (incl. Pg + send)                                                                |
| Audience preview      | ☑      | live hostel/route counts when `DATABASE_URL`                                                                       |
| Sandbox send/dispatch | ☑      | campaigns + emergency honesty notes                                                                                |
| Multidevice PNGs      | ☑      | `/opt/cursor/artifacts/campus-audit/communication/`                                                                |
| Signed JWT e2e helper | ☑      | `setupGatewayTenantSession` (HS256, no gateway weaken)                                                             |
| Campus write smoke    | ☑      | `e2e/21c-campus-comms-write-smoke.spec.ts` (gated)                                                                 |
| Live campaign create  | ☑      | local chromium + `E2E_BACKEND_READY=1` + signed JWT                                                                |
| Live emergency draft  | ☑      | local chromium dual-confirm draft smoke                                                                            |
| Dual-confirm 2-actor  | ☑      | API e2e: create → confirm A → confirm B → sandbox dispatch                                                         |
| Empty JSON body POST  | ☑      | gateway parser treats `Content-Type: application/json` + empty as `{}`                                             |
| Live campaign send    | ☑      | `POST /campaigns/:id/send` sandbox honesty (gated API e2e)                                                         |
| Cross-tenant deny     | ☑      | tenant B cannot send/confirm tenant A campaign/emergency (404)                                                     |
| Tip CI                | ☑      | `main` @ `083f56c` — [CI run 34099917112](https://github.com/dbn1972/ProctiraErp/actions/runs/34099917112) (24/24) |
| WS6 replay            | ☑      | 2026-09-07 local: inventory + gated writes **pass**                                                                |

## Waivers

- Live Twilio/FCM/SMTP: explicit sandbox honesty until secrets present.
- Live IdP E2E / Android device-farm: program-wide external.
