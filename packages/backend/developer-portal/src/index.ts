/**
 * @proctira/backend-developer-portal - Developer Portal Service
 *
 * Provides developer-facing API for:
 * - Developer account management (create, update, suspend)
 * - API key management (create, revoke, validate)
 * - Webhook registration with HMAC-SHA256 signature verification
 * - Webhook delivery tracking with retry history
 * - Sandbox/test tenant provisioning
 * - Plugin submission and review workflow
 * - Plugin marketplace listing and search
 * - Developer documentation hosting
 * - Plugin analytics (installs, usage, ratings)
 *
 * Charter: Section 10 (Developer Portal)
 * Requirements: 30.1, 30.2, 30.3, 30.4, 30.5
 */

// Plugin
export { developerPortalPlugin } from './developer-portal-plugin.js';
export type { DeveloperPortalPluginOptions } from './developer-portal-plugin.js';

// Service
export {
  DeveloperPortalService,
  DEFAULT_CONFIG,
  generateApiKey,
  hashApiKey,
  generateWebhookSignature,
  verifyWebhookSignature,
} from './developer-portal-service.js';
export type { DeveloperPortalServiceConfig } from './developer-portal-service.js';

// Repository
export type {
  DeveloperPortalRepository,
  DeveloperPortalExtendedRepository,
  DeveloperAccountEntity,
  ApiKeyEntity,
  ApiKeyFilter,
  WebhookEntity,
  WebhookFilter,
  WebhookDeliveryEntity,
  WebhookDeliveryFilter,
  SandboxEntity,
  PluginSubmissionEntity,
  PluginSubmissionFilter,
  MarketplaceListingEntity,
  MarketplaceFilter,
  PluginRatingEntity,
  DocPageEntity,
  DocPageFilter,
  AnalyticsEventEntity,
  PluginAnalyticsSummary,
  AnalyticsTimeSeries,
  AnalyticsFilter,
} from './developer-portal-repository.js';

// In-memory repository (for testing)
export { InMemoryDeveloperPortalRepository } from './in-memory-repository.js';

// Schemas
export {
  CreateDeveloperAccountSchema,
  UpdateDeveloperAccountSchema,
  DeveloperAccountParamsSchema,
  CreateApiKeySchema,
  ApiKeyParamsSchema,
  ApiKeyListQuerySchema,
  CreateWebhookSchema,
  UpdateWebhookSchema,
  WebhookParamsSchema,
  WebhookListQuerySchema,
  WebhookDeliveryQuerySchema,
  CreateSandboxSchema,
  SandboxParamsSchema,
  SubmitPluginSchema,
  PluginSubmissionParamsSchema,
  ReviewPluginSchema,
  MarketplaceSearchQuerySchema,
  MarketplacePluginParamsSchema,
  PluginRatingSchema,
  CreateDocPageSchema,
  UpdateDocPageSchema,
  DocPageParamsSchema,
  DocListQuerySchema,
  AnalyticsQuerySchema,
  RecordAnalyticsEventSchema,
  DeveloperAccountResponseSchema,
  ApiKeyResponseSchema,
  ApiKeyCreatedResponseSchema,
  WebhookResponseSchema,
  WebhookDeliveryResponseSchema,
  SandboxResponseSchema,
  PluginSubmissionResponseSchema,
  MarketplaceListingResponseSchema,
  DocPageResponseSchema,
  PluginAnalyticsResponseSchema,
} from './schemas.js';
export type {
  CreateDeveloperAccountInput,
  UpdateDeveloperAccountInput,
  DeveloperAccountParams,
  CreateApiKeyInput,
  ApiKeyParams,
  ApiKeyListQuery,
  CreateWebhookInput,
  UpdateWebhookInput,
  WebhookParams,
  WebhookListQuery,
  WebhookDeliveryQuery,
  CreateSandboxInput,
  SandboxParams,
  SubmitPluginInput,
  PluginSubmissionParams,
  ReviewPluginInput,
  MarketplaceSearchQuery,
  MarketplacePluginParams,
  PluginRatingInput,
  CreateDocPageInput,
  UpdateDocPageInput,
  DocPageParams,
  DocListQuery,
  AnalyticsQuery,
  RecordAnalyticsEventInput,
  DeveloperAccountResponse,
  ApiKeyResponse,
  ApiKeyCreatedResponse,
  WebhookResponse,
  WebhookDeliveryResponse,
  SandboxResponse,
  PluginSubmissionResponse,
  MarketplaceListingResponse,
  DocPageResponse,
  PluginAnalyticsResponse,
} from './schemas.js';

// Routes
export { registerDeveloperPortalRoutes } from './routes.js';
export type { DeveloperPortalRoutesOptions } from './routes.js';
