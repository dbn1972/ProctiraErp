import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

import {
  defaultAccessTokenRevocationTtlSeconds,
  revokeAccessTokenIdentifiers,
  type AccessTokenRevocationStore,
} from '../access-token-revocation.js';
import {
  OtpAuthError,
  OtpRateLimitError,
  OtpValidationError,
  type OtpService,
} from '../otp-service.js';
import { resolveTenantDirectory, type TenantDirectoryReader } from '../tenant-directory.js';
import {
  isIssuedBeforeTenantRevocation,
  type TenantSessionRevocationStore,
} from '../tenant-session-revocation.js';

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
  /**
   * PRC-H008 / PRC-H098: true when the tenant is suspended/decommissioned. Throws when the
   * status cannot be read (login/refresh then fail closed with 503). When set, password login,
   * the OIDC callback and refresh refuse blocked tenants and end the just-issued IdP session.
   */
  tenantAuthGate?: (tenantId: string) => Promise<boolean>;
  /** PRC-H008: tenant-wide revocation epoch; refresh tokens issued before it are refused. */
  tenantSessionRevocation?: TenantSessionRevocationStore;
  /**
   * PRC-H043: server-side MFA policy for the ROPC `/password` flow. When this hook reports a
   * user's policy requires MFA and no second factor is verified, `/password` must NOT issue
   * tokens — it returns an `mfa_required` challenge completed via {@link otpService}.
   *
   * The decision (and the phone to challenge) is resolved server-side from the verified identity;
   * client-supplied phone/userId are never trusted. A thrown error fails closed (503) so a policy
   * outage cannot bypass MFA.
   */
  mfaPolicy?: (user: {
    userId: string;
    tenantId: string;
    email?: string;
  }) => Promise<MfaPolicyDecision>;
  /** PRC-H043: OTP service used to issue/verify the second factor. Required when mfaPolicy is set. */
  otpService?: OtpService;
  /** PRC-H043: how long held tokens await OTP completion (seconds, default 300). */
  otpPendingTtlSeconds?: number;
};

/** PRC-H043: server-resolved MFA requirement for a user. */
export interface MfaPolicyDecision {
  /** True when the user's policy requires a verified second factor to sign in. */
  required: boolean;
  /** E.164 phone to send the OTP to (server-resolved; required when `required`). */
  phone?: string;
}

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

/** PRC-H043: how long tokens are held pending OTP completion, and the key namespace used. */
const MFA_PENDING_TTL_SECONDS = 300;
function mfaPendingKey(mfaToken: string): string {
  return `mfa-pending:${mfaToken}`;
}

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

function claimTenantId(accessToken: string): string | undefined {
  try {
    const claims = decodeJwt(accessToken).payload;
    const raw = claims.tenant_id ?? claims.tenantId;
    const value = Array.isArray(raw) ? raw[0] : raw;
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  } catch {
    return undefined;
  }
}

function tokenIssuedAt(token: string | undefined): number | undefined {
  if (!token) return undefined;
  try {
    const iat = decodeJwt(token).payload.iat;
    return typeof iat === 'number' ? iat : undefined;
  } catch {
    return undefined;
  }
}

/** PRC-H008: end the IdP session behind a refresh token we refuse to hand out (best effort). */
async function endIdpSession(config: KeycloakRouteConfig, refreshToken?: string): Promise<void> {
  if (!refreshToken) return;
  const body = new URLSearchParams({ client_id: config.clientId, refresh_token: refreshToken });
  if (config.clientSecret) body.set('client_secret', config.clientSecret);
  try {
    await fetch(`${config.issuer.replace(/\/$/, '')}/protocol/openid-connect/logout`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
  } catch {
    // The tokens are never returned to the caller; the IdP session expires on its own.
  }
}

/**
 * PRC-H008 / PRC-H098: refuse tokens for a suspended/decommissioned tenant (403) or, on refresh,
 * a session issued before the tenant-wide revocation (401). Fails closed (503) when the tenant
 * status cannot be read. Returns true when a refusal was sent.
 */
async function refuseBlockedTenant(
  config: KeycloakRouteConfig,
  request: FastifyRequest,
  reply: FastifyReply,
  input: { tenantId?: string; issuedRefreshToken?: string; presentedRefreshToken?: string },
): Promise<boolean> {
  const { tenantId } = input;
  if (!tenantId || (!config.tenantAuthGate && !config.tenantSessionRevocation)) return false;
  let blocked = false;
  let revokedSession = false;
  try {
    blocked = (await config.tenantAuthGate?.(tenantId)) ?? false;
    if (!blocked && input.presentedRefreshToken && config.tenantSessionRevocation) {
      const revokedAt = await config.tenantSessionRevocation.tenantSessionsRevokedAt(tenantId);
      revokedSession = isIssuedBeforeTenantRevocation(
        tokenIssuedAt(input.presentedRefreshToken),
        revokedAt,
      );
    }
  } catch (error) {
    request.log.error({ err: error, tenantId }, 'tenant status lookup failed during sign-in');
    await endIdpSession(config, input.issuedRefreshToken);
    void reply.status(503).send({
      code: 'TENANT_STATUS_UNAVAILABLE',
      message: 'Tenant status could not be verified; try again shortly',
      statusCode: 503,
    });
    return true;
  }
  if (!blocked && !revokedSession) return false;
  await endIdpSession(config, input.issuedRefreshToken);
  if (blocked) {
    void reply.status(403).send({
      code: 'TENANT_SUSPENDED',
      message: 'This school account is suspended; sign-in is not available',
      statusCode: 403,
    });
  } else {
    void reply.status(401).send({
      code: 'SESSION_REVOKED',
      message: 'This session was ended; sign in again',
      statusCode: 401,
    });
  }
  return true;
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
        } catch (error) {
          // PRC-L283: fail closed. Never hand out tokens for a session whose local identity could
          // not be linked: a mapping rejection is a 401, a store outage a 503.
          return sendIdentityLinkFailure(request, reply, error);
        }
      }

      if (
        await refuseBlockedTenant(config, request, reply, {
          tenantId: user?.tenantId ?? claimTenantId(tokens.access_token),
          issuedRefreshToken: tokens.refresh_token,
        })
      ) {
        return reply;
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
      let throttle: Awaited<ReturnType<PasswordLoginThrottle['check']>>;
      try {
        throttle = await passwordThrottle.check(username, request.ip);
      } catch (error) {
        // Fail closed: without the shared failure budget the endpoint is unthrottled.
        request.log.error({ err: error }, 'password-login throttle store unavailable');
        return reply.status(503).send({
          code: 'LOGIN_THROTTLE_UNAVAILABLE',
          message: 'Sign-in is temporarily unavailable. Try again shortly.',
          statusCode: 503,
        });
      }
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
          await passwordThrottle.recordFailure(username, request.ip).catch((error: unknown) => {
            request.log.error({ err: error }, 'password-login throttle failure not recorded');
          });
        }
        return reply.status(401).send({
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid email or password',
          statusCode: 401,
        });
      }
      await passwordThrottle.recordSuccess(username).catch((error: unknown) => {
        request.log.warn({ err: error }, 'password-login throttle reset not recorded');
      });

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

      if (
        await refuseBlockedTenant(config, request, reply, {
          tenantId: user?.tenantId ?? claimTenantId(tokens.access_token),
          issuedRefreshToken: tokens.refresh_token,
        })
      ) {
        return reply;
      }

      const issuedTokens: IssuedTokens = {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        idToken: tokens.id_token,
        expiresIn: tokens.expires_in,
        tokenType: tokens.token_type ?? 'Bearer',
      };

      // PRC-H043: enforce MFA before issuing tokens. ROPC proves only the password (a single
      // factor), so a user whose policy requires MFA must complete a second factor. We do NOT
      // return tokens here; instead we send an OTP challenge and return `mfa_required`. The IdP
      // session behind the just-issued refresh token is ended so it cannot be replayed, and the
      // tokens are held server-side under the OTP mfaToken until POST /password/mfa verifies it.
      if (config.mfaPolicy) {
        const claims = (() => {
          try {
            return decodeJwt(tokens.access_token).payload as Record<string, unknown>;
          } catch {
            return {} as Record<string, unknown>;
          }
        })();
        const claimSub = typeof claims.sub === 'string' ? claims.sub : undefined;
        const mfaUserId = user?.userId ?? claimSub;
        const mfaTenantId = user?.tenantId ?? claimTenantId(tokens.access_token);
        let decision: MfaPolicyDecision;
        try {
          decision = await config.mfaPolicy({
            userId: mfaUserId ?? '',
            tenantId: mfaTenantId ?? '',
            email: user?.email,
          });
        } catch (error) {
          request.log.error({ err: error }, 'MFA policy lookup failed during password login');
          await endIdpSession(config, tokens.refresh_token);
          return reply.status(503).send({
            code: 'MFA_POLICY_UNAVAILABLE',
            message: 'Sign-in is temporarily unavailable. Try again shortly.',
            statusCode: 503,
          });
        }
        if (decision.required) {
          // Cannot complete the second factor without an OTP service and a resolved phone:
          // fail closed (do not hand out tokens).
          if (!config.otpService || !decision.phone || !mfaUserId || !mfaTenantId) {
            await endIdpSession(config, tokens.refresh_token);
            return reply.status(403).send({
              code: 'MFA_REQUIRED_UNAVAILABLE',
              message: 'Multi-factor authentication is required but cannot be completed.',
              statusCode: 403,
            });
          }
          let challenge: Awaited<ReturnType<OtpService['sendChallenge']>>;
          try {
            challenge = await config.otpService.sendChallenge({
              userId: mfaUserId,
              tenantId: mfaTenantId,
              phone: decision.phone,
            });
          } catch (error) {
            if (error instanceof OtpRateLimitError) {
              await endIdpSession(config, tokens.refresh_token);
              return reply.status(429).send({
                code: 'MFA_RATE_LIMITED',
                message: error.message,
                statusCode: 429,
              });
            }
            if (error instanceof OtpValidationError) {
              await endIdpSession(config, tokens.refresh_token);
              return reply.status(403).send({
                code: 'MFA_REQUIRED_UNAVAILABLE',
                message: 'Multi-factor authentication is required but cannot be completed.',
                statusCode: 403,
              });
            }
            request.log.error({ err: error }, 'MFA challenge send failed during password login');
            await endIdpSession(config, tokens.refresh_token);
            return reply.status(503).send({
              code: 'MFA_CHALLENGE_UNAVAILABLE',
              message: 'Sign-in is temporarily unavailable. Try again shortly.',
              statusCode: 503,
            });
          }
          // Hold the issued tokens keyed by the OTP mfaToken until verification. The web-ticket
          // store is single-use and TTL-bounded; reuse it so no new store is needed.
          await webTicketStore.put(
            mfaPendingKey(challenge.mfaToken),
            JSON.stringify({ ...issuedTokens, user }),
            Math.max(1, config.otpPendingTtlSeconds ?? MFA_PENDING_TTL_SECONDS),
          );
          return reply.status(401).send({
            provider: 'keycloak',
            realm: config.realm,
            status: 'mfa_required',
            mfaToken: challenge.mfaToken,
            method: challenge.method,
            phoneHint: challenge.phoneHint,
            expiresAt: challenge.expiresAt,
            ...(challenge.debugCode ? { debugCode: challenge.debugCode } : {}),
          });
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

  /**
   * POST /auth/password/mfa — complete the PRC-H043 second factor. Verifies the OTP via the
   * existing OtpService and, on success, returns the tokens held for this mfaToken. A bad/expired
   * code never returns tokens, and the pending tokens are single-use (consumed on first fetch).
   */
  fastify.post(
    `${prefix}/password/mfa`,
    async (
      request: FastifyRequest<{ Body: { mfaToken?: string; code?: string } }>,
      reply: FastifyReply,
    ) => {
      const mfaToken = (request.body?.mfaToken ?? '').trim();
      const code = (request.body?.code ?? '').trim();
      if (!mfaToken || !code) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'mfaToken and code are required',
          statusCode: 400,
        });
      }
      if (!config.otpService) {
        return reply.status(501).send({
          code: 'MFA_NOT_CONFIGURED',
          message: 'Multi-factor authentication is not configured',
          statusCode: 501,
        });
      }
      try {
        await config.otpService.verifyChallenge({ mfaToken, code });
      } catch (error) {
        if (error instanceof OtpRateLimitError) {
          return reply
            .status(429)
            .send({ code: 'TOO_MANY_ATTEMPTS', message: error.message, statusCode: 429 });
        }
        if (error instanceof OtpAuthError) {
          return reply
            .status(401)
            .send({ code: 'MFA_INVALID', message: error.message, statusCode: 401 });
        }
        throw error;
      }
      // OTP verified: hand out the held tokens (single-use fetch).
      const raw = await webTicketStore.take(mfaPendingKey(mfaToken));
      if (!raw) {
        return reply.status(401).send({
          code: 'MFA_SESSION_EXPIRED',
          message: 'Sign-in session expired; please sign in again',
          statusCode: 401,
        });
      }
      const held = JSON.parse(raw) as IssuedTokens & { user?: LinkedKeycloakUser };
      return reply.status(200).send({
        provider: 'keycloak',
        realm: config.realm,
        accessToken: held.accessToken,
        refreshToken: held.refreshToken,
        idToken: held.idToken,
        expiresIn: held.expiresIn,
        tokenType: held.tokenType,
        user: held.user,
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
      // PRC-H008 / PRC-H098: a suspended tenant cannot extend its sessions, and a session issued
      // before a tenant-wide revocation stays revoked after reactivation.
      if (config.tenantAuthGate || config.tenantSessionRevocation) {
        let tenantId = claimTenantId(tokens.access_token);
        if (config.identityStore) {
          try {
            const linked = await linkKeycloakIdentity(
              identityInputFromClaims(decodeJwt(tokens.access_token).payload, config.realm),
              config.identityStore,
            );
            tenantId = linked.tenantId ?? tenantId;
          } catch (error) {
            await endIdpSession(config, tokens.refresh_token);
            return sendIdentityLinkFailure(request, reply, error);
          }
        }
        if (
          await refuseBlockedTenant(config, request, reply, {
            tenantId,
            issuedRefreshToken: tokens.refresh_token,
            presentedRefreshToken: refreshToken,
          })
        ) {
          return reply;
        }
      }
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
   * POST /auth/logout — PRC-L282 authenticated logout (web BFF and mobile).
   * The Bearer access token must verify (signature, issuer, expiry, not revoked); its jti/sid
   * are denylisted with a capped TTL, the refresh token (body, never the query string) is
   * denylisted when it belongs to the same session, and the IdP session is ended server-side.
   * Returns the IdP end-session URL for browser clients that also want the front-channel hop.
   * GET /auth/logout stays for redirect-based clients with signature-verified, capped denylisting.
   * PRC-M499: the sid and the same-session refresh jti stay denylisted for the realm SSO Session
   * Max so /refresh rejects the session's refresh tokens after the access token expires.
   */
  fastify.post(
    `${prefix}/logout`,
    async (
      request: FastifyRequest<{
        Body: { refreshToken?: unknown; idToken?: unknown; redirect?: unknown } | null;
      }>,
      reply: FastifyReply,
    ) => {
      await fastify.authenticate(request, reply);
      if (reply.sent) return;

      const body = request.body ?? {};
      const refreshToken =
        typeof body.refreshToken === 'string' && body.refreshToken.trim()
          ? body.refreshToken.trim()
          : undefined;
      const idTokenHint =
        typeof body.idToken === 'string' && body.idToken.trim() ? body.idToken.trim() : undefined;
      const redirect = typeof body.redirect === 'string' ? body.redirect : config.webOrigin;

      await revokePresentedTokensBeforeIdpLogout(
        revocationStoreFor(),
        { accessToken: readBearer(request), refreshToken },
        verifyForLogout,
        maxRevocationTtlSeconds,
        sessionRevocationTtlSeconds,
      );
      await backchannelLogout(refreshToken);

      return reply.status(200).send({
        loggedOut: true,
        endSessionUrl: logoutUrl(config, redirect, idTokenHint),
      });
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
