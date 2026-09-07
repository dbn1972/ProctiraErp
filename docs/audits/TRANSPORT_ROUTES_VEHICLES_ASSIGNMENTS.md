# Enterprise production-ready — Transport routes / vehicles / assignments

**Module:** Transport  
**Branch / tip:** `cursor/enterprise-score-uplift-56c3` @ tip  
**Date (UTC):** 2026-09-07  
**Paired build audit:** `docs/audits/DEV_TRANSPORT_ROUTES_FLEET.md`

## Scope

| Screen       | Route                                        |
| ------------ | -------------------------------------------- |
| Overview     | `/transport`                                 |
| Routes / new | `/transport/routes`, `/transport/routes/new` |
| Vehicles     | `/transport/vehicles`                        |
| Assignments  | `/transport/assignments`                     |

## Evidence (in progress)

| Pillar                   | Status | Evidence                                                 |
| ------------------------ | ------ | -------------------------------------------------------- |
| Inventory smoke          | ☑      | `e2e/20-notifications-transport-inventory-smoke.spec.ts` |
| UX route lists           | ☑      | dark/touch/a11y/capture                                  |
| Backend unit             | ☑      | `@proctira/backend-transport` 38 tests                   |
| Pg persistence           | ☑      | `createTransportRepository()` when `DATABASE_URL`        |
| Multidevice PNGs         | ☑      | `/opt/cursor/artifacts/campus-audit/transport/`          |
| Live authenticated write | ☑      | `e2e/21d-…` route + vehicle create (gated)               |
| Student overlap deny     | ☑      | second active assignment → 422 BUSINESS_RULE_ERROR       |
| Cross-tenant deny        | ☑      | tenant B cannot GET tenant A route (404)                 |
| Tip CI                   | ☐      | billing block                                            |

## Waivers

- Tip CI green: GitHub spending limit.
