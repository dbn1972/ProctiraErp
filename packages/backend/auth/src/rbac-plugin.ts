/**
 * RBAC Fastify Plugin
 *
 * Provides a `requirePermission` preHandler decorator for route-level permission checks.
 * This plugin integrates with the shared RBAC module and the area hierarchy resolver
 * to enforce permissions at the route level.
 *
 * Usage:
 * ```typescript
 * fastify.get('/institutions/:id', {
 *   preHandler: [fastify.authenticate, fastify.requirePermission('institution', 'read')],
 * }, handler);
 * ```
 */

import type {
  AreaHierarchyResolver,
  PermissionAction,
  RbacPermissionRegistry,
  ResourceContext,
} from '@proctira/auth';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

import { evaluatePermission } from './rbac-evaluator.js';

/**
 * Options for the RBAC Fastify plugin.
 */
export interface RbacPluginOptions {
  /** The permission registry containing role definitions */
  registry: RbacPermissionRegistry;
  /** The area hierarchy resolver for scope checks */
  areaResolver: AreaHierarchyResolver;
  /**
   * Optional function to extract resource context from the request.
   * If not provided, the plugin will look for `areaId` and `institutionId`
   * in request params, query, or body.
   */
  extractResourceContext?: (request: FastifyRequest) => ResourceContext | undefined;
}

// Extend Fastify types
declare module 'fastify' {
  interface FastifyInstance {
    requirePermission: (
      resource: string,
      action: PermissionAction,
      extractContext?: (request: FastifyRequest) => ResourceContext | undefined,
    ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    rbacRegistry: RbacPermissionRegistry;
    rbacAreaResolver: AreaHierarchyResolver;
  }
}

/**
 * Default resource context extractor.
 * Looks for areaId and institutionId in params, query, and body.
 */
function defaultExtractResourceContext(request: FastifyRequest): ResourceContext | undefined {
  const params = (request.params as Record<string, unknown>) ?? {};
  const query = (request.query as Record<string, unknown>) ?? {};
  const body = (request.body as Record<string, unknown>) ?? {};

  const areaId =
    (params['areaId'] as string) ??
    (query['areaId'] as string) ??
    (body['areaId'] as string) ??
    undefined;

  const institutionId =
    (params['institutionId'] as string) ??
    (query['institutionId'] as string) ??
    (body['institutionId'] as string) ??
    undefined;

  if (!areaId && !institutionId) return undefined;

  return { areaId, institutionId };
}

/**
 * Fastify plugin that provides route-level RBAC permission checks.
 *
 * Decorates the Fastify instance with:
 * - `requirePermission(resource, action, extractContext?)` — returns a preHandler function
 * - `rbacRegistry` — the permission registry
 * - `rbacAreaResolver` — the area hierarchy resolver
 */
export const rbacPlugin = fp(
  async function rbacPluginImpl(fastify: FastifyInstance, options: RbacPluginOptions) {
    const { registry, areaResolver, extractResourceContext } = options;

    // Decorate with registry and resolver for direct access
    fastify.decorate('rbacRegistry', registry);
    fastify.decorate('rbacAreaResolver', areaResolver);

    // Decorate with requirePermission factory
    fastify.decorate(
      'requirePermission',
      function requirePermissionFactory(
        resource: string,
        action: PermissionAction,
        extractContext?: (request: FastifyRequest) => ResourceContext | undefined,
      ) {
        return async function requirePermissionHandler(
          request: FastifyRequest,
          reply: FastifyReply,
        ): Promise<void> {
          // Ensure user is authenticated (JWT verified)
          const user = request.user;
          if (!user) {
            return reply.status(401).send({
              code: 'UNAUTHORIZED',
              message: 'Authentication required',
              statusCode: 401,
            });
          }

          // Build AuthUser from JWT payload
          const authUser = {
            userId: user.sub,
            tenantId: user.tenantId,
            email: user.email,
            displayName: user.displayName,
            roles: user.roles,
            areas: user.areas,
            institutions: user.institutions,
          };

          // Extract resource context
          const contextExtractor =
            extractContext ?? extractResourceContext ?? defaultExtractResourceContext;
          const resourceContext = contextExtractor(request);

          // Evaluate permission
          const result = await evaluatePermission(
            authUser,
            resource,
            action,
            registry,
            areaResolver,
            resourceContext,
          );

          if (!result.granted) {
            return reply.status(403).send({
              code: 'FORBIDDEN',
              message: result.reason,
              statusCode: 403,
            });
          }

          // Permission granted — continue to route handler
        };
      },
    );
  },
  {
    name: '@proctira/rbac',
    fastify: '4.x',
    dependencies: ['@proctira/backend-auth'],
  },
);
