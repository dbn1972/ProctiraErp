# Parent / student portal — gap closure plan

**Status:** WS0–WS3 landed; WS4 tip CI pending  
**Updated (UTC):** 2026-09-07  
**Branch:** `cursor/parent-student-portal-56c3`  
**Skills:** enterprise-module-development + enterprise-module-production-ready

## Capability statement

A guardian (or student) can open a **dedicated parent portal** (web + Flutter parent mode), see linked children, exchange **two-way messages** with the school, respond to **consent** requests, and **pay student fees** via a sandbox payment path — without using the staff ERP shell.

Staff keep existing **staff-leaning mobile shells**; parent IA is a separate shell/mode.

## In scope (v1)

| Slice       | Deliverable                                            |
| ----------- | ------------------------------------------------------ |
| Child links | Parent↔student linkage API + UI child switcher         |
| Messaging   | Threads + replies (parent ↔ staff)                     |
| Consent     | Typed consent ledger (approve/deny)                    |
| Fee pay     | Invoices + sandbox pay (no live PSP required)          |
| Web portal  | `/parent/*` shell (not staff sidebar)                  |
| Mobile      | Flutter `/parent/*` routes; staff shells unchanged     |
| Integration | Gateway mount `/api/v1/parent-portal`, raw SQL `010_*` |

## Explicit non-goals (v1)

- Live UPI/card PSP credentials (sandbox honesty)
- Full gradebook/report-card parent view (SIS residual)
- Replacing staff `MobileShell` / Flutter staff home
- Multi-child fee wallet / scholarships disbursement

## Workstreams

```text
WS0  Plan + contracts + audits
WS1  SQL + backend package + gateway
WS2  Web parent shell + screens
WS3  Flutter parent mode (staff shells preserved)
WS4  Enterprise test packs + tip CI
```

## Status

| WS  | Status                                            |
| --- | ------------------------------------------------- |
| WS0 | **Done**                                          |
| WS1 | **Done**                                          |
| WS2 | **Done**                                          |
| WS3 | **Done**                                          |
| WS4 | **In progress** (smokes + audits; tip CI pending) |
