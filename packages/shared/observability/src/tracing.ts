/**
 * Application-level OpenTelemetry distributed tracing (W1-OPS-13).
 *
 * Behaviour:
 * - When `OTEL_EXPORTER_OTLP_ENDPOINT` or `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`
 *   is set (and tracing is not explicitly disabled), registers a Node tracer
 *   provider, W3C Trace Context + Baggage propagation, HTTP instrumentation,
 *   and an OTLP/HTTP span exporter.
 * - When the OTLP endpoint is unset (typical local/dev), stays on the API
 *   no-op tracer provider — span APIs remain safe to call and create no
 *   network traffic.
 *
 * Does not prove a live collector is reachable; export failures are swallowed
 * by the OTLP exporter retry/backoff (fail-safe).
 */
import {
  context,
  propagation,
  trace,
  SpanStatusCode,
  type Context,
  type Span,
  type Tracer,
} from '@opentelemetry/api';
import {
  CompositePropagator,
  W3CBaggagePropagator,
  W3CTraceContextPropagator,
} from '@opentelemetry/core';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  BatchSpanProcessor,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type SpanExporter,
  type SpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

export interface TracingEnv {
  OTEL_EXPORTER_OTLP_ENDPOINT?: string;
  OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?: string;
  OTEL_EXPORTER_OTLP_HEADERS?: string;
  OTEL_SERVICE_NAME?: string;
  TRACING_ENABLED?: string;
  NODE_ENV?: string;
}

export type TracingMode = 'otlp' | 'noop' | 'test';

export interface TracingInitOptions {
  /** Logical service name (resource attribute). */
  serviceName: string;
  /** Env snapshot; defaults to process.env. Tests inject fixtures. */
  env?: TracingEnv;
  /**
   * When true, force OTLP mode even without an endpoint by using an in-memory
   * exporter (unit/smoke tests only). Never used in production entrypoints.
   */
  forceTestExporter?: boolean;
  /** Optional override exporter (tests). */
  exporter?: SpanExporter;
  /** Disable HTTP auto-instrumentation (tests that only exercise helpers). */
  enableHttpInstrumentation?: boolean;
}

export interface TracingInitResult {
  mode: TracingMode;
  enabled: boolean;
  serviceName: string;
  /** Present when forceTestExporter / in-memory path is used. */
  testExporter?: InMemorySpanExporter;
  forceFlush: () => Promise<void>;
  shutdown: () => Promise<void>;
}

let activeProvider: NodeTracerProvider | undefined;
let activeMode: TracingMode = 'noop';
let activeServiceName: string | undefined;
let instrumentationsRegistered = false;
let activeShutdown: (() => Promise<void>) | undefined;

function trim(value: string | undefined): string | undefined {
  const v = value?.trim();
  return v ? v : undefined;
}

/**
 * Parse `OTEL_EXPORTER_OTLP_HEADERS` (`k=v,k2=v2`) into a header map.
 * Invalid pairs are skipped.
 */
export function parseOtlpHeaders(raw: string | undefined): Record<string, string> {
  const headers: Record<string, string> = {};
  if (!raw?.trim()) return headers;
  for (const part of raw.split(',')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) headers[key] = value;
  }
  return headers;
}

/**
 * Resolve the OTLP traces URL.
 * - Prefer `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` when set.
 * - Else append `/v1/traces` to `OTEL_EXPORTER_OTLP_ENDPOINT` when that base
 *   does not already end with `/v1/traces`.
 */
export function resolveOtlpTracesUrl(env: TracingEnv): string | undefined {
  const traces = trim(env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT);
  if (traces) return traces;
  const base = trim(env.OTEL_EXPORTER_OTLP_ENDPOINT);
  if (!base) return undefined;
  if (/\/v1\/traces\/?$/i.test(base)) return base.replace(/\/$/, '');
  return `${base.replace(/\/$/, '')}/v1/traces`;
}

/**
 * Tracing is export-enabled when an OTLP endpoint is configured and
 * `TRACING_ENABLED` is not explicitly `false`.
 */
export function isTracingExportEnabled(env: TracingEnv = process.env): boolean {
  if (env.TRACING_ENABLED === 'false') return false;
  return Boolean(resolveOtlpTracesUrl(env));
}

function readEnv(env?: TracingEnv): TracingEnv {
  if (env) return env;
  return {
    OTEL_EXPORTER_OTLP_ENDPOINT: process.env['OTEL_EXPORTER_OTLP_ENDPOINT'],
    OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: process.env['OTEL_EXPORTER_OTLP_TRACES_ENDPOINT'],
    OTEL_EXPORTER_OTLP_HEADERS: process.env['OTEL_EXPORTER_OTLP_HEADERS'],
    OTEL_SERVICE_NAME: process.env['OTEL_SERVICE_NAME'],
    TRACING_ENABLED: process.env['TRACING_ENABLED'],
    NODE_ENV: process.env['NODE_ENV'],
  };
}

function installPropagators(): void {
  propagation.setGlobalPropagator(
    new CompositePropagator({
      propagators: [new W3CTraceContextPropagator(), new W3CBaggagePropagator()],
    }),
  );
}

/**
 * Bootstrap the process-wide tracer provider.
 *
 * Safe to call multiple times: subsequent calls with the same process keep the
 * existing provider (idempotent). Call `shutdownTracing()` in tests between
 * scenarios that need a fresh provider.
 */
export function initTracing(options: TracingInitOptions): TracingInitResult {
  const env = readEnv(options.env);
  const serviceName = trim(options.serviceName) || trim(env.OTEL_SERVICE_NAME) || 'proctira';

  if (activeProvider && !options.forceTestExporter && !options.exporter) {
    return {
      mode: activeMode,
      enabled: activeMode !== 'noop',
      serviceName: activeServiceName ?? serviceName,
      forceFlush: async () => {
        if (activeProvider) await activeProvider.forceFlush().catch(() => undefined);
      },
      shutdown: activeShutdown ?? (async () => undefined),
    };
  }

  // Tear down any prior provider when tests force a new exporter.
  if (activeProvider && (options.forceTestExporter || options.exporter)) {
    // Sync best-effort; tests await shutdownTracing between cases when needed.
    void activeProvider.shutdown().catch(() => undefined);
    activeProvider = undefined;
    activeShutdown = undefined;
  }

  const exportUrl = resolveOtlpTracesUrl(env);
  const exportEnabled = options.forceTestExporter || Boolean(options.exporter) || isTracingExportEnabled(env);

  if (!exportEnabled) {
    activeMode = 'noop';
    activeServiceName = serviceName;
    activeShutdown = async () => undefined;
    return {
      mode: 'noop',
      enabled: false,
      serviceName,
      forceFlush: async () => undefined,
      shutdown: activeShutdown,
    };
  }

  installPropagators();

  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: serviceName,
  });

  let testExporter: InMemorySpanExporter | undefined;
  let exporter: SpanExporter;
  let mode: TracingMode;

  if (options.exporter) {
    exporter = options.exporter;
    mode = options.forceTestExporter ? 'test' : 'otlp';
  } else if (options.forceTestExporter) {
    testExporter = new InMemorySpanExporter();
    exporter = testExporter;
    mode = 'test';
  } else {
    exporter = new OTLPTraceExporter({
      url: exportUrl,
      headers: parseOtlpHeaders(env.OTEL_EXPORTER_OTLP_HEADERS),
    });
    mode = 'otlp';
  }

  const processor: SpanProcessor =
    mode === 'test'
      ? new SimpleSpanProcessor(exporter)
      : new BatchSpanProcessor(exporter);

  const provider = new NodeTracerProvider({
    resource,
    spanProcessors: [processor],
  });
  provider.register();

  const enableHttp = options.enableHttpInstrumentation !== false;
  if (enableHttp && !instrumentationsRegistered) {
    registerInstrumentations({
      instrumentations: [
        new HttpInstrumentation({
          ignoreIncomingRequestHook: (req) => {
            const url = req.url ?? '';
            return (
              url.startsWith('/health') ||
              url.startsWith('/metrics') ||
              url.startsWith('/ready')
            );
          },
        }),
      ],
    });
    instrumentationsRegistered = true;
  }

  const shutdown = async () => {
    try {
      await provider.shutdown();
    } catch {
      // fail-safe: never throw from shutdown paths
    }
    if (activeProvider === provider) {
      activeProvider = undefined;
      activeMode = 'noop';
      activeServiceName = undefined;
      activeShutdown = undefined;
    }
  };

  activeProvider = provider;
  activeMode = mode;
  activeServiceName = serviceName;
  activeShutdown = shutdown;

  return {
    mode,
    enabled: true,
    serviceName,
    ...(testExporter ? { testExporter } : {}),
    forceFlush: async () => {
      try {
        await provider.forceFlush();
      } catch {
        // fail-safe
      }
    },
    shutdown,
  };
}

/** Graceful shutdown of the active tracer provider (if any). */
export async function shutdownTracing(): Promise<void> {
  if (activeShutdown) {
    await activeShutdown();
  }
}

export function getTracingMode(): TracingMode {
  return activeMode;
}

export function isTracingInitialized(): boolean {
  return activeProvider !== undefined || activeMode === 'noop';
}

/** Tracer for the active service (or a named instrumentation scope). */
export function getTracer(name = 'proctira'): Tracer {
  return trace.getTracer(name);
}

/**
 * Create a child span, run `fn`, and end the span. Sets ERROR status on throw.
 * Works under the no-op provider (no export) when OTLP is unset.
 */
export async function withSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T> | T,
  options?: { tracerName?: string; attributes?: Record<string, string | number | boolean> },
): Promise<T> {
  const tracer = getTracer(options?.tracerName ?? 'proctira');
  return tracer.startActiveSpan(name, async (span) => {
    if (options?.attributes) {
      span.setAttributes(options.attributes);
    }
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: err instanceof Error ? err.message : String(err),
      });
      if (err instanceof Error) {
        span.recordException(err);
      }
      throw err;
    } finally {
      span.end();
    }
  });
}

/** Extract W3C context from a carrier (e.g. incoming HTTP headers). */
export function extractTraceContext(carrier: Record<string, string | string[] | undefined>): Context {
  return propagation.extract(context.active(), carrier, {
    get(c, key) {
      const v = c[key] ?? c[key.toLowerCase()];
      if (Array.isArray(v)) return v.join(',');
      return v;
    },
    keys(c) {
      return Object.keys(c);
    },
  });
}

/** Inject W3C trace context into an outbound carrier. */
export function injectTraceContext(carrier: Record<string, string>, ctx: Context = context.active()): void {
  propagation.inject(ctx, carrier, {
    set(c, key, value) {
      c[key] = value;
    },
  });
}

/** Test helper: reset module-level tracing state between vitest cases. */
export async function resetTracingForTests(): Promise<void> {
  await shutdownTracing();
  activeProvider = undefined;
  activeMode = 'noop';
  activeServiceName = undefined;
  activeShutdown = undefined;
  // OTEL global APIs allow only one successful register() per process.
  // Tests call disable() so a subsequent provider.register() can take effect.
  try {
    trace.disable();
  } catch {
    // ignore
  }
  try {
    context.disable();
  } catch {
    // ignore
  }
  try {
    propagation.disable();
  } catch {
    // ignore
  }
  // Instrumentations stay registered for the process (OTEL limitation);
  // tests that need HTTP instrumentation rely on the first registration.
}
