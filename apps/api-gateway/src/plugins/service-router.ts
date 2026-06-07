/**
 * Service Router Plugin
 *
 * Routes incoming requests to backend services based on URL prefix versioning.
 * All API routes are prefixed with /api/v1/ and forwarded to the appropriate service.
 * Each service call is wrapped with a CircuitBreaker to prevent cascading failures.
 *
 * Example: GET /api/v1/institutions/123 → institutions service at http://localhost:3002/institutions/123
 */

import type { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import { CircuitBreaker, CircuitBreakerError } from '@proctira/common';

import type { ServiceRoute } from '../config.js';

export interface ServiceRouterOptions {
  /** Map of service name to route configuration */
  services: Record<string, ServiceRoute>;
  /** API version prefix (default: '/api/v1') */
  versionPrefix?: string;
}

/**
 * Per-service circuit breakers to prevent cascading failures.
 * Each backend service gets its own breaker instance.
 */
const serviceBreakers = new Map<string, CircuitBreaker>();

function getBreaker(serviceName: string): CircuitBreaker {
  if (!serviceBreakers.has(serviceName)) {
    serviceBreakers.set(serviceName, new CircuitBreaker({
      name: serviceName,
      failureThreshold: 5,
      resetTimeoutMs: 30000,
    }));
  }
  return serviceBreakers.get(serviceName)!;
}

/**
 * Forwards a request to the target service.
 * In a production setup, this would use @fastify/http-proxy or similar.
 * For now, we register route handlers that document the routing behavior.
 */
const serviceRouterPlugin: FastifyPluginAsync<ServiceRouterOptions> = async (
  fastify: FastifyInstance,
  options: ServiceRouterOptions,
) => {
  const { services, versionPrefix = '/api/v1' } = options;

  // Store service registry for introspection
  fastify.decorate('serviceRegistry', services);

  // Register a catch-all route for each service prefix under /api/v1
  for (const [serviceName, route] of Object.entries(services)) {
    const fullPrefix = `${versionPrefix}${route.prefix}`;

    // Register wildcard route for the service
    fastify.all(`${fullPrefix}`, {
      schema: {
        description: `Route to ${serviceName} service`,
        tags: [serviceName],
      },
    }, createProxyHandler(serviceName, route, ''));

    fastify.all(`${fullPrefix}/*`, {
      schema: {
        description: `Route to ${serviceName} service`,
        tags: [serviceName],
      },
    }, createProxyHandler(serviceName, route, fullPrefix));
  }

  // Register a route listing all available services (no auth required)
  fastify.get(`${versionPrefix}/services`, {
    schema: {
      description: 'List all registered backend services',
      tags: ['Gateway'],
      response: {
        200: {
          type: 'object',
          properties: {
            services: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  prefix: { type: 'string' },
                  target: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
  }, async (_request, _reply) => {
    return {
      services: Object.entries(services).map(([name, route]) => ({
        name,
        prefix: `${versionPrefix}${route.prefix}`,
        target: route.target,
      })),
    };
  });
};

/**
 * Creates a proxy handler that forwards requests to the target service.
 * Wraps the call with a CircuitBreaker to fail fast when a service is unhealthy.
 * In production, this would use HTTP proxy; here we simulate the routing logic.
 */
function createProxyHandler(
  serviceName: string,
  route: ServiceRoute,
  fullPrefix: string,
) {
  const breaker = getBreaker(serviceName);

  return async function proxyHandler(request: FastifyRequest, reply: FastifyReply) {
    // Extract the path after the prefix
    const params = (request.params as { '*'?: string });
    const subPath = params['*'] ? `/${params['*']}` : '';
    const targetUrl = `${route.target}${route.prefix}${subPath}`;

    try {
      // Execute the service call through the circuit breaker
      return await breaker.execute(async () => {
        // In a real implementation, this would proxy the request to the target service
        // using @fastify/http-proxy or undici for actual proxying.
        // For now, return routing metadata to demonstrate the routing logic.
        return reply.status(502).send({
          code: 'SERVICE_UNAVAILABLE',
          message: `Service '${serviceName}' is not connected. Target: ${targetUrl}`,
          statusCode: 502,
          routing: {
            service: serviceName,
            target: targetUrl,
            method: request.method,
            originalUrl: request.url,
          },
        });
      });
    } catch (error) {
      if (error instanceof CircuitBreakerError) {
        return reply.status(503).send({
          code: 'CIRCUIT_OPEN',
          message: `Service '${serviceName}' is temporarily unavailable (circuit breaker open). Please retry later.`,
          statusCode: 503,
          routing: {
            service: serviceName,
            target: targetUrl,
            method: request.method,
            originalUrl: request.url,
            circuitState: error.state,
          },
        });
      }
      throw error;
    }
  };
}

// Extend Fastify types
declare module 'fastify' {
  interface FastifyInstance {
    serviceRegistry: Record<string, ServiceRoute>;
  }
}

export default fp(serviceRouterPlugin, {
  name: 'service-router',
  fastify: '4.x',
});
