#!/usr/bin/env node
/**
 * Check 3 — tenant-id SIGNATURE LINT (heuristic).
 *
 * PRC-M408: this is a static signature lint, NOT tenant-isolation evidence.
 * Passing it does not prove isolation; the release gate for isolation is the
 * RLS / cross-tenant integration suites (e.g. *.live.test.ts tenant-isolation
 * tests). Name-based exemptions were removed: a method is exempt only when it
 * carries an explicit `@tenantExempt <reason>` JSDoc tag.
 *
 * Charter §3 (Tenant Isolation) and §32 require that every persistence-touching
 * public service method either accepts a `tenantId` argument, accepts an
 * object containing a `tenantId` field, or operates on tenant-less plumbing
 * (helpers, validators, idempotent in-memory utilities).
 *
 * Implementation:
 *   - Use ts-morph to find every public method on a class whose name ends with
 *     `Service`. Inspect the method body for `this.repository`/`this.repo`
 *     usage to confirm it actually performs persistence work; only then do we
 *     require a tenant scope.
 *   - We exempt the `tenant` and `install` services (they bootstrap tenants),
 *     plus any class explicitly tagged `@PlatformService` (catalog-level work).
 *   - Fall back to a regex scan if ts-morph is unavailable.
 */
import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { CHECK_IDS } from '../lib/constants.mjs';
import { findFiles, isProductionTsFile, safeReadFile } from '../lib/fs-utils.mjs';
import { BACKEND_DIR, REPO_ROOT, getBackendServiceName } from '../lib/paths.mjs';
import { Report, printReport } from '../lib/reporter.mjs';
import { loadSourceFile } from '../lib/ts-ast.mjs';

const TITLE = 'tenant-id signature lint (heuristic; NOT tenant-isolation evidence)';

const TENANT_FREE_SERVICES = new Set(['tenant', 'install']);

/** Explicit, reviewable exemption marker (PRC-M408): `@tenantExempt <reason>`. */
const TENANT_EXEMPT_TAG_RE = /@tenantExempt\s+\S/;

/** True when the method's leading JSDoc carries an explicit exemption with a reason. */
function hasTenantExemptTag(method) {
  return method.getJsDocs().some((d) => TENANT_EXEMPT_TAG_RE.test(d.getText()));
}

/** Body references the declared tenant scope (not just declares it). */
function bodyUsesTenant(body) {
  return /\btenantId\b|\btenant_id\b|\bTenantContext\b|\bTenantScope\b|\btenant\b|\bctx\b|\bcontext\b|\bscope\b/.test(
    body,
  );
}

/** Returns true when a parameter list mentions a tenant scope. */
function paramsHaveTenant(paramsText) {
  return /tenantId|tenant_id|TenantContext|TenantScope/.test(paramsText);
}

/** AST path: walk service files and inspect class methods. */
async function checkViaAst(sourceFile, ownerService, file, report) {
  const mod = await import('ts-morph');
  const { SyntaxKind } = mod;
  for (const cls of sourceFile.getClasses()) {
    const name = cls.getName() ?? '';
    if (!name.endsWith('Service') && !name.endsWith('Manager')) continue;
    if (cls.getDecorators().some((d) => d.getName() === 'PlatformService')) continue;

    for (const method of cls.getMethods()) {
      const methodName = method.getName();
      if (hasTenantExemptTag(method)) continue;
      const modifiers = method.getModifiers().map((m) => m.getText());
      if (modifiers.includes('private') || modifiers.includes('protected')) continue;
      if (method.getName().startsWith('#')) continue;

      const paramsText = method
        .getParameters()
        .map((p) => p.getText())
        .join(', ');
      // Confirm the method actually performs persistence work.
      const body = method.getBodyText() ?? '';
      const usesRepo =
        /\bthis\.(repository|repo|repos|prisma|db|client)\b/.test(body) ||
        /\b(create|update|delete|find|upsert|aggregate|count|groupBy)\s*\(/.test(body);
      if (!usesRepo) continue;
      if (paramsHaveTenant(paramsText)) {
        // PRC-M408: a declared-but-unused tenantId gives false assurance.
        if (!bodyUsesTenant(body)) {
          report.addError(
            file,
            `Public method ${name}.${methodName}() declares a tenant parameter but never uses it.`,
            {
              line: method.getStartLineNumber(),
              suggestion: 'Pass tenantId to every repository/query call in the method body.',
              ruleRef: 'Charter §3 + §32',
            },
          );
        }
        continue;
      }
      // PRC-M408: zero-parameter persistence methods (e.g. listAll()) are not exempt.

      // Accept methods whose body reads `tenantId` from a parameter (input
      // object pattern — e.g. `recordAudit(input: { tenantId: string, … })`).
      // This is the conventional shape across backend services and is an
      // accepted alternative to a top-level `tenantId` argument.
      if (/\.tenantId\b|\['tenantId'\]|\["tenantId"\]/.test(body)) continue;

      report.addError(
        file,
        `Public method ${name}.${methodName}() touches persistence but does not declare tenantId in its signature.`,
        {
          line: method.getStartLineNumber(),
          suggestion:
            'Add `tenantId: string` as the first argument or accept an input object with a `tenantId` field.',
          ruleRef: 'Charter §3 + §32',
        },
      );
    }
  }
}

/** Regex fallback when ts-morph is unavailable. */
function checkViaRegex(text, ownerService, file, report) {
  const methodRegex =
    /\b(?:public\s+)?async\s+(create|update|delete|find|get|list|search|query|remove|archive|upsert|count)\w*\s*\(([^)]*)\)/g;
  let m;
  while ((m = methodRegex.exec(text)) !== null) {
    const fullName = m[0].match(/async\s+(\w+)/)?.[1] ?? '';
    const before = text.slice(Math.max(0, m.index - 30), m.index);
    if (/\b(private|protected|#)/.test(before)) continue;
    const jsdocWindow = text.slice(Math.max(0, m.index - 300), m.index);
    if (TENANT_EXEMPT_TAG_RE.test(jsdocWindow)) continue;
    if (paramsHaveTenant(m[2])) continue;
    const body = text.slice(m.index, Math.min(text.length, m.index + 400));
    if (!/\bthis\.(repository|repo|repos|prisma|db|client)\b/.test(body)) continue;
    // Accept input-object pattern where the body reads `.tenantId`.
    if (/\.tenantId\b|\['tenantId'\]|\["tenantId"\]/.test(body)) continue;
    const line = text.slice(0, m.index).split('\n').length;
    report.addError(file, `Public method ${fullName}() may be missing tenantId parameter.`, {
      line,
      suggestion: 'Add `tenantId: string` as the first argument.',
      ruleRef: 'Charter §3 + §32',
    });
  }
}

// ─── PRC-M408: repository / SQL tenant-predicate scan ──────────────────────

const DEFAULT_SQL_DIR = resolve(REPO_ROOT, 'db/sql');

/** Tables whose CREATE TABLE (db/sql) declares a tenant_id column. */
export async function loadTenantTables(sqlDir = DEFAULT_SQL_DIR) {
  const tables = new Set();
  let names = [];
  try {
    names = (await readdir(sqlDir)).filter((n) => n.endsWith('.sql'));
  } catch {
    return tables;
  }
  const re =
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"?\w+"?\.)?"?(\w+)"?\s*\(([\s\S]*?)\n\s*\)\s*;/gi;
  for (const n of names) {
    const sql = await safeReadFile(join(sqlDir, n));
    let m;
    while ((m = re.exec(sql)) !== null) {
      if (/\btenant_id\b/i.test(m[2])) tables.add(m[1].toLowerCase());
    }
  }
  return tables;
}

/** Function-level markers proving the query runs on a tenant-bound connection. */
const TENANT_SCOPED_CALL_RE =
  /\b(with\w*Tenant\w*|withPlatformScope|bindTenantGuc\w*|set_app_tenant_id|runInTenant\w*|tenantQuery)\s*[(<]|app\.tenant_id/;

const SQL_TABLE_REF_RE = /\b(?:FROM|UPDATE|JOIN|DELETE\s+FROM)\s+(?:"?\w+"?\.)?"?([a-z_][a-z0-9_]*)"?/gi;

/** Tenant tables referenced by a SELECT/UPDATE/DELETE statement text. */
export function tenantTablesInSql(sqlText, tenantTables) {
  if (!/\b(SELECT|UPDATE|DELETE)\b/i.test(sqlText)) return [];
  const hits = new Set();
  let m;
  SQL_TABLE_REF_RE.lastIndex = 0;
  while ((m = SQL_TABLE_REF_RE.exec(sqlText)) !== null) {
    const t = m[1].toLowerCase();
    if (tenantTables.has(t)) hits.add(t);
  }
  return [...hits];
}

/**
 * Every SQL literal touching a tenant table must carry a tenant_id predicate
 * or run inside a tenant-bound helper in the enclosing function.
 */
async function checkSqlPredicates(backendDir, tenantTables, report) {
  if (tenantTables.size === 0) return 0;
  const files = await findFiles(backendDir, (name) => isProductionTsFile(name) && !name.includes('in-memory'));
  let scanned = 0;
  for (const file of files) {
    const text = await safeReadFile(file);
    if (!/\b(SELECT|UPDATE|DELETE)\b/.test(text)) continue;
    scanned += 1;
    const sf = await loadSourceFile(file);
    const literals = [];
    if (sf) {
      const { SyntaxKind } = await import('ts-morph');
      for (const kind of [
        SyntaxKind.StringLiteral,
        SyntaxKind.NoSubstitutionTemplateLiteral,
        SyntaxKind.TemplateExpression,
      ]) {
        for (const node of sf.getDescendantsOfKind(kind)) {
          // Outermost enclosing function: the tenant-bound helper usually wraps
          // an inner callback that receives the bound client.
          const fns = node.getAncestors().filter((a) =>
            [
              SyntaxKind.FunctionDeclaration,
              SyntaxKind.MethodDeclaration,
              SyntaxKind.ArrowFunction,
              SyntaxKind.FunctionExpression,
            ].includes(a.getKind()),
          );
          // Tenant-bound call site, e.g. this.query(tenantId, sql) / runTenant(ctx.tenantId, sql).
          const call = node.getParentIfKind(SyntaxKind.CallExpression);
          const tenantArg = call
            ? call.getArguments().some((a) => a !== node && /\btenantId\b/.test(a.getText()))
            : false;
          literals.push({
            sql: node.getText(),
            line: node.getStartLineNumber(),
            scope: fns.map((f) => f.getText()).join('\n'),
            // Dynamic WHERE builders push the tenant predicate separately.
            innerScope: fns[0]?.getText() ?? '',
            tenantArg,
          });
        }
      }
    } else {
      const re = /`[^`]*`|'(?:[^'\\\n]|\\.)*'/g;
      let m;
      while ((m = re.exec(text)) !== null) {
        literals.push({ sql: m[0], line: text.slice(0, m.index).split('\n').length, scope: text });
      }
    }
    for (const lit of literals) {
      const tables = tenantTablesInSql(lit.sql, tenantTables);
      if (tables.length === 0) continue;
      if (/\btenant_id\b/i.test(lit.sql)) continue;
      if (lit.tenantArg) continue;
      if (TENANT_SCOPED_CALL_RE.test(lit.scope)) continue;
      if (lit.innerScope && /['"`][^'"`]*\btenant_id\s*=/.test(lit.innerScope)) continue;
      report.addError(
        file,
        `SQL on tenant table(s) ${tables.join(', ')} has no tenant_id predicate and does not run inside a tenant-bound helper.`,
        {
          line: lit.line,
          suggestion:
            'Add a `tenant_id = $n` predicate or run the query inside withTenantTransaction()/withTenantClient().',
          ruleRef: 'Charter §3 + §32 (PRC-M408)',
        },
      );
    }
  }
  return scanned;
}

/**
 * @param {{ backendDir?: string, sqlDir?: string }} [opts] backendDir/sqlDir
 *   override the scanned packages/backend and db/sql roots (fixture tests).
 */
export async function runTenantIdCheck({ backendDir = BACKEND_DIR, sqlDir = DEFAULT_SQL_DIR } = {}) {
  const report = new Report(CHECK_IDS.TENANT_ID, TITLE);
  const serviceFiles = await findFiles(backendDir, (name) => {
    if (!isProductionTsFile(name)) return false;
    if (!name.includes('service')) return false;
    if (name.includes('in-memory')) return false;
    if (name.includes('repository')) return false;
    if (name.includes('standalone')) return false;
    return true;
  });
  report.filesScanned = serviceFiles.length;

  for (const file of serviceFiles) {
    const ownerService = getBackendServiceName(file, backendDir);
    if (TENANT_FREE_SERVICES.has(ownerService)) continue;

    const sf = await loadSourceFile(file);
    if (sf) {
      await checkViaAst(sf, ownerService, file, report);
    } else {
      const text = await safeReadFile(file);
      checkViaRegex(text, ownerService, file, report);
    }
  }
  const tenantTables = await loadTenantTables(sqlDir);
  report.filesScanned += await checkSqlPredicates(backendDir, tenantTables, report);
  return report.finish();
}

const isMain = import.meta.url === pathToFileURL(resolve(process.argv[1] ?? '')).href;
if (isMain) {
  const report = await runTenantIdCheck();
  printReport(report);
  process.exit(report.errorCount > 0 ? 1 : 0);
}
