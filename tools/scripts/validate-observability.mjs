#!/usr/bin/env node
/**
 * Lightweight syntactic check for the infra/observability artefacts.
 * - Parses every YAML file with js-yaml.
 * - Parses every Grafana dashboard JSON.
 * - Asserts expected alert rule names are present.
 * Exits non-zero on the first failure class.
 *
 * Wired into .github/workflows/observability-config.yml (W1-OPS-24).
 *
 * Usage: node tools/scripts/validate-observability.mjs
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');

const yamlFiles = [
  'infra/observability/prometheus.yml',
  'infra/observability/alertmanager.yml.tpl',
  'infra/observability/grafana/provisioning/datasources.yml',
  'infra/observability/grafana/provisioning/dashboards.yml',
  'infra/observability/docker-compose.observability.yml',
];

const jsonFiles = [
  'infra/observability/grafana/dashboards/service-overview.json',
  'infra/observability/grafana/dashboards/slo-tracking.json',
  'infra/observability/grafana/dashboards/tenant-overview.json',
  'infra/observability/grafana/dashboards/dependencies.json',
];

const expectedAlertGroups = {
  'infra/observability/alerts/availability.yml': ['ServiceErrorRateHigh', 'ServiceDown'],
  'infra/observability/alerts/latency.yml': ['ServiceP95LatencyHigh'],
  'infra/observability/alerts/error_rate.yml': ['ErrorBudgetBurnFast'],
  'infra/observability/alerts/saturation.yml': ['ProcessCPUHigh', 'ProcessMemoryHigh'],
  'infra/observability/alerts/queue_lag.yml': ['KafkaConsumerLagHigh', 'KafkaConsumerLagCritical'],
  'infra/observability/alerts/critical_journeys.yml': [
    'ParentPortalJourneyErrorBudgetBurn',
    'AuthLoginJourneyErrorBudgetBurn',
  ],
};

async function loadYaml() {
  try {
    return await import('js-yaml');
  } catch {
    /* fall through */
  }
  const candidates = [
    '../../node_modules/.pnpm/js-yaml@4.1.1/node_modules/js-yaml/dist/js-yaml.mjs',
    '../../node_modules/js-yaml/dist/js-yaml.mjs',
  ];
  for (const c of candidates) {
    try {
      return await import(new URL(c, import.meta.url).href);
    } catch {
      /* try next */
    }
  }
  throw new Error('Unable to locate js-yaml. Run `pnpm install` first.');
}

const yaml = await loadYaml();

let failed = false;

const alertDir = resolve(root, 'infra/observability/alerts');
const alertYamlFiles = readdirSync(alertDir)
  .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
  .map((f) => join('infra/observability/alerts', f))
  .sort();

for (const f of [...yamlFiles, ...alertYamlFiles]) {
  const path = resolve(root, f);
  try {
    // alertmanager.yml.tpl uses ${VAR} — strip for YAML parse of structure.
    let text = readFileSync(path, 'utf8');
    if (f.endsWith('.tpl')) {
      text = text.replace(/\$\{[A-Z0-9_]+(?::-?[^}]*)?\}/g, 'PLACEHOLDER');
    }
    yaml.load(text);
    console.log(`yaml  OK: ${f}`);
  } catch (err) {
    console.error(`yaml FAIL: ${f}: ${err.message}`);
    failed = true;
  }
}

for (const f of jsonFiles) {
  const path = resolve(root, f);
  try {
    JSON.parse(readFileSync(path, 'utf8'));
    console.log(`json  OK: ${f}`);
  } catch (err) {
    console.error(`json FAIL: ${f}: ${err.message}`);
    failed = true;
  }
}

for (const [f, expected] of Object.entries(expectedAlertGroups)) {
  let text;
  try {
    text = readFileSync(resolve(root, f), 'utf8');
  } catch (err) {
    console.error(`alert FAIL: ${f}: ${err.message}`);
    failed = true;
    continue;
  }
  for (const name of expected) {
    if (!text.includes(name)) {
      console.error(`alert FAIL: ${f} missing rule ${name}`);
      failed = true;
    }
  }
}

if (failed) {
  process.exit(1);
}
console.log('all observability artefacts OK');
