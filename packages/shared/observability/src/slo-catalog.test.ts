/**
 * Tests for the SLO catalog — ensures all predefined service SLO definitions
 * are structurally valid and consistent.
 */
import { describe, expect, it } from 'vitest';

import { SLO_CATALOG } from './slo-catalog.js';
import type { ServiceSLO } from './slo.js';

describe('SLO Catalog', () => {
  const entries = Object.entries(SLO_CATALOG);

  it('contains at least 20 service definitions', () => {
    expect(entries.length).toBeGreaterThanOrEqual(20);
  });

  it.each(entries)(
    '%s has a valid service name matching its key',
    (key, slo: ServiceSLO) => {
      expect(slo.service).toBe(key);
    },
  );

  it.each(entries)(
    '%s has availability target in (0, 1]',
    (_key, slo: ServiceSLO) => {
      expect(slo.indicators.availability.target).toBeGreaterThan(0);
      expect(slo.indicators.availability.target).toBeLessThanOrEqual(1);
    },
  );

  it.each(entries)(
    '%s has p95 <= p99 latency',
    (_key, slo: ServiceSLO) => {
      expect(slo.indicators.latency.p95).toBeLessThanOrEqual(
        slo.indicators.latency.p99,
      );
    },
  );

  it.each(entries)(
    '%s has positive latency targets',
    (_key, slo: ServiceSLO) => {
      expect(slo.indicators.latency.p95).toBeGreaterThan(0);
      expect(slo.indicators.latency.p99).toBeGreaterThan(0);
    },
  );

  it.each(entries)(
    '%s has error rate target in (0, 1)',
    (_key, slo: ServiceSLO) => {
      expect(slo.indicators.errorRate.target).toBeGreaterThan(0);
      expect(slo.indicators.errorRate.target).toBeLessThan(1);
    },
  );

  it.each(entries)(
    '%s has saturation targets in (0, 1]',
    (_key, slo: ServiceSLO) => {
      expect(slo.indicators.saturation.cpuTarget).toBeGreaterThan(0);
      expect(slo.indicators.saturation.cpuTarget).toBeLessThanOrEqual(1);
      expect(slo.indicators.saturation.memoryTarget).toBeGreaterThan(0);
      expect(slo.indicators.saturation.memoryTarget).toBeLessThanOrEqual(1);
    },
  );

  it.each(entries)(
    '%s has a non-empty owner',
    (_key, slo: ServiceSLO) => {
      expect(slo.owner.trim().length).toBeGreaterThan(0);
    },
  );

  it.each(entries)(
    '%s has a non-empty runbook URL',
    (_key, slo: ServiceSLO) => {
      expect(slo.runbook.trim().length).toBeGreaterThan(0);
      expect(slo.runbook).toContain('runbooks');
    },
  );

  it.each(entries)(
    '%s has at least one alert defined',
    (_key, slo: ServiceSLO) => {
      expect(slo.alerts.length).toBeGreaterThan(0);
    },
  );

  it.each(entries)(
    '%s has an oncall group',
    (_key, slo: ServiceSLO) => {
      expect(slo.oncallGroup).toBeDefined();
      expect(slo.oncallGroup!.length).toBeGreaterThan(0);
    },
  );

  it('all services with queueLag have positive maxLag', () => {
    for (const [, slo] of entries) {
      if (slo.indicators.queueLag) {
        expect(slo.indicators.queueLag.maxLag).toBeGreaterThan(0);
      }
    }
  });

  it('includes all critical core services', () => {
    const coreServices = [
      'api-gateway',
      'auth',
      'institution',
      'student',
      'staff',
      'assessment',
      'attendance',
      'examination',
    ];
    for (const svc of coreServices) {
      expect(SLO_CATALOG[svc]).toBeDefined();
    }
  });

  it('includes platform services', () => {
    const platformServices = [
      'workflow',
      'notification',
      'audit',
      'report',
    ];
    for (const svc of platformServices) {
      expect(SLO_CATALOG[svc]).toBeDefined();
    }
  });
});
