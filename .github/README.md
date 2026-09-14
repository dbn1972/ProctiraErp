# CI/CD Pipeline - ProctiraERP Unified Platform

## Overview

The CI/CD pipeline uses GitHub Actions with Turborepo remote caching and affected-module detection to provide fast, selective builds across the monorepo.

## Workflows

### `ci.yml` — Continuous Integration

Runs on every push and PR to `main`/`develop` branches.

**Stages:**

1. **Detect Changes** — Identifies which packages/apps were modified
2. **Lint** — ESLint + Prettier formatting check (affected packages only)
3. **Type Check** — TypeScript compilation (affected packages only)
4. **Unit Tests** — Vitest + fast-check property tests (affected packages only)
5. **Build** — Production build (affected packages only)
6. **Integration Tests** — Tests requiring PostgreSQL/Redis (backend changes only)

### `e2e-backend-ready.yml` — G-401 / G-706 live E2E gate

Runs on every `pull_request` (hard gate), nightly, and on `workflow_dispatch`.
Spins Postgres + Redis, runs Prisma migrate + `tools/scripts/apply-sql.sh`
with `APPLY_STRICT_FKS=1` (production FK posture), seeds the fixed E2E tenant
rows (`tools/e2e/seed-e2e-tenants.sql`), then
`tools/scripts/run-e2e-backend-ready.sh` starts api-gateway and runs the
`E2E_BACKEND_READY=1` Playwright live write-smokes with `E2E_REQUIRE_LIVE=1`:
a gateway that never becomes healthy or any failing spec turns the PR red.
PRs run the curated `PR_SPECS` set; the nightly run adds the remaining live
write smokes. All live specs authenticate with HS256 cookies (`JWT_SECRET`);
no IdP secrets are required.

### `release.yml` — Release (Container Image Build & Push)

Gated on successful completion of the `CI` workflow. Builds and pushes container images for affected services to the configured OCI registry (GHCR by default).

**Triggers:**

- `workflow_run`: After CI completes successfully on `main`, `develop`, or `release/**`
- `workflow_dispatch`: Manual release with optional service list and `force-all` flag.
  **W1-OPS-23:** manual dispatch does **not** bypass CI — `require-same-sha-ci.mjs`
  queries GitHub for a successful `CI` workflow_run (or CI Aggregate check_run) on
  the exact SHA and **fails closed** if proof is missing.

**Stages:**

1. **CI Gate** — Verifies same-SHA CI succeeded (`workflow_run` conclusion or
   manual `gh api` proof); resolves the released SHA/branch
2. **Detect Services** — Path-based detection of affected services (full release on shared/infra changes)
3. **Matrix Prep** — Converts the service list into a build matrix
4. **Build & Push** — Parallel image build with `docker/metadata-action` for canonical tagging
5. **Release Summary** — Aggregates matrix results and surfaces them in the run summary

**Image tagging strategy** (per service, W1-OPS-08):

- Canonical repository: `ghcr.io/<owner>/proctira/<service>`
- Branch name: `ghcr.io/<owner>/proctira/<service>:<branch>`
- Short SHA: `ghcr.io/<owner>/proctira/<service>:sha-<short-sha>`
- Full SHA: `ghcr.io/<owner>/proctira/<service>:sha-<full-sha>`
- **Never** mutable `latest` (prod Helm/kustomize/deploy consume immutable tags only)

### `deploy.yml` — Deployment

Triggered on push to `main` (production) or `develop` (staging), or manually via workflow dispatch. Deploys previously-released images to the Kubernetes cluster via Helm.

**Stages:**

1. **Prepare** — Determines environment and affected services
2. **Build Images** — Builds Docker images for affected services (parallel matrix)
3. **Deploy** — Deploys via Helm to the target Kubernetes cluster

### `actionlint.yml` — Workflow Syntax Validation

Runs [actionlint](https://github.com/rhysd/actionlint) (with shellcheck) on every PR and push that touches `.github/workflows/**` (and related reusable assets). Catches undefined secrets/variables, invalid expressions, and shell issues in `run:` blocks before they reach the runner.

**W1-OPS-24:** also `uses: ./.github/workflows/reusable-setup.yml` (workflow_call smoke) and runs `tools/scripts/assert-reusable-ci-assets.mjs` so reusable setup / observability-validation assets cannot disconnect silently.

### `observability-config.yml` — Observability Config Gate

Runs promtool/amtool checks on `infra/observability/**`, plus `node tools/scripts/validate-observability.mjs` (syntactic YAML/JSON + expected alert names) via the shared `.github/actions/setup-node-pnpm` composite.

### `pr-check.yml` — Pull Request Checks

Lightweight validation on every PR:

- PR size warning (>1000 lines)
- Affected module summary in PR comments (setup via `.github/actions/setup-node-pnpm`)

### `reusable-setup.yml` — Reusable Setup (`workflow_call`)

Shared Node/pnpm install wrapper around `.github/actions/setup-node-pnpm`. Must remain called by at least one active workflow (enforced by `assert-reusable-ci-assets.mjs`).

## Turborepo Remote Caching

Remote caching is configured in `turbo.json` with signature verification enabled. This allows CI builds to share cached artifacts across runs, dramatically reducing build times for unchanged packages.

### Setup

1. Create a Turborepo account at [vercel.com/turborepo](https://vercel.com/turborepo)
2. Generate a team token
3. Add the following secrets/variables to your GitHub repository:
   - **Secret**: `TURBO_TOKEN` — Your Turborepo access token
   - **Variable**: `TURBO_TEAM` — Your Turborepo team slug

### How It Works

- Each task in `turbo.json` defines `inputs` and `outputs`
- Turborepo hashes the inputs to create a cache key
- If the cache key matches a remote artifact, the build is skipped
- Shared packages that haven't changed are never rebuilt

## Affected-Module Detection

The pipeline uses two complementary strategies:

### 1. Turborepo Filter (merge-base with PR base / `origin/main`)

Turborepo's built-in filter detects which packages changed since the **merge-base** with the PR target (`github.event.pull_request.base.sha`) or `origin/main`, and includes their dependents. CI resolves that SHA via `tools/scripts/resolve-turbo-filter-base.mjs` (W1-OPS-22) — not `HEAD~1`, which omitted packages touched only in earlier commits of a multi-commit PR. Used for typecheck, unit test, build, and integration `test:e2e` stages.

### 2. Path-based Detection (`dorny/paths-filter`)

For coarser-grained decisions (e.g., skip integration tests if only frontend changed), the pipeline uses path-based filtering to categorize changes into:

- `backend` — Backend services and shared packages
- `frontend` — UI packages and web apps
- `shared` — Core shared packages (triggers full rebuild)
- `infra` — Infrastructure changes (triggers image rebuilds)

### 3. Service-level Detection (Deploy)

The deploy workflow detects which specific services need new container images by checking git diff against service directories. If shared packages change, all services are rebuilt.

## Container Image Building

Images are built using Docker Buildx with:

- **GitHub Actions cache** (`type=gha`) for layer caching
- **Multi-platform** support (linux/amd64 by default)
- **Parallel matrix** builds for multiple services
- **Immutable tagging** (W1-OPS-08): `{sha}-{timestamp}` / `sha-<gitsha>` — never mutable `latest`

### Image Naming Convention

```
{registry}/{namespace}/proctira/{service-name}:{tag}
```

Where `{tag}` is one of:

- A branch name (e.g. `main`, `develop`) — registry convenience; **not** used by prod deploy manifests
- `sha-{short-sha}` (e.g. `sha-abc1234`) — produced by both CI and the release workflow
- `sha-{full-sha}` — immutable digest reference for traceability

**W1-OPS-08:** mutable `latest` is forbidden on app images in prod deploy paths
(Helm / kustomize / deploy.yml / release.yml / compose app services).

Examples:

- `ghcr.io/proctira-foundation/proctira/api-gateway:main`
- `ghcr.io/proctira-foundation/proctira/api-gateway:sha-abc1234`
- `ghcr.io/proctira-foundation/proctira/institution:develop`

## Required Secrets and Variables

### Secrets

| Name                | Description                                                                            | Required             |
| ------------------- | -------------------------------------------------------------------------------------- | -------------------- |
| `TURBO_TOKEN`       | Turborepo remote cache access token                                                    | Recommended          |
| `GITHUB_TOKEN`      | Auto-provided; used for GHCR authentication                                            | Always present       |
| `REGISTRY_USERNAME` | Registry username (only when `CONTAINER_REGISTRY` is set to a non-GHCR registry)       | Conditional          |
| `REGISTRY_PASSWORD` | Registry password/token (only when `CONTAINER_REGISTRY` is set to a non-GHCR registry) | Conditional          |
| `KUBECONFIG`        | Kubernetes cluster configuration                                                       | Required for deploys |
| `SLACK_WEBHOOK_URL` | Slack notification webhook                                                             | Optional             |

### Variables

| Name                 | Description                        | Default                          |
| -------------------- | ---------------------------------- | -------------------------------- |
| `TURBO_TEAM`         | Turborepo team slug                | (none)                           |
| `CONTAINER_REGISTRY` | Container registry URL             | `ghcr.io`                        |
| `IMAGE_NAMESPACE`    | Image namespace under the registry | `${{ github.repository_owner }}` |

When `CONTAINER_REGISTRY` is `ghcr.io` (default), the release workflow authenticates using the auto-provided `GITHUB_TOKEN`. For any other registry, set `REGISTRY_USERNAME` and `REGISTRY_PASSWORD` secrets.

## Environments

GitHub Environments are used for deployment protection:

- **staging** — Auto-deploys from `develop` branch
- **production** — Auto-deploys from `main` branch, requires approval

## Local Development

To test the CI pipeline locally:

```bash
# Run the same commands CI uses (merge-base with main, not HEAD~1)
BASE=$(node tools/scripts/resolve-turbo-filter-base.mjs --fallback origin/main)
pnpm turbo run typecheck --filter="...[${BASE}]"
pnpm turbo run test --filter="...[${BASE}]"
pnpm turbo run build --filter="...[${BASE}]"
```


To enable remote caching locally:

```bash
npx turbo login
npx turbo link
```
