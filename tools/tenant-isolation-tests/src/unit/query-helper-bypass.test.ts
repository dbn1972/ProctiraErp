/**
 * W1-DATA-13 COMPLETE — monorepo fail-closed gate against raw `pool.query`
 * tenant-data bypasses.
 *
 * Residual (PARTIAL): the guard only named four repositories.
 * Complete when: an AST gate rejects direct tenant-data `pool.query` outside
 * approved helpers, with live cross-tenant denial backed separately.
 *
 * Fail-closed allowlist:
 *   1. Approved GUC / tenant binders (`withPgTenant`, `withPlatformScope`, …)
 *   2. Schema ensure / seed DDL functions (`ensure*Schema`, `ensure*Seed`)
 *   3. Health / readiness `SELECT 1` probes
 *   4. Platform catalog tables with no `tenant_id` (insights reference data)
 *   5. Explicit GUC binder fallbacks (`set_config` only) in approved binder files
 *
 * Everything else that calls `pool.query` / `this.pool.query` is a violation.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');

const SCAN_ROOTS = ['packages/backend', 'packages/shared', 'apps/api-gateway'] as const;

const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.git',
  'test-results',
  'playwright-report',
]);

/** Only these modules may bind tenant/platform GUCs (or run binder SQL). */
const APPROVED_HELPER_FILES = new Set([
  'packages/shared/database/src/pg-tenant.ts',
  'packages/shared/database/src/pg-document-store.ts',
  'packages/shared/database/src/tenant-guc.ts',
  'packages/shared/database/src/tenant-transaction.ts',
]);

/**
 * Additional files allowed to issue `pool.query` solely for `set_config` GUC
 * binding (duplicate of withPlatformScope used by the outbox path).
 */
const APPROVED_GUC_BINDER_FILES = new Set([
  'packages/shared/queue-abstraction/src/outbox/pg-outbox-store.ts',
]);

/** Platform reference tables (no tenant_id / no RLS) — not tenant data. */
const PLATFORM_CATALOG_TABLES = new Set([
  'insights_ui_templates',
  'insights_ui_indicators',
  'insights_ui_geo_features',
]);

/** Historical four cited residuals — still asserted method-by-method. */
const CITED_SITES = [
  {
    id: 'lms-modules',
    path: 'packages/backend/lms/src/pg-lms-repository.ts',
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

type PoolQueryHit = {
  file: string;
  line: number;
  fn: string | null;
  sqlPreview: string;
};

type Classification =
  | 'approved-helper'
  | 'guc-binder'
  | 'ddl-ensure'
  | 'health-probe'
  | 'platform-catalog'
  | 'violation';

function walkTsFiles(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walkTsFiles(full, out);
      continue;
    }
    if (!/\.tsx?$/.test(entry)) continue;
    if (/\.(test|spec)\.tsx?$/.test(entry)) continue;
    if (entry.endsWith('.d.ts')) continue;
    out.push(full);
  }
  return out;
}

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

/**
 * Extract a top-level async method body (brace-balanced).
 * Parameter lists may contain object type literals (`filter: { … }`); skip those
 * by balancing parentheses first, then taking the `{` that opens the body.
 */
function extractMethod(src: string, name: string): string {
  const re = new RegExp(`async ${name}\\s*\\(`);
  const m = re.exec(src);
  if (!m) throw new Error(`method ${name} not found`);
  const paramOpen = m.index + m[0].length - 1;
  let paren = 0;
  let paramEnd = -1;
  for (let i = paramOpen; i < src.length; i++) {
    const ch = src[i];
    if (ch === '(') paren++;
    else if (ch === ')') {
      paren--;
      if (paren === 0) {
        paramEnd = i;
        break;
      }
    }
  }
  if (paramEnd < 0) throw new Error(`method ${name}: unbalanced params`);
  const start = src.indexOf('{', paramEnd);
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

function isPoolQueryCall(node: ts.Node): node is ts.CallExpression {
  if (!ts.isCallExpression(node)) return false;
  const expr = node.expression;
  if (!ts.isPropertyAccessExpression(expr) || expr.name.text !== 'query') {
    return false;
  }
  const obj = expr.expression;
  if (ts.isIdentifier(obj) && obj.text === 'pool') return true;
  if (ts.isPropertyAccessExpression(obj) && obj.name.text === 'pool') return true;
  return false;
}

function enclosingFunctionName(node: ts.Node): string | null {
  let cur: ts.Node | undefined = node.parent;
  while (cur) {
    if (ts.isFunctionDeclaration(cur) && cur.name) return cur.name.text;
    if (ts.isMethodDeclaration(cur) && ts.isIdentifier(cur.name)) {
      return cur.name.text;
    }
    if (ts.isFunctionExpression(cur) || ts.isArrowFunction(cur)) {
      const parent = cur.parent;
      if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
        return parent.name.text;
      }
      if (ts.isPropertyAssignment(parent) && ts.isIdentifier(parent.name)) {
        return parent.name.text;
      }
    }
    cur = cur.parent;
  }
  return null;
}

function sqlPreview(call: ts.CallExpression): string {
  const arg = call.arguments[0];
  if (!arg) return '';
  if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) {
    return arg.text;
  }
  if (ts.isTemplateExpression(arg)) {
    return (
      arg.head.text + arg.templateSpans.map((span) => span.literal.text).join('')
    );
  }
  if (ts.isIdentifier(arg)) return `id:${arg.text}`;
  if (ts.isCallExpression(arg)) return `call:${arg.getText().slice(0, 120)}`;
  return arg.getText().slice(0, 120);
}

function extractSqlTables(sql: string): string[] {
  const tables = new Set<string>();
  const re =
    /\b(?:FROM|INTO|UPDATE|JOIN|TABLE)\s+(?:ONLY\s+)?(?:"?public"?\.)?"?([a-zA-Z_][a-zA-Z0-9_]*)"?/gi;
  for (const m of sql.matchAll(re)) {
    const name = m[1]!.toLowerCase();
    if (name === 'if' || name === 'not' || name === 'exists') continue;
    tables.add(name);
  }
  return [...tables];
}

function isDdlEnsureFn(fn: string | null): boolean {
  if (!fn) return false;
  return /^(ensureSchema|ensure\w+Schema|ensure\w+Seed)$/.test(fn);
}

function isHealthProbeSql(sql: string): boolean {
  return /^\s*SELECT\s+1\b/i.test(sql);
}

function isSetConfigOnly(sql: string): boolean {
  return /set_config\s*\(/i.test(sql) && !/\b(?:FROM|INTO|UPDATE|DELETE|INSERT)\b/i.test(sql);
}

function classifyHit(hit: PoolQueryHit): Classification {
  if (APPROVED_HELPER_FILES.has(hit.file)) return 'approved-helper';

  if (APPROVED_GUC_BINDER_FILES.has(hit.file) && isSetConfigOnly(hit.sqlPreview)) {
    return 'guc-binder';
  }

  if (isDdlEnsureFn(hit.fn)) return 'ddl-ensure';

  if (isHealthProbeSql(hit.sqlPreview)) return 'health-probe';

  const tables = extractSqlTables(hit.sqlPreview);
  if (
    tables.length > 0 &&
    tables.every((t) => PLATFORM_CATALOG_TABLES.has(t))
  ) {
    return 'platform-catalog';
  }

  // ensureReady seeds platform catalog via INSERT INTO insights_ui_* — covered
  // by table allowlist above when SQL is inline. If SQL is opaque, fail closed.
  return 'violation';
}

function collectPoolQueryHits(): PoolQueryHit[] {
  const hits: PoolQueryHit[] = [];
  for (const scanRoot of SCAN_ROOTS) {
    const absRoot = join(ROOT, scanRoot);
    for (const file of walkTsFiles(absRoot)) {
      const rel = relative(ROOT, file).replace(/\\/g, '/');
      const text = readFileSync(file, 'utf8');
      if (!/\.query\s*\(/.test(text)) continue;
      const sf = ts.createSourceFile(
        rel,
        text,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS,
      );
      const visit = (node: ts.Node): void => {
        if (isPoolQueryCall(node)) {
          const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
          hits.push({
            file: rel,
            line: line + 1,
            fn: enclosingFunctionName(node),
            sqlPreview: sqlPreview(node),
          });
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
    }
  }
  return hits;
}

describe('W1-DATA-13 query-helper bypass guard (static / AST)', () => {
  it('documents COMPLETE status in the audit pack', () => {
    const complete = readFileSync(
      join(ROOT, 'docs/audits/DATA_W1_DATA_13_COMPLETE.md'),
      'utf8',
    );
    expect(complete).toMatch(/W1-DATA-13/);
    expect(complete).toMatch(/COMPLETE|Complete/);
    expect(complete).toMatch(/fail-closed|monorepo/i);

    const prior = readFileSync(
      join(ROOT, 'docs/audits/DATA_W1_DATA_13_QUERY_HELPER.md'),
      'utf8',
    );
    for (const site of CITED_SITES) {
      expect(prior, `prior audit must cite ${site.id}`).toContain(site.path);
    }
  });

  it('routes each cited residual method through withPgTenant / withPlatformScope', () => {
    for (const site of CITED_SITES) {
      const raw = readFileSync(join(ROOT, site.path), 'utf8');
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
      join(ROOT, 'packages/backend/registration/src/pg-registration-repository.ts'),
      'utf8',
    );
    expect(reg).toMatch(/findByTrackingNumber: tenantId is required/);
    expect(reg).toMatch(/findById: tenantId is required/);

    const etl = readFileSync(
      join(ROOT, 'packages/backend/etl/src/pg-pipeline-repository.ts'),
      'utf8',
    );
    expect(etl).toMatch(/updateExecution: tenantId is required/);
  });

  it('AST monorepo gate: no tenant-data pool.query outside fail-closed allowlist', () => {
    const hits = collectPoolQueryHits();
    expect(hits.length, 'expected to discover pool.query call sites').toBeGreaterThan(0);

    const violations: string[] = [];
    const allowedCounts: Record<Exclude<Classification, 'violation'>, number> = {
      'approved-helper': 0,
      'guc-binder': 0,
      'ddl-ensure': 0,
      'health-probe': 0,
      'platform-catalog': 0,
    };

    for (const hit of hits) {
      const kind = classifyHit(hit);
      if (kind === 'violation') {
        const preview = hit.sqlPreview.replace(/\s+/g, ' ').slice(0, 100);
        violations.push(
          `${hit.file}:${hit.line} fn=${hit.fn ?? '<anon>'} sql=${JSON.stringify(preview)}`,
        );
      } else {
        allowedCounts[kind]++;
      }
    }

    expect(
      violations,
      violations.length > 0
        ? `W1-DATA-13 tenant-data pool.query bypasses (add helper routing or allowlist only if non-tenant):\n${violations.join('\n')}`
        : undefined,
    ).toEqual([]);

    // Sanity: DDL ensures still exist so the gate is scanning real repos.
    expect(allowedCounts['ddl-ensure']).toBeGreaterThan(10);
    expect(allowedCounts['health-probe']).toBeGreaterThanOrEqual(1);
  });

  it('approved helpers export withPgTenant / withPlatformScope binders', () => {
    const pgTenant = readFileSync(
      join(ROOT, 'packages/shared/database/src/pg-tenant.ts'),
      'utf8',
    );
    expect(pgTenant).toMatch(/export async function withPgTenant/);

    const docStore = readFileSync(
      join(ROOT, 'packages/shared/database/src/pg-document-store.ts'),
      'utf8',
    );
    expect(docStore).toMatch(/export async function withPlatformScope/);
  });
});
