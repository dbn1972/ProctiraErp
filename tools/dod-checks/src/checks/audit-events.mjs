#!/usr/bin/env node
/**
 * Check 4 — Audit Event Emission on Writes.
 *
 * Charter §28 (Audit Trail) and §32 require every state-changing operation
 * (POST/PUT/PATCH/DELETE) to emit an audit event so platform admins can trace
 * "who changed what, when". This check looks at every Fastify route handler
 * for a write verb and verifies, per handler, that the handler or a service
 * method it calls (one level deep) invokes the audit recorder / domain-event
 * bus. Un-audited write routes are errors unless listed with a reason in
 * audit-events-allowlist.json (PRC-M410).
 *
 * The audit service itself is exempt because it IS the audit system, and
 * the developer-portal service exposes only read-mostly metadata.
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { CHECK_IDS } from '../lib/constants.mjs';
import { findFiles, isProductionTsFile, safeReadFile } from '../lib/fs-utils.mjs';
import { BACKEND_DIR, REPO_ROOT, getBackendServiceName, toRepoRelative } from '../lib/paths.mjs';
import { Report, printReport } from '../lib/reporter.mjs';

const TITLE = 'Audit Event Emission on Writes (POST/PUT/PATCH/DELETE → audit)';
const AUDIT_EXEMPT_SERVICES = new Set(['audit', 'developer-portal']);
/** Default allowlist of known un-audited write routes (PRC-M410). */
export const DEFAULT_ALLOWLIST_PATH = resolve(
  REPO_ROOT,
  'tools/dod-checks/audit-events-allowlist.json',
);
/**
 * Any `<receiver>.post|put|patch|delete('<path>'` registration (any receiver,
 * e.g. `fastify`, `scoped`, `app`, `r`), plus `.route({ method: 'POST' })`.
 * Requiring a path-like string first argument ('/x', '${prefix}/x' or '')
 * keeps `map.delete(key)` / `cache.delete('k')` out.
 */
const WRITE_CALL_RE =
  /\.\s*(post|put|patch|delete)\s*(?:<[^>()]*>)?\s*\(\s*(['"`])((?:\/|\$\{)[^'"`]*|)\2/gi;
const ROUTE_OBJ_RE = /\.\s*route\s*(?:<[^>()]*>)?\s*\(\s*\{/g;
/**
 * Audit *calls* only. A bare mention of the word "audit" (import, comment,
 * variable name) is not evidence that the handler records anything.
 */
const AUDIT_CALL_PATTERNS = [
  /\baudit\w*\s*(?:\?\.|\.)\s*\w+\s*\(/i,
  /\b(?:record|emit|publish|log|write|append|with)Audit\w*\s*\(/i,
  /\bauditEvent\s*\(/,
  /\brecord(?:Change|Event)\s*\(/i,
  /\b(?:emit|publish)(?:Domain)?Events?\s*\(/i,
  /\b(?:eventProducer|kafkaProducer|eventBus|domainEvents?|outbox)\s*(?:\?\.|\.)\s*\w+\s*\(/i,
];
export function hasAuditCall(text) {
  return AUDIT_CALL_PATTERNS.some((p) => p.test(text));
}
const NOT_CALLEES = new Set([
  'if',
  'for',
  'while',
  'switch',
  'catch',
  'function',
  'return',
  'typeof',
  'await',
  'async',
  'new',
  'send',
  'code',
  'status',
  'header',
  'type',
  'parse',
  'safeParse',
  'then',
  'map',
  'filter',
  'push',
  'String',
  'Number',
  'Boolean',
  'Object',
  'Array',
  'JSON',
  'stringify',
  'Date',
  'Promise',
  'Error',
]);
/** Return the index just past the bracket matching `text[openIdx]`. */
function matchBracket(text, openIdx) {
  const open = text[openIdx];
  const close = open === '(' ? ')' : open === '{' ? '}' : ']';
  let depth = 0;
  let quote = null;
  for (let i = openIdx; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '/' && text[i + 1] === '/') {
      const nl = text.indexOf('\n', i);
      i = nl === -1 ? text.length : nl;
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      const endC = text.indexOf('*/', i + 2);
      i = endC === -1 ? text.length : endC + 1;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return text.length;
}
/** Names of functions/methods invoked (or passed by reference) in a handler. */
function calleeNames(handlerText) {
  const names = new Set();
  for (const m of handlerText.matchAll(/([A-Za-z_$][\w$]*)\s*(?:<[^>()]*>)?\s*\(/g)) {
    if (!NOT_CALLEES.has(m[1])) names.add(m[1]);
  }
  // Handler passed by reference: `app.post('/x', opts, controller.create)`.
  for (const m of handlerText.matchAll(
    /,\s*(?:[A-Za-z_$][\w$]*\.)*([A-Za-z_$][\w$]*)\s*\)?\s*$/g,
  )) {
    names.add(m[1]);
  }
  return names;
}
/** Bodies of every method/function definition named `name` in `text`. */
function definitionBodies(text, name) {
  const bodies = [];
  const esc = name.replace(/[$]/g, '\\$');
  const defRe = new RegExp(
    `(?:\\bfunction\\s*\\*?\\s*${esc}\\s*(?:<[^>]*>)?\\s*\\(|(?:^|[\\s;{}])(?:(?:public|private|protected|static|async|override|readonly)\\s+)*${esc}\\s*(?:<[^>]*>)?\\s*\\(|\\b(?:const|let|var)\\s+${esc}\\s*(?::[^=\\n]{0,200})?=\\s*(?:async\\s*)?(?:function\\s*)?\\(?)`,
    'gm',
  );
  for (const m of text.matchAll(defRe)) {
    let i = m.index + m[0].length - 1;
    while (i < text.length && text[i] !== '(') i++;
    if (i >= text.length) continue;
    const afterParams = matchBracket(text, i);
    // Skip return-type annotation / arrow, find the body opening brace.
    const rest = text.slice(afterParams, afterParams + 400);
    const brace = rest.search(/[{;]/);
    if (brace === -1 || rest[brace] !== '{') continue;
    const bodyStart = afterParams + brace;
    bodies.push(text.slice(bodyStart, matchBracket(text, bodyStart)));
  }
  return bodies;
}
/**
 * One-level call graph: the handler itself audits, or one of the methods it
 * calls (defined in the route file or the owning service's sources) does.
 */
export function handlerIsAudited(handlerText, lookupText, cache = new Map()) {
  if (hasAuditCall(handlerText)) return true;
  for (const name of calleeNames(handlerText)) {
    if (!cache.has(name)) {
      cache.set(
        name,
        definitionBodies(lookupText, name).some((body) => hasAuditCall(body)),
      );
    }
    if (cache.get(name)) return true;
  }
  return false;
}
/** Extract every write-route registration with its full argument text. */
export function extractWriteRoutes(text) {
  const routes = [];
  for (const m of text.matchAll(WRITE_CALL_RE)) {
    const openIdx = text.indexOf('(', m.index);
    const endIdx = matchBracket(text, openIdx);
    routes.push({
      method: m[1].toUpperCase(),
      path: m[3],
      index: m.index,
      handlerText: text.slice(openIdx, endIdx),
    });
  }
  for (const m of text.matchAll(ROUTE_OBJ_RE)) {
    const openIdx = text.indexOf('(', m.index);
    const callText = text.slice(openIdx, matchBracket(text, openIdx));
    const method = /method\s*:\s*\[?\s*['"](POST|PUT|PATCH|DELETE)['"]/i.exec(callText);
    if (!method) continue;
    const url = /url\s*:\s*(['"`])([^'"`]*)\1/.exec(callText);
    routes.push({
      method: method[1].toUpperCase(),
      path: url ? url[2] : '?',
      index: m.index,
      handlerText: callText,
    });
  }
  return routes.sort((a, b) => a.index - b.index);
}
export async function loadAllowlist(path) {
  const raw = await safeReadFile(path);
  if (!raw) return new Map();
  const parsed = JSON.parse(raw);
  const map = new Map();
  for (const e of parsed.entries ?? []) {
    if (!e.file || !e.route || !e.reason) {
      throw new Error(
        `audit-events allowlist entry needs file, route and reason: ${JSON.stringify(e)}`,
      );
    }
    map.set(`${e.file}::${e.route}`, e);
  }
  return map;
}
/**
 * @param {{ backendDir?: string, allowlistPath?: string | null }} [opts]
 *   backendDir overrides the scanned packages/backend root and allowlistPath
 *   the allowlist file (fixture tests pass null for an empty allowlist).
 */
export async function runAuditEventsCheck({
  backendDir = BACKEND_DIR,
  allowlistPath = DEFAULT_ALLOWLIST_PATH,
} = {}) {
  const report = new Report(CHECK_IDS.AUDIT_EVENTS, TITLE);
  const allowlist = allowlistPath ? await loadAllowlist(allowlistPath) : new Map();
  const usedAllow = new Set();
  const routeFiles = await findFiles(backendDir, (name) => {
    if (!isProductionTsFile(name)) return false;
    return name.includes('route');
  });
  report.filesScanned = routeFiles.length;
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
    const routes = extractWriteRoutes(routeText);
    if (routes.length === 0) continue;
    const lookupText = routeText + '\n' + (await readServiceText(ownerService));
    const calleeCache = new Map();
    const rel = toRepoRelative(file);
    for (const route of routes) {
      if (handlerIsAudited(route.handlerText, lookupText, calleeCache)) continue;
      const routeKey = `${route.method} ${route.path}`;
      const allowKey = `${rel}::${routeKey}`;
      if (allowlist.has(allowKey)) {
        usedAllow.add(allowKey);
        continue;
      }
      const line = routeText.slice(0, route.index).split('\n').length;
      report.addError(
        file,
        `Write route ${routeKey} in service "${ownerService}" does not call the audit recorder in its handler or in any service method it calls.`,
        {
          line,
          suggestion:
            'Call the audit service (or emit a domain event) in the handler or the service method it invokes, or add a reasoned entry to tools/dod-checks/audit-events-allowlist.json.',
          ruleRef: 'Charter §28 + §32',
        },
      );
    }
  }
  for (const [key, entry] of allowlist) {
    if (!usedAllow.has(key)) {
      report.addWarning(
        entry.file,
        `Stale audit-events allowlist entry ${entry.route} (route now audited or removed); delete it.`,
        {
          ruleRef: 'Charter §28 + §32',
        },
      );
    }
  }
  return report.finish();
}
const isMain = import.meta.url === pathToFileURL(resolve(process.argv[1] ?? '')).href;
if (isMain) {
  const report = await runAuditEventsCheck();
  printReport(report);
  process.exit(report.errorCount > 0 ? 1 : 0);
}
