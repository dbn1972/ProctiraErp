#!/usr/bin/env node
/**
 * Check 4 — Audit Event Emission on Writes.
 *
 * Charter §28 (Audit Trail) and §32 require every state-changing operation
 * (POST/PUT/PATCH/DELETE) to emit an audit event so platform admins can trace
 * "who changed what, when". This check looks at every Fastify route handler
 * for a write verb and verifies that either the route file or the underlying
 * service file contains audit-trail integration (calls into the audit
 * service, kafka producer, or domain-event bus).
 *
 * The audit service itself is exempt because it IS the audit system, and
 * the developer-portal service exposes only read-mostly metadata.
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { CHECK_IDS } from '../lib/constants.mjs';
import { findFiles, isProductionTsFile, safeReadFile } from '../lib/fs-utils.mjs';
import { BACKEND_DIR, getBackendServiceName } from '../lib/paths.mjs';
import { Report, printReport } from '../lib/reporter.mjs';

const TITLE = 'Audit Event Emission on Writes (POST/PUT/PATCH/DELETE → audit)';

const AUDIT_EXEMPT_SERVICES = new Set(['audit', 'developer-portal']);

const WRITE_ROUTE_RE =
  /(?:fastify|app|router|server|instance)\.(?:post|put|patch|delete)\s*\(|\.route\s*\(\s*\{[^}]*method\s*:\s*['"](?:POST|PUT|PATCH|DELETE)/i;

// PRC-M410: evidence must be a call, matched on code with comments and string
// and regex-literal contents removed. A bare import, type name, comment,
// string, method/function declaration or type signature is not integration
// (see isCallSite). Known residuals: an overload signature ending in `;` still
// counts as a call, and a call in the `?` branch of a ternary followed by `:`
// is read as a declaration (worst case: an extra warning). Matching is per
// service file set, not per handler.
const AUDIT_CALL_PATTERNS = [
  // Callee name contains "audit": recordAudit(…), auditMutation(…), audit(…).
  /(?<!function\s+)\b[\w$]*audit[\w$]*\s*\(/i,
  // Method call on an audit-named object: this.auditService.record(…).
  /\b[\w$]*audit[\w$]*\s*(?:\?\.|\.)\s*[\w$]+\s*\(/i,
  /\brecord(?:Change|Event)\s*\(/i,
  /\bemit(?:Audit|Domain)?Event\s*\(/i,
  /\bpublish(?:Audit|Domain)?Event\s*\(/i,
  /\b(?:eventProducer|kafkaProducer|outbox|domainEvents?)\s*(?:\?\.|\.)\s*[\w$]+\s*\(/i,
];

// Tokens after which a `/` starts a regex literal rather than a division.
const REGEX_PREFIX_CHARS = new Set('(,=:[!&|?{};+-*%<>~^'.split(''));
const REGEX_PREFIX_WORDS = new Set([
  'return',
  'typeof',
  'case',
  'do',
  'else',
  'in',
  'of',
  'new',
  'delete',
  'void',
  'throw',
  'yield',
  'await',
]);

/** True when a `/` at this point of the emitted code begins a regex literal. */
function startsRegexLiteral(out) {
  let k = out.length - 1;
  while (k >= 0 && /\s/.test(out[k])) k--;
  if (k < 0) return true;
  const prev = out[k];
  if (REGEX_PREFIX_CHARS.has(prev)) return true;
  if (!/[\w$]/.test(prev)) return false;
  let start = k;
  while (start > 0 && /[\w$]/.test(out[start - 1])) start--;
  return REGEX_PREFIX_WORDS.has(out.slice(start, k + 1));
}

/**
 * Blank out comments and the contents of string/template/regex literals so
 * only code is matched. Template `${…}` expressions are dropped with the
 * literal; an audit call placed inside one is not counted. A regex literal is
 * scanned to its unescaped closing `/` (outside a `[...]` class) or to the end
 * of the line, so a quote or backtick inside it cannot hide later code.
 */
function stripCommentsAndStrings(text) {
  let out = '';
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    const next = text[i + 1];
    if (c === '/' && next === '/') {
      while (i < n && text[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? n : end + 2;
      out += ' ';
      continue;
    }
    if (c === '/' && startsRegexLiteral(out)) {
      let j = i + 1;
      let inClass = false;
      let closed = false;
      while (j < n && text[j] !== '\n') {
        const ch = text[j];
        if (ch === '\\') {
          j += 2;
          continue;
        }
        if (inClass) {
          if (ch === ']') inClass = false;
        } else if (ch === '[') {
          inClass = true;
        } else if (ch === '/') {
          closed = true;
          break;
        }
        j++;
      }
      if (closed) {
        j++;
        while (j < n && /[a-z]/i.test(text[j])) j++;
      }
      out += '""';
      i = Math.min(j, n);
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < n && text[j] !== c) {
        if (text[j] === '\\') j++;
        else if (c !== '`' && text[j] === '\n') break;
        j++;
      }
      out += c + c;
      i = j + 1;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/**
 * True when the `(` ending a pattern match opens a call rather than a
 * declaration. After the balanced `)`, a `{` (function/method body) or `:`
 * (type signature) on the same line marks a declaration. An unbalanced `(`
 * is counted as a call.
 */
function isCallSite(code, openIdx) {
  let depth = 0;
  let k = openIdx;
  for (; k < code.length; k++) {
    if (code[k] === '(') depth++;
    else if (code[k] === ')') {
      depth--;
      if (depth === 0) break;
    }
  }
  if (k >= code.length) return true;
  k++;
  while (k < code.length && (code[k] === ' ' || code[k] === '\t')) k++;
  return code[k] !== '{' && code[k] !== ':';
}

function hasAuditIntegration(text) {
  const code = stripCommentsAndStrings(text);
  return AUDIT_CALL_PATTERNS.some((p) => {
    const re = new RegExp(p.source, p.flags.includes('g') ? p.flags : p.flags + 'g');
    for (const m of code.matchAll(re)) {
      if (isCallSite(code, m.index + m[0].length - 1)) return true;
    }
    return false;
  });
}

/**
 * @param {{ backendDir?: string }} [opts] backendDir overrides the scanned
 *   packages/backend root (used by fixture tests).
 */
export async function runAuditEventsCheck({ backendDir = BACKEND_DIR } = {}) {
  const report = new Report(CHECK_IDS.AUDIT_EVENTS, TITLE);
  const routeFiles = await findFiles(backendDir, (name) => {
    if (!isProductionTsFile(name)) return false;
    return name.includes('route');
  });
  report.filesScanned = routeFiles.length;

  // Cache the union of service-side text per service so we only read each
  // service tree once.
  /** @type {Map<string, string>} */
  const serviceTextCache = new Map();
  async function readServiceText(serviceName) {
    if (serviceTextCache.has(serviceName)) return serviceTextCache.get(serviceName);
    const dir = resolve(backendDir, serviceName, 'src');
    const files = await findFiles(dir, (n) => n.endsWith('.ts') && !n.endsWith('.test.ts'));
    let combined = '';
    for (const f of files) combined += '\n' + (await safeReadFile(f));
    serviceTextCache.set(serviceName, combined);
    return combined;
  }

  for (const file of routeFiles) {
    const ownerService = getBackendServiceName(file, backendDir);
    if (AUDIT_EXEMPT_SERVICES.has(ownerService)) continue;

    const routeText = await safeReadFile(file);
    if (!WRITE_ROUTE_RE.test(routeText)) continue;

    if (hasAuditIntegration(routeText)) continue;

    const serviceText = await readServiceText(ownerService);
    if (hasAuditIntegration(serviceText)) continue;

    // Find the first write route line so the warning points at it.
    const firstHit = WRITE_ROUTE_RE.exec(routeText);
    const line = firstHit ? routeText.slice(0, firstHit.index).split('\n').length : null;

    report.addWarning(
      file,
      `Service "${ownerService}" defines write routes but no audit-trail emission was detected in routes or services.`,
      {
        line,
        suggestion:
          'Inject the audit service or emit a domain event in the corresponding service handler so writes are traceable.',
        ruleRef: 'Charter §28 + §32',
      },
    );
  }

  return report.finish();
}

const isMain = import.meta.url === pathToFileURL(resolve(process.argv[1] ?? '')).href;
if (isMain) {
  const report = await runAuditEventsCheck();
  printReport(report);
  process.exit(report.errorCount > 0 ? 1 : 0);
}
