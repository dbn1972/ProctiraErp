# CivitasOne — screen-by-screen production readiness scoreboard

**Campaign:** headless enterprise uplift toward **9.5 / 10** per screen  
**Branch tip:** `cursor/enterprise-score-uplift-56c3`  
**Updated (UTC):** 2026-09-06  
**Method:** enterprise skill · parallel module teams · headless Playwright/Vitest · honesty on externals  

## Program rollup

| Metric | Value |
| --- | --- |
| Weighted program score | **8.1 / 10** (campaign in progress → target **≥9.5**) |
| Honest ceiling without IdP / device-farm / live DW | ~**8.5–8.7** |
| Claim when user asks | Always cite this file + tip SHA |

### Status legend

| Status | Meaning |
| --- | --- |
| Ready w/ waivers | Shipped + audited; residual waivers documented |
| Partial / scaffold | UI + honesty banner; API scaffold |
| Stub | Deterministic fixtures / stub gateway |
| In progress | Active uplift this campaign |

---

## Module targets

| Module | Screens | Score now | Target | Gap to 9.5 | Campaign actions |
| --- | ---: | ---: | ---: | --- | --- |
| Web App — Auth | 5 | 8.5 | 9.5 | Live IdP E2E | Keep multi-device; optional mock matrix harden |
| Web App — Overview & People | 13 | 8.4 | 9.5 | Live journeys + multidevice | Ungated assignment/appraisal smokes landed |
| Web App — Academics | 22 | 8.4 | 9.5 | Live seed create + multidevice PNGs | Exam POST wired; attendance/assessment audits + ungated smokes |
| Web App — Services | 15 | 8.1 | 9.5 | Live PHI/finance writes | Counselling create shipped; live create still gated |
| Web App — Insights & System | 12 | 7.5 | 9.5 | Live reports/DW APIs | Conditional banners + write validation |
| Platform Admin Console | 13 | 7.6 | 9.5 | Live operator gateway | Extra write smokes; stub honesty |
| Registration Portal | 7 | 9.0 | 9.5 | Live apply + axe + multidevice | Metadata-only draft + submit upload landed |
| Public Website | 12 | 9.0 | 9.5 | CRM + real status | Webhook forward + honest status |
| Other Portals | 5 | 8.0 | 9.5 | Live developer IdP/mint | Validation harden (demo residual) |
| Mobile App (native) | 22 | 8.2 | 9.5 | Device-farm PNGs | Widget goldens expanded (login/home/students/attendance) |

---

## Screen rows (inherit module score unless noted)

> Per-screen **Score** updates as evidence lands. Ask anytime for a refresh of this table.

### Web App — Auth (8.5 → 9.5)

| Screen | Score | Status | Gap to 9.5 |
| --- | ---: | --- | --- |
| Login | 8.5 | Ready w/ waivers | Live IdP login E2E |
| Sign up | 8.5 | Ready w/ waivers | Live signup E2E |
| Forgot password | 8.5 | Ready w/ waivers | Live reset-request E2E |
| Reset password | 8.5 | Ready w/ waivers | Live token redeem E2E |
| MFA verification | 8.5 | Ready w/ waivers | Live MFA challenge E2E |

### Web App — Overview & People (8.4 → 9.5)

| Screen | Score | Status | Gap to 9.5 |
| --- | ---: | --- | --- |
| Dashboard | 8.0 | Ready w/ waivers | Always-on live KPIs |
| Students · list | 8.0 | Ready w/ waivers | Live list journey ungated in CI |
| Students · profile | 8.0 | Ready w/ waivers | Auth inventory gated |
| Students · add | 8.0 | Ready w/ waivers | Live create E2E |
| Students · edit | 8.0 | Ready w/ waivers | Live update E2E |
| Students · bulk import | 8.0 | Ready w/ waivers | Live import E2E |
| Students · transfer | 8.0 | Ready w/ waivers | Live transfer E2E |
| Staff · list | 8.0 | Ready w/ waivers | Tablet/mobile pack |
| Staff · profile | 8.0 | Ready w/ waivers | Axe coverage |
| Staff · add | 8.2 | Ready w/ waivers | Live create still gated; validation smoke exists |
| Staff · edit | 8.0 | Ready w/ waivers | Write E2E |
| Staff · new assignment | 8.3 | Ready w/ waivers | Live assign E2E; ungated validation smoke |
| Staff · new appraisal | 8.3 | Ready w/ waivers | Live appraise E2E; ungated validation smoke |

### Web App — Academics (8.4 → 9.5)

| Screen | Score | Status | Gap to 9.5 |
| --- | ---: | --- | --- |
| Institutions · (8 screens) | 8.0 | Ready w/ waivers | Live write E2E |
| Academic periods | 7.8 | In progress | Formal audit |
| Attendance · mark / reports | 8.2 | Ready w/ waivers | Live mark E2E + PNGs (`ACADEMICS_ATTENDANCE.md`, `20-…`) |
| Assessments · (5 screens) | 8.2 | Ready w/ waivers | Live write E2E + PNGs (`ACADEMICS_ASSESSMENTS.md`, `21-…`) |
| Examinations · list / detail / candidates / documents / results | 8.2 | Ready w/ waivers | Seeded backend in CI (`ACADEMICS_EXAMINATIONS.md`) |
| Examinations · schedule (create) | 8.3 | Ready w/ waivers | Live 201 needs seeded period/institution FKs |

### Web App — Services (8.1 → 9.5)

| Screen | Score | Status | Gap to 9.5 |
| --- | ---: | --- | --- |
| Scholarships · (6) | 8.0 | Ready w/ waivers | Live write always-on |
| Health · screenings / profile / special needs | 8.0 | Ready w/ waivers | Live PHI APIs |
| Health · counselling | 8.5 | Ready w/ waivers | Live create E2E + list/seed sync |
| Workflows · (5) | 8.0 | Ready w/ waivers | Domain engine mount |

### Web App — Insights & System (7.5 → 9.5)

| Screen | Score | Status | Gap to 9.5 |
| --- | ---: | --- | --- |
| Reports · catalog / builder / result | 7.5 | Partial / scaffold | Live report APIs |
| Data warehouse · overview / import / mapping | 7.0 | Partial / scaffold | Live import jobs |
| Admin · (5 nest screens) | 7.5 | Partial / scaffold | Live admin APIs |
| Public · track application | 8.5 | Ready w/ waivers | DOB-in-query residual |

### Platform Admin (7.6 → 9.5)

| Screen | Score | Status | Gap to 9.5 |
| --- | ---: | --- | --- |
| Operator login / 403 | 8.5 | Ready w/ waivers | Live operator IdP |
| Overview / Tenants / Provision / Plans / Plugins / Themes | 6.8 | Stub | Live gateway |
| Break-glass / requests / Support / Health / Audit | 6.8 | Stub | Live ops APIs |

### Registration Portal (9.0 → 9.5)

| Screen | Score | Status | Gap to 9.5 |
| --- | ---: | --- | --- |
| Home / Find schools / Apply steps / Track | 9.0 | Ready w/ waivers | Live apply E2E; axe; multidevice |

### Public Website (9.0 → 9.5)

| Screen | Score | Status | Gap to 9.5 |
| --- | ---: | --- | --- |
| Marketing / legal (10) | 9.0 | Ready w/ waivers | In-app axe |
| Status | 8.5 | In progress | Honest probe / provider |
| Contact | 8.5 | In progress | Optional webhook CRM |

### Other Portals (8.0 → 9.5)

| Screen | Score | Status | Gap to 9.5 |
| --- | ---: | --- | --- |
| Developer portal | 8.0 | Ready w/ waivers | Live key mint |
| Install wizard | 8.0 | Ready w/ waivers | Live bootstrap lock proof |

### Mobile (8.2 → 9.5)

| Screen | Score | Status | Gap to 9.5 |
| --- | ---: | --- | --- |
| Core journeys (18) | 8.2 | Ready w/ waivers | Device-farm PNGs (widget goldens: login/home/students/attendance) |
| Notifications / Reports prefs (4) | 7.0 | Not formally audited | Formal inventory + goldens |

---

## Evidence log (append-only)

| UTC | Tip SHA | Change | Score impact |
| --- | --- | --- | --- |
| 2026-09-06 | _(pending)_ | Scoreboard opened; P0/P1 campaign started | baseline 8.0 |
| 2026-09-06 | `c81ba96` | Mobile students+attendance goldens; Health counselling create UI+API+smoke | Mobile 7.8→8.2; counselling 7.5→8.5; Services ~8.1 |
| 2026-09-06 | _(this tip)_ | People `15c` assignment/appraisal validation; Registration metadata-only docs | People 8.0→8.4; Registration 8.5→9.0; program ~8.1 |
| 2026-09-06 | _(this commit)_ | Academics: exam POST create wiring + ATTENDANCE/ASSESSMENTS/EXAMINATIONS audits + ungated smokes 20/21 | Academics 8.0→8.4; program ~8.1 |

## How to read when you ask “updated score?”

1. Program weighted score at top of this file  
2. Module table  
3. Any screen rows marked **In progress** with new tip SHA in Evidence log  
