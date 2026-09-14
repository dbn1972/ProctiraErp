/**
 * @proctira/observability - Prometheus metrics and OpenTelemetry tracing
 *
 * Provides:
 * - MetricsRegistry: a thin wrapper around prom-client for registering Counter,
 *   Histogram, and Gauge instruments under a shared registry.
 * - observabilityPlugin: a Fastify plugin that registers default Node.js metrics,
 *   exposes GET /metrics, and instruments every request with HTTP-level metrics.
 * - initTracing / tracingPlugin: application-level OTEL distributed tracing
 *   (W1-OPS-13) with fail-safe no-op when OTLP endpoint is unset.
 * - ServiceSLO: SLI/SLO definition types and registration for each service.
 * - registerServiceSLO: registers a service's SLO contract, exposes /slo endpoint.
 */

export {
  MetricsRegistry,
  getDefaultRegistry,
  resetDefaultRegistry,
  DEFAULT_HTTP_DURATION_BUCKETS,
} from './metrics-registry.js';
export type { CounterConfig, HistogramConfig, GaugeConfig } from './metrics-registry.js';

export { observabilityPlugin } from './fastify-plugin.js';
export type { ObservabilityPluginOptions } from './fastify-plugin.js';

export {
  authorizeMetricsAccess,
  metricsAccessEnvFromProcess,
  isLoopbackIp,
  normalizeClientIp,
  parseAllowlist,
  extractBearerToken,
  tokensMatch,
} from './metrics-access.js';
export type { MetricsAccessEnv, MetricsAccessDecision } from './metrics-access.js';

export {
  registerServiceSLO,
  buildServiceSLO,
  SLOValidationError,
  DEFAULT_CORE_SERVICE_INDICATORS,
  DEFAULT_GATEWAY_INDICATORS,
  DEFAULT_WORKER_INDICATORS,
  DEFAULT_ALERTS,
} from './slo.js';
export type {
  ServiceSLO,
  ServiceIndicators,
  AvailabilitySLI,
  LatencySLI,
  ErrorRateSLI,
  SaturationSLI,
  QueueLagSLI,
  AlertConfig,
} from './slo.js';

export { SLO_CATALOG } from './slo-catalog.js';

export {
  initTracing,
  shutdownTracing,
  resetTracingForTests,
  isTracingExportEnabled,
  resolveOtlpTracesUrl,
  parseOtlpHeaders,
  getTracer,
  getTracingMode,
  withSpan,
  injectTraceContext,
  extractTraceContext,
} from './tracing.js';
export type {
  TracingEnv,
  TracingInitOptions,
  TracingInitResult,
  TracingMode,
} from './tracing.js';

export { tracingPlugin } from './tracing-plugin.js';
export type { TracingPluginOptions } from './tracing-plugin.js';
