/**
 * Fastify Auth Plugin
 *
 * Registers local JWT verification and provides protected-route and logout-
 * specific authenticators. Logout verifies the signature while deliberately
 * allowing an already-denylisted bearer to retry an idempotent logout.
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

export interface AuthPluginOptions {
  config: AuthConfig;
  excludePaths?: string[];
  revocationStore?: AccessTokenRevocationStore;
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** Signature/claims verification for the idempotent POST logout boundary. */
    authenticateLogout: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    accessTokenRevocationStore: AccessTokenRevocationStore;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: JwtPayload;
    user: JwtPayload;
  }
}

function isExcludedPath(path: string, excludePaths: string[]): boolean {
  const requestPath = path.split('?')[0]!;
  for (const excluded of excludePaths) {
    if (excluded.endsWith('/*')) {
      const prefix = excluded.slice(0, -2);
      if (requestPath.startsWith(prefix)) return true;
    } else if (requestPath === excluded) {
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

    const verifySignedBearer = async (
      request: FastifyRequest,
      reply: FastifyReply,
    ): Promise<boolean> => {
      try {
        await request.jwtVerify();
        if (request.user.tenantId) {
          (request as FastifyRequest & { tenantId?: string }).tenantId = request.user.tenantId;
        }
        return true;
      } catch {
        reply.status(401).send({
          code: 'UNAUTHORIZED',
          message: 'Invalid or expired access token',
          statusCode: 401,
        });
        return false;
      }
    };

    fastify.decorate(
      'authenticateLogout',
      async function authenticateLogoutHandler(request: FastifyRequest, reply: FastifyReply) {
        await verifySignedBearer(request, reply);
      },
    );

    fastify.decorate(
      'authenticate',
      async function authenticateHandler(request: FastifyRequest, reply: FastifyReply) {
        if (isExcludedPath(request.url, excludePaths)) return;
        if (!(await verifySignedBearer(request, reply))) return;

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
      },
    );
  },
  {
    name: '@proctira/backend-auth',
    fastify: '5.x',
    dependencies: [],
  },
);
