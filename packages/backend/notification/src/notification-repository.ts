/**
 * Notification Repository Interface
 *
 * Defines the data access contract for the notification service.
 * Implementations can target PostgreSQL, in-memory (testing), etc.
 *
 * Requirements:
 * - 22.1: Multi-channel delivery (email, in-app, push, webhook)
 * - 22.2: Configurable notification rules
 * - 22.4: Template-based notifications
 * - 22.5: Track delivery status per notification instance
 */
import type {
  DeliveryChannel,
  DeliveryStatus,
  Priority,
  NotificationRuleEvent,
  RecipientQuery,
} from './schemas.js';

// ─── Entities ────────────────────────────────────────────────────────────────

/**
 * A notification record tracking delivery of a single notification to a single recipient.
 */
export interface NotificationEntity {
  id: string;
  tenantId: string;
  channel: DeliveryChannel;
  templateId: string;
  recipientUserId: string;
  variables: Record<string, string>;
  status: DeliveryStatus;
  priority: Priority;
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

/**
 * A notification rule that defines when and how notifications are triggered.
 */
export interface NotificationRuleEntity {
  id: string;
  tenantId: string;
  name: string;
  entityType: string;
  event: NotificationRuleEvent;
  conditions: Record<string, unknown>;
  templateId: string;
  channels: DeliveryChannel[];
  recipientQuery: RecipientQuery;
  isActive: boolean;
  schedule: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * A notification template with variable placeholders.
 */
export interface NotificationTemplateEntity {
  id: string;
  tenantId: string;
  name: string;
  channel: DeliveryChannel;
  subject: string | null;
  body: string;
  variables: string[];
  createdAt: Date;
  updatedAt: Date;
}

// ─── Query Types ─────────────────────────────────────────────────────────────

export interface NotificationQueryOptions {
  page: number;
  pageSize: number;
  status?: DeliveryStatus;
  channel?: DeliveryChannel;
}

export interface PaginatedNotifications {
  data: NotificationEntity[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// ─── Repository Interface ────────────────────────────────────────────────────

export interface NotificationRepository {
  // ─── Notifications ───────────────────────────────────────────────────────

  /** Create a new notification record */
  createNotification(entity: NotificationEntity): Promise<NotificationEntity>;

  /** Get a notification by ID */
  getNotificationById(tenantId: string, id: string): Promise<NotificationEntity | null>;

  /** Update notification status and related timestamps */
  updateNotificationStatus(
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
  ): Promise<NotificationEntity | null>;

  /** Get notifications for a user with pagination and filtering */
  getUserNotifications(
    tenantId: string,
    userId: string,
    options: NotificationQueryOptions,
  ): Promise<PaginatedNotifications>;

  /** Get notifications pending retry (failed with retryCount < maxRetries) */
  getRetryableNotifications(tenantId: string): Promise<NotificationEntity[]>;

  // ─── Rules ─────────────────────────────────────────────────────────────

  /** Create a notification rule */
  createRule(entity: NotificationRuleEntity): Promise<NotificationRuleEntity>;

  /** Get a rule by ID */
  getRuleById(tenantId: string, id: string): Promise<NotificationRuleEntity | null>;

  /** Update a notification rule */
  updateRule(
    id: string,
    tenantId: string,
    update: Partial<Omit<NotificationRuleEntity, 'id' | 'tenantId' | 'createdAt'>>,
  ): Promise<NotificationRuleEntity | null>;

  /** Delete a notification rule */
  deleteRule(tenantId: string, id: string): Promise<boolean>;

  /** Get all active rules for a given entity type and event */
  getActiveRulesForEvent(
    tenantId: string,
    entityType: string,
    event: NotificationRuleEvent,
  ): Promise<NotificationRuleEntity[]>;

  /** Get all rules for a tenant */
  listRules(tenantId: string): Promise<NotificationRuleEntity[]>;

  // ─── Templates ─────────────────────────────────────────────────────────

  /** Create a notification template */
  createTemplate(entity: NotificationTemplateEntity): Promise<NotificationTemplateEntity>;

  /** Get a template by ID */
  getTemplateById(tenantId: string, id: string): Promise<NotificationTemplateEntity | null>;

  /** List all templates for a tenant */
  listTemplates(tenantId: string): Promise<NotificationTemplateEntity[]>;

  // ─── Recipient Resolution ──────────────────────────────────────────────

  /** Resolve recipient user IDs from a recipient query */
  resolveRecipients(tenantId: string, query: RecipientQuery): Promise<string[]>;
}
