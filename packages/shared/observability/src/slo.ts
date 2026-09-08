/**
 * SLO (Service Level Objective) definitions and registration.
 *
 * Each service declares its SLIs and SLO targets at startup via
 * `registerServiceSLO`. The registration:
 *  - Validates the SLO configuration.
 *  - Exposes a GET /slo endpoint returning the service's SLO contract as JSON.
 *  - Registers custom metrics for SLI tracking (e.g. queue lag gauges).
 *  - Links the service to its runbook and owning team.
 *
 * This module implements the design from Section 38 (SLO, SLI, Service Operations).
 */
import type { FastifyInstance } from 'fastify';

import type { MetricsRegistry } from './metrics-registry.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AvailabilitySLI {
  /** Target success rate as a decimal (e.g. 0.999 for 99.9%). */
  target: number;
  /** Evaluation window (e.g. '30d'). */
  window: string;
}

export interface LatencySLI {
  /** P95 latency target in milliseconds. */
  p95: number;
  /** P99 latency target in milliseconds. */
  p99: number;
  /** Unit label. Always 'ms'. */
  unit: 'ms';
}

export interface ErrorRateSLI {
  /** Maximum acceptable error rate as a decimal (e.g. 0.001 for 0.1%). */
  target: number;
  /** Evaluation window (e.g. '1h'). */
  window: string;
}

export interface SaturationSLI {
  /** CPU utilization target as a decimal (e.g. 0.7 for 70%). */
  cpuTarget: number;
  /** Memory utilization target as a decimal (e.g. 0.8 for 80%). */
  memoryTarget: number;
}

export interface QueueLagSLI {
  /** Maximum acceptable consumer lag in messages. */
  maxLag: number;
  /** Unit label. Always 'messages'. */
  unit: 'messages';
}

export interface ServiceIndicators {
  availability: AvailabilitySLI;
  latency: LatencySLI;
  errorRate: ErrorRateSLI;
  saturation: SaturationSLI;
  queueLag?: QueueLagSLI;
}

export interface AlertConfig {
  /** Alert rule name as defined in Prometheus alert rules. */
  name: string;
  /** Severity level. */
  severity: 'critical' | 'warning' | 'info';
  /** Which SLI this alert guards. */
  sli: keyof ServiceIndicators;
  /** Human-readable description of when this alert fires. */
  description: string;
}

export interface ServiceSLO {
  /** Service identifier (matches the Prometheus `service` label). */
  service: string;
  /** SLI definitions with targets. */
  indicators: ServiceIndicators;
  /** Alert rules associated with this service. */
  alerts: AlertConfig[];
  /** URL to the service's runbook. */
  runbook: string;
  /** Owning team or person. */
  owner: string;
  /** Slack channel for the owning team. */
  slackChannel?: string;
  /** On-call rotation identifier. */
  oncallGroup?: string;
  /** Service dependencies (other service slugs or infra components). */
  dependencies?: string[];
}

// ─── Validation ─────────────────────────────────────────────────────────────

export class SLOValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SLOValidationError';
  }
}

function validateSLO(slo: ServiceSLO): void {
  if (!slo.service || slo.service.trim().length === 0) {
    throw new SLOValidationError('ServiceSLO.service must be a non-empty string');
  }

  const { availability, latency, errorRate, saturation, queueLag } = slo.indicators;

  if (availability.target <= 0 || availability.target > 1) {
    throw new SLOValidationError(
      `availability.target must be in (0, 1], got ${availability.target}`,
    );
  }
  if (latency.p95 <= 0 || latency.p99 <= 0) {
    throw new SLOValidationError('latency.p95 and latency.p99 must be positive');
  }
  if (latency.p95 > latency.p99) {
    throw new SLOValidationError('latency.p95 must be <= latency.p99');
  }
  if (errorRate.target <= 0 || errorRate.target >= 1) {
    throw new SLOValidationError(
      `errorRate.target must be in (0, 1), got ${errorRate.target}`,
    );
  }
  if (saturation.cpuTarget <= 0 || saturation.cpuTarget > 1) {
    throw new SLOValidationError(
      `saturation.cpuTarget must be in (0, 1], got ${saturation.cpuTarget}`,
    );
  }
  if (saturation.memoryTarget <= 0 || saturation.memoryTarget > 1) {
    throw new SLOValidationError(
      `saturation.memoryTarget must be in (0, 1], got ${saturation.memoryTarget}`,
    );
  }
  if (queueLag !== undefined && queueLag.maxLag <= 0) {
    throw new SLOValidationError('queueLag.maxLag must be positive');
  }

  if (!slo.runbook || slo.runbook.trim().length === 0) {
    throw new SLOValidationError('ServiceSLO.runbook must be a non-empty string');
  }
  if (!slo.owner || slo.owner.trim().length === 0) {
    throw new SLOValidationError('ServiceSLO.owner must be a non-empty string');
  }
}

// ─── Registration ───────────────────────────────────────────────────────────

declare module 'fastify' {
  interface FastifyInstance {
    slo?: ServiceSLO;
  }
}

/**
 * Register a service's SLO definition on a Fastify instance.
 *
 * This function:
 * 1. Validates the SLO configuration.
 * 2. Decorates the Fastify instance with the SLO definition (if not yet started).
 * 3. Exposes a GET /slo endpoint returning the SLO contract as JSON.
 * 4. Registers queue lag gauge metrics if queueLag is defined.
 *
 * IMPORTANT: Call this BEFORE `app.ready()` / `app.listen()` — Fastify does not
 * allow decorating after the server has started.
 *
 * @param fastify - The Fastify instance (must have the observability plugin registered).
 * @param slo - The service's SLO definition.
 */
export function registerServiceSLO(
  fastify: FastifyInstance,
  slo: ServiceSLO,
): void {
  validateSLO(slo);

  // Decorate the instance so other plugins can inspect the SLO.
  if (!fastify.hasDecorator('slo')) {
    fastify.decorate('slo', slo);
  } else {
    // If already decorated (e.g. re-registration), update the value.
    (fastify as FastifyInstance & { slo: ServiceSLO }).slo = slo;
  }

  // Register queue lag gauge if the service has queue-based SLIs.
  if (slo.indicators.queueLag && fastify.hasDecorator('metrics')) {
    const registry: MetricsRegistry = fastify.metrics;
    registry.gauge({
      name: 'slo_queue_lag_messages',
      help: 'Current consumer lag in messages for SLO tracking',
      labelNames: ['service', 'topic'],
    });
    registry.gauge({
      name: 'slo_queue_lag_max',
      help: 'Maximum acceptable consumer lag (from SLO definition)',
      labelNames: ['service'],
    }).set({ service: slo.service }, slo.indicators.queueLag.maxLag);
  }

  // Expose the SLO contract as a JSON endpoint for introspection.
  fastify.route({
    method: 'GET',
    url: '/slo',
    schema: {
      hide: true,
    } as Record<string, unknown>,
    handler: async (_request, reply) => {
      return reply.send(slo);
    },
  });
}

// ─── Predefined SLO templates ───────────────────────────────────────────────

/**
 * Default SLO indicators for core backend services.
 * Services can spread these and override specific values.
 */
export const DEFAULT_CORE_SERVICE_INDICATORS: ServiceIndicators = {
  availability: { target: 0.999, window: '30d' },
  latency: { p95: 300, p99: 500, unit: 'ms' },
  errorRate: { target: 0.001, window: '1h' },
  saturation: { cpuTarget: 0.7, memoryTarget: 0.8 },
};

/**
 * Default SLO indicators for gateway/edge services.
 * Slightly tighter latency targets since the gateway adds overhead.
 */
export const DEFAULT_GATEWAY_INDICATORS: ServiceIndicators = {
  availability: { target: 0.999, window: '30d' },
  latency: { p95: 500, p99: 1000, unit: 'ms' },
  errorRate: { target: 0.001, window: '1h' },
  saturation: { cpuTarget: 0.7, memoryTarget: 0.8 },
};

/**
 * Default SLO indicators for worker/ETL services.
 * Relaxed latency targets; includes queue lag.
 */
export const DEFAULT_WORKER_INDICATORS: ServiceIndicators = {
  availability: { target: 0.999, window: '30d' },
  latency: { p95: 2000, p99: 5000, unit: 'ms' },
  errorRate: { target: 0.005, window: '1h' },
  saturation: { cpuTarget: 0.85, memoryTarget: 0.85 },
  queueLag: { maxLag: 1000, unit: 'messages' },
};

/**
 * Standard alert configurations that apply to all services.
 * Services can extend this with service-specific alerts.
 */
export const DEFAULT_ALERTS: AlertConfig[] = [
  {
    name: 'ServiceDown',
    severity: 'critical',
    sli: 'availability',
    description: 'Service is unreachable (Prometheus scrape failing for 2m)',
  },
  {
    name: 'ServiceErrorRateHigh',
    severity: 'warning',
    sli: 'availability',
    description: '5xx error rate above 1% for 5 minutes',
  },
  {
    name: 'ServiceErrorRateCritical',
    severity: 'critical',
    sli: 'availability',
    description: '5xx error rate above 5% for 5 minutes',
  },
  {
    name: 'ErrorBudgetBurnFast',
    severity: 'critical',
    sli: 'errorRate',
    description: 'Error budget burning at 14.4x (exhausted in ~2 days)',
  },
  {
    name: 'ErrorBudgetBurnSlow',
    severity: 'warning',
    sli: 'errorRate',
    description: 'Error budget burning at 6x (exhausted in ~5 days)',
  },
  {
    name: 'ServiceP95LatencyHigh',
    severity: 'warning',
    sli: 'latency',
    description: 'P95 latency above 500ms for 5 minutes',
  },
  {
    name: 'ServiceP99LatencyHigh',
    severity: 'critical',
    sli: 'latency',
    description: 'P99 latency above 2s for 10 minutes',
  },
  {
    name: 'ProcessCPUHigh',
    severity: 'warning',
    sli: 'saturation',
    description: 'CPU usage above 85% for 5 minutes',
  },
  {
    name: 'ProcessMemoryHigh',
    severity: 'warning',
    sli: 'saturation',
    description: 'Memory usage above 90% for 5 minutes',
  },
  {
    name: 'EventLoopLagHigh',
    severity: 'warning',
    sli: 'saturation',
    description: 'Node.js event loop lag above 100ms for 5 minutes',
  },
];

/**
 * Build a complete ServiceSLO from minimal inputs using defaults.
 * Useful for services that follow the standard SLO pattern.
 */
export function buildServiceSLO(options: {
  service: string;
  owner: string;
  indicators?: Partial<ServiceIndicators>;
  alerts?: AlertConfig[];
  runbook?: string;
  slackChannel?: string;
  oncallGroup?: string;
  dependencies?: string[];
}): ServiceSLO {
  const baseRunbook = `https://runbooks.proctira.org/services/${options.service}.md`;
  return {
    service: options.service,
    indicators: {
      ...DEFAULT_CORE_SERVICE_INDICATORS,
      ...options.indicators,
    },
    alerts: options.alerts ?? [...DEFAULT_ALERTS],
    runbook: options.runbook ?? baseRunbook,
    owner: options.owner,
    slackChannel: options.slackChannel,
    oncallGroup: options.oncallGroup ?? `${options.service}-oncall`,
    dependencies: options.dependencies,
  };
}
