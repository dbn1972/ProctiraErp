#!/usr/bin/env node
/**
 * Check 6 — Error Envelope Compliance.
 *
 * Charter §6 (API Standards) defines a uniform error envelope:
 *   { code, message, statusCode, errors? }
 * Every 4xx/5xx response sent from a route handler must include `code`,
 * `message`, and `statusCode`. Throwing raw `new Error(...)` from outside a
 * `catch` block is also flagged (it bypasses the envelope when no global
 * handler is in place).
 *
 * Implementation: ts-morph drives the parsing so we can detect calls that
 * span multiple lines or use spread syntax (`...errorEnvelope`). A regex
 * fallback covers environments where ts-morph isn't installed.
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { CHECK_IDS } from '../lib/constants.mjs';
import { findFiles, isProductionTsFile, safeReadFile } from '../lib/fs-utils.mjs';
import { BACKEND_DIR } from '../lib/paths.mjs';
import { Report, printReport } from '../lib/reporter.mjs';
import { loadSourceFile } from '../lib/ts-ast.mjs';

const TITLE = 'Error Envelope Compliance ({code, message, statusCode})';

const REQUIRED_FIELDS = ['code', 'message', 'statusCode'];

/** AST: find `reply.status(4xx|5xx).send({...})` calls and validate the literal. */
async function checkViaAst(sourceFile, file, report) {
  const mod = await import('ts-morph');
  const { SyntaxKind } = mod;
  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = call.getExpression();
    if (expr.getKind() !== SyntaxKind.PropertyAccessExpression) continue;
    if (expr.getName?.() !== 'send') continue;
    const innerObj = expr.getExpression();
    if (innerObj.getKind() !== SyntaxKind.CallExpression) continue;
    const inner = innerObj;
    const innerExpr = inner.getExpression();
    if (innerExpr.getName?.() !== 'status' && innerExpr.getName?.() !== 'code') continue;
    const statusArg = inner.getArguments()[0];
    if (!statusArg) continue;
    const statusText = statusArg.getText();
    const statusMatch = statusText.match(/(\d{3})/);
    if (!statusMatch) continue;
    const statusCode = Number(statusMatch[1]);
    if (statusCode < 400) continue; // success envelopes don't need this shape

    const arg = call.getArguments()[0];
    if (!arg || arg.getKind() !== SyntaxKind.ObjectLiteralExpression) continue;
    // Only inspect literal objects; spread/imported envelopes are presumed compliant.
    const props = arg.getProperties();
    const propNames = new Set();
    let hasSpread = false;
    for (const p of props) {
      if (p.getKind() === SyntaxKind.SpreadAssignment) {
        hasSpread = true;
        continue;
      }
      const name = p.getName?.();
      if (name) propNames.add(name);
    }
    if (hasSpread) continue;
    const missing = REQUIRED_FIELDS.filter((f) => !propNames.has(f));
    if (missing.length > 0) {
      report.addError(
        file,
        `${statusCode} response missing required envelope field(s): ${missing.join(', ')}.`,
        {
          line: call.getStartLineNumber(),
          suggestion:
            'Send `{ code, message, statusCode, errors? }` or use the shared `AppError` helper from @proctira/common.',
          ruleRef: 'Charter §6 + §32',
        },
      );
    }
  }

  // Soft-warn on raw `throw new Error(...)` outside catch blocks.
  for (const thrown of sourceFile.getDescendantsOfKind(SyntaxKind.ThrowStatement)) {
    const expr = thrown.getExpression();
    if (expr.getKind() !== SyntaxKind.NewExpression) continue;
    if (expr.getExpression().getText() !== 'Error') continue;
    let parent = thrown.getParent();
    let inCatch = false;
    while (parent) {
      if (parent.getKindName() === 'CatchClause') {
        inCatch = true;
        break;
      }
      parent = parent.getParent();
    }
    if (inCatch) continue;
    report.addWarning(
      file,
      'Raw `throw new Error(...)` outside a catch block bypasses the error envelope.',
      {
        line: thrown.getStartLineNumber(),
        suggestion: 'Throw an `AppError` (or domain-specific subclass) so the global error handler renders the envelope.',
        ruleRef: 'Charter §6',
      },
    );
  }
}

/** Regex fallback. */
function checkViaRegex(text, file, report) {
  const sendRe = /reply\s*\.\s*(?:status|code)\s*\(\s*(\d{3})\s*\)\s*\.\s*send\s*\(\s*\{([\s\S]*?)\}\s*\)/g;
  let m;
  while ((m = sendRe.exec(text)) !== null) {
    const status = Number(m[1]);
    if (status < 400) continue;
    const body = m[2];
    if (/\.\.\./.test(body)) continue;
    const missing = REQUIRED_FIELDS.filter((f) => !new RegExp(`\\b${f}\\b`).test(body));
    if (missing.length === 0) continue;
    const line = text.slice(0, m.index).split('\n').length;
    report.addError(file, `${status} response missing required envelope field(s): ${missing.join(', ')}.`, {
      line,
      suggestion: 'Add `{ code, message, statusCode }` to the response payload.',
      ruleRef: 'Charter §6 + §32',
    });
  }

  const throwRe = /throw\s+new\s+Error\s*\(/g;
  let t;
  while ((t = throwRe.exec(text)) !== null) {
    const before = text.slice(Math.max(0, t.index - 200), t.index);
    if (/\bcatch\b/.test(before)) continue;
    const line = text.slice(0, t.index).split('\n').length;
    report.addWarning(file, 'Raw `throw new Error(...)` bypasses the error envelope.', {
      line,
      suggestion: 'Throw `AppError` from @proctira/common.',
      ruleRef: 'Charter §6',
    });
  }
}

export async function runErrorEnvelopeCheck() {
  const report = new Report(CHECK_IDS.ERROR_ENVELOPE, TITLE);
  const routeFiles = await findFiles(BACKEND_DIR, (n) => isProductionTsFile(n) && n.includes('route'));
  report.filesScanned = routeFiles.length;

  for (const file of routeFiles) {
    const sf = await loadSourceFile(file);
    if (sf) {
      await checkViaAst(sf, file, report);
    } else {
      checkViaRegex(await safeReadFile(file), file, report);
    }
  }

  return report.finish();
}

const isMain = import.meta.url === pathToFileURL(resolve(process.argv[1] ?? '')).href;
if (isMain) {
  const report = await runErrorEnvelopeCheck();
  printReport(report);
  process.exit(report.errorCount > 0 ? 1 : 0);
}
