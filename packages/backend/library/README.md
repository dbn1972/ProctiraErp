# `@proctira/backend-library`

Catalog, circulation, holds, OPAC, and fines for campus library ops (G-916 / P2-LIB circulation half).

## In scope

- Catalog items + copies (barcode / accession)
- Circulation: checkout, return, renew, barcode scan paths
- Holds queue (FIFO + ready expiry)
- Overdues + fine policy / assess / pay (optional fees ledger port)
- OPAC search (read)
- Patron transfer clearance (`GET /library/patrons/:studentId/clearance`)
- Parent/student portal binding for loans/holds reads

## Explicit NON-GOAL (dated 2026-09-12)

**Acquisitions** — vendors, purchase orders, receiving against PO, fund encumbrance, serials claiming, MARC order records, ILL — are **out of package scope** until a funded epic reverses **PRD-017**.

ISBN lookup / import is **catalog enrichment only**, not acquisitions.

See: `docs/audits/DEV_P2_LIB_CIRCULATION_ACQ.md`, `docs/audits/PRODUCT_LIBRARY_OPS.md`, `docs/audits/WAIVER_BOARD_20260912.md`.

## Layout

| Path                    | Role                                      |
| ----------------------- | ----------------------------------------- |
| `src/library-service.ts`| Domain service                            |
| `src/routes.ts`         | Fastify routes (`/library/*`)             |
| `src/pg-library-repository.ts` | Postgres store                     |
| `src/in-memory-repository.ts`  | Memory store (no silent prod fallback when `DATABASE_URL` set — factory) |
| `src/library-ops.ts`    | Hold/fine helpers                         |
| `src/isbn-lookup.ts`    | Stub / Open Library adapter               |

## Verify

```bash
pnpm --filter @proctira/backend-library test
```
