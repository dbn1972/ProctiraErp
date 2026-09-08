/**
 * G-714 — persistence fallback policy shared by every repository factory.
 *
 * Domain packages fall back to in-memory stores when `DATABASE_URL` is unset.
 * That is fine for unit tests and local exploration, but silently losing data
 * in a deployed environment is not. Factories call
 * {@link assertInMemoryFallbackAllowed} before returning an in-memory store:
 *
 *   - `REQUIRE_DATABASE=1`   → throw (any environment)
 *   - `NODE_ENV=production`  → throw unless `ALLOW_IN_MEMORY_IN_PRODUCTION=1`
 *   - otherwise              → log one warning per domain and continue
 */
export interface PersistencePolicyEnv {
  NODE_ENV?: string;
  REQUIRE_DATABASE?: string;
  ALLOW_IN_MEMORY_IN_PRODUCTION?: string;
}

const warned = new Set<string>();

function truthy(value: string | undefined): boolean {
  const v = value?.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

export type PersistenceMode = 'postgres' | 'memory';

/** Resolve which persistence mode the factory should use, or throw when memory is disallowed. */
export function resolvePersistenceMode(
  domain: string,
  databaseUrl: string | undefined,
  env: PersistencePolicyEnv = process.env,
): PersistenceMode {
  if (databaseUrl && databaseUrl.trim().length > 0) return 'postgres';
  assertInMemoryFallbackAllowed(domain, env);
  return 'memory';
}

/**
 * Throws when an in-memory store must not be used in this environment;
 * otherwise emits a single warning per domain so the fallback is never silent.
 */
export function assertInMemoryFallbackAllowed(
  domain: string,
  env: PersistencePolicyEnv = process.env,
  log: Pick<Console, 'warn'> = console,
): void {
  if (truthy(env.REQUIRE_DATABASE)) {
    throw new Error(
      `[persistence] ${domain}: DATABASE_URL is required (REQUIRE_DATABASE=1) — refusing in-memory fallback`,
    );
  }
  if (env.NODE_ENV === 'production' && !truthy(env.ALLOW_IN_MEMORY_IN_PRODUCTION)) {
    throw new Error(
      `[persistence] ${domain}: in-memory store is not allowed when NODE_ENV=production (set DATABASE_URL)`,
    );
  }
  if (!warned.has(domain)) {
    warned.add(domain);
    log.warn(
      `[persistence] ${domain}: DATABASE_URL unset — using in-memory store (data is lost on restart)`,
    );
  }
}

/** Test helper: reset the once-per-domain warning cache. */
export function resetPersistenceWarnings(): void {
  warned.clear();
}
