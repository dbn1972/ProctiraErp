/**
 * Notification Service
 *
 * Business logic for multi-channel notification delivery with:
 * - Template-based notifications with variable substitution
 * - Rule-based triggering on Kafka events
 * - Delivery status tracking
 * - Retry with exponential backoff via RabbitMQ dead-letter exchanges
 *
 * Requirements:
 * - 22.1: Multi-channel delivery (email, in-app, push, webhook)
 * - 22.2: Configurable notification rules based on entity events, thresholds, schedules
 * - 22.3: Deliver to all recipients matching configured role and area criteria
 * - 22.4: Template-based notifications with variable substitution
 * - 22.5: Track delivery status (sent, delivered, read, failed)
 * - 22.6: Retry email delivery up to 3 times with exponential backoff
 */
import { NotFoundError, ValidationError, BusinessRuleError } from '@proctira/common';
import { v4 as uuidv4 } from 'uuid';

import type {
  NotificationRepository,
  NotificationEntity,
  NotificationRuleEntity,
  NotificationTemplateEntity,
  PaginatedNotifications,
} from './notification-repository.js';
import type {
  SendNotificationInput,
  CreateNotificationRuleInput,
  UpdateNotificationRuleInput,
  CreateNotificationTemplateInput,
  DeliveryChannel,
  DeliveryStatus,
} from './schemas.js';

// ─── Channel Delivery Interfaces ─────────────────────────────────────────────

/**
 * Interface for sending email notifications.
 */
export interface EmailSender {
  send(params: { to: string; subject: string; body: string; tenantId: string }): Promise<{
    success: boolean;
    messageId?: string;
    error?: string;
    mode?: 'sandbox' | 'live';
    honestyNote?: string;
  }>;
}

/**
 * Interface for sending push notifications (FCM).
 */
export interface PushSender {
  send(params: {
    userId: string;
    title: string;
    body: string;
    data?: Record<string, string>;
    tenantId: string;
  }): Promise<{
    success: boolean;
    messageId?: string;
    error?: string;
    mode?: 'sandbox' | 'live';
    honestyNote?: string;
  }>;
}

/**
 * Interface for sending webhook notifications.
 */
export interface WebhookSender {
  send(params: {
    url: string;
    payload: Record<string, unknown>;
    tenantId: string;
  }): Promise<{ success: boolean; statusCode?: number; error?: string }>;
}

/**
 * Interface for sending SMS notifications.
 */
export interface SmsSender {
  send(params: { to: string; body: string; tenantId: string }): Promise<{
    success: boolean;
    messageId?: string;
    error?: string;
    mode?: 'sandbox' | 'live';
    honestyNote?: string;
  }>;
}

/**
 * Interface for queuing notifications for retry via RabbitMQ.
 */
export interface NotificationQueuePublisher {
  /**
   * Queue a notification for delivery with optional delay (exponential backoff).
   */
  queueForDelivery(notification: NotificationEntity, delayMs: number): Promise<void>;
}

// ─── Service Configuration ───────────────────────────────────────────────────

export interface NotificationServiceConfig {
  /** Base delay for exponential backoff in milliseconds (default: 1000) */
  retryBaseDelayMs: number;
  /** Maximum retries for email delivery (default: 3) */
  emailMaxRetries: number;
  /** Maximum retries for push delivery (default: 2) */
  pushMaxRetries: number;
  /** Maximum retries for webhook delivery (default: 2) */
  webhookMaxRetries: number;
  /** Maximum retries for SMS delivery (default: 3) */
  smsMaxRetries: number;
}

const DEFAULT_CONFIG: NotificationServiceConfig = {
  retryBaseDelayMs: 1000,
  emailMaxRetries: 3,
  pushMaxRetries: 2,
  webhookMaxRetries: 2,
  smsMaxRetries: 3,
};

// ─── Service ─────────────────────────────────────────────────────────────────

export class NotificationService {
  private readonly config: NotificationServiceConfig;

  constructor(
    private readonly repository: NotificationRepository,
    private readonly emailSender?: EmailSender,
    private readonly pushSender?: PushSender,
    private readonly webhookSender?: WebhookSender,
    private readonly smsSender?: SmsSender,
    private readonly queuePublisher?: NotificationQueuePublisher,
    config?: Partial<NotificationServiceConfig>,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ─── Send Notification ─────────────────────────────────────────────────

  /**
   * Send a notification to all resolved recipients.
   *
   * Requirement 22.3: Deliver to all recipients matching configured role and area criteria.
   * Requirement 22.4: Template-based notifications with variable substitution.
   *
   * @returns Array of created notification records (one per recipient)
   */
  async send(tenantId: string, input: SendNotificationInput): Promise<NotificationEntity[]> {
    // Resolve template
    const template = await this.repository.getTemplateById(tenantId, input.templateId);
    if (!template) {
      throw new NotFoundError(`Notification template '${input.templateId}' not found`);
    }

    // Validate channel matches template channel
    if (template.channel !== input.channel) {
      throw new ValidationError(
        `Template channel '${template.channel}' does not match requested channel '${input.channel}'`,
        [
          {
            field: 'channel',
            rule: 'mismatch',
            message: `Template is for '${template.channel}' but '${input.channel}' was requested`,
          },
        ],
      );
    }

    // Resolve recipients
    const recipientIds = await this.repository.resolveRecipients(tenantId, input.recipients);
    if (recipientIds.length === 0) {
      throw new BusinessRuleError('No recipients found matching the specified criteria');
    }

    // Determine max retries based on channel
    const maxRetries = this.getMaxRetriesForChannel(input.channel);
    const priority = input.priority ?? 'normal';

    // Create notification records for each recipient
    const notifications: NotificationEntity[] = [];

    for (const recipientUserId of recipientIds) {
      const notification: NotificationEntity = {
        id: uuidv4(),
        tenantId,
        channel: input.channel,
        templateId: input.templateId,
        recipientUserId,
        variables: input.variables,
        status: 'sent',
        priority,
        retryCount: 0,
        maxRetries,
        sentAt: new Date(),
        deliveredAt: null,
        readAt: null,
        failedAt: null,
        failureReason: null,
        webhookUrl: input.webhookUrl ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const created = await this.repository.createNotification(notification);

      // Attempt delivery
      await this.attemptDelivery(created, template);

      // Fetch the updated notification (status may have changed after delivery)
      const updated = await this.repository.getNotificationById(tenantId, created.id);
      notifications.push(updated ?? created);
    }

    return notifications;
  }

  // ─── Delivery Attempt ──────────────────────────────────────────────────

  /**
   * Attempt to deliver a notification through its channel.
   * On failure, queues for retry with exponential backoff if retries remain.
   *
   * Requirement 22.5: Track delivery status (sent, delivered, read, failed).
   * Requirement 22.6: Retry email delivery up to 3 times with exponential backoff.
   */
  async attemptDelivery(
    notification: NotificationEntity,
    template: NotificationTemplateEntity,
  ): Promise<void> {
    const renderedBody = this.renderTemplate(template.body, notification.variables);
    const renderedSubject = template.subject
      ? this.renderTemplate(template.subject, notification.variables)
      : undefined;

    let success = false;
    let errorMessage: string | undefined;

    try {
      switch (notification.channel) {
        case 'email':
          if (this.emailSender) {
            const result = await this.emailSender.send({
              to: notification.recipientUserId,
              subject: renderedSubject ?? 'Notification',
              body: renderedBody,
              tenantId: notification.tenantId,
            });
            success = result.success;
            errorMessage = result.error;
          } else {
            // No email sender configured — mark as delivered (in-process)
            success = true;
          }
          break;

        case 'in_app':
          // In-app notifications are delivered by creating the record (already done)
          success = true;
          break;

        case 'push':
          if (this.pushSender) {
            const result = await this.pushSender.send({
              userId: notification.recipientUserId,
              title: renderedSubject ?? 'Notification',
              body: renderedBody,
              tenantId: notification.tenantId,
            });
            success = result.success;
            errorMessage = result.error;
          } else {
            success = true;
          }
          break;

        case 'webhook':
          if (this.webhookSender && notification.webhookUrl) {
            const result = await this.webhookSender.send({
              url: notification.webhookUrl,
              payload: {
                notificationId: notification.id,
                templateId: notification.templateId,
                variables: notification.variables,
                renderedBody,
              },
              tenantId: notification.tenantId,
            });
            success = result.success;
            errorMessage = result.error;
          } else {
            success = true;
          }
          break;

        case 'sms':
          if (this.smsSender) {
            const result = await this.smsSender.send({
              to: notification.recipientUserId,
              body: renderedBody,
              tenantId: notification.tenantId,
            });
            success = result.success;
            errorMessage = result.error;
          } else {
            // No SMS sender configured — sandbox accept (honesty via delivery-capabilities).
            success = true;
          }
          break;
      }
    } catch (error: unknown) {
      success = false;
      errorMessage = error instanceof Error ? error.message : 'Unknown delivery error';
    }

    if (success) {
      await this.repository.updateNotificationStatus(notification.id, notification.tenantId, {
        status: 'delivered',
        deliveredAt: new Date(),
      });
    } else {
      await this.handleDeliveryFailure(notification, errorMessage ?? 'Delivery failed');
    }
  }

  /**
   * Idempotent handler for durable queue consumers (W2-JOB-01).
   *
   * Re-loads the notification + template and re-attempts delivery. Already
   * delivered/read notifications are no-ops so redelivery after crash is safe.
   *
   * @returns true when delivery was attempted or already complete; false if missing
   */
  async processQueuedDelivery(tenantId: string, notificationId: string): Promise<boolean> {
    const notification = await this.repository.getNotificationById(tenantId, notificationId);
    if (!notification) {
      return false;
    }

    if (notification.status === 'delivered' || notification.status === 'read') {
      return true;
    }

    const template = await this.repository.getTemplateById(tenantId, notification.templateId);
    if (!template) {
      await this.handleDeliveryFailure(notification, `Template '${notification.templateId}' not found`);
      return true;
    }

    await this.attemptDelivery(notification, template);
    return true;
  }

  /**
   * Handle a delivery failure — either queue for retry or mark as permanently failed.
   *
   * Requirement 22.6: Retry email delivery up to 3 times with exponential backoff.
   */
  private async handleDeliveryFailure(
    notification: NotificationEntity,
    errorMessage: string,
  ): Promise<void> {
    const newRetryCount = notification.retryCount + 1;

    if (newRetryCount < notification.maxRetries) {
      // Queue for retry with exponential backoff
      const delayMs = this.calculateBackoffDelay(newRetryCount);

      await this.repository.updateNotificationStatus(notification.id, notification.tenantId, {
        status: 'failed',
        failedAt: new Date(),
        failureReason: errorMessage,
        retryCount: newRetryCount,
      });

      // Queue for retry via RabbitMQ dead-letter exchange
      if (this.queuePublisher) {
        const updatedNotification = await this.repository.getNotificationById(
          notification.tenantId,
          notification.id,
        );
        if (updatedNotification) {
          await this.queuePublisher.queueForDelivery(updatedNotification, delayMs);
        }
      }
    } else {
      // Max retries exhausted — mark as permanently failed
      await this.repository.updateNotificationStatus(notification.id, notification.tenantId, {
        status: 'failed',
        failedAt: new Date(),
        failureReason: `${errorMessage} (max retries exhausted)`,
        retryCount: newRetryCount,
      });
    }
  }

  /**
   * Calculate exponential backoff delay.
   * Formula: baseDelay * 2^(retryCount - 1)
   *
   * For baseDelay=1000ms:
   * - Retry 1: 1000ms (1s)
   * - Retry 2: 2000ms (2s)
   * - Retry 3: 4000ms (4s)
   */
  calculateBackoffDelay(retryCount: number): number {
    return this.config.retryBaseDelayMs * Math.pow(2, retryCount - 1);
  }

  // ─── Template Rendering ────────────────────────────────────────────────

  /**
   * Render a template by substituting {{variable}} placeholders with values.
   *
   * Requirement 22.4: Template-based notifications with variable substitution.
   */
  renderTemplate(template: string, variables: Record<string, string>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
      return variables[key] ?? match;
    });
  }

  // ─── Delivery Status ───────────────────────────────────────────────────

  /**
   * Get delivery status for a notification.
   *
   * Requirement 22.5: Track delivery status per notification instance.
   */
  async getDeliveryStatus(tenantId: string, notificationId: string): Promise<NotificationEntity> {
    const notification = await this.repository.getNotificationById(tenantId, notificationId);
    if (!notification) {
      throw new NotFoundError(`Notification '${notificationId}' not found`);
    }
    return notification;
  }

  /**
   * Mark a notification as read (for in-app notifications).
   */
  async markAsRead(tenantId: string, notificationId: string): Promise<NotificationEntity> {
    const notification = await this.repository.getNotificationById(tenantId, notificationId);
    if (!notification) {
      throw new NotFoundError(`Notification '${notificationId}' not found`);
    }

    const updated = await this.repository.updateNotificationStatus(notificationId, tenantId, {
      status: 'read',
      readAt: new Date(),
    });

    return updated!;
  }

  /**
   * Get notifications for a user with pagination.
   */
  async getUserNotifications(
    tenantId: string,
    userId: string,
    options: {
      page?: number;
      pageSize?: number;
      status?: DeliveryStatus;
      channel?: DeliveryChannel;
    },
  ): Promise<PaginatedNotifications> {
    return this.repository.getUserNotifications(tenantId, userId, {
      page: options.page ?? 1,
      pageSize: options.pageSize ?? 20,
      status: options.status,
      channel: options.channel,
    });
  }

  // ─── Rule Management ───────────────────────────────────────────────────

  /**
   * Create a notification rule.
   *
   * Requirement 22.2: Configurable notification rules based on entity events,
   * thresholds, and schedules.
   */
  async createRule(
    tenantId: string,
    input: CreateNotificationRuleInput,
  ): Promise<NotificationRuleEntity> {
    // Validate template exists
    const template = await this.repository.getTemplateById(tenantId, input.templateId);
    if (!template) {
      throw new NotFoundError(`Notification template '${input.templateId}' not found`);
    }

    const rule: NotificationRuleEntity = {
      id: uuidv4(),
      tenantId,
      name: input.name,
      entityType: input.entityType,
      event: input.event,
      conditions: input.conditions,
      templateId: input.templateId,
      channels: input.channels,
      recipientQuery: input.recipientQuery,
      isActive: input.isActive ?? true,
      schedule: input.schedule ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    return this.repository.createRule(rule);
  }

  /**
   * Update a notification rule.
   */
  async updateRule(
    tenantId: string,
    ruleId: string,
    input: UpdateNotificationRuleInput,
  ): Promise<NotificationRuleEntity> {
    const existing = await this.repository.getRuleById(tenantId, ruleId);
    if (!existing) {
      throw new NotFoundError(`Notification rule '${ruleId}' not found`);
    }

    // If templateId is being updated, validate it exists
    if (input.templateId) {
      const template = await this.repository.getTemplateById(tenantId, input.templateId);
      if (!template) {
        throw new NotFoundError(`Notification template '${input.templateId}' not found`);
      }
    }

    const updated = await this.repository.updateRule(ruleId, tenantId, {
      ...input,
      updatedAt: new Date(),
    });

    return updated!;
  }

  /**
   * Delete a notification rule.
   */
  async deleteRule(tenantId: string, ruleId: string): Promise<void> {
    const deleted = await this.repository.deleteRule(tenantId, ruleId);
    if (!deleted) {
      throw new NotFoundError(`Notification rule '${ruleId}' not found`);
    }
  }

  /**
   * Get a notification rule by ID.
   */
  async getRule(tenantId: string, ruleId: string): Promise<NotificationRuleEntity> {
    const rule = await this.repository.getRuleById(tenantId, ruleId);
    if (!rule) {
      throw new NotFoundError(`Notification rule '${ruleId}' not found`);
    }
    return rule;
  }

  /**
   * List all notification rules for a tenant.
   */
  async listRules(tenantId: string): Promise<NotificationRuleEntity[]> {
    return this.repository.listRules(tenantId);
  }

  // ─── Rule-Based Triggering ─────────────────────────────────────────────

  /**
   * Process a domain event and trigger matching notification rules.
   *
   * Requirement 22.2: Rule-based triggering on entity events, thresholds, schedules.
   * Requirement 22.3: Deliver to all recipients matching configured role and area criteria.
   *
   * This method is called by the Kafka event consumer when domain events arrive.
   */
  async processEvent(
    tenantId: string,
    entityType: string,
    event: 'create' | 'update' | 'delete' | 'threshold',
    payload: Record<string, unknown>,
  ): Promise<NotificationEntity[]> {
    // Find matching active rules
    const rules = await this.repository.getActiveRulesForEvent(tenantId, entityType, event);

    const allNotifications: NotificationEntity[] = [];

    for (const rule of rules) {
      // Check if conditions match
      if (!this.evaluateConditions(rule.conditions, payload)) {
        continue;
      }

      // Build variables from payload
      const variables: Record<string, string> = {};
      for (const [key, value] of Object.entries(payload)) {
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
          variables[key] = String(value);
        }
      }

      // Send notification on each configured channel
      for (const channel of rule.channels) {
        try {
          const notifications = await this.send(tenantId, {
            channel,
            templateId: rule.templateId,
            recipients: rule.recipientQuery,
            variables,
          });
          allNotifications.push(...notifications);
        } catch {
          // Log error but continue processing other channels/rules
        }
      }
    }

    return allNotifications;
  }

  /**
   * Evaluate rule conditions against event payload.
   * Simple key-value matching: all conditions must match.
   */
  evaluateConditions(
    conditions: Record<string, unknown>,
    payload: Record<string, unknown>,
  ): boolean {
    for (const [key, expectedValue] of Object.entries(conditions)) {
      const actualValue = payload[key];

      if (typeof expectedValue === 'object' && expectedValue !== null) {
        // Support comparison operators
        const ops = expectedValue as Record<string, unknown>;
        if ('$gt' in ops && typeof actualValue === 'number' && typeof ops['$gt'] === 'number') {
          if (actualValue <= ops['$gt']) return false;
        }
        if ('$gte' in ops && typeof actualValue === 'number' && typeof ops['$gte'] === 'number') {
          if (actualValue < ops['$gte']) return false;
        }
        if ('$lt' in ops && typeof actualValue === 'number' && typeof ops['$lt'] === 'number') {
          if (actualValue >= ops['$lt']) return false;
        }
        if ('$lte' in ops && typeof actualValue === 'number' && typeof ops['$lte'] === 'number') {
          if (actualValue > ops['$lte']) return false;
        }
        if ('$eq' in ops) {
          if (actualValue !== ops['$eq']) return false;
        }
        if ('$ne' in ops) {
          if (actualValue === ops['$ne']) return false;
        }
        if ('$in' in ops && Array.isArray(ops['$in'])) {
          if (!ops['$in'].includes(actualValue)) return false;
        }
      } else {
        // Direct equality check
        if (actualValue !== expectedValue) return false;
      }
    }

    return true;
  }

  // ─── Template Management ───────────────────────────────────────────────

  /**
   * Create a notification template.
   */
  async createTemplate(
    tenantId: string,
    input: CreateNotificationTemplateInput,
  ): Promise<NotificationTemplateEntity> {
    const template: NotificationTemplateEntity = {
      id: uuidv4(),
      tenantId,
      name: input.name,
      channel: input.channel,
      subject: input.subject ?? null,
      body: input.body,
      variables: input.variables,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    return this.repository.createTemplate(template);
  }

  /**
   * Get a template by ID.
   */
  async getTemplate(tenantId: string, templateId: string): Promise<NotificationTemplateEntity> {
    const template = await this.repository.getTemplateById(tenantId, templateId);
    if (!template) {
      throw new NotFoundError(`Notification template '${templateId}' not found`);
    }
    return template;
  }

  /**
   * List all templates for a tenant.
   */
  async listTemplates(tenantId: string): Promise<NotificationTemplateEntity[]> {
    return this.repository.listTemplates(tenantId);
  }

  // ─── Helpers ───────────────────────────────────────────────────────────

  private getMaxRetriesForChannel(channel: DeliveryChannel): number {
    switch (channel) {
      case 'email':
        return this.config.emailMaxRetries;
      case 'push':
        return this.config.pushMaxRetries;
      case 'webhook':
        return this.config.webhookMaxRetries;
      case 'sms':
        return this.config.smsMaxRetries;
      case 'in_app':
        return 0; // In-app notifications don't need retries
    }
  }

  /**
   * Honesty metadata for channel delivery modes (prefs UI / ops banners).
   * Defaults report sandbox until live SMTP/FCM/Twilio adapters replace the stubs.
   */
  getDeliveryCapabilities() {
    return {
      email: {
        mode: 'sandbox' as const,
        honestyNote:
          'Sandbox email — preference toggles and sends are accepted without calling SMTP. Wire SMTP/SendGrid (or equivalent) credentials for production delivery.',
      },
      push: {
        mode: 'sandbox' as const,
        honestyNote:
          'Sandbox push — device registration and sends are accepted without calling FCM/APNs. Wire FCM credentials for production delivery.',
      },
      sms: {
        mode: 'sandbox' as const,
        honestyNote:
          'Sandbox SMS — preference toggles and sends are accepted without calling a carrier. Wire Twilio (or equivalent) credentials for production delivery.',
      },
    };
  }
}
