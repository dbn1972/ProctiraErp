/**
 * Developer Portal Schemas
 *
 * Typebox schemas for developer accounts, API keys, webhooks,
 * sandbox tenant provisioning, plugin submissions, marketplace,
 * documentation hosting, and plugin analytics.
 */
import { Type, type Static } from '@sinclair/typebox';

/** UUID v4 pattern for validation */
const UUID_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
const UuidString = () => Type.String({ pattern: UUID_PATTERN, description: 'UUID v4 identifier' });

// ─── Developer Account Schemas ────────────────────────────────────────────────

export const CreateDeveloperAccountSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 255 }),
  email: Type.String({ format: 'email', maxLength: 255 }),
  organization: Type.Optional(Type.String({ maxLength: 255 })),
  website: Type.Optional(Type.String({ maxLength: 500 })),
});

export type CreateDeveloperAccountInput = Static<typeof CreateDeveloperAccountSchema>;

export const UpdateDeveloperAccountSchema = Type.Object({
  name: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
  organization: Type.Optional(Type.String({ maxLength: 255 })),
  website: Type.Optional(Type.String({ maxLength: 500 })),
});

export type UpdateDeveloperAccountInput = Static<typeof UpdateDeveloperAccountSchema>;

export const DeveloperAccountParamsSchema = Type.Object({
  accountId: UuidString(),
});

export type DeveloperAccountParams = Static<typeof DeveloperAccountParamsSchema>;

// ─── API Key Schemas ──────────────────────────────────────────────────────────

export const CreateApiKeySchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 128 }),
  scopes: Type.Array(Type.String({ minLength: 1, maxLength: 128 }), { minItems: 1, maxItems: 50 }),
  expiresInDays: Type.Optional(Type.Number({ minimum: 1, maximum: 365 })),
});

export type CreateApiKeyInput = Static<typeof CreateApiKeySchema>;

export const ApiKeyParamsSchema = Type.Object({
  keyId: UuidString(),
});

export type ApiKeyParams = Static<typeof ApiKeyParamsSchema>;

export const ApiKeyListQuerySchema = Type.Object({
  page: Type.Optional(Type.Number({ minimum: 1, default: 1 })),
  pageSize: Type.Optional(Type.Number({ minimum: 1, maximum: 100, default: 20 })),
  status: Type.Optional(Type.Union([
    Type.Literal('active'),
    Type.Literal('revoked'),
    Type.Literal('expired'),
  ])),
});

export type ApiKeyListQuery = Static<typeof ApiKeyListQuerySchema>;

// ─── Webhook Schemas ──────────────────────────────────────────────────────────

export const CreateWebhookSchema = Type.Object({
  url: Type.String({ format: 'uri', maxLength: 2048 }),
  events: Type.Array(Type.String({ minLength: 1, maxLength: 128 }), { minItems: 1, maxItems: 50 }),
  secret: Type.Optional(Type.String({ minLength: 16, maxLength: 256 })),
  description: Type.Optional(Type.String({ maxLength: 500 })),
  active: Type.Optional(Type.Boolean({ default: true })),
});

export type CreateWebhookInput = Static<typeof CreateWebhookSchema>;

export const UpdateWebhookSchema = Type.Object({
  url: Type.Optional(Type.String({ format: 'uri', maxLength: 2048 })),
  events: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 128 }), { minItems: 1, maxItems: 50 })),
  secret: Type.Optional(Type.String({ minLength: 16, maxLength: 256 })),
  description: Type.Optional(Type.String({ maxLength: 500 })),
  active: Type.Optional(Type.Boolean()),
});

export type UpdateWebhookInput = Static<typeof UpdateWebhookSchema>;

export const WebhookParamsSchema = Type.Object({
  webhookId: UuidString(),
});

export type WebhookParams = Static<typeof WebhookParamsSchema>;

export const WebhookListQuerySchema = Type.Object({
  page: Type.Optional(Type.Number({ minimum: 1, default: 1 })),
  pageSize: Type.Optional(Type.Number({ minimum: 1, maximum: 100, default: 20 })),
  active: Type.Optional(Type.Boolean()),
});

export type WebhookListQuery = Static<typeof WebhookListQuerySchema>;

export const WebhookDeliveryQuerySchema = Type.Object({
  page: Type.Optional(Type.Number({ minimum: 1, default: 1 })),
  pageSize: Type.Optional(Type.Number({ minimum: 1, maximum: 100, default: 20 })),
  status: Type.Optional(Type.Union([
    Type.Literal('pending'),
    Type.Literal('delivered'),
    Type.Literal('failed'),
  ])),
});

export type WebhookDeliveryQuery = Static<typeof WebhookDeliveryQuerySchema>;

// ─── Sandbox Schemas ──────────────────────────────────────────────────────────

export const CreateSandboxSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 128 }),
  description: Type.Optional(Type.String({ maxLength: 500 })),
  seedData: Type.Optional(Type.Union([
    Type.Literal('minimal'),
    Type.Literal('sample'),
    Type.Literal('full'),
  ])),
});

export type CreateSandboxInput = Static<typeof CreateSandboxSchema>;

export const SandboxParamsSchema = Type.Object({
  sandboxId: UuidString(),
});

export type SandboxParams = Static<typeof SandboxParamsSchema>;

// ─── Response Schemas ─────────────────────────────────────────────────────────

export const DeveloperAccountResponseSchema = Type.Object({
  id: UuidString(),
  name: Type.String(),
  email: Type.String(),
  organization: Type.Union([Type.String(), Type.Null()]),
  website: Type.Union([Type.String(), Type.Null()]),
  status: Type.String(),
  createdAt: Type.String(),
  updatedAt: Type.String(),
});

export type DeveloperAccountResponse = Static<typeof DeveloperAccountResponseSchema>;

export const ApiKeyResponseSchema = Type.Object({
  id: UuidString(),
  accountId: UuidString(),
  name: Type.String(),
  keyPrefix: Type.String(),
  scopes: Type.Array(Type.String()),
  status: Type.String(),
  expiresAt: Type.Union([Type.String(), Type.Null()]),
  lastUsedAt: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.String(),
});

export type ApiKeyResponse = Static<typeof ApiKeyResponseSchema>;

export const ApiKeyCreatedResponseSchema = Type.Object({
  id: UuidString(),
  accountId: UuidString(),
  name: Type.String(),
  key: Type.String({ description: 'Full API key (only shown once)' }),
  keyPrefix: Type.String(),
  scopes: Type.Array(Type.String()),
  status: Type.String(),
  expiresAt: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.String(),
});

export type ApiKeyCreatedResponse = Static<typeof ApiKeyCreatedResponseSchema>;

export const WebhookResponseSchema = Type.Object({
  id: UuidString(),
  accountId: UuidString(),
  url: Type.String(),
  events: Type.Array(Type.String()),
  description: Type.Union([Type.String(), Type.Null()]),
  active: Type.Boolean(),
  createdAt: Type.String(),
  updatedAt: Type.String(),
});

export type WebhookResponse = Static<typeof WebhookResponseSchema>;

export const WebhookDeliveryResponseSchema = Type.Object({
  id: UuidString(),
  webhookId: UuidString(),
  event: Type.String(),
  payload: Type.Record(Type.String(), Type.Unknown()),
  status: Type.String(),
  httpStatus: Type.Union([Type.Number(), Type.Null()]),
  attempts: Type.Number(),
  lastAttemptAt: Type.Union([Type.String(), Type.Null()]),
  nextRetryAt: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.String(),
});

export type WebhookDeliveryResponse = Static<typeof WebhookDeliveryResponseSchema>;

export const SandboxResponseSchema = Type.Object({
  id: UuidString(),
  accountId: UuidString(),
  name: Type.String(),
  description: Type.Union([Type.String(), Type.Null()]),
  tenantId: UuidString(),
  status: Type.String(),
  expiresAt: Type.String(),
  apiEndpoint: Type.String(),
  createdAt: Type.String(),
});

export type SandboxResponse = Static<typeof SandboxResponseSchema>;


// ─── Plugin Submission Schemas ────────────────────────────────────────────────

export const SubmitPluginSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 128, pattern: '^[a-z0-9-]+$' }),
  version: Type.String({ pattern: '^\\d+\\.\\d+\\.\\d+(-[a-zA-Z0-9.]+)?$' }),
  displayName: Type.String({ minLength: 1, maxLength: 255 }),
  description: Type.String({ minLength: 10, maxLength: 2000 }),
  category: Type.Union([
    Type.Literal('ui-extension'),
    Type.Literal('workflow'),
    Type.Literal('event-handler'),
    Type.Literal('integration-connector'),
    Type.Literal('validation'),
    Type.Literal('notification'),
    Type.Literal('reporting'),
    Type.Literal('theme-extension'),
    Type.Literal('developer-tooling'),
  ]),
  supportedProductVersions: Type.String({ minLength: 1, maxLength: 100 }),
  requiredPermissions: Type.Array(Type.String({ minLength: 1, maxLength: 128 }), { minItems: 0, maxItems: 50 }),
  sourceUrl: Type.Optional(Type.String({ format: 'uri', maxLength: 2048 })),
  documentationUrl: Type.Optional(Type.String({ format: 'uri', maxLength: 2048 })),
  iconUrl: Type.Optional(Type.String({ format: 'uri', maxLength: 2048 })),
  screenshots: Type.Optional(Type.Array(Type.String({ format: 'uri', maxLength: 2048 }), { maxItems: 10 })),
  tags: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 64 }), { maxItems: 20 })),
  license: Type.Optional(Type.String({ maxLength: 128 })),
});

export type SubmitPluginInput = Static<typeof SubmitPluginSchema>;

export const PluginSubmissionParamsSchema = Type.Object({
  submissionId: UuidString(),
});

export type PluginSubmissionParams = Static<typeof PluginSubmissionParamsSchema>;

export const ReviewPluginSchema = Type.Object({
  decision: Type.Union([Type.Literal('approved'), Type.Literal('rejected')]),
  reviewNotes: Type.Optional(Type.String({ maxLength: 2000 })),
  conditions: Type.Optional(Type.Array(Type.String({ maxLength: 500 }), { maxItems: 10 })),
});

export type ReviewPluginInput = Static<typeof ReviewPluginSchema>;

// ─── Marketplace Schemas ──────────────────────────────────────────────────────

export const MarketplaceSearchQuerySchema = Type.Object({
  page: Type.Optional(Type.Number({ minimum: 1, default: 1 })),
  pageSize: Type.Optional(Type.Number({ minimum: 1, maximum: 100, default: 20 })),
  search: Type.Optional(Type.String({ maxLength: 255 })),
  category: Type.Optional(Type.String()),
  sortBy: Type.Optional(Type.Union([
    Type.Literal('name'),
    Type.Literal('installs'),
    Type.Literal('rating'),
    Type.Literal('publishedAt'),
  ])),
  sortOrder: Type.Optional(Type.Union([Type.Literal('asc'), Type.Literal('desc')])),
  tags: Type.Optional(Type.String({ description: 'Comma-separated tags' })),
});

export type MarketplaceSearchQuery = Static<typeof MarketplaceSearchQuerySchema>;

export const MarketplacePluginParamsSchema = Type.Object({
  pluginName: Type.String({ minLength: 1, maxLength: 128 }),
});

export type MarketplacePluginParams = Static<typeof MarketplacePluginParamsSchema>;

export const PluginRatingSchema = Type.Object({
  rating: Type.Number({ minimum: 1, maximum: 5 }),
  review: Type.Optional(Type.String({ maxLength: 1000 })),
});

export type PluginRatingInput = Static<typeof PluginRatingSchema>;

// ─── Documentation Schemas ────────────────────────────────────────────────────

export const CreateDocPageSchema = Type.Object({
  slug: Type.String({ minLength: 1, maxLength: 255, pattern: '^[a-z0-9-/]+$' }),
  title: Type.String({ minLength: 1, maxLength: 255 }),
  content: Type.String({ minLength: 1, maxLength: 100000 }),
  category: Type.Union([
    Type.Literal('getting-started'),
    Type.Literal('authentication'),
    Type.Literal('api-reference'),
    Type.Literal('webhooks'),
    Type.Literal('plugins'),
    Type.Literal('themes'),
    Type.Literal('sdks'),
    Type.Literal('errors'),
    Type.Literal('rate-limits'),
    Type.Literal('changelog'),
  ]),
  order: Type.Optional(Type.Number({ minimum: 0, maximum: 9999 })),
  published: Type.Optional(Type.Boolean({ default: false })),
});

export type CreateDocPageInput = Static<typeof CreateDocPageSchema>;

export const UpdateDocPageSchema = Type.Object({
  title: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
  content: Type.Optional(Type.String({ minLength: 1, maxLength: 100000 })),
  category: Type.Optional(Type.Union([
    Type.Literal('getting-started'),
    Type.Literal('authentication'),
    Type.Literal('api-reference'),
    Type.Literal('webhooks'),
    Type.Literal('plugins'),
    Type.Literal('themes'),
    Type.Literal('sdks'),
    Type.Literal('errors'),
    Type.Literal('rate-limits'),
    Type.Literal('changelog'),
  ])),
  order: Type.Optional(Type.Number({ minimum: 0, maximum: 9999 })),
  published: Type.Optional(Type.Boolean()),
});

export type UpdateDocPageInput = Static<typeof UpdateDocPageSchema>;

export const DocPageParamsSchema = Type.Object({
  slug: Type.String({ minLength: 1, maxLength: 255 }),
});

export type DocPageParams = Static<typeof DocPageParamsSchema>;

export const DocListQuerySchema = Type.Object({
  category: Type.Optional(Type.String()),
  published: Type.Optional(Type.Boolean()),
});

export type DocListQuery = Static<typeof DocListQuerySchema>;

// ─── Analytics Schemas ────────────────────────────────────────────────────────

export const AnalyticsQuerySchema = Type.Object({
  startDate: Type.Optional(Type.String({ format: 'date' })),
  endDate: Type.Optional(Type.String({ format: 'date' })),
  granularity: Type.Optional(Type.Union([
    Type.Literal('day'),
    Type.Literal('week'),
    Type.Literal('month'),
  ])),
});

export type AnalyticsQuery = Static<typeof AnalyticsQuerySchema>;

export const RecordAnalyticsEventSchema = Type.Object({
  pluginName: Type.String({ minLength: 1, maxLength: 128 }),
  eventType: Type.Union([
    Type.Literal('install'),
    Type.Literal('uninstall'),
    Type.Literal('api_call'),
    Type.Literal('error'),
    Type.Literal('page_view'),
  ]),
  metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});

export type RecordAnalyticsEventInput = Static<typeof RecordAnalyticsEventSchema>;

// ─── Extended Response Schemas ────────────────────────────────────────────────

export const PluginSubmissionResponseSchema = Type.Object({
  id: UuidString(),
  accountId: UuidString(),
  name: Type.String(),
  version: Type.String(),
  displayName: Type.String(),
  description: Type.String(),
  category: Type.String(),
  status: Type.String(),
  reviewNotes: Type.Union([Type.String(), Type.Null()]),
  submittedAt: Type.String(),
  reviewedAt: Type.Union([Type.String(), Type.Null()]),
});

export type PluginSubmissionResponse = Static<typeof PluginSubmissionResponseSchema>;

export const MarketplaceListingResponseSchema = Type.Object({
  name: Type.String(),
  displayName: Type.String(),
  description: Type.String(),
  category: Type.String(),
  version: Type.String(),
  author: Type.String(),
  iconUrl: Type.Union([Type.String(), Type.Null()]),
  tags: Type.Array(Type.String()),
  installs: Type.Number(),
  averageRating: Type.Number(),
  ratingCount: Type.Number(),
  publishedAt: Type.String(),
});

export type MarketplaceListingResponse = Static<typeof MarketplaceListingResponseSchema>;

export const DocPageResponseSchema = Type.Object({
  id: UuidString(),
  slug: Type.String(),
  title: Type.String(),
  content: Type.String(),
  category: Type.String(),
  order: Type.Number(),
  published: Type.Boolean(),
  createdAt: Type.String(),
  updatedAt: Type.String(),
});

export type DocPageResponse = Static<typeof DocPageResponseSchema>;

export const PluginAnalyticsResponseSchema = Type.Object({
  pluginName: Type.String(),
  totalInstalls: Type.Number(),
  activeInstalls: Type.Number(),
  totalApiCalls: Type.Number(),
  totalErrors: Type.Number(),
  averageRating: Type.Number(),
  ratingCount: Type.Number(),
  timeSeries: Type.Array(Type.Object({
    date: Type.String(),
    installs: Type.Number(),
    uninstalls: Type.Number(),
    apiCalls: Type.Number(),
    errors: Type.Number(),
  })),
});

export type PluginAnalyticsResponse = Static<typeof PluginAnalyticsResponseSchema>;
