/**
 * Fastify Auth Plugin
 *
 * Registers @fastify/jwt for token verification and provides
 * an `authenticate` decorator for protecting routes.
 * W1-SEC-09: after signature verification, access-token jti/sid revocation
 * is enforced (fail closed when revoked).
 */
import fastifyJwt from '@fastify/jwt';
import type { AuthConfig, JwtPayload } from '@proctira/auth';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';

import {
  assertAccessTokenNotRevoked,
  createAccessTokenRevocationStore,
  type AccessTokenRevocationStore,
} from './access-token-revocation.js';

/**
 * Options for the auth Fastify plugin.
 */
export interface AuthPluginOptions {
  /** Auth configuration */
  config: AuthConfig;
  /** Routes to exclude from authentication */
  excludePaths?: string[];
  /**
   * Access-token jti/sid denylist (W1-SEC-09).
   * Defaults to an in-process memory store when omitted.
   */
  revocationStore?: AccessTokenRevocationStore;
}

// Extend Fastify types
declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    accessTokenRevocationStore: AccessTokenRevocationStore;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: JwtPayload;
    user: JwtPayload;
  }
}

/**
 * Checks if a request path matches any of the excluded paths.
 */
function isExcludedPath(path: string, excludePaths: string[]): boolean {
  for (const excluded of excludePaths) {
    if (excluded.endsWith('/*')) {
      const prefix = excluded.slice(0, -2);
      if (path.startsWith(prefix)) return true;
    } else if (path === excluded) {
      return true;
    }
  }
  return false;
}

function revocationMessage(reason: string): string {
  if (reason === 'revoked_jti' || reason === 'revoked_sid') {
    return 'Access token has been revoked';
  }
  if (reason === 'store_unavailable') {
    return 'Access token revocation check unavailable';
  }
  return 'Invalid or expired access token';
}

/**
 * Fastify plugin that registers JWT verification and provides
 * an `authenticate` preHandler decorator.
 */
export const authPlugin = fp(
  async function authPluginImpl(fastify: FastifyInstance, options: AuthPluginOptions) {
    const {
      config,
      excludePaths = [
        '/health',
        '/healthz',
        '/ready',
        '/auth/login',
        '/auth/refresh',
        '/auth/external/*',
      ],
      revocationStore = createAccessTokenRevocationStore(),
    } = options;

    // Register @fastify/jwt
    await fastify.register(fastifyJwt, {
      secret: config.jwt.secret,
      sign: {
        expiresIn: config.jwt.accessTokenExpiresIn,
        iss: config.jwt.issuer,
        aud: config.jwt.audience,
      },
      verify: {
        allowedIss: config.jwt.issuer,
        allowedAud: config.jwt.audience,
      },
    });

    if (!fastify.hasDecorator('accessTokenRevocationStore')) {
      fastify.decorate('accessTokenRevocationStore', revocationStore);
    }

    // Decorate with authenticate function
    fastify.decorate(
      'authenticate',
      async function authenticateHandler(request: FastifyRequest, reply: FastifyReply) {
        // Skip excluded paths
        if (isExcludedPath(request.url, excludePaths)) {
          return;
        }

        try {
          await request.jwtVerify();

          const user = request.user;
          const revocation = await assertAccessTokenNotRevoked(
            { jti: user.jti, sessionId: user.sessionId },
            { store: revocationStore },
          );
          if (!revocation.ok) {
            return reply.status(401).send({
              code: 'TOKEN_REVOKED',
              message: revocationMessage(revocation.reason),
              statusCode: 401,
              reason: revocation.reason,
            });
          }

          // Set tenant context from JWT claim
          if (user.tenantId) {
            (request as FastifyRequest & { tenantId?: string }).tenantId = user.tenantId;
          }
        } catch {
          return reply.status(401).send({
            code: 'UNAUTHORIZED',
            message: 'Invalid or expired access token',
            statusCode: 401,
          });
        }
      },
    );
  },
  {
    name: '@proctira/backend-auth',
    fastify: '5.x',
    dependencies: [],
  },
);
