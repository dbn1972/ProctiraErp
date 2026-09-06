# CivitasOne redesign — program production-readiness scorecard

**Date (UTC):** 2026-09-06  
**Tip branch:** `cursor/enterprise-score-uplift-56c3` (from `main` + Other Portals #20)  
**Method:** enterprise skill · lowest-module uplift · authenticated multidevice captures · ungated inventory smokes · honesty banners  
**Rule:** screenshot = YES only if PNG exists under `/opt/cursor/artifacts` (no invented captures)

## Program verdict

| Metric                      | Value                                                                                                           |
| --------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Weighted program score      | **6.9 / 10** (was 5.6)                                                                                          |
| Screens scored              | 126 (≈124 redesign inventory)                                                                                   |
| Modules Ready w/ waivers    | **8 / 10** (Auth, Overview&People, Academics, Services, Insights, Platform Admin, Registration, Public Website) |
| Screens with verified shots | **~199** across packs (was ~43)                                                                                 |
| Overall claim               | **Not 10/10** — stubs, gated live e2e, and mobile device IT remain                                              |

### Why not 10/10 (honest residual)

1. Platform Admin + Insights still use stub/scaffold backends (honesty banners shipped; live APIs not invented).
2. Live write-path Playwright still gated on `E2E_BACKEND_READY`.
3. Mobile Flutter: 36/36 unit tests green; **zero native device PNGs**; Linux IT blocked (Ninja/CXX).
4. Other Portals docs/dashboard/marketplace remain coming-soon stubs.
5. Staff write-path e2e and Examinations dedicated suite still open.

## Module scores (post-uplift)

| Module                      | Screens | Score /10 | Screenshots                | Enterprise audit | Verdict                          |
| --------------------------- | ------: | --------: | -------------------------- | ---------------- | -------------------------------- |
| Web App — Auth              |       5 |   **8.0** | YES (multi-device)         | YES              | Ready w/ waivers                 |
| Web App — Overview & People |      13 |   **7.0** | YES (pack)                 | YES              | Ready w/ waivers                 |
| Web App — Academics         |      22 |   **6.5** | YES Institutions + prior   | Partial formal   | Ready w/ waivers (exam e2e thin) |
| Web App — Services          |      15 |   **7.0** | YES Health/Workflows/Schol | YES              | Ready w/ waivers (demo seeds)    |
| Web App — Insights & System |      12 |   **7.0** | YES (39 PNGs)              | YES              | Ready w/ waivers (scaffold APIs) |
| Platform Admin Console      |      13 |   **7.0** | YES (13 PNGs)              | YES (stubs)      | Ready w/ waivers (stub APIs)     |
| Registration Portal         |       7 |   **8.0** | YES (7 PNGs)               | YES              | Ready w/ waivers                 |
| Public Website              |      12 |   **8.5** | YES (12 PNGs)              | YES              | Ready w/ waivers                 |
| Other Portals               |       5 |   **5.5** | YES (incl. stubs)          | YES              | Not ready (stub surfaces)        |
| Mobile App (native)         |      22 |   **6.0** | NONE (Flutter device)      | YES + unit green | Not ready (device IT)            |

## Subsystem scores (selected)

| Area              | Score | Shots                     |
| ----------------- | ----: | ------------------------- |
| Public Website    |   8.5 | YES                       |
| Auth surfaces     |   8.0 | YES                       |
| Registration      |   8.0 | YES                       |
| Scholarships      |   7.9 | YES                       |
| Institutions      |   7.0 | YES (24 PNGs)             |
| Overview & People |   7.0 | YES                       |
| Insights & System |   7.0 | YES                       |
| Platform Admin    |   7.0 | YES (stub banner visible) |
| Workflows         |   7.0 | YES                       |
| Health            |   6.5 | YES                       |
| Mobile overall    |   6.0 | NONE (unit 36/36)         |
| Other Portals     |   5.5 | YES                       |

## Verified screenshot packs (real)

- `/opt/cursor/artifacts/auth-audit/` (~21)
- `/opt/cursor/artifacts/overview-people-audit/` (~23)
- `/opt/cursor/artifacts/academics-audit/` (14)
- `/opt/cursor/artifacts/scholarships-audit/` (6)
- `/opt/cursor/artifacts/other-portals-audit/` (15)
- `/opt/cursor/artifacts/institutions-audit/` (24) — **authenticated multidevice**
- `/opt/cursor/artifacts/health-audit/` (15)
- `/opt/cursor/artifacts/workflows-audit/` (15)
- `/opt/cursor/artifacts/insights-system-audit/` (39)
- `/opt/cursor/artifacts/platform-admin-audit/` (13)
- `/opt/cursor/artifacts/registration-portal-audit/` (7)
- `/opt/cursor/artifacts/public-website-audit/` (12)
- `/opt/cursor/artifacts/mobile-flutter-audit/` — **tests only** (no device PNGs)

## Uplift shipped this branch

1. Stub/scaffold honesty banners (Platform Admin + Insights).
2. Ungated inventory smokes: admin `02-…`, web `14`–`18`.
3. Enterprise audits: Overview&People, Institutions; Health/Workflows capture citations.
4. Authenticated web captures (cookie host must match `PLAYWRIGHT_BASE_URL`).
5. Flutter unit suite re-verified 36/36.

Canvas: `/cursor/stores/user/canvases/ceb85c59-c8af-4f46-bd7c-25a932bb1769/source.canvas.tsx`
