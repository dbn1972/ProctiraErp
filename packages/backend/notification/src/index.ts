/**
 * @proctira/backend-notification - Notification domain service
 *
 * Provides multi-channel notification delivery with:
 * - Email, in-app, push (FCM), and webhook channels
 * - Template-based notifications with variable substitution
 * - Rule-based triggering on Kafka events (entity events, thresholds, schedules)
 * - Delivery status tracking (sent, delivered, read, failed)
 * - Retry with exponential backoff via RabbitMQ dead-letter exchanges
 *
 * Requirements: 22.1, 22.2, 22.3, 22.4, 22.5, 22.6
 */

// Plugin
export { notificationPlugin } from './notification-plugin.js';
export type { NotificationPluginOptions } from './notification-plugin.js';

// Service
export { NotificationService } from './notification-service.js';
export type {
  EmailSender,
  PushSender,
  WebhookSender,
  NotificationQueuePublisher,
  NotificationServiceConfig,
} from './notification-service.js';

// Repository
export type {
  NotificationRepository,
  NotificationEntity,
  NotificationRuleEntity,
  NotificationTemplateEntity,
  NotificationQueryOptions,
  PaginatedNotifications,
} from './notification-repository.js';

// In-memory repository (for testing)
export { InMemoryNotificationRepository } from './in-memory-repository.js';

// Prisma repository (Postgres + RLS) + factory
export { PrismaNotificationRepository } from './prisma-notification-repository.js';
export { createNotificationRepository } from './repository-factory.js';
export type { NotificationRepositoryConfig } from './repository-factory.js';

// Schemas
export {
  DeliveryChannelSchema,
  DeliveryStatusSchema,
  PrioritySchema,
  RecipientQuerySchema,
  SendNotificationSchema,
  CreateNotificationRuleSchema,
  UpdateNotificationRuleSchema,
  CreateNotificationTemplateSchema,
  GetUserNotificationsQuerySchema,
  NotificationIdParamsSchema,
  RuleIdParamsSchema,
  NotificationRecordResponseSchema,
  NotificationRuleResponseSchema,
  NotificationRuleEventSchema,
} from './schemas.js';
export type {
  DeliveryChannel,
  DeliveryStatus,
  Priority,
  RecipientQuery,
  SendNotificationInput,
  CreateNotificationRuleInput,
  UpdateNotificationRuleInput,
  CreateNotificationTemplateInput,
  GetUserNotificationsQuery,
  NotificationIdParams,
  RuleIdParams,
  NotificationRecordResponse,
  NotificationRuleResponse,
  NotificationRuleEvent,
} from './schemas.js';

// Routes
export { registerNotificationRoutes } from './routes.js';
export type { NotificationRoutesOptions } from './routes.js';

// Default Templates (using {{brand_name}} variable substitution)
export {
  DEFAULT_TEMPLATES,
  welcomeEmailTemplate,
  passwordResetEmailTemplate,
  enrollmentConfirmationEmailTemplate,
  absenceAlertEmailTemplate,
  transferNotificationEmailTemplate,
  pushWelcomeTemplate,
  pushAbsenceAlertTemplate,
  pushAssessmentResultTemplate,
  inAppWelcomeTemplate,
  inAppWorkflowAssignedTemplate,
  inAppCertificationExpiryTemplate,
} from './templates/index.js';
export type { DefaultTemplate } from './templates/index.js';
