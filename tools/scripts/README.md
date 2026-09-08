# tools/scripts

Workspace-level Node CLI scripts that run as CI gates or local helpers. Each
script is a single `.mjs` file with no compile step so it runs without
`pnpm install` of every workspace package.

## Scripts

| Command                    | Script                               | Purpose                                                                                 |
| -------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------- |
| `pnpm lint:a11y`           | `check-icon-only-button.mjs`         | Standalone scan for the `proctira/icon-only-button-requires-aria-label` ESLint rule.    |
| `pnpm check:contrast`      | `check-contrast.mjs`                 | Semantic-token contrast gate (≥ 7:1 in light + dark per Requirement 37 AC 2).           |
| `pnpm check:bundle`        | `check-bundle.mjs`                   | Bundle-size gate (≤ 500 KB gzip per named route per Requirement 39 AC 1).               |
| `pnpm check:lighthouse`    | `check-lighthouse.mjs`               | Lighthouse gate (Property F-10 — desktop + 3G mobile, four category thresholds).        |
| `pnpm check:brand-strings` | `check-brand-strings.mjs`            | Grep gate for hardcoded brand names (ProctiraERP / EduZo) in non-TypeScript assets.     |
| `pnpm dod:check`           | `definition-of-done-checks.mjs`      | Charter §32 release-gate checks.                                                        |
| `pnpm dod:test`            | `definition-of-done-checks.test.mjs` | Unit tests for the DoD checks.                                                          |
| (internal)                 | `gen-runbooks.mjs`                   | Generates runbook stubs from Charter sections.                                          |
| (internal)                 | `validate-observability.mjs`         | Validates Grafana dashboards / Prometheus rules.                                        |
| (CI / local)               | `apply-sql.sh`                       | Apply `db/sql/[0-9]*.sql` after Prisma migrate (G-002).                                 |
| (CI / local)               | `run-e2e-backend-ready.sh`           | G-401 harness: start api-gateway + `E2E_BACKEND_READY=1` Playwright write-smoke subset. |

## `check:brand-strings` (task 57.4 / Design M)

### Why it exists

Requirement 43 (Brand-Name Flexibility) requires the platform to render under
any tenant brand. Hardcoded brand strings break that contract. Task 57.3 ships
an ESLint rule (`proctira/no-hardcoded-brand-strings`) that catches violations
in TypeScript / JSX. **This script is the complement** — it scans every
asset ESLint cannot see:

- Markdown documentation (`.md`, `.mdx`)
- HTML and email templates (`.html`, `.htm`, `.hbs`, `.handlebars`, `.mjml`)
- Plain-text artifacts (`.txt`)
- Configuration formats (`.yml`, `.yaml`, `.json`, `.csv`)

The default brand list is `ProctiraERP,EduZo`. Override with
`--brands=Foo,Bar` or extend the list when a new brand needs to be banned
from runtime copy.

### How it runs

`pnpm check:brand-strings` invokes `node tools/scripts/check-brand-strings.mjs`.
The CI lint job runs it after the ESLint cascade — see
`.github/workflows/ci.yml` (`Lint` job, step `Check hardcoded brand strings
(non-TypeScript assets)`).

The script tries `ripgrep` first (fast); when `rg` is not on the runner it
falls back to a pure-Node recursive walker, so the gate works on every CI
image and on developer machines that lack `rg`. Use `--force-node` to skip
the auto-detection (handy in tests).

Other useful flags:

```bash
node tools/scripts/check-brand-strings.mjs --json        # machine output
node tools/scripts/check-brand-strings.mjs --brands=Foo  # custom brands
node tools/scripts/check-brand-strings.mjs --root=/tmp/x # alternate root
```

### Allowlist

The allowlist lives at `tools/scripts/brand-strings-allowlist.json`. It is a
JSON document of category → glob-array pairs. Globs are matched against the
workspace-relative POSIX path. The script bundles a tiny glob → regex helper
(`globToRegExp`) so the allowlist works without a `minimatch` dependency.

Categories (and why each is permitted):

| Category                                 | Reason brand strings are permitted                                                                                       |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `build-artifacts-and-lockfiles`          | Generated output / dependency manifests not edited by humans (`pnpm-lock.yaml`, `dist/`, `.turbo/`, `node_modules/`, …). |
| `config-files`                           | Workspace identifiers — package names, tsconfig paths — that name the **monorepo** rather than the rendered product.     |
| `infrastructure-operational-identifiers` | Helm release names, k8s namespaces, image tags. These name infra resources, not user-visible copy.                       |
| `ci-automation`                          | Workflow file labels and project names.                                                                                  |
| `project-documentation`                  | Top-level project READMEs, CHANGELOG, ATTRIBUTIONS. Documentation about the project may name the project.                |
| `dod-reports-generated`                  | Reports written by the DoD check tooling.                                                                                |
| `reference-port-figma`                   | The `School Platform Design/` reference port we kept verbatim during migration.                                          |
| `mobile-app-metadata`                    | Flutter `pubspec.yaml` package identifier.                                                                               |
| `locale-catalogs-app-name`               | The `appName` key in `apps/*/src/messages/*.json` — replaced at runtime by `useBrand().name` (task 57.5).                |
| `themes-shipping-default-brand`          | The default theme ships brand defaults; tenants override via theme overrides.                                            |
| `plugin-sdk-documentation`               | SDK docs reference the platform name.                                                                                    |
| `tooling-readmes-and-fixtures`           | Internal tools (install-cli, migrations, tenant-isolation tests, DoD checks, brand-string test fixtures).                |
| `brand-scanner-self`                     | The allowlist file and this README mention the brand strings to document them.                                           |

### Adding an allowlist entry

1. Open `tools/scripts/brand-strings-allowlist.json`.
2. Append a glob to the matching category, or add a new category at the end
   with a matching row in the table above.
3. Run `pnpm check:brand-strings` locally — must report `0 violations`.
4. In the PR description, justify the exception against Charter §M (Brand
   Neutrality) or Requirement 43.

### Baseline

As of the initial wiring of this gate the scanner reports:

- **Engine:** Node (CI runners and dev machines without `ripgrep`)
- **Total scanned hits:** 78
- **Allowlisted hits:** 78
- **Violations (failing):** 0
- **Allowlist globs:** 52 across 13 categories

Tracked categories of permitted matches and their representative files:

- `project-documentation`: `README.md`, `apps/web/e2e/README.md`,
  `infrastructure/helm/proctira-platform/README.md`,
  `docs/runbooks/README.md`, …
- `infrastructure-operational-identifiers`:
  `infrastructure/helm/proctira-platform/Chart.yaml`,
  `infrastructure/helm/proctira-platform/values.yaml`,
  `infra/observability/prometheus.yml`,
  `docker-compose.yml`, …
- `ci-automation`: `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`, …
- `config-files`: `package.json`, `packages/eslint-plugin-proctira/package.json`,
  `themes/default-theme/package.json`, …
- `locale-catalogs-app-name`:
  `apps/web/src/messages/en.json`, `apps/registration-portal/src/messages/{en,fr,es,ar}.json`,
  `apps/developer-portal/src/messages/{en,ar}.json`.
- `tooling-readmes-and-fixtures`:
  `tools/install-cli/package.json`, `tools/migrations/README.md`,
  `tools/tenant-isolation-tests/README.md`, …
- `reference-port-figma`: `School Platform Design/**`.
- `mobile-app-metadata`: `apps/mobile/pubspec.yaml`,
  `packages/flutter-core/api-client/pubspec.yaml`.

### Relationship to ESLint rule (task 57.3)

| Aspect        | ESLint `proctira/no-hardcoded-brand-strings` (57.3) | `pnpm check:brand-strings` (57.4)                               |
| ------------- | --------------------------------------------------- | --------------------------------------------------------------- |
| Files scanned | `*.{ts,tsx,js,jsx}`                                 | `*.{md,mdx,html,htm,txt,yml,yaml,json,csv,hbs,handlebars,mjml}` |
| Engine        | ESLint AST traversal                                | `ripgrep` if available, else Node walker                        |
| Allowlist     | Rule options + per-file overrides                   | `tools/scripts/brand-strings-allowlist.json`                    |
| CI step       | `Run ESLint` (`pnpm turbo run lint`)                | `Check hardcoded brand strings (non-TypeScript assets)`         |

Both gates run in the `Lint` job. Together they cover every file type that
can contain user-visible copy.

## `lint:a11y`

See header in `check-icon-only-button.mjs`. Runs the
`proctira/icon-only-button-requires-aria-label` rule against `apps/*` and
`packages/ui` without requiring a full workspace install.

## `check:bundle` (task 55.2 / Requirement 39 AC 1 / Design §J)

### Why it exists

Requirement 39 AC 1 caps the initial JavaScript bundle for the most-frequently
loaded routes (`/auth/signin`, `/app/dashboard`, `/app/attendance`) at
**500 KB gzip combined**. Design §J names `pnpm check:bundle` as the CI gate
that enforces it. The script reads the Next.js App Router build manifest,
unions the chunks loaded for each route's layout chain, gzips each chunk on
disk (level 9 — same as `apps/web/scripts/precompress.mjs`), and fails the
build if any single route exceeds the budget.

### How it runs

`pnpm check:bundle` invokes `node tools/scripts/check-bundle.mjs`. The CI
job runs it after the Next.js production build — see `.github/workflows/ci.yml`
(`bundle-budget` job).

When `apps/web/.next/` is missing the gate behaves as follows
(task 55.2 spec item 5):

- **CI** (`CI=true`) **or** `--no-build` set → fail with a clear message.
  CI is expected to run the Next.js build first.
- **Local** (no `CI` env var) → warn and exit 0.
  Contributors who run `pnpm check:bundle` without first building
  `apps/web` get a friendly nudge instead of a hard error.

Useful flags:

```bash
node tools/scripts/check-bundle.mjs --no-build         # fail (instead of skip) when .next/ is missing
node tools/scripts/check-bundle.mjs --threshold=409600 # tighten to 400 KB
node tools/scripts/check-bundle.mjs --baseline         # record current sizes (always passes)
node tools/scripts/check-bundle.mjs --json             # machine output
```

A route whose manifest keys do not resolve in the build emits a warning
rather than failing — Requirement 39 AC 1 only binds the routes that exist
in the current build. New routes are picked up automatically once their
manifest entry lands; update `DEFAULT_ROUTES` in `check-bundle.mjs` if the
canonical name needs to change.

### Baseline

`tools/scripts/check-bundle-baseline.{json,md}` record the per-route gzip
sizes captured the first time the gate landed, for change-by-change tracking.
The gate itself does not consult the baseline; refresh it with
`pnpm check:bundle --baseline` after a deliberate regression or a known win.

## `check:lighthouse` (task 55.7 / Requirement 39 AC 2 / Property F-10 / Design §J)

### Why it exists

Property F-10 names four Lighthouse score thresholds the platform's
front-end must meet on every named route:

| Category       | Minimum |
| -------------- | ------- |
| Accessibility  | 0.95    |
| Performance    | 0.80    |
| Best Practices | 0.90    |
| SEO            | 0.90    |

Requirement 39.2 names the routes (`/auth/signin`, `/app/dashboard`,
`/app/attendance`) and the device profiles (desktop + simulated 3G
mobile: 1.6 Mbps downlink, 750 ms RTT, 4× CPU slowdown). Design §J names
`pnpm check:lighthouse` as the CI gate.

The `accessibility` category is powered by axe-core, so this gate is
also the CI surface for the “axe runs against named routes” line in the
accessibility plan (Design §K).

### How it runs

`pnpm check:lighthouse` (or `pnpm -F @proctira/web check:lighthouse`)
invokes `node tools/scripts/check-lighthouse.mjs`. The script orchestrates
two `lhci autorun` invocations against the same lhci config —
`apps/web/lighthouserc.cjs` — once with `LH_PROFILE=desktop` and once
with `LH_PROFILE=mobile-3g`. Per-URL JSON reports are read back from
`tools/scripts/.lighthouseci/<profile>/` and re-checked against the
thresholds in `SCORE_THRESHOLDS`. The wrapper exits non-zero if any
profile × URL × category falls below.

The CI workflow (`.github/workflows/ci.yml`, job `lighthouse`) builds
`apps/web` in production mode, starts `next start` on port 3001, waits
for `/login` to respond, then invokes the wrapper with `--strict` so
the gate fails (instead of warning) when `@lhci/cli` is not installed.

### Authenticated routes

The gate audits the anonymous `/login` surface unconditionally. The two
authenticated routes (`/app/dashboard`, `/app/attendance`) need a valid
JWT cookie to render. The lhci config skips them with a warning when
the env var `LHCI_AUTH_COOKIE` is unset. To include them, export
`LHCI_AUTH_COOKIE` as a JSON-encoded array of cookies suitable for
Puppeteer’s `page.setCookie`:

```bash
export LHCI_AUTH_COOKIE='[{"name":"access_token","value":"<jwt>","domain":"localhost","path":"/"}]'
pnpm check:lighthouse
```

The CI workflow does not currently mint that cookie; the implementation
note attached to task 55.7 calls this out and the spec explicitly allows
running on the anonymous surface only for the initial wiring. A
follow-up will seed a test tenant and inject the cookie.

### Useful flags

```bash
node tools/scripts/check-lighthouse.mjs --profile=desktop      # one profile only
node tools/scripts/check-lighthouse.mjs --profile=mobile-3g
node tools/scripts/check-lighthouse.mjs --base-url=http://localhost:3000
node tools/scripts/check-lighthouse.mjs --json
node tools/scripts/check-lighthouse.mjs --strict               # fail (instead of skip) when @lhci/cli is not installed
```

### Single source of truth for thresholds

`SCORE_THRESHOLDS` is exported from both
`apps/web/lighthouserc.cjs` and `tools/scripts/check-lighthouse.mjs`.
The unit tests in `tools/scripts/__tests__/check-lighthouse.test.ts`
assert the two copies are equal, so the gate cannot drift.
