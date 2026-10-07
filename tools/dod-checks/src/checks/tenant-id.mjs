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
 *   - PR #579 precision fixes (each removes a false positive, none is a name
 *     exemption):
 *       · `typeof this.repository.x` capability probes are not persistence;
 *       · a tenant-bearing parameter forwarded by name counts as used;
 *       · `const { tenantId } = <param>` is the input-object pattern;
 *       · methods whose only persistence is a listed platform-scoped
 *         operation (src/lib/platform-scope.mjs, per class + operation, with a
 *         reason) or a per-tenant call passing tenantId are not flagged.
 *   - Fall back to a regex scan if ts-morph is unavailable.
 */
import { readdir } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import { CHECK_IDS } from '../lib/constants.mjs';
import { findFiles, isProductionTsFile, safeReadFile } from '../lib/fs-utils.mjs';
import { BACKEND_DIR, REPO_ROOT, getBackendServiceName } from '../lib/paths.mjs';
import { PLATFORM_SCOPED_OPERATIONS } from '../lib/platform-scope.mjs';
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

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A `typeof this.repository.withTransaction === 'function'` capability probe
 * reads a property; it performs no I/O, so it is not persistence evidence.
 */
function stripCapabilityProbes(body) {
  return body.replace(/\btypeof\s+this\.\w+(?:\.\w+)*/g, 'typeof __probe__');
}

/** Persistence evidence in a method body (after capability probes are removed). */
function bodyTouchesPersistence(body) {
  const text = stripCapabilityProbes(body);
  return (
    /\bthis\.(repository|repo|repos|prisma|db|client)\b/.test(text) ||
    /\b(create|update|delete|find|upsert|aggregate|count|groupBy)\s*\(/.test(text)
  );
}

/**
 * A tenant-bearing parameter that is forwarded by name (e.g. `reviewer`
 * typed `{ tenantId?: string }` and passed to a helper) is used even though
 * the body never spells `tenantId`.
 */
function tenantParamForwarded(method, body) {
  return method
    .getParameters()
    .filter((p) => paramsHaveTenant(p.getText()))
    .some((p) => {
      const name = p.getNameNode().getKindName() === 'Identifier' ? p.getName() : null;
      return name ? new RegExp(`\\b${escapeRe(name)}\\b`).test(body) : false;
    });
}

/**
 * Input-object pattern written as destructuring:
 * `const { tenantId, … } = payload` where `payload` is a method parameter.
 */
function destructuresTenantFromParam(method, body) {
  const names = method
    .getParameters()
    .filter((p) => p.getNameNode().getKindName() === 'Identifier')
    .map((p) => p.getName());
  const re = /\b(?:const|let|var)\s*\{([^}]*)\}\s*=\s*(\w+)\s*[;\n]/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    if (/(^|[\s,])tenantId\s*(,|$|=)/.test(m[1].trim() + ',') && names.includes(m[2])) return true;
  }
  return false;
}

/**
 * Platform-scope rule (see src/lib/platform-scope.mjs): blank out calls to the
 * entry's platform-scoped operations and receiver calls that pass an explicit
 * tenantId, then re-test the remaining body for persistence evidence.
 */
function onlyPlatformScopedPersistence(method, entry, SyntaxKind) {
  const bodyNode = method.getBody();
  if (!bodyNode) return false;
  const start = bodyNode.getStart();
  const text = bodyNode.getText();
  const receiver = `this.${entry.receiver}`;
  const ranges = [];
  for (const call of bodyNode.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = call.getExpression();
    if (expr.getKind() !== SyntaxKind.PropertyAccessExpression) continue;
    if (expr.getExpression().getText() !== receiver) continue;
    const op = expr.getName();
    const tenantCarrying = call.getArguments().some((a) => /\btenantId\b/.test(a.getText()));
    if (!entry.operations.includes(op) && !tenantCarrying) continue;
    ranges.push([call.getStart() - start, call.getEnd() - start]);
  }
  if (ranges.length === 0) return false;
  let residual = '';
  let cursor = 0;
  for (const [s, e] of ranges.sort((a, b) => a[0] - b[0])) {
    if (s < cursor) {
      cursor = Math.max(cursor, e);
      continue;
    }
    residual += text.slice(cursor, s) + '__platform_op__';
    cursor = e;
  }
  residual += text.slice(cursor);
  return !bodyTouchesPersistence(residual);
}

/**
 * Report platform-scope entries that no longer match the code (class gone or
 * a listed operation never called), so the exemption cannot go stale.
 */
function checkPlatformScopeEntries(entries, seen, backendDir, report) {
  for (const entry of entries) {
    const abs = resolve(backendDir, entry.file);
    const calls = seen.get(`${entry.file}#${entry.className}`);
    const missing = calls ? entry.operations.filter((op) => !calls.has(op)) : null;
    if (calls && missing.length === 0) continue;
    report.addError(
      abs,
      calls
        ? `Platform-scope entry ${entry.className} lists operation(s) never called via this.${entry.receiver}: ${missing.join(', ')}.`
        : `Platform-scope entry ${entry.className} does not match a scanned service class.`,
      {
        suggestion: 'Update or remove the entry in tools/dod-checks/src/lib/platform-scope.mjs.',
        ruleRef: 'Charter §3 + §32 (PRC-M408)',
      },
    );
  }
}

/**
 * AST path: walk service files and inspect class methods.
 *
 * @param {{ backendRel: string, platformScopes: ReadonlyArray<object>, seen: Map<string, Set<string>> }} scope
 */
async function checkViaAst(sourceFile, ownerService, file, report, scope) {
  const mod = await import('ts-morph');
  const { SyntaxKind } = mod;
  for (const cls of sourceFile.getClasses()) {
    const name = cls.getName() ?? '';
    if (!name.endsWith('Service') && !name.endsWith('Manager')) continue;
    if (cls.getDecorators().some((d) => d.getName() === 'PlatformService')) continue;

    const platformEntry = scope.platformScopes.find(
      (e) => e.file === scope.backendRel && e.className === name,
    );
    if (platformEntry) {
      const calls = new Set();
      for (const call of cls.getDescendantsOfKind(SyntaxKind.CallExpression)) {
        const expr = call.getExpression();
        if (expr.getKind() !== SyntaxKind.PropertyAccessExpression) continue;
        if (expr.getExpression().getText() === `this.${platformEntry.receiver}`) {
          calls.add(expr.getName());
        }
      }
      scope.seen.set(`${platformEntry.file}#${name}`, calls);
    }

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
      if (!bodyTouchesPersistence(body)) continue;
      if (paramsHaveTenant(paramsText)) {
        // PRC-M408: a declared-but-unused tenantId gives false assurance.
        if (!bodyUsesTenant(body) && !tenantParamForwarded(method, body)) {
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
      if (destructuresTenantFromParam(method, body)) continue;
      if (platformEntry && onlyPlatformScopedPersistence(method, platformEntry, SyntaxKind)) {
        continue;
      }

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

const SQL_TABLE_REF_RE =
  /\b(?:FROM|UPDATE|JOIN|DELETE\s+FROM)\s+(?:"?\w+"?\.)?"?([a-z_][a-z0-9_]*)"?/gi;

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

/** Callee names that bind the tenant (or explicit platform scope) on the client they pass in. */
const TENANT_BOUND_CALLEE_RE =
  /^(with\w*Tenant\w*|withPlatformScope|bindTenantGuc\w*|runInTenant\w*|tenantQuery)$/;

/** An argument expression that carries the tenant being bound. */
const TENANT_VALUE_RE = /\btenantId\b|\btenant_id\b/;

const MAX_CALLER_DEPTH = 3;

/**
 * Per-file AST context for the SQL tenant-predicate scan.
 *
 * PR #579 precision rules (each one proves the statement runs on a
 * tenant-bound client; none is a path or name exemption):
 *   1. Local tenant-bound wrapper: the SQL (or the callback holding it) is an
 *      argument of `this.m(…)` / `m(…)` where `m` is declared in the same file
 *      and itself calls a tenant-bound helper, and the call passes a tenant
 *      value (`tenantId` / `tenant_id`) in another argument.
 *      e.g. `this.query(String(row.tenant_id), sql)`, `this.run(tenantId, (c) => c.query(sql))`.
 *   2. Same-file callers: the SQL sits in a non-exported module function whose
 *      every call site is (transitively, up to 3 levels) inside a tenant-bound
 *      helper call. Exported functions are never accepted this way because
 *      callers outside the file cannot be seen.
 *   3. Module-level SQL fragments (`const SELECT = \`…\``) are judged at their
 *      use sites: every template that interpolates the fragment must pass.
 */
class SqlScopeContext {
  constructor(sf, SyntaxKind) {
    this.sf = sf;
    this.K = SyntaxKind;
    this.wrapperCache = new Map();
    this.callerCache = new Map();
  }

  isFn(node) {
    const K = this.K;
    return [
      K.FunctionDeclaration,
      K.MethodDeclaration,
      K.ArrowFunction,
      K.FunctionExpression,
    ].includes(node.getKind());
  }

  /** Original PRC-M408 rules plus rules 1–3. */
  literalPasses(node, sqlText, allowFragment) {
    if (/\btenant_id\b/i.test(sqlText)) return true;
    const K = this.K;
    const fns = node.getAncestors().filter((a) => this.isFn(a));
    // Tenant-bound call site, e.g. this.query(tenantId, sql) / runTenant(ctx.tenantId, sql).
    const call = node.getParentIfKind(K.CallExpression);
    if (call && call.getArguments().some((a) => a !== node && /\btenantId\b/.test(a.getText()))) {
      return true;
    }
    // Outermost enclosing function: the tenant-bound helper usually wraps an
    // inner callback that receives the bound client.
    if (TENANT_SCOPED_CALL_RE.test(fns.map((f) => f.getText()).join('\n'))) return true;
    // Dynamic WHERE builders push the tenant predicate separately.
    const inner = fns[0]?.getText() ?? '';
    if (inner && /['"`][^'"`]*\btenant_id\s*=/.test(inner)) return true;
    if (this.boundByCall(node)) return true;
    const outer = fns.length ? fns[fns.length - 1] : null;
    if (outer && outer.getKind() === K.FunctionDeclaration && this.boundByCallers(outer, 0)) {
      return true;
    }
    if (allowFragment && fns.length === 0) return this.fragmentUsesPass(node);
    return false;
  }

  /** Rule 1 + direct helper: node is inside an argument of a tenant-binding call. */
  boundByCall(node) {
    const K = this.K;
    let child = node;
    for (const anc of node.getAncestors()) {
      if (anc.getKind() === K.CallExpression && child !== anc.getExpression()) {
        const callee = anc.getExpression();
        const name = callee.getText().split('.').pop() ?? '';
        if (TENANT_BOUND_CALLEE_RE.test(name)) return true;
        if (this.isLocalWrapper(callee)) {
          const others = anc.getArguments().filter((a) => a !== child);
          if (others.some((a) => TENANT_VALUE_RE.test(a.getText()))) return true;
        }
      }
      child = anc;
    }
    return false;
  }

  /** `this.m` → method m of the enclosing class; `m` → module function/const m. */
  isLocalWrapper(callee) {
    const K = this.K;
    let decl = null;
    if (callee.getKind() === K.PropertyAccessExpression) {
      if (callee.getExpression().getKind() !== K.ThisKeyword) return false;
      const cls = callee.getFirstAncestorByKind(K.ClassDeclaration);
      decl = cls?.getMethod(callee.getName()) ?? null;
    } else if (callee.getKind() === K.Identifier) {
      const name = callee.getText();
      decl = this.sf.getFunction(name) ?? this.sf.getVariableDeclaration(name) ?? null;
    }
    if (!decl) return false;
    if (!this.wrapperCache.has(decl)) {
      this.wrapperCache.set(decl, TENANT_SCOPED_CALL_RE.test(decl.getText()));
    }
    return this.wrapperCache.get(decl);
  }

  /** Rule 2: every same-file call site of a non-exported function is tenant-bound. */
  boundByCallers(fnDecl, depth) {
    if (depth > MAX_CALLER_DEPTH) return false;
    if (fnDecl.isExported?.() || fnDecl.isDefaultExport?.()) return false;
    const name = fnDecl.getName?.();
    if (!name) return false;
    if (this.callerCache.has(fnDecl)) return this.callerCache.get(fnDecl);
    this.callerCache.set(fnDecl, false); // recursion guard
    const K = this.K;
    const refs = this.sf
      .getDescendantsOfKind(K.Identifier)
      .filter((id) => id.getText() === name && id !== fnDecl.getNameNode());
    // Any non-call reference (e.g. passed as a value) means callers are unknown.
    const ok =
      refs.length > 0 &&
      refs.every((id) => {
        const call = id.getParentIfKind(K.CallExpression);
        if (!call || call.getExpression() !== id) return false;
        if (this.boundByCall(call)) return true;
        const fns = call.getAncestors().filter((a) => this.isFn(a));
        const outer = fns.length ? fns[fns.length - 1] : null;
        return (
          !!outer &&
          outer !== fnDecl &&
          outer.getKind() === K.FunctionDeclaration &&
          this.boundByCallers(outer, depth + 1)
        );
      });
    this.callerCache.set(fnDecl, ok);
    return ok;
  }

  /** Rule 3: module-level `const NAME = <sql>` is judged at every use site. */
  fragmentUsesPass(node) {
    const K = this.K;
    const decl = node.getParentIfKind(K.VariableDeclaration);
    if (!decl || decl.getInitializer() !== node) return false;
    const stmt = decl.getFirstAncestorByKind(K.VariableStatement);
    if (!stmt || stmt.isExported()) return false;
    const name = decl.getName();
    const uses = this.sf
      .getDescendantsOfKind(K.Identifier)
      .filter((id) => id.getText() === name && id !== decl.getNameNode());
    return (
      uses.length > 0 &&
      uses.every((id) => {
        const site = id.getFirstAncestorByKind(K.TemplateExpression) ?? id;
        return this.literalPasses(site, site.getText(), false);
      })
    );
  }
}

/**
 * Every SQL literal touching a tenant table must carry a tenant_id predicate
 * or run inside a tenant-bound helper in the enclosing function.
 */
async function checkSqlPredicates(backendDir, tenantTables, report) {
  if (tenantTables.size === 0) return 0;
  const files = await findFiles(
    backendDir,
    (name) => isProductionTsFile(name) && !name.includes('in-memory'),
  );
  let scanned = 0;
  for (const file of files) {
    const text = await safeReadFile(file);
    if (!/\b(SELECT|UPDATE|DELETE)\b/.test(text)) continue;
    scanned += 1;
    const sf = await loadSourceFile(file);
    const literals = [];
    if (sf) {
      const { SyntaxKind } = await import('ts-morph');
      const ctx = new SqlScopeContext(sf, SyntaxKind);
      for (const kind of [
        SyntaxKind.StringLiteral,
        SyntaxKind.NoSubstitutionTemplateLiteral,
        SyntaxKind.TemplateExpression,
      ]) {
        for (const node of sf.getDescendantsOfKind(kind)) {
          literals.push({
            sql: node.getText(),
            line: node.getStartLineNumber(),
            passes: () => ctx.literalPasses(node, node.getText(), true),
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
      if (
        lit.passes
          ? lit.passes()
          : /\btenant_id\b/i.test(lit.sql) || TENANT_SCOPED_CALL_RE.test(lit.scope)
      ) {
        continue;
      }
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
export async function runTenantIdCheck({
  backendDir = BACKEND_DIR,
  sqlDir = DEFAULT_SQL_DIR,
  // Fixture trees do not contain the real services, so the repo registry only
  // applies to the real packages/backend unless a test passes its own entries.
  platformScopes = backendDir === BACKEND_DIR ? PLATFORM_SCOPED_OPERATIONS : [],
} = {}) {
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
  /** @type {Map<string, Set<string>>} platform-scope entry → receiver ops called in the class */
  const seen = new Map();

  for (const file of serviceFiles) {
    const ownerService = getBackendServiceName(file, backendDir);
    if (TENANT_FREE_SERVICES.has(ownerService)) continue;

    const sf = await loadSourceFile(file);
    if (sf) {
      const backendRel = relative(backendDir, file).split(sep).join('/');
      await checkViaAst(sf, ownerService, file, report, { backendRel, platformScopes, seen });
    } else {
      const text = await safeReadFile(file);
      checkViaRegex(text, ownerService, file, report);
    }
  }
  checkPlatformScopeEntries(platformScopes, seen, backendDir, report);
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
