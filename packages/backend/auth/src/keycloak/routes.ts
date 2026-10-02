import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

import {
  defaultAccessTokenRevocationTtlSeconds,
  revokeAccessTokenIdentifiers,
  type AccessTokenRevocationStore,
} from '../access-token-revocation.js';
import { resolveTenantDirectory, type TenantDirectoryReader } from '../tenant-directory.js';

import {
  KeycloakIdentityError,
  identityInputFromClaims,
  linkKeycloakIdentity,
  type KeycloakIdentityStore,
  type LinkedKeycloakUser,
} from './identity.js';
import { PasswordLoginThrottle, type PasswordThrottleOptions } from './password-throttle.js';
import { keycloakRoleCatalog } from './roles.js';
import {
  KeycloakJwksClient,
  decodeJwt,
  verifyKeycloakAccessToken,
  type KeycloakAuthConfig,
} from './verify.js';

export type KeycloakRouteConfig = KeycloakAuthConfig & {
  clientSecret?: string;
  redirectUri: string;
  webOrigin?: string;
  identityStore?: KeycloakIdentityStore;
  /**
   * Access-token jti/sid denylist (W1-SEC-09).
   * Prefer the shared store decorated by keycloakAuthPlugin; this override
   * exists for tests and explicit DI.
   */
  revocationStore?: AccessTokenRevocationStore;
  /**
   * Per-account + per-IP failed-attempt limiter for POST /password (PRC-H043).
   * Pass options to tune, or a prebuilt instance to share/inspect in tests.
   */
  passwordThrottle?: PasswordLoginThrottle | PasswordThrottleOptions;
  /** Tenant repository used by GET /tenants for real name/slug/status (PRC-L084). */
  tenantDirectory?: TenantDirectoryReader;
  /** Upper bound for logout denylist entries in seconds (PRC-L282). Default 3600. */
  maxRevocationTtlSeconds?: number;
  /** JWKS client used to verify tokens presented at logout (tests/DI). */
  jwksClient?: KeycloakJwksClient;
};

const DEFAULT_MAX_REVOCATION_TTL_SECONDS = 3600;
const MAX_REVOCATION_ID_LENGTH = 256;

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

function logoutUrl(config: KeycloakRouteConfig, redirect?: string, idTokenHint?: string): string {
  const url = new URL(`${config.issuer.replace(/\/$/, '')}/protocol/openid-connect/logout`);
  url.searchParams.set('client_id', config.clientId);
  if (redirect) url.searchParams.set('post_logout_redirect_uri', redirect);
  if (idTokenHint) url.searchParams.set('id_token_hint', idTokenHint);
  return url.toString();
}

function readBearer(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) return undefined;
  return header.slice('Bearer '.length).trim() || undefined;
}

function readHeaderOrQuery(
  request: FastifyRequest<{
    Querystring: Record<string, string | undefined>;
  }>,
  headerName: string,
  queryName: string,
): string | undefined {
  const header = request.headers[headerName];
  if (typeof header === 'string' && header.trim()) return header.trim();
  const query = request.query?.[queryName];
  if (typeof query === 'string' && query.trim()) return query.trim();
  return undefined;
}

type RevocationClaims = { jti?: string; sessionId?: string; ttlSeconds?: number };

function boundedId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= MAX_REVOCATION_ID_LENGTH ? trimmed : undefined;
}

function revocationClaimsFromPayload(payload: {
  jti?: unknown;
  sid?: unknown;
  exp?: unknown;
}): RevocationClaims | null {
  const jti = boundedId(payload.jti);
  const sessionId = boundedId(payload.sid) ?? jti;
  const now = Math.floor(Date.now() / 1000);
  const ttlSeconds =
    typeof payload.exp === 'number' && payload.exp > now ? payload.exp - now : undefined;
  if (!jti && !sessionId) return null;
  return { jti, sessionId, ttlSeconds };
}

/**
 * W1-SEC-09 / PRC-L282: denylist presented tokens before redirecting to the IdP
 * end-session endpoint. The endpoint is unauthenticated, so the access token's
 * RS256 signature, issuer and expiry are verified first; forged/unsigned tokens
 * never create denylist entries. The refresh token (realm-HMAC, not verifiable
 * here) only contributes its jti when it belongs to the verified session. TTLs
 * are capped so callers cannot pin arbitrarily long Redis keys.
 */
async function revokePresentedTokensBeforeIdpLogout(
  store: AccessTokenRevocationStore | undefined,
  tokens: { accessToken?: string; refreshToken?: string },
  verify: (token: string) => Promise<{ jti?: unknown; sid?: unknown; exp?: unknown } | null>,
  maxTtlSeconds: number,
): Promise<void> {
  if (!store || !tokens.accessToken) return;

  const payload = await verify(tokens.accessToken);
  if (!payload) return;
  const access = revocationClaimsFromPayload(payload);
  if (!access) return;

  const ttl = defaultAccessTokenRevocationTtlSeconds(
    Math.min(access.ttlSeconds ?? maxTtlSeconds, maxTtlSeconds),
  );
  await revokeAccessTokenIdentifiers(store, { jti: access.jti, sessionId: access.sessionId }, ttl);

  if (tokens.refreshToken && access.sessionId) {
    let refresh: RevocationClaims | null = null;
    try {
      refresh = revocationClaimsFromPayload(decodeJwt(tokens.refreshToken).payload);
    } catch {
      refresh = null;
    }
    if (refresh?.jti && refresh.sessionId === access.sessionId) {
      await revokeAccessTokenIdentifiers(store, { jti: refresh.jti }, ttl);
    }
  }
}

/** PRC-L283: login-time identity link failure → 401 (rejected mapping) or 503 (store down). */
function sendIdentityLinkFailure(request: FastifyRequest, reply: FastifyReply, error: unknown) {
  if (error instanceof KeycloakIdentityError) {
    return reply.status(401).send({
      code: 'IDENTITY_LINK_REJECTED',
      message: error.message,
      statusCode: 401,
    });
  }
  request.log.error({ err: error }, 'Keycloak identity store unavailable during login');
  return reply.status(503).send({
    code: 'IDENTITY_UNAVAILABLE',
    message: 'Identity service temporarily unavailable',
    statusCode: 503,
  });
}

export async function registerKeycloakAuthRoutes(
  fastify: FastifyInstance,
  config: KeycloakRouteConfig,
  prefix = '/api/v1/auth',
): Promise<void> {
  const logoutJwks = config.jwksClient ?? new KeycloakJwksClient(config.jwksUri);
  const maxRevocationTtlSeconds =
    config.maxRevocationTtlSeconds && config.maxRevocationTtlSeconds > 0
      ? config.maxRevocationTtlSeconds
      : DEFAULT_MAX_REVOCATION_TTL_SECONDS;
  const verifyForLogout = async (token: string) => {
    try {
      await verifyKeycloakAccessToken(token, config, logoutJwks);
      // Signature/issuer/expiry verified; read raw jti/sid from the same token.
      return decodeJwt(token).payload;
    } catch {
      return null;
    }
  };
  const passwordThrottle =
    config.passwordThrottle instanceof PasswordLoginThrottle
      ? config.passwordThrottle
      : new PasswordLoginThrottle(config.passwordThrottle);

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
        } catch (error) {
          // PRC-L283: fail closed. Never hand out tokens for a session whose local identity could
          // not be linked: a mapping rejection is a 401, a store outage a 503.
          return sendIdentityLinkFailure(request, reply, error);
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

      // PRC-H043: refuse before contacting Keycloak when the account or source IP
      // has exceeded its failed-attempt budget.
      const throttle = passwordThrottle.check(username, request.ip);
      if (!throttle.allowed) {
        return reply.status(429).header('retry-after', String(throttle.retryAfterSeconds)).send({
          code: 'TOO_MANY_ATTEMPTS',
          message: 'Too many failed sign-in attempts. Try again later.',
          statusCode: 429,
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
        // Only credential rejections count; IdP outages (5xx) must not lock users out.
        if (tokenResponse.status === 400 || tokenResponse.status === 401) {
          passwordThrottle.recordFailure(username, request.ip);
        }
        return reply.status(401).send({
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid email or password',
          statusCode: 401,
        });
      }
      passwordThrottle.recordSuccess(username);

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
        } catch (error) {
          // PRC-L283: fail closed. Never hand out tokens for a session whose local identity could
          // not be linked: a mapping rejection is a 401, a store outage a 503.
          return sendIdentityLinkFailure(request, reply, error);
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

  /**
   * GET /auth/logout
   * W1-SEC-09: denylist current access jti/sid (and refresh JWT identifiers when
   * presented) before redirecting to Keycloak end-session.
   */
  fastify.get(
    `${prefix}/logout`,
    async (
      request: FastifyRequest<{
        Querystring: {
          redirect?: string;
          refresh_token?: string;
          id_token?: string;
          id_token_hint?: string;
        };
      }>,
      reply: FastifyReply,
    ) => {
      const accessToken = readBearer(request);
      const refreshToken = readHeaderOrQuery(request, 'x-refresh-token', 'refresh_token');
      const idTokenHint =
        readHeaderOrQuery(request, 'x-id-token', 'id_token_hint') ??
        readHeaderOrQuery(request, 'x-id-token', 'id_token');

      const store =
        config.revocationStore ??
        (fastify as FastifyInstance & { accessTokenRevocationStore?: AccessTokenRevocationStore })
          .accessTokenRevocationStore;

      await revokePresentedTokensBeforeIdpLogout(
        store,
        { accessToken, refreshToken },
        verifyForLogout,
        maxRevocationTtlSeconds,
      );

      return reply.redirect(
        logoutUrl(config, request.query.redirect ?? config.webOrigin, idTokenHint),
        302,
      );
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
   * Name/slug/status come from the tenant repository when `tenantDirectory`
   * is wired (PRC-L084); unknown tenants are omitted.
   */
  fastify.get(`${prefix}/tenants`, async (request: FastifyRequest, reply: FastifyReply) => {
    await fastify.authenticate(request, reply);
    if (reply.sent) return;

    const user = request.user as {
      email?: string;
      tenantId?: string;
      preferred_username?: string;
    };
    return reply.status(200).send({
      data: await resolveTenantDirectory(user.tenantId, config.tenantDirectory),
    });
  });

  fastify.get(`${prefix}/roles`, async (_request, reply) => {
    return reply.status(200).send({
      provider: 'keycloak',
      realm: config.realm,
      roles: keycloakRoleCatalog(),
    });
  });
}
