/**
 * Prisma Notification Repository
 *
 * Production implementation of {@link NotificationRepository} backed by
 * PostgreSQL via Prisma. Tenant-scoped reads/writes run inside
 * {@link withTenantTransaction} so the `app.current_tenant_id` RLS variable is
 * bound on the same connection that executes the query; `tenantId` is also kept
 * in every `where` clause as defense-in-depth.
 *
 * `resolveRecipients` merges explicit `userIds` with role / area / institution
 * expansion via an injected {@link NotificationRecipientLookup} (sequential
 * per-schema queries + in-memory UUID merge — no cross-schema SQL JOINs).
 */
import { withTenantTransaction } from '@proctira/database';
import type { Prisma, PrismaClient } from '@proctira/database';

import type { NotificationRecipientLookup } from './cross-module-recipient-lookup.js';
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

export interface PrismaNotificationRepositoryOptions {
  /** Cross-module role/area/institution expander (ReportDataSource pattern). */
  recipientLookup?: NotificationRecipientLookup;
}

interface NotificationRow {
  id: string;
  tenantId: string;
  channel: string;
  templateId: string;
  recipientUserId: string;
  variables: unknown;
  status: string;
  priority: string;
  retryCount: number;
  maxRetries: number;
  sentAt: Date | null;
  deliveredAt: Date | null;
  readAt: Date | null;
  failedAt: Date | null;
  failureReason: string | null;
  webhookUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface NotificationRuleRow {
  id: string;
  tenantId: string;
  name: string;
  entityType: string;
  event: string;
  conditions: unknown;
  templateId: string;
  channels: unknown;
  recipientQuery: unknown;
  isActive: boolean;
  schedule: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface NotificationTemplateRow {
  id: string;
  tenantId: string;
  name: string;
  channel: string;
  subject: string | null;
  body: string;
  variables: unknown;
  createdAt: Date;
  updatedAt: Date;
}

function asRecord(value: unknown): Record<string, string> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = v == null ? '' : String(v);
    }
    return out;
  }
  return {};
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((v) => String(v)) : [];
}

function asChannelArray(value: unknown): DeliveryChannel[] {
  return asStringArray(value) as DeliveryChannel[];
}

function asRecipientQuery(value: unknown): RecipientQuery {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as RecipientQuery;
  }
  return {};
}

function asConditions(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function toNotification(row: NotificationRow): NotificationEntity {
  return {
    id: row.id,
    tenantId: row.tenantId,
    channel: row.channel as DeliveryChannel,
    templateId: row.templateId,
    recipientUserId: row.recipientUserId,
    variables: asRecord(row.variables),
    status: row.status as DeliveryStatus,
    priority: row.priority as Priority,
    retryCount: row.retryCount,
    maxRetries: row.maxRetries,
    sentAt: row.sentAt,
    deliveredAt: row.deliveredAt,
    readAt: row.readAt,
    failedAt: row.failedAt,
    failureReason: row.failureReason,
    webhookUrl: row.webhookUrl,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toRule(row: NotificationRuleRow): NotificationRuleEntity {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    entityType: row.entityType,
    event: row.event as NotificationRuleEvent,
    conditions: asConditions(row.conditions),
    templateId: row.templateId,
    channels: asChannelArray(row.channels),
    recipientQuery: asRecipientQuery(row.recipientQuery),
    isActive: row.isActive,
    schedule: row.schedule,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toTemplate(row: NotificationTemplateRow): NotificationTemplateEntity {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    channel: row.channel as DeliveryChannel,
    subject: row.subject,
    body: row.body,
    variables: asStringArray(row.variables),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class PrismaNotificationRepository implements NotificationRepository {
  private readonly recipientLookup: NotificationRecipientLookup | undefined;

  constructor(
    private readonly prisma: PrismaClient,
    options: PrismaNotificationRepositoryOptions = {},
  ) {
    this.recipientLookup = options.recipientLookup;
  }

  // ─── Notifications ───────────────────────────────────────────────────────

  async createNotification(entity: NotificationEntity): Promise<NotificationEntity> {
    return withTenantTransaction(this.prisma, entity.tenantId, async (tx) => {
      const row = (await tx.notification.create({
        data: {
          id: entity.id,
          tenantId: entity.tenantId,
          channel: entity.channel,
          templateId: entity.templateId,
          recipientUserId: entity.recipientUserId,
          variables: entity.variables as Prisma.InputJsonValue,
          status: entity.status,
          priority: entity.priority,
          retryCount: entity.retryCount,
          maxRetries: entity.maxRetries,
          sentAt: entity.sentAt,
          deliveredAt: entity.deliveredAt,
          readAt: entity.readAt,
          failedAt: entity.failedAt,
          failureReason: entity.failureReason,
          webhookUrl: entity.webhookUrl,
        },
      })) as NotificationRow;
      return toNotification(row);
    });
  }

  async getNotificationById(
    tenantId: string,
    id: string,
  ): Promise<NotificationEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const row = (await tx.notification.findFirst({
        where: { id, tenantId },
      })) as NotificationRow | null;
      return row ? toNotification(row) : null;
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
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const existing = (await tx.notification.findFirst({
        where: { id, tenantId },
      })) as NotificationRow | null;
      if (!existing) return null;

      const data: Prisma.NotificationUpdateInput = {
        status: update.status,
      };
      if (update.sentAt !== undefined) data.sentAt = update.sentAt;
      if (update.deliveredAt !== undefined) data.deliveredAt = update.deliveredAt;
      if (update.readAt !== undefined) data.readAt = update.readAt;
      if (update.failedAt !== undefined) data.failedAt = update.failedAt;
      if (update.failureReason !== undefined) data.failureReason = update.failureReason;
      if (update.retryCount !== undefined) data.retryCount = update.retryCount;

      const row = (await tx.notification.update({
        where: { id },
        data,
      })) as NotificationRow;
      return toNotification(row);
    });
  }

  async getUserNotifications(
    tenantId: string,
    userId: string,
    options: NotificationQueryOptions,
  ): Promise<PaginatedNotifications> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const where: Prisma.NotificationWhereInput = {
        tenantId,
        recipientUserId: userId,
      };
      if (options.status) where.status = options.status;
      if (options.channel) where.channel = options.channel;

      const total = await tx.notification.count({ where });
      const totalPages = Math.ceil(total / options.pageSize) || 0;
      const rows = (await tx.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (options.page - 1) * options.pageSize,
        take: options.pageSize,
      })) as NotificationRow[];

      return {
        data: rows.map(toNotification),
        total,
        page: options.page,
        pageSize: options.pageSize,
        totalPages,
      };
    });
  }

  async getRetryableNotifications(tenantId: string): Promise<NotificationEntity[]> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      // retryCount < maxRetries cannot be expressed as a single Prisma
      // column-to-column comparison; fetch failed rows and filter in-process.
      const rows = (await tx.notification.findMany({
        where: { tenantId, status: 'failed' },
      })) as NotificationRow[];
      return rows
        .filter((r) => r.retryCount < r.maxRetries)
        .map(toNotification);
    });
  }

  // ─── Rules ─────────────────────────────────────────────────────────────

  async createRule(entity: NotificationRuleEntity): Promise<NotificationRuleEntity> {
    return withTenantTransaction(this.prisma, entity.tenantId, async (tx) => {
      const row = (await tx.notificationRule.create({
        data: {
          id: entity.id,
          tenantId: entity.tenantId,
          name: entity.name,
          entityType: entity.entityType,
          event: entity.event,
          conditions: entity.conditions as Prisma.InputJsonValue,
          templateId: entity.templateId,
          channels: entity.channels as Prisma.InputJsonValue,
          recipientQuery: entity.recipientQuery as Prisma.InputJsonValue,
          isActive: entity.isActive,
          schedule: entity.schedule,
        },
      })) as NotificationRuleRow;
      return toRule(row);
    });
  }

  async getRuleById(
    tenantId: string,
    id: string,
  ): Promise<NotificationRuleEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const row = (await tx.notificationRule.findFirst({
        where: { id, tenantId },
      })) as NotificationRuleRow | null;
      return row ? toRule(row) : null;
    });
  }

  async updateRule(
    id: string,
    tenantId: string,
    update: Partial<Omit<NotificationRuleEntity, 'id' | 'tenantId' | 'createdAt'>>,
  ): Promise<NotificationRuleEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const existing = (await tx.notificationRule.findFirst({
        where: { id, tenantId },
      })) as NotificationRuleRow | null;
      if (!existing) return null;

      const data: Prisma.NotificationRuleUpdateInput = {};
      if (update.name !== undefined) data.name = update.name;
      if (update.entityType !== undefined) data.entityType = update.entityType;
      if (update.event !== undefined) data.event = update.event;
      if (update.conditions !== undefined) {
        data.conditions = update.conditions as Prisma.InputJsonValue;
      }
      if (update.templateId !== undefined) data.templateId = update.templateId;
      if (update.channels !== undefined) {
        data.channels = update.channels as Prisma.InputJsonValue;
      }
      if (update.recipientQuery !== undefined) {
        data.recipientQuery = update.recipientQuery as Prisma.InputJsonValue;
      }
      if (update.isActive !== undefined) data.isActive = update.isActive;
      if (update.schedule !== undefined) data.schedule = update.schedule;

      const row = (await tx.notificationRule.update({
        where: { id },
        data,
      })) as NotificationRuleRow;
      return toRule(row);
    });
  }

  async deleteRule(tenantId: string, id: string): Promise<boolean> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const existing = await tx.notificationRule.findFirst({
        where: { id, tenantId },
        select: { id: true },
      });
      if (!existing) return false;
      await tx.notificationRule.delete({ where: { id } });
      return true;
    });
  }

  async getActiveRulesForEvent(
    tenantId: string,
    entityType: string,
    event: NotificationRuleEvent,
  ): Promise<NotificationRuleEntity[]> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const rows = (await tx.notificationRule.findMany({
        where: { tenantId, entityType, event, isActive: true },
      })) as NotificationRuleRow[];
      return rows.map(toRule);
    });
  }

  async listRules(tenantId: string): Promise<NotificationRuleEntity[]> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const rows = (await tx.notificationRule.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
      })) as NotificationRuleRow[];
      return rows.map(toRule);
    });
  }

  // ─── Templates ─────────────────────────────────────────────────────────

  async createTemplate(
    entity: NotificationTemplateEntity,
  ): Promise<NotificationTemplateEntity> {
    return withTenantTransaction(this.prisma, entity.tenantId, async (tx) => {
      const row = (await tx.notificationTemplate.create({
        data: {
          id: entity.id,
          tenantId: entity.tenantId,
          name: entity.name,
          channel: entity.channel,
          subject: entity.subject,
          body: entity.body,
          variables: entity.variables as Prisma.InputJsonValue,
        },
      })) as NotificationTemplateRow;
      return toTemplate(row);
    });
  }

  async getTemplateById(
    tenantId: string,
    id: string,
  ): Promise<NotificationTemplateEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const row = (await tx.notificationTemplate.findFirst({
        where: { id, tenantId },
      })) as NotificationTemplateRow | null;
      return row ? toTemplate(row) : null;
    });
  }

  async listTemplates(tenantId: string): Promise<NotificationTemplateEntity[]> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const rows = (await tx.notificationTemplate.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
      })) as NotificationTemplateRow[];
      return rows.map(toTemplate);
    });
  }

  // ─── Recipient Resolution ──────────────────────────────────────────────

  async resolveRecipients(
    tenantId: string,
    query: RecipientQuery,
  ): Promise<string[]> {
    const resolved = new Set<string>(query.userIds ?? []);

    const needsExpansion =
      (query.roleIds && query.roleIds.length > 0) ||
      (query.areaIds && query.areaIds.length > 0) ||
      (query.institutionIds && query.institutionIds.length > 0);

    if (needsExpansion && this.recipientLookup) {
      const expanded = await this.recipientLookup.expandRoleAreaInstitution(
        tenantId,
        {
          roleIds: query.roleIds,
          areaIds: query.areaIds,
          institutionIds: query.institutionIds,
        },
      );
      for (const id of expanded) resolved.add(id);
    }

    return Array.from(resolved);
  }
}
