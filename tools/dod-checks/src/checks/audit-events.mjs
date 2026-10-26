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
// contents removed. A bare import, type name, comment or string is not
// integration.
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

/**
 * Blank out comments and the contents of string/template literals so only
 * code is matched. Template `${…}` expressions are dropped with the literal;
 * an audit call placed inside one is not counted.
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

function hasAuditIntegration(text) {
  const code = stripCommentsAndStrings(text);
  return AUDIT_CALL_PATTERNS.some((p) => p.test(code));
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
