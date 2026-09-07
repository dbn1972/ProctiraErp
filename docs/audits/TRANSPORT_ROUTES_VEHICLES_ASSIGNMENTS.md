# Enterprise production-ready — Transport routes / vehicles / assignments

**Module:** Transport  
**Branch / tip:** `cursor/campus-ws6-close-56c3` (closes WS6 on tip after `main` @ `083f56c`)  
**Date (UTC):** 2026-09-07  
**Paired build audit:** `docs/audits/DEV_TRANSPORT_ROUTES_FLEET.md`  
**Status:** **complete** (GPS non-goal)

## Scope

| Screen       | Route                                        |
| ------------ | -------------------------------------------- |
| Overview     | `/transport`                                 |
| Routes / new | `/transport/routes`, `/transport/routes/new` |
| Vehicles     | `/transport/vehicles`                        |
| Assignments  | `/transport/assignments`                     |

## Evidence

| Pillar                   | Status | Evidence                                                                                                           |
| ------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------ |
| Inventory smoke          | ☑      | `e2e/20-notifications-transport-inventory-smoke.spec.ts`                                                           |
| UX route lists           | ☑      | dark/touch/a11y/capture                                                                                            |
| Backend unit             | ☑      | `@proctira/backend-transport`                                                                                      |
| Pg persistence           | ☑      | `createTransportRepository()` when `DATABASE_URL`                                                                  |
| Multidevice PNGs         | ☑      | `/opt/cursor/artifacts/campus-audit/transport/`                                                                    |
| Live authenticated write | ☑      | `e2e/21d-…` route + vehicle create (gated)                                                                         |
| Student overlap deny     | ☑      | second active assignment → 422 BUSINESS_RULE_ERROR                                                                 |
| Cross-tenant deny        | ☑      | tenant B cannot GET tenant A route (404)                                                                           |
| Tip CI                   | ☑      | `main` @ `083f56c` — [CI run 34099917112](https://github.com/dbn1972/ProctiraErp/actions/runs/34099917112) (24/24) |
| WS6 replay               | ☑      | 2026-09-07 local gated transport writes **pass**                                                                   |

## Waivers

- Real-time GPS bus tracking: explicit non-goal (v1 static routes + assignments).
- Live IdP E2E / Android device-farm: program-wide external.
