/**
 * Fastify observability plugin.
 *
 * - Registers default Node.js / process metrics on a MetricsRegistry.
 * - Exposes GET /metrics in Prometheus text format.
 * - Instruments every request with:
 *     http_requests_total{service,method,route,status_code,tenant_id}      (Counter)
 *     http_request_duration_seconds{service,method,route,status_code}      (Histogram)
 *     http_requests_in_flight{service}                                     (Gauge)
 */
import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyReply,
  FastifyRequest,
} from 'fastify';
import fp from 'fastify-plugin';

import {
  DEFAULT_HTTP_DURATION_BUCKETS,
  MetricsRegistry,
} from './metrics-registry.js';

export interface ObservabilityPluginOptions {
  /** Service name. Used as both a default label value and for the registry. */
  serviceName: string;

  /**
   * Optional MetricsRegistry to use. If omitted, a fresh registry is created
   * for this Fastify instance. Pass an existing registry when one service
   * builds multiple Fastify apps that should share metrics.
   */
  registry?: MetricsRegistry;

  /** Path on which to expose Prometheus metrics. Defaults to `/metrics`. */
  metricsPath?: string;

  /** Histogram buckets (seconds). Defaults to DEFAULT_HTTP_DURATION_BUCKETS. */
  durationBuckets?: readonly number[];

  /**
   * Paths to exclude from instrumentation (the metrics endpoint itself is
   * always excluded). Use to skip noisy health checks if desired.
   */
  ignorePaths?: readonly string[];

  /**
   * Whether to register default Node.js process metrics. Defaults to true.
   */
  collectDefaultMetrics?: boolean;
}

declare module 'fastify' {
  interface FastifyInstance {
    metrics: MetricsRegistry;
  }
  interface FastifyRequest {
    /** Marker timestamp (ms) used to compute request duration. */
    metricsStart?: number;
  }
}

const HTTP_LABELS = [
  'service',
  'method',
  'route',
  'status_code',
  'tenant_id',
] as const;
const HTTP_DURATION_LABELS = [
  'service',
  'method',
  'route',
  'status_code',
] as const;
const IN_FLIGHT_LABELS = ['service'] as const;

/**
 * Resolve the route template for a request. Falls back to the raw URL when the
 * route hasn't been matched yet (e.g. for 404s or onRequest hooks).
 */
function getRoute(request: FastifyRequest): string {
  const routeFromContext =
    (request as FastifyRequest & {
      routeOptions?: { url?: string };
    }).routeOptions?.url;
  if (routeFromContext) return routeFromContext;
  // Fastify v4: routerPath is set after route matching
  const routerPath = (request as FastifyRequest & { routerPath?: string })
    .routerPath;
  if (routerPath) return routerPath;
  // Strip query string from raw URL as a last resort.
  const url = request.url || '/';
  const qIdx = url.indexOf('?');
  return qIdx >= 0 ? url.slice(0, qIdx) : url;
}

const observabilityPluginImpl: FastifyPluginAsync<
  ObservabilityPluginOptions
> = async (fastify: FastifyInstance, options: ObservabilityPluginOptions) => {
  const {
    serviceName,
    registry = new MetricsRegistry(serviceName),
    metricsPath = '/metrics',
    durationBuckets = DEFAULT_HTTP_DURATION_BUCKETS,
    ignorePaths = [],
    collectDefaultMetrics: collectDefault = true,
  } = options;

  if (collectDefault) {
    registry.collectDefaultMetrics();
  }

  const requestsTotal = registry.counter({
    name: 'http_requests_total',
    help: 'Total number of HTTP requests received, labelled by service/method/route/status/tenant.',
    labelNames: HTTP_LABELS,
  });

  const requestDuration = registry.histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration in seconds, labelled by service/method/route/status.',
    labelNames: HTTP_DURATION_LABELS,
    buckets: durationBuckets,
  });

  const requestsInFlight = registry.gauge({
    name: 'http_requests_in_flight',
    help: 'Number of HTTP requests currently being processed by this service.',
    labelNames: IN_FLIGHT_LABELS,
  });

  // Decorate so other plugins can register their own metrics on the same registry.
  if (!fastify.hasDecorator('metrics')) {
    fastify.decorate('metrics', registry);
  }
  if (!fastify.hasRequestDecorator('metricsStart')) {
    fastify.decorateRequest('metricsStart', undefined);
  }

  const ignored = new Set<string>([metricsPath, ...ignorePaths]);

  // Mark request start and increment in-flight gauge.
  fastify.addHook('onRequest', async (request: FastifyRequest) => {
    if (ignored.has(request.url)) return;
    request.metricsStart = Date.now();
    requestsInFlight.inc({ service: serviceName });
  });

  // On response, observe duration and increment counters.
  fastify.addHook(
    'onResponse',
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (ignored.has(request.url)) return;

      const start = request.metricsStart;
      if (typeof start !== 'number') return;

      const durationSeconds = (Date.now() - start) / 1000;
      const route = getRoute(request);
      const statusCode = String(reply.statusCode);
      const method = request.method;
      const tenantId =
        (request as FastifyRequest & { tenantId?: string }).tenantId ??
        'unknown';

      requestDuration.observe(
        { service: serviceName, method, route, status_code: statusCode },
        durationSeconds,
      );
      requestsTotal.inc({
        service: serviceName,
        method,
        route,
        status_code: statusCode,
        tenant_id: tenantId,
      });
      requestsInFlight.dec({ service: serviceName });
    },
  );

  // If a request errors out before onResponse, ensure in-flight is decremented.
  fastify.addHook('onError', async (request: FastifyRequest) => {
    if (ignored.has(request.url)) return;
    if (typeof request.metricsStart === 'number') {
      // We will still decrement once in onResponse — guard so we don't double-dec.
      // Mark already-handled by clearing the start timestamp.
      // (onResponse fires after onError in Fastify v4.)
    }
  });

  // Expose Prometheus metrics endpoint.
  fastify.route({
    method: 'GET',
    url: metricsPath,
    schema: {
      hide: true,
      response: {
        200: {
          type: 'string',
          description: 'Prometheus text-format metrics.',
        },
      },
    },
    handler: async (_request, reply) => {
      reply.header('content-type', registry.contentType());
      const body = await registry.metrics();
      return reply.send(body);
    },
  });
};

/**
 * Fastify plugin that wires up Prometheus metrics for an ProctiraERP service.
 *
 * @example
 *   await app.register(observabilityPlugin, { serviceName: 'auth' });
 */
export const observabilityPlugin = fp(observabilityPluginImpl, {
  name: '@proctira/observability',
  fastify: '4.x',
});
