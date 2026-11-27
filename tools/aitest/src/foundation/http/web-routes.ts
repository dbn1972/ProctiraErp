/**
 * Web screen inventory: every `page.tsx` under the six Next apps' App Router
 * trees, with route groups `(x)` and parallel slots `@x` removed.
 */
import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { repoRootFromHere } from '../repo.js';
import type { FixtureManifest } from '../seed/fixtures.js';
import { resolveParam } from '../seed/param-map.js';
import type { TenantKey } from '../seed/tenants.js';
import { WEB_APPS, type WebApp } from '../stack/types.js';

export interface WebRoute {
  app: WebApp;
  /** /students/[id] */
  route: string;
  file: string;
  dynamic: string[];
}

function walkPages(dir: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const e of entries) {
    if (e === 'node_modules') continue;
    const full = join(dir, e);
    if (statSync(full).isDirectory()) walkPages(full, out);
    else if (e === 'page.tsx' || e === 'page.ts' || e === 'page.jsx' || e === 'page.js')
      out.push(full);
  }
}

export function routeFromPageDir(relDir: string): string {
  const parts = relDir
    .split(sep)
    .filter(Boolean)
    .filter((p) => !(p.startsWith('(') && p.endsWith(')')) && !p.startsWith('@'));
  return `/${parts.join('/')}`;
}

export function dynamicSegments(route: string): string[] {
  return [...route.matchAll(/\[\[?(?:\.\.\.)?([^\]]+)\]?\]/g)].map((m) => m[1] ?? '');
}

export function listWebRoutes(
  apps: readonly WebApp[] = WEB_APPS,
  repoRoot = repoRootFromHere(),
): WebRoute[] {
  const out: WebRoute[] = [];
  for (const app of apps) {
    const appDir = join(repoRoot, 'apps', app, 'src', 'app');
    const files: string[] = [];
    walkPages(appDir, files);
    for (const f of files) {
      const rel = relative(appDir, join(f, '..'));
      const route = routeFromPageDir(rel);
      out.push({ app, route, file: relative(repoRoot, f), dynamic: dynamicSegments(route) });
    }
  }
  return out.sort((a, b) => a.app.localeCompare(b.app) || a.route.localeCompare(b.route));
}

export function resolveWebRoute(
  r: WebRoute,
  f: FixtureManifest,
  tenant: TenantKey,
  overrides: Record<string, string> = {},
): { url: string; unresolved: string[] } {
  const unresolved: string[] = [];
  const segments = r.route.split('/');
  const out: string[] = [];
  segments.forEach((seg, i) => {
    const m = /^\[\[?(\.\.\.)?([^\]]+)\]?\]$/.exec(seg);
    if (!m) {
      out.push(seg);
      return;
    }
    const name = m[2] ?? '';
    const optional = seg.startsWith('[[');
    const override = overrides[name];
    if (override !== undefined) {
      out.push(encodeURIComponent(override));
      return;
    }
    if (optional) return;
    const hit = resolveParam(name, segments.slice(0, i), f, tenant);
    if (!hit) {
      unresolved.push(name);
      out.push(seg);
      return;
    }
    out.push(encodeURIComponent(hit.id));
  });
  return { url: out.join('/') || '/', unresolved };
}
