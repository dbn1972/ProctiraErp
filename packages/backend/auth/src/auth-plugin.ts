/**
 * Fastify Auth Plugin
 *
 * Registers @fastify/jwt for token verification and provides
 * an `authenticate` decorator for protecting routes.
 */
import fastifyJwt from '@fastify/jwt';
import type { AuthConfig, JwtPayload } from '@proctira/auth';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';

/**
 * Options for the auth Fastify plugin.
 */
export interface AuthPluginOptions {
  /** Auth configuration */
  config: AuthConfig;
  /** Routes to exclude from authentication */
  excludePaths?: string[];
}

// Extend Fastify types
declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
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

          // Set tenant context from JWT claim
          const user = request.user;
          if (user.tenantId) {
            (request as FastifyRequest & { tenantId?: string }).tenantId = user.tenantId;
          }
        } catch (err) {
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
