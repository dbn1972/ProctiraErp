# Waiver board refresh — 2026-09-10 (headless)

Owner: cloud agent on `cursor/w10-health-dw-ux-56c3` (PR #48).  
Secrets / vendors **not** available this run — do not fake live proofs.

| ID      | Topic                       | Status                | Expires / review                         |
| ------- | --------------------------- | --------------------- | ---------------------------------------- |
| G-107   | Live IdP / Keycloak login   | **WAIVED**            | Re-open when staging realm secrets exist |
| G-202   | Live PSP sandbox receipt    | **WAIVED**            | Re-open with PSP sandbox keys            |
| G-709   | Live email/SMS/push         | **WAIVED**            | Re-open with Twilio/SES/FCM sandbox      |
| G-506   | Statuspage / pager          | **WAIVED** (non-goal) | Fund ops epic or keep                    |
| PRD-007 | Flutter device-farm         | **WAIVED** (non-goal) | Farm lane or keep                        |
| PRD-010 | MapLibre transport map      | **NON-GOAL**          | SVG+OSM accepted                         |
| PRD-011 | CA-sealed transcript PDF    | **NON-GOAL**          | HMAC stub accepted                       |
| PRD-012 | LTI/SCORM                   | **WAIVED**            | Keep LMS waiver                          |
| PRD-013 | Timetable iCal / federation | **NON-GOAL**          | Clash 409 + PG schedule accepted         |
