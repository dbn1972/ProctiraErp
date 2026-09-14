/**
 * Fastify hooks for distributed tracing (W1-OPS-13).
 *
 * Creates a SERVER span per request with W3C Trace Context extraction from
 * incoming headers and injection into response / downstream carriers.
 * Complements `@opentelemetry/instrumentation-http` (Node HTTP server spans)
 * by attaching the Fastify route template as `http.route`.
 */
import {
  context,
  propagation,
  trace,
  SpanKind,
  SpanStatusCode,
  type Span,
  type Context,
} from '@opentelemetry/api';
import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

import { initTracing, type TracingEnv } from './tracing.js';

export interface TracingPluginOptions {
  serviceName: string;
  /** Paths excluded from span creation (health/metrics). */
  ignorePaths?: readonly string[];
  /** Env override for initTracing (tests). */
  env?: TracingEnv;
  /**
   * When false, skip ensure-init (caller already called initTracing).
   * Defaults to true so standalone backends get a noop/OTLP provider.
   */
  ensureInit?: boolean;
}

declare module 'fastify' {
  interface FastifyRequest {
    otelSpan?: Span;
    otelContext?: Context;
  }
}

function pathOnly(url: string): string {
  const q = url.indexOf('?');
  return q >= 0 ? url.slice(0, q) : url;
}

function getRouteTemplate(request: FastifyRequest): string {
  const routeFromContext = (
    request as FastifyRequest & {
      routeOptions?: { url?: string };
    }
  ).routeOptions?.url;
  if (routeFromContext) return routeFromContext;
  const routerPath = (request as FastifyRequest & { routerPath?: string }).routerPath;
  if (routerPath) return routerPath;
  return pathOnly(request.url || '/');
}

function headerCarrier(request: FastifyRequest): Record<string, string | string[] | undefined> {
  return request.headers as Record<string, string | string[] | undefined>;
}

const tracingPluginImpl: FastifyPluginAsync<TracingPluginOptions> = async (
  fastify: FastifyInstance,
  options: TracingPluginOptions,
) => {
  const { serviceName, ignorePaths = [], env, ensureInit = true } = options;

  if (ensureInit) {
    initTracing({ serviceName, env, enableHttpInstrumentation: true });
  }

  const ignored = new Set<string>(ignorePaths);
  const tracer = trace.getTracer(`proctira.${serviceName}`);

  if (!fastify.hasRequestDecorator('otelSpan')) {
    fastify.decorateRequest('otelSpan', undefined);
  }
  if (!fastify.hasRequestDecorator('otelContext')) {
    fastify.decorateRequest('otelContext', undefined);
  }

  fastify.addHook('onRequest', async (request: FastifyRequest) => {
    const path = pathOnly(request.url || '/');
    if (ignored.has(path) || ignored.has(request.url)) return;

    const parentCtx = propagation.extract(context.active(), headerCarrier(request), {
      get(carrier, key) {
        const v = carrier[key] ?? carrier[key.toLowerCase()];
        if (Array.isArray(v)) return v.join(',');
        return typeof v === 'string' ? v : undefined;
      },
      keys(carrier) {
        return Object.keys(carrier);
      },
    });

    const span = tracer.startSpan(
      `HTTP ${request.method}`,
      {
        kind: SpanKind.SERVER,
        attributes: {
          'http.method': request.method,
          'http.target': path,
          'service.name': serviceName,
        },
      },
      parentCtx,
    );

    const spanCtx = trace.setSpan(parentCtx, span);
    request.otelSpan = span;
    request.otelContext = spanCtx;
  });

  fastify.addHook('onResponse', async (request: FastifyRequest, reply: FastifyReply) => {
    const span = request.otelSpan;
    if (!span) return;

    const route = getRouteTemplate(request);
    span.setAttribute('http.route', route);
    span.setAttribute('http.status_code', reply.statusCode);
    if (reply.statusCode >= 500) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: `HTTP ${reply.statusCode}` });
    } else {
      span.setStatus({ code: SpanStatusCode.OK });
    }

    // Propagate traceparent on the response for clients that echo it.
    const carrier: Record<string, string> = {};
    const ctx = request.otelContext ?? context.active();
    propagation.inject(ctx, carrier, {
      set(c, key, value) {
        c[key] = value;
      },
    });
    if (carrier['traceparent']) {
      void reply.header('traceparent', carrier['traceparent']);
    }
    if (carrier['tracestate']) {
      void reply.header('tracestate', carrier['tracestate']);
    }

    span.end();
  });

  fastify.addHook('onError', async (request: FastifyRequest, _reply, error) => {
    const span = request.otelSpan;
    if (!span) return;
    span.recordException(error);
    span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
  });
};

/**
 * Fastify plugin: HTTP SERVER spans + W3C context propagation.
 *
 * @example
 *   await app.register(tracingPlugin, { serviceName: 'api-gateway' });
 */
export const tracingPlugin = fp(tracingPluginImpl, {
  name: '@proctira/observability-tracing',
  fastify: '5.x',
});
