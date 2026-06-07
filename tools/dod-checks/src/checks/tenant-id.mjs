#!/usr/bin/env node
/**
 * Check 3 — `tenantId` Threaded Through Every Public Service Method.
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
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { CHECK_IDS } from '../lib/constants.mjs';
import { findFiles, isProductionTsFile, safeReadFile } from '../lib/fs-utils.mjs';
import { BACKEND_DIR, getBackendServiceName } from '../lib/paths.mjs';
import { Report, printReport } from '../lib/reporter.mjs';
import { loadSourceFile } from '../lib/ts-ast.mjs';

const TITLE = 'tenant_id Threading (every persistence call carries tenant)';

const TENANT_FREE_SERVICES = new Set(['tenant', 'install']);

const HELPER_NAME_RE = /^(get[A-Z]\w*(Name|Id|Number|Config|Type|Label|Slug|Url)|find[A-Z]\w*(By|Index)|update[A-Z]\w*(Status|Progress)|build|format|parse|to[A-Z]|is[A-Z]|has[A-Z])/;

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
      if (HELPER_NAME_RE.test(methodName)) continue;
      const modifiers = method.getModifiers().map((m) => m.getText());
      if (modifiers.includes('private') || modifiers.includes('protected')) continue;
      if (method.getName().startsWith('#')) continue;

      const paramsText = method.getParameters().map((p) => p.getText()).join(', ');
      if (paramsHaveTenant(paramsText)) continue;
      if (method.getParameters().length === 0) continue; // no-arg accessors

      // Confirm the method actually performs persistence work.
      const body = method.getBodyText() ?? '';
      const usesRepo =
        /\bthis\.(repository|repo|repos|prisma|db|client)\b/.test(body) ||
        /\b(create|update|delete|find|upsert|aggregate|count|groupBy)\s*\(/.test(body);
      if (!usesRepo) continue;

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
    if (HELPER_NAME_RE.test(fullName)) continue;
    const before = text.slice(Math.max(0, m.index - 30), m.index);
    if (/\b(private|protected|#)/.test(before)) continue;
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

export async function runTenantIdCheck() {
  const report = new Report(CHECK_IDS.TENANT_ID, TITLE);
  const serviceFiles = await findFiles(BACKEND_DIR, (name) => {
    if (!isProductionTsFile(name)) return false;
    if (!name.includes('service')) return false;
    if (name.includes('in-memory')) return false;
    if (name.includes('repository')) return false;
    if (name.includes('standalone')) return false;
    return true;
  });
  report.filesScanned = serviceFiles.length;

  for (const file of serviceFiles) {
    const ownerService = getBackendServiceName(file);
    if (TENANT_FREE_SERVICES.has(ownerService)) continue;

    const sf = await loadSourceFile(file);
    if (sf) {
      await checkViaAst(sf, ownerService, file, report);
    } else {
      const text = await safeReadFile(file);
      checkViaRegex(text, ownerService, file, report);
    }
  }

  return report.finish();
}

const isMain = import.meta.url === pathToFileURL(resolve(process.argv[1] ?? '')).href;
if (isMain) {
  const report = await runTenantIdCheck();
  printReport(report);
  process.exit(report.errorCount > 0 ? 1 : 0);
}
