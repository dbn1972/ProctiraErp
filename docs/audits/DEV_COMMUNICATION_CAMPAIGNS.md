# Enterprise module development — Communication campaigns / emergency

**Capability / module:** Communication  
**Branch / tip:** `cursor/enterprise-score-uplift-56c3`  
**Date (UTC):** 2026-09-07  
**Peer parity target:** Campaigns + dual-confirm emergency blasts  
**Paired test audit:** pending WS6

## 0. Product contract

| Item                 | Content                                                                                |
| -------------------- | -------------------------------------------------------------------------------------- |
| Capability statement | Comms officers draft campaigns and run two-actor emergency blasts.                     |
| In scope             | SQL schema, Pg/in-memory repo, gateway mount, App Router hubs, sidebar, ungated smokes |
| Explicit non-goals   | Live send integrations; full campaign composer in this tip                             |
| Roles                | Comms officer / tenant admin                                                           |

| Nav       | Route                              | API                        | Tables                   |
| --------- | ---------------------------------- | -------------------------- | ------------------------ |
| Overview  | `/communication`                   | `/communication/*`         | `comms_*`                |
| Campaigns | `/communication/campaigns`, `/new` | `/communication/campaigns` | `comms_campaigns`        |
| Emergency | `/communication/emergency`         | `/communication/emergency` | `comms_emergency_blasts` |

## Build status

| Check                                           | Done | Evidence                                      |
| ----------------------------------------------- | ---- | --------------------------------------------- |
| SQL `db/sql/007_communication_schema.sql`       | ☑    | TEXT actors for opaque JWT `sub`              |
| Gateway mount `createCommunicationRepository()` | ☑    | Pg when `DATABASE_URL`; else in-memory        |
| Web shells + sidebar                            | ☑    |                                               |
| Live campaign create + list                     | ☑    | `NewCampaignForm` + campaigns API             |
| Dual-confirm emergency UI                       | ☑    | `EmergencyBlastPanel`                         |
| Audience preview API + UI                       | ☑    | `POST /communication/audience/preview` + form |
| PgCommunicationStore                            | ☑    | `pg-communication-repository.ts`              |
| Demo SQL seed                                   | ☑    | `db/sql/007b_communication_seed.sql`          |
| Sandbox campaign send                           | ☑    | `POST /campaigns/:id/send` + list UI button   |
| Live segment resolver / provider adapters       | ☐    | honesty notes on preview + sandbox send       |

## Residual

Live segment resolvers + Twilio/FCM/SMTP adapters. Tip CI currently blocked by GitHub billing/spending limit (jobs never start).
