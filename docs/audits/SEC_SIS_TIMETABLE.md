# Security — SIS Timetable harden

**Branch:** `cursor/sis-timetable-harden-56c3`  
**Date (UTC):** 2026-09-07

| Check                  | Pass | Evidence                                                                                 |
| ---------------------- | ---- | ---------------------------------------------------------------------------------------- |
| RBAC write/publish     | ☑    | `timetable-access.ts` + route `requireAction` (shared w/ master-schedule)                |
| Cross-tenant isolation | ☑    | service test: bells/periods/meetings/subs empty for Tenant B                             |
| Mutation audit         | ☑    | `bell_schedule.*` · `period.*` · `meeting.*` · `substitution.create` · `section.publish` |

**Waivers:** live IdP · iCal federation · Playwright gated writes · device-farm
