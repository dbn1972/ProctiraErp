/**
 * Service Router Plugin
 *
 * Routes incoming requests to backend services based on URL prefix versioning.
 * All API routes are prefixed with /api/v1/ and forwarded to the appropriate service.
 * Each service call is wrapped with a CircuitBreaker to prevent cascading failures.
 *
 * Example: GET /api/v1/institutions/123 → institutions service at http://localhost:3002/institutions/123
 */

import { CircuitBreaker, CircuitBreakerError } from '@proctira/common';
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';

import type { ServiceRoute } from '../config.js';
import { PLATFORM_ADMIN_ROLE_IDS } from '../rbac-registry.js';

export interface ServiceRouterOptions {
  /** Map of service name to route configuration */
  services: Record<string, ServiceRoute>;
  /** API version prefix (default: '/api/v1') */
  versionPrefix?: string;
  /**
   * Route prefixes (e.g. '/students') already served in-process by a domain
   * plugin. The router skips registering proxy routes for these to avoid
   * conflicting with the in-process handlers.
   */
  excludePrefixes?: string[];
}

/**
 * Per-service circuit breakers to prevent cascading failures.
 * Each backend service gets its own breaker instance.
 */
const serviceBreakers = new Map<string, CircuitBreaker>();

function getBreaker(serviceName: string): CircuitBreaker {
  if (!serviceBreakers.has(serviceName)) {
    serviceBreakers.set(
      serviceName,
      new CircuitBreaker({
        name: serviceName,
        failureThreshold: 5,
        resetTimeoutMs: 30000,
      }),
    );
  }
  return serviceBreakers.get(serviceName)!;
}

/** Default upstream request timeout. */
const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Hop-by-hop headers that must not be forwarded between connections
 * (RFC 7230 §6.1), plus length/encoding headers that the runtime recomputes.
 */
const STRIP_REQUEST_HEADERS = new Set<string>([
  'host',
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'content-length',
  'expect',
]);

const STRIP_RESPONSE_HEADERS = new Set<string>([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'content-encoding', // fetch() already decodes the body
  'content-length', // recomputed by Fastify on send
]);

/**
 * Forwards a request to the target service using the runtime's global `fetch`
 * (undici on Node 18+), wrapped in a per-service circuit breaker.
 */
const serviceRouterPlugin: FastifyPluginAsync<ServiceRouterOptions> = async (
  fastify: FastifyInstance,
  options: ServiceRouterOptions,
) => {
  const { services, versionPrefix = '/api/v1', excludePrefixes = [] } = options;
  const excluded = new Set(excludePrefixes);

  // Store service registry for introspection
  fastify.decorate('serviceRegistry', services);

  // Register a catch-all route for each service prefix under /api/v1
  for (const [serviceName, route] of Object.entries(services)) {
    // Skip domains already served in-process by a domain plugin.
    if (excluded.has(route.prefix)) continue;

    const fullPrefix = `${versionPrefix}${route.prefix}`;

    // Register wildcard route for the service
    fastify.all(
      `${fullPrefix}`,
      {
        schema: {
          description: `Route to ${serviceName} service`,
          tags: [serviceName],
        },
      },
      createProxyHandler(serviceName, route, ''),
    );

    fastify.all(
      `${fullPrefix}/*`,
      {
        schema: {
          description: `Route to ${serviceName} service`,
          tags: [serviceName],
        },
      },
      createProxyHandler(serviceName, route, fullPrefix),
    );
  }

  // Register a route listing registered services. G-713: JWT required (gateway
  // auth hook); upstream `target` URLs are shown only to platform admins.
  fastify.get(
    `${versionPrefix}/services`,
    {
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
    },
    async (request, _reply) => {
      const roles = (request as { user?: { roles?: Array<string | { roleId: string }> } }).user
        ?.roles;
      const revealTargets = Array.isArray(roles)
        ? roles.some((r) => PLATFORM_ADMIN_ROLE_IDS.has(typeof r === 'string' ? r : r.roleId))
        : false;
      return {
        services: Object.entries(services).map(([name, route]) => ({
          name,
          prefix: `${versionPrefix}${route.prefix}`,
          ...(revealTargets ? { target: route.target } : {}),
        })),
      };
    },
  );
};

/** Build the outbound headers, dropping hop-by-hop entries. */
function buildForwardHeaders(request: FastifyRequest): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    if (STRIP_REQUEST_HEADERS.has(key.toLowerCase())) continue;
    out[key] = Array.isArray(value) ? value.join(', ') : value;
  }
  // Preserve the original client identity for downstream services / audit.
  const xff = request.headers['x-forwarded-for'];
  out['x-forwarded-for'] = xff
    ? `${Array.isArray(xff) ? xff.join(', ') : xff}, ${request.ip}`
    : request.ip;
  return out;
}

/** Serialize the (already-parsed) request body for forwarding. */
function buildForwardBody(request: FastifyRequest): BodyInit | undefined {
  const method = request.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD') return undefined;
  const body = request.body;
  if (body === undefined || body === null) return undefined;
  if (typeof body === 'string' || body instanceof Buffer || body instanceof Uint8Array) {
    return body as BodyInit;
  }
  return JSON.stringify(body);
}

/**
 * Creates a proxy handler that forwards requests to the target service via
 * global `fetch`, wrapped with a CircuitBreaker that fails fast (and trips)
 * on network errors / timeouts. HTTP responses (including upstream 4xx/5xx)
 * are passed through unchanged.
 */
function createProxyHandler(serviceName: string, route: ServiceRoute, _fullPrefix: string) {
  const breaker = getBreaker(serviceName);
  const timeoutMs = route.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return async function proxyHandler(request: FastifyRequest, reply: FastifyReply) {
    const params = request.params as { '*'?: string };
    const subPath = params['*'] ? `/${params['*']}` : '';
    const queryIndex = request.url.indexOf('?');
    const queryString = queryIndex >= 0 ? request.url.slice(queryIndex) : '';
    const targetUrl = `${route.target}${route.prefix}${subPath}${queryString}`;

    try {
      const upstream = await breaker.execute(async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          return await fetch(targetUrl, {
            method: request.method,
            headers: buildForwardHeaders(request),
            body: buildForwardBody(request),
            signal: controller.signal,
            redirect: 'manual',
          });
        } finally {
          clearTimeout(timer);
        }
      });

      // Mirror the upstream response back to the client.
      upstream.headers.forEach((value, key) => {
        if (!STRIP_RESPONSE_HEADERS.has(key.toLowerCase())) {
          reply.header(key, value);
        }
      });
      const buffer = Buffer.from(await upstream.arrayBuffer());
      return reply.status(upstream.status).send(buffer);
    } catch (error) {
      if (error instanceof CircuitBreakerError) {
        return reply.status(503).send({
          code: 'CIRCUIT_OPEN',
          message: `Service '${serviceName}' is temporarily unavailable (circuit breaker open). Please retry later.`,
          statusCode: 503,
        });
      }
      // Network failure / timeout / abort → bad gateway (breaker has counted it).
      request.log.error(
        { err: error, service: serviceName, target: targetUrl },
        'Upstream proxy request failed',
      );
      const isAbort = error instanceof Error && error.name === 'AbortError';
      return reply.status(isAbort ? 504 : 502).send({
        code: isAbort ? 'GATEWAY_TIMEOUT' : 'BAD_GATEWAY',
        message: isAbort
          ? `Service '${serviceName}' did not respond in time.`
          : `Service '${serviceName}' is unreachable.`,
        statusCode: isAbort ? 504 : 502,
      });
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
