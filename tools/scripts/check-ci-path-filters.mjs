#!/usr/bin/env node
/**
 * W1-OPS-05 — CI path-filter matrix gate.
 *
 * Fail closed when detect-changes filters in `.github/workflows/ci.yml` drop
 * db/sql, tools, docs, or infrastructure paths that must trigger validation
 * (shared/backend/infra buckets + job ifs + aggregate).
 *
 * Usage: node tools/scripts/check-ci-path-filters.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDocument } from 'yaml';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const CI_WORKFLOW = join(ROOT, '.github/workflows/ci.yml');

/** @typedef {{ bucket: string, paths: string[] }} FilterBucket */

/**
 * Expected path → filter buckets that must include the path (dorny globs).
 * Jobs required after those buckets flip are documented in the W1-OPS-05 audit pack.
 */
export const PATH_FILTER_MATRIX = [
  {
    path: 'db/**',
    buckets: ['backend', 'shared'],
    triggers: [
      'lint / typecheck / unit / build / dod / tenant-isolation (via shared)',
      'integration-test (via backend; runs apply-sql + SQL gates)',
      'always-on: prisma-sql-drift, strict-tenant-fks, tenant-id-indexes, migration-timeouts',
    ],
  },
  {
    path: 'tools/**',
    buckets: ['shared'],
    triggers: [
      'lint / typecheck / unit / build / dod / tenant-isolation (via shared)',
      'covers tools/scripts, tools/dod-checks, tools/tenant-isolation-tests',
      'tool unit coverage via turbo affected + dedicated always-on gates',
    ],
  },
  {
    path: 'tools/scripts/**',
    buckets: ['backend'],
    // shared covered by tools/** (dorny prefix match); backend needs the
    // explicit glob so SQL apply / aggregate helpers trip integration.
    triggers: ['integration-test / backend chain (SQL apply helpers, aggregate, bootstrap)'],
  },
  {
    path: 'tools/dod-checks/**',
    buckets: ['backend'],
    triggers: ['dod-checks job via backend + shared tools/**'],
  },
  {
    path: 'tools/tenant-isolation-tests/**',
    buckets: ['backend'],
    triggers: ['tenant-isolation job via backend + shared tools/**'],
  },
  {
    path: 'docs/**',
    buckets: ['shared'],
    triggers: ['lint / typecheck / unit / build / dod / tenant-isolation (no silent skip)'],
  },
  {
    path: 'infrastructure/**',
    buckets: ['infra'],
    triggers: [
      'lint / typecheck / unit / build / dod / tenant-isolation (infra-changed)',
      'integration-test (infra-changed; compose/helm must not proven-skip)',
    ],
  },
  {
    path: 'docker-compose*.yml',
    buckets: ['infra'],
    triggers: ['same infra-changed chain as infrastructure/**'],
  },
  {
    path: 'Dockerfile*',
    buckets: ['infra'],
    triggers: ['same infra-changed chain as infrastructure/**'],
  },
];

/**
 * Extract dorny/paths-filter bucket → path globs from ci.yml detect-changes.
 * PRC-L179: parsed with a YAML parser (workflow, then the `filters: |` string)
 * so re-indentation or quote style changes cannot silently drop buckets.
 * @param {string} yaml
 * @returns {Record<string, string[]>}
 */
export function parseDetectChangeFilters(yaml) {
  const doc = parseDocument(yaml, { uniqueKeys: false });
  if (doc.errors.length > 0) {
    throw new Error(`ci.yml is not valid YAML: ${doc.errors[0].message}`);
  }
  const workflow = doc.toJS();
  const steps = workflow?.jobs?.['detect-changes']?.steps;
  if (!Array.isArray(steps)) {
    throw new Error('detect-changes job with steps not found in ci.yml');
  }
  const step = steps.find((s) => s && s.id === 'filter');
  if (!step) {
    throw new Error('detect-changes dorny filter step (id: filter) not found');
  }
  const filters = step.with?.filters;
  if (typeof filters !== 'string' || filters.trim() === '') {
    throw new Error('detect-changes filter step has no `with.filters` block');
  }
  return parseFilterBody(filters);
}
/**
 * Parse a dorny `filters` YAML body into bucket → glob list. Fails closed on
 * invalid YAML or non-string globs.
 * @param {string} body
 * @returns {Record<string, string[]>}
 */
export function parseFilterBody(body) {
  const doc = parseDocument(body);
  if (doc.errors.length > 0) {
    throw new Error(`dorny filters block is not valid YAML: ${doc.errors[0].message}`);
  }
  const parsed = doc.toJS();
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('dorny filters block must be a mapping of bucket → globs');
  }
  /** @type {Record<string, string[]>} */
  const buckets = {};
  for (const [bucket, globs] of Object.entries(parsed)) {
    const list = Array.isArray(globs) ? globs : [globs];
    for (const g of list) {
      if (typeof g !== 'string') {
        throw new Error(`dorny bucket ${bucket} has non-string glob entry`);
      }
    }
    buckets[bucket] = list;
  }
  return buckets;
}
/**
 * @param {Record<string, string[]>} buckets
 * @param {typeof PATH_FILTER_MATRIX} matrix
 */
export function evaluatePathFilterMatrix(buckets, matrix = PATH_FILTER_MATRIX) {
  /** @type {{ ok: boolean, missing: Array<{ path: string, bucket: string }>, present: Array<{ path: string, bucket: string }> }} */
  const report = { ok: true, missing: [], present: [] };
  for (const row of matrix) {
    for (const bucket of row.buckets) {
      const list = buckets[bucket] ?? [];
      if (list.includes(row.path)) {
        report.present.push({ path: row.path, bucket });
      } else {
        report.ok = false;
        report.missing.push({ path: row.path, bucket });
      }
    }
  }
  return report;
}

/**
 * Assert job `if:` clauses still gate on infra-changed / shared / backend.
 * @param {string} yaml
 */
export function evaluateJobIfs(yaml) {
  const requiredSnippets = [
    {
      id: 'lint-infra',
      needle: "needs.detect-changes.outputs.infra-changed == 'true'",
      context: 'lint',
    },
    {
      id: 'integration-infra',
      needle:
        "needs.detect-changes.outputs.has-backend-changes == 'true' || needs.detect-changes.outputs.has-shared-changes == 'true' || needs.detect-changes.outputs.infra-changed == 'true'",
      context: 'integration-test',
    },
    {
      id: 'aggregate-infra-env',
      needle: 'INFRA_CHANGED: ${{ needs.detect-changes.outputs.infra-changed }}',
      context: 'ci-aggregate',
    },
  ];
  /** @type {{ ok: boolean, missing: string[] }} */
  const report = { ok: true, missing: [] };
  for (const item of requiredSnippets) {
    if (!yaml.includes(item.needle)) {
      report.ok = false;
      report.missing.push(`${item.id} (${item.context})`);
    }
  }
  return report;
}

/**
 * GitHub Actions job maps require unique sibling keys. Duplicate keys (e.g.
 * two `runtime-role-gate:` jobs) make the workflow invalid or silently drop a
 * definition — the W1-OPS-05 regression on main @ 29fcc1be.
 *
 * @param {string} yaml
 * @returns {{ ok: boolean, duplicates: Array<{ key: string, count: number, lines: number[] }> }}
 */
export function findDuplicateWorkflowJobKeys(yaml) {
  /** @type {Map<string, number[]>} */
  const seen = new Map();
  let inJobs = false;
  const lines = yaml.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^jobs:\s*$/.test(line)) {
      inJobs = true;
      continue;
    }
    if (!inJobs) continue;
    // Next top-level document key ends jobs (rare); stop at non-indented non-empty.
    if (/^[A-Za-z0-9_-]+:/.test(line) && !/^jobs:/.test(line)) {
      break;
    }
    const match = line.match(/^  ([A-Za-z0-9_-]+):\s*$/);
    if (match) {
      const key = match[1];
      const list = seen.get(key) ?? [];
      list.push(i + 1);
      seen.set(key, list);
    }
  }
  /** @type {Array<{ key: string, count: number, lines: number[] }>} */
  const duplicates = [];
  for (const [key, keyLines] of seen) {
    if (keyLines.length > 1) {
      duplicates.push({ key, count: keyLines.length, lines: keyLines });
    }
  }
  return { ok: duplicates.length === 0, duplicates };
}

export function checkCiPathFilters(yaml = readFileSync(CI_WORKFLOW, 'utf8')) {
  const buckets = parseDetectChangeFilters(yaml);
  const matrix = evaluatePathFilterMatrix(buckets);
  const jobIfs = evaluateJobIfs(yaml);
  const uniqueJobs = findDuplicateWorkflowJobKeys(yaml);
  return {
    buckets,
    matrix,
    jobIfs,
    uniqueJobs,
    ok: matrix.ok && jobIfs.ok && uniqueJobs.ok,
  };
}

function main() {
  const result = checkCiPathFilters();
  console.log('## CI path-filter matrix (W1-OPS-05)\n');
  for (const row of PATH_FILTER_MATRIX) {
    console.log(`- \`${row.path}\` → buckets: ${row.buckets.join(', ')}`);
    for (const t of row.triggers) {
      console.log(`  - ${t}`);
    }
  }
  console.log('');
  if (result.matrix.missing.length) {
    console.error('Missing path→bucket mappings:');
    for (const m of result.matrix.missing) {
      console.error(`  - ${m.path} not in ${m.bucket}`);
    }
  }
  if (result.jobIfs.missing.length) {
    console.error('Missing job if / aggregate wiring:');
    for (const id of result.jobIfs.missing) {
      console.error(`  - ${id}`);
    }
  }
  if (!result.uniqueJobs.ok) {
    console.error('Duplicate workflow job keys (YAML mapping collision):');
    for (const d of result.uniqueJobs.duplicates) {
      console.error(`  - ${d.key} ×${d.count} at lines ${d.lines.join(', ')}`);
    }
  }
  if (!result.ok) {
    process.exitCode = 1;
    return;
  }
  console.log('Status: pass — db/sql, tools, docs, infra paths are wired; job keys unique.');
}

if (import.meta.url === new URL(process.argv[1], 'file:').href) {
  main();
}
