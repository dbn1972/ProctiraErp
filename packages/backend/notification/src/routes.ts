/**
 * Notification Routes
 *
 * POST   /notifications/send              - Send a notification
 * GET    /notifications/:notificationId   - Get delivery status
 * POST   /notifications/:notificationId/read - Mark as read
 * GET    /notifications/user/:userId      - Get user notifications
 * POST   /notifications/rules             - Create a notification rule
 * GET    /notifications/rules             - List notification rules
 * GET    /notifications/rules/:ruleId     - Get a notification rule
 * PUT    /notifications/rules/:ruleId     - Update a notification rule
 * DELETE /notifications/rules/:ruleId     - Delete a notification rule
 * POST   /notifications/templates         - Create a notification template
 * GET    /notifications/templates         - List notification templates
 *
 * Requirements:
 * - 22.1: Multi-channel delivery (email, in-app, push, webhook)
 * - 22.2: Configurable notification rules
 * - 22.3: Deliver to recipients matching role and area criteria
 * - 22.4: Template-based notifications with variable substitution
 * - 22.5: Track delivery status per notification instance
 * - 22.6: Retry email delivery up to 3 times with exponential backoff
 */
import { AppError } from '@proctira/common';
import { validate } from '@proctira/validation';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

import type { NotificationService } from './notification-service.js';
import {
  SendNotificationSchema,
  CreateNotificationRuleSchema,
  UpdateNotificationRuleSchema,
  CreateNotificationTemplateSchema,
  GetUserNotificationsQuerySchema,
  NotificationIdParamsSchema,
  RuleIdParamsSchema,
  type SendNotificationInput,
  type CreateNotificationRuleInput,
  type UpdateNotificationRuleInput,
  type CreateNotificationTemplateInput,
  type GetUserNotificationsQuery,
  type NotificationIdParams,
  type RuleIdParams,
} from './schemas.js';

/**
 * Options for registering notification routes.
 */
export interface NotificationRoutesOptions {
  notificationService: NotificationService;
  /** Route prefix (default: '/notifications') */
  prefix?: string;
}

/**
 * Formats a notification entity to the API response shape.
 */
function formatNotificationResponse(entity: {
  id: string;
  tenantId: string;
  channel: string;
  templateId: string;
  recipientUserId: string;
  variables: Record<string, string>;
  status: string;
  priority: string;
  retryCount: number;
  maxRetries: number;
  sentAt: Date | null;
  deliveredAt: Date | null;
  readAt: Date | null;
  failedAt: Date | null;
  failureReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: entity.id,
    tenantId: entity.tenantId,
    channel: entity.channel,
    templateId: entity.templateId,
    recipientUserId: entity.recipientUserId,
    variables: entity.variables,
    status: entity.status,
    priority: entity.priority,
    retryCount: entity.retryCount,
    maxRetries: entity.maxRetries,
    sentAt: entity.sentAt?.toISOString() ?? null,
    deliveredAt: entity.deliveredAt?.toISOString() ?? null,
    readAt: entity.readAt?.toISOString() ?? null,
    failedAt: entity.failedAt?.toISOString() ?? null,
    failureReason: entity.failureReason,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}

/**
 * Formats a notification rule entity to the API response shape.
 */
function formatRuleResponse(entity: {
  id: string;
  tenantId: string;
  name: string;
  entityType: string;
  event: string;
  conditions: Record<string, unknown>;
  templateId: string;
  channels: string[];
  recipientQuery: Record<string, unknown>;
  isActive: boolean;
  schedule: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: entity.id,
    tenantId: entity.tenantId,
    name: entity.name,
    entityType: entity.entityType,
    event: entity.event,
    conditions: entity.conditions,
    templateId: entity.templateId,
    channels: entity.channels,
    recipientQuery: entity.recipientQuery,
    isActive: entity.isActive,
    schedule: entity.schedule,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}

/**
 * Formats a notification template entity to the API response shape.
 */
function formatTemplateResponse(entity: {
  id: string;
  tenantId: string;
  name: string;
  channel: string;
  subject: string | null;
  body: string;
  variables: string[];
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: entity.id,
    tenantId: entity.tenantId,
    name: entity.name,
    channel: entity.channel,
    subject: entity.subject,
    body: entity.body,
    variables: entity.variables,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}

/**
 * Register notification routes on a Fastify instance.
 */
export async function registerNotificationRoutes(
  fastify: FastifyInstance,
  options: NotificationRoutesOptions,
): Promise<void> {
  const { notificationService, prefix = '/notifications' } = options;

  // ─── User Notifications ────────────────────────────────────────────────
  // NOTE: Registered before /:notificationId to avoid route conflicts

  /**
   * GET /notifications/user/:userId
   * Get notifications for a user with pagination.
   */
  fastify.get(
    `${prefix}/user/:userId`,
    async function getUserNotificationsHandler(
      request: FastifyRequest<{
        Params: { userId: string };
        Querystring: GetUserNotificationsQuery;
      }>,
      reply: FastifyReply,
    ) {
      const tenantId = (request as FastifyRequest & { tenantId?: string }).tenantId;
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      const queryResult = validate(GetUserNotificationsQuerySchema, {
        ...request.query,
        page: request.query.page !== undefined ? Number(request.query.page) : undefined,
        pageSize: request.query.pageSize !== undefined ? Number(request.query.pageSize) : undefined,
      });
      if (!queryResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: queryResult.errors,
        });
      }

      try {
        const result = await notificationService.getUserNotifications(
          tenantId,
          request.params.userId,
          queryResult.data,
        );
        return reply.status(200).send({
          data: result.data.map(formatNotificationResponse),
          pagination: {
            page: result.page,
            pageSize: result.pageSize,
            total: result.total,
            totalPages: result.totalPages,
          },
        });
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  // ─── Send Notification ─────────────────────────────────────────────────

  /**
   * POST /notifications/send
   * Send a notification to resolved recipients.
   */
  fastify.post(
    `${prefix}/send`,
    async function sendNotificationHandler(
      request: FastifyRequest<{ Body: SendNotificationInput }>,
      reply: FastifyReply,
    ) {
      const result = validate(SendNotificationSchema, request.body);
      if (!result.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: result.errors,
        });
      }

      const tenantId = (request as FastifyRequest & { tenantId?: string }).tenantId;
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      try {
        const notifications = await notificationService.send(tenantId, result.data);
        return reply.status(201).send({
          data: notifications.map(formatNotificationResponse),
          summary: {
            totalSent: notifications.length,
            channel: result.data.channel,
          },
        });
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  // ─── Delivery Status ───────────────────────────────────────────────────

  /**
   * GET /notifications/:notificationId
   * Get delivery status for a notification.
   */
  fastify.get(
    `${prefix}/:notificationId`,
    async function getDeliveryStatusHandler(
      request: FastifyRequest<{ Params: NotificationIdParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(NotificationIdParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const tenantId = (request as FastifyRequest & { tenantId?: string }).tenantId;
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      try {
        const notification = await notificationService.getDeliveryStatus(
          tenantId,
          paramsResult.data.notificationId,
        );
        return reply.status(200).send(formatNotificationResponse(notification));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  // ─── Mark as Read ──────────────────────────────────────────────────────

  /**
   * POST /notifications/:notificationId/read
   * Mark a notification as read.
   */
  fastify.post(
    `${prefix}/:notificationId/read`,
    async function markAsReadHandler(
      request: FastifyRequest<{ Params: NotificationIdParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(NotificationIdParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const tenantId = (request as FastifyRequest & { tenantId?: string }).tenantId;
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      try {
        const notification = await notificationService.markAsRead(
          tenantId,
          paramsResult.data.notificationId,
        );
        return reply.status(200).send(formatNotificationResponse(notification));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  // ─── Notification Rules ────────────────────────────────────────────────

  /**
   * POST /notifications/rules
   * Create a notification rule.
   */
  fastify.post(
    `${prefix}/rules`,
    async function createRuleHandler(
      request: FastifyRequest<{ Body: CreateNotificationRuleInput }>,
      reply: FastifyReply,
    ) {
      const result = validate(CreateNotificationRuleSchema, request.body);
      if (!result.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: result.errors,
        });
      }

      const tenantId = (request as FastifyRequest & { tenantId?: string }).tenantId;
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      try {
        const rule = await notificationService.createRule(tenantId, result.data);
        return reply.status(201).send(formatRuleResponse(rule));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * GET /notifications/rules
   * List all notification rules for the tenant.
   */
  fastify.get(
    `${prefix}/rules`,
    async function listRulesHandler(
      request: FastifyRequest,
      reply: FastifyReply,
    ) {
      const tenantId = (request as FastifyRequest & { tenantId?: string }).tenantId;
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      try {
        const rules = await notificationService.listRules(tenantId);
        return reply.status(200).send({ data: rules.map(formatRuleResponse) });
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * GET /notifications/rules/:ruleId
   * Get a notification rule by ID.
   */
  fastify.get(
    `${prefix}/rules/:ruleId`,
    async function getRuleHandler(
      request: FastifyRequest<{ Params: RuleIdParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(RuleIdParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const tenantId = (request as FastifyRequest & { tenantId?: string }).tenantId;
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      try {
        const rule = await notificationService.getRule(tenantId, paramsResult.data.ruleId);
        return reply.status(200).send(formatRuleResponse(rule));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * PUT /notifications/rules/:ruleId
   * Update a notification rule.
   */
  fastify.put(
    `${prefix}/rules/:ruleId`,
    async function updateRuleHandler(
      request: FastifyRequest<{ Params: RuleIdParams; Body: UpdateNotificationRuleInput }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(RuleIdParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const bodyResult = validate(UpdateNotificationRuleSchema, request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: bodyResult.errors,
        });
      }

      const tenantId = (request as FastifyRequest & { tenantId?: string }).tenantId;
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      try {
        const rule = await notificationService.updateRule(
          tenantId,
          paramsResult.data.ruleId,
          bodyResult.data,
        );
        return reply.status(200).send(formatRuleResponse(rule));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * DELETE /notifications/rules/:ruleId
   * Delete a notification rule.
   */
  fastify.delete(
    `${prefix}/rules/:ruleId`,
    async function deleteRuleHandler(
      request: FastifyRequest<{ Params: RuleIdParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(RuleIdParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const tenantId = (request as FastifyRequest & { tenantId?: string }).tenantId;
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      try {
        await notificationService.deleteRule(tenantId, paramsResult.data.ruleId);
        return reply.status(204).send();
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  // ─── Notification Templates ────────────────────────────────────────────

  /**
   * POST /notifications/templates
   * Create a notification template.
   */
  fastify.post(
    `${prefix}/templates`,
    async function createTemplateHandler(
      request: FastifyRequest<{ Body: CreateNotificationTemplateInput }>,
      reply: FastifyReply,
    ) {
      const result = validate(CreateNotificationTemplateSchema, request.body);
      if (!result.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: result.errors,
        });
      }

      const tenantId = (request as FastifyRequest & { tenantId?: string }).tenantId;
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      try {
        const template = await notificationService.createTemplate(tenantId, result.data);
        return reply.status(201).send(formatTemplateResponse(template));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * GET /notifications/templates
   * List all notification templates for the tenant.
   */
  fastify.get(
    `${prefix}/templates`,
    async function listTemplatesHandler(
      request: FastifyRequest,
      reply: FastifyReply,
    ) {
      const tenantId = (request as FastifyRequest & { tenantId?: string }).tenantId;
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      try {
        const templates = await notificationService.listTemplates(tenantId);
        return reply.status(200).send({ data: templates.map(formatTemplateResponse) });
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );
}
