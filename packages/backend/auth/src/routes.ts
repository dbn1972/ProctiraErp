/**
 * Auth Routes
 *
 * POST /auth/login   - Authenticate with local credentials
 * POST /auth/refresh - Refresh token pair using refresh token
 * POST /auth/logout  - Invalidate session and revoke tokens
 * GET  /auth/me      - Get current authenticated user info
 */
import { randomBytes } from 'node:crypto';

import type { LoginRequest, RefreshRequest, AuthUser } from '@proctira/auth';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

import {
  defaultAccessTokenRevocationTtlSeconds,
  revokeAccessTokenIdentifiers,
  type AccessTokenRevocationStore,
} from './access-token-revocation.js';
import { hashPassword, verifyPassword } from './local-auth.js';
import type { AccountLockoutService } from './lockout-service.js';
import type { SessionService } from './session-service.js';
import { InvalidRefreshTokenError } from './token-service.js';
import type { RefreshTokenStore, TokenService } from './token-service.js';

/** PRC-L445: upper bounds for login body fields (RFC 5321 address length; bcrypt input). */
const MAX_USERNAME_LENGTH = 320;
const MAX_PASSWORD_LENGTH = 1024;

/** PRC-L445: the one response for every failed credential check. */
const INVALID_CREDENTIALS_BODY = {
  code: 'INVALID_CREDENTIALS',
  message: 'Invalid username or password',
  statusCode: 401,
} as const;

type LoginFieldError = { field: string; rule: string; message: string };

/** PRC-L445: strict body validation (strings only, bounded length). */
function parseLoginBody(
  body: unknown,
): { ok: true; username: string; password: string } | { ok: false; errors: LoginFieldError[] } {
  const raw = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const errors: LoginFieldError[] = [];
  const check = (field: 'username' | 'password', max: number): string => {
    const value = raw[field];
    const label = field === 'username' ? 'Username' : 'Password';
    if (value === undefined || value === null || value === '') {
      errors.push({ field, rule: 'required', message: `${label} is required` });
      return '';
    }
    if (typeof value !== 'string') {
      errors.push({ field, rule: 'type', message: `${label} must be a string` });
      return '';
    }
    if (value.length > max) {
      errors.push({ field, rule: 'maxLength', message: `${label} is too long` });
      return '';
    }
    return value;
  };
  const username = check('username', MAX_USERNAME_LENGTH);
  const password = check('password', MAX_PASSWORD_LENGTH);
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, username, password };
}

let dummyHashPromise: Promise<string> | undefined;

/**
 * PRC-L445: a bcrypt hash of a random value, computed once per process with the
 * default cost, so a login for an unknown or locked account spends the same
 * bcrypt work as a real password check.
 */
function dummyPasswordHash(): Promise<string> {
  dummyHashPromise ??= hashPassword(randomBytes(32).toString('base64url'));
  return dummyHashPromise;
}

/**
 * Interface for user lookup (provided by the consuming application).
 */
export interface UserLookup {
  /** Find a user by username/email within a tenant */
  findByUsername(
    username: string,
    tenantId: string,
  ): Promise<{
    id: string;
    email: string;
    displayName: string;
    passwordHash: string;
    tenantId: string;
    roles: AuthUser['roles'];
    areas: AuthUser['areas'];
    institutions: string[];
    isActive: boolean;
  } | null>;
  /** Find a user by ID */
  findById(
    userId: string,
    tenantId: string,
  ): Promise<{
    id: string;
    email: string;
    displayName: string;
    tenantId: string;
    roles: AuthUser['roles'];
    areas: AuthUser['areas'];
    institutions: string[];
    isActive: boolean;
  } | null>;
}

/**
 * Options for registering auth routes.
 */
export interface AuthRoutesOptions {
  tokenService: TokenService;
  sessionService: SessionService;
  userLookup: UserLookup;
  refreshTokenStore: RefreshTokenStore;
  /** Account lockout service (optional - if not provided, lockout is disabled) */
  lockoutService?: AccountLockoutService;
  /** Access-token jti/sid denylist (W1-SEC-09); used on logout. */
  accessTokenRevocationStore?: AccessTokenRevocationStore;
  /** Access-token TTL used for denylist entries (default from token service config). */
  accessTokenExpiresIn?: number;
  /** Prefix for auth routes (default: '/auth') */
  prefix?: string;
}

/**
 * Register auth routes on a Fastify instance.
 */
export async function registerAuthRoutes(
  fastify: FastifyInstance,
  options: AuthRoutesOptions,
): Promise<void> {
  const {
    tokenService,
    sessionService,
    userLookup,
    refreshTokenStore,
    lockoutService,
    accessTokenRevocationStore,
    accessTokenExpiresIn,
    prefix = '/auth',
  } = options;

  /**
   * POST /auth/login
   * Authenticate with local credentials and return token pair + session.
   */
  fastify.post(
    `${prefix}/login`,
    async function loginHandler(
      request: FastifyRequest<{ Body: LoginRequest }>,
      reply: FastifyReply,
    ) {
      // PRC-L445: validate the body shape before touching any account state.
      const credentials = parseLoginBody(request.body);
      if (!credentials.ok) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Username and password are required',
          statusCode: 400,
          errors: credentials.errors,
        });
      }
      const { username, password } = credentials;

      // Resolve tenant from request (set by tenant plugin)
      const tenantId = (request as FastifyRequest & { tenantId?: string }).tenantId;
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required for authentication',
          statusCode: 400,
        });
      }

      // PRC-L445: every path below runs exactly one bcrypt comparison and every
      // failure that is not backed by the correct password returns the same
      // INVALID_CREDENTIALS response, so neither timing nor the response body
      // tells a caller whether the account exists, is locked or is inactive.
      const user = await userLookup.findByUsername(username, tenantId);
      const locked =
        user && lockoutService
          ? (await lockoutService.isAccountLocked(user.id, tenantId)).isLocked
          : false;
      // A locked account never evaluates its real password (no guessing oracle
      // while locked); unknown users compare against a fixed dummy hash.
      const hashToCompare = user && !locked ? user.passwordHash : await dummyPasswordHash();
      const passwordMatches = await verifyPassword(password, hashToCompare);
      const isValid = Boolean(user) && !locked && passwordMatches;
      if (!user || !isValid) {
        if (user && !locked && lockoutService) {
          await lockoutService.recordFailure(user.id, tenantId, request.ip);
        }
        return reply.status(401).send(INVALID_CREDENTIALS_BODY);
      }

      // Account state is disclosed only to a caller that proved the password.
      if (!user.isActive) {
        return reply.status(401).send({
          code: 'ACCOUNT_INACTIVE',
          message: 'Account is inactive',
          statusCode: 401,
        });
      }

      // Successful authentication - reset failure counter
      if (lockoutService) {
        await lockoutService.resetOnSuccess(user.id, tenantId);
      }

      // Create session
      const session = await sessionService.createSession(user.id, tenantId, {
        userAgent: request.headers['user-agent'],
        ipAddress: request.ip,
      });

      // Build AuthUser
      const authUser: AuthUser = {
        userId: user.id,
        tenantId: user.tenantId,
        email: user.email,
        displayName: user.displayName,
        roles: user.roles,
        areas: user.areas,
        institutions: user.institutions,
      };

      // Issue token pair
      const tokens = await tokenService.issueTokenPair(authUser, session.id, request.ip);

      return reply.status(200).send({
        tokens,
        session: {
          id: session.id,
          expiresAt: session.expiresAt.toISOString(),
        },
        user: authUser,
      });
    },
  );

  /**
   * POST /auth/refresh
   * Refresh token pair using a valid refresh token.
   * Implements token rotation: old token is revoked, new pair is issued.
   */
  fastify.post(
    `${prefix}/refresh`,
    async function refreshHandler(
      request: FastifyRequest<{ Body: RefreshRequest }>,
      reply: FastifyReply,
    ) {
      const { refreshToken } = request.body;

      if (!refreshToken) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Refresh token is required',
          statusCode: 400,
          errors: [
            { field: 'refreshToken', rule: 'required', message: 'Refresh token is required' },
          ],
        });
      }

      const tenantId = (request as FastifyRequest & { tenantId?: string }).tenantId;
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      try {
        // Look up the stored refresh token to get the userId
        const storedToken = await refreshTokenStore.findByToken(refreshToken);
        if (!storedToken) {
          throw new InvalidRefreshTokenError('Refresh token not found');
        }

        // Handle expired or revoked refresh tokens: invalidate all session tokens
        if (storedToken.revoked || storedToken.expiresAt < new Date()) {
          // Invalidate all tokens for this session
          await tokenService.revokeAllSessionTokens(
            storedToken.sessionId,
            storedToken.revoked ? 'Revoked token reuse' : 'Expired token reuse',
          );
          // Invalidate the session itself
          await sessionService.invalidateSession(storedToken.sessionId);

          const reason = storedToken.revoked
            ? 'Refresh token has been revoked'
            : 'Refresh token has expired';
          return reply.status(401).send({
            code: 'INVALID_REFRESH_TOKEN',
            message: reason + '. All session tokens have been invalidated. Please re-authenticate.',
            statusCode: 401,
          });
        }

        // Look up user data for the new token
        const user = await userLookup.findById(storedToken.userId, tenantId);
        if (!user) {
          throw new InvalidRefreshTokenError('User not found for refresh token');
        }
        // PRC-M584: a deactivated user or an invalidated/expired session cannot
        // mint new tokens; kill the whole refresh chain when either is seen.
        const session = user.isActive
          ? await sessionService.validateSession(storedToken.sessionId)
          : null;
        if (!session || session.userId !== storedToken.userId) {
          await tokenService.revokeAllSessionTokens(
            storedToken.sessionId,
            user.isActive ? 'Session no longer valid' : 'User deactivated',
          );
          return reply.status(401).send({
            code: 'INVALID_REFRESH_TOKEN',
            message: user.isActive
              ? 'Session is no longer valid. Please re-authenticate.'
              : 'Account is inactive',
            statusCode: 401,
          });
        }

        const authUser: AuthUser = {
          userId: user.id,
          tenantId: user.tenantId,
          email: user.email,
          displayName: user.displayName,
          roles: user.roles,
          areas: user.areas,
          institutions: user.institutions,
        };

        // Perform token rotation (validates, revokes old, issues new)
        // PRC-M584: the rotation chain never outlives the session.
        const tokens = await tokenService.refreshTokenPair(refreshToken, authUser, request.ip, {
          notAfter: session.expiresAt,
        });

        return reply.status(200).send({ tokens });
      } catch (error: unknown) {
        if (error instanceof InvalidRefreshTokenError) {
          return reply.status(401).send({
            code: 'INVALID_REFRESH_TOKEN',
            message: error.message,
            statusCode: 401,
          });
        }
        throw error;
      }
    },
  );

  /**
   * POST /auth/logout
   * Invalidate session, revoke refresh tokens, and denylist access jti/sid (W1-SEC-09).
   */
  fastify.post(
    `${prefix}/logout`,
    { preHandler: [fastify.authenticate] },
    async function logoutHandler(request: FastifyRequest, reply: FastifyReply) {
      const user = request.user;

      // Invalidate the session
      await sessionService.invalidateSession(user.sessionId);

      // Revoke all refresh tokens for this session (also denylists sid via TokenService when wired)
      await tokenService.revokeAllSessionTokens(user.sessionId, 'User logout');

      // Explicit jti + sid denylist so outstanding bearers fail closed immediately
      const store = accessTokenRevocationStore ?? fastify.accessTokenRevocationStore;
      if (store) {
        await revokeAccessTokenIdentifiers(
          store,
          { jti: user.jti, sessionId: user.sessionId },
          defaultAccessTokenRevocationTtlSeconds(accessTokenExpiresIn),
        );
      }

      return reply.status(200).send({
        message: 'Logged out successfully',
      });
    },
  );

  /**
   * GET /auth/me
   * Get current authenticated user information.
   */
  fastify.get(
    `${prefix}/me`,
    { preHandler: [fastify.authenticate] },
    async function meHandler(request: FastifyRequest, reply: FastifyReply) {
      const jwtUser = request.user;

      // Validate session is still active
      const session = await sessionService.validateSession(jwtUser.sessionId);
      if (!session) {
        return reply.status(401).send({
          code: 'SESSION_EXPIRED',
          message: 'Session has expired or been invalidated',
          statusCode: 401,
        });
      }

      // Look up fresh user data
      const user = await userLookup.findById(jwtUser.sub, jwtUser.tenantId);
      if (!user) {
        return reply.status(401).send({
          code: 'USER_NOT_FOUND',
          message: 'User not found',
          statusCode: 401,
        });
      }

      return reply.status(200).send({
        userId: user.id,
        tenantId: user.tenantId,
        email: user.email,
        displayName: user.displayName,
        roles: user.roles,
        areas: user.areas,
        institutions: user.institutions,
      });
    },
  );
}
