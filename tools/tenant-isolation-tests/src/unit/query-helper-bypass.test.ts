/**
 * W1-DATA-13 — residual raw `pool.query` sites must not bypass tenant helpers.
 *
 * The four cited domains (LMS modules, registration lookups, enrollment history
 * discovery, ETL execution update) must route data queries through
 * `withPgTenant` / `withPlatformScope` so an RLS GUC is always set.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../../..');

const CITED_SITES = [
  {
    id: 'lms-modules',
    path: 'packages/backend/lms/src/pg-lms-repository.ts',
    /** Data methods that previously called this.pool.query unbound. */
    methods: [
      'createModule',
      'findModule',
      'listModules',
      'createModuleItem',
      'listModuleItems',
    ],
  },
  {
    id: 'registration-lookups',
    path: 'packages/backend/registration/src/pg-registration-repository.ts',
    methods: ['findByTrackingNumber', 'findById'],
  },
  {
    id: 'enrollment-history',
    path: 'packages/backend/student/src/enrollment/pg-enrollment-repository.ts',
    methods: ['getHistoryByEnrollmentId'],
  },
  {
    id: 'etl-execution-update',
    path: 'packages/backend/etl/src/pg-pipeline-repository.ts',
    methods: ['updateExecution'],
  },
] as const;

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

/** Extract a top-level async method body (brace-balanced). */
function extractMethod(src: string, name: string): string {
  const re = new RegExp(`async ${name}\\s*\\(`);
  const m = re.exec(src);
  if (!m) throw new Error(`method ${name} not found`);
  const start = src.indexOf('{', m.index);
  if (start < 0) throw new Error(`method ${name}: missing body`);
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`method ${name}: unbalanced braces`);
}

describe('W1-DATA-13 query-helper bypass guard (static)', () => {
  it('documents the four cited sites in the audit pack', () => {
    const audit = readFileSync(
      join(root, 'docs/audits/DATA_W1_DATA_13_QUERY_HELPER.md'),
      'utf8',
    );
    expect(audit).toMatch(/W1-DATA-13/);
    for (const site of CITED_SITES) {
      expect(audit, `audit must cite ${site.id}`).toContain(site.path);
    }
  });

  it('routes each cited data method through withPgTenant / withPlatformScope', () => {
    for (const site of CITED_SITES) {
      const raw = readFileSync(join(root, site.path), 'utf8');
      const src = stripComments(raw);
      for (const method of site.methods) {
        const body = extractMethod(src, method);
        expect(
          body,
          `${site.path}#${method} must not call pool.query for data`,
        ).not.toMatch(/(?:this\.)?pool\.query\s*\(/);
        const usesTenantHelper =
          /withTenant\s*\(/.test(body) ||
          /withPgTenant\s*\(/.test(body) ||
          /withPlatformScope\s*\(/.test(body);
        expect(
          usesTenantHelper,
          `${site.path}#${method} must use withTenant / withPgTenant / withPlatformScope`,
        ).toBe(true);
      }
    }
  });

  it('registration + ETL deny missing tenantId in source', () => {
    const reg = readFileSync(
      join(root, 'packages/backend/registration/src/pg-registration-repository.ts'),
      'utf8',
    );
    expect(reg).toMatch(/findByTrackingNumber: tenantId is required/);
    expect(reg).toMatch(/findById: tenantId is required/);

    const etl = readFileSync(
      join(root, 'packages/backend/etl/src/pg-pipeline-repository.ts'),
      'utf8',
    );
    expect(etl).toMatch(/updateExecution: tenantId is required/);
  });
});
