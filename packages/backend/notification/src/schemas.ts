/**
 * Typebox schemas for Notification Service request/response validation.
 *
 * Defines schemas for:
 * - SendNotification (body)
 * - CreateNotificationRule (body)
 * - GetDeliveryStatus (params)
 * - GetUserNotifications (query)
 * - NotificationResponse (response)
 *
 * Requirements:
 * - 22.1: Multi-channel delivery (email, in-app, push, webhook)
 * - 22.2: Configurable notification rules based on entity events, thresholds, schedules
 * - 22.3: Deliver to recipients matching role and area criteria
 * - 22.4: Template-based notifications with variable substitution
 * - 22.5: Track delivery status (sent, delivered, read, failed)
 * - 22.6: Retry email delivery up to 3 times with exponential backoff
 */
import { Type, type Static } from '@sinclair/typebox';

const UuidPattern = '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

// ─── Delivery Channel ────────────────────────────────────────────────────────

export const DeliveryChannelSchema = Type.Union(
  [
    Type.Literal('email'),
    Type.Literal('in_app'),
    Type.Literal('push'),
    Type.Literal('webhook'),
    Type.Literal('sms'),
  ],
  { description: 'Notification delivery channel' },
);

export type DeliveryChannel = Static<typeof DeliveryChannelSchema>;

// ─── Delivery Status ─────────────────────────────────────────────────────────

export const DeliveryStatusSchema = Type.Union(
  [Type.Literal('sent'), Type.Literal('delivered'), Type.Literal('read'), Type.Literal('failed')],
  { description: 'Notification delivery status' },
);

export type DeliveryStatus = Static<typeof DeliveryStatusSchema>;

// ─── Priority ────────────────────────────────────────────────────────────────

export const PrioritySchema = Type.Union(
  [Type.Literal('low'), Type.Literal('normal'), Type.Literal('high')],
  { description: 'Notification priority' },
);

export type Priority = Static<typeof PrioritySchema>;

// ─── Recipient Query ─────────────────────────────────────────────────────────

export const RecipientQuerySchema = Type.Object(
  {
    userIds: Type.Optional(
      Type.Array(
        Type.String({
          pattern: UuidPattern,
          description: 'Explicit user IDs',
        }),
      ),
    ),
    roleIds: Type.Optional(
      Type.Array(
        Type.String({
          pattern: UuidPattern,
          description: 'Role IDs to match recipients',
        }),
      ),
    ),
    areaIds: Type.Optional(
      Type.Array(
        Type.String({
          pattern: UuidPattern,
          description: 'Area IDs to scope recipients',
        }),
      ),
    ),
    institutionIds: Type.Optional(
      Type.Array(
        Type.String({
          pattern: UuidPattern,
          description: 'Institution IDs to scope recipients',
        }),
      ),
    ),
  },
  { description: 'Query to resolve notification recipients' },
);

export type RecipientQuery = Static<typeof RecipientQuerySchema>;

// ─── Send Notification ───────────────────────────────────────────────────────

export const SendNotificationSchema = Type.Object({
  channel: DeliveryChannelSchema,
  templateId: Type.String({
    pattern: UuidPattern,
    description: 'Notification template UUID',
  }),
  recipients: RecipientQuerySchema,
  variables: Type.Record(Type.String(), Type.String(), {
    description: 'Template variable substitution map',
  }),
  priority: Type.Optional(PrioritySchema),
  webhookUrl: Type.Optional(
    Type.String({
      description: 'Webhook URL for webhook channel delivery',
    }),
  ),
});

export type SendNotificationInput = Static<typeof SendNotificationSchema>;

// ─── Notification Rule ───────────────────────────────────────────────────────

export const NotificationRuleEventSchema = Type.Union(
  [
    Type.Literal('create'),
    Type.Literal('update'),
    Type.Literal('delete'),
    Type.Literal('threshold'),
    Type.Literal('schedule'),
  ],
  { description: 'Event type that triggers the rule' },
);

export type NotificationRuleEvent = Static<typeof NotificationRuleEventSchema>;

export const CreateNotificationRuleSchema = Type.Object({
  name: Type.String({
    minLength: 1,
    maxLength: 255,
    description: 'Rule name',
  }),
  entityType: Type.String({
    minLength: 1,
    maxLength: 100,
    description: 'Entity type to watch (e.g., student, institution, attendance)',
  }),
  event: NotificationRuleEventSchema,
  conditions: Type.Record(Type.String(), Type.Unknown(), {
    description: 'Conditions that must be met for the rule to trigger',
  }),
  templateId: Type.String({
    pattern: UuidPattern,
    description: 'Template to use when rule triggers',
  }),
  channels: Type.Array(DeliveryChannelSchema, {
    minItems: 1,
    description: 'Channels to deliver notification on',
  }),
  recipientQuery: RecipientQuerySchema,
  isActive: Type.Optional(
    Type.Boolean({
      description: 'Whether the rule is active (default: true)',
    }),
  ),
  schedule: Type.Optional(
    Type.String({
      description: 'Cron expression for schedule-based rules',
    }),
  ),
});

export type CreateNotificationRuleInput = Static<typeof CreateNotificationRuleSchema>;

// ─── Update Notification Rule ────────────────────────────────────────────────

export const UpdateNotificationRuleSchema = Type.Partial(CreateNotificationRuleSchema);

export type UpdateNotificationRuleInput = Static<typeof UpdateNotificationRuleSchema>;

// ─── Notification Template ───────────────────────────────────────────────────

export const CreateNotificationTemplateSchema = Type.Object({
  name: Type.String({
    minLength: 1,
    maxLength: 255,
    description: 'Template name',
  }),
  channel: DeliveryChannelSchema,
  subject: Type.Optional(
    Type.String({
      maxLength: 500,
      description: 'Email subject line (for email channel)',
    }),
  ),
  body: Type.String({
    minLength: 1,
    description: 'Template body with {{variable}} placeholders',
  }),
  variables: Type.Array(Type.String(), {
    description: 'List of variable names used in the template',
  }),
  sensitiveVariables: Type.Optional(
    Type.Array(Type.String(), {
      description:
        'g7_platform-004: variable names to treat as sensitive (redacted on persist/return)',
    }),
  ),
  publicVariables: Type.Optional(
    Type.Array(Type.String(), {
      description:
        'g7_platform-004: variable names to force non-sensitive (opt-out of the built-in denylist)',
    }),
  ),
});

export type CreateNotificationTemplateInput = Static<typeof CreateNotificationTemplateSchema>;

// ─── Query Schemas ───────────────────────────────────────────────────────────

export const GetUserNotificationsQuerySchema = Type.Object(
  {
    page: Type.Optional(Type.Number({ minimum: 1, description: 'Page number' })),
    pageSize: Type.Optional(
      Type.Number({ minimum: 1, maximum: 100, description: 'Items per page' }),
    ),
    status: Type.Optional(DeliveryStatusSchema),
    channel: Type.Optional(DeliveryChannelSchema),
    /** PRC-M114: only notifications the user has not read yet. */
    unread: Type.Optional(Type.Union([Type.Literal('true'), Type.Literal('false')])),
  },
  { additionalProperties: false },
);

export type GetUserNotificationsQuery = Static<typeof GetUserNotificationsQuerySchema>;

export const NotificationIdParamsSchema = Type.Object({
  notificationId: Type.String({
    pattern: UuidPattern,
    description: 'Notification UUID',
  }),
});

export type NotificationIdParams = Static<typeof NotificationIdParamsSchema>;

export const RuleIdParamsSchema = Type.Object({
  ruleId: Type.String({
    pattern: UuidPattern,
    description: 'Notification rule UUID',
  }),
});

export type RuleIdParams = Static<typeof RuleIdParamsSchema>;

// ─── Response Schemas ────────────────────────────────────────────────────────

export const NotificationRecordResponseSchema = Type.Object({
  id: Type.String(),
  tenantId: Type.String(),
  channel: DeliveryChannelSchema,
  templateId: Type.String(),
  recipientUserId: Type.String(),
  variables: Type.Record(Type.String(), Type.String()),
  status: DeliveryStatusSchema,
  priority: PrioritySchema,
  retryCount: Type.Number(),
  maxRetries: Type.Number(),
  sentAt: Type.Optional(Type.String()),
  deliveredAt: Type.Optional(Type.String()),
  readAt: Type.Optional(Type.String()),
  failedAt: Type.Optional(Type.String()),
  failureReason: Type.Optional(Type.String()),
  createdAt: Type.String(),
  updatedAt: Type.String(),
});

export type NotificationRecordResponse = Static<typeof NotificationRecordResponseSchema>;

export const NotificationRuleResponseSchema = Type.Object({
  id: Type.String(),
  tenantId: Type.String(),
  name: Type.String(),
  entityType: Type.String(),
  event: NotificationRuleEventSchema,
  conditions: Type.Record(Type.String(), Type.Unknown()),
  templateId: Type.String(),
  channels: Type.Array(DeliveryChannelSchema),
  recipientQuery: RecipientQuerySchema,
  isActive: Type.Boolean(),
  schedule: Type.Optional(Type.String()),
  createdAt: Type.String(),
  updatedAt: Type.String(),
});

export type NotificationRuleResponse = Static<typeof NotificationRuleResponseSchema>;

// ─── Preferences & devices (PRC-L332) ───────────────────────────────────────

const HhMmPattern = '^([01][0-9]|2[0-3]):[0-5][0-9]$';

export const NotificationCategorySchema = Type.Union([
  Type.Literal('academic'),
  Type.Literal('attendance'),
  Type.Literal('examination'),
  Type.Literal('workflow'),
  Type.Literal('system'),
]);

/** Every channel toggle is required, matching the stored `Record<channel, boolean>`. */
export const ChannelTogglesSchema = Type.Object(
  {
    email: Type.Boolean(),
    in_app: Type.Boolean(),
    push: Type.Boolean(),
    webhook: Type.Boolean(),
    sms: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const CategoryPreferenceSchema = Type.Object(
  { category: NotificationCategorySchema, channels: ChannelTogglesSchema },
  { additionalProperties: false },
);

export const QuietHoursSchema = Type.Object(
  {
    enabled: Type.Boolean(),
    startTime: Type.String({ pattern: HhMmPattern }),
    endTime: Type.String({ pattern: HhMmPattern }),
    days: Type.Array(Type.Integer({ minimum: 0, maximum: 6 }), { maxItems: 7, uniqueItems: true }),
  },
  { additionalProperties: false },
);

/** PATCH /notifications/preferences body: partial, but every present field is typed. */
export const UpdateNotificationPreferencesSchema = Type.Object(
  {
    categories: Type.Optional(Type.Array(CategoryPreferenceSchema, { maxItems: 20 })),
    digestFrequency: Type.Optional(
      Type.Union([Type.Literal('immediate'), Type.Literal('daily'), Type.Literal('weekly')]),
    ),
    quietHours: Type.Optional(QuietHoursSchema),
  },
  { additionalProperties: false },
);

export type UpdateNotificationPreferencesInput = Static<typeof UpdateNotificationPreferencesSchema>;

/** POST /notifications/devices body. The owner is always the caller (never a body field). */
export const RegisterDeviceSchema = Type.Object(
  {
    platform: Type.Union([Type.Literal('ios'), Type.Literal('android'), Type.Literal('web')]),
    pushToken: Type.String({ minLength: 1, maxLength: 4096 }),
  },
  { additionalProperties: false },
);

export type RegisterDeviceInput = Static<typeof RegisterDeviceSchema>;
