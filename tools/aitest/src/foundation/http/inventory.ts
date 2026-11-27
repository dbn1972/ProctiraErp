/**
 * Gateway API route inventory: OpenAPI (`/docs/json`, NODE_ENV != production)
 * cross-checked with a static scan of route registrations, so routes missing
 * from Swagger are still counted (program plan section 8 risk).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

import { repoRootFromHere } from '../repo.js';
import type { FixtureManifest } from '../seed/fixtures.js';
import { resolveParam } from '../seed/param-map.js';
import type { TenantKey } from '../seed/tenants.js';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export const HTTP_METHODS: readonly HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

export interface ApiRoute {
  method: HttpMethod;
  /** Fastify style: /api/v1/students/:id */
  path: string;
  params: string[];
  mutating: boolean;
  /** rbac-registry resourceForApiPath (when the gateway source could be loaded). */
  resource?: string;
  source: 'openapi' | 'static';
}

export function normalisePath(p: string): string {
  return p.replace(/\{([^}]+)\}/g, ':$1').replace(/\/+$/, '') || '/';
}

export function paramsOf(path: string): string[] {
  return [...path.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => m[1] ?? '');
}

export function routesFromOpenApi(doc: {
  paths?: Record<string, Record<string, unknown>>;
}): ApiRoute[] {
  const out: ApiRoute[] = [];
  for (const [rawPath, ops] of Object.entries(doc.paths ?? {})) {
    const path = normalisePath(rawPath);
    for (const m of Object.keys(ops)) {
      const method = m.toUpperCase() as HttpMethod;
      if (!HTTP_METHODS.includes(method)) continue;
      out.push({
        method,
        path,
        params: paramsOf(path),
        mutating: method !== 'GET',
        source: 'openapi',
      });
    }
  }
  return dedupe(out);
}

function dedupe(routes: ApiRoute[]): ApiRoute[] {
  const seen = new Map<string, ApiRoute>();
  for (const r of routes) {
    const key = `${r.method} ${r.path.replace(/:[A-Za-z0-9_]+/g, ':')}`;
    if (!seen.has(key)) seen.set(key, r);
  }
  return [...seen.values()].sort(
    (a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method),
  );
}

export interface StaticRoute {
  method: HttpMethod;
  path: string;
  file: string;
}

const STATIC_RE =
  /\.(get|post|put|patch|delete)\s*(?:<[^>]*>)?\s*\(\s*['"`](\/api\/v1\/[^'"`$]*)['"`]/g;

function walkTs(dir: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const e of entries) {
    if (e === 'node_modules' || e === 'dist' || e === '__tests__') continue;
    const full = join(dir, e);
    const st = statSync(full);
    if (st.isDirectory()) walkTs(full, out);
    else if (e.endsWith('.ts') && !e.endsWith('.test.ts') && !e.endsWith('.d.ts')) out.push(full);
  }
}

/**
 * Literal `/api/v1/...` registrations in gateway and backend package sources.
 * Routes registered under a prefix variable (most plugins) are not visible
 * here; this only catches literal paths Swagger may have missed.
 */
export function scanStaticRoutes(repoRoot = repoRootFromHere()): StaticRoute[] {
  const files: string[] = [];
  walkTs(join(repoRoot, 'apps/api-gateway/src'), files);
  const backend = join(repoRoot, 'packages/backend');
  for (const pkg of readdirSync(backend)) walkTs(join(backend, pkg, 'src'), files);
  const out: StaticRoute[] = [];
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    for (const m of text.matchAll(STATIC_RE)) {
      out.push({
        method: (m[1] ?? 'get').toUpperCase() as HttpMethod,
        path: normalisePath(m[2] ?? ''),
        file: relative(repoRoot, f),
      });
    }
  }
  return out;
}

/** Static registrations missing from the OpenAPI list, as extra ApiRoutes. */
export function mergeStatic(openapi: ApiRoute[], statics: StaticRoute[]): ApiRoute[] {
  const shape = (p: string) => p.replace(/:[A-Za-z0-9_]+/g, ':');
  const known = new Set(openapi.map((r) => `${r.method} ${shape(r.path)}`));
  const extra: ApiRoute[] = [];
  for (const s of statics) {
    if (known.has(`${s.method} ${shape(s.path)}`)) continue;
    extra.push({
      method: s.method,
      path: s.path,
      params: paramsOf(s.path),
      mutating: s.method !== 'GET',
      source: 'static',
    });
  }
  return dedupe([...openapi, ...extra]);
}

/**
 * Loads `resourceForApiPath` from the gateway source (works under tsx/vitest).
 * Returns undefined when the module cannot be loaded; callers report that.
 */
export async function loadGatewayResourceMapper(
  repoRoot = repoRootFromHere(),
): Promise<((path: string) => string) | undefined> {
  try {
    const mod = (await import(
      pathToFileURL(join(repoRoot, 'apps/api-gateway/src/rbac-registry.ts')).href
    )) as {
      resourceForApiPath?: (path: string) => string;
    };
    return mod.resourceForApiPath;
  } catch {
    return undefined;
  }
}

export async function fetchApiInventory(
  gatewayUrl: string,
  o: { repoRoot?: string; withStatic?: boolean; withResources?: boolean } = {},
): Promise<ApiRoute[]> {
  const res = await fetch(`${gatewayUrl.replace(/\/$/, '')}/docs/json`, {
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok)
    throw new Error(`GET /docs/json -> HTTP ${res.status} (docs are off when NODE_ENV=production)`);
  let routes = routesFromOpenApi(
    (await res.json()) as { paths?: Record<string, Record<string, unknown>> },
  );
  if (o.withStatic !== false) routes = mergeStatic(routes, scanStaticRoutes(o.repoRoot));
  if (o.withResources !== false) {
    const mapper = await loadGatewayResourceMapper(o.repoRoot);
    if (mapper) {
      for (const r of routes) {
        try {
          r.resource = mapper(r.path);
        } catch {
          // leave unmapped
        }
      }
    }
  }
  return routes;
}

export function resolveRoutePath(
  r: ApiRoute,
  f: FixtureManifest,
  tenant: TenantKey,
  overrides: Record<string, string> = {},
): { path: string; unresolved: string[]; used: Record<string, { table: string; id: string }> } {
  const unresolved: string[] = [];
  const used: Record<string, { table: string; id: string }> = {};
  const segments = r.path.split('/');
  const out = segments.map((seg, i) => {
    if (!seg.startsWith(':')) return seg;
    const name = seg.slice(1);
    const override = overrides[name];
    if (override !== undefined) return encodeURIComponent(override);
    const hit = resolveParam(name, segments.slice(0, i), f, tenant);
    if (!hit) {
      unresolved.push(name);
      return seg;
    }
    used[name] = hit;
    return encodeURIComponent(hit.id);
  });
  return { path: out.join('/'), unresolved, used };
}
