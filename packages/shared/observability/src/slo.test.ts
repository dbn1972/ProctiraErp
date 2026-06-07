/**
 * Unit tests for the SLO definition, validation, and registration module.
 */
import { describe, expect, it, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

import { observabilityPlugin } from './fastify-plugin.js';
import { MetricsRegistry } from './metrics-registry.js';
import {
  registerServiceSLO,
  buildServiceSLO,
  SLOValidationError,
  DEFAULT_CORE_SERVICE_INDICATORS,
  DEFAULT_GATEWAY_INDICATORS,
  DEFAULT_WORKER_INDICATORS,
  DEFAULT_ALERTS,
  type ServiceSLO,
} from './slo.js';

describe('SLO validation', () => {
  const validSLO: ServiceSLO = {
    service: 'test-service',
    indicators: {
      availability: { target: 0.999, window: '30d' },
      latency: { p95: 300, p99: 500, unit: 'ms' },
      errorRate: { target: 0.001, window: '1h' },
      saturation: { cpuTarget: 0.7, memoryTarget: 0.8 },
    },
    alerts: [],
    runbook: 'https://runbooks.proctira.org/services/test-service.md',
    owner: 'Engineering',
  };

  it('accepts a valid SLO definition', async () => {
    const app = Fastify();
    const registry = new MetricsRegistry('test-service');
    await app.register(observabilityPlugin, {
      serviceName: 'test-service',
      registry,
      collectDefaultMetrics: false,
    });
    // Register SLO before ready
    registerServiceSLO(app, validSLO);
    await app.ready();

    expect(app.slo).toBeDefined();
    expect(app.slo!.service).toBe('test-service');
    await app.close();
  });

  it('rejects empty service name', () => {
    const app = Fastify();
    const slo = { ...validSLO, service: '' };
    expect(() => registerServiceSLO(app, slo)).toThrow(SLOValidationError);
  });

  it('rejects availability target > 1', () => {
    const app = Fastify();
    const slo: ServiceSLO = {
      ...validSLO,
      indicators: {
        ...validSLO.indicators,
        availability: { target: 1.5, window: '30d' },
      },
    };
    expect(() => registerServiceSLO(app, slo)).toThrow(SLOValidationError);
  });

  it('rejects availability target <= 0', () => {
    const app = Fastify();
    const slo: ServiceSLO = {
      ...validSLO,
      indicators: {
        ...validSLO.indicators,
        availability: { target: 0, window: '30d' },
      },
    };
    expect(() => registerServiceSLO(app, slo)).toThrow(SLOValidationError);
  });

  it('rejects p95 > p99', () => {
    const app = Fastify();
    const slo: ServiceSLO = {
      ...validSLO,
      indicators: {
        ...validSLO.indicators,
        latency: { p95: 1000, p99: 500, unit: 'ms' },
      },
    };
    expect(() => registerServiceSLO(app, slo)).toThrow(SLOValidationError);
  });

  it('rejects negative latency values', () => {
    const app = Fastify();
    const slo: ServiceSLO = {
      ...validSLO,
      indicators: {
        ...validSLO.indicators,
        latency: { p95: -100, p99: 500, unit: 'ms' },
      },
    };
    expect(() => registerServiceSLO(app, slo)).toThrow(SLOValidationError);
  });

  it('rejects error rate target >= 1', () => {
    const app = Fastify();
    const slo: ServiceSLO = {
      ...validSLO,
      indicators: {
        ...validSLO.indicators,
        errorRate: { target: 1, window: '1h' },
      },
    };
    expect(() => registerServiceSLO(app, slo)).toThrow(SLOValidationError);
  });

  it('rejects empty runbook', () => {
    const app = Fastify();
    const slo = { ...validSLO, runbook: '' };
    expect(() => registerServiceSLO(app, slo)).toThrow(SLOValidationError);
  });

  it('rejects empty owner', () => {
    const app = Fastify();
    const slo = { ...validSLO, owner: '' };
    expect(() => registerServiceSLO(app, slo)).toThrow(SLOValidationError);
  });

  it('rejects negative queue lag', () => {
    const app = Fastify();
    const slo: ServiceSLO = {
      ...validSLO,
      indicators: {
        ...validSLO.indicators,
        queueLag: { maxLag: -10, unit: 'messages' },
      },
    };
    expect(() => registerServiceSLO(app, slo)).toThrow(SLOValidationError);
  });
});

describe('registerServiceSLO', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app.close();
  });

  it('decorates the Fastify instance with the SLO', async () => {
    app = Fastify();
    const registry = new MetricsRegistry('test-service');
    await app.register(observabilityPlugin, {
      serviceName: 'test-service',
      registry,
      collectDefaultMetrics: false,
    });
    const slo = buildServiceSLO({
      service: 'test-service',
      owner: 'Engineering',
    });
    registerServiceSLO(app, slo);
    await app.ready();

    expect(app.slo).toBeDefined();
    expect(app.slo!.service).toBe('test-service');
  });

  it('exposes a GET /slo endpoint returning the SLO as JSON', async () => {
    app = Fastify();
    const registry = new MetricsRegistry('test-service');
    await app.register(observabilityPlugin, {
      serviceName: 'test-service',
      registry,
      collectDefaultMetrics: false,
    });
    const slo = buildServiceSLO({
      service: 'test-service',
      owner: 'Engineering',
      dependencies: ['postgresql', 'redis'],
    });
    registerServiceSLO(app, slo);
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/slo' });
    expect(res.statusCode).toBe(200);

    const body = res.json();
    expect(body.service).toBe('test-service');
    expect(body.owner).toBe('Engineering');
    expect(body.indicators.availability.target).toBe(0.999);
    expect(body.dependencies).toContain('postgresql');
    expect(body.dependencies).toContain('redis');
  });

  it('registers queue lag gauge when queueLag is defined', async () => {
    app = Fastify();
    const registry = new MetricsRegistry('test-service');
    await app.register(observabilityPlugin, {
      serviceName: 'test-service',
      registry,
      collectDefaultMetrics: false,
    });
    const slo = buildServiceSLO({
      service: 'test-service',
      owner: 'Engineering',
      indicators: {
        queueLag: { maxLag: 1000, unit: 'messages' },
      },
    });
    registerServiceSLO(app, slo);
    await app.ready();

    const metricsRes = await app.inject({ method: 'GET', url: '/metrics' });
    expect(metricsRes.body).toContain('slo_queue_lag_max');
  });
});

describe('buildServiceSLO', () => {
  it('uses default core indicators when none provided', () => {
    const slo = buildServiceSLO({
      service: 'my-service',
      owner: 'Team A',
    });
    expect(slo.indicators.availability.target).toBe(0.999);
    expect(slo.indicators.latency.p95).toBe(300);
    expect(slo.indicators.latency.p99).toBe(500);
    expect(slo.indicators.errorRate.target).toBe(0.001);
    expect(slo.indicators.saturation.cpuTarget).toBe(0.7);
  });

  it('allows overriding specific indicators', () => {
    const slo = buildServiceSLO({
      service: 'fast-service',
      owner: 'Team B',
      indicators: {
        latency: { p95: 100, p99: 200, unit: 'ms' },
      },
    });
    expect(slo.indicators.latency.p95).toBe(100);
    expect(slo.indicators.latency.p99).toBe(200);
    // Other indicators remain default
    expect(slo.indicators.availability.target).toBe(0.999);
  });

  it('generates a runbook URL from the service name', () => {
    const slo = buildServiceSLO({
      service: 'student',
      owner: 'Engineering',
    });
    expect(slo.runbook).toBe('https://runbooks.proctira.org/services/student.md');
  });

  it('uses provided runbook URL when given', () => {
    const slo = buildServiceSLO({
      service: 'student',
      owner: 'Engineering',
      runbook: 'https://custom.runbooks.io/student',
    });
    expect(slo.runbook).toBe('https://custom.runbooks.io/student');
  });

  it('generates oncall group from service name', () => {
    const slo = buildServiceSLO({
      service: 'attendance',
      owner: 'Engineering',
    });
    expect(slo.oncallGroup).toBe('attendance-oncall');
  });

  it('includes default alerts when none provided', () => {
    const slo = buildServiceSLO({
      service: 'test',
      owner: 'Engineering',
    });
    expect(slo.alerts.length).toBe(DEFAULT_ALERTS.length);
    expect(slo.alerts[0]!.name).toBe('ServiceDown');
  });
});

describe('DEFAULT indicator templates', () => {
  it('core service indicators have 99.9% availability', () => {
    expect(DEFAULT_CORE_SERVICE_INDICATORS.availability.target).toBe(0.999);
  });

  it('gateway indicators have relaxed latency', () => {
    expect(DEFAULT_GATEWAY_INDICATORS.latency.p95).toBe(500);
    expect(DEFAULT_GATEWAY_INDICATORS.latency.p99).toBe(1000);
  });

  it('worker indicators include queue lag', () => {
    expect(DEFAULT_WORKER_INDICATORS.queueLag).toBeDefined();
    expect(DEFAULT_WORKER_INDICATORS.queueLag!.maxLag).toBe(1000);
  });

  it('worker indicators have relaxed latency and error rate', () => {
    expect(DEFAULT_WORKER_INDICATORS.latency.p95).toBe(2000);
    expect(DEFAULT_WORKER_INDICATORS.errorRate.target).toBe(0.005);
  });
});
