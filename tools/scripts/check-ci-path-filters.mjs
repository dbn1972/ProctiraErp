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

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const CI_WORKFLOW = join(ROOT, '.github/workflows/ci.yml');

/** @typedef {{ bucket: string, paths: string[] }} FilterBucket */

/**
 * Expected path → filter buckets that must include the path (dorny globs).
 * Jobs required after those buckets flip are documented in the COMPLETE audit.
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
    triggers: [
      'integration-test / backend chain (SQL apply helpers, aggregate, bootstrap)',
    ],
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
    triggers: [
      'lint / typecheck / unit / build / dod / tenant-isolation (no silent skip)',
    ],
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
 * @param {string} yaml
 * @returns {Record<string, string[]>}
 */
export function parseDetectChangeFilters(yaml) {
  const marker = 'id: filter';
  const start = yaml.indexOf(marker);
  if (start < 0) {
    throw new Error('detect-changes dorny filter step (id: filter) not found');
  }

  // Capture the `filters: |` block until the next top-level job key or blank
  // section outside the indented filter body.
  const after = yaml.slice(start);
  const filtersMatch = after.match(/\n\s+filters:\s*\|\s*\n([\s\S]*?)(?=\n  [a-zA-Z-]+:|\n# ---|\njobs:)/);
  if (!filtersMatch) {
    // Fallback: take until next job-level `name:` at column 2 after detect-changes.
    const alt = after.match(/\n\s+filters:\s*\|\s*\n([\s\S]*?)\n  # -+/);
    if (!alt) {
      throw new Error('Unable to locate dorny filters: | block under detect-changes');
    }
    return parseFilterBody(alt[1]);
  }
  return parseFilterBody(filtersMatch[1]);
}

/**
 * @param {string} body
 * @returns {Record<string, string[]>}
 */
export function parseFilterBody(body) {
  /** @type {Record<string, string[]>} */
  const buckets = {};
  let current = null;
  for (const rawLine of body.split('\n')) {
    const line = rawLine.replace(/\t/g, '    ');
    const bucketMatch = line.match(/^\s{12}([a-z0-9_]+):\s*$/);
    if (bucketMatch) {
      current = bucketMatch[1];
      buckets[current] = buckets[current] ?? [];
      continue;
    }
    const pathMatch = line.match(/^\s{14}-\s+'([^']+)'\s*$/);
    if (pathMatch && current) {
      buckets[current].push(pathMatch[1]);
    }
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
      needle: 'needs.detect-changes.outputs.infra-changed == \'true\'',
      context: 'lint',
    },
    {
      id: 'integration-infra',
      needle:
        'needs.detect-changes.outputs.has-backend-changes == \'true\' || needs.detect-changes.outputs.has-shared-changes == \'true\' || needs.detect-changes.outputs.infra-changed == \'true\'',
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

export function checkCiPathFilters(yaml = readFileSync(CI_WORKFLOW, 'utf8')) {
  const buckets = parseDetectChangeFilters(yaml);
  const matrix = evaluatePathFilterMatrix(buckets);
  const jobIfs = evaluateJobIfs(yaml);
  return { buckets, matrix, jobIfs, ok: matrix.ok && jobIfs.ok };
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
  if (!result.ok) {
    process.exitCode = 1;
    return;
  }
  console.log('Status: pass — db/sql, tools, docs, infra paths are wired.');
}

if (import.meta.url === new URL(process.argv[1], 'file:').href) {
  main();
}
