/**
 * External Auth Routes
 *
 * Fastify routes for external identity provider authentication:
 *
 * GET  /auth/external/providers          - List available external providers
 * GET  /auth/external/:providerId/login  - Initiate external auth (redirect to provider)
 * GET  /auth/external/:providerId/callback - OAuth2/OIDC callback handler
 * POST /auth/external/:providerId/callback - SAML callback handler (POST binding)
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ExternalAuthHandler } from './external-auth-handler.js';
import { ExternalAuthError } from './types.js';

/**
 * Options for registering external auth routes.
 */
export interface ExternalAuthRoutesOptions {
  /** The external auth handler instance */
  handler: ExternalAuthHandler;
  /** Route prefix (default: '/auth/external') */
  prefix?: string;
  /** URL to redirect to after successful auth (for browser-based flows) */
  successRedirectUrl?: string;
  /** URL to redirect to on auth failure */
  errorRedirectUrl?: string;
}

/**
 * Register external authentication routes on a Fastify instance.
 */
export async function registerExternalAuthRoutes(
  fastify: FastifyInstance,
  options: ExternalAuthRoutesOptions,
): Promise<void> {
  const { handler, prefix = '/auth/external', successRedirectUrl, errorRedirectUrl } = options;

  /**
   * GET /auth/external/providers
   * List all available external identity providers.
   */
  fastify.get(
    `${prefix}/providers`,
    async function listProvidersHandler(_request: FastifyRequest, reply: FastifyReply) {
      const providers = handler.listProviders();
      return reply.status(200).send({ providers });
    },
  );

  /**
   * GET /auth/external/:providerId/login
   * Initiate authentication with an external provider.
   * Redirects the user to the provider's login page.
   */
  fastify.get(
    `${prefix}/:providerId/login`,
    async function initiateAuthHandler(
      request: FastifyRequest<{ Params: { providerId: string } }>,
      reply: FastifyReply,
    ) {
      const { providerId } = request.params;
      const tenantId = (request as FastifyRequest & { tenantId?: string }).tenantId;

      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required for external authentication',
          statusCode: 400,
        });
      }

      try {
        const { redirectUrl } = await handler.initiateAuth(providerId, tenantId);
        return reply.redirect(redirectUrl, 302);
      } catch (error: unknown) {
        if (error instanceof ExternalAuthError) {
          return reply.status(error.statusCode).send({
            code: error.code,
            message: error.message,
            statusCode: error.statusCode,
            providerId: error.providerId,
          });
        }
        throw error;
      }
    },
  );

  /**
   * GET /auth/external/:providerId/callback
   * Handle OAuth2/OIDC callback (authorization code flow).
   */
  fastify.get(
    `${prefix}/:providerId/callback`,
    async function oauthCallbackHandler(
      request: FastifyRequest<{
        Params: { providerId: string };
        Querystring: { code?: string; state?: string; error?: string; error_description?: string };
      }>,
      reply: FastifyReply,
    ) {
      const { providerId } = request.params;
      const { code, state, error, error_description } = request.query;
      const tenantId = (request as FastifyRequest & { tenantId?: string }).tenantId;

      if (!tenantId) {
        return sendError(reply, errorRedirectUrl, {
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      try {
        const result = await handler.handleCallback(
          providerId,
          { code, state, error, errorDescription: error_description },
          tenantId,
          { userAgent: request.headers['user-agent'], ipAddress: request.ip },
        );

        return sendSuccess(reply, successRedirectUrl, result);
      } catch (error: unknown) {
        if (error instanceof ExternalAuthError) {
          return sendError(reply, errorRedirectUrl, {
            code: error.code,
            message: error.message,
            statusCode: error.statusCode,
            providerId: error.providerId,
          });
        }
        throw error;
      }
    },
  );

  /**
   * POST /auth/external/:providerId/callback
   * Handle SAML callback (HTTP-POST binding).
   */
  fastify.post(
    `${prefix}/:providerId/callback`,
    async function samlCallbackHandler(
      request: FastifyRequest<{
        Params: { providerId: string };
        Body: { SAMLResponse?: string; RelayState?: string };
      }>,
      reply: FastifyReply,
    ) {
      const { providerId } = request.params;
      const body = request.body as Record<string, string | undefined>;
      const samlResponse = body['SAMLResponse'];
      const relayState = body['RelayState'];
      const tenantId = (request as FastifyRequest & { tenantId?: string }).tenantId;

      if (!tenantId) {
        return sendError(reply, errorRedirectUrl, {
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      try {
        const result = await handler.handleCallback(
          providerId,
          { samlResponse, relayState },
          tenantId,
          { userAgent: request.headers['user-agent'], ipAddress: request.ip },
        );

        return sendSuccess(reply, successRedirectUrl, result);
      } catch (error: unknown) {
        if (error instanceof ExternalAuthError) {
          return sendError(reply, errorRedirectUrl, {
            code: error.code,
            message: error.message,
            statusCode: error.statusCode,
            providerId: error.providerId,
          });
        }
        throw error;
      }
    },
  );
}

/**
 * Send a successful auth response.
 * If a redirect URL is configured, redirects with tokens in query params.
 * Otherwise, returns JSON response.
 */
function sendSuccess(
  reply: FastifyReply,
  redirectUrl: string | undefined,
  result: {
    tokens: { accessToken: string; refreshToken: string; expiresIn: number; tokenType: string };
    session: { id: string; expiresAt: string };
    user: unknown;
    isNewUser: boolean;
    providerId: string;
  },
): FastifyReply {
  if (redirectUrl) {
    const params = new URLSearchParams({
      access_token: result.tokens.accessToken,
      refresh_token: result.tokens.refreshToken,
      expires_in: String(result.tokens.expiresIn),
      provider: result.providerId,
      is_new_user: String(result.isNewUser),
    });
    return reply.redirect(`${redirectUrl}?${params.toString()}`, 302);
  }

  return reply.status(200).send({
    tokens: result.tokens,
    session: result.session,
    user: result.user,
    isNewUser: result.isNewUser,
    providerId: result.providerId,
  });
}

/**
 * Send an error response.
 * If a redirect URL is configured, redirects with error in query params.
 * Otherwise, returns JSON error response.
 */
function sendError(
  reply: FastifyReply,
  redirectUrl: string | undefined,
  error: { code: string; message: string; statusCode: number; providerId?: string },
): FastifyReply {
  if (redirectUrl) {
    const params = new URLSearchParams({
      error: error.code,
      error_description: error.message,
      ...(error.providerId ? { provider: error.providerId } : {}),
    });
    return reply.redirect(`${redirectUrl}?${params.toString()}`, 302);
  }

  return reply.status(error.statusCode).send(error);
}
