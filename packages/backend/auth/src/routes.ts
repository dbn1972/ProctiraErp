/**
 * Auth Routes
 *
 * POST /auth/login   - Authenticate with local credentials
 * POST /auth/refresh - Refresh token pair using refresh token
 * POST /auth/logout  - Invalidate session and revoke tokens
 * GET  /auth/me      - Get current authenticated user info
 */
import type { LoginRequest, RefreshRequest, AuthUser } from '@proctira/auth';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

import type { AccountLockoutService } from './lockout-service.js';
import { verifyPassword } from './local-auth.js';
import type { SessionService } from './session-service.js';
import { InvalidRefreshTokenError } from './token-service.js';
import type { RefreshTokenStore , TokenService} from './token-service.js';

/**
 * Interface for user lookup (provided by the consuming application).
 */
export interface UserLookup {
  /** Find a user by username/email within a tenant */
  findByUsername(username: string, tenantId: string): Promise<{
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
  findById(userId: string, tenantId: string): Promise<{
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
      const { username, password } = request.body;

      if (!username || !password) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Username and password are required',
          statusCode: 400,
          errors: [
            ...(!username ? [{ field: 'username', rule: 'required', message: 'Username is required' }] : []),
            ...(!password ? [{ field: 'password', rule: 'required', message: 'Password is required' }] : []),
          ],
        });
      }

      // Resolve tenant from request (set by tenant plugin)
      const tenantId = (request as FastifyRequest & { tenantId?: string }).tenantId;
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required for authentication',
          statusCode: 400,
        });
      }

      // Look up user
      const user = await userLookup.findByUsername(username, tenantId);
      if (!user) {
        return reply.status(401).send({
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid username or password',
          statusCode: 401,
        });
      }

      if (!user.isActive) {
        return reply.status(401).send({
          code: 'ACCOUNT_INACTIVE',
          message: 'Account is inactive',
          statusCode: 401,
        });
      }

      // Check if account is locked
      if (lockoutService) {
        const lockoutStatus = await lockoutService.isAccountLocked(user.id, tenantId);
        if (lockoutStatus.isLocked) {
          return reply.status(401).send({
            code: 'ACCOUNT_LOCKED',
            message: 'Account is temporarily locked due to too many failed login attempts',
            statusCode: 401,
            lockedUntil: lockoutStatus.expiresAt?.toISOString(),
          });
        }
      }

      // Verify password
      const isValid = await verifyPassword(password, user.passwordHash);
      if (!isValid) {
        // Record the failed attempt
        if (lockoutService) {
          const lockoutStatus = await lockoutService.recordFailure(user.id, tenantId, request.ip);
          if (lockoutStatus.isLocked) {
            return reply.status(401).send({
              code: 'ACCOUNT_LOCKED',
              message: 'Account is temporarily locked due to too many failed login attempts',
              statusCode: 401,
              lockedUntil: lockoutStatus.expiresAt?.toISOString(),
            });
          }
        }
        return reply.status(401).send({
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid username or password',
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
          errors: [{ field: 'refreshToken', rule: 'required', message: 'Refresh token is required' }],
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
        const tokens = await tokenService.refreshTokenPair(
          refreshToken,
          authUser,
          request.ip,
        );

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
   * Invalidate session and revoke refresh token.
   */
  fastify.post(
    `${prefix}/logout`,
    { preHandler: [fastify.authenticate] },
    async function logoutHandler(
      request: FastifyRequest,
      reply: FastifyReply,
    ) {
      const user = request.user;

      // Invalidate the session
      await sessionService.invalidateSession(user.sessionId);

      // Revoke all refresh tokens for this session
      await tokenService.revokeAllSessionTokens(user.sessionId, 'User logout');

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
    async function meHandler(
      request: FastifyRequest,
      reply: FastifyReply,
    ) {
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
