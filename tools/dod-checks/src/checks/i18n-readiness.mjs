#!/usr/bin/env node
/**
 * Check 7 — i18n Readiness (No Hardcoded User-Facing Strings).
 *
 * Charter §17 (Localization) and §32 require all user-facing copy to be
 * localizable. This check looks at backend route handlers for hardcoded
 * English strings in the `message` field of error/success envelopes — these
 * are the strings most likely to surface to end users.
 *
 * We accept several patterns as already-i18n-ready:
 *   - dotted keys      : "error.validation_failed"
 *   - upper-case codes : "VALIDATION_ERROR"
 *   - template strings : "Found ${count} items"
 *   - short status     : "ok", "created", "updated"
 *   - calls to `t(...)`, `i18n.t(...)`, `req.t(...)`
 *
 * Anything else longer than 20 characters is reported as a warning so teams
 * can route it through the i18n layer.
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { CHECK_IDS } from '../lib/constants.mjs';
import { findFiles, isProductionTsFile, safeReadFile } from '../lib/fs-utils.mjs';
import { BACKEND_DIR } from '../lib/paths.mjs';
import { Report, printReport } from '../lib/reporter.mjs';

const TITLE = 'i18n Readiness (no hardcoded user-facing strings in routes)';

const ACCEPTABLE_PATTERNS = [
  /^[a-z][a-z0-9_]+(\.[a-z0-9_]+)+$/, // dotted i18n key
  /^[A-Z][A-Z0-9_]+$/, // upper-case constant
  /^(ok|success|created|deleted|updated|accepted|noContent)$/i,
];

const I18N_CALL_RE = /\b(?:t|i18n\.t|req\.t|reply\.t|this\.i18n\.translate)\s*\(/;

const HARDCODED_RE = /\bmessage\s*:\s*(['"])([^'"]+)\1/g;

export async function runI18nCheck() {
  const report = new Report(CHECK_IDS.I18N, TITLE);
  const routeFiles = await findFiles(BACKEND_DIR, (n) => isProductionTsFile(n) && n.includes('route'));
  report.filesScanned = routeFiles.length;

  for (const file of routeFiles) {
    const text = await safeReadFile(file);
    let m;
    while ((m = HARDCODED_RE.exec(text)) !== null) {
      const value = m[2];
      // Skip very short (likely codes/status).
      if (value.length <= 20) continue;
      if (ACCEPTABLE_PATTERNS.some((p) => p.test(value))) continue;

      // Skip if the line containing the match also calls into the i18n helper.
      const lineStart = text.lastIndexOf('\n', m.index) + 1;
      const lineEnd = text.indexOf('\n', m.index);
      const lineText = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd);
      if (I18N_CALL_RE.test(lineText)) continue;

      const lineNum = text.slice(0, m.index).split('\n').length;
      const preview = value.length > 60 ? `${value.slice(0, 57)}…` : value;
      report.addWarning(file, `Hardcoded user-facing string in message field: "${preview}"`, {
        line: lineNum,
        suggestion: 'Replace with an i18n key (e.g. "error.invalid_input") and resolve via t() / i18n.translate().',
        ruleRef: 'Charter §17 + §32',
      });
    }
  }

  return report.finish();
}

const isMain = import.meta.url === pathToFileURL(resolve(process.argv[1] ?? '')).href;
if (isMain) {
  const report = await runI18nCheck();
  printReport(report);
  process.exit(report.errorCount > 0 ? 1 : 0);
}
