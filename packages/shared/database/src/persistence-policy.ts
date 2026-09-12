/**
 * G-714 + P0-05 — persistence fallback policy shared by every repository factory.
 *
 * Domain packages may use in-memory stores when `DATABASE_URL` is **unset**
 * (unit tests / local exploration). That is never OK when a connection string
 * is configured: silent memory would discard durable writes while operators
 * believe Postgres is in use. Factories call
 * {@link assertInMemoryFallbackAllowed} before returning an in-memory store:
 *
 *   - `DATABASE_URL` set     → throw (fail-closed; P0-05)
 *   - `REQUIRE_DATABASE=1`   → throw (any environment)
 *   - `NODE_ENV=production`  → throw unless `ALLOW_IN_MEMORY_IN_PRODUCTION=1`
 *   - otherwise              → log one warning per domain and continue
 */
export interface PersistencePolicyEnv {
  NODE_ENV?: string;
  DATABASE_URL?: string;
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
  // Defense-in-depth: env may still carry DATABASE_URL even if the factory
  // passed an empty override — never allow memory in that case (P0-05).
  assertInMemoryFallbackAllowed(domain, env);
  return 'memory';
}

/**
 * Throws when an in-memory store must not be used in this environment;
 * otherwise emits a single warning per domain so the fallback is never silent.
 *
 * Call this only on the memory path. When `DATABASE_URL` is set, factories must
 * construct a Postgres repository instead — falling through here is a bug and
 * fails closed.
 */
export function assertInMemoryFallbackAllowed(
  domain: string,
  env: PersistencePolicyEnv = process.env,
  log: Pick<Console, 'warn'> = console,
): void {
  if (env.DATABASE_URL?.trim()) {
    throw new Error(
      `[persistence] ${domain}: DATABASE_URL is set — refusing in-memory fallback (fail-closed)`,
    );
  }
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

/**
 * When a factory has already decided Postgres is required (`DATABASE_URL` set)
 * but the pool / Pg repository could not be constructed, throw instead of
 * falling through to memory.
 */
export function assertPostgresRepositoryAvailable(
  domain: string,
  available: unknown,
): asserts available {
  if (available == null || available === false) {
    throw new Error(
      `[persistence] ${domain}: DATABASE_URL is set but Postgres repository is unavailable — refusing in-memory fallback`,
    );
  }
}

/** Test helper: reset the once-per-domain warning cache. */
export function resetPersistenceWarnings(): void {
  warned.clear();
}
