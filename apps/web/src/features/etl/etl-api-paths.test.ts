/**
 * PRC-M579 — every ETL UI path resolves to a mounted gateway prefix
 * (apps/api-gateway mount matrix) and to a route the ETL plugin registers
 * (packages/backend/etl/src/routes.ts). Fails if a UI path has no route.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { MOUNT_MATRIX } from '../../../../api-gateway/src/mount-matrix';

import { etlPaths } from './etl-api-paths';

const ETL_ROUTES_FILE = resolve(__dirname, '../../../../../packages/backend/etl/src/routes.ts');

/** Backend route patterns as regexes, e.g. `/pipelines/:pipelineId/executions`. */
function backendRoutePatterns(prefix: string): RegExp[] {
  const src = readFileSync(ETL_ROUTES_FILE, 'utf8');
  const suffixes = new Set<string>(['']);
  for (const m of src.matchAll(/`\$\{prefix\}([^`]*)`/g)) suffixes.add(m[1]!);
  return [...suffixes].map(
    (suffix) => new RegExp(`^${(prefix + suffix).replace(/:[A-Za-z]+/g, '[^/]+')}$`),
  );
}

function stripQuery(path: string): string {
  return path.split('?')[0]!;
}

const uiPaths = [
  etlPaths.pipelines(new URLSearchParams({ page: '1' })),
  etlPaths.pipelines(),
  etlPaths.pipeline('p-1'),
  etlPaths.execute('p-1'),
  etlPaths.executions('p-1', new URLSearchParams({ page: '2' })),
  etlPaths.execution('p-1', 'e-9'),
];

describe('ETL UI path contract (PRC-M579)', () => {
  const etlEntry = MOUNT_MATRIX.find((e) => e.package === 'etl');

  it('ETL is mounted in the gateway', () => {
    expect(etlEntry?.mounted).toBe(true);
  });

  it.each(uiPaths)('%s is under a mounted prefix and matches an ETL route', (path) => {
    const bare = stripQuery(path);
    const prefix = etlEntry!.prefixes.find((p) => bare === p || bare.startsWith(`${p}/`));
    expect(prefix, `no mounted gateway prefix for ${bare}`).toBeDefined();
    expect(backendRoutePatterns(prefix!).some((re) => re.test(bare))).toBe(true);
  });

  it('no ETL screen uses the unmounted /etl/* API alias', () => {
    const pagesDir = resolve(__dirname, 'pages');
    for (const file of readdirSync(pagesDir).filter((f) => f.endsWith('.tsx'))) {
      const src = readFileSync(resolve(pagesDir, file), 'utf8');
      expect(src, file).not.toMatch(/browserGatewayFetch[^(]*\(\s*[`'"]\/etl\//);
    }
  });
});
