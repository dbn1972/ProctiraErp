/**
 * PRC-M419: database URL resolution for the tools/migrations `*.live.test.ts` suites.
 *
 * Same contract as `@proctira/testing/live-database` (W3-TEST-03), inlined so this
 * tooling package takes no new workspace dependency: a live suite must not skip silently
 * in CI. The migration suites create and drop throwaway schemas, so they prefer the
 * migration role (MIGRATOR_DATABASE_URL) and fall back to DATABASE_URL.
 */
export function liveDatabaseUrl(
  suite: string,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const url = env['MIGRATOR_DATABASE_URL']?.trim() || env['DATABASE_URL']?.trim();
  if (url) return url;
  const required =
    env['ALLOW_LIVE_TEST_SKIP'] !== '1' &&
    (env['REQUIRE_LIVE_TESTS'] === '1' || env['CI'] === 'true' || env['CI'] === '1');
  const message =
    `[W3-TEST-03] Live suite "${suite}" has no MIGRATOR_DATABASE_URL or DATABASE_URL. ` +
    `Silent skip is forbidden when CI=true or REQUIRE_LIVE_TESTS=1.`;
  if (required) throw new Error(message);
  console.warn(`WARNING: ${message} Skipping live suite.`);
  return undefined;
}
