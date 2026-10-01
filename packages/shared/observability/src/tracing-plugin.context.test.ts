/**
 * PRC-L354 — the HTTP SERVER span is the active context in route handlers, and
 * inbound baggage is stripped at the edge.
 */
import { propagation } from '@opentelemetry/api';
import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { initTracing, resetTracingForTests, shutdownTracing, withSpan } from './tracing.js';
import { tracingPlugin } from './tracing-plugin.js';

describe('tracingPlugin active context (PRC-L354)', () => {
  afterEach(async () => {
    await shutdownTracing();
    await resetTracingForTests();
  });

  async function setup() {
    const tracing = initTracing({
      serviceName: 'ctx-test',
      forceTestExporter: true,
      enableHttpInstrumentation: false,
    });
    const app = Fastify();
    await app.register(tracingPlugin, { serviceName: 'ctx-test', ensureInit: false });
    return { tracing, app };
  }

  for (const method of ['GET', 'POST'] as const) {
    it(`withSpan inside a ${method} handler has the HTTP SERVER span as parent`, async () => {
      const { tracing, app } = await setup();
      app.route({
        method,
        url: '/work',
        handler: async () => withSpan('child-work', async () => ({ ok: true })),
      });
      await app.ready();
      const res = await app.inject({
        method,
        url: '/work',
        ...(method === 'POST' ? { payload: { a: 1 } } : {}),
      });
      expect(res.statusCode).toBe(200);
      await app.close();
      await tracing.forceFlush();
      const spans = tracing.testExporter!.getFinishedSpans();
      const server = spans.find((s) => s.name === `HTTP ${method}`)!;
      const child = spans.find((s) => s.name === 'child-work')!;
      expect(server).toBeDefined();
      expect(child).toBeDefined();
      expect(child.spanContext().traceId).toBe(server.spanContext().traceId);
      expect(child.parentSpanContext?.spanId).toBe(server.spanContext().spanId);
      await tracing.shutdown();
    });
  }

  it('drops inbound baggage from the request context', async () => {
    const { tracing, app } = await setup();
    let baggageEntries = -1;
    app.get('/b', async (request) => {
      const bag = propagation.getBaggage(request.otelContext!);
      baggageEntries = bag ? bag.getAllEntries().length : 0;
      return { ok: true };
    });
    await app.ready();
    await app.inject({ method: 'GET', url: '/b', headers: { baggage: 'role=admin,tenant=other' } });
    expect(baggageEntries).toBe(0);
    await app.close();
    await tracing.shutdown();
  });
});
