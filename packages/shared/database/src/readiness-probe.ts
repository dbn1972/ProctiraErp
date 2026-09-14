/**
 * W3-C2 / W1-OPS-03 — shared readiness probe for services with Postgres persistence.
 *
 * Probes critical dependencies and fails closed when Postgres is required but
 * unavailable. In-memory mode is reported honestly when DATABASE_URL is unset
 * and persistence policy allows it.
 */
import pg from 'pg';

import {
  readPersistencePolicyEnv,
  type PersistencePolicyEnv,
} from './persistence-policy.js';

export type DatabaseDependencyStatus = 'up' | 'down' | 'in-memory' | 'required-missing';

export interface ReadinessProbeResult {
  ready: boolean;
  dependencies: { database: DatabaseDependencyStatus };
  message?: string;
  latencyMs?: number;
}

export interface ReadinessProbeOptions {
  /** Override DB probe (tests). */
  probeDatabase?: () => Promise<{ ok: boolean; message?: string; latencyMs?: number }>;
  /** Override env read (tests). */
  env?: PersistencePolicyEnv;
  /** DB probe timeout in ms (default 3000). */
  probeTimeoutMs?: number;
}

function truthy(value: string | undefined): boolean {
  const v = value?.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

function databaseRequired(env: PersistencePolicyEnv): boolean {
  if (truthy(env.REQUIRE_DATABASE)) return true;
  if (env.NODE_ENV === 'production' && !truthy(env.ALLOW_IN_MEMORY_IN_PRODUCTION)) {
    return true;
  }
  return Boolean(env.DATABASE_URL?.trim());
}

async function defaultProbeDatabase(
  databaseUrl: string,
  timeoutMs: number,
): Promise<{ ok: boolean; message?: string; latencyMs?: number }> {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  const start = Date.now();
  try {
    await Promise.race([
      pool.query('SELECT 1 AS ok'),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`Database probe timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
    return { ok: true, latencyMs: Date.now() - start };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
      latencyMs: Date.now() - start,
    };
  } finally {
    await pool.end().catch(() => undefined);
  }
}

/** Probe critical deps; fail closed when Postgres is required but unavailable. */
export async function runReadinessProbe(
  options: ReadinessProbeOptions = {},
): Promise<ReadinessProbeResult> {
  const env = options.env ?? readPersistencePolicyEnv();
  const databaseUrl = env.DATABASE_URL?.trim() || null;
  const timeoutMs = options.probeTimeoutMs ?? 3000;

  if (!databaseUrl) {
    if (databaseRequired(env)) {
      return {
        ready: false,
        dependencies: { database: 'required-missing' },
        message: 'DATABASE_URL is required but not configured',
      };
    }
    return {
      ready: true,
      dependencies: { database: 'in-memory' },
      message: 'In-memory persistence (DATABASE_URL unset)',
    };
  }

  const probe = options.probeDatabase ?? (() => defaultProbeDatabase(databaseUrl, timeoutMs));
  const result = await probe();

  if (!result.ok) {
    return {
      ready: false,
      dependencies: { database: 'down' },
      message: result.message ?? 'Database probe failed',
      latencyMs: result.latencyMs,
    };
  }

  return {
    ready: true,
    dependencies: { database: 'up' },
    latencyMs: result.latencyMs,
  };
}
