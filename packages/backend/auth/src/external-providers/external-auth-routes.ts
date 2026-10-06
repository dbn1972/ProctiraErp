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
import { randomBytes, timingSafeEqual } from 'node:crypto';

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

import { MemoryWebTicketStore, type WebTicketStore } from '../keycloak/routes.js';

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
  /**
   * PRC-M589: one-time ticket store for redirect delivery (tokens never go in
   * the URL). Use the Redis store for multi-replica deployments.
   */
  ticketStore?: WebTicketStore;
  /** PRC-M589: mark the state cookie Secure + SameSite=None (default true). */
  secureCookies?: boolean;
}

/** PRC-M589: browser-bound state cookie (also carries SAML RelayState). */
const STATE_COOKIE = 'ext_auth_state';
const STATE_COOKIE_TTL_SECONDS = 600;
const TICKET_TTL_SECONDS = 60;

function readCookie(request: FastifyRequest, name: string): string | undefined {
  const header = request.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0 && part.slice(0, idx).trim() === name) return part.slice(idx + 1).trim();
  }
  return undefined;
}

function stateCookie(value: string, path: string, secure: boolean, maxAge: number): string {
  // SAML HTTP-POST callbacks are cross-site POSTs: SameSite=None (+Secure) is
  // required for the cookie to arrive; plain-http dev falls back to Lax.
  return [
    `${STATE_COOKIE}=${value}`,
    `Path=${path}`,
    `Max-Age=${maxAge}`,
    'HttpOnly',
    ...(secure ? ['Secure', 'SameSite=None'] : ['SameSite=Lax']),
  ].join('; ');
}

function stateMatchesBrowser(request: FastifyRequest, state: string | undefined): boolean {
  const cookie = readCookie(request, STATE_COOKIE);
  if (!cookie || !state) return false;
  const a = Buffer.from(cookie);
  const b = Buffer.from(state);
  return a.length === b.length && timingSafeEqual(a, b);
}

const STATE_MISMATCH = {
  code: 'EXTERNAL_AUTH_STATE_MISMATCH',
  message: 'Login state does not match this browser',
  statusCode: 400,
} as const;

/**
 * Register external authentication routes on a Fastify instance.
 */
export async function registerExternalAuthRoutes(
  fastify: FastifyInstance,
  options: ExternalAuthRoutesOptions,
): Promise<void> {
  const { handler, prefix = '/auth/external', successRedirectUrl, errorRedirectUrl } = options;
  const ticketStore = options.ticketStore ?? new MemoryWebTicketStore();
  const secureCookies = options.secureCookies ?? true;
  const deliver = (reply: FastifyReply, result: SuccessResult) =>
    sendSuccess(reply, successRedirectUrl, result, ticketStore);

  /**
   * GET /auth/external/ticket?ticket=... (PRC-M589)
   * One-time redemption of the tokens issued by a redirect-mode callback.
   */
  fastify.get(
    `${prefix}/ticket`,
    async (request: FastifyRequest<{ Querystring: { ticket?: string } }>, reply: FastifyReply) => {
      const ticket = request.query.ticket;
      const raw = ticket && ticket.length <= 128 ? await ticketStore.take(ticket) : null;
      if (!raw) {
        return reply.status(401).send({
          code: 'EXTERNAL_AUTH_TICKET_INVALID',
          message: 'Login ticket is invalid or expired',
          statusCode: 401,
        });
      }
      return reply.status(200).send(JSON.parse(raw) as unknown);
    },
  );

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
        const { redirectUrl, state } = await handler.initiateAuth(providerId, tenantId);
        reply.header(
          'set-cookie',
          stateCookie(state, prefix, secureCookies, STATE_COOKIE_TTL_SECONDS),
        );
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

      // PRC-M589: the state must come back to the browser that started login.
      if (!stateMatchesBrowser(request, state)) {
        return sendError(reply, errorRedirectUrl, STATE_MISMATCH);
      }
      reply.header('set-cookie', stateCookie('', prefix, secureCookies, 0));
      try {
        const result = await handler.handleCallback(
          providerId,
          { code, state, error, errorDescription: error_description },
          tenantId,
          { userAgent: request.headers['user-agent'], ipAddress: request.ip },
        );

        return deliver(reply, result);
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

      if (!stateMatchesBrowser(request, relayState)) {
        return sendError(reply, errorRedirectUrl, STATE_MISMATCH);
      }
      reply.header('set-cookie', stateCookie('', prefix, secureCookies, 0));
      try {
        const result = await handler.handleCallback(
          providerId,
          { samlResponse, relayState },
          tenantId,
          { userAgent: request.headers['user-agent'], ipAddress: request.ip },
        );

        return deliver(reply, result);
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
type SuccessResult = {
  tokens: { accessToken: string; refreshToken: string; expiresIn: number; tokenType: string };
  session: { id: string; expiresAt: string };
  user: unknown;
  isNewUser: boolean;
  providerId: string;
};

async function sendSuccess(
  reply: FastifyReply,
  redirectUrl: string | undefined,
  result: SuccessResult,
  ticketStore: WebTicketStore,
): Promise<FastifyReply> {
  const body = {
    tokens: result.tokens,
    session: result.session,
    user: result.user,
    isNewUser: result.isNewUser,
    providerId: result.providerId,
  };
  if (redirectUrl) {
    // PRC-M589: tokens never travel in the URL (history, logs, Referer); the
    // client redeems a short-lived one-time ticket at GET {prefix}/ticket.
    const ticket = randomBytes(32).toString('base64url');
    await ticketStore.put(ticket, JSON.stringify(body), TICKET_TTL_SECONDS);
    const params = new URLSearchParams({
      ticket,
      provider: result.providerId,
      is_new_user: String(result.isNewUser),
    });
    return reply.redirect(`${redirectUrl}?${params.toString()}`, 302);
  }
  return reply.status(200).send(body);
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
