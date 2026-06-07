/**
 * Developer Portal Routes
 *
 * POST   /developer/accounts                    - Create developer account
 * GET    /developer/accounts/:accountId         - Get developer account
 * PATCH  /developer/accounts/:accountId         - Update developer account
 * POST   /developer/accounts/:accountId/suspend - Suspend developer account
 * POST   /developer/accounts/:accountId/keys    - Create API key
 * GET    /developer/accounts/:accountId/keys    - List API keys
 * DELETE /developer/accounts/:accountId/keys/:keyId - Revoke API key
 * POST   /developer/accounts/:accountId/webhooks    - Create webhook
 * GET    /developer/accounts/:accountId/webhooks    - List webhooks
 * GET    /developer/accounts/:accountId/webhooks/:webhookId - Get webhook
 * PATCH  /developer/accounts/:accountId/webhooks/:webhookId - Update webhook
 * DELETE /developer/accounts/:accountId/webhooks/:webhookId - Delete webhook
 * GET    /developer/accounts/:accountId/webhooks/:webhookId/deliveries - List deliveries
 * POST   /developer/accounts/:accountId/sandboxes   - Create sandbox
 * GET    /developer/accounts/:accountId/sandboxes   - List sandboxes
 * DELETE /developer/accounts/:accountId/sandboxes/:sandboxId - Destroy sandbox
 * POST   /developer/validate-key                - Validate an API key
 */
import { AppError } from '@proctira/common';
import { validate } from '@proctira/validation';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

import type { DeveloperPortalService } from './developer-portal-service.js';
import {
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
} from './schemas.js';
import type {
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
} from './schemas.js';

/**
 * Options for registering developer portal routes.
 */
export interface DeveloperPortalRoutesOptions {
  service: DeveloperPortalService;
  /** Route prefix (default: '/developer') */
  prefix?: string;
}

/**
 * Format account entity for API response.
 */
function formatAccountResponse(entity: {
  id: string;
  name: string;
  email: string;
  organization: string | null;
  website: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: entity.id,
    name: entity.name,
    email: entity.email,
    organization: entity.organization,
    website: entity.website,
    status: entity.status,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}

/**
 * Format API key entity for API response (without hash).
 */
function formatApiKeyResponse(entity: {
  id: string;
  accountId: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  status: string;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: entity.id,
    accountId: entity.accountId,
    name: entity.name,
    keyPrefix: entity.keyPrefix,
    scopes: entity.scopes,
    status: entity.status,
    expiresAt: entity.expiresAt?.toISOString() ?? null,
    lastUsedAt: entity.lastUsedAt?.toISOString() ?? null,
    createdAt: entity.createdAt.toISOString(),
  };
}

/**
 * Format webhook entity for API response (without secret).
 */
function formatWebhookResponse(entity: {
  id: string;
  accountId: string;
  url: string;
  events: string[];
  description: string | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: entity.id,
    accountId: entity.accountId,
    url: entity.url,
    events: entity.events,
    description: entity.description,
    active: entity.active,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}

/**
 * Format webhook delivery entity for API response.
 */
function formatDeliveryResponse(entity: {
  id: string;
  webhookId: string;
  event: string;
  payload: Record<string, unknown>;
  status: string;
  httpStatus: number | null;
  attempts: number;
  lastAttemptAt: Date | null;
  nextRetryAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: entity.id,
    webhookId: entity.webhookId,
    event: entity.event,
    payload: entity.payload,
    status: entity.status,
    httpStatus: entity.httpStatus,
    attempts: entity.attempts,
    lastAttemptAt: entity.lastAttemptAt?.toISOString() ?? null,
    nextRetryAt: entity.nextRetryAt?.toISOString() ?? null,
    createdAt: entity.createdAt.toISOString(),
  };
}

/**
 * Format sandbox entity for API response.
 */
function formatSandboxResponse(entity: {
  id: string;
  accountId: string;
  name: string;
  description: string | null;
  tenantId: string;
  status: string;
  expiresAt: Date;
  apiEndpoint: string;
  createdAt: Date;
}) {
  return {
    id: entity.id,
    accountId: entity.accountId,
    name: entity.name,
    description: entity.description,
    tenantId: entity.tenantId,
    status: entity.status,
    expiresAt: entity.expiresAt.toISOString(),
    apiEndpoint: entity.apiEndpoint,
    createdAt: entity.createdAt.toISOString(),
  };
}

/**
 * Format plugin submission entity for API response.
 */
function formatSubmissionResponse(entity: {
  id: string;
  accountId: string;
  name: string;
  version: string;
  displayName: string;
  description: string;
  category: string;
  status: string;
  reviewNotes: string | null;
  submittedAt: Date;
  reviewedAt: Date | null;
}) {
  return {
    id: entity.id,
    accountId: entity.accountId,
    name: entity.name,
    version: entity.version,
    displayName: entity.displayName,
    description: entity.description,
    category: entity.category,
    status: entity.status,
    reviewNotes: entity.reviewNotes,
    submittedAt: entity.submittedAt.toISOString(),
    reviewedAt: entity.reviewedAt?.toISOString() ?? null,
  };
}

/**
 * Format marketplace listing entity for API response.
 */
function formatMarketplaceResponse(entity: {
  name: string;
  displayName: string;
  description: string;
  category: string;
  version: string;
  author: string;
  iconUrl: string | null;
  tags: string[];
  installs: number;
  averageRating: number;
  ratingCount: number;
  publishedAt: Date;
}) {
  return {
    name: entity.name,
    displayName: entity.displayName,
    description: entity.description,
    category: entity.category,
    version: entity.version,
    author: entity.author,
    iconUrl: entity.iconUrl,
    tags: entity.tags,
    installs: entity.installs,
    averageRating: entity.averageRating,
    ratingCount: entity.ratingCount,
    publishedAt: entity.publishedAt.toISOString(),
  };
}

/**
 * Format documentation page entity for API response.
 */
function formatDocPageResponse(entity: {
  id: string;
  slug: string;
  title: string;
  content: string;
  category: string;
  order: number;
  published: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: entity.id,
    slug: entity.slug,
    title: entity.title,
    content: entity.content,
    category: entity.category,
    order: entity.order,
    published: entity.published,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}

/**
 * Register developer portal routes on a Fastify instance.
 */
export async function registerDeveloperPortalRoutes(
  fastify: FastifyInstance,
  options: DeveloperPortalRoutesOptions,
): Promise<void> {
  const { service, prefix = '/developer' } = options;

  // ─── Developer Account Routes ─────────────────────────────────────────

  /**
   * POST /developer/accounts
   * Create a new developer account.
   */
  fastify.post(
    `${prefix}/accounts`,
    async function createAccountHandler(
      request: FastifyRequest<{ Body: CreateDeveloperAccountInput }>,
      reply: FastifyReply,
    ) {
      const result = validate(CreateDeveloperAccountSchema, request.body);
      if (!result.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: result.errors,
        });
      }

      try {
        const account = await service.createAccount(result.data);
        return reply.status(201).send(formatAccountResponse(account));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * GET /developer/accounts/:accountId
   * Get a developer account by ID.
   */
  fastify.get(
    `${prefix}/accounts/:accountId`,
    async function getAccountHandler(
      request: FastifyRequest<{ Params: DeveloperAccountParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(DeveloperAccountParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid account ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      try {
        const account = await service.getAccount(paramsResult.data.accountId);
        return reply.status(200).send(formatAccountResponse(account));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * PATCH /developer/accounts/:accountId
   * Update a developer account.
   */
  fastify.patch(
    `${prefix}/accounts/:accountId`,
    async function updateAccountHandler(
      request: FastifyRequest<{ Params: DeveloperAccountParams; Body: UpdateDeveloperAccountInput }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(DeveloperAccountParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid account ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const bodyResult = validate(UpdateDeveloperAccountSchema, request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: bodyResult.errors,
        });
      }

      try {
        const account = await service.updateAccount(paramsResult.data.accountId, bodyResult.data);
        return reply.status(200).send(formatAccountResponse(account));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * POST /developer/accounts/:accountId/suspend
   * Suspend a developer account.
   */
  fastify.post(
    `${prefix}/accounts/:accountId/suspend`,
    async function suspendAccountHandler(
      request: FastifyRequest<{ Params: DeveloperAccountParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(DeveloperAccountParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid account ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      try {
        const account = await service.suspendAccount(paramsResult.data.accountId);
        return reply.status(200).send(formatAccountResponse(account));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  // ─── API Key Routes ─────────────────────────────────────────────────────

  /**
   * POST /developer/accounts/:accountId/keys
   * Create a new API key for the account.
   */
  fastify.post(
    `${prefix}/accounts/:accountId/keys`,
    async function createApiKeyHandler(
      request: FastifyRequest<{ Params: DeveloperAccountParams; Body: CreateApiKeyInput }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(DeveloperAccountParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid account ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const bodyResult = validate(CreateApiKeySchema, request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: bodyResult.errors,
        });
      }

      try {
        const { entity, rawKey } = await service.createApiKey(
          paramsResult.data.accountId,
          bodyResult.data,
        );
        return reply.status(201).send({
          ...formatApiKeyResponse(entity),
          key: rawKey,
        });
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * GET /developer/accounts/:accountId/keys
   * List API keys for the account.
   */
  fastify.get(
    `${prefix}/accounts/:accountId/keys`,
    async function listApiKeysHandler(
      request: FastifyRequest<{ Params: DeveloperAccountParams; Querystring: ApiKeyListQuery }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(DeveloperAccountParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid account ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const query = request.query as ApiKeyListQuery;
      const page = Number(query.page) || 1;
      const pageSize = Number(query.pageSize) || 20;

      const result = await service.listApiKeys(
        paramsResult.data.accountId,
        page,
        pageSize,
        query.status,
      );

      return reply.status(200).send({
        data: result.data.map(formatApiKeyResponse),
        meta: { page, pageSize, total: result.total, totalPages: Math.ceil(result.total / pageSize) },
      });
    },
  );

  /**
   * DELETE /developer/accounts/:accountId/keys/:keyId
   * Revoke an API key.
   */
  fastify.delete(
    `${prefix}/accounts/:accountId/keys/:keyId`,
    async function revokeApiKeyHandler(
      request: FastifyRequest<{ Params: DeveloperAccountParams & ApiKeyParams }>,
      reply: FastifyReply,
    ) {
      const params = request.params as DeveloperAccountParams & ApiKeyParams;
      const accountResult = validate(DeveloperAccountParamsSchema, { accountId: params.accountId });
      const keyResult = validate(ApiKeyParamsSchema, { keyId: params.keyId });

      if (!accountResult.success || !keyResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid parameters',
          statusCode: 400,
          errors: [...(accountResult.success ? [] : accountResult.errors), ...(keyResult.success ? [] : keyResult.errors)],
        });
      }

      try {
        const key = await service.revokeApiKey(params.accountId, params.keyId);
        return reply.status(200).send(formatApiKeyResponse(key));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * POST /developer/validate-key
   * Validate an API key and return its scopes.
   */
  fastify.post(
    `${prefix}/validate-key`,
    async function validateKeyHandler(
      request: FastifyRequest<{ Body: { key: string } }>,
      reply: FastifyReply,
    ) {
      const body = request.body as { key?: string };
      if (!body?.key || typeof body.key !== 'string') {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'API key is required',
          statusCode: 400,
        });
      }

      const key = await service.validateApiKey(body.key);
      if (!key) {
        return reply.status(401).send({
          code: 'INVALID_API_KEY',
          message: 'Invalid or expired API key',
          statusCode: 401,
        });
      }

      return reply.status(200).send({
        valid: true,
        accountId: key.accountId,
        scopes: key.scopes,
        keyPrefix: key.keyPrefix,
      });
    },
  );

  // ─── Webhook Routes ─────────────────────────────────────────────────────

  /**
   * POST /developer/accounts/:accountId/webhooks
   * Create a new webhook registration.
   */
  fastify.post(
    `${prefix}/accounts/:accountId/webhooks`,
    async function createWebhookHandler(
      request: FastifyRequest<{ Params: DeveloperAccountParams; Body: CreateWebhookInput }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(DeveloperAccountParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid account ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const bodyResult = validate(CreateWebhookSchema, request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: bodyResult.errors,
        });
      }

      try {
        const webhook = await service.createWebhook(paramsResult.data.accountId, bodyResult.data);
        return reply.status(201).send(formatWebhookResponse(webhook));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * GET /developer/accounts/:accountId/webhooks
   * List webhooks for the account.
   */
  fastify.get(
    `${prefix}/accounts/:accountId/webhooks`,
    async function listWebhooksHandler(
      request: FastifyRequest<{ Params: DeveloperAccountParams; Querystring: WebhookListQuery }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(DeveloperAccountParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid account ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const query = request.query as WebhookListQuery;
      const page = Number(query.page) || 1;
      const pageSize = Number(query.pageSize) || 20;

      const result = await service.listWebhooks(
        paramsResult.data.accountId,
        page,
        pageSize,
        query.active,
      );

      return reply.status(200).send({
        data: result.data.map(formatWebhookResponse),
        meta: { page, pageSize, total: result.total, totalPages: Math.ceil(result.total / pageSize) },
      });
    },
  );

  /**
   * GET /developer/accounts/:accountId/webhooks/:webhookId
   * Get a specific webhook.
   */
  fastify.get(
    `${prefix}/accounts/:accountId/webhooks/:webhookId`,
    async function getWebhookHandler(
      request: FastifyRequest<{ Params: DeveloperAccountParams & WebhookParams }>,
      reply: FastifyReply,
    ) {
      const params = request.params as DeveloperAccountParams & WebhookParams;

      try {
        const webhook = await service.getWebhook(params.accountId, params.webhookId);
        return reply.status(200).send(formatWebhookResponse(webhook));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * PATCH /developer/accounts/:accountId/webhooks/:webhookId
   * Update a webhook.
   */
  fastify.patch(
    `${prefix}/accounts/:accountId/webhooks/:webhookId`,
    async function updateWebhookHandler(
      request: FastifyRequest<{ Params: DeveloperAccountParams & WebhookParams; Body: UpdateWebhookInput }>,
      reply: FastifyReply,
    ) {
      const params = request.params as DeveloperAccountParams & WebhookParams;

      const bodyResult = validate(UpdateWebhookSchema, request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: bodyResult.errors,
        });
      }

      try {
        const webhook = await service.updateWebhook(params.accountId, params.webhookId, bodyResult.data);
        return reply.status(200).send(formatWebhookResponse(webhook));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * DELETE /developer/accounts/:accountId/webhooks/:webhookId
   * Delete a webhook.
   */
  fastify.delete(
    `${prefix}/accounts/:accountId/webhooks/:webhookId`,
    async function deleteWebhookHandler(
      request: FastifyRequest<{ Params: DeveloperAccountParams & WebhookParams }>,
      reply: FastifyReply,
    ) {
      const params = request.params as DeveloperAccountParams & WebhookParams;

      try {
        await service.deleteWebhook(params.accountId, params.webhookId);
        return reply.status(204).send();
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * GET /developer/accounts/:accountId/webhooks/:webhookId/deliveries
   * List delivery history for a webhook.
   */
  fastify.get(
    `${prefix}/accounts/:accountId/webhooks/:webhookId/deliveries`,
    async function listDeliveriesHandler(
      request: FastifyRequest<{ Params: DeveloperAccountParams & WebhookParams; Querystring: WebhookDeliveryQuery }>,
      reply: FastifyReply,
    ) {
      const params = request.params as DeveloperAccountParams & WebhookParams;
      const query = request.query as WebhookDeliveryQuery;
      const page = Number(query.page) || 1;
      const pageSize = Number(query.pageSize) || 20;

      // Verify webhook belongs to account
      try {
        await service.getWebhook(params.accountId, params.webhookId);
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }

      const result = await service.listDeliveries(params.webhookId, page, pageSize, query.status);

      return reply.status(200).send({
        data: result.data.map(formatDeliveryResponse),
        meta: { page, pageSize, total: result.total, totalPages: Math.ceil(result.total / pageSize) },
      });
    },
  );

  // ─── Sandbox Routes ─────────────────────────────────────────────────────

  /**
   * POST /developer/accounts/:accountId/sandboxes
   * Create a new sandbox tenant for testing.
   */
  fastify.post(
    `${prefix}/accounts/:accountId/sandboxes`,
    async function createSandboxHandler(
      request: FastifyRequest<{ Params: DeveloperAccountParams; Body: CreateSandboxInput }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(DeveloperAccountParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid account ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const bodyResult = validate(CreateSandboxSchema, request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: bodyResult.errors,
        });
      }

      try {
        const sandbox = await service.createSandbox(paramsResult.data.accountId, bodyResult.data);
        return reply.status(201).send(formatSandboxResponse(sandbox));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * GET /developer/accounts/:accountId/sandboxes
   * List sandboxes for the account.
   */
  fastify.get(
    `${prefix}/accounts/:accountId/sandboxes`,
    async function listSandboxesHandler(
      request: FastifyRequest<{ Params: DeveloperAccountParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(DeveloperAccountParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid account ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      try {
        const sandboxes = await service.listSandboxes(paramsResult.data.accountId);
        return reply.status(200).send({
          data: sandboxes.map(formatSandboxResponse),
        });
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * DELETE /developer/accounts/:accountId/sandboxes/:sandboxId
   * Destroy a sandbox tenant.
   */
  fastify.delete(
    `${prefix}/accounts/:accountId/sandboxes/:sandboxId`,
    async function destroySandboxHandler(
      request: FastifyRequest<{ Params: DeveloperAccountParams & SandboxParams }>,
      reply: FastifyReply,
    ) {
      const params = request.params as DeveloperAccountParams & SandboxParams;

      try {
        const sandbox = await service.destroySandbox(params.accountId, params.sandboxId);
        return reply.status(200).send(formatSandboxResponse(sandbox));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  // ─── Plugin Submission Routes ───────────────────────────────────────────

  /**
   * POST /developer/accounts/:accountId/submissions
   * Submit a plugin for review.
   */
  fastify.post(
    `${prefix}/accounts/:accountId/submissions`,
    async function submitPluginHandler(
      request: FastifyRequest<{ Params: DeveloperAccountParams; Body: SubmitPluginInput }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(DeveloperAccountParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid account ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const bodyResult = validate(SubmitPluginSchema, request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: bodyResult.errors,
        });
      }

      try {
        const submission = await service.submitPlugin(paramsResult.data.accountId, bodyResult.data);
        return reply.status(201).send(formatSubmissionResponse(submission));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * GET /developer/accounts/:accountId/submissions
   * List plugin submissions for the account.
   */
  fastify.get(
    `${prefix}/accounts/:accountId/submissions`,
    async function listSubmissionsHandler(
      request: FastifyRequest<{ Params: DeveloperAccountParams; Querystring: { page?: number; pageSize?: number; status?: string } }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(DeveloperAccountParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid account ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const query = request.query as { page?: number; pageSize?: number; status?: string };
      const page = Number(query.page) || 1;
      const pageSize = Number(query.pageSize) || 20;

      const result = await service.listSubmissions(
        paramsResult.data.accountId,
        page,
        pageSize,
        query.status as any,
      );

      return reply.status(200).send({
        data: result.data.map(formatSubmissionResponse),
        meta: { page, pageSize, total: result.total, totalPages: Math.ceil(result.total / pageSize) },
      });
    },
  );

  /**
   * GET /developer/submissions/:submissionId
   * Get a specific plugin submission.
   */
  fastify.get(
    `${prefix}/submissions/:submissionId`,
    async function getSubmissionHandler(
      request: FastifyRequest<{ Params: PluginSubmissionParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(PluginSubmissionParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid submission ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      try {
        const submission = await service.getSubmission(paramsResult.data.submissionId);
        return reply.status(200).send(formatSubmissionResponse(submission));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * POST /developer/submissions/:submissionId/review
   * Review a plugin submission (approve/reject).
   */
  fastify.post(
    `${prefix}/submissions/:submissionId/review`,
    async function reviewPluginHandler(
      request: FastifyRequest<{ Params: PluginSubmissionParams; Body: ReviewPluginInput }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(PluginSubmissionParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid submission ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const bodyResult = validate(ReviewPluginSchema, request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: bodyResult.errors,
        });
      }

      try {
        // In production, reviewerId would come from authenticated user context
        const reviewerId = 'system-reviewer';
        const submission = await service.reviewPlugin(
          paramsResult.data.submissionId,
          reviewerId,
          bodyResult.data,
        );
        return reply.status(200).send(formatSubmissionResponse(submission));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * POST /developer/submissions/:submissionId/publish
   * Publish an approved plugin to the marketplace.
   */
  fastify.post(
    `${prefix}/submissions/:submissionId/publish`,
    async function publishPluginHandler(
      request: FastifyRequest<{ Params: PluginSubmissionParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(PluginSubmissionParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid submission ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      try {
        const listing = await service.publishPlugin(paramsResult.data.submissionId);
        return reply.status(201).send(formatMarketplaceResponse(listing));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  // ─── Marketplace Routes ─────────────────────────────────────────────────

  /**
   * GET /developer/marketplace
   * Search and list plugins in the marketplace.
   */
  fastify.get(
    `${prefix}/marketplace`,
    async function searchMarketplaceHandler(
      request: FastifyRequest<{ Querystring: MarketplaceSearchQuery }>,
      reply: FastifyReply,
    ) {
      const query = request.query as MarketplaceSearchQuery;
      const page = Number(query.page) || 1;
      const pageSize = Number(query.pageSize) || 20;
      const tags = query.tags ? query.tags.split(',').map((t) => t.trim()) : undefined;

      const result = await service.searchMarketplace(
        page,
        pageSize,
        query.search,
        query.category,
        query.sortBy,
        query.sortOrder,
        tags,
      );

      return reply.status(200).send({
        data: result.data.map(formatMarketplaceResponse),
        meta: { page, pageSize, total: result.total, totalPages: Math.ceil(result.total / pageSize) },
      });
    },
  );

  /**
   * GET /developer/marketplace/:pluginName
   * Get a specific marketplace listing.
   */
  fastify.get(
    `${prefix}/marketplace/:pluginName`,
    async function getMarketplaceListingHandler(
      request: FastifyRequest<{ Params: MarketplacePluginParams }>,
      reply: FastifyReply,
    ) {
      const params = request.params as MarketplacePluginParams;

      try {
        const listing = await service.getMarketplaceListing(params.pluginName);
        return reply.status(200).send(formatMarketplaceResponse(listing));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * POST /developer/marketplace/:pluginName/ratings
   * Rate a plugin in the marketplace.
   */
  fastify.post(
    `${prefix}/marketplace/:pluginName/ratings`,
    async function ratePluginHandler(
      request: FastifyRequest<{ Params: MarketplacePluginParams; Body: PluginRatingInput }>,
      reply: FastifyReply,
    ) {
      const params = request.params as MarketplacePluginParams;

      const bodyResult = validate(PluginRatingSchema, request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: bodyResult.errors,
        });
      }

      try {
        // In production, accountId would come from authenticated user context
        const accountId = (request.headers['x-account-id'] as string) || 'anonymous';
        const rating = await service.ratePlugin(accountId, params.pluginName, bodyResult.data);
        return reply.status(201).send({
          id: rating.id,
          pluginName: rating.pluginName,
          rating: rating.rating,
          review: rating.review,
          createdAt: rating.createdAt.toISOString(),
        });
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  // ─── Documentation Routes ───────────────────────────────────────────────

  /**
   * POST /developer/docs
   * Create a documentation page.
   */
  fastify.post(
    `${prefix}/docs`,
    async function createDocPageHandler(
      request: FastifyRequest<{ Body: CreateDocPageInput }>,
      reply: FastifyReply,
    ) {
      const bodyResult = validate(CreateDocPageSchema, request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: bodyResult.errors,
        });
      }

      try {
        const page = await service.createDocPage(bodyResult.data);
        return reply.status(201).send(formatDocPageResponse(page));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * GET /developer/docs
   * List documentation pages.
   */
  fastify.get(
    `${prefix}/docs`,
    async function listDocPagesHandler(
      request: FastifyRequest<{ Querystring: DocListQuery }>,
      reply: FastifyReply,
    ) {
      const query = request.query as DocListQuery;
      const pages = await service.listDocPages(query.category, query.published);
      return reply.status(200).send({
        data: pages.map(formatDocPageResponse),
      });
    },
  );

  /**
   * GET /developer/docs/:slug
   * Get a documentation page by slug.
   */
  fastify.get(
    `${prefix}/docs/:slug`,
    async function getDocPageHandler(
      request: FastifyRequest<{ Params: DocPageParams }>,
      reply: FastifyReply,
    ) {
      const params = request.params as DocPageParams;

      try {
        const page = await service.getDocPage(params.slug);
        return reply.status(200).send(formatDocPageResponse(page));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * PATCH /developer/docs/:slug
   * Update a documentation page.
   */
  fastify.patch(
    `${prefix}/docs/:slug`,
    async function updateDocPageHandler(
      request: FastifyRequest<{ Params: DocPageParams; Body: UpdateDocPageInput }>,
      reply: FastifyReply,
    ) {
      const params = request.params as DocPageParams;

      const bodyResult = validate(UpdateDocPageSchema, request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: bodyResult.errors,
        });
      }

      try {
        const page = await service.updateDocPage(params.slug, bodyResult.data);
        return reply.status(200).send(formatDocPageResponse(page));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * DELETE /developer/docs/:slug
   * Delete a documentation page.
   */
  fastify.delete(
    `${prefix}/docs/:slug`,
    async function deleteDocPageHandler(
      request: FastifyRequest<{ Params: DocPageParams }>,
      reply: FastifyReply,
    ) {
      const params = request.params as DocPageParams;

      try {
        await service.deleteDocPage(params.slug);
        return reply.status(204).send();
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  // ─── Analytics Routes ───────────────────────────────────────────────────

  /**
   * POST /developer/analytics/events
   * Record an analytics event.
   */
  fastify.post(
    `${prefix}/analytics/events`,
    async function recordAnalyticsEventHandler(
      request: FastifyRequest<{ Body: RecordAnalyticsEventInput }>,
      reply: FastifyReply,
    ) {
      const bodyResult = validate(RecordAnalyticsEventSchema, request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: bodyResult.errors,
        });
      }

      try {
        const event = await service.recordAnalyticsEvent(bodyResult.data);
        return reply.status(201).send({
          id: event.id,
          pluginName: event.pluginName,
          eventType: event.eventType,
          createdAt: event.createdAt.toISOString(),
        });
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * GET /developer/analytics/:pluginName
   * Get analytics summary for a plugin.
   */
  fastify.get(
    `${prefix}/analytics/:pluginName`,
    async function getPluginAnalyticsHandler(
      request: FastifyRequest<{ Params: MarketplacePluginParams; Querystring: AnalyticsQuery }>,
      reply: FastifyReply,
    ) {
      const params = request.params as MarketplacePluginParams;
      const query = request.query as AnalyticsQuery;

      const summary = await service.getPluginAnalytics(params.pluginName);
      const startDate = query.startDate ? new Date(query.startDate) : undefined;
      const endDate = query.endDate ? new Date(query.endDate) : undefined;
      const granularity = query.granularity || 'day';

      const timeSeries = await service.getPluginAnalyticsTimeSeries(
        params.pluginName,
        startDate,
        endDate,
        granularity,
      );

      return reply.status(200).send({
        pluginName: summary.pluginName,
        totalInstalls: summary.totalInstalls,
        activeInstalls: summary.activeInstalls,
        totalApiCalls: summary.totalApiCalls,
        totalErrors: summary.totalErrors,
        averageRating: summary.averageRating,
        ratingCount: summary.ratingCount,
        timeSeries,
      });
    },
  );
}
