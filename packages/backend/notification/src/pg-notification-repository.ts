/**
 * Postgres notification delivery repository (G-207).
 * Persists NotificationEntity rows against db/sql/005_notifications_schema.sql.
 * Rules / templates / recipients stay on an in-memory delegate (hybrid).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { withPgTenant, type PgQueryable } from '@proctira/database';
import pg from 'pg';

import { InMemoryNotificationRepository } from './in-memory-repository.js';
import type {
  NotificationEntity,
  NotificationQueryOptions,
  NotificationRepository,
  NotificationRuleEntity,
  NotificationTemplateEntity,
  PaginatedNotifications,
} from './notification-repository.js';
import type {
  DeliveryChannel,
  DeliveryStatus,
  NotificationRuleEvent,
  Priority,
  RecipientQuery,
} from './schemas.js';

const { Pool } = pg;

export type PgPoolLike = Pick<pg.Pool, 'query' | 'end'> & Partial<Pick<pg.Pool, 'connect'>>;

let sharedPool: pg.Pool | null = null;
let schemaReady: Promise<void> | null = null;

function resolveDatabaseUrl(): string | null {
  const url = process.env.DATABASE_URL?.trim();
  return url && url.length > 0 ? url : null;
}

export function isPgNotificationEnabled(): boolean {
  return resolveDatabaseUrl() !== null;
}

export function getSharedNotificationPool(): pg.Pool | null {
  const url = resolveDatabaseUrl();
  if (!url) return null;
  if (!sharedPool) {
    sharedPool = new Pool({ connectionString: url });
  }
  return sharedPool;
}

function schemaSqlPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, '../../../../db/sql/005_notifications_schema.sql'),
    join(process.cwd(), 'db/sql/005_notifications_schema.sql'),
    join(process.cwd(), '../../db/sql/005_notifications_schema.sql'),
  ];
  for (const path of candidates) {
    try {
      readFileSync(path, 'utf8');
      return path;
    } catch {
      // try next
    }
  }
  return candidates[0]!;
}

export async function ensureNotificationSchema(
  pool: PgPoolLike = getSharedNotificationPool()!,
): Promise<void> {
  if (!pool) throw new Error('DATABASE_URL is required for notification schema ensure');
  if (!schemaReady) {
    schemaReady = (async () => {
      const sql = readFileSync(schemaSqlPath(), 'utf8');
      await pool.query(sql);
    })();
  }
  await schemaReady;
}

function mapNotification(row: Record<string, unknown>): NotificationEntity {
  const variablesRaw = row.variables;
  let variables: Record<string, string> = {};
  if (variablesRaw != null) {
    if (typeof variablesRaw === 'string') {
      try {
        variables = JSON.parse(variablesRaw) as Record<string, string>;
      } catch {
        variables = {};
      }
    } else {
      variables = variablesRaw as Record<string, string>;
    }
  }
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    channel: String(row.channel) as DeliveryChannel,
    templateId: String(row.template_id),
    recipientUserId: String(row.recipient_user_id),
    variables,
    status: String(row.status) as DeliveryStatus,
    priority: String(row.priority) as Priority,
    retryCount: Number(row.retry_count),
    maxRetries: Number(row.max_retries),
    sentAt: row.sent_at == null ? null : new Date(String(row.sent_at)),
    deliveredAt: row.delivered_at == null ? null : new Date(String(row.delivered_at)),
    readAt: row.read_at == null ? null : new Date(String(row.read_at)),
    failedAt: row.failed_at == null ? null : new Date(String(row.failed_at)),
    failureReason: row.failure_reason == null ? null : String(row.failure_reason),
    webhookUrl: row.webhook_url == null ? null : String(row.webhook_url),
    createdAt: row.created_at instanceof Date ? row.created_at : new Date(String(row.created_at)),
    updatedAt: row.updated_at instanceof Date ? row.updated_at : new Date(String(row.updated_at)),
  };
}

/**
 * Hybrid: PG for delivery records; in-memory for rules/templates/recipients.
 */
export class HybridNotificationRepository implements NotificationRepository {
  constructor(
    private readonly pool: PgPoolLike,
    private readonly memory: InMemoryNotificationRepository = new InMemoryNotificationRepository(),
  ) {}

  private withTenant<T>(tenantId: string, fn: (client: PgQueryable) => Promise<T>): Promise<T> {
    return withPgTenant(this.pool, tenantId, fn);
  }

  async ensureSchema(): Promise<void> {
    await ensureNotificationSchema(this.pool);
  }

  seedUsers(
    users: Array<{ id: string; roleIds: string[]; areaIds: string[]; institutionIds: string[] }>,
  ): void {
    this.memory.seedUsers(users);
  }

  async createNotification(entity: NotificationEntity): Promise<NotificationEntity> {
    await this.ensureSchema();
    return this.withTenant(entity.tenantId, async (client) => {
      const result = await client.query(
        `INSERT INTO notifications (
           id, tenant_id, channel, template_id, recipient_user_id, variables,
           status, priority, retry_count, max_retries,
           sent_at, delivered_at, read_at, failed_at, failure_reason, webhook_url,
           created_at, updated_at
         ) VALUES (
           $1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,now(),now()
         ) RETURNING *`,
        [
          entity.id,
          entity.tenantId,
          entity.channel,
          entity.templateId,
          entity.recipientUserId,
          JSON.stringify(entity.variables ?? {}),
          entity.status,
          entity.priority,
          entity.retryCount,
          entity.maxRetries,
          entity.sentAt,
          entity.deliveredAt,
          entity.readAt,
          entity.failedAt,
          entity.failureReason,
          entity.webhookUrl,
        ],
      );
      return mapNotification(result.rows[0] as Record<string, unknown>);
    });
  }

  async getNotificationById(tenantId: string, id: string): Promise<NotificationEntity | null> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM notifications WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
        [id, tenantId],
      );
      if (!result.rows[0]) return null;
      return mapNotification(result.rows[0] as Record<string, unknown>);
    });
  }

  async updateNotificationStatus(
    id: string,
    tenantId: string,
    update: {
      status: DeliveryStatus;
      sentAt?: Date | null;
      deliveredAt?: Date | null;
      readAt?: Date | null;
      failedAt?: Date | null;
      failureReason?: string | null;
      retryCount?: number;
    },
  ): Promise<NotificationEntity | null> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const existingResult = await client.query(
        `SELECT * FROM notifications WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
        [id, tenantId],
      );
      if (!existingResult.rows[0]) return null;
      const existing = mapNotification(existingResult.rows[0] as Record<string, unknown>);
      const next: NotificationEntity = {
        ...existing,
        status: update.status,
        sentAt: update.sentAt !== undefined ? update.sentAt : existing.sentAt,
        deliveredAt: update.deliveredAt !== undefined ? update.deliveredAt : existing.deliveredAt,
        readAt: update.readAt !== undefined ? update.readAt : existing.readAt,
        failedAt: update.failedAt !== undefined ? update.failedAt : existing.failedAt,
        failureReason:
          update.failureReason !== undefined ? update.failureReason : existing.failureReason,
        retryCount: update.retryCount !== undefined ? update.retryCount : existing.retryCount,
        updatedAt: new Date(),
      };
      const result = await client.query(
        `UPDATE notifications SET
           status = $3, sent_at = $4, delivered_at = $5, read_at = $6,
           failed_at = $7, failure_reason = $8, retry_count = $9, updated_at = now()
         WHERE id = $1 AND tenant_id = $2
         RETURNING *`,
        [
          id,
          tenantId,
          next.status,
          next.sentAt,
          next.deliveredAt,
          next.readAt,
          next.failedAt,
          next.failureReason,
          next.retryCount,
        ],
      );
      return mapNotification(result.rows[0] as Record<string, unknown>);
    });
  }

  async getUserNotifications(
    tenantId: string,
    userId: string,
    options: NotificationQueryOptions,
  ): Promise<PaginatedNotifications> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const params: unknown[] = [tenantId, userId];
      const filters: string[] = ['tenant_id = $1', 'recipient_user_id = $2'];
      if (options.status) {
        params.push(options.status);
        filters.push(`status = $${params.length}`);
      }
      if (options.channel) {
        params.push(options.channel);
        filters.push(`channel = $${params.length}`);
      }
      const where = filters.join(' AND ');
      const countResult = await client.query(
        `SELECT COUNT(*)::int AS total FROM notifications WHERE ${where}`,
        params,
      );
      const total = Number((countResult.rows[0] as { total: number }).total);
      const totalPages = Math.max(1, Math.ceil(total / options.pageSize));
      const offset = (options.page - 1) * options.pageSize;
      params.push(options.pageSize, offset);
      const result = await client.query(
        `SELECT * FROM notifications WHERE ${where}
         ORDER BY created_at DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      return {
        data: result.rows.map((row) => mapNotification(row as Record<string, unknown>)),
        total,
        page: options.page,
        pageSize: options.pageSize,
        totalPages,
      };
    });
  }

  async getRetryableNotifications(tenantId: string): Promise<NotificationEntity[]> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM notifications
         WHERE tenant_id = $1 AND status = 'failed' AND retry_count < max_retries
         ORDER BY created_at ASC`,
        [tenantId],
      );
      return result.rows.map((row) => mapNotification(row as Record<string, unknown>));
    });
  }

  // ─── Rules / templates / recipients (in-memory) ─────────────────────────

  createRule(entity: NotificationRuleEntity): Promise<NotificationRuleEntity> {
    return this.memory.createRule(entity);
  }

  getRuleById(tenantId: string, id: string): Promise<NotificationRuleEntity | null> {
    return this.memory.getRuleById(tenantId, id);
  }

  updateRule(
    id: string,
    tenantId: string,
    update: Partial<Omit<NotificationRuleEntity, 'id' | 'tenantId' | 'createdAt'>>,
  ): Promise<NotificationRuleEntity | null> {
    return this.memory.updateRule(id, tenantId, update);
  }

  deleteRule(tenantId: string, id: string): Promise<boolean> {
    return this.memory.deleteRule(tenantId, id);
  }

  getActiveRulesForEvent(
    tenantId: string,
    entityType: string,
    event: NotificationRuleEvent,
  ): Promise<NotificationRuleEntity[]> {
    return this.memory.getActiveRulesForEvent(tenantId, entityType, event);
  }

  listRules(tenantId: string): Promise<NotificationRuleEntity[]> {
    return this.memory.listRules(tenantId);
  }

  createTemplate(entity: NotificationTemplateEntity): Promise<NotificationTemplateEntity> {
    return this.memory.createTemplate(entity);
  }

  getTemplateById(tenantId: string, id: string): Promise<NotificationTemplateEntity | null> {
    return this.memory.getTemplateById(tenantId, id);
  }

  listTemplates(tenantId: string): Promise<NotificationTemplateEntity[]> {
    return this.memory.listTemplates(tenantId);
  }

  resolveRecipients(tenantId: string, query: RecipientQuery): Promise<string[]> {
    return this.memory.resolveRecipients(tenantId, query);
  }
}

export function createPgNotificationRepository(): HybridNotificationRepository | null {
  const pool = getSharedNotificationPool();
  if (!pool) return null;
  return new HybridNotificationRepository(pool);
}
