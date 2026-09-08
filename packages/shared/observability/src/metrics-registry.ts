/**
 * MetricsRegistry — a thin wrapper around prom-client.
 *
 * Each backend service constructs its own MetricsRegistry (or shares the
 * default one) and registers Counter, Histogram, and Gauge instruments.
 * The registry is exposed via GET /metrics by the observability Fastify
 * plugin so Prometheus can scrape it.
 */
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

/**
 * Default Prometheus histogram buckets for HTTP request duration in seconds.
 * Tuned for typical API latencies from sub-millisecond to 10s long tails.
 */
export const DEFAULT_HTTP_DURATION_BUCKETS: readonly number[] = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
];

export interface CounterConfig<L extends string = string> {
  name: string;
  help: string;
  labelNames?: readonly L[];
}

export interface HistogramConfig<L extends string = string> {
  name: string;
  help: string;
  labelNames?: readonly L[];
  buckets?: readonly number[];
}

export interface GaugeConfig<L extends string = string> {
  name: string;
  help: string;
  labelNames?: readonly L[];
}

/**
 * Wraps a prom-client Registry with conveniences for creating instruments
 * and avoiding duplicate registration when modules are loaded twice.
 */
export class MetricsRegistry {
  /** The underlying prom-client Registry */
  public readonly registry: Registry;

  /** Service name applied as a default label to every instrument */
  public readonly serviceName: string;

  /**
   * Default labels merged into every metric. Includes the service name
   * by default; callers may add additional fields (e.g. `env`).
   */
  private readonly defaultLabels: Record<string, string>;

  constructor(serviceName: string, defaultLabels: Record<string, string> = {}) {
    this.serviceName = serviceName;
    this.registry = new Registry();
    this.defaultLabels = { service: serviceName, ...defaultLabels };
    this.registry.setDefaultLabels(this.defaultLabels);
  }

  /**
   * Register the standard Node.js process metrics
   * (CPU, event loop lag, GC, heap, etc.) on this registry.
   */
  collectDefaultMetrics(prefix?: string): void {
    collectDefaultMetrics({
      register: this.registry,
      ...(prefix !== undefined ? { prefix } : {}),
    });
  }

  /** Create or return an existing Counter on this registry. */
  counter<L extends string = string>(config: CounterConfig<L>): Counter<L> {
    const existing = this.registry.getSingleMetric(config.name);
    if (existing) {
      return existing as Counter<L>;
    }
    return new Counter<L>({
      name: config.name,
      help: config.help,
      labelNames: (config.labelNames ?? []) as L[],
      registers: [this.registry],
    });
  }

  /** Create or return an existing Histogram on this registry. */
  histogram<L extends string = string>(config: HistogramConfig<L>): Histogram<L> {
    const existing = this.registry.getSingleMetric(config.name);
    if (existing) {
      return existing as Histogram<L>;
    }
    return new Histogram<L>({
      name: config.name,
      help: config.help,
      labelNames: (config.labelNames ?? []) as L[],
      buckets: [...(config.buckets ?? DEFAULT_HTTP_DURATION_BUCKETS)],
      registers: [this.registry],
    });
  }

  /** Create or return an existing Gauge on this registry. */
  gauge<L extends string = string>(config: GaugeConfig<L>): Gauge<L> {
    const existing = this.registry.getSingleMetric(config.name);
    if (existing) {
      return existing as Gauge<L>;
    }
    return new Gauge<L>({
      name: config.name,
      help: config.help,
      labelNames: (config.labelNames ?? []) as L[],
      registers: [this.registry],
    });
  }

  /** Render the registry as Prometheus text exposition format. */
  async metrics(): Promise<string> {
    return this.registry.metrics();
  }

  /** Content-Type expected for the /metrics response. */
  contentType(): string {
    return this.registry.contentType;
  }

  /** Reset the registry — useful in tests. */
  clear(): void {
    this.registry.clear();
    this.registry.setDefaultLabels(this.defaultLabels);
  }
}

let defaultRegistry: MetricsRegistry | undefined;

/**
 * Lazily create and return a process-wide default MetricsRegistry.
 * Subsequent calls return the same instance.
 */
export function getDefaultRegistry(serviceName = 'proctira'): MetricsRegistry {
  if (!defaultRegistry) {
    defaultRegistry = new MetricsRegistry(serviceName);
  }
  return defaultRegistry;
}

/** Reset the default registry. Intended for tests. */
export function resetDefaultRegistry(): void {
  defaultRegistry?.clear();
  defaultRegistry = undefined;
}
