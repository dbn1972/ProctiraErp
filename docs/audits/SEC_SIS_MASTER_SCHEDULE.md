# Security — SIS Master schedule harden

**Branch:** `cursor/sis-master-schedule-harden-56c3`  
**Date (UTC):** 2026-09-07

| Check                  | Pass | Evidence                                |
| ---------------------- | ---- | --------------------------------------- |
| RBAC write/publish     | ☑    | `timetable-access.ts` + route gates     |
| Cross-tenant isolation | ☑    | service test                            |
| Publish audit          | ☑    | `section.publish` / `section.unpublish` |

**Waivers:** live IdP · Playwright gated writes · device-farm
