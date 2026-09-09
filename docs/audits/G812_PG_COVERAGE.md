# G-812 — Backend Postgres repository smoke coverage

**Status:** Partial — `examination` and `institution` suites added (this change).  
**Gap:** `ENTERPRISE_FABLE51_PRODUCT_GAP_AUDIT.md` G-812.

## Covered (mounted product paths)

| Package                 | Smoke file                                             | Notes                                      |
| ----------------------- | ------------------------------------------------------ | ------------------------------------------ |
| `backend/examination`   | `src/pg-examination-repository.test.ts`                | create → findById → cross-tenant RLS deny  |
| `backend/institution`   | `src/pg-institution-repository.test.ts`                | create → findById → cross-tenant RLS deny; seeds `geographic_areas` FK |

Both use `it.skipIf(!isPg*Enabled())` so unit CI without `DATABASE_URL` skips cleanly; G-807 integration job runs them against migrated Postgres.

## Follow-ups (no fake / stub passing tests)

| Package                    | Gateway mount                         | Follow-up                                                              |
| -------------------------- | ------------------------------------- | ---------------------------------------------------------------------- |
| `backend/admin-dashboard`  | **unmounted**                         | Parked/unmounted — add pg smoke only if/when mounted                   |
| `backend/custom-field`     | **parked/unmounted** (G-605)          | In-memory only; park until product UI funds a mount                    |
| `backend/dashboards`       | **parked/unmounted** (G-605 / G-809)  | Board rollups residual; mount or relocate before pg suite              |
| `backend/data-warehouse`   | **unmounted** (insights-ui owns path) | Real package still unmounted (G-209)                                   |
| `backend/developer-portal` | mounted (in-memory)                   | Optional: durable store + pg smoke when persistence ships              |
| `backend/etl`              | **unmounted**                         | Parked behind insights-ui aggregates (G-209)                           |
| `backend/install`          | **unmounted**                         | Portal/demo scoped                                                     |
| `backend/plugin`           | **unmounted**                         | `/plugins` owned by platform-admin UI stub                             |
| `backend/policy`           | **unmounted**                         | Residual beyond G-106 suspend gate                                     |
| `backend/report`           | **unmounted** (insights-ui owns path) | Real package still unmounted (G-209)                                   |
| `backend/survey`           | **parked/unmounted** (G-605)          | Plugin ready; no gateway product surface                               |
| `backend/theme`            | **parked/unmounted** (G-605)          | `/themes` owned by platform-admin UI stub                              |

Do **not** add vacuous `it.skip` / always-pass stubs for the rows above. When a package gains a real Postgres repository and a mount (or an explicit product decision), add a hostel/LMS-style create → read → cross-tenant smoke and register it under the G-807 CI step.
