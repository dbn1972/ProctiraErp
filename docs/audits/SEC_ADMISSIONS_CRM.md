# Security — Admissions CRM depth

**Branch:** `cursor/admissions-crm-depth-56c3`  
**Date (UTC):** 2026-09-07

| Check                            | Pass | Evidence                               |
| -------------------------------- | ---- | -------------------------------------- |
| Tenant-scoped application status | ☑    | `updateApplicationStatus` tenant match |
| Public status still DOB-gated    | ☑    | existing `checkStatus`                 |
| Slot capacity enforced           | ☑    | BusinessRuleError unit                 |
| OCR not claimed                  | ☑    | Waived                                 |

**Waivers:** live apply portal IdP · OCR · full PG application vault
