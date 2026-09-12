# DEV — P2-LIB residual close (circulation exists; acquisitions NON-GOAL)

**Capability / module:** Library · circulation + acquisitions residual  
**Track:** **P2-LIB** (`docs/plans/TASKS_ENTERPRISE_P0_P1_P2_GAPS.md` §3 — **do not edit TASKS from this slice**)  
**Branch / tip:** `cursor/library-circulation-acq-56c3`  
**Date (UTC):** 2026-09-12  
**Package:** `@proctira/backend-library` (`packages/backend/library`)  
**Prior build audits:** `DEV_LIBRARY_CIRCULATION.md`, `DEV_LIBRARY_OPS.md` (G-916)  
**Prior test audit:** `LIBRARY_CATALOG_CIRCULATION.md`  
**Product / IA:** `PRODUCT_LIBRARY_OPS.md`  
**Waiver:** `WAIVER_BOARD_20260912.md` · **PRD-017**

---

## Honesty

| Item                 | Content                                                                                                   |
| -------------------- | --------------------------------------------------------------------------------------------------------- |
| Circulation          | **Already ships** — catalog, checkout/return/renew, barcode, holds, overdues, fines, OPAC, transfer clear |
| Acquisitions         | **Dated NON-GOAL (2026-09-12)** — no vendor PO / receiving / fund-allocation / MARC-acq / ILL workflow    |
| Claims forbidden     | Destiny/Koha-class **acquisitions parity**; “library ERP complete” while acquisitions remains NON-GOAL    |
| This slice           | **DEV residual audit + package README only** — no UI/API schema build; no TASKS edit                      |
| Re-open acquisitions | Only when product funds a library-acquisitions epic; then reverse PRD-017 and open a real DEV pack        |

---

## 0. Product contract (this residual)

| Item                 | Content                                                                                                                                      |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Capability statement | Librarians circulate holdings (checkout/return/renew, barcode, holds, fines→fees, OPAC read, transfer clearance). Ordering/receiving is out. |
| In scope (evidence)  | Prove circulation surfaces exist on tip; document package boundary                                                                           |
| Explicit non-goals   | **Acquisitions** (vendors, POs, receiving, budget encumbrance, serials claiming, ILL) — **NON-GOAL dated 2026-09-12**                        |
| Roles                | Librarian / tenant admin manage; parent/student `library:read` (OPAC + bound loans/holds)                                                    |

---

## 1. Circulation — exists (evidence inventory)

| Surface / capability       | Route / API                                                       | Evidence                                                   |
| -------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------- |
| Catalog list/create        | `/library`, `GET/POST /library/items`                             | `apps/web/.../library/page.tsx`; `routes.ts` items         |
| Title + holds              | `/library/[id]`, holds APIs                                       | G-916 / `039_library_ops_schema.sql`                       |
| Circulation desk           | `/library/circulation`                                            | `circulation-desk.tsx`; `POST .../checkout\|return\|renew` |
| Barcode checkout/return    | `.../copies/by-barcode`, `.../return-barcode`                     | `48-library-ops-write-smoke.spec.ts`                       |
| Overdues + assess fine     | `/library/overdues`, `POST /library/fines/assess`                 | fines → `FeesLedgerPort`                                   |
| Fines list / pay / summary | `/library/fines`                                                  | `library-fines.test.ts`                                    |
| OPAC search                | `/library/opac`, `GET /library/opac/search`                       | staff + parent/student API read                            |
| Transfer clearance         | `GET /library/patrons/:studentId/clearance`                       | `21d-campus-hostel-library-write-smoke.spec.ts`            |
| SQL                        | `db/sql/009_library_schema.sql`, `009b_…seed.sql`, `039_…ops…sql` | items/copies/loans/holds/fines                             |
| Package                    | `@proctira/backend-library`                                       | `packages/backend/library/src/*` + `README.md`             |
| Prior WS6 test close       | `LIBRARY_CATALOG_CIRCULATION.md`                                  | inventory/gated write smokes + tip CI note on that audit   |

**Verdict (circulation half of P2-LIB):** closed by prior G-916 / WS5–WS6 work — **no thin critical fix required** on this residual pass.

---

## 2. Acquisitions — dated NON-GOAL

| Check                                       | Status (2026-09-12) | Notes                                                               |
| ------------------------------------------- | ------------------- | ------------------------------------------------------------------- |
| Vendor master / supplier contracts          | **NON-GOAL**        | Not in `@proctira/backend-library`                                  |
| Purchase orders / fund codes / encumbrance  | **NON-GOAL**        | Do not invent under circulation routes                              |
| Receiving / accession from PO               | **NON-GOAL**        | Catalog create + ISBN import ≠ acquisitions                         |
| Serials claiming / EDI / MARC order records | **NON-GOAL**        |                                                                     |
| Inter-library loan (ILL)                    | **NON-GOAL**        | Already listed in `PRODUCT_LIBRARY_OPS.md` peer non-goals           |
| Code scan for acq surfaces                  | ☑ none              | No `acquisit*` / PO / vendor paths under `packages/backend/library` |

**ISBN import** (`GET /library/isbn/:isbn`, `POST /library/items/import-isbn`) is **catalog enrichment**, not acquisitions.

---

## 3. Package boundary (`@proctira/backend-library`)

Documented in `packages/backend/library/README.md`:

- **In:** catalog, copies/barcodes, circulation, holds, OPAC, fines→fees port, patron clearance, portal patron binding.
- **Out (NON-GOAL 2026-09-12):** acquisitions / procurement for library materials.

---

## 4. Residuals (honest, not blocking this close)

| Residual                        | Treatment                                |
| ------------------------------- | ---------------------------------------- |
| Live Open Library network in CI | Existing waiver (stub default)           |
| Overdue auto-assess job         | Optional follow-up (G-603 residual note) |
| Structured audit-log events     | Deferred in `DEV_LIBRARY_OPS.md`         |
| Full public OPAC portal         | Explicit non-goal (staff/API first)      |
| Acquisitions epic               | **PRD-017 NON-GOAL** until funded        |

---

## 5. Exit — P2-LIB track (this program)

| Gate                         | Result                                                             |
| ---------------------------- | ------------------------------------------------------------------ |
| Circulation peer slice       | ☑ exists (prior DEV + test audits)                                 |
| Acquisitions                 | ☑ dated **NON-GOAL** (2026-09-12) / PRD-017                        |
| Critical code fix this slice | ☐ not needed                                                       |
| TASKS file                   | ☑ untouched (register status update is a separate owner edit)      |
| Product 10/10 claim          | ☐ **not** claimed — acquisitions NON-GOAL; scoreboard stays honest |

**Close statement:** P2-LIB is **closed for residual honesty** — circulation is present; acquisitions is an explicit dated NON-GOAL, not an open build gap pretending to be in-flight.
