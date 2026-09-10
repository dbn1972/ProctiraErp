# Supply-chain gate (G-508 / G-708)

Workflow: `.github/workflows/supply-chain.yml` — runs on every pull request, on
pushes to `main`, nightly, and on manual dispatch.

| Job               | What it does                                                                                                                                                                                                                                             | Fails the run when                                                                                            |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `advisory-gate`   | `tools/scripts/audit-gate.mjs` runs `pnpm audit --prod --json`, subtracts waivers from `tools/supply-chain/audit-allowlist.json`, uploads `pnpm-audit.json` + `audit-gate-summary.json`.                                                                 | Any **high/critical** advisory that is not waived, or any waiver whose `expires` date has passed.             |
| `sbom`            | `@cyclonedx/cdxgen` builds a CycloneDX 1.5 SBOM from `pnpm-lock.yaml` (≈1,300 npm components with `pkg:npm/...` purls) and uploads `sbom.cdx.json` (90-day retention).                                                                                   | The BOM is not CycloneDX, has < 100 components, or < 95 % of components carry a purl.                         |
| `sign-image`      | Builds `infrastructure/docker/Dockerfile.api-gateway`, pushes `:sha-<commit>` to `CONTAINER_REGISTRY` (GHCR default), signs the digest with **keyless cosign** (GitHub OIDC → Sigstore), attaches the SBOM as a `cyclonedx` attestation and verifies it. | Build/push/sign/verify fails. Only runs on `push`/`dispatch`/`schedule` with `SUPPLY_CHAIN_SIGN_IMAGES=true`. |
| `signing-skipped` | Writes to the job summary _why_ signing did not run (PR event, or variable unset).                                                                                                                                                                       | Never — it exists so a skipped signing step is visible, not silent.                                           |

## Waivers

`tools/supply-chain/audit-allowlist.json` is the only way to pass the gate with
an open high/critical advisory. Every entry must carry:

- `ghsa` — the advisory id;
- `reason` — why it cannot be fixed now;
- `trackedBy` — the gap row (`G-nnn`) in `docs/audits/ENTERPRISE_FABLE51_PRODUCT_GAP_AUDIT.md`;
- `expires` — ISO date; an expired waiver fails the gate until renewed or fixed.

`node --test tools/scripts/audit-gate.test.mjs` checks the file is well-formed
and has no expired entries; it runs at the start of the `advisory-gate` job.

### Current waivers (tracked by G-735)

All remaining high advisories require a **major framework upgrade**: Next.js
14 → 15 across the six Next apps, and Fastify 4 → 5 (plus `@fastify/static`,
`find-my-way`) across the gateway and every backend package. Everything else
that was high/critical in September 2026 (fast-jwt, brace-expansion, fast-uri,
nanoid, postcss, tmp, browserslist, react-router, @faker-js/faker) is fixed via
`pnpm.overrides` in the root `package.json` or direct bumps.

## Enabling image signing

1. Set repository variable `SUPPLY_CHAIN_SIGN_IMAGES=true`.
2. GHCR needs nothing else (`GITHUB_TOKEN` with `packages: write`). For another
   registry set `CONTAINER_REGISTRY` and secrets `REGISTRY_USERNAME` /
   `REGISTRY_PASSWORD`.
3. Verify a published image locally:

```bash
cosign verify \
  --certificate-identity-regexp '^https://github.com/<owner>/<repo>/' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  ghcr.io/<owner>/proctira-api-gateway@sha256:<digest>
```

## Honest residuals

- Only the `api-gateway` image is signed by this workflow; `release.yml` builds
  the full service matrix without signing. Extending signing to the release
  matrix is tracked under G-735 alongside the framework upgrades.
- The SBOM covers npm dependencies from the lockfile, not OS packages inside the
  container images.
