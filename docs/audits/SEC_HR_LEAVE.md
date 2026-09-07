# Security — HR leave v1

**Branch:** `cursor/hr-leave-v1-56c3`  
**Date (UTC):** 2026-09-07

| Check                           | Pass | Evidence                                        |
| ------------------------------- | ---- | ----------------------------------------------- |
| Tenant-scoped leave list/decide | ☑    | repository filters + unit NotFound cross-tenant |
| Decide only from pending        | ☑    | ConflictError on re-decide                      |
| Payroll not exposed             | ☑    | Deferred / not implemented                      |

**Waivers:** live IdP · payroll · device-farm
