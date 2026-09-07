# Enterprise module development — Communication campaigns / emergency

**Capability / module:** Communication  
**Branch / tip:** `cursor/enterprise-score-uplift-56c3`  
**Date (UTC):** 2026-09-07  
**Peer parity target:** Campaigns + dual-confirm emergency blasts  
**Paired test audit:** pending WS6

## 0. Product contract

| Item                 | Content                                                                              |
| -------------------- | ------------------------------------------------------------------------------------ |
| Capability statement | Comms officers draft campaigns and run two-actor emergency blasts.                   |
| In scope             | SQL schema, gateway mount (in-memory repo), App Router hubs, sidebar, ungated smokes |
| Explicit non-goals   | Live send integrations; full campaign composer in this tip                           |
| Roles                | Comms officer / tenant admin                                                         |

| Nav       | Route                              | API                        | Tables                   |
| --------- | ---------------------------------- | -------------------------- | ------------------------ |
| Overview  | `/communication`                   | `/communication/*`         | `comms_*`                |
| Campaigns | `/communication/campaigns`, `/new` | `/communication/campaigns` | `comms_campaigns`        |
| Emergency | `/communication/emergency`         | `/communication/emergency` | `comms_emergency_blasts` |

## Build status

| Check                                         | Done | Evidence                          |
| --------------------------------------------- | ---- | --------------------------------- |
| SQL `db/sql/007_communication_schema.sql`     | ☑    |                                   |
| Gateway mount InMemoryCommunicationRepository | ☑    | domain-plugins                    |
| Web shells + sidebar                          | ☑    |                                   |
| Live campaign create + list                   | ☑    | `NewCampaignForm` + campaigns API |
| Dual-confirm emergency UI                     | ☑    | `EmergencyBlastPanel`             |
| PgCommunicationStore                          | ☐    | follow-up                         |
| Send adapters / segment resolver              | ☐    | follow-up                         |

## Residual

Wire send adapters + Pg store; seed demo campaigns per cert school.
