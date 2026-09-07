# Security & tenancy — SIS Gradebook harden

**Module / slice:** Gradebook  
**Branch:** `cursor/sis-gradebook-harden-56c3`  
**Date (UTC):** 2026-09-07  
**Data classes:** PII (student IDs + scores)

## 1. Controls

| Check                                          | Pass | Evidence                                      |
| ---------------------------------------------- | ---- | --------------------------------------------- |
| RBAC on writes                                 | ☑    | `gradebook-access.ts` + route `requireAction` |
| Cross-tenant IDOR blocked (service)            | ☑    | `gradebook-service.test.ts` isolation case    |
| Write audit on grade upsert / transcript issue | ☑    | `GradebookService.recordAudit` / `listAudits` |
| No secrets in artifacts                        | ☑    | PDF-lite HTML only                            |

## 2. Sign-off

P0 cleared ☑ · Safe to merge from security view ☑ (live IdP residual waived)
