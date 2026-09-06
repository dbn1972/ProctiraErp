# Production-ready 9.5 campaign (parallel)

**Started (UTC):** 2026-09-06  
**Target:** every module **9.5 / 10**  
**Baseline:** program **8.3 / 10** (tip `30fd77f`)  
**Live data plane:** PASS — 3 boards × 6 schools × 500 students  

## Parallel tracks

| Track | Modules | Agent focus | Status |
| --- | --- | --- | --- |
| A | Auth · Public · Registration | axe, smokes, residual close | in progress |
| B | People · Academics | live-DB write E2E + captures | in progress |
| C | Services · Insights · Admin | live paths, reduce stubs | in progress |
| D | Other Portals · Mobile | portal smokes + Flutter goldens | in progress |

## Honest blockers (cannot fake)

1. External IdP production contract (Auth / Admin operator / Developer mint)
2. Physical device-farm PNGs (Mobile)
3. Full live DW/report job runners (Insights) if services not mounted

Tracks close everything else with live Postgres + headless Playwright + goldens.

## Scoreboard source of truth

`docs/audits/SCREEN_BY_SCREEN_SCOREBOARD.md` — updated as each track lands.
