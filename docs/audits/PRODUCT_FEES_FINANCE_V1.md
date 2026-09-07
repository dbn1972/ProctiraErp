# Product / IA — Fees & finance v1

**Module / slice:** Fee plans · invoices · sandbox payments · receipts · staff UI · parent link  
**Branch:** `cursor/fees-finance-v1-56c3`  
**Date (UTC):** 2026-09-07

## Capability

Staff define fee plans and issue invoices (from plan or ad-hoc). Parents pay open invoices via sandbox in the family portal and receive a receipt number. Staff browse plans, invoices, and receipts under `/fees`.

## Scope

| In                                             | Out                             |
| ---------------------------------------------- | ------------------------------- |
| SQL `011_fees_finance_schema.sql` (extend 010) | Live PSP / UPI/card capture     |
| Plans + receipts + staff `/fees` UI            | SaaS `packages/backend/billing` |
| Parent receipts on `/parent/fees`              | Full ledger / accounting export |

## DoD

- [x] Unit: plan → invoice → pay → receipt + tenant isolation
- [ ] Tip CI + merge
