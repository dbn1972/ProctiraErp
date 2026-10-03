import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

import {
  defaultAccessTokenRevocationTtlSeconds,
  revokeAccessTokenIdentifiers,
  type AccessTokenRevocationStore,
} from '../access-token-revocation.js';
import { resolveTenantDirectory, type TenantDirectoryReader } from '../tenant-directory.js';

import {
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
  /**
   * PRC-M499: realm "SSO Session Max" in seconds. A logged-out session's sid
   * (and refresh jti) stays denylisted this long so a refresh token cannot be
   * replayed after the access-token lifetime. Default 36000 (Keycloak default).
   */
  ssoSessionMaxSeconds?: number;
  /**
   * PRC-M500: one-time web login ticket store. Use the Redis store in any
   * multi-replica deployment; the default is process-local memory.
   */
  webTicketStore?: WebTicketStore;
};

/** PRC-M500: one-time login ticket storage (shared across replicas when Redis-backed). */
export interface WebTicketStore {
  put(id: string, value: string, ttlSeconds: number): Promise<void>;
  /** Atomically read-and-delete; null when absent/expired. */
  take(id: string): Promise<string | null>;
}

export class MemoryWebTicketStore implements WebTicketStore {
  private readonly entries = new Map<string, { value: string; expiresAt: number }>();
  async put(id: string, value: string, ttlSeconds: number): Promise<void> {
    const now = Date.now();
    for (const [key, entry] of this.entries) if (entry.expiresAt <= now) this.entries.delete(key);
    this.entries.set(id, { value, expiresAt: now + ttlSeconds * 1000 });
  }
  async take(id: string): Promise<string | null> {
    const entry = this.entries.get(id);
    this.entries.delete(id);
    if (!entry || entry.expiresAt <= Date.now()) return null;
    return entry.value;
  }
}

export type RedisLikeForWebTickets = {
  set(key: string, value: string, expiryMode: 'EX', ttlSeconds: number): Promise<unknown>;
  getdel(key: string): Promise<string | null>;
};

/** Redis-backed tickets: SET EX + GETDEL so a ticket is redeemable once cluster-wide. */
export class RedisWebTicketStore implements WebTicketStore {
  constructor(
    private readonly redis: RedisLikeForWebTickets,
    private readonly keyPrefix = 'auth:web-ticket:',
  ) {}
  async put(id: string, value: string, ttlSeconds: number): Promise<void> {
    await this.redis.set(
      `${this.keyPrefix}${id}`,
      value,
      'EX',
      Math.max(1, Math.trunc(ttlSeconds)),
    );
  }
  async take(id: string): Promise<string | null> {
    return this.redis.getdel(`${this.keyPrefix}${id}`);
  }
}

const DEFAULT_SSO_SESSION_MAX_SECONDS = 36_000;

const DEFAULT_MAX_REVOCATION_TTL_SECONDS = 3600;
const MAX_REVOCATION_ID_LENGTH = 256;

type IssuedTokens = {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  expiresIn?: number;
  tokenType: string;
};

const WEB_TICKET_TTL_SECONDS = 60;
const MAX_TICKET_ID_LENGTH = 128;

/** PRC-M500: login transaction bound to the browser via an httpOnly cookie. */
const OIDC_TXN_COOKIE = 'kc_oidc_txn';
const OIDC_TXN_TTL_SECONDS = 600;
type OidcTransaction = { s: string; v: string; n: string; a?: string };

function b64url(bytes: Buffer): string {
  return bytes.toString('base64url');
}

function pkceChallenge(verifier: string): string {
  return b64url(createHash('sha256').update(verifier).digest());
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

function readCookie(request: FastifyRequest, name: string): string | undefined {
  const header = request.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() === name) return part.slice(idx + 1).trim();
  }
  return undefined;
}

function parseTransaction(raw: string | undefined): OidcTransaction | null {
  if (!raw || raw.length > 2048) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as OidcTransaction;
    if (
      typeof parsed?.s !== 'string' ||
      typeof parsed.v !== 'string' ||
      typeof parsed.n !== 'string' ||
      (parsed.a !== undefined && typeof parsed.a !== 'string')
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function txnCookie(value: string, path: string, secure: boolean, maxAge: number): string {
  return [
    `${OIDC_TXN_COOKIE}=${value}`,
    `Path=${path}`,
    `Max-Age=${maxAge}`,
    'HttpOnly',
    'SameSite=Lax',
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}

/** PRC-M500: same-origin path only — no `//host`, backslashes or schemes. */
const SAFE_RETURN_TO = /^\/(?!\/)[^\\]*$/;

export function webReturnTo(state: string | undefined): string | null {
  if (!state?.startsWith('web:')) return null;
  const path = state.slice(4);
  return SAFE_RETURN_TO.test(path) ? path : null;
}

function authorizeUrl(
  config: KeycloakRouteConfig,
  state: string,
  binding: { codeChallenge: string; nonce: string },
): string {
  const url = new URL(`${config.issuer.replace(/\/$/, '')}/protocol/openid-connect/auth`);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile roles');
  url.searchParams.set('state', state);
  url.searchParams.set('nonce', binding.nonce);
  url.searchParams.set('code_challenge', binding.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
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
  sessionTtlSeconds: number,
): Promise<void> {
  if (!store || !tokens.accessToken) return;

  const payload = await verify(tokens.accessToken);
  if (!payload) return;
  const access = revocationClaimsFromPayload(payload);
  if (!access) return;

  const ttl = defaultAccessTokenRevocationTtlSeconds(
    Math.min(access.ttlSeconds ?? maxTtlSeconds, maxTtlSeconds),
  );
  await revokeAccessTokenIdentifiers(store, { jti: access.jti }, ttl);
  // PRC-M499: the sid outlives the access token — keep it denylisted for the
  // whole SSO session so /refresh can reject the session's refresh tokens.
  if (access.sessionId) await store.revoke('sid', access.sessionId, sessionTtlSeconds);

  if (tokens.refreshToken && access.sessionId) {
    let refresh: RevocationClaims | null = null;
    try {
      refresh = revocationClaimsFromPayload(decodeJwt(tokens.refreshToken).payload);
    } catch {
      refresh = null;
    }
    if (refresh?.jti && refresh.sessionId === access.sessionId) {
      await revokeAccessTokenIdentifiers(store, { jti: refresh.jti }, sessionTtlSeconds);
    }
  }
}

/**
 * PRC-M499: true when the refresh token's sid or jti is denylisted. The token
 * is decoded (not verified) — it only ever *narrows* access here; Keycloak
 * still verifies it on the token endpoint. Store failures count as revoked.
 */
async function isRefreshTokenRevoked(
  store: AccessTokenRevocationStore | undefined,
  refreshToken: string,
): Promise<boolean> {
  if (!store) return false;
  let claims: RevocationClaims | null = null;
  try {
    claims = revocationClaimsFromPayload(decodeJwt(refreshToken).payload);
  } catch {
    return false; // opaque token: Keycloak decides
  }
  if (!claims) return false;
  try {
    if (claims.sessionId && (await store.isRevoked('sid', claims.sessionId))) return true;
    if (claims.jti && (await store.isRevoked('jti', claims.jti))) return true;
    return false;
  } catch {
    return true;
  }
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
  const webTicketStore = config.webTicketStore ?? new MemoryWebTicketStore();
  const secureCookies = config.redirectUri.startsWith('https://');
  const sessionRevocationTtlSeconds =
    config.ssoSessionMaxSeconds && config.ssoSessionMaxSeconds > 0
      ? config.ssoSessionMaxSeconds
      : DEFAULT_SSO_SESSION_MAX_SECONDS;
  const revocationStoreFor = (): AccessTokenRevocationStore | undefined =>
    config.revocationStore ??
    (fastify as FastifyInstance & { accessTokenRevocationStore?: AccessTokenRevocationStore })
      .accessTokenRevocationStore;

  /**
   * PRC-M499: end the IdP session server-side with the refresh token so the
   * refresh token is dead at Keycloak too (not just in our denylist).
   * Best-effort: our denylist already blocks /refresh if the IdP is down.
   */
  const backchannelLogout = async (refreshToken: string | undefined): Promise<void> => {
    if (!refreshToken) return;
    const body = new URLSearchParams({ client_id: config.clientId, refresh_token: refreshToken });
    if (config.clientSecret) body.set('client_secret', config.clientSecret);
    try {
      const res = await fetch(
        `${config.issuer.replace(/\/$/, '')}/protocol/openid-connect/logout`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body,
        },
      );
      if (!res.ok) fastify.log.warn({ status: res.status }, 'keycloak backchannel logout failed');
    } catch (err) {
      fastify.log.warn({ err }, 'keycloak backchannel logout failed');
    }
  };

  const revokeForLogout = async (request: FastifyRequest): Promise<string | undefined> => {
    const accessToken = readBearer(request);
    const refreshToken =
      readHeaderOrQuery(
        request as FastifyRequest<{ Querystring: Record<string, string | undefined> }>,
        'x-refresh-token',
        'refresh_token',
      ) ?? (request.body as { refreshToken?: unknown } | undefined)?.refreshToken?.toString();
    await revokePresentedTokensBeforeIdpLogout(
      revocationStoreFor(),
      { accessToken, refreshToken },
      verifyForLogout,
      maxRevocationTtlSeconds,
      sessionRevocationTtlSeconds,
    );
    await backchannelLogout(refreshToken);
    return refreshToken;
  };
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
      // PRC-M500: server-generated state + nonce + PKCE verifier, bound to this
      // browser via an httpOnly cookie and verified in /callback.
      const txn: OidcTransaction = {
        s: b64url(randomBytes(24)),
        v: b64url(randomBytes(48)),
        n: b64url(randomBytes(24)),
        ...(request.query.state ? { a: request.query.state.slice(0, 1024) } : {}),
      };
      reply.header(
        'set-cookie',
        txnCookie(
          Buffer.from(JSON.stringify(txn)).toString('base64url'),
          prefix,
          secureCookies,
          OIDC_TXN_TTL_SECONDS,
        ),
      );
      return reply.redirect(
        authorizeUrl(config, txn.s, { codeChallenge: pkceChallenge(txn.v), nonce: txn.n }),
        302,
      );
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
      // PRC-M500: the transaction cookie is single-use whatever the outcome.
      const txn = parseTransaction(readCookie(request, OIDC_TXN_COOKIE));
      reply.header('set-cookie', txnCookie('', prefix, secureCookies, 0));
      if (!txn || !request.query.state || !safeEqual(request.query.state, txn.s)) {
        return reply.status(400).send({
          code: 'KEYCLOAK_STATE_MISMATCH',
          message: 'Login state is missing, expired or does not match this browser',
          statusCode: 400,
        });
      }
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
        code_verifier: txn.v,
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
      // PRC-M500: the ID token must carry the nonce issued for this browser.
      if (tokens.id_token) {
        let nonce: unknown;
        try {
          nonce = (decodeJwt(tokens.id_token).payload as Record<string, unknown>)['nonce'];
        } catch {
          nonce = undefined;
        }
        if (typeof nonce !== 'string' || !safeEqual(nonce, txn.n)) {
          return reply.status(401).send({
            code: 'KEYCLOAK_NONCE_MISMATCH',
            message: 'ID token nonce does not match the login request',
            statusCode: 401,
          });
        }
      }
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

      const returnTo = webReturnTo(txn.a);
      if (returnTo && config.webOrigin) {
        const ticket = b64url(randomBytes(32));
        await webTicketStore.put(ticket, JSON.stringify(issued), WEB_TICKET_TTL_SECONDS);
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
      const raw = ticket.length <= MAX_TICKET_ID_LENGTH ? await webTicketStore.take(ticket) : null;
      const tokens = raw ? (JSON.parse(raw) as IssuedTokens) : null;
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
      // PRC-M499: a logged-out session's refresh token is rejected here even
      // though only Keycloak can verify its signature. Store errors fail closed.
      if (await isRefreshTokenRevoked(revocationStoreFor(), refreshToken)) {
        return reply.status(401).send({
          code: 'KEYCLOAK_SESSION_REVOKED',
          message: 'Session has been signed out',
          statusCode: 401,
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
      await revokeForLogout(request);
      const idTokenHint =
        readHeaderOrQuery(request, 'x-id-token', 'id_token_hint') ??
        readHeaderOrQuery(request, 'x-id-token', 'id_token');
      return reply.redirect(
        logoutUrl(config, request.query.redirect ?? config.webOrigin, idTokenHint),
        302,
      );
    },
  );

  /**
   * POST /auth/logout (PRC-M499): API logout for web/mobile. Same denylist +
   * IdP backchannel revocation as GET, without the browser redirect, so it is
   * not triggerable by a cross-site link.
   */
  fastify.post(`${prefix}/logout`, async (request: FastifyRequest, reply: FastifyReply) => {
    await revokeForLogout(request);
    return reply.status(200).send({ success: true });
  });

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
