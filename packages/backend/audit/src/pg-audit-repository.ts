/**
 * Postgres audit repository (G-704) on db/sql/022_control_plane_schema.sql
 * + 028_audit_hash_chain.sql (G-913).
 *
 * Append-only: the table trigger rejects UPDATE and only allows DELETE while
 * `app.audit_archival = '1'` is bound — which this class does exclusively
 * inside {@link archiveExpiredEntries}. Every insert extends the tenant's
 * sha256 hash chain (see audit-hash.ts) under a row lock on audit_chain_heads.
 */
import { withPlatformScope, type PgPoolWithConnect, type PgQueryable } from '@proctira/database';

import { computeEntryHash, verifyEntrySequence } from './audit-hash.js';
import type {
  ArchivalResult,
  AuditLogEntry,
  AuditLogQuery,
  AuditLogQueryResult,
  AuditRepository,
  AuditRetentionConfig,
  ChainVerification,
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
    chainSeq: row.chain_seq == null ? null : Number(row.chain_seq),
    prevHash: row.prev_hash == null ? null : String(row.prev_hash),
    entryHash: row.entry_hash == null ? null : String(row.entry_hash),
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

  /**
   * G-913: lock the tenant's chain head, compute prev/entry hash, append.
   * Must run inside the caller's transaction (withPlatformScope provides one).
   */
  private async insert(client: PgQueryable, input: CreateAuditLogInput): Promise<AuditLogEntry> {
    await client.query(
      `INSERT INTO audit_chain_heads (tenant_id) VALUES ($1) ON CONFLICT (tenant_id) DO NOTHING`,
      [input.tenantId],
    );
    const head = await client.query(
      `SELECT head_seq, head_hash FROM audit_chain_heads WHERE tenant_id = $1 FOR UPDATE`,
      [input.tenantId],
    );
    const headRow = head.rows[0] as { head_seq: unknown; head_hash: string | null } | undefined;
    const prevHash = headRow?.head_hash ?? null;
    const chainSeq = Number(headRow?.head_seq ?? 0) + 1;
    const entryHash = computeEntryHash(input, prevHash);

    const res = await client.query(
      `INSERT INTO audit_log_entries (
         id, tenant_id, entity_type, entity_id, operation, user_id, user_name,
         ip_address, occurred_at, before_values, after_values, metadata,
         chain_seq, prev_hash, entry_hash
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12::jsonb,$13,$14,$15)
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
        chainSeq,
        prevHash,
        entryHash,
      ],
    );
    await client.query(
      `UPDATE audit_chain_heads SET head_seq = $2, head_hash = $3, updated_at = now()
       WHERE tenant_id = $1`,
      [input.tenantId, chainSeq, entryHash],
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
           chain_seq, prev_hash, entry_hash, archived_at, destination
         )
         SELECT id, tenant_id, entity_type, entity_id, operation, user_id, user_name,
                ip_address, occurred_at, before_values, after_values, metadata, created_at,
                chain_seq, prev_hash, entry_hash, now(), $3
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

  /**
   * G-913: verify across active + archived rows (archival keeps chain columns)
   * so retention runs never break the chain. Streams in pages of 1000.
   */
  async verifyChain(tenantId: string): Promise<ChainVerification> {
    return this.scoped(tenantId, async (client) => {
      const all: AuditLogEntry[] = [];
      const pageSize = 1000;
      let offset = 0;
      for (;;) {
        const res = await client.query(
          `SELECT * FROM (
             SELECT id, tenant_id, entity_type, entity_id, operation, user_id, user_name,
                    ip_address, occurred_at, before_values, after_values, metadata,
                    chain_seq, prev_hash, entry_hash
             FROM audit_log_entries WHERE tenant_id = $1
             UNION ALL
             SELECT id, tenant_id, entity_type, entity_id, operation, user_id, user_name,
                    ip_address, occurred_at, before_values, after_values, metadata,
                    chain_seq, prev_hash, entry_hash
             FROM audit_log_archive WHERE tenant_id = $1
           ) u
           ORDER BY chain_seq ASC NULLS FIRST, occurred_at ASC
           LIMIT $2 OFFSET $3`,
          [tenantId, pageSize, offset],
        );
        for (const row of res.rows) all.push(mapEntry(row as Record<string, unknown>));
        if (res.rows.length < pageSize) break;
        offset += pageSize;
      }
      return verifyEntrySequence(tenantId, all);
    });
  }

  async listTenantsWithArchivalEnabled(): Promise<string[]> {
    return withPlatformScope(this.pool, async (client) => {
      const res = await client.query(
        `SELECT tenant_id FROM audit_retention_configs WHERE archival_enabled ORDER BY tenant_id`,
      );
      return res.rows.map((r) => String((r as { tenant_id: unknown }).tenant_id));
    });
  }
}
