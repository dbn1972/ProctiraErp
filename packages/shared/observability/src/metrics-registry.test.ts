/**
 * Unit tests for MetricsRegistry — verifies that Counter, Histogram, and
 * Gauge instruments register correctly, idempotently, and emit Prometheus
 * text format with the expected default labels.
 */
import { describe, expect, it, beforeEach } from 'vitest';

import {
  DEFAULT_HTTP_DURATION_BUCKETS,
  MetricsRegistry,
  getDefaultRegistry,
  resetDefaultRegistry,
} from './metrics-registry.js';

describe('MetricsRegistry', () => {
  let registry: MetricsRegistry;

  beforeEach(() => {
    registry = new MetricsRegistry('test-service');
  });

  it('attaches the service name as a default label', async () => {
    const c = registry.counter({ name: 'foo_total', help: 'h' });
    c.inc();
    const text = await registry.metrics();
    expect(text).toContain('foo_total');
    expect(text).toContain('service="test-service"');
  });

  it('returns the same instrument when registered twice with the same name', () => {
    const a = registry.counter({ name: 'dupe_total', help: 'h' });
    const b = registry.counter({ name: 'dupe_total', help: 'h' });
    expect(a).toBe(b);
  });

  it('exposes a histogram with the configured buckets', async () => {
    const h = registry.histogram({
      name: 'lat_seconds',
      help: 'h',
      buckets: [0.1, 1, 10],
    });
    h.observe(0.5);
    const text = await registry.metrics();
    expect(text).toContain('lat_seconds_bucket');
    expect(text).toContain('le="0.1"');
    expect(text).toContain('le="10"');
  });

  it('uses the default HTTP buckets when none provided', () => {
    expect(DEFAULT_HTTP_DURATION_BUCKETS[0]).toBe(0.005);
    expect(DEFAULT_HTTP_DURATION_BUCKETS[DEFAULT_HTTP_DURATION_BUCKETS.length - 1]).toBe(10);
  });

  it('renders gauges and counters in the same metrics output', async () => {
    const g = registry.gauge({ name: 'gauge_one', help: 'h' });
    g.set(42);
    registry.counter({ name: 'counter_one', help: 'h' }).inc(3);
    const text = await registry.metrics();
    expect(text).toContain('gauge_one{service="test-service"} 42');
    expect(text).toContain('counter_one{service="test-service"} 3');
  });
});

describe('getDefaultRegistry', () => {
  beforeEach(() => {
    resetDefaultRegistry();
  });

  it('returns a singleton', () => {
    const a = getDefaultRegistry('svc');
    const b = getDefaultRegistry('svc');
    expect(a).toBe(b);
  });
});
