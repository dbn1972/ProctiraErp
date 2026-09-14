# W1-OPS-12 — Secondary apps Playwright CI

## Closed
- Path filter `secondary_apps` for admin-console, developer-portal, install-wizard, public-website, registration-portal
- CI job `secondary-apps-e2e` runs Chromium Playwright per affected app
- Aggregate gate requires the job when `SECONDARY_APPS_CHANGED=true`

## Residual (honest)
- Live-backend `describe` blocks still skip without `E2E_BACKEND_READY=1`
- Mobile-chrome project deferred (chromium-only here)
- `apps/web` e2e suites already covered by existing workflows; not duplicated
