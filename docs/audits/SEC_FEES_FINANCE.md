# Security — Fees & finance v1

**Branch:** `cursor/fees-finance-v1-56c3`  
**Date (UTC):** 2026-09-07

| Check                                 | Pass | Evidence                                  |
| ------------------------------------- | ---- | ----------------------------------------- |
| Tenant-scoped plans/invoices/receipts | ☑    | repository filters + unit isolation       |
| Parent pay requires child link        | ☑    | `payInvoice` assert + existing tests      |
| Sandbox-only honesty                  | ☑    | method default `sandbox`; live PSP waived |
| No SaaS billing crosstalk             | ☑    | extends parent-portal 010/011 only        |

**Waivers:** live PSP · live IdP RBAC matrix · device-farm

## F1 addendum (2026-09-12)

| Check                                      | Pass | Evidence                                                            |
| ------------------------------------------ | ---- | ------------------------------------------------------------------- |
| Netting API tenant-scoped                  | ☑    | `applyScholarshipNetting` + repository filters; unit idempotency    |
| Staff UI does not claim cross-tenant apply | ☑    | Session + gateway JWT; gated e2e foreign netting assertion          |
| Sandbox / no live PSP on this surface      | ☑    | Honesty copy on `/fees/scholarship-netting`; G-202 waiver unchanged |
