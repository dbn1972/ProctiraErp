/**
 * PRC-L493: Prometheus rules generated from SLO_CATALOG; catalog-coverage
 * check (fails CI when a catalog alert has no generated rule).
 */
import { describe, expect, it } from 'vitest';
import { SLO_CATALOG } from './slo-catalog.js';
import { checkSloRuleCoverage, generatePrometheusRules, sloAlertName } from './slo-rules.js';
import { buildServiceSLO } from './slo.js';

describe('PRC-L493 SLO rule generation', () => {
  it('every SLO_CATALOG alert and queue-lag SLI has a generated rule', () => {
    expect(checkSloRuleCoverage(SLO_CATALOG)).toEqual([]);
  });

  it('emits one group per service with expr/for and catalog thresholds', () => {
    const doc = generatePrometheusRules(SLO_CATALOG);
    expect(doc.groups).toHaveLength(Object.keys(SLO_CATALOG).length);
    for (const group of doc.groups) {
      for (const rule of group.rules) {
        expect(rule.expr.trim()).not.toBe('');
        expect(rule.for).toMatch(/^\d+[smh]$/);
      }
    }
    const gw = doc.groups.find((g) => g.name === 'slo_api_gateway')!;
    const p95 = gw.rules.find(
      (r) => r.alert === sloAlertName('api-gateway', 'ServiceP95LatencyHigh'),
    )!;
    expect(p95.expr).toContain(`> ${SLO_CATALOG['api-gateway']!.indicators.latency.p95 / 1000}`);
  });

  it('adds a queue-lag rule from indicators.queueLag.maxLag', () => {
    const slo = buildServiceSLO({
      service: 'worker-x',
      owner: 'Platform',
      indicators: { queueLag: { maxLag: 250, unit: 'messages' } },
    });
    const doc = generatePrometheusRules({ 'worker-x': slo });
    const lag = doc.groups[0]!.rules.find((r) => r.labels['slo'] === 'queueLag')!;
    expect(lag.expr).toBe('max(slo_queue_lag_messages{service="worker-x"}) > 250');
  });

  it('reports a coverage failure for an alert with an unknown SLI mapping', () => {
    const slo = buildServiceSLO({
      service: 'odd',
      owner: 'Platform',
      alerts: [{ name: 'Weird', severity: 'info', sli: 'queueLag', description: 'x' }],
    });
    expect(checkSloRuleCoverage({ odd: slo }).length).toBeGreaterThan(0);
  });
});
