#!/usr/bin/env node
/**
 * Check 2 — Cross-Service SQL Join Prevention.
 *
 * Charter §5 ("Cross-Service Communication Model") forbids services from
 * issuing raw SQL JOINs that span service boundaries. Composition across
 * domains must go through APIs, events, or read models. This check looks for
 * raw-SQL constructs (`$queryRaw`, `$executeRaw`, `Prisma.sql\`…\``) whose
 * body references a table prefix belonging to a different service than the
 * one owning the file.
 *
 * Implementation:
 *   - Use ts-morph to find every TaggedTemplateExpression / CallExpression
 *     that touches the Prisma raw-SQL surface so we get accurate line numbers.
 *   - Fall back to a line-by-line regex scan if ts-morph is unavailable.
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { CHECK_IDS, KNOWN_SERVICES, servicePrefix } from '../lib/constants.mjs';
import { findFiles, isProductionTsFile, safeReadFile } from '../lib/fs-utils.mjs';
import { BACKEND_DIR, getBackendServiceName } from '../lib/paths.mjs';
import { Report, printReport } from '../lib/reporter.mjs';
import { loadSourceFile } from '../lib/ts-ast.mjs';

const TITLE = 'Cross-Service SQL Join Prevention (no JOINs across owners)';

const RAW_SQL_CALLEES = new Set([
  '$queryRaw',
  '$queryRawUnsafe',
  '$executeRaw',
  '$executeRawUnsafe',
]);

/**
 * Inspect raw SQL text and report any cross-service table references.
 * We only flag identifiers that appear immediately after FROM/JOIN keywords
 * so that foreign-key column references (e.g. `s.institution_id`) on
 * service-owned tables are not falsely flagged.
 */
function findCrossServiceTables(sqlText, ownerService) {
  /** @type {Array<{ otherService: string, table: string }>} */
  const hits = [];
  if (!/\bJOIN\b/i.test(sqlText)) return hits;
  // Pull every identifier that follows FROM or JOIN.
  const tableRefRe = /\b(?:FROM|JOIN)\s+([\w."]+)/gi;
  let m;
  while ((m = tableRefRe.exec(sqlText)) !== null) {
    // Strip optional schema prefix and quoting: schema."tbl" -> tbl
    const raw = m[1].replace(/"/g, '');
    const tableName = raw.includes('.') ? raw.split('.').pop() : raw;
    for (const svc of KNOWN_SERVICES) {
      if (svc === ownerService) continue;
      const prefix = servicePrefix(svc);
      if (tableName.startsWith(`${prefix}_`)) {
        hits.push({ otherService: svc, table: tableName });
      }
    }
  }
  return hits;
}

/** Walk a ts-morph SourceFile and collect raw-SQL nodes with their text. */
function collectRawSqlNodesViaAst(sourceFile, mod) {
  const { SyntaxKind } = mod;
  const results = [];
  // Tagged templates: prisma.$queryRaw`SELECT …`, sql`SELECT …`
  for (const tag of sourceFile.getDescendantsOfKind(SyntaxKind.TaggedTemplateExpression)) {
    const tagText = tag.getTag().getText();
    const isRaw =
      RAW_SQL_CALLEES.has(tagText.split('.').pop()) ||
      /\bsql$/.test(tagText) ||
      /Prisma\.sql$/.test(tagText);
    if (!isRaw) continue;
    const tpl = tag.getTemplate();
    // Concatenate all template segments so we can scan the static text.
    let text = '';
    if (tpl.getKindName() === 'NoSubstitutionTemplateLiteral') {
      text = tpl.getLiteralText();
    } else {
      for (const span of [tpl.getHead(), ...tpl.getTemplateSpans().map((s) => s.getLiteral())]) {
        text += span.getLiteralText();
      }
    }
    results.push({ text, line: tag.getStartLineNumber(), source: tagText });
  }
  // Call expressions: prisma.$queryRawUnsafe('SELECT …', …)
  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const exprText = call.getExpression().getText();
    const last = exprText.split('.').pop();
    if (!RAW_SQL_CALLEES.has(last ?? '')) continue;
    const arg0 = call.getArguments()[0];
    if (!arg0) continue;
    const argKind = arg0.getKindName();
    if (argKind === 'StringLiteral' || argKind === 'NoSubstitutionTemplateLiteral') {
      results.push({
        text: arg0.getLiteralText?.() ?? arg0.getText().slice(1, -1),
        line: call.getStartLineNumber(),
        source: exprText,
      });
    }
  }
  return results;
}

/** Fallback regex collector when ts-morph is unavailable. */
function collectRawSqlNodesViaRegex(text) {
  /** @type {Array<{ text: string, line: number, source: string }>} */
  const results = [];
  // Crude but bounded: find $queryRaw`…` / sql`…` segments.
  const re = /(?:\.(\$queryRaw|\$queryRawUnsafe|\$executeRaw|\$executeRawUnsafe)|(?:\b|Prisma\.)sql)\s*[`(]/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const start = m.index + m[0].length;
    const opener = m[0].endsWith('`') ? '`' : ')';
    const closer = opener === '`' ? '`' : ')';
    let depth = 1;
    let end = start;
    while (end < text.length && depth > 0) {
      const ch = text[end];
      if (opener === '(' && ch === '(') depth++;
      else if (ch === closer) depth--;
      end++;
    }
    const body = text.slice(start, end - 1);
    const line = text.slice(0, m.index).split('\n').length;
    results.push({ text: body, line, source: m[1] ?? 'sql' });
  }
  return results;
}

export async function runCrossServiceJoinsCheck() {
  const report = new Report(CHECK_IDS.CROSS_SERVICE_JOINS, TITLE);
  const tsFiles = await findFiles(BACKEND_DIR, (name) => isProductionTsFile(name));
  report.filesScanned = tsFiles.length;

  for (const file of tsFiles) {
    const ownerService = getBackendServiceName(file);
    if (!ownerService) continue;
    const text = await safeReadFile(file);
    if (!/\bJOIN\b/i.test(text) && !/\$queryRaw|\$executeRaw/.test(text)) continue;

    let nodes;
    const sf = await loadSourceFile(file);
    if (sf) {
      const mod = await import('ts-morph');
      nodes = collectRawSqlNodesViaAst(sf, mod);
    } else {
      nodes = collectRawSqlNodesViaRegex(text);
    }

    for (const node of nodes) {
      const hits = findCrossServiceTables(node.text, ownerService);
      for (const hit of hits) {
        report.addError(
          file,
          `Raw SQL in "${ownerService}" service references "${hit.table}" owned by "${hit.otherService}".`,
          {
            line: node.line,
            suggestion:
              'Replace cross-service JOIN with an API call, domain event, or pre-built read model.',
            ruleRef: 'Charter §5 + §32',
          },
        );
      }
    }

    // Soft-warn on direct cross-service package imports (data leakage risk).
    const importRe = /from\s+['"]@proctira\/backend-([^'"]+)['"]/g;
    let im;
    while ((im = importRe.exec(text)) !== null) {
      const otherSvc = im[1];
      if (otherSvc === ownerService) continue;
      const line = text.slice(0, im.index).split('\n').length;
      report.addWarning(
        file,
        `Imports from @proctira/backend-${otherSvc}; verify only public APIs/types are used.`,
        {
          line,
          suggestion: 'Cross-service composition should go through HTTP/event APIs, not direct package imports.',
          ruleRef: 'Charter §5',
        },
      );
    }
  }

  return report.finish();
}

const isMain = import.meta.url === pathToFileURL(resolve(process.argv[1] ?? '')).href;
if (isMain) {
  const report = await runCrossServiceJoinsCheck();
  printReport(report);
  process.exit(report.errorCount > 0 ? 1 : 0);
}
