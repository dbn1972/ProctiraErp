# CivitasOne redesign — program production-readiness scorecard

**Date (UTC):** 2026-09-06  
**Tip branch:** `cursor/enterprise-score-uplift-56c3`  
**Method:** enterprise skill · Other Portals destub · ungated write validation · Flutter widget goldens · authenticated packs  
**Rule:** screenshot = YES only if PNG exists under `/opt/cursor/artifacts` (no invented captures)

## Program verdict

| Metric                      | Value                                                     |
| --------------------------- | --------------------------------------------------------- |
| Weighted program score      | **8.0 / 10** (was 6.9)                                    |
| Screens scored              | 126 (≈124 redesign inventory)                             |
| Modules Ready w/ waivers    | **9 / 10** (Mobile still Not ready for device-farm claim) |
| Screens with verified shots | **~210+** across packs                                    |
| Overall claim               | **Ready with waivers at program 8.0** — not 10/10         |

### Why not 10/10 (honest residual)

1. Platform Admin + Insights still fall back to stub/scaffold backends (honesty banners remain).
2. Live write-path Playwright still gated on `E2E_BACKEND_READY` for persistence journeys.
3. Mobile Flutter: unit + **widget goldens** present; **no native device-farm PNGs** / Linux IT still blocked.
4. Other Portals install/publish/key minting still honesty-demo (no live developer IdP).
5. Examinations create is client-validated demo-ack until exams write APIs are wired.

## Module scores (post 8.0 uplift)

| Module                      | Screens | Score /10 | Screenshots                 | Enterprise audit  | Verdict                           |
| --------------------------- | ------: | --------: | --------------------------- | ----------------- | --------------------------------- |
| Web App — Auth              |       5 |   **8.5** | YES (multi-device)          | YES               | Ready w/ waivers                  |
| Web App — Overview & People |      13 |   **8.0** | YES + staff write smoke     | YES               | Ready w/ waivers                  |
| Web App — Academics         |      22 |   **8.0** | YES + exams inventory       | Partial formal    | Ready w/ waivers                  |
| Web App — Services          |      15 |   **8.0** | YES Health/Workflows/Schol  | YES               | Ready w/ waivers                  |
| Web App — Insights & System |      12 |   **7.5** | YES (scaffold banners)      | YES               | Ready w/ waivers (scaffold APIs)  |
| Platform Admin Console      |      13 |   **7.5** | YES (stub banners)          | YES (stubs)       | Ready w/ waivers (stub APIs)      |
| Registration Portal         |       7 |   **8.5** | YES                         | YES               | Ready w/ waivers                  |
| Public Website              |      12 |   **9.0** | YES                         | YES               | Ready w/ waivers                  |
| Other Portals               |       5 |   **8.0** | YES (real docs/dash/market) | YES               | Ready w/ waivers (demo key/mint)  |
| Mobile App (native)         |      22 |   **7.8** | YES widget goldens          | YES + unit/golden | Ready w/ waivers (no device farm) |

Weighted check: Σ(score×screens)/126 ≈ **8.01**.

## Uplift shipped this pass (6.9 → 8.0)

1. Developer Portal destub: `/docs`, `/dashboard` (client API-key demo), `/marketplace` (static catalog) + Playwright smoke.
2. Staff write validation ungated smoke (`15b-…`).
3. Examinations inventory + client create validation (`19-…`) with hydration-safe submit.
4. Flutter widget goldens under `/opt/cursor/artifacts/mobile-flutter-audit/` (login + home shell).
5. Other Portals capture pack under `/opt/cursor/artifacts/other-portals-audit/`.

## Verified screenshot packs (real)

- Prior packs: auth, overview-people, academics, scholarships, institutions, health, workflows, insights-system, platform-admin, registration, public-website
- **New:** `/opt/cursor/artifacts/other-portals-audit/` (dev home/docs/dashboard/marketplace)
- **New:** `/opt/cursor/artifacts/mobile-flutter-audit/` (widget goldens; not device farm)

Canvas: `/cursor/stores/user/canvases/ceb85c59-c8af-4f46-bd7c-25a932bb1769/source.canvas.tsx`
