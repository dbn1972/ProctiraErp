# Enterprise UX design review — Parent portal

**Scope:** Parent / family portal · messages · consents · fees  
**Branch / tip:** `cursor/parent-student-portal-56c3`  
**Date (UTC):** 2026-09-07  
**Reviewer / agent:** Cloud agent (enterprise-ux-designer skill)  
**Paired test audit:** `docs/audits/PARENT_PORTAL_MESSAGING_CONSENT_FEES.md`  
**Captures root:** `apps/web/screens/parent/` (+ `/opt/cursor/artifacts/parent-portal-ux-review/`)

## 0. Inventory

| Screen   | Route              | Desktop | Tablet | Mobile | Notes                 |
| -------- | ------------------ | ------- | ------ | ------ | --------------------- |
| Home     | `/parent`          | ☑       | ☑      | ☑      | `CAPTURE_ROLE=parent` |
| Messages | `/parent/messages` | ☑       | ☑      | ☑      |                       |
| Consents | `/parent/consents` | ☑       | ☑      | ☑      |                       |
| Fees     | `/parent/fees`     | ☑       | ☑      | ☑      |                       |

**Capture command:** `CAPTURE_MODULES=parent CAPTURE_ROLE=parent node scripts/capture-screens.mjs desktop tablet mobile` → **12/12** PNGs.

## 1. Rubric scores (1–10) — after P0/P1 fixes

| Screen   |  IA | Hierarchy | Density | Empty/err | Mobile | Forms | Brand | Copy | Avg |
| -------- | --: | --------: | ------: | --------: | -----: | ----: | ----: | ---: | --: |
| Home     |   9 |         8 |       8 |         9 |      9 |     — |     9 |    9 | 8.7 |
| Messages |   9 |         8 |       8 |         9 |      9 |     8 |     9 |    9 | 8.6 |
| Consents |   9 |         8 |       9 |         9 |      9 |     8 |     9 |    9 | 8.8 |
| Fees     |   9 |         8 |       9 |         9 |      9 |     8 |     9 |    9 | 8.8 |

**Module UX score (avg): ~8.7**

## 2. Findings

### P0 (must fix) — cleared

| ID   | Screen | Finding                                                                        | Fix / evidence                           |
| ---- | ------ | ------------------------------------------------------------------------------ | ---------------------------------------- |
| P0-1 | All    | Parent-facing copy leaked API paths (`/api/v1/parent-portal`, GET/POST routes) | Replaced with plain-language subtitles   |
| P0-2 | Shell  | Weak product signal (“Parent portal” only)                                     | Header → **Family portal** + ProctiraERP |

### P1 — cleared / residual

| ID   | Screen    | Finding                                     | Fix / waiver                                                   |
| ---- | --------- | ------------------------------------------- | -------------------------------------------------------------- |
| P1-1 | Home/Fees | “Sandbox payments” jargon                   | Softened to “online payments” / invoice copy                   |
| P1-2 | Lists     | Duplicate empty CardDescription + body      | Distinct description vs helper body                            |
| P1-3 | Messages  | Student ID free-text (UUID) vs child picker | **Residual** — needs linked-child select when names API exists |
| P1-4 | Home      | Shortcut button weight (filled vs outline)  | Keep Messages as primary; intentional                          |

### P2

| ID   | Screen | Finding                                 | Backlog                        |
| ---- | ------ | --------------------------------------- | ------------------------------ |
| P2-1 | All    | Child display names (UUID truncations)  | When SIS name fields available |
| P2-2 | Home   | Card shortcuts vs bottom nav redundancy | Acceptable for hub             |

## 3. Decisions / changes landed

| Change                             | Files                         | Result                  |
| ---------------------------------- | ----------------------------- | ----------------------- |
| Plain-language copy + empty states | `(parent)/parent/**`          | Parent-safe copy        |
| Family portal chrome               | `ParentPortalShell.tsx`       | Distinct from staff ERP |
| Capture role support               | `scripts/capture-screens.mjs` | `CAPTURE_ROLE=parent`   |

## 4. Sign-off

| Claim                             | Status                                                             |
| --------------------------------- | ------------------------------------------------------------------ |
| P0 cleared                        | ☑                                                                  |
| P1 cleared or waived              | ☑ (P1-3 residual dated)                                            |
| Multidevice PNGs reviewed         | ☑ 12/12                                                            |
| Scoreboard updated if score moved | ☑ → **9.0 Ready w/ waivers** (UX uplift; live PSP / Flutter still) |

**Residual risks:** Linked-child picker; live PSP; Flutter API-thick clients; device-farm Android.
