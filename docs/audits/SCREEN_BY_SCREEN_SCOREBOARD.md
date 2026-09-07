# CivitasOne — screen-by-screen production readiness scoreboard

**Campaign:** headless enterprise uplift toward **9.5 / 10** per screen  
**Branch tip:** `cursor/enterprise-score-uplift-56c3`  
**Updated (UTC):** 2026-09-07  
**Method:** enterprise skill · parallel module teams · headless Playwright/Vitest · honesty on externals

## Program rollup

| Metric                                           | Value                                                                                                                                                                     |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Weighted program score                           | **9.4 / 10** (Auth / Public / Registration / People / Academics / Services / Insights / Admin / Portals at 9.5; Mobile **9.3**; Android device-farm + live IdP still cap) |
| Honest ceiling without IdP / device-farm         | ~**9.4**                                                                                                                                                                  |
| Campus services (comms/transport/hostel/library) | **9.5** w/ waivers (tip CI billing-blocked; live Twilio/FCM/SMTP external)                                                                                                |
| Claim when user asks                             | Always cite this file + tip SHA                                                                                                                                           |

### Status legend

| Status             | Meaning                                        |
| ------------------ | ---------------------------------------------- |
| Ready w/ waivers   | Shipped + audited; residual waivers documented |
| Partial / scaffold | UI + honesty banner; API scaffold              |
| Stub               | Deterministic fixtures / stub gateway          |
| In progress        | Active uplift this campaign                    |

---

## Module targets

| Module                      | Screens | Score now | Target | Gap to 9.5                 | Campaign actions                                        |
| --------------------------- | ------: | --------: | -----: | -------------------------- | ------------------------------------------------------- |
| Web App — Auth              |       5 |   **9.5** |    9.5 | — (live IdP waived)        | Ungated axe+validation matrix desktop+mobile            |
| Web App — Overview & People |      13 |   **9.5** |    9.5 | Live IdP happy-path writes | Student/staff write smokes + 39 md PNGs + live seed IDs |
| Web App — Academics         |      22 |   **9.5** |    9.5 | Live Prisma domain tables  | Attendance/assessment/exam write smokes + 26 md PNGs    |
| Web App — Services          |      15 |   **9.5** |    9.5 | IdP / device-farm          | PG counselling + services write smokes                  |
| Web App — Insights & System |      12 |   **9.5** |    9.5 | IdP / field-mapping upload | Live Insights plugin + generate/import proofs           |
| Platform Admin Console      |      13 |   **9.5** |    9.5 | Operator IdP / axe pack    | Prefer-live gateway + expanded smokes                   |
| Registration Portal         |       7 |   **9.5** |    9.5 | — (live apply waived)      | Axe apply/track + multidevice 21 PNGs                   |
| Public Website              |      12 |   **9.5** |    9.5 | — (CRM webhook residual)   | Axe + always-on contact API + multidevice               |
| Other Portals               |       5 |   **9.5** |    9.5 | — (live IdP/mint waived)   | CSRF/lock BFF + reserved-name validation + ungated axe  |
| Mobile App (native)         |      22 |   **9.3** |    9.5 | Android device-farm PNGs   | Goldens 16 shells + Linux IT/PNGs + analyze clean       |

---

## Screen rows (inherit module score unless noted)

> Per-screen **Score** updates as evidence lands. Ask anytime for a refresh of this table.

### Web App — Auth (**9.5**)

| Screen           | Score | Status           | Gap / residual beyond 9.5 |
| ---------------- | ----: | ---------------- | ------------------------- |
| Login            |   9.5 | Ready w/ waivers | Live IdP only (dated)     |
| Sign up          |   9.5 | Ready w/ waivers | Live IdP only (dated)     |
| Forgot password  |   9.5 | Ready w/ waivers | Live IdP only (dated)     |
| Reset password   |   9.5 | Ready w/ waivers | Live IdP only (dated)     |
| MFA verification |   9.5 | Ready w/ waivers | Live IdP only (dated)     |

### Web App — Overview & People (**9.5**)

| Screen                 | Score | Status           | Gap / residual beyond 9.5                   |
| ---------------------- | ----: | ---------------- | ------------------------------------------- |
| Dashboard              |   9.5 | Ready w/ waivers | Always-on live KPIs without mock gateway    |
| Students · list        |   9.5 | Ready w/ waivers | Live list journey with IdP                  |
| Students · profile     |   9.5 | Ready w/ waivers | Auth inventory gated on IdP                 |
| Students · add         |   9.5 | Ready w/ waivers | Live create API (validation smoke ☑)        |
| Students · edit        |   9.5 | Ready w/ waivers | Live update E2E                             |
| Students · bulk import |   9.5 | Ready w/ waivers | Live import E2E                             |
| Students · transfer    |   9.5 | Ready w/ waivers | Live transfer E2E                           |
| Staff · list           |   9.5 | Ready w/ waivers | — md pack complete                          |
| Staff · profile        |   9.5 | Ready w/ waivers | Axe coverage residual                       |
| Staff · add            |   9.5 | Ready w/ waivers | Live create still gated; validation smoke ☑ |
| Staff · edit           |   9.5 | Ready w/ waivers | Live write E2E                              |
| Staff · new assignment |   9.5 | Ready w/ waivers | Live assign E2E; validation smoke ☑         |
| Staff · new appraisal  |   9.5 | Ready w/ waivers | Live appraise E2E; validation smoke ☑       |

Evidence: `OVERVIEW_PEOPLE_DASHBOARD_STUDENTS_STAFF.md` · `/opt/cursor/artifacts/overview-people-audit/` (39 md PNGs + live-seed-ids.json).

### Web App — Academics (**9.5**)

| Screen                                                          | Score | Status           | Gap / residual beyond 9.5                   |
| --------------------------------------------------------------- | ----: | ---------------- | ------------------------------------------- |
| Institutions · (8 screens)                                      |   9.5 | Ready w/ waivers | Live write E2E                              |
| Academic periods                                                |   9.5 | Ready w/ waivers | Formal deep audit residual                  |
| Attendance · mark / reports                                     |   9.5 | Ready w/ waivers | Live mark needs classes table (`20b` ☑)     |
| Assessments · (5 screens)                                       |   9.5 | Ready w/ waivers | Live scheme POST (`21b` ☑)                  |
| Examinations · list / detail / candidates / documents / results |   9.5 | Ready w/ waivers | Seeded exam detail gated                    |
| Examinations · schedule (create)                                |   9.5 | Ready w/ waivers | Live 201 needs examinations table           |
| Examinations · board export packs (CBSE/ICSE/MH)                |   9.4 | Ready w/ waivers | Live packs ☑; IdP/RBAC/device-farm residual |

Evidence: `ACADEMICS_*.md` · `DEV_SIS_BOARD_EXPORTS.md` · `/opt/cursor/artifacts/academics-audit/` (26 md PNGs) · `/opt/cursor/artifacts/sis-board-exports/`.

### Web App — Services (**9.5**)

| Screen                                        | Score | Status           | Gap to 9.5                                 |
| --------------------------------------------- | ----: | ---------------- | ------------------------------------------ |
| Scholarships · (6)                            |   9.5 | Ready w/ waivers | Live IdP; finance engine residual thin     |
| Health · screenings / profile / special needs |   9.3 | Ready w/ waivers | Non-counselling PHI still in-memory        |
| Health · counselling                          |   9.5 | Ready w/ waivers | PG-backed create + list sync; IdP residual |
| Workflows · (5)                               |   9.5 | Ready w/ waivers | Domain engine mount residual               |
| Notifications · inbox / prefs / devices       |   9.5 | Ready w/ waivers | Live SMTP/FCM/Twilio (sandbox)             |
| Communication · campaigns / emergency         |   9.5 | Ready w/ waivers | Live provider adapters (sandbox)           |
| Transport · routes / vehicles / assignments   |   9.5 | Ready w/ waivers | GPS non-goal                               |
| Hostel · occupancy / leave / visitors         |   9.5 | Ready w/ waivers | Mess fees non-goal                         |
| Library · catalog / circulation / clearance   |   9.5 | Ready w/ waivers | OPAC non-goal                              |

### Web App — Insights & System (**9.5**)

| Screen                                       | Score | Status           | Gap to 9.5                            |
| -------------------------------------------- | ----: | ---------------- | ------------------------------------- |
| Reports · catalog / builder / result         |   9.5 | Ready w/ waivers | Live generate via Insights UI plugin  |
| Data warehouse · overview / import / mapping |   9.4 | Ready w/ waivers | Field-mapping upload headers residual |
| Admin · (5 nest screens)                     |   9.3 | Ready w/ waivers | Permission matrix mutations           |
| Public · track application                   |   9.5 | Ready w/ waivers | DOB-in-query residual                 |

### Platform Admin (**9.5**)

| Screen                                                    | Score | Status           | Gap to 9.5                     |
| --------------------------------------------------------- | ----: | ---------------- | ------------------------------ |
| Operator login / 403                                      |   9.3 | Ready w/ waivers | Live operator IdP              |
| Overview / Tenants / Provision / Plans / Plugins / Themes |   9.5 | Ready w/ waivers | Prefer-live gateway aggregates |
| Break-glass / requests / Support / Health / Audit         |   9.5 | Ready w/ waivers | Expanded `05` smokes           |

### Registration Portal (**9.5**)

| Screen                                    | Score | Status           | Gap / residual beyond 9.5     |
| ----------------------------------------- | ----: | ---------------- | ----------------------------- |
| Home / Find schools / Apply steps / Track |   9.5 | Ready w/ waivers | Live apply API (dated waiver) |

### Public Website (**9.5**)

| Screen                 | Score | Status           | Gap / residual beyond 9.5     |
| ---------------------- | ----: | ---------------- | ----------------------------- |
| Marketing / legal (10) |   9.5 | Ready w/ waivers | —                             |
| Status                 |   9.5 | Ready w/ waivers | External status provider opt. |
| Contact                |   9.5 | Ready w/ waivers | CRM webhook env residual only |

### Other Portals (**9.5**)

| Screen           | Score | Status           | Gap / residual beyond 9.5            |
| ---------------- | ----: | ---------------- | ------------------------------------ |
| Developer portal |   9.5 | Ready w/ waivers | Live key mint (waived 2026-09-06)    |
| Install wizard   |   9.5 | Ready w/ waivers | Live upstream stack + localhost bind |

### Mobile (9.3 → 9.5)

| Screen                            | Score | Status           | Gap to 9.5                                              |
| --------------------------------- | ----: | ---------------- | ------------------------------------------------------- |
| Core journeys (18)                |   9.3 | Ready w/ waivers | Android device-farm (16 goldens + Linux IT/PNGs ☑)      |
| Notifications / Reports prefs (4) |   9.3 | Ready w/ waivers | Android device-farm (prefs/reports goldens + Linux PNG) |

---

## Evidence log (append-only)

| UTC        | Tip SHA      | Change                                                                                                                                                                          | Score impact                                                                  |
| ---------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 2026-09-06 | live-db      | Raw SQL live Postgres onboard: 3 boards × 6 schools × 500 students                                                                                                              | Data-plane cert PASS                                                          |
| 2026-09-06 | _(pending)_  | Scoreboard opened; P0/P1 campaign started                                                                                                                                       | baseline 8.0                                                                  |
| 2026-09-06 | `c81ba96`    | Mobile goldens; Health counselling create UI+API+smoke                                                                                                                          | counselling 8.5; Services ~8.1                                                |
| 2026-09-06 | a0245f4+     | Academics exam POST + ATTENDANCE/ASSESSMENTS audits                                                                                                                             | Academics 8.4                                                                 |
| 2026-09-06 | `8b87585`    | Insights conditional scaffold + Admin `04` + Public                                                                                                                             | Insights/Admin ~8.2; Public 9.3                                               |
| 2026-09-06 | `effdd5b`    | PG counselling; Insights/Admin live plugins; Services `19`/`17b`/`14c`/`05`                                                                                                     | Services/Insights/Admin **9.5**                                               |
| 2026-09-06 | `f201bf8`    | Other Portals axe/smokes + Mobile goldens 10 shells                                                                                                                             | Portals **9.2**; Mobile **9.1**; program ~**9.0**                             |
| 2026-09-06 | _(this tip)_ | People+Academics: `15d`/`20b`/`21b` write smokes; fake-session cookie host; HybridHealthRepository boot fix; 90 viewport captures → 39+26 md PNGs; Playwright 40 pass / 32 skip | People **9.5**; Academics **9.5**; program ~**9.1**                           |
| 2026-09-06 | _(this tip)_ | Auth ungated matrix (chromium+mobile); Public axe+contact always-on+multidevice; Registration axe+multidevice; contrast a11y fixes                                              | Auth/Public/Registration **9.5**; program ~**9.3**                            |
| 2026-09-06 | _(this tip)_ | Mobile: goldens 10→16; Linux xvfb IT (login/tenant/students/attendance/notif); real `linux_*.png`; Inter fonts bundled; Android device-farm residual only                       | Mobile **9.3**; program ~**9.4**                                              |
| 2026-09-06 | _(this tip)_ | Other Portals: install CSRF/token BFF + bootstrap lock ungated smoke; backend 409 lock; API-key reserved-name harden; Playwright 15+7 pass                                      | Portals **9.5**; program ~**9.4**                                             |
| 2026-09-06 | `a3c456b`    | SIS epic WS0–WS4 on **server** live Postgres: timetable, master schedule+conflicts, gradebook/GPA/transcripts, CBSE/ICSE/MH-STATE export packs (raw SQL, no Prisma)             | Academics product parity uplift; program still **~9.4** (IdP/device-farm cap) |
| 2026-09-07 | `eb4a536`+   | Campus WS1–WS5: Pg stores, dual-confirm emergency, sandbox email/push/SMS, gated write smokes (`20c`/`21c`/`21d`), cross-tenant denies; tip CI **billing-blocked**              | Services campus screens **9.5** w/ waivers; program still **~9.4**            |
| 2026-09-07 | `083f56c`+   | WS6 close: tip CI green (PR #23); five campus test audits Tip CI ☑; local replay 39/39; billing residual removed                                                                | Campus WS0–WS6 **Done\***; program still **~9.4** (IdP/device-farm/providers) |

## How to read when you ask “updated score?”

1. Program weighted score at top of this file
2. Module table
3. Any screen rows marked **In progress** with new tip SHA in Evidence log
