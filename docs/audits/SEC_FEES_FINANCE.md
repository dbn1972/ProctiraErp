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
