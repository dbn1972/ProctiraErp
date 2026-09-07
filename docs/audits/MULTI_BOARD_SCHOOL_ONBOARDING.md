# Multi-board / multi-school live onboarding certification

**Date (UTC):** 2026-09-06  
**Method:** Raw SQL + `psql` against live Postgres (**no Prisma**)  
**Script:** `tools/scripts/setup-live-db-and-onboard.sh`  
**Schema:** `db/sql/001_core_onboarding_schema.sql`  
**Seed:** `db/seeds/002_multi_board_schools_500.sql`  
**Tenant slug:** `proctira-multiboard-cert`  
**DATABASE_URL:** `postgresql://proctira:***@127.0.0.1:5432/proctira`

## Profile

| Board | Type | Schools | Students each |
| --- | --- | --- | ---: |
| CBSE | NATIONAL | CBSE-DEL-01, CBSE-NOI-02 | 500 |
| MH-STATE | STATE | MH-PUN-01, MH-MUM-02 | 500 |
| ICSE | PRIVATE | ICSE-BLR-01, ICSE-HYD-02 | 500 |

## Verified counts (live)

| Entity | Count |
| --- | ---: |
| Tenants (cert) | 1 |
| Boards | 3 |
| Institutions | 6 |
| Students | 3000 |
| Staff | 150 |
| Enrollments | 3000 |

Evidence: `/opt/cursor/artifacts/multi-board-onboard/summary.json`, `verify-counts.txt`.

## Verdict

☑ **Live data-plane onboarding PASS** for the 3×2×500 profile.  
☐ Program-wide enterprise production-ready still blocked on live IdP E2E, device-farm mobile, live Insights/Admin APIs (see `docs/audits/SCREEN_BY_SCREEN_SCOREBOARD.md` — program **~8.3 / 10**).
