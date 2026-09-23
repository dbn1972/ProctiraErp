/**
 * Which Next server the Playwright suite should run against.
 *
 * ## Why this is a function and not an inline ternary
 *
 * The first version of this gated on `process.env.CI` alone, reasoning that CI always
 * builds first because the Integration Tests job runs `pnpm turbo run test:e2e` and
 * `test:e2e` declares `dependsOn: ["build"]`. That reasoning was true of *one* caller and
 * false of the other two, and CI proved it: `E2E Backend Ready` and `Visual Regression`
 * both went red at web-server start with
 *
 *   Could not find a production build in the '.next' directory
 *
 * Both run `pnpm --filter @proctira/web exec playwright test` directly rather than through
 * turbo — `tools/scripts/run-e2e-backend-ready.sh` builds only `@proctira/api-gateway`, and
 * `visual-regression.yml` builds nothing — while GitHub Actions sets `CI` on every runner.
 * `E2E Backend Ready` is a hard pull-request gate, so that predicate would have broken
 * every PR.
 *
 * `CI` was a proxy for "a production build exists". The two are not the same thing, so the
 * condition now names the thing it actually needs.
 *
 * ## Why both conditions, not just the artifact
 *
 * `next start` serves whatever is in `.next` with no check that it matches the working
 * tree, and `next dev` overwrites `.next` with a dev build. Gating on the artifact alone
 * would mean a developer with a stale build silently testing an older commit. Requiring
 * `CI` as well keeps local runs on `next dev`, which always compiles current source, and
 * limits the production path to runners that just produced the build.
 *
 * Residual: a self-hosted runner reusing a checkout could serve a stale `.next`. Hosted
 * runners start clean, and turbo's cache restore is keyed on inputs, so a restored build
 * matches the commit. Worth a freshness check if self-hosted runners are ever adopted.
 */
export interface WebServerCommandInput {
  /** Truthy when running in CI — the only place a prebuilt server is used. */
  ci: boolean;
  /** Whether `.next/BUILD_ID` exists, i.e. `next build` has completed here. */
  hasProductionBuild: boolean;
  port: string;
}

/**
 * `next start` only when CI has actually produced a build; `next dev` everywhere else.
 *
 * Choosing `next dev` is always safe — it compiles on demand — so every caller that does
 * not build keeps working without having to know about this file.
 */
export function resolveWebServerCommand({
  ci,
  hasProductionBuild,
  port,
}: WebServerCommandInput): string {
  const mode = ci && hasProductionBuild ? 'start' : 'dev';
  return `pnpm --filter @proctira/web exec next ${mode} --port ${port}`;
}
