# ProctiraERP Web E2E Tests

End-to-end tests for the ProctiraERP web application using [Playwright](https://playwright.dev/).
The suite covers the critical user journeys defined in task 27.8 of the
ProctiraERP Unified Platform spec:

| Spec file                                    | Journey                                                                                             |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `41-admissions-crm-write-smoke.spec.ts`          | Admissions CRM + A5 tip: enquiry → merit → seat → offer → parent pay → enrol (soft-skip if gateway offline) |
| `02-attendance.spec.ts`                      | Attendance marking → percentage report verification                                                 |
| `03-assessment-and-report-card.spec.ts`      | Assessment scheme + items + results → report card                                                   |
| `04-transfer-and-workflow.spec.ts`           | Transfer request → approval workflow → status update                                                |
| `05-bulk-import.spec.ts`                     | Excel import → error preview → confirm valid rows                                                   |
| `06-language-and-rtl.spec.ts`                | Language switch to Arabic → RTL layout → navigation                                                 |
| `07-tenant-isolation.spec.ts`                | Tenant A data is not visible to Tenant B                                                            |
| `15-overview-people-inventory-smoke.spec.ts` | Ungated: people routes → `/login`; optional authenticated inventory when `E2E_BACKEND_READY=1`      |
| `16-institutions-inventory-smoke.spec.ts`    | Ungated: institution routes → `/login`; optional authenticated inventory when `E2E_BACKEND_READY=1` |

## Prerequisites

Most journey specs run against a live ProctiraERP deployment. Before running them
locally you need:

1. **Backend services up.** The API gateway, auth, institution, student,
   attendance, assessment, workflow, and bulk-import services must be
   running and reachable from the web app.
2. **Two demo tenants seeded.** The default config expects subdomains
   `tenant-a` and `tenant-b` with at least one institution, several students,
   one academic period, and grade/class fixtures per tenant.
3. **Admin users seeded** for each tenant:
   - `admin@tenant-a.test` / `Password123!`
   - `admin@tenant-b.test` / `Password123!`

You can override the defaults via environment variables (see "Environment
variables" below).

## Running the tests

Journey specs are gated on `E2E_BACKEND_READY=1` so they can be checked in
and only run when an end-to-end backend is available. Without that flag those
tests skip. **Ungated inventory smokes** (`15-…`, `16-…`) always run and assert
unauthenticated redirects to `/login`. Verify the suite parses with
`pnpm --filter @proctira/web exec playwright test --list`.

**CI (G-401):** `.github/workflows/e2e-backend-ready.yml` (nightly +
`workflow_dispatch`) runs Postgres/Redis → Prisma migrate → `apply-sql.sh` →
`tools/scripts/run-e2e-backend-ready.sh` (api-gateway + HS256 health write
smoke + `17c` health/scholarships a11y). Authenticated `a11y-axe` uses
`setupGatewayTenantSession` (G-402) when `E2E_BACKEND_READY=1`. Seeded-password
/ IdP login journeys remain residual.

```bash
# From the repo root
pnpm --filter @proctira/web exec playwright install --with-deps chromium

# Headless run against a locally running backend + web app
E2E_BACKEND_READY=1 pnpm --filter @proctira/web test:e2e

# G-401 harness (starts api-gateway; Playwright starts web unless PLAYWRIGHT_BASE_URL set)
DATABASE_URL=postgresql://... JWT_SECRET=dev-secret-change-in-production \
  bash tools/scripts/run-e2e-backend-ready.sh

# Interactive UI mode for debugging
E2E_BACKEND_READY=1 pnpm --filter @proctira/web test:e2e:ui
```

If the dev server is already running you don't need to start it again — the
config sets `reuseExistingServer: true` outside CI.

## Environment variables

| Variable                                       | Purpose                                                                      | Default                                |
| ---------------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------- |
| `E2E_BACKEND_READY`                            | Gate that enables the specs. Without it every test is skipped.               | _(unset)_                              |
| `PLAYWRIGHT_BASE_URL`                          | Run against a deployed environment instead of a locally spawned dev server.  | `http://localhost:3001`                |
| `E2E_TENANT_A_SUBDOMAIN`                       | Subdomain / cookie value used for Tenant A.                                  | `tenant-a`                             |
| `E2E_TENANT_A_EMAIL` / `E2E_TENANT_A_PASSWORD` | Admin credentials for Tenant A.                                              | `admin@tenant-a.test` / `Password123!` |
| `E2E_TENANT_B_SUBDOMAIN`                       | Subdomain / cookie value used for Tenant B.                                  | `tenant-b`                             |
| `E2E_TENANT_B_EMAIL` / `E2E_TENANT_B_PASSWORD` | Admin credentials for Tenant B.                                              | `admin@tenant-b.test` / `Password123!` |
| `E2E_GATEWAY_URL`                              | Optional API gateway URL used by `seedTestData` for pre-flight health check. | _(unset, no-op)_                       |
| `E2E_SEED_TOKEN`                               | Optional bearer token for the seed helper.                                   | _(unset)_                              |

## Notes

- The suite uses Chromium only in CI to keep runs fast. Add additional
  projects in `playwright.config.ts` when WebKit/Firefox coverage is needed.
- The bulk-import spec generates its workbook in memory via `exceljs` so no
  binary fixtures need to be checked in.
- Tests use unique student names per run (`makeTestStudent()`), so concurrent
  runs against the same backend won't collide on uniqueness constraints.
