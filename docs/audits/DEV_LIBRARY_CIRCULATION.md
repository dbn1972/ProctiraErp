# Enterprise module development — Library circulation

**Capability / module:** Library  
**Branch / tip:** `cursor/enterprise-score-uplift-56c3`  
**Date (UTC):** 2026-09-07  
**Peer parity target:** Catalog items, checkout/return, overdue list  
**Paired test audit:** pending WS6

## 0. Product contract

| Item                 | Content                                                                              |
| -------------------- | ------------------------------------------------------------------------------------ |
| Capability statement | Librarians maintain catalog copies and track loans.                                  |
| In scope             | SQL schema, gateway mount (in-memory repo), App Router hubs, sidebar, ungated smokes |
| Explicit non-goals   | Barcode scanning; fines in this tip                                                  |
| Roles                | Librarian / tenant admin                                                             |

| Nav         | Route                  | API                      | Tables          |
| ----------- | ---------------------- | ------------------------ | --------------- |
| Overview    | `/library`             | `/library/*`             | `library_*`     |
| Circulation | `/library/circulation` | `/library/circulation/*` | `library_loans` |
| Overdues    | `/library/overdues`    | `/library/overdues`      | `library_loans` |

## Build status

| Check                                   | Done | Evidence       |
| --------------------------------------- | ---- | -------------- |
| SQL `db/sql/009_library_schema.sql`     | ☑    |                |
| Gateway mount InMemoryLibraryRepository | ☑    | domain-plugins |
| Web shells + sidebar                    | ☑    |                |
| PgLibraryStore                          | ☐    | follow-up      |
| Live circulation desk UI                | ☐    | follow-up      |

## Residual

Wire circulation desk + Pg store; seed demo catalog per cert school.
