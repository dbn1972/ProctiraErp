# Enterprise module development — Library circulation

**Capability / module:** Library  
**Branch / tip:** `cursor/enterprise-score-uplift-56c3`  
**Date (UTC):** 2026-09-07  
**Peer parity target:** Catalog items, checkout/return, overdue list  
**Paired test audit:** pending WS6

## 0. Product contract

| Item                 | Content                                                                                |
| -------------------- | -------------------------------------------------------------------------------------- |
| Capability statement | Librarians maintain catalog copies and track loans.                                    |
| In scope             | SQL schema, Pg/in-memory repo, gateway mount, App Router hubs, sidebar, ungated smokes |
| Explicit non-goals   | Barcode scanning; fines in this tip                                                    |
| Roles                | Librarian / tenant admin                                                               |

| Nav         | Route                  | API                      | Tables          |
| ----------- | ---------------------- | ------------------------ | --------------- |
| Overview    | `/library`             | `/library/*`             | `library_*`     |
| Circulation | `/library/circulation` | `/library/circulation/*` | `library_loans` |
| Overdues    | `/library/overdues`    | `/library/overdues`      | `library_loans` |

## Build status

| Check                                     | Done | Evidence                            |
| ----------------------------------------- | ---- | ----------------------------------- |
| SQL `db/sql/009_library_schema.sql`       | ☑    |                                     |
| Gateway mount `createLibraryRepository()` | ☑    | Pg when `DATABASE_URL`; else memory |
| Web shells + sidebar                      | ☑    |                                     |
| Live catalog create + list                | ☑    | `NewLibraryItemForm` + items API    |
| Overdues list from API                    | ☑    | `/library/overdues`                 |
| Circulation checkout/return UI            | ☑    | `CirculationDesk`                   |
| PgLibraryStore                            | ☑    | `pg-library-repository.ts`          |
| Demo SQL seed                             | ☑    | `db/sql/009b_library_seed.sql`      |
| Transfer clearance API + UI               | ☑    | `GET /patrons/:id/clearance`        |
| Loan renew (+14 days)                     | ☑    | `POST /circulation/renew` + desk UI |

## Residual

WS6 enterprise pack closed in `LIBRARY_CATALOG_CIRCULATION.md`.

**P2-LIB residual (2026-09-12):** circulation remains in scope (this audit + G-916 ops). **Acquisitions** = dated **NON-GOAL** — see `DEV_P2_LIB_CIRCULATION_ACQ.md` / PRD-017. Do not claim Destiny/Koha acquisitions parity.
