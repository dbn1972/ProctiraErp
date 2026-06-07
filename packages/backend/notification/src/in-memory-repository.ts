/**
 * In-Memory Notification Repository
 *
 * Used for unit testing and development without external dependencies.
 */
import type {
  NotificationRepository,
  NotificationEntity,
  NotificationRuleEntity,
  NotificationTemplateEntity,
  NotificationQueryOptions,
  PaginatedNotifications,
} from './notification-repository.js';
import type { DeliveryStatus, NotificationRuleEvent, RecipientQuery } from './schemas.js';

export class InMemoryNotificationRepository implements NotificationRepository {
  private notifications: NotificationEntity[] = [];
  private rules: NotificationRuleEntity[] = [];
  private templates: NotificationTemplateEntity[] = [];
  private users: Map<string, { id: string; roleIds: string[]; areaIds: string[]; institutionIds: string[] }> = new Map();

  /**
   * Seed users for recipient resolution in tests.
   */
  seedUsers(
    users: Array<{ id: string; roleIds: string[]; areaIds: string[]; institutionIds: string[] }>,
  ): void {
    for (const user of users) {
      this.users.set(user.id, user);
    }
  }

  // ─── Notifications ───────────────────────────────────────────────────────

  async createNotification(entity: NotificationEntity): Promise<NotificationEntity> {
    this.notifications.push({ ...entity });
    return { ...entity };
  }

  async getNotificationById(tenantId: string, id: string): Promise<NotificationEntity | null> {
    const found = this.notifications.find(n => n.id === id && n.tenantId === tenantId);
    return found ? { ...found } : null;
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
    const index = this.notifications.findIndex(n => n.id === id && n.tenantId === tenantId);
    if (index === -1) return null;

    const existing = this.notifications[index]!;
    const updated: NotificationEntity = {
      ...existing,
      status: update.status,
      sentAt: update.sentAt !== undefined ? update.sentAt : existing.sentAt,
      deliveredAt: update.deliveredAt !== undefined ? update.deliveredAt : existing.deliveredAt,
      readAt: update.readAt !== undefined ? update.readAt : existing.readAt,
      failedAt: update.failedAt !== undefined ? update.failedAt : existing.failedAt,
      failureReason: update.failureReason !== undefined ? update.failureReason : existing.failureReason,
      retryCount: update.retryCount !== undefined ? update.retryCount : existing.retryCount,
      updatedAt: new Date(),
    };

    this.notifications[index] = updated;
    return { ...updated };
  }

  async getUserNotifications(
    tenantId: string,
    userId: string,
    options: NotificationQueryOptions,
  ): Promise<PaginatedNotifications> {
    let filtered = this.notifications.filter(
      n => n.tenantId === tenantId && n.recipientUserId === userId,
    );

    if (options.status) {
      filtered = filtered.filter(n => n.status === options.status);
    }
    if (options.channel) {
      filtered = filtered.filter(n => n.channel === options.channel);
    }

    // Sort by createdAt descending
    filtered.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const total = filtered.length;
    const totalPages = Math.ceil(total / options.pageSize);
    const start = (options.page - 1) * options.pageSize;
    const data = filtered.slice(start, start + options.pageSize);

    return {
      data: data.map(n => ({ ...n })),
      total,
      page: options.page,
      pageSize: options.pageSize,
      totalPages,
    };
  }

  async getRetryableNotifications(tenantId: string): Promise<NotificationEntity[]> {
    return this.notifications
      .filter(n => n.tenantId === tenantId && n.status === 'failed' && n.retryCount < n.maxRetries)
      .map(n => ({ ...n }));
  }

  // ─── Rules ─────────────────────────────────────────────────────────────

  async createRule(entity: NotificationRuleEntity): Promise<NotificationRuleEntity> {
    this.rules.push({ ...entity });
    return { ...entity };
  }

  async getRuleById(tenantId: string, id: string): Promise<NotificationRuleEntity | null> {
    const found = this.rules.find(r => r.id === id && r.tenantId === tenantId);
    return found ? { ...found } : null;
  }

  async updateRule(
    id: string,
    tenantId: string,
    update: Partial<Omit<NotificationRuleEntity, 'id' | 'tenantId' | 'createdAt'>>,
  ): Promise<NotificationRuleEntity | null> {
    const index = this.rules.findIndex(r => r.id === id && r.tenantId === tenantId);
    if (index === -1) return null;

    const existing = this.rules[index]!;
    const updated: NotificationRuleEntity = {
      ...existing,
      ...update,
      updatedAt: new Date(),
    };

    this.rules[index] = updated;
    return { ...updated };
  }

  async deleteRule(tenantId: string, id: string): Promise<boolean> {
    const index = this.rules.findIndex(r => r.id === id && r.tenantId === tenantId);
    if (index === -1) return false;
    this.rules.splice(index, 1);
    return true;
  }

  async getActiveRulesForEvent(
    tenantId: string,
    entityType: string,
    event: NotificationRuleEvent,
  ): Promise<NotificationRuleEntity[]> {
    return this.rules
      .filter(
        r =>
          r.tenantId === tenantId &&
          r.entityType === entityType &&
          r.event === event &&
          r.isActive,
      )
      .map(r => ({ ...r }));
  }

  async listRules(tenantId: string): Promise<NotificationRuleEntity[]> {
    return this.rules.filter(r => r.tenantId === tenantId).map(r => ({ ...r }));
  }

  // ─── Templates ─────────────────────────────────────────────────────────

  async createTemplate(entity: NotificationTemplateEntity): Promise<NotificationTemplateEntity> {
    this.templates.push({ ...entity });
    return { ...entity };
  }

  async getTemplateById(tenantId: string, id: string): Promise<NotificationTemplateEntity | null> {
    const found = this.templates.find(t => t.id === id && t.tenantId === tenantId);
    return found ? { ...found } : null;
  }

  async listTemplates(tenantId: string): Promise<NotificationTemplateEntity[]> {
    return this.templates.filter(t => t.tenantId === tenantId).map(t => ({ ...t }));
  }

  // ─── Recipient Resolution ──────────────────────────────────────────────

  async resolveRecipients(tenantId: string, query: RecipientQuery): Promise<string[]> {
    const resolvedIds = new Set<string>();

    // Explicit user IDs
    if (query.userIds && query.userIds.length > 0) {
      for (const userId of query.userIds) {
        resolvedIds.add(userId);
      }
    }

    // Role-based resolution
    if (query.roleIds && query.roleIds.length > 0) {
      for (const [userId, user] of this.users) {
        if (user.roleIds.some(r => query.roleIds!.includes(r))) {
          resolvedIds.add(userId);
        }
      }
    }

    // Area-based resolution
    if (query.areaIds && query.areaIds.length > 0) {
      for (const [userId, user] of this.users) {
        if (user.areaIds.some(a => query.areaIds!.includes(a))) {
          resolvedIds.add(userId);
        }
      }
    }

    // Institution-based resolution
    if (query.institutionIds && query.institutionIds.length > 0) {
      for (const [userId, user] of this.users) {
        if (user.institutionIds.some(i => query.institutionIds!.includes(i))) {
          resolvedIds.add(userId);
        }
      }
    }

    return Array.from(resolvedIds);
  }

  // ─── Test Helpers ──────────────────────────────────────────────────────

  /** Clear all data (for test isolation) */
  clear(): void {
    this.notifications = [];
    this.rules = [];
    this.templates = [];
    this.users.clear();
  }
}
