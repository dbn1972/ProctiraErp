# Waiver board refresh — 2026-09-12 (UTC, headless)

Owner: cloud agent on `cursor/fees-g202-waiver-refresh-56c3` (Fees Blackbaud-depth **F4** — docs only).  
Prior board: `docs/audits/WAIVER_BOARD_20260910.md`.  
Secrets / vendors **not** available this run — do not fake live PSP proofs.  
**Honesty:** Fees remains **PROD_WAIVED** — **do not claim Blackbaud-complete**.

| ID      | Topic                         | Status                            | Expires / review                                                                                                                                              |
| ------- | ----------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G-107   | Live IdP / Keycloak login     | **WAIVED**                        | Re-open when staging realm secrets exist                                                                                                                      |
| G-202   | Live PSP sandbox receipt      | **WAIVED** (refreshed 2026-09-12) | **Reason:** no sandbox PSP keys in agent env. **Residual:** tip e2e paid→receipt against provider when keys exist. See `docs/audits/DEV_FEES_G202_WAIVER.md`. |
| G-709   | Live email/SMS/push           | **WAIVED**                        | Re-open with Twilio/SES/FCM sandbox                                                                                                                           |
| G-506   | Statuspage / pager            | **WAIVED** (non-goal)             | Fund ops epic or keep                                                                                                                                         |
| PRD-007 | Flutter device-farm           | **WAIVED** (non-goal)             | Farm lane or keep                                                                                                                                             |
| PRD-010 | MapLibre transport map        | **NON-GOAL**                      | SVG+OSM accepted                                                                                                                                              |
| PRD-011 | CA-sealed transcript PDF      | **NON-GOAL**                      | HMAC stub accepted                                                                                                                                            |
| PRD-012 | LTI/SCORM                     | **WAIVED**                        | Keep LMS waiver                                                                                                                                               |
| PRD-013 | Timetable iCal / federation   | **NON-GOAL**                      | Clash 409 + PG schedule accepted                                                                                                                              |
| PRD-014 | Admissions OCR / ID scan      | **NON-GOAL**                      | Manual capture accepted                                                                                                                                       |
| PRD-015 | DW live connectors / admin CP | **NON-GOAL** (demo)               | Honesty banners + PARKED package                                                                                                                              |
| PRD-016 | Public apply + applicant IdP  | **NON-GOAL** (dated)              | Until funded IdP + public-apply epic; dated **2026-09-12** (A3). See `WAIVER_BOARD_20260910.md` + `PRODUCT_ADMISSIONS_ENROL_JOURNEY.md`                       |
| PRD-017 | Exam malpractice + formal appeals beyond re-eval | **NON-GOAL** (dated) | Dated **2026-09-12** (P1-EXAM). Invigilation + durable docs + marks re-eval (IA alias **appeal**) ship; no malpractice case mgmt / tribunal appeals. See `PRODUCT_EXAM_INVIGILATE_APPEALS.md` + `DEV_EXAM_INVIGILATE_APPEALS.md`. |
