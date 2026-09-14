/**
 * W3-TEST-03 — live Postgres suite visibility helper.
 *
 * `describe.skipIf(!DATABASE_URL)` exits 0 with a silent skip. That made CI
 * green when live suites never ran. This helper:
 * - returns the URL when set (suite should execute)
 * - fails closed when CI / REQUIRE_LIVE_TESTS demands a live DB
 * - otherwise logs a loud warning and returns undefined so local skip is explicit
 */

export type LiveDatabaseOptions = {
  /** Suite label for error / warning messages. */
  suite: string;
  env?: NodeJS.ProcessEnv;
};

export function resolveLiveDatabaseUrl(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const url = env['DATABASE_URL']?.trim();
  return url ? url : undefined;
}

export function liveTestsRequired(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env['ALLOW_LIVE_TEST_SKIP'] === '1') return false;
  if (env['REQUIRE_LIVE_TESTS'] === '1') return true;
  // GitHub Actions / most CI providers set CI=true.
  return env['CI'] === 'true' || env['CI'] === '1';
}

/**
 * Resolve DATABASE_URL for a `*.live.test.ts` suite.
 * @returns connection string, or `undefined` only when a local skip is allowed
 * @throws when a live DB is required but DATABASE_URL is unset
 */
export function requireLiveDatabaseUrl(options: LiveDatabaseOptions): string | undefined {
  const env = options.env ?? process.env;
  const url = resolveLiveDatabaseUrl(env);
  if (url) return url;

  const message =
    `[W3-TEST-03] Live suite "${options.suite}" has no DATABASE_URL. ` +
    `Silent skip is forbidden when CI=true or REQUIRE_LIVE_TESTS=1 ` +
    `(set ALLOW_LIVE_TEST_SKIP=1 only for intentional unit-only jobs).`;

  if (liveTestsRequired(env)) {
    throw new Error(message);
  }

  // Local / explicit allow: loud, not silent.
  console.warn(`WARNING: ${message} Skipping live suite.`);
  return undefined;
}
