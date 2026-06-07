#!/usr/bin/env node
/**
 * Lightweight syntactic check for the infra/observability artefacts.
 * - Parses every YAML file with js-yaml.
 * - Parses every Grafana dashboard JSON.
 * Exits non-zero on the first failure.
 *
 * Usage: node tools/scripts/validate-observability.mjs
 */
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');

const yamlFiles = [
  'infra/observability/prometheus.yml',
  'infra/observability/alertmanager.yml',
  'infra/observability/alerts/availability.yml',
  'infra/observability/alerts/latency.yml',
  'infra/observability/alerts/error_rate.yml',
  'infra/observability/alerts/saturation.yml',
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

// js-yaml is already in the workspace transitively (via pnpm). Resolve it
// from the local pnpm store so this script works without a top-level
// devDependency.
async function loadYaml() {
  // Prefer a top-level dep if one ever exists
  try { return await import('js-yaml'); } catch { /* fall through */ }
  const candidates = [
    '../../node_modules/.pnpm/js-yaml@4.1.1/node_modules/js-yaml/dist/js-yaml.mjs',
    '../../node_modules/js-yaml/dist/js-yaml.mjs',
  ];
  for (const c of candidates) {
    try {
      return await import(new URL(c, import.meta.url).href);
    } catch { /* try next */ }
  }
  throw new Error('Unable to locate js-yaml. Run `pnpm install` first.');
}

const yaml = await loadYaml();

let failed = false;
for (const f of yamlFiles) {
  const path = resolve(root, f);
  try {
    yaml.load(await readFile(path, 'utf8'));
    console.log(`yaml  OK: ${f}`);
  } catch (err) {
    console.error(`yaml FAIL: ${f}: ${err.message}`);
    failed = true;
  }
}

for (const f of jsonFiles) {
  const path = resolve(root, f);
  try {
    JSON.parse(await readFile(path, 'utf8'));
    console.log(`json  OK: ${f}`);
  } catch (err) {
    console.error(`json FAIL: ${f}: ${err.message}`);
    failed = true;
  }
}

// Sanity-check the alert rules contain at least one alert expression
// per file, so we don't ship a structurally-valid but empty rules file.
const expectedAlertGroups = {
  'infra/observability/alerts/availability.yml': ['ServiceErrorRateHigh', 'ServiceDown'],
  'infra/observability/alerts/latency.yml': ['ServiceP95LatencyHigh'],
  'infra/observability/alerts/error_rate.yml': ['ErrorBudgetBurnFast'],
  'infra/observability/alerts/saturation.yml': ['ProcessCPUHigh', 'ProcessMemoryHigh'],
};

for (const [f, expected] of Object.entries(expectedAlertGroups)) {
  const text = await readFile(resolve(root, f), 'utf8');
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
