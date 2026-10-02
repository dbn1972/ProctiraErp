/**
 * PRC-H005: live data sources for the platform-admin console routes.
 *
 * The console previously served hard-coded payloads ("postgres up / healthy 8ms", a fabricated
 * "Live gateway audit feed" row) and kept tenants in a console-only document store that the real
 * tenant lifecycle never saw. These helpers back those routes with real probes and real stores,
 * and report `unknown` / `unavailable` honestly when a source is not configured.
 */
import type { TenantEntity } from '@proctira/backend-tenant';
import { withPlatformScope, type PgPoolWithConnect } from '@proctira/database';

export interface SqlPool {
  query: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
}

export type ProbeStatus = 'healthy' | 'down' | 'unknown';

export interface AdapterProbe {
  name: string;
  category: 'database' | 'cache' | 'queue' | 'storage' | 'external';
  status: ProbeStatus;
  latencyMs: number | null;
  note: string;
  lastChecked: string;
}

/** Ping Postgres with SELECT 1. Never reports healthy without a successful round-trip. */
export async function probePostgres(
  pool: SqlPool | null,
  now: () => Date = () => new Date(),
): Promise<AdapterProbe> {
  const lastChecked = now().toISOString();
  if (!pool) {
    return {
      name: 'PostgreSQL',
      category: 'database',
      status: 'unknown',
      latencyMs: null,
      note: 'DATABASE_URL not configured; no database probe was run',
      lastChecked,
    };
  }
  const started = Date.now();
  try {
    await pool.query('SELECT 1');
    return {
      name: 'PostgreSQL',
      category: 'database',
      status: 'healthy',
      latencyMs: Date.now() - started,
      note: 'SELECT 1 round-trip',
      lastChecked,
    };
  } catch (error) {
    return {
      name: 'PostgreSQL',
      category: 'database',
      status: 'down',
      latencyMs: Date.now() - started,
      note: `Probe failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      lastChecked,
    };
  }
}

export interface ConsoleAuditEntry {
  id: string;
  timestamp: string;
  actor: string;
  actorRole: string | null;
  action: string;
  resource: string;
  resourceType: string;
  tenantId: string;
  outcome: 'success';
  reason: string | null;
}

/**
 * Read the most recent audit trail rows across tenants (platform scope). Only rows that exist in
 * audit_log_entries are returned.
 */
export async function queryPlatformAudit(
  pool: SqlPool | PgPoolWithConnect,
  limit = 100,
): Promise<ConsoleAuditEntry[]> {
  const bounded = Math.max(1, Math.min(500, Math.floor(limit)));
  const sql = `SELECT id, tenant_id, entity_type, entity_id, operation, user_id, user_name, occurred_at, metadata
       FROM audit_log_entries
      ORDER BY occurred_at DESC
      LIMIT $1`;
  // audit_log_entries is FORCE RLS: a bare pooled query as the runtime role returns no rows.
  // Read under the transaction-local platform-admin scope (same path as PgAuditRepository).
  const { rows } = await withPlatformScope(
    pool as PgPoolWithConnect,
    (client) => client.query(sql, [bounded]) as Promise<{ rows: Record<string, unknown>[] }>,
  );
  return rows.map((row) => {
    const metadata =
      row['metadata'] && typeof row['metadata'] === 'object'
        ? (row['metadata'] as Record<string, unknown>)
        : {};
    const occurred = row['occurred_at'];
    return {
      id: String(row['id']),
      timestamp: occurred instanceof Date ? occurred.toISOString() : String(occurred),
      actor: String(row['user_name'] || row['user_id']),
      actorRole: typeof metadata['actorRole'] === 'string' ? metadata['actorRole'] : null,
      action: `${String(row['entity_type'])}.${String(row['operation']).toLowerCase()}`,
      resource: String(row['entity_id']),
      resourceType: String(row['entity_type']),
      tenantId: String(row['tenant_id']),
      outcome: 'success',
      reason: typeof metadata['reason'] === 'string' ? metadata['reason'] : null,
    };
  });
}

export type ConsoleTenantStatus =
  'provisioning' | 'active' | 'suspended' | 'decommissioning' | 'archived';

export interface ConsoleTenant {
  id: string;
  slug: string;
  name: string;
  status: ConsoleTenantStatus;
  plan: string;
  region: string;
  createdAt: string;
  /** Not held by the tenant service; null rather than a fabricated value. */
  contactEmail: string | null;
  /** Not held by the tenant service; null rather than a fabricated 0. */
  activeUsers: number | null;
  entitlements: string[];
  suspendedReason?: string | null;
  dataRetentionUntil?: string | null;
  source: 'tenant-service';
}

/** Map the real tenant record onto the console's tenant shape. */
export function toConsoleTenant(entity: TenantEntity): ConsoleTenant {
  const modules = entity.config?.features?.modules ?? {};
  return {
    id: entity.id,
    slug: entity.slug,
    name: entity.name,
    // The service has one terminal state; the console shows it as decommissioning while data is
    // retained (dataRetentionUntil), matching its own label for that phase.
    status: entity.status === 'decommissioned' ? 'decommissioning' : entity.status,
    plan: entity.plan ?? 'unassigned',
    region: entity.region ?? 'unassigned',
    createdAt: new Date(entity.createdAt).toISOString(),
    contactEmail: null,
    activeUsers: null,
    entitlements: Object.entries(modules)
      .filter(([, enabled]) => enabled)
      .map(([key]) => key),
    suspendedReason: entity.suspendedReason,
    dataRetentionUntil: entity.dataRetentionUntil
      ? new Date(entity.dataRetentionUntil).toISOString()
      : null,
    source: 'tenant-service',
  };
}
