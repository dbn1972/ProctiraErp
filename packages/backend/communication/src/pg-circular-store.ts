/**
 * Postgres circular / delivery-log store (db/sql/044_communication_circulars_schema.sql).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { withPgTenant, type PgQueryable } from '@proctira/database';

import type {
  CircularAckRecord,
  CircularAudienceType,
  CircularRecord,
  CircularStatus,
  CircularStore,
  DeliveryLogFilter,
  DeliveryLogRecord,
  DeliverySourceType,
  DeliveryStatus,
} from './circular-store.js';

export type PgCircularPool = PgQueryable & { connect?: unknown };

let schemaReady: Promise<void> | null = null;

function schemaSqlPaths(): string[] {
  const here = dirname(fileURLToPath(import.meta.url));
  const names = ['007_communication_schema.sql', '044_communication_circulars_schema.sql'];
  const roots = [
    join(here, '../../../../db/sql'),
    join(process.cwd(), 'db/sql'),
    join(process.cwd(), '../../db/sql'),
  ];
  const resolved: string[] = [];
  for (const name of names) {
    for (const root of roots) {
      const path = join(root, name);
      try {
        readFileSync(path, 'utf8');
        resolved.push(path);
        break;
      } catch {
        // try next
      }
    }
  }
  return resolved;
}

export async function ensureCircularSchema(pool: PgCircularPool): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      for (const path of schemaSqlPaths()) {
        await pool.query(readFileSync(path, 'utf8'));
      }
    })().catch((err: unknown) => {
      schemaReady = null;
      throw err;
    });
  }
  await schemaReady;
}

function toDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // fall through
    }
  }
  return {};
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  return [];
}

function mapCircular(row: Record<string, unknown>): CircularRecord {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    title: String(row.title),
    body: String(row.body ?? ''),
    audienceType: String(row.audience_type) as CircularAudienceType,
    audienceJson: asRecord(row.audience_json),
    requiresAck: Boolean(row.requires_ack),
    channels: stringArray(row.channels),
    status: String(row.status) as CircularStatus,
    createdBy: row.created_by == null ? null : String(row.created_by),
    sentAt: row.sent_at == null ? null : toDate(row.sent_at),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function mapAck(row: Record<string, unknown>): CircularAckRecord {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    circularId: String(row.circular_id),
    recipientId: String(row.recipient_id),
    recipientLabel: row.recipient_label == null ? null : String(row.recipient_label),
    acknowledgedAt: row.acknowledged_at == null ? null : toDate(row.acknowledged_at),
    createdAt: toDate(row.created_at),
  };
}

function mapLog(row: Record<string, unknown>): DeliveryLogRecord {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    channel: String(row.channel),
    recipientId: String(row.recipient_id),
    recipientLabel: row.recipient_label == null ? null : String(row.recipient_label),
    status: String(row.status) as DeliveryStatus,
    providerRef: row.provider_ref == null ? null : String(row.provider_ref),
    sourceType: String(row.source_type) as DeliverySourceType,
    sourceId: row.source_id == null ? null : String(row.source_id),
    errorMessage: row.error_message == null ? null : String(row.error_message),
    queuedAt: toDate(row.queued_at),
    sentAt: row.sent_at == null ? null : toDate(row.sent_at),
    deliveredAt: row.delivered_at == null ? null : toDate(row.delivered_at),
    failedAt: row.failed_at == null ? null : toDate(row.failed_at),
    retriedAt: row.retried_at == null ? null : toDate(row.retried_at),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

export class PgCircularStore implements CircularStore {
  constructor(private readonly pool: PgCircularPool) {}

  private run<T>(tenantId: string, fn: (client: PgQueryable) => Promise<T>): Promise<T> {
    return withPgTenant(this.pool as never, tenantId, fn);
  }

  async createCircular(record: CircularRecord): Promise<CircularRecord> {
    await ensureCircularSchema(this.pool);
    return this.run(record.tenantId, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO comms_circulars (
           id, tenant_id, title, body, audience_type, audience_json, requires_ack, channels, status, created_by, sent_at, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12,$13)
         RETURNING *`,
        [
          record.id,
          record.tenantId,
          record.title,
          record.body,
          record.audienceType,
          JSON.stringify(record.audienceJson ?? {}),
          record.requiresAck,
          record.channels,
          record.status,
          record.createdBy,
          record.sentAt,
          record.createdAt,
          record.updatedAt,
        ],
      );
      return mapCircular(rows[0] as Record<string, unknown>);
    });
  }

  async listCirculars(tenantId: string): Promise<CircularRecord[]> {
    await ensureCircularSchema(this.pool);
    return this.run(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM comms_circulars WHERE tenant_id = $1 ORDER BY created_at DESC`,
        [tenantId],
      );
      return rows.map((row) => mapCircular(row as Record<string, unknown>));
    });
  }

  async findCircular(tenantId: string, id: string): Promise<CircularRecord | null> {
    await ensureCircularSchema(this.pool);
    return this.run(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM comms_circulars WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
        [id, tenantId],
      );
      if (!rows[0]) return null;
      return mapCircular(rows[0] as Record<string, unknown>);
    });
  }

  async updateCircular(
    tenantId: string,
    id: string,
    patch: Partial<Pick<CircularRecord, 'status' | 'sentAt'>>,
  ): Promise<CircularRecord | null> {
    await ensureCircularSchema(this.pool);
    return this.run(tenantId, async (client) => {
      const sets: string[] = [];
      const values: unknown[] = [];
      let i = 1;
      if (patch.status !== undefined) {
        sets.push(`status = $${i++}`);
        values.push(patch.status);
      }
      if (patch.sentAt !== undefined) {
        sets.push(`sent_at = $${i++}`);
        values.push(patch.sentAt);
      }
      if (sets.length === 0) return this.findCircular(tenantId, id);
      sets.push(`updated_at = now()`);
      values.push(id, tenantId);
      const { rows } = await client.query(
        `UPDATE comms_circulars SET ${sets.join(', ')} WHERE id = $${i++} AND tenant_id = $${i} RETURNING *`,
        values,
      );
      if (!rows[0]) return null;
      return mapCircular(rows[0] as Record<string, unknown>);
    });
  }

  async createAck(record: CircularAckRecord): Promise<CircularAckRecord> {
    await ensureCircularSchema(this.pool);
    return this.run(record.tenantId, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO comms_circular_acks (
           id, tenant_id, circular_id, recipient_id, recipient_label, acknowledged_at, created_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING *`,
        [
          record.id,
          record.tenantId,
          record.circularId,
          record.recipientId,
          record.recipientLabel,
          record.acknowledgedAt,
          record.createdAt,
        ],
      );
      return mapAck(rows[0] as Record<string, unknown>);
    });
  }

  async listAcks(tenantId: string, circularId: string): Promise<CircularAckRecord[]> {
    await ensureCircularSchema(this.pool);
    return this.run(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM comms_circular_acks WHERE tenant_id = $1 AND circular_id = $2`,
        [tenantId, circularId],
      );
      return rows.map((row) => mapAck(row as Record<string, unknown>));
    });
  }

  async findAck(
    tenantId: string,
    circularId: string,
    recipientId: string,
  ): Promise<CircularAckRecord | null> {
    await ensureCircularSchema(this.pool);
    return this.run(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM comms_circular_acks WHERE tenant_id = $1 AND circular_id = $2 AND recipient_id = $3 LIMIT 1`,
        [tenantId, circularId, recipientId],
      );
      if (!rows[0]) return null;
      return mapAck(rows[0] as Record<string, unknown>);
    });
  }

  async updateAck(
    tenantId: string,
    id: string,
    patch: Partial<Pick<CircularAckRecord, 'acknowledgedAt'>>,
  ): Promise<CircularAckRecord | null> {
    await ensureCircularSchema(this.pool);
    return this.run(tenantId, async (client) => {
      const { rows } = await client.query(
        `UPDATE comms_circular_acks SET acknowledged_at = $1 WHERE id = $2 AND tenant_id = $3 RETURNING *`,
        [patch.acknowledgedAt ?? null, id, tenantId],
      );
      if (!rows[0]) return null;
      return mapAck(rows[0] as Record<string, unknown>);
    });
  }

  async createDeliveryLog(record: DeliveryLogRecord): Promise<DeliveryLogRecord> {
    await ensureCircularSchema(this.pool);
    return this.run(record.tenantId, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO comms_delivery_log (
           id, tenant_id, channel, recipient_id, recipient_label, status, provider_ref,
           source_type, source_id, error_message, queued_at, sent_at, delivered_at, failed_at, retried_at, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         RETURNING *`,
        [
          record.id,
          record.tenantId,
          record.channel,
          record.recipientId,
          record.recipientLabel,
          record.status,
          record.providerRef,
          record.sourceType,
          record.sourceId,
          record.errorMessage,
          record.queuedAt,
          record.sentAt,
          record.deliveredAt,
          record.failedAt,
          record.retriedAt,
          record.createdAt,
          record.updatedAt,
        ],
      );
      return mapLog(rows[0] as Record<string, unknown>);
    });
  }

  async listDeliveryLogs(
    tenantId: string,
    filter: DeliveryLogFilter = {},
  ): Promise<DeliveryLogRecord[]> {
    await ensureCircularSchema(this.pool);
    return this.run(tenantId, async (client) => {
      const clauses = ['tenant_id = $1'];
      const values: unknown[] = [tenantId];
      let i = 2;
      if (filter.channel) {
        clauses.push(`channel = $${i++}`);
        values.push(filter.channel);
      }
      if (filter.status) {
        clauses.push(`status = $${i++}`);
        values.push(filter.status);
      }
      if (filter.sourceType) {
        clauses.push(`source_type = $${i++}`);
        values.push(filter.sourceType);
      }
      const { rows } = await client.query(
        `SELECT * FROM comms_delivery_log WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC`,
        values,
      );
      return rows.map((row) => mapLog(row as Record<string, unknown>));
    });
  }

  async findDeliveryLog(tenantId: string, id: string): Promise<DeliveryLogRecord | null> {
    await ensureCircularSchema(this.pool);
    return this.run(tenantId, async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM comms_delivery_log WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
        [id, tenantId],
      );
      if (!rows[0]) return null;
      return mapLog(rows[0] as Record<string, unknown>);
    });
  }

  async updateDeliveryLog(
    tenantId: string,
    id: string,
    patch: Partial<
      Pick<
        DeliveryLogRecord,
        | 'status'
        | 'providerRef'
        | 'errorMessage'
        | 'sentAt'
        | 'deliveredAt'
        | 'failedAt'
        | 'retriedAt'
      >
    >,
  ): Promise<DeliveryLogRecord | null> {
    await ensureCircularSchema(this.pool);
    return this.run(tenantId, async (client) => {
      const sets: string[] = [];
      const values: unknown[] = [];
      let i = 1;
      if (patch.status !== undefined) {
        sets.push(`status = $${i++}`);
        values.push(patch.status);
      }
      if (patch.providerRef !== undefined) {
        sets.push(`provider_ref = $${i++}`);
        values.push(patch.providerRef);
      }
      if (patch.errorMessage !== undefined) {
        sets.push(`error_message = $${i++}`);
        values.push(patch.errorMessage);
      }
      if (patch.sentAt !== undefined) {
        sets.push(`sent_at = $${i++}`);
        values.push(patch.sentAt);
      }
      if (patch.deliveredAt !== undefined) {
        sets.push(`delivered_at = $${i++}`);
        values.push(patch.deliveredAt);
      }
      if (patch.failedAt !== undefined) {
        sets.push(`failed_at = $${i++}`);
        values.push(patch.failedAt);
      }
      if (patch.retriedAt !== undefined) {
        sets.push(`retried_at = $${i++}`);
        values.push(patch.retriedAt);
      }
      if (sets.length === 0) return this.findDeliveryLog(tenantId, id);
      sets.push(`updated_at = now()`);
      values.push(id, tenantId);
      const { rows } = await client.query(
        `UPDATE comms_delivery_log SET ${sets.join(', ')} WHERE id = $${i++} AND tenant_id = $${i} RETURNING *`,
        values,
      );
      if (!rows[0]) return null;
      return mapLog(rows[0] as Record<string, unknown>);
    });
  }
}
