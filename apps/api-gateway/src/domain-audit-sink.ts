/**
 * PRC-M527 / PRC-M495 / PRC-L317 / PRC-M544: gateway writer for package-level domain audit
 * sinks (LMS, assessment, hostel, staff). Same shape as `gradebookAuditSink()` in
 * domain-plugins.ts: each entry is appended to the shared hash-chained `audit_log_entries`
 * table under `withPgTenant`, awaited so a failed write surfaces as an error. Returns null when
 * no shared pool exists (in-memory deployments keep their current behaviour).
 */
import { appendAuditEntryOnClient, toCreateAuditLogInput } from '@proctira/backend-audit';
import type { ReportAuditEvent, ReportAuditPort } from '@proctira/backend-report';
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

/**
 * UAT-SEC-001 / PRC-L337 / PRC-L340: the report catalogue's `ReportAuditPort` backed by
 * `domainAuditSink('report')`, so generate, download, download-denied and schedule-create
 * events land in the keyed `audit_log_entries` chain. The event's tenant and actor come from
 * the verified principal (catalogue-routes `resolveTenantId` / `resolveUserId`); a denial is
 * recorded under the CALLER tenant with the requested id and a reason code, never anything
 * read from another tenant's row. Only ids, report key, format and reason are written (no
 * PHI). Downloads are read audits (`CREATE` + `metadata.read`, as assessment/LMS do). The
 * catalogue's `emitAudit` swallows a failed write, so the HTTP response never changes.
 * Undefined without a shared pool: the plugin keeps its no-op default.
 */
export function reportCatalogueAuditPort(): ReportAuditPort | undefined {
  const sink = domainAuditSink('report');
  if (!sink) return undefined;
  return {
    record: (event: ReportAuditEvent) => {
      const metadata: Record<string, unknown> = {};
      if (event.reportKey !== undefined) metadata.reportKey = event.reportKey;
      if (event.format !== undefined) metadata.format = event.format;
      if (event.runId !== undefined) metadata.runId = event.runId;
      if (event.reason !== undefined) metadata.reason = event.reason;
      if (event.action === 'report.download' || event.action === 'report.download.denied') {
        metadata.read = true;
      }
      const schedule = event.scheduleId !== undefined;
      return sink({
        tenantId: event.tenantId,
        // `report.download.denied` -> regulated tag `report.download.denied`.
        action: event.action.replace(/^report\./, ''),
        entityType: schedule ? 'report_schedule' : 'report_artifact',
        entityId: (schedule ? event.scheduleId : event.artifactId) ?? 'unknown',
        actorId: event.actorId,
        operation: 'CREATE',
        metadata,
      });
    },
  };
}
