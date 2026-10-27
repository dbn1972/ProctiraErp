/**
 * PRC-M527 / PRC-M495 / PRC-L317 / PRC-M544: gateway writer for package-level domain audit
 * sinks (LMS, assessment, hostel, staff). Same shape as `gradebookAuditSink()` in
 * domain-plugins.ts: each entry is appended to the shared hash-chained `audit_log_entries`
 * table under `withPgTenant`, awaited so a failed write surfaces as an error. Returns null when
 * no shared pool exists (in-memory deployments keep their current behaviour).
 */
import { appendAuditEntryOnClient, toCreateAuditLogInput } from '@proctira/backend-audit';
import { getSharedPgPool, withPgTenant } from '@proctira/database';

/** Structural shape every package's audit entry satisfies. */
export interface DomainAuditSinkEntry {
  tenantId: string;
  action: string;
  entityType: string;
  entityId: string;
  actorId: string | null;
  operation: 'CREATE' | 'UPDATE' | 'DELETE';
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
}

export function domainAuditSink(
  domain: string,
): ((entry: DomainAuditSinkEntry) => Promise<void>) | null {
  const pool = getSharedPgPool();
  if (!pool) return null;
  return async (entry) => {
    await withPgTenant(pool, entry.tenantId, async (client) => {
      await appendAuditEntryOnClient(
        client,
        toCreateAuditLogInput({
          tenantId: entry.tenantId,
          entityType: entry.entityType,
          entityId: entry.entityId,
          operation: entry.operation,
          userId: entry.actorId ?? 'unknown',
          userName: entry.actorId ?? 'unknown',
          ipAddress: 'unknown',
          beforeValues: entry.before ?? null,
          afterValues: entry.after ?? null,
          metadata: {
            ...entry.metadata,
            regulated: `${domain}.${entry.action}`,
            action: entry.action,
          },
        }),
      );
    });
  };
}
