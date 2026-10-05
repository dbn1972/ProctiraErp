/**
 * PRC-L493: generate Prometheus alerting rules from SLO_CATALOG so alert
 * thresholds come from the same definitions services register at startup.
 *
 * Output is a plain object in Prometheus rule-file shape (`groups[].rules[]`);
 * serialise it with any YAML/JSON writer. One group per service; every alert
 * in the service's SLO gets a rule, with thresholds from its indicators.
 */
import type { AlertConfig, ServiceSLO } from './slo.js';

export interface PrometheusAlertRule {
  alert: string;
  expr: string;
  for: string;
  labels: Record<string, string>;
  annotations: Record<string, string>;
}

export interface PrometheusRuleGroup {
  name: string;
  interval: string;
  rules: PrometheusAlertRule[];
}

export interface PrometheusRulesDocument {
  groups: PrometheusRuleGroup[];
}

/** Stable per-service alert name, e.g. `api_gateway_ServiceDown`. */
export function sloAlertName(service: string, alert: string): string {
  return `${service.replace(/[^a-zA-Z0-9]/g, '_')}_${alert}`;
}

function sel(service: string): string {
  return `service="${service}"`;
}

function errorRatio(service: string, window: string): string {
  return (
    `sum(rate(http_requests_total{${sel(service)},status=~"5.."}[${window}])) / ` +
    `clamp_min(sum(rate(http_requests_total{${sel(service)}}[${window}])), 1e-9)`
  );
}

function latencyQuantile(service: string, q: number): string {
  return `histogram_quantile(${q}, sum by (le) (rate(http_request_duration_seconds_bucket{${sel(service)}}[5m])))`;
}

/** PromQL + `for` for one catalog alert, or null when the SLI is not defined. */
function ruleFor(slo: ServiceSLO, alert: AlertConfig): { expr: string; for: string } | null {
  const { service, indicators } = slo;
  const budget = indicators.errorRate.target;
  switch (alert.name) {
    case 'ServiceDown':
      return { expr: `up{job="${service}"} == 0`, for: '2m' };
    case 'ServiceErrorRateHigh':
      return { expr: `${errorRatio(service, '5m')} > ${budget * 10}`, for: '10m' };
    case 'ServiceErrorRateCritical':
      return { expr: `${errorRatio(service, '5m')} > ${budget * 50}`, for: '5m' };
    case 'ErrorBudgetBurnFast':
      return { expr: `${errorRatio(service, '1h')} > ${budget * 14.4}`, for: '5m' };
    case 'ErrorBudgetBurnSlow':
      return { expr: `${errorRatio(service, '6h')} > ${budget * 6}`, for: '30m' };
    case 'ServiceP95LatencyHigh':
      return {
        expr: `${latencyQuantile(service, 0.95)} > ${indicators.latency.p95 / 1000}`,
        for: '10m',
      };
    case 'ServiceP99LatencyHigh':
      return {
        expr: `${latencyQuantile(service, 0.99)} > ${indicators.latency.p99 / 1000}`,
        for: '10m',
      };
    default:
      break;
  }
  switch (alert.sli) {
    case 'saturation':
      return {
        expr: `avg(rate(process_cpu_seconds_total{job="${service}"}[5m])) > ${indicators.saturation.cpuTarget}`,
        for: '15m',
      };
    case 'queueLag':
      if (!indicators.queueLag) return null;
      return {
        expr: `max(slo_queue_lag_messages{${sel(service)}}) > ${indicators.queueLag.maxLag}`,
        for: '10m',
      };
    case 'availability':
      return {
        expr: `${errorRatio(service, '30m')} > ${1 - indicators.availability.target}`,
        for: '15m',
      };
    case 'errorRate':
      return { expr: `${errorRatio(service, '1h')} > ${budget}`, for: '15m' };
    case 'latency':
      return {
        expr: `${latencyQuantile(service, 0.95)} > ${indicators.latency.p95 / 1000}`,
        for: '10m',
      };
    default:
      return null;
  }
}

/** Generate the Prometheus rules document for every catalog service. */
export function generatePrometheusRules(
  catalog: Record<string, ServiceSLO>,
): PrometheusRulesDocument {
  const groups: PrometheusRuleGroup[] = [];
  for (const slo of Object.values(catalog).sort((a, b) => a.service.localeCompare(b.service))) {
    const rules: PrometheusAlertRule[] = [];
    for (const alert of slo.alerts) {
      const rule = ruleFor(slo, alert);
      if (!rule) continue;
      rules.push({
        alert: sloAlertName(slo.service, alert.name),
        expr: rule.expr,
        for: rule.for,
        labels: { severity: alert.severity, service: slo.service, slo: alert.sli },
        annotations: {
          summary: `${slo.service}: ${alert.name}`,
          description: alert.description,
          runbook_url: slo.runbook,
        },
      });
    }
    if (slo.indicators.queueLag && !slo.alerts.some((a) => a.sli === 'queueLag')) {
      rules.push({
        alert: sloAlertName(slo.service, 'QueueLagAboveSLO'),
        expr: `max(slo_queue_lag_messages{${sel(slo.service)}}) > ${slo.indicators.queueLag.maxLag}`,
        for: '10m',
        labels: { severity: 'warning', service: slo.service, slo: 'queueLag' },
        annotations: {
          summary: `${slo.service}: queue lag above ${slo.indicators.queueLag.maxLag} messages`,
          description: 'Consumer lag exceeded the SLO maxLag for 10 minutes.',
          runbook_url: slo.runbook,
        },
      });
    }
    groups.push({
      name: `slo_${slo.service.replace(/[^a-zA-Z0-9]/g, '_')}`,
      interval: '30s',
      rules,
    });
  }
  return { groups };
}

/**
 * Catalog-coverage check (CI): every catalog alert must produce a rule, and
 * every service with a queueLag SLI must have a lag rule. Returns failures.
 */
export function checkSloRuleCoverage(catalog: Record<string, ServiceSLO>): string[] {
  const doc = generatePrometheusRules(catalog);
  const names = new Set(doc.groups.flatMap((g) => g.rules.map((r) => r.alert)));
  const failures: string[] = [];
  for (const slo of Object.values(catalog)) {
    for (const alert of slo.alerts) {
      if (!names.has(sloAlertName(slo.service, alert.name))) {
        failures.push(`no rule generated for ${slo.service}/${alert.name} (sli ${alert.sli})`);
      }
    }
    if (
      slo.indicators.queueLag &&
      !doc.groups.some((g) =>
        g.rules.some((r) => r.labels['service'] === slo.service && r.labels['slo'] === 'queueLag'),
      )
    ) {
      failures.push(`no queue-lag rule for ${slo.service}`);
    }
  }
  return failures;
}
