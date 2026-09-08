/**
 * Postgres audit repository (G-704) on db/sql/022_control_plane_schema.sql.
 *
 * Append-only: the table trigger rejects UPDATE and only allows DELETE while
 * `app.audit_archival = '1'` is bound — which this class does exclusively
 * inside {@link archiveExpiredEntries}.
 */
import {
  withPlatformScope,
  type PgPoolWithConnect,
  type PgQueryable,
} from '@proctira/database';

import type {
  ArchivalResult,
  AuditLogEntry,
  AuditLogQuery,
  AuditLogQueryResult,
  AuditRepository,
  AuditRetentionConfig,
  CreateAuditLogInput,
} from './audit-repository.js';

function toDate(v: unknown): Date {
  return v instanceof Date ? v : new Date(String(v));
}

function mapEntry(row: Record<string, unknown>): AuditLogEntry {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    entityType: String(row.entity_type),
    entityId: String(row.entity_id),
    operation: String(row.operation) as AuditLogEntry['operation'],
    userId: String(row.user_id),
    userName: String(row.user_name),
    ipAddress: String(row.ip_address),
    timestamp: toDate(row.occurred_at),
    beforeValues: (row.before_values as Record<string, unknown> | null) ?? null,
    afterValues: (row.after_values as Record<string, unknown> | null) ?? null,
    metadata: (row.metadata as Record<string, unknown> | null) ?? null,
  };
}

function mapRetention(row: Record<string, unknown>): AuditRetentionConfig {
  return {
    tenantId: String(row.tenant_id),
    retentionMonths: Number(row.retention_months),
    archivalEnabled: Boolean(row.archival_enabled),
    archivalDestination: row.archival_destination == null ? null : String(row.archival_destination),
    lastArchivalAt: row.last_archival_at == null ? null : toDate(row.last_archival_at),
  };
}

function cutoffFor(config: AuditRetentionConfig): Date {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - config.retentionMonths);
  return cutoff;
}

export class PgAuditRepository implements AuditRepository {
  constructor(private readonly pool: PgPoolWithConnect | PgQueryable) {}

  private scoped<T>(tenantId: string, fn: (client: PgQueryable) => Promise<T>): Promise<T> {
    return withPlatformScope(this.pool, fn, tenantId);
  }

  private async insert(client: PgQueryable, input: CreateAuditLogInput): Promise<AuditLogEntry> {
    const res = await client.query(
      `INSERT INTO audit_log_entries (
         id, tenant_id, entity_type, entity_id, operation, user_id, user_name,
         ip_address, occurred_at, before_values, after_values, metadata
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12::jsonb)
       RETURNING *`,
      [
        input.id,
        input.tenantId,
        input.entityType,
        input.entityId,
        input.operation,
        input.userId,
        input.userName,
        input.ipAddress,
        input.timestamp,
        input.beforeValues == null ? null : JSON.stringify(input.beforeValues),
        input.afterValues == null ? null : JSON.stringify(input.afterValues),
        input.metadata == null ? null : JSON.stringify(input.metadata),
      ],
    );
    return mapEntry(res.rows[0] as Record<string, unknown>);
  }

  async create(input: CreateAuditLogInput): Promise<AuditLogEntry> {
    return this.scoped(input.tenantId, (client) => this.insert(client, input));
  }

  async createBatch(inputs: CreateAuditLogInput[]): Promise<AuditLogEntry[]> {
    if (inputs.length === 0) return [];
    const tenantId = inputs[0]!.tenantId;
    return this.scoped(tenantId, async (client) => {
      const out: AuditLogEntry[] = [];
      for (const input of inputs) out.push(await this.insert(client, input));
      return out;
    });
  }

  async query(query: AuditLogQuery): Promise<AuditLogQueryResult> {
    return this.scoped(query.tenantId, async (client) => {
      const where: string[] = ['tenant_id = $1'];
      const values: unknown[] = [query.tenantId];
      const add = (clause: string, value: unknown) => {
        values.push(value);
        where.push(`${clause} $${values.length}`);
      };
      if (query.entityType) add('entity_type =', query.entityType);
      if (query.entityId) add('entity_id =', query.entityId);
      if (query.userId) add('user_id =', query.userId);
      if (query.operation) add('operation =', query.operation);
      if (query.startDate) add('occurred_at >=', new Date(query.startDate));
      if (query.endDate) {
        const end = new Date(query.endDate);
        // Inclusive end date: treat a bare date as end-of-day.
        if (/^\d{4}-\d{2}-\d{2}$/.test(query.endDate)) end.setUTCHours(23, 59, 59, 999);
        add('occurred_at <=', end);
      }
      const whereSql = where.join(' AND ');
      const order = query.sortOrder === 'asc' ? 'ASC' : 'DESC';
      const count = await client.query(
        `SELECT COUNT(*)::int AS c FROM audit_log_entries WHERE ${whereSql}`,
        values,
      );
      const totalItems = Number((count.rows[0] as { c: number }).c);
      const offset = (query.page - 1) * query.pageSize;
      const rows = await client.query(
        `SELECT * FROM audit_log_entries WHERE ${whereSql}
         ORDER BY occurred_at ${order}, id ${order}
         LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, query.pageSize, offset],
      );
      return {
        data: rows.rows.map((r) => mapEntry(r as Record<string, unknown>)),
        meta: {
          page: query.page,
          pageSize: query.pageSize,
          totalItems,
          totalPages: Math.ceil(totalItems / query.pageSize) || 0,
        },
      };
    });
  }

  async findById(tenantId: string, id: string): Promise<AuditLogEntry | null> {
    return this.scoped(tenantId, async (client) => {
      const res = await client.query(
        `SELECT * FROM audit_log_entries WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
        [tenantId, id],
      );
      const row = res.rows[0] as Record<string, unknown> | undefined;
      return row ? mapEntry(row) : null;
    });
  }

  async getRetentionConfig(tenantId: string): Promise<AuditRetentionConfig | null> {
    return this.scoped(tenantId, async (client) => {
      const res = await client.query(
        `SELECT * FROM audit_retention_configs WHERE tenant_id = $1 LIMIT 1`,
        [tenantId],
      );
      const row = res.rows[0] as Record<string, unknown> | undefined;
      return row ? mapRetention(row) : null;
    });
  }

  async setRetentionConfig(config: AuditRetentionConfig): Promise<AuditRetentionConfig> {
    return this.scoped(config.tenantId, async (client) => {
      const res = await client.query(
        `INSERT INTO audit_retention_configs
           (tenant_id, retention_months, archival_enabled, archival_destination, last_archival_at)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (tenant_id) DO UPDATE SET
           retention_months = EXCLUDED.retention_months,
           archival_enabled = EXCLUDED.archival_enabled,
           archival_destination = EXCLUDED.archival_destination,
           last_archival_at = EXCLUDED.last_archival_at,
           updated_at = now()
         RETURNING *`,
        [
          config.tenantId,
          config.retentionMonths,
          config.archivalEnabled,
          config.archivalDestination,
          config.lastArchivalAt,
        ],
      );
      return mapRetention(res.rows[0] as Record<string, unknown>);
    });
  }

  async archiveExpiredEntries(tenantId: string): Promise<ArchivalResult> {
    const config = await this.getRetentionConfig(tenantId);
    if (!config || !config.archivalEnabled) {
      return { archivedCount: 0, cutoffDate: new Date(), destination: '', executedAt: new Date() };
    }
    const cutoffDate = cutoffFor(config);
    const executedAt = new Date();
    return this.scoped(tenantId, async (client) => {
      await client.query(`SELECT set_config('app.audit_archival', '1', true)`);
      const moved = await client.query(
        `WITH moved AS (
           DELETE FROM audit_log_entries
           WHERE tenant_id = $1 AND occurred_at < $2
           RETURNING *
         )
         INSERT INTO audit_log_archive (
           id, tenant_id, entity_type, entity_id, operation, user_id, user_name,
           ip_address, occurred_at, before_values, after_values, metadata, created_at,
           archived_at, destination
         )
         SELECT id, tenant_id, entity_type, entity_id, operation, user_id, user_name,
                ip_address, occurred_at, before_values, after_values, metadata, created_at,
                now(), $3
         FROM moved
         RETURNING id`,
        [tenantId, cutoffDate, config.archivalDestination],
      );
      await client.query(
        `UPDATE audit_retention_configs SET last_archival_at = $2, updated_at = now()
         WHERE tenant_id = $1`,
        [tenantId, executedAt],
      );
      return {
        archivedCount: moved.rows.length,
        cutoffDate,
        destination: config.archivalDestination ?? 'audit_log_archive',
        executedAt,
      };
    });
  }

  async getArchivalCandidateCount(tenantId: string): Promise<number> {
    const config = await this.getRetentionConfig(tenantId);
    if (!config || !config.archivalEnabled) return 0;
    const cutoff = cutoffFor(config);
    return this.scoped(tenantId, async (client) => {
      const res = await client.query(
        `SELECT COUNT(*)::int AS c FROM audit_log_entries WHERE tenant_id = $1 AND occurred_at < $2`,
        [tenantId, cutoff],
      );
      return Number((res.rows[0] as { c: number }).c);
    });
  }
}
