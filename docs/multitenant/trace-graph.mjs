#!/usr/bin/env node
/**
 * trace-graph.mjs — UI → API → DB mapping for ProctiraERP, no model involved.
 *
 * Layers:
 *   UI page (apps/<app>/src/app/**\/page.tsx) → files it imports (components, actions) → api client functions (apps/web/src/lib/api/*.ts)
 *   api client function → HTTP method + path (gatewayFetch('/fees/plans', {method}))
 *   backend route (packages/backend/<pkg>/src/**  fastify.get(`${prefix}/plans`) or fastify.get('/plans')) mounted under a prefix (apps/api-gateway/src/domain-plugins.ts)
 *   backend package → SQL tables it reads/writes (raw SQL FROM/INTO/UPDATE/JOIN, prisma.<model>) → db/sql CREATE TABLE + prisma models
 *
 * Usage: node tools/trace-graph.mjs [/path/to/proctira] [outDir]
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.argv[2] || '/home/claude/proctira');
const OUT = path.resolve(process.argv[3] || path.join(process.cwd(), 'graph'));
fs.mkdirSync(OUT, { recursive: true });
const read = (p) => fs.readFileSync(p, 'utf8');
const walk = (d, pred) => { const out = []; if (!fs.existsSync(d)) return out; for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (['node_modules', 'dist', '.next', '__tests', 'test'].includes(e.name)) continue; out.push(...walk(p, pred)); } else if (pred(p)) out.push(p); } return out; };
const rel = (p) => path.relative(ROOT, p);
const isTest = (p) => /\.(test|spec|property\.test|integration\.test|live\.test)\.[tj]sx?$/.test(p) || /\/__tests__\//.test(p);

/* ---------------- 1. API client functions → method + path ---------------- */
const apiDir = path.join(ROOT, 'apps/web/src/lib/api');
const apiFns = {}; // name → {file, method, path, raw}
for (const f of walk(apiDir, (p) => p.endsWith('.ts') && !isTest(p))) {
  const src = read(f);
  const fnRe = /export\s+(?:async\s+)?function\s+(\w+)\s*\(/g; let m;
  const starts = [];
  while ((m = fnRe.exec(src))) starts.push({ name: m[1], idx: m.index });
  starts.forEach((s, i) => {
    const body = src.slice(s.idx, starts[i + 1] ? starts[i + 1].idx : src.length);
    const calls = [...body.matchAll(/(?:gatewayFetch|fetchGateway|gatewayRequest|apiFetch|fetch)\s*(?:<[^>]*>)?\s*\(\s*([`'"])([^`'"]*)\1\s*(?:,\s*\{([\s\S]*?)\})?/g)];
    const entries = calls.map((c) => {
      let p = c[2].replace(/\$\{(?:[^{}]|\{[^{}]*\})*\}?/g, ':param').replace(/\?.*$/, '').replace(/[)}]+$/, '').replace(/([^/]):param$/, '$1');
      const method = (c[3] && (c[3].match(/method:\s*['"](\w+)['"]/) || [])[1]) || 'GET';
      return { method: method.toUpperCase(), path: p };
    }).filter((e) => e.path.startsWith('/'));
    apiFns[s.name] = { file: rel(f), module: path.basename(f, '.ts'), calls: entries };
  });
}

/* ---------------- 2. UI pages → api functions (transitive imports within the app) ---------------- */
const apps = ['web', 'admin-console', 'registration-portal', 'public-website', 'developer-portal', 'install-wizard'];
const resolveImport = (fromFile, spec, appRoot) => {
  let base;
  if (spec.startsWith('@/')) base = path.join(appRoot, 'src', spec.slice(2));
  else if (spec.startsWith('.')) base = path.resolve(path.dirname(fromFile), spec);
  else return null;
  for (const ext of ['', '.ts', '.tsx', '/index.ts', '/index.tsx']) { const p = base + ext; if (fs.existsSync(p) && fs.statSync(p).isFile()) return p; }
  return null;
};
const importCache = new Map();
const depsOf = (file, appRoot) => {
  if (importCache.has(file)) return importCache.get(file);
  const src = read(file); const out = [];
  for (const m of src.matchAll(/import\s+(?:[\s\S]*?)\s+from\s+['"]([^'"]+)['"]|import\(['"]([^'"]+)['"]\)/g)) { const r = resolveImport(file, m[1] || m[2], appRoot); if (r) out.push(r); }
  importCache.set(file, out); return out;
};
const apiNames = new Set(Object.keys(apiFns));
const pages = [];
for (const app of apps) {
  const appRoot = path.join(ROOT, 'apps', app);
  for (const pg of walk(path.join(appRoot, 'src/app'), (p) => p.endsWith('page.tsx') && !/__tests/.test(p))) {
    const seen = new Set(); const stack = [pg]; const usedApi = new Set(); const files = [];
    while (stack.length) {
      const f = stack.pop(); if (seen.has(f) || seen.size > 400) continue; seen.add(f); files.push(f);
      const src = read(f);
      // api function names referenced anywhere in file (imports from lib/api or direct)
      for (const n of apiNames) if (new RegExp(`\\b${n}\\s*\\(`).test(src) || new RegExp(`\\b${n}\\b`).test(src) && /lib\/api/.test(src)) usedApi.add(n);
      for (const d of depsOf(f, appRoot)) if (!/lib\/api\//.test(d) || true) stack.push(d);
    }
    // direct gateway/fetch calls inside the page tree (not via lib/api)
    const direct = [];
    for (const f of files) for (const m of read(f).matchAll(/(?:gatewayFetch|apiFetch)\s*(?:<[^>]*>)?\s*\(\s*([`'"])(\/[^`'"]*)\1/g)) direct.push(m[2].replace(/\$\{[^}]+\}/g, ':param').replace(/\?.*$/, ''));
    const route = '/' + rel(pg).replace(/^apps\/[^/]+\/src\/app\//, '').replace(/\/?page\.tsx$/, '').replace(/\([^)]+\)\/?/g, '');
    pages.push({ app, route: route === '/' ? '/' : route.replace(/\/$/, ''), file: rel(pg), filesScanned: files.length, apiFns: [...usedApi].sort(), directCalls: [...new Set(direct)] });
  }
}

/* ---------------- 3. Backend routes ---------------- */
// mounted prefixes from domain-plugins.ts
const dp = read(path.join(ROOT, 'apps/api-gateway/src/domain-plugins.ts'));
const registrars = [];
for (const m of dp.matchAll(/name:\s*'([\w-]+)'([\s\S]*?)(?=\n\s{2}\{\s*\n\s*name:|\n\];)/g)) {
  const block = m[2];
  const prefixMap = {}; for (const x of block.matchAll(/(\w*[pP]refix):\s*'([^']+)'/g)) prefixMap[x[1]] = x[2];
  const prefixes = Object.values(prefixMap);
  const proxy = (block.match(/proxyPrefixes:\s*\[([^\]]*)\]/) || [, ''])[1].match(/'([^']+)'/g)?.map((x) => x.replace(/'/g, '')) || [];
  registrars.push({ name: m[1], prefixes: [...new Set(prefixes)], prefixMap, proxyPrefixes: proxy, plugins: [...new Set([...block.matchAll(/register\((\w+Plugin)\b/g)].map((x) => x[1]))], pkgs: [] });
}
// gateway app.ts explicit registrations
const appTs = read(path.join(ROOT, 'apps/api-gateway/src/app.ts'));
// Bounded to the call's own options object: [^;]*? (not [\s\S]*?) so the lazy
// match cannot cross this statement's closing `});` and grab a LATER call's
// prefix (e.g. attributing auditPlugin's '/api/v1/audit-logs' to tenantPlugin,
// which has no prefix of its own — this produced false "unresolved" gaps for
// routes that are actually mounted and working; see PROCTIRA_FIX_LEDGER A1-001/A1-002).
const explicitMounts = [...appTs.matchAll(/register\((\w+)Plugin,\s*\{[^;]*?prefix:\s*'([^']+)'/g)].map((m) => ({ plugin: m[1], prefix: m[2] }));
// package import map: which package exports which plugin (by import lines in domain-plugins + app.ts)
const importMap = {};
for (const m of (dp + appTs).matchAll(/import\s*\{([^}]+)\}\s*from\s*'@proctira\/backend-([\w-]+)'/g)) for (const n of m[1].split(',').map((s) => s.trim().split(' as ')[0]).filter(Boolean)) importMap[n] = m[2];
for (const r of registrars) r.pkgs = [...new Set(r.plugins.map((pl) => importMap[pl]).filter(Boolean))];
const localPluginFile = {}; for (const m of dp.matchAll(/import\s*\{\s*(\w+Plugin)\s*\}\s*from\s*'\.\/([\w-]+)\.js'/g)) localPluginFile[m[1]] = 'apps/api-gateway/src/' + m[2] + '.ts';
const localFilePrefix = {}; for (const r of registrars) for (const pl of r.plugins) if (localPluginFile[pl]) localFilePrefix[localPluginFile[pl]] = r.prefixes.length ? r.prefixes : r.proxyPrefixes;
const pkgPrefixMap = {}; // pkg → {option: value}
for (const r of registrars) for (const p of (r.plugins.map((pl) => importMap[pl]).filter(Boolean))) { pkgPrefixMap[p] = Object.assign(pkgPrefixMap[p] || {}, r.prefixMap); if (!Object.keys(r.prefixMap).length) r.proxyPrefixes.forEach((x, i) => { pkgPrefixMap[p]['proxy' + i] = x; }); }
const pkgPrefix = {}; // pkg → [prefixes]
for (const r of registrars) for (const p of r.pkgs) { pkgPrefix[p] = pkgPrefix[p] || new Set(); (r.prefixes.length ? r.prefixes : r.proxyPrefixes).forEach((x) => pkgPrefix[p].add(x)); }
for (const e of explicitMounts) {
  const p = importMap[e.plugin + 'Plugin'];
  if (!p) continue;
  const stripped = e.prefix.replace(/^\/api\/v1/, '');
  pkgPrefix[p] = pkgPrefix[p] || new Set();
  pkgPrefix[p].add(stripped);
  // Also feed pkgPrefixMap (keyed 'prefix') — this is what the ${prefix}
  // substitution below actually reads; without this, a package whose gateway
  // mount is a direct app.ts `register(xPlugin, { prefix: '...' })` call (not
  // a domain-plugins.ts registrar) falls back to its own in-package default
  // prefix and every `${prefix}/...` route resolves to the wrong path.
  pkgPrefixMap[p] = Object.assign(pkgPrefixMap[p] || {}, { prefix: stripped });
}
const routes = [];
const routeRe = /(?:fastify|app|server|instance|scope)\s*\.\s*(get|post|put|patch|delete)\s*(?:<[^>]*>)?\s*\(\s*(?:([`'"])([^`'"]*)\2|(\w*[pP]refix)\b)/g;
for (const pkgDir of fs.readdirSync(path.join(ROOT, 'packages/backend'))) {
  const src = path.join(ROOT, 'packages/backend', pkgDir, 'src');
  for (const f of walk(src, (p) => p.endsWith('.ts') && !isTest(p))) {
    const s = read(f);
    for (const m of s.matchAll(routeRe)) {
      const prefixes = pkgPrefix[pkgDir] ? [...pkgPrefix[pkgDir]] : [];
      const raw = m[3] !== undefined ? m[3] : '${' + m[4] + '}';
      const pv = (raw.match(/\$\{([\w.]*[pP]refix)\}/) || [])[1];
      let cands = prefixes;
      if (pv) { const opt = pkgPrefixMap[pkgDir] || {}; const key = pv.split('.').pop(); const set = new Set(); if (opt[key]) set.add(opt[key]); const def = (s.match(new RegExp(key + '\\s*=\\s*[\'"](\\/[^\'"]*)[\'"]')) || [])[1]; if (def) set.add(def); if (key === 'prefix') Object.values(opt).forEach((v) => set.add(v)); if (!set.size) prefixes.forEach((v) => set.add(v)); cands = [...set]; }
      else if (!raw.startsWith('/')) cands = prefixes;
      const tail = raw.replace(/\$\{[^}]*[pP]refix[^}]*\}/g, '').replace(/\$\{[^}]+\}/g, ':param');
      const full = cands.length ? cands.map((p) => (p + tail).replace(/\/{2,}/g, '/')) : [tail];
      routes.push({ pkg: pkgDir, file: rel(f), method: m[1].toUpperCase(), raw, full, mounted: prefixes.length > 0 });
    }
  }
}
// gateway-local routes (insights, platform-admin, board summary, health UI …)
for (const f of walk(path.join(ROOT, 'apps/api-gateway/src'), (p) => p.endsWith('.ts') && !isTest(p))) {
  const s = read(f);
  for (const m of s.matchAll(routeRe)) { const raw = m[3] !== undefined ? m[3] : '${' + m[4] + '}'; const pfx = localFilePrefix[rel(f)] || ['']; const tail = raw.replace(/\$\{[^}]*[pP]refix[^}]*\}/g, '').replace(/\$\{[^}]+\}/g, ':param').replace(/^\/api\/v1/, ''); routes.push({ pkg: 'api-gateway', file: rel(f), method: m[1].toUpperCase(), raw, full: [...new Set(pfx.map((p) => (tail.startsWith(p + '/') || tail === p ? tail : p + tail).replace(/\/{2,}/g, '/')))], mounted: true }); }
}

/* ---------------- 4. Package → tables; DB tables ---------------- */
const tables = {}; // name → {sqlFile}
for (const f of walk(path.join(ROOT, 'db/sql'), (p) => p.endsWith('.sql'))) for (const m of read(f).matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"?(\w+)"?\.)?"?(\w+)"?/gi)) tables[m[2].toLowerCase()] = { sql: rel(f) };
const prismaModels = {}; // modelName → table
const prismaFile = path.join(ROOT, 'packages/shared/database/prisma/schema.prisma');
if (fs.existsSync(prismaFile)) for (const m of read(prismaFile).matchAll(/model\s+(\w+)\s*\{([\s\S]*?)\n\}/g)) { const map = (m[2].match(/@@map\("(\w+)"\)/) || [])[1]; prismaModels[m[1]] = (map || m[1].replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase()); }
const pkgTables = {};
for (const pkgDir of fs.readdirSync(path.join(ROOT, 'packages/backend'))) {
  const src = path.join(ROOT, 'packages/backend', pkgDir, 'src'); const set = new Map(); let hasSql = false, hasPrisma = false, hasInMemory = false;
  for (const f of walk(src, (p) => p.endsWith('.ts') && !isTest(p))) {
    const s = read(f);
    if (/in-memory|InMemory/.test(f + s.slice(0, 400))) hasInMemory = true;
    for (const m of s.matchAll(/\b(?:FROM|INTO|UPDATE|JOIN|DELETE\s+FROM)\s+"?([a-z_][a-z0-9_]*)"?/g)) { const t = m[1].toLowerCase(); if (tables[t]) { set.set(t, (set.get(t) || 0) + 1); hasSql = true; } }
    for (const m of s.matchAll(/\b(?:prisma|tx|client|db)\.([a-z]\w+)\.(?:findMany|findFirst|findUnique|create|createMany|update|updateMany|upsert|delete|deleteMany|count|aggregate)/g)) { const model = m[1][0].toUpperCase() + m[1].slice(1); const t = prismaModels[model]; if (t) { set.set(t, (set.get(t) || 0) + 1); hasPrisma = true; } }
  }
  pkgTables[pkgDir] = { tables: [...set.keys()].sort(), refs: set.size, hasSql, hasPrisma, hasInMemory };
}
for (const f of walk(path.join(ROOT, 'apps/api-gateway/src'), (p) => p.endsWith('.ts') && !isTest(p))) { const s = read(f); pkgTables['api-gateway'] = pkgTables['api-gateway'] || { tables: [], refs: 0, hasSql: false, hasPrisma: false, hasInMemory: false }; for (const m of s.matchAll(/\b(?:FROM|INTO|UPDATE|JOIN)\s+"?([a-z_][a-z0-9_]*)"?/g)) { const t = m[1].toLowerCase(); if (tables[t] && !pkgTables['api-gateway'].tables.includes(t)) { pkgTables['api-gateway'].tables.push(t); pkgTables['api-gateway'].hasSql = true; } } }

/* ---------------- 5. Match UI calls to routes ---------------- */
const norm = (p) => p.replace(/\/+$/, '').split('/').filter(Boolean).map((s) => (s.startsWith(':') ? ':p' : s));
const routeIndex = routes.flatMap((r) => r.full.map((f) => ({ ...r, path: f, segs: norm(f) })));
const matchRoute = (method, p) => { const segs = norm(p); return routeIndex.filter((r) => r.method === method && r.segs.length === segs.length && r.segs.every((s, i) => s === ':p' || segs[i] === ':p' || s === segs[i])); };
const uiCalls = []; // per api fn
for (const [name, fn] of Object.entries(apiFns)) for (const c of fn.calls) { const hits = matchRoute(c.method, c.path); uiCalls.push({ fn: name, module: fn.module, method: c.method, path: c.path, matched: hits.map((h) => `${h.pkg}:${h.path}`), pkgs: [...new Set(hits.map((h) => h.pkg))] }); }
const usedFns = new Set(pages.flatMap((p) => p.apiFns));
const calledPaths = new Set(uiCalls.filter((c) => usedFns.has(c.fn)).flatMap((c) => c.matched));
const allCalledPaths = new Set(uiCalls.flatMap((c) => c.matched));

/* ---------------- 6. Gaps ---------------- */
const gaps = { ui_api_unresolved: [], api_unused_by_ui: [], pages_without_api: [], api_fn_unused: [], pkg_without_persistence: [], orphan_tables: [], routes_unmounted: [] };
for (const c of uiCalls) if (!c.matched.length) gaps.ui_api_unresolved.push(c);
{ const seen = new Set(); for (const r of routes) { const k = r.pkg + '|' + r.file + '|' + r.method + '|' + r.raw; if (seen.has(k)) continue; seen.add(k); if (!r.full.some((f) => allCalledPaths.has(`${r.pkg}:${f}`))) gaps.api_unused_by_ui.push({ pkg: r.pkg, method: r.method, path: r.full[0], candidates: r.full.length, file: r.file, mounted: r.mounted }); } }
for (const p of pages) if (!p.apiFns.length && !p.directCalls.length) gaps.pages_without_api.push({ app: p.app, route: p.route, file: p.file });
for (const n of Object.keys(apiFns)) if (!usedFns.has(n)) gaps.api_fn_unused.push({ fn: n, file: apiFns[n].file });
for (const [pkg, t] of Object.entries(pkgTables)) { const hasRoutes = routes.some((r) => r.pkg === pkg); if (hasRoutes && !t.hasSql && !t.hasPrisma) gaps.pkg_without_persistence.push({ pkg, inMemory: t.hasInMemory }); }
const referenced = new Set(Object.values(pkgTables).flatMap((t) => t.tables));
for (const [t, meta] of Object.entries(tables)) if (!referenced.has(t)) gaps.orphan_tables.push({ table: t, sql: meta.sql });
for (const r of routes) if (!r.mounted && r.pkg !== 'api-gateway') gaps.routes_unmounted.push({ pkg: r.pkg, method: r.method, raw: r.raw, file: r.file });

/* ---------------- 7. Page → API → DB rows ---------------- */
const pageRows = pages.map((p) => {
  const calls = p.apiFns.flatMap((n) => uiCalls.filter((c) => c.fn === n));
  const pkgs = [...new Set(calls.flatMap((c) => c.pkgs))];
  const tbl = [...new Set(pkgs.flatMap((k) => (pkgTables[k] || { tables: [] }).tables))];
  return { app: p.app, route: p.route, page: p.file, apiFns: p.apiFns, endpoints: [...new Set(calls.map((c) => `${c.method} ${c.path}`))], unresolved: calls.filter((c) => !c.matched.length).map((c) => `${c.method} ${c.path}`), backendPkgs: pkgs, tables: tbl, persistence: pkgs.map((k) => `${k}:${pkgTables[k]?.hasPrisma ? 'prisma' : pkgTables[k]?.hasSql ? 'sql' : 'in-memory'}`) };
});

fs.writeFileSync(path.join(OUT, 'graph.json'), JSON.stringify({ apiFns, pages: pageRows, routes: routeIndex.map(({ segs, ...r }) => r), pkgTables, tables, registrars, gaps }, null, 1));
// CSV
const csv = (rows, cols) => [cols.join(','), ...rows.map((r) => cols.map((c) => JSON.stringify(Array.isArray(r[c]) ? r[c].join(' | ') : (r[c] ?? ''))).join(','))].join('\n');
fs.writeFileSync(path.join(OUT, 'page-api-db.csv'), csv(pageRows, ['app', 'route', 'page', 'apiFns', 'endpoints', 'unresolved', 'backendPkgs', 'persistence', 'tables']));
fs.writeFileSync(path.join(OUT, 'routes.csv'), csv(routeIndex.map((r) => ({ ...r, calledByUI: allCalledPaths.has(`${r.pkg}:${r.path}`) ? 'yes' : 'no' })), ['pkg', 'method', 'path', 'file', 'calledByUI']));
fs.writeFileSync(path.join(OUT, 'gaps.json'), JSON.stringify(gaps, null, 1));

const s = {
  pages: pages.length, apiFunctions: Object.keys(apiFns).length, apiCalls: uiCalls.length, resolvedCalls: uiCalls.filter((c) => c.matched.length).length,
  routeHandlers: new Set(routes.map((r) => r.pkg + '|' + r.file + '|' + r.method + '|' + r.raw)).size, routeCandidates: routeIndex.length, routesCalledByUI: allCalledPaths.size, tables: Object.keys(tables).length, prismaModels: Object.keys(prismaModels).length,
  gaps: Object.fromEntries(Object.entries(gaps).map(([k, v]) => [k, v.length])),
};
fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(s, null, 1));
console.log(JSON.stringify(s, null, 1));
