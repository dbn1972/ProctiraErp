/**
 * Postgres notification delivery repository (G-207).
 * Persists NotificationEntity rows against db/sql/005_notifications_schema.sql.
 * Rules / templates / recipients stay on an in-memory delegate (hybrid).
 */
import {
  createDatabaseSchemaReadinessCheck,
  getSharedPgPool,
  withPgTenant,
  type PgQueryable,
} from '@proctira/database';
import type pg from 'pg';

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

export type PgPoolLike = Pick<pg.Pool, 'query' | 'end'> & Partial<Pick<pg.Pool, 'connect'>>;

const ensureNotificationSchemaReady = createDatabaseSchemaReadinessCheck(
  'notifications',
  'notifications',
);

export function isPgNotificationEnabled(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export function getSharedNotificationPool(): pg.Pool | null {
  return getSharedPgPool();
}

export async function ensureNotificationSchema(
  pool: PgPoolLike = getSharedNotificationPool()!,
): Promise<void> {
  if (!pool) throw new Error('DATABASE_URL is required for notification schema ensure');
  await ensureNotificationSchemaReady(pool);
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

/** Parse a JSONB column that may arrive as a parsed object or a JSON string. */
function parseJson<T>(raw: unknown, fallback: T): T {
  if (raw == null) return fallback;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }
  return raw as T;
}

function mapRule(row: Record<string, unknown>): NotificationRuleEntity {
  return {
    id: String(row['id']),
    tenantId: String(row['tenant_id']),
    name: String(row['name']),
    entityType: String(row['entity_type']),
    event: String(row['event']) as NotificationRuleEvent,
    conditions: parseJson<Record<string, unknown>>(row['conditions'], {}),
    templateId: String(row['template_id']),
    channels: parseJson<DeliveryChannel[]>(row['channels'], []),
    recipientQuery: parseJson<RecipientQuery>(row['recipient_query'], {} as RecipientQuery),
    isActive: Boolean(row['is_active']),
    schedule: row['schedule'] == null ? null : String(row['schedule']),
    createdAt:
      row['created_at'] instanceof Date ? row['created_at'] : new Date(String(row['created_at'])),
    updatedAt:
      row['updated_at'] instanceof Date ? row['updated_at'] : new Date(String(row['updated_at'])),
  };
}

function mapTemplate(row: Record<string, unknown>): NotificationTemplateEntity {
  return {
    id: String(row['id']),
    tenantId: String(row['tenant_id']),
    name: String(row['name']),
    channel: String(row['channel']) as DeliveryChannel,
    subject: row['subject'] == null ? null : String(row['subject']),
    body: String(row['body']),
    variables: parseJson<string[]>(row['variables'], []),
    sensitiveVariables: parseJson<string[]>(row['sensitive_variables'], []),
    publicVariables: parseJson<string[]>(row['public_variables'], []),
    createdAt:
      row['created_at'] instanceof Date ? row['created_at'] : new Date(String(row['created_at'])),
    updatedAt:
      row['updated_at'] instanceof Date ? row['updated_at'] : new Date(String(row['updated_at'])),
  };
}

/**
 * Durable notification repository (PRC-H071): PG for delivery records AND for
 * rules / templates / recipient directory. The in-memory delegate remains only
 * for the legacy sync seedUsers helper used by dev/tests.
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
    // Legacy sync seed (dev/tests). Durable resolution reads the directory
    // table; use upsertDirectoryUsers for the production path.
    this.memory.seedUsers(users);
  }

  /**
   * PRC-H071: durably upsert recipient-directory membership for a tenant so
   * role/area/institution broadcasts resolve across replicas and restarts.
   * This is the service's own projection — never a cross-service DB read.
   */
  async upsertDirectoryUsers(
    tenantId: string,
    users: Array<{ id: string; roleIds: string[]; areaIds: string[]; institutionIds: string[] }>,
  ): Promise<void> {
    await this.ensureSchema();
    await this.withTenant(tenantId, async (client) => {
      for (const u of users) {
        await client.query(
          `INSERT INTO notification_directory_users
             (tenant_id, user_id, role_ids, area_ids, institution_ids, updated_at)
           VALUES ($1,$2,$3,$4,$5,now())
           ON CONFLICT (tenant_id, user_id) DO UPDATE SET
             role_ids = EXCLUDED.role_ids,
             area_ids = EXCLUDED.area_ids,
             institution_ids = EXCLUDED.institution_ids,
             updated_at = now()`,
          [tenantId, u.id, u.roleIds, u.areaIds, u.institutionIds],
        );
      }
    });
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
      if (options.unreadOnly) filters.push('read_at IS NULL');
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

  // ─── Rules / templates / recipients (durable, PRC-H071) ─────────────────

  async createRule(entity: NotificationRuleEntity): Promise<NotificationRuleEntity> {
    await this.ensureSchema();
    return this.withTenant(entity.tenantId, async (client) => {
      const result = await client.query(
        `INSERT INTO notification_rules (
           id, tenant_id, name, entity_type, event, conditions, template_id,
           channels, recipient_query, is_active, schedule, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8::jsonb,$9::jsonb,$10,$11,now(),now())
         RETURNING *`,
        [
          entity.id,
          entity.tenantId,
          entity.name,
          entity.entityType,
          entity.event,
          JSON.stringify(entity.conditions ?? {}),
          entity.templateId,
          JSON.stringify(entity.channels ?? []),
          JSON.stringify(entity.recipientQuery ?? {}),
          entity.isActive,
          entity.schedule,
        ],
      );
      return mapRule(result.rows[0] as Record<string, unknown>);
    });
  }

  async getRuleById(tenantId: string, id: string): Promise<NotificationRuleEntity | null> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM notification_rules WHERE id = $1 AND tenant_id = $2`,
        [id, tenantId],
      );
      const row = result.rows[0] as Record<string, unknown> | undefined;
      return row ? mapRule(row) : null;
    });
  }

  async updateRule(
    id: string,
    tenantId: string,
    update: Partial<Omit<NotificationRuleEntity, 'id' | 'tenantId' | 'createdAt'>>,
  ): Promise<NotificationRuleEntity | null> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `UPDATE notification_rules SET
           name = COALESCE($3, name),
           entity_type = COALESCE($4, entity_type),
           event = COALESCE($5, event),
           conditions = COALESCE($6::jsonb, conditions),
           template_id = COALESCE($7, template_id),
           channels = COALESCE($8::jsonb, channels),
           recipient_query = COALESCE($9::jsonb, recipient_query),
           is_active = COALESCE($10, is_active),
           schedule = CASE WHEN $11::boolean THEN $12 ELSE schedule END,
           updated_at = now()
         WHERE id = $1 AND tenant_id = $2
         RETURNING *`,
        [
          id,
          tenantId,
          update.name ?? null,
          update.entityType ?? null,
          update.event ?? null,
          update.conditions ? JSON.stringify(update.conditions) : null,
          update.templateId ?? null,
          update.channels ? JSON.stringify(update.channels) : null,
          update.recipientQuery ? JSON.stringify(update.recipientQuery) : null,
          update.isActive ?? null,
          Object.prototype.hasOwnProperty.call(update, 'schedule'),
          update.schedule ?? null,
        ],
      );
      const row = result.rows[0] as Record<string, unknown> | undefined;
      return row ? mapRule(row) : null;
    });
  }

  async deleteRule(tenantId: string, id: string): Promise<boolean> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `DELETE FROM notification_rules WHERE id = $1 AND tenant_id = $2`,
        [id, tenantId],
      );
      const count = (result as { rowCount?: number }).rowCount ?? 0;
      return count > 0;
    });
  }

  async getActiveRulesForEvent(
    tenantId: string,
    entityType: string,
    event: NotificationRuleEvent,
  ): Promise<NotificationRuleEntity[]> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM notification_rules
          WHERE tenant_id = $1 AND entity_type = $2 AND event = $3 AND is_active = TRUE
          ORDER BY created_at ASC`,
        [tenantId, entityType, event],
      );
      return (result.rows as Record<string, unknown>[]).map(mapRule);
    });
  }

  async listRules(tenantId: string): Promise<NotificationRuleEntity[]> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM notification_rules WHERE tenant_id = $1 ORDER BY created_at DESC`,
        [tenantId],
      );
      return (result.rows as Record<string, unknown>[]).map(mapRule);
    });
  }

  async createTemplate(entity: NotificationTemplateEntity): Promise<NotificationTemplateEntity> {
    await this.ensureSchema();
    return this.withTenant(entity.tenantId, async (client) => {
      const result = await client.query(
        `INSERT INTO notification_templates (
           id, tenant_id, name, channel, subject, body, variables,
           sensitive_variables, public_variables, created_at, updated_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,now(),now())
         RETURNING *`,
        [
          entity.id,
          entity.tenantId,
          entity.name,
          entity.channel,
          entity.subject,
          entity.body,
          JSON.stringify(entity.variables ?? []),
          JSON.stringify(entity.sensitiveVariables ?? []),
          JSON.stringify(entity.publicVariables ?? []),
        ],
      );
      return mapTemplate(result.rows[0] as Record<string, unknown>);
    });
  }

  async getTemplateById(tenantId: string, id: string): Promise<NotificationTemplateEntity | null> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM notification_templates WHERE id = $1 AND tenant_id = $2`,
        [id, tenantId],
      );
      const row = result.rows[0] as Record<string, unknown> | undefined;
      return row ? mapTemplate(row) : null;
    });
  }

  async listTemplates(tenantId: string): Promise<NotificationTemplateEntity[]> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const result = await client.query(
        `SELECT * FROM notification_templates WHERE tenant_id = $1 ORDER BY created_at DESC`,
        [tenantId],
      );
      return (result.rows as Record<string, unknown>[]).map(mapTemplate);
    });
  }

  async resolveRecipients(tenantId: string, query: RecipientQuery): Promise<string[]> {
    await this.ensureSchema();
    return this.withTenant(tenantId, async (client) => {
      const ids = new Set<string>();
      // Explicit user ids are returned as-is (no directory lookup required).
      for (const userId of query.userIds ?? []) ids.add(userId);

      const roleIds = query.roleIds ?? [];
      const areaIds = query.areaIds ?? [];
      const institutionIds = query.institutionIds ?? [];
      if (roleIds.length || areaIds.length || institutionIds.length) {
        const result = await client.query(
          `SELECT user_id FROM notification_directory_users
            WHERE tenant_id = $1
              AND (
                ($2::text[] <> '{}' AND role_ids && $2::text[])
                OR ($3::text[] <> '{}' AND area_ids && $3::text[])
                OR ($4::text[] <> '{}' AND institution_ids && $4::text[])
              )`,
          [tenantId, roleIds, areaIds, institutionIds],
        );
        for (const row of result.rows as Record<string, unknown>[]) {
          ids.add(row['user_id'] as string);
        }
      }
      return Array.from(ids);
    });
  }
}

export function createPgNotificationRepository(): HybridNotificationRepository | null {
  const pool = getSharedNotificationPool();
  if (!pool) return null;
  return new HybridNotificationRepository(pool);
}
