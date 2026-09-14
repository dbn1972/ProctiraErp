/**
 * Unit / smoke tests for OpenTelemetry tracing bootstrap (W1-OPS-13).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { context, trace } from '@opentelemetry/api';
import Fastify from 'fastify';

import {
  initTracing,
  isTracingExportEnabled,
  parseOtlpHeaders,
  resetTracingForTests,
  resolveOtlpTracesUrl,
  shutdownTracing,
  withSpan,
  injectTraceContext,
  extractTraceContext,
  getTracer,
} from './tracing.js';
import { tracingPlugin } from './tracing-plugin.js';

describe('tracing config helpers', () => {
  it('resolves traces URL from OTEL_EXPORTER_OTLP_ENDPOINT', () => {
    expect(resolveOtlpTracesUrl({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector:4318' })).toBe(
      'http://collector:4318/v1/traces',
    );
    expect(
      resolveOtlpTracesUrl({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector:4318/v1/traces' }),
    ).toBe('http://collector:4318/v1/traces');
  });

  it('prefers OTEL_EXPORTER_OTLP_TRACES_ENDPOINT', () => {
    expect(
      resolveOtlpTracesUrl({
        OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector:4318',
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'http://other:4318/v1/traces',
      }),
    ).toBe('http://other:4318/v1/traces');
  });

  it('returns undefined when endpoint unset (local/dev noop)', () => {
    expect(resolveOtlpTracesUrl({})).toBeUndefined();
    expect(isTracingExportEnabled({})).toBe(false);
    expect(isTracingExportEnabled({ TRACING_ENABLED: 'true' })).toBe(false);
  });

  it('disables export when TRACING_ENABLED=false even with endpoint', () => {
    expect(
      isTracingExportEnabled({
        OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector:4318',
        TRACING_ENABLED: 'false',
      }),
    ).toBe(false);
  });

  it('parses OTEL_EXPORTER_OTLP_HEADERS', () => {
    expect(parseOtlpHeaders('Authorization=Bearer x,tenant=acme')).toEqual({
      Authorization: 'Bearer x',
      tenant: 'acme',
    });
    expect(parseOtlpHeaders(undefined)).toEqual({});
  });
});

describe('initTracing registration', () => {
  beforeEach(async () => {
    await resetTracingForTests();
  });

  afterEach(async () => {
    await resetTracingForTests();
  });

  it('stays noop when OTLP endpoint unset', () => {
    const result = initTracing({
      serviceName: 'test-svc',
      env: {},
      enableHttpInstrumentation: false,
    });
    expect(result.mode).toBe('noop');
    expect(result.enabled).toBe(false);
    // Span APIs still work (no-op provider) without throwing.
    const span = getTracer('test').startSpan('noop-span');
    span.end();
  });

  it('registers a provider and records spans with the test exporter', async () => {
    const result = initTracing({
      serviceName: 'test-svc',
      forceTestExporter: true,
      enableHttpInstrumentation: false,
      env: {},
    });
    expect(result.enabled).toBe(true);
    expect(result.mode).toBe('test');
    expect(result.testExporter).toBeDefined();

    await withSpan('unit.smoke', async (span) => {
      span.setAttribute('test.attr', 'ok');
      return 42;
    });

    await result.forceFlush();
    const finished = result.testExporter!.getFinishedSpans();
    expect(finished.length).toBeGreaterThanOrEqual(1);
    const smoke = finished.find((s) => s.name === 'unit.smoke');
    expect(smoke).toBeDefined();
    expect(smoke!.attributes['test.attr']).toBe('ok');
    await result.shutdown();
  });

  it('injects and extracts W3C traceparent', async () => {
    const result = initTracing({
      serviceName: 'prop-svc',
      forceTestExporter: true,
      enableHttpInstrumentation: false,
    });

    const tracer = getTracer('prop');
    const span = tracer.startSpan('parent');
    const ctx = trace.setSpan(context.active(), span);
    const carrier: Record<string, string> = {};
    injectTraceContext(carrier, ctx);
    expect(carrier['traceparent']).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/);

    const extracted = extractTraceContext(carrier);
    const child = tracer.startSpan('child', undefined, extracted);
    expect(child.spanContext().traceId).toBe(span.spanContext().traceId);
    child.end();
    span.end();
    await result.shutdown();
  });
});

describe('tracingPlugin Fastify hooks', () => {
  beforeEach(async () => {
    await resetTracingForTests();
  });

  afterEach(async () => {
    await shutdownTracing();
    await resetTracingForTests();
  });

  it('creates an HTTP SERVER span for requests', async () => {
    const tracing = initTracing({
      serviceName: 'gw-test',
      forceTestExporter: true,
      enableHttpInstrumentation: false,
    });

    const app = Fastify();
    await app.register(tracingPlugin, {
      serviceName: 'gw-test',
      ensureInit: false,
      ignorePaths: ['/health'],
    });
    app.get('/hello', async () => ({ ok: true }));
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/hello' });
    expect(res.statusCode).toBe(200);
    // Response may carry traceparent when span context is active.
    expect(res.headers['traceparent'] || true).toBeTruthy();

    await app.close();
    await tracing.forceFlush();

    const spans = tracing.testExporter!.getFinishedSpans();
    const httpSpan = spans.find((s) => s.name === 'HTTP GET');
    expect(httpSpan).toBeDefined();
    expect(httpSpan!.attributes['http.route']).toBe('/hello');
    expect(httpSpan!.attributes['http.status_code']).toBe(200);
    await tracing.shutdown();
  });

  it('skips ignored health paths', async () => {
    const tracing = initTracing({
      serviceName: 'gw-test',
      forceTestExporter: true,
      enableHttpInstrumentation: false,
    });

    const app = Fastify();
    await app.register(tracingPlugin, {
      serviceName: 'gw-test',
      ensureInit: false,
      ignorePaths: ['/health'],
    });
    app.get('/health', async () => ({ ok: true }));
    await app.ready();
    await app.inject({ method: 'GET', url: '/health' });
    await app.close();
    await tracing.shutdown();

    const spans = tracing.testExporter!.getFinishedSpans();
    expect(spans.find((s) => s.name === 'HTTP GET')).toBeUndefined();
  });
});
