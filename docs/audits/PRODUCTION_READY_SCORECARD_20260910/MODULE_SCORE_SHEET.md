# Module score sheet — 2026-09-10

**Tip:** `pending-exam-tt-9` · **Program rollup:** 7.6 / 10 (evidence-weighted)  
**Pillars:** Product/IA · Build · UX · A11y · Security · Data · Test · Release (avg; missing evidence caps pillar ≤ 4.0)

Status: `PROD_WAIVED` = shippable with documented waivers · `PARTIAL` = usable, gaps block 9.0+ · `SCAFFOLD` = honesty banners / stubs · `PARKED` = not a live product surface

| Module                   | Pages ≈ |   Score | Status      | Prod | Build |  UX | A11y | Sec | Data | Test | Rel | Top gaps                                                   |
| ------------------------ | ------: | ------: | ----------- | ---: | ----: | --: | ---: | --: | ---: | ---: | --: | ---------------------------------------------------------- |
| Students                 |       7 | **8.7** | PROD_WAIVED |    9 |     9 | 8.5 |    8 |   8 |    9 |  8.5 | 7.5 | Live IdP write path; tip CI                                |
| Institutions / Academics |    15+3 | **8.6** | PROD_WAIVED |    9 |     9 | 8.5 |    8 | 8.5 |    9 |  8.5 | 7.5 | Institution write journey residual                         |
| Attendance               |   3+ops | **8.5** | PROD_WAIVED |  8.5 |     9 |   8 |    8 |   8 |    9 |  8.5 | 7.5 | Live biometric vendor                                      |
| Fees                     |       6 | **8.4** | PROD_WAIVED |  8.5 |     9 |   8 |    8 | 8.5 |    9 |  8.5 |   7 | G-202 live PSP                                             |
| Library                  |       7 | **8.4** | PROD_WAIVED |  8.5 |   8.5 |   8 |    8 |   8 |    9 |  8.5 | 7.5 | ISBN live API env-gated                                    |
| Hostel                   |       9 | **8.3** | PROD_WAIVED |  8.5 |   8.5 |   8 |    8 |   8 |    9 |  8.5 | 7.5 | Dual memory/PG edge cases                                  |
| Transport                |      10 | **8.2** | PROD_WAIVED |    8 |   8.5 |   8 |    8 |   8 |    9 |    8 | 7.5 | No MapLibre; telematics residual                           |
| Examinations / Gradebook |      8+ | **9.1** | PROD_WAIVED |  9.0 |   9.0 | 8.5 |  8.5 | 9.0 |  9.0 |  9.0 | 8.0 | Sealed PDF NON-GOAL (PRD-011); period Select + domain RBAC |
| Timetable                |  nested | **9.0** | PROD_WAIVED |  9.0 |   9.0 | 8.5 |  8.5 | 9.0 |  9.0 |  9.0 | 8.0 | iCal/federation NON-GOAL (PRD-013); clash 409 proven       |
| LMS                      |      10 | **8.0** | PROD_WAIVED |    8 |   8.5 |   8 |    8 | 8.5 |    9 |  8.5 |   7 | LTI/SCORM waived; S3 residual                              |
| Staff / HR               |      12 | **8.6** | PROD_WAIVED |  8.5 |   8.5 |   8 |  8.0 | 9.0 |  8.5 |  8.5 | 7.5 | Domain staff-access RBAC; live IdP residual (G-107)        |
| Health                   |      13 | **8.5** | PROD_WAIVED |  8.5 |   8.5 |   8 |    8 | 8.5 |  8.5 |  8.5 | 7.5 | Special-needs PG hybrid (PRD-004); med-admin NON-GOAL      |
| Communication            |       8 | **7.7** | PROD_WAIVED |    8 |     8 |   8 |  7.5 |   8 |  8.5 |    8 |   7 | Live Twilio/SES residual                                   |
| Admissions               |       5 | **8.0** | PROD_WAIVED |    8 |   8.0 | 7.5 |  7.5 |   8 |  8.5 |  8.0 | 7.5 | OCR waived (product non-goal)                              |
| Parent portal            |      12 | **7.6** | PROD_WAIVED |    8 |     8 | 7.5 |  7.5 |   8 |  8.5 |    8 |   7 | Sandbox payments                                           |
| Workflows                |       5 | **7.8** | PROD_WAIVED |  7.5 |   8.0 | 7.5 |  7.5 |   8 |  8.5 |  7.5 | 7.5 | Live IdP approvers residual (G-107)                        |
| Notifications            |      2+ | **7.7** | PROD_WAIVED |  7.5 |   7.5 | 7.5 |  7.5 | 7.5 |  7.5 |  7.5 |   7 | Live FCM/SMS waived (G-709); honesty banners               |
| Auth                     |      10 | **7.4** | PROD_WAIVED |  7.0 |   7.5 |   8 |    8 |   8 |  6.5 |  8.0 | 6.5 | G-107 live IdP WAIVED; default HS-JWT residual             |
| Reports / Insights       |      6+ | **7.6** | PROD_WAIVED |  7.5 |   7.5 | 7.5 |  7.5 |   8 |  8.0 |  7.5 | 7.0 | Catalogue PG; offline scaffold honesty                     |
| ETL Pipelines            |       1 | **7.9** | PROD_WAIVED |  7.5 |   7.5 | 7.0 |  7.5 | 7.5 |  8.0 |  8.0 | 7.0 | Write smoke closed (PRD-009); thin UI residual             |
| Data warehouse UI        |       4 | **7.3** | PROD_WAIVED |  7.0 |   7.0 | 7.0 |  7.0 | 7.5 |  7.0 |  7.5 | 7.0 | Demo/PARKED honesty (PRD-002); package PARKED              |
| Platform admin           |      6+ | **7.1** | PROD_WAIVED |  7.0 |   6.5 | 7.0 |  7.0 | 7.0 |  6.5 |  7.0 | 6.5 | Ops-stub honesty (PRD-003); operator IdP residual          |

### Parked (not product-scored)

`backend/data-warehouse`, `survey`, `custom-field`, `dashboards`, `theme`, `plugin`, `policy`, `admin-dashboard`, `install` — see `GATEWAY_MOUNT_MATRIX.md`.

### Scoring notes

- **Release pillar** capped because tip CI on `29a8d94` is not yet green (PRD-001).
- **Test pillar** distinguishes inventory smoke vs `E2E_BACKEND_READY` write proof.
- Health Build/Data pulled down by special-needs memory path despite Wave 10 nurse-incident PG.
- Insights/DW/Admin intentionally below 7.0 until scaffolds removed or release-classified.

### Headless uplift notes (2026-09-10)

- Health Data/Security ↑ (special-needs PG confirmed; PHI deny 403 proofs).
- Assessments Data ↑ (report-cards PG when DATABASE_URL).
- DW / Admin honesty ↑ (scaffold classification; package PARKED explicit).
- ETL Test ↑ (pipelines write smoke).
- Multi-module Security ↑ (fees/student write denies).
- Program rollup **~8.5** with waiver board unchanged for live IdP/PSP/comms/farm.
