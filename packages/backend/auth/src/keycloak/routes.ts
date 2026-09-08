import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

import {
  identityInputFromClaims,
  linkKeycloakIdentity,
  type KeycloakIdentityStore,
  type LinkedKeycloakUser,
} from './identity.js';
import { keycloakRoleCatalog } from './roles.js';
import { decodeJwt, type KeycloakAuthConfig } from './verify.js';

export type KeycloakRouteConfig = KeycloakAuthConfig & {
  clientSecret?: string;
  redirectUri: string;
  webOrigin?: string;
  identityStore?: KeycloakIdentityStore;
};

type IssuedTokens = {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  expiresIn?: number;
  tokenType: string;
};

const webTickets = new Map<string, { tokens: IssuedTokens; expiresAt: number }>();
const WEB_TICKET_TTL_MS = 60_000;

function pruneTickets(now = Date.now()): void {
  for (const [id, ticket] of webTickets) {
    if (ticket.expiresAt <= now) webTickets.delete(id);
  }
}

function issueWebTicket(tokens: IssuedTokens): string {
  pruneTickets();
  const id = crypto.randomUUID();
  webTickets.set(id, { tokens, expiresAt: Date.now() + WEB_TICKET_TTL_MS });
  return id;
}

function consumeWebTicket(id: string): IssuedTokens | null {
  pruneTickets();
  const ticket = webTickets.get(id);
  if (!ticket) return null;
  webTickets.delete(id);
  return ticket.tokens;
}

function webReturnTo(state: string | undefined): string | null {
  if (!state?.startsWith('web:')) return null;
  const path = state.slice(4);
  return path.startsWith('/') ? path : `/${path}`;
}

function authorizeUrl(config: KeycloakRouteConfig, state: string): string {
  const url = new URL(`${config.issuer.replace(/\/$/, '')}/protocol/openid-connect/auth`);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile roles');
  url.searchParams.set('state', state);
  url.searchParams.set('kc_locale', 'en');
  return url.toString();
}

function logoutUrl(config: KeycloakRouteConfig, redirect?: string): string {
  const url = new URL(`${config.issuer.replace(/\/$/, '')}/protocol/openid-connect/logout`);
  url.searchParams.set('client_id', config.clientId);
  if (redirect) url.searchParams.set('post_logout_redirect_uri', redirect);
  return url.toString();
}

export async function registerKeycloakAuthRoutes(
  fastify: FastifyInstance,
  config: KeycloakRouteConfig,
  prefix = '/api/v1/auth',
): Promise<void> {
  fastify.get(
    `${prefix}/login`,
    async (
      request: FastifyRequest<{
        Querystring: { state?: string };
      }>,
      reply: FastifyReply,
    ) => {
      const state = request.query.state ?? crypto.randomUUID();
      return reply.redirect(authorizeUrl(config, state), 302);
    },
  );

  fastify.get(
    `${prefix}/callback`,
    async (
      request: FastifyRequest<{
        Querystring: { code?: string; state?: string; error?: string; error_description?: string };
      }>,
      reply: FastifyReply,
    ) => {
      const { code, error, error_description } = request.query;
      if (error) {
        return reply.status(401).send({
          code: 'KEYCLOAK_AUTH_ERROR',
          message: error_description ?? error,
          statusCode: 401,
        });
      }
      if (!code) {
        return reply.status(400).send({
          code: 'KEYCLOAK_MISSING_CODE',
          message: 'Authorization code is required',
          statusCode: 400,
        });
      }

      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: config.clientId,
        redirect_uri: config.redirectUri,
      });
      if (config.clientSecret) body.set('client_secret', config.clientSecret);

      const tokenResponse = await fetch(
        `${config.issuer.replace(/\/$/, '')}/protocol/openid-connect/token`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body,
        },
      );

      if (!tokenResponse.ok) {
        return reply.status(401).send({
          code: 'KEYCLOAK_TOKEN_EXCHANGE_FAILED',
          message: 'Failed to exchange Keycloak authorization code',
          statusCode: 401,
        });
      }

      const tokens = (await tokenResponse.json()) as {
        access_token: string;
        refresh_token?: string;
        id_token?: string;
        expires_in?: number;
        token_type?: string;
      };

      let user: LinkedKeycloakUser | undefined;
      if (config.identityStore) {
        try {
          user = await linkKeycloakIdentity(
            identityInputFromClaims(decodeJwt(tokens.access_token).payload, config.realm),
            config.identityStore,
          );
        } catch {
          // Login still succeeds; /me will retry the tenant projection.
        }
      }

      const issued: IssuedTokens = {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        idToken: tokens.id_token,
        expiresIn: tokens.expires_in,
        tokenType: tokens.token_type ?? 'Bearer',
      };

      const returnTo = webReturnTo(request.query.state);
      if (returnTo && config.webOrigin) {
        const ticket = issueWebTicket(issued);
        const next = new URL('/api/auth/callback', config.webOrigin);
        next.searchParams.set('ticket', ticket);
        next.searchParams.set('returnTo', returnTo);
        return reply.redirect(next.toString(), 302);
      }

      return reply.status(200).send({
        provider: 'keycloak',
        realm: config.realm,
        ...issued,
        user,
      });
    },
  );

  /**
   * Password login for the Proctira web UI.
   * Keycloak remains the password authority; the browser never sees Keycloak pages.
   */
  fastify.post(
    `${prefix}/password`,
    async (
      request: FastifyRequest<{
        Body: { username?: string; password?: string; email?: string };
      }>,
      reply: FastifyReply,
    ) => {
      const username = (request.body?.username ?? request.body?.email ?? '').trim();
      const password = request.body?.password ?? '';
      if (!username || !password) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Username and password are required',
          statusCode: 400,
        });
      }

      const body = new URLSearchParams({
        grant_type: 'password',
        client_id: config.clientId,
        username,
        password,
        scope: 'openid email profile roles',
      });
      if (config.clientSecret) body.set('client_secret', config.clientSecret);

      const tokenResponse = await fetch(
        `${config.issuer.replace(/\/$/, '')}/protocol/openid-connect/token`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body,
        },
      );

      if (!tokenResponse.ok) {
        return reply.status(401).send({
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid email or password',
          statusCode: 401,
        });
      }

      const tokens = (await tokenResponse.json()) as {
        access_token: string;
        refresh_token?: string;
        id_token?: string;
        expires_in?: number;
        token_type?: string;
      };

      let user: LinkedKeycloakUser | undefined;
      if (config.identityStore) {
        try {
          user = await linkKeycloakIdentity(
            identityInputFromClaims(decodeJwt(tokens.access_token).payload, config.realm),
            config.identityStore,
          );
        } catch {
          // Login still succeeds; /me will retry the tenant projection.
        }
      }

      return reply.status(200).send({
        provider: 'keycloak',
        realm: config.realm,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        idToken: tokens.id_token,
        expiresIn: tokens.expires_in,
        tokenType: tokens.token_type ?? 'Bearer',
        user,
      });
    },
  );

  fastify.get(
    `${prefix}/ticket`,
    async (
      request: FastifyRequest<{
        Querystring: { ticket?: string };
      }>,
      reply: FastifyReply,
    ) => {
      const ticket = request.query.ticket;
      if (!ticket) {
        return reply.status(400).send({
          code: 'KEYCLOAK_MISSING_TICKET',
          message: 'Login ticket is required',
          statusCode: 400,
        });
      }
      const tokens = consumeWebTicket(ticket);
      if (!tokens) {
        return reply.status(401).send({
          code: 'KEYCLOAK_TICKET_INVALID',
          message: 'Login ticket is invalid or expired',
          statusCode: 401,
        });
      }
      return reply.status(200).send({
        provider: 'keycloak',
        realm: config.realm,
        ...tokens,
      });
    },
  );

  fastify.post(
    `${prefix}/refresh`,
    async (
      request: FastifyRequest<{
        Body: { refreshToken?: string };
      }>,
      reply: FastifyReply,
    ) => {
      const refreshToken = request.body?.refreshToken;
      if (!refreshToken) {
        return reply.status(400).send({
          code: 'KEYCLOAK_MISSING_REFRESH',
          message: 'Refresh token is required',
          statusCode: 400,
        });
      }
      const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: config.clientId,
      });
      if (config.clientSecret) body.set('client_secret', config.clientSecret);
      const tokenResponse = await fetch(
        `${config.issuer.replace(/\/$/, '')}/protocol/openid-connect/token`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body,
        },
      );
      if (!tokenResponse.ok) {
        return reply.status(401).send({
          code: 'KEYCLOAK_REFRESH_FAILED',
          message: 'Failed to refresh Keycloak session',
          statusCode: 401,
        });
      }
      const tokens = (await tokenResponse.json()) as {
        access_token: string;
        refresh_token?: string;
        expires_in?: number;
      };
      return reply.status(200).send({
        provider: 'keycloak',
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresIn: tokens.expires_in,
      });
    },
  );

  fastify.get(
    `${prefix}/logout`,
    async (
      request: FastifyRequest<{
        Querystring: { redirect?: string };
      }>,
      reply: FastifyReply,
    ) => {
      return reply.redirect(logoutUrl(config, request.query.redirect ?? config.webOrigin), 302);
    },
  );

  fastify.get(`${prefix}/me`, async (request: FastifyRequest, reply: FastifyReply) => {
    await fastify.authenticate(request, reply);
    if (reply.sent) return;
    return reply.status(200).send({
      provider: 'keycloak',
      realm: config.realm,
      user: request.user,
    });
  });

  /**
   * GET /auth/tenants — personal tenant directory for the signed-in user.
   * Claim-based on main (no Prisma User model). Optional identityStore may
   * still project Keycloak subjects onto an in-memory membership map.
   */
  fastify.get(`${prefix}/tenants`, async (request: FastifyRequest, reply: FastifyReply) => {
    await fastify.authenticate(request, reply);
    if (reply.sent) return;

    const user = request.user as {
      email?: string;
      tenantId?: string;
      preferred_username?: string;
    };
    const claimTenantId = user.tenantId;
    if (claimTenantId) {
      return reply.status(200).send({
        data: [
          {
            id: claimTenantId,
            name: claimTenantId,
            slug: claimTenantId,
            status: 'active',
          },
        ],
      });
    }
    return reply.status(200).send({ data: [] });
  });

  fastify.get(`${prefix}/roles`, async (_request, reply) => {
    return reply.status(200).send({
      provider: 'keycloak',
      realm: config.realm,
      roles: keycloakRoleCatalog(),
    });
  });
}
