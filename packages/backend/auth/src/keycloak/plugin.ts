import type { JwtPayload } from '@proctira/auth';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';

import {
  assertAccessTokenNotRevoked,
  createAccessTokenRevocationStore,
  type AccessTokenRevocationStore,
} from '../access-token-revocation.js';

import {
  identityInputFromClaims,
  linkKeycloakIdentity,
  type KeycloakIdentityStore,
} from './identity.js';
import {
  KeycloakJwksClient,
  KeycloakTokenError,
  decodeJwt,
  type KeycloakAuthConfig,
  verifyKeycloakAccessToken,
} from './verify.js';

export interface KeycloakAuthPluginOptions {
  config: KeycloakAuthConfig;
  excludePaths?: string[];
  identityStore?: KeycloakIdentityStore;
  /**
   * Access-token jti/sid denylist (W1-SEC-09).
   * Defaults via {@link createAccessTokenRevocationStore}: production requires
   * a shared store (fails closed without Redis / emergency allow).
   */
  revocationStore?: AccessTokenRevocationStore;
}

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

function readBearer(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) return undefined;
  return header.slice('Bearer '.length).trim() || undefined;
}

export const keycloakAuthPlugin = fp(
  async function keycloakAuthPluginImpl(
    fastify: FastifyInstance,
    options: KeycloakAuthPluginOptions,
  ) {
    const jwks = new KeycloakJwksClient(options.config.jwksUri);
    const revocationStore = options.revocationStore ?? createAccessTokenRevocationStore();

    // Fastify 5 decorateRequest requires a concrete default (GetterSetter).
    // Handlers overwrite `request.user` after JWT verification.
    fastify.decorateRequest('user', null as unknown as JwtPayload);

    if (!fastify.hasDecorator('accessTokenRevocationStore')) {
      fastify.decorate('accessTokenRevocationStore', revocationStore);
    }

    fastify.decorate(
      'authenticate',
      async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
        const token = readBearer(request);
        if (!token) {
          return reply.status(401).send({
            code: 'UNAUTHORIZED',
            message: 'Missing Keycloak access token',
            statusCode: 401,
          });
        }
        try {
          const payload = await hydrateKeycloakUser(token, options, jwks, request);
          const revocation = await assertAccessTokenNotRevoked(
            { jti: payload.jti, sessionId: payload.sessionId },
            { store: revocationStore },
          );
          if (!revocation.ok) {
            return reply.status(401).send({
              code: 'TOKEN_REVOKED',
              message:
                revocation.reason === 'store_unavailable'
                  ? 'Access token revocation check unavailable'
                  : 'Access token has been revoked',
              statusCode: 401,
              reason: revocation.reason,
            });
          }
          (request as FastifyRequest & { user: JwtPayload }).user = payload;
        } catch (error) {
          const message =
            error instanceof KeycloakTokenError ? error.message : 'Invalid Keycloak token';
          return reply.status(401).send({
            code: 'UNAUTHORIZED',
            message,
            statusCode: 401,
          });
        }
      },
    );

    fastify.decorateRequest(
      'jwtVerify',
      async function jwtVerify(this: FastifyRequest): Promise<JwtPayload> {
        const token = readBearer(this);
        if (!token) throw new KeycloakTokenError('Missing Keycloak access token');
        const payload = await hydrateKeycloakUser(token, options, jwks, this);
        const revocation = await assertAccessTokenNotRevoked(
          { jti: payload.jti, sessionId: payload.sessionId },
          { store: revocationStore },
        );
        if (!revocation.ok) {
          throw new KeycloakTokenError(
            revocation.reason === 'store_unavailable'
              ? 'Access token revocation check unavailable'
              : 'Access token has been revoked',
          );
        }
        (this as FastifyRequest & { user: JwtPayload }).user = payload;
        return payload;
      },
    );
  },
  { name: 'proctira-keycloak-auth', fastify: '5.x' },
);

async function hydrateKeycloakUser(
  token: string,
  options: KeycloakAuthPluginOptions,
  jwks: KeycloakJwksClient,
  request: FastifyRequest,
): Promise<JwtPayload> {
  const payload = await verifyKeycloakAccessToken(token, options.config, jwks);
  if (options.identityStore) {
    try {
      const linked = await linkKeycloakIdentity(
        identityInputFromClaims(decodeJwt(token).payload, options.config.realm),
        options.identityStore,
      );
      payload.sub = linked.userId;
      payload.tenantId = linked.tenantId;
      payload.email = linked.email;
      payload.displayName = linked.displayName;
      payload.areas = linked.tenantId ? [{ areaId: 'ROOT', level: 0 }] : [];
    } catch (error) {
      request.log.warn(
        { err: error },
        'Failed to project Keycloak user onto local tenant identity',
      );
    }
  }
  if (payload.tenantId) {
    (request as FastifyRequest & { tenantId?: string }).tenantId = payload.tenantId;
  }
  return payload;
}

export { isExcludedPath };
