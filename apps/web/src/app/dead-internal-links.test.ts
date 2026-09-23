/**
 * @vitest-environment node
 *
 * Every internal link must resolve to a route this app serves.
 *
 * ## Why this is not covered by anything else
 *
 * The page-capture tooling walks `page.tsx` files and visits the routes it finds, so it
 * can only ever see routes that exist. A `<Link href="/staff/assignments/new">` pointing
 * at a route that was never created is invisible to it — the capture visits
 * `/staff/[id]/assignments/new`'s concrete siblings and never follows a link. A 193-page
 * capture of a live deployment reported zero broken routes while six link targets 404'd.
 *
 * Two of those were reachable from signup: the consent copy links to `/legal/terms` and
 * `/legal/privacy`, whose components exist and are tested but were mounted by the
 * Vite-era `featureRegistry.ts` that the App Router does not read. A user was asked to
 * accept terms they could not open.
 *
 * ## What is checked
 *
 * Literal `href="/…"` values and route strings declared in nav arrays, resolved against
 * the route patterns derived from `app/**` `page.tsx` — including dynamic (`[id]`) and
 * catch-all (`[...slug]`) segments, with route groups (`(dashboard)`) stripped.
 *
 * Cross-app destinations are the one legitimate exception and are listed explicitly, so
 * adding one is a deliberate act rather than an accident.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const WEB_SRC = join(__dirname, '..');
const APP_DIR = __dirname;

/**
 * Link targets that intentionally leave this app.
 *
 * `apps/public-website` owns the marketing surface — `/about`, `/contact`, `/product`,
 * `/privacy`, `/terms` and friends are its routes, not this app's. `apps/web` still
 * carries unrouted SPA-era marketing components (`features/marketing/*`) whose internal
 * links point at those paths; whether this app should host marketing at all is an open
 * product question, so those components are excluded here by file rather than having
 * their links silently "fixed" to somewhere they do not belong.
 */
const UNROUTED_MARKETING_COMPONENTS = [
  'features/marketing/',
  'components/layout/marketing-header.tsx',
  'components/layout/marketing-footer.tsx',
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/** Route patterns the App Router serves, derived from the `page.tsx` tree. */
export function routePatterns(): RegExp[] {
  const patterns: RegExp[] = [];
  for (const file of walk(APP_DIR)) {
    if (!/[/\\]page\.tsx?$/.test(file)) continue;
    const rel = file
      .slice(APP_DIR.length)
      .replace(/[/\\]page\.tsx?$/, '')
      // route groups do not appear in the URL
      .replace(/\/\([^/]+\)/g, '');
    const source = rel
      .split('/')
      .map((segment) => {
        if (/^\[\.\.\..+\]$/.test(segment)) return '.+';
        if (/^\[.+\]$/.test(segment)) return '[^/]+';
        return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      })
      .join('/');
    patterns.push(new RegExp(`^${source || '/'}$`));
  }
  return patterns;
}

/** True when a path is served by some route. */
export function resolves(path: string, patterns = routePatterns()): boolean {
  return patterns.some((pattern) => pattern.test(path));
}

function normalise(href: string): string {
  const [withoutHash] = href.split('#');
  const [path] = (withoutHash ?? href).split('?');
  return (path ?? href).replace(/\/+$/, '') || '/';
}

/** Targets that are not pages: API handlers and static assets. */
function isNonPageTarget(path: string): boolean {
  return (
    path.startsWith('/api/') ||
    /\.(svg|png|jpg|jpeg|webp|gif|ico|pdf|json|xml|txt|webmanifest|css|js)$/.test(path)
  );
}

export function findDeadLinks(): Map<string, string[]> {
  const patterns = routePatterns();
  const dead = new Map<string, string[]>();
  for (const file of walk(WEB_SRC)) {
    if (!/\.tsx?$/.test(file) || /\.test\.tsx?$/.test(file)) continue;
    const rel = file.slice(WEB_SRC.length + 1);
    if (UNROUTED_MARKETING_COMPONENTS.some((prefix) => rel.startsWith(prefix))) continue;

    const source = readFileSync(file, 'utf8');
    const targets = new Set<string>();
    // <Link href="/x"> and href='/x'
    for (const match of source.matchAll(/href=["'](\/[^"'`${}]*)["']/g)) {
      targets.add(match[1]!);
    }
    // { href: '/x' } as used by nav-link arrays — the form the first version of this
    // scan missed, which is how two more dead marketing links went unnoticed.
    for (const match of source.matchAll(/\bhref:\s*['"](\/[^'"`${}]*)['"]/g)) {
      targets.add(match[1]!);
    }

    for (const raw of targets) {
      const path = normalise(raw);
      if (isNonPageTarget(path)) continue;
      if (resolves(path, patterns)) continue;
      dead.set(path, [...(dead.get(path) ?? []), rel]);
    }
  }
  return dead;
}

describe('internal links resolve to a route', () => {
  it('derives route patterns from the app directory', () => {
    const patterns = routePatterns();
    expect(patterns.length).toBeGreaterThan(100);
    // Route groups are stripped, dynamic segments match one segment.
    expect(resolves('/staff', patterns)).toBe(true);
    expect(resolves('/staff/abc-123', patterns)).toBe(true);
    expect(resolves('/staff/abc-123/assignments/new', patterns)).toBe(true);
    // And the thing that was actually broken.
    expect(resolves('/staff/assignments/new', patterns)).toBe(false);
  });

  it('routes the legal pages the signup consent copy links to', () => {
    // Not merely "some route exists": these two specifically, because a user cannot be
    // asked to accept terms they cannot open.
    const patterns = routePatterns();
    expect(resolves('/legal/terms', patterns)).toBe(true);
    expect(resolves('/legal/privacy', patterns)).toBe(true);
  });

  it('has no dead internal link targets', () => {
    const dead = findDeadLinks();
    const report = [...dead]
      .sort()
      .map(([path, files]) => `  ${path}\n      ${files.join('\n      ')}`)
      .join('\n');
    expect(dead.size, report ? `Dead internal link target(s):\n${report}` : '').toBe(0);
  });
});
