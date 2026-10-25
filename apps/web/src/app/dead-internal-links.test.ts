/**
 * @vitest-environment node
 *
 * Every internal link must point at a route this app defines.
 *
 * "Defines", not "serves": this checks that a `page.tsx` exists for the path. Whether the
 * middleware, a role guard or a route handler then lets a given visitor through is a
 * different property — and that gap bit immediately. `/legal/privacy` was added as a route
 * to fix the signup consent links and still 307'd anonymous visitors to `/login`, because
 * `/legal` was missing from `PUBLIC_PATHS`. `middleware.public-paths.test.ts` covers
 * reachability; this file covers existence.
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
 * Known blind spots, measured against the current tree and each with zero live violations:
 * imperative navigation (`router.push`, `redirect()`), template-literal and
 * `href={CONST}` targets, and a static dead child under a dynamic parent — `[id]` compiles
 * to `[^/]+`, so `/students/not-a-page` resolves. Optional catch-alls (`[[...slug]]`) fall
 * into the single-segment branch.
 *
 * Cross-app destinations are the one legitimate exception and are listed explicitly, so
 * adding one is a deliberate act rather than an accident.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const WEB_SRC = join(__dirname, '..');
const APP_DIR = __dirname;

/**
 * Files whose links are not reachable, because nothing in this app routes them.
 *
 * `app/(marketing)/` contains a layout and **no `page.tsx`**, and nothing renders
 * `LandingPage`, `FeaturesPage`, `PricingPage`, `AboutPage`, `ContactPage`, `DemoPage`,
 * `MarketingHeader` or `MarketingFooter`. They are SPA-era components whose routing
 * mechanism (`featureRegistry.ts`) the App Router does not read.
 *
 * Between them the header and footer hold 45 targets with no route here — `/features`,
 * `/pricing`, `/docs/api`, `/solutions/ministries`, `/legal/dpa` and so on.
 * `apps/public-website` owns that surface but has only 12 pages and different paths
 * (`/privacy`, not `/legal/privacy`), so most of the 45 have no destination anywhere.
 * They are broken links, not cross-app destinations — which is why they are excluded as
 * *unreachable* rather than as *intentional*.
 *
 * This exclusion is only honest while the components stay unrouted. Routing a page that
 * renders `<MarketingLayout>` would publish all 45, which is exactly why the `/legal/*`
 * pages use `LegalDocumentChrome` and `/track` uses `PublicTrackHeader`. The assertion
 * below pins that: if any route starts rendering this chrome, the guard fails.
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

/** True for a comment-only line, so documenting a component is not rendering it. */
function isCommentLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
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

  it('keeps the marketing chrome unrouted, so excluding it stays honest', () => {
    // The exclusion above is justified by unreachability. If a page ever renders
    // MarketingLayout — or the header/footer directly — those 45 dead targets become
    // live and the exclusion becomes a way of hiding them.
    const renderers: string[] = [];
    for (const file of walk(APP_DIR)) {
      if (!/\.tsx$/.test(file)) continue;
      const rendersChrome = readFileSync(file, 'utf8')
        .split('\n')
        // Skip comments: this very file's own docstrings name the components.
        .filter((line) => !isCommentLine(line))
        .some((line) => /<MarketingLayout|<MarketingHeader|<MarketingFooter/.test(line));
      if (rendersChrome) renderers.push(file.slice(APP_DIR.length + 1));
    }

    expect(
      renderers.sort(),
      `Routed file(s) render the marketing chrome, which carries 45 dead links: ` +
        `${renderers.join(', ')}. Use LegalDocumentChrome (or fix the links) rather than ` +
        `relying on the exclusion list.`,
    ).toEqual([
      // Has no `page.tsx` beneath it, so it renders for no route. Removing the group or
      // adding a page is what would make its chrome live.
      '(marketing)/layout.tsx',
    ]);
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

/**
 * Transitive import-closure deadness guard for the legacy Vite SPA (Decision D6).
 *
 * The marketing-chrome assertion above pins that the App Router does not *route* the SPA
 * components. This block proves the stronger property the deletion depends on: the SPA
 * feature tree and its entrypoints are not *in the production import graph at all*, so a
 * future edit cannot quietly pull a deleted page back into a live route.
 *
 * ## Method (mirrors plan §A)
 *
 * Roots = every Next.js App Router entrypoint under `app/**`
 * (`page|layout|route|template|loading|error|not-found|default|global-error`), **minus**
 * the deleted `app/App.tsx` Vite root, plus `src/middleware.ts`. Follow every static and
 * dynamic `import`/`export … from`/`import(…)` specifier transitively across non-test
 * files, resolving `@/*` to `src/*` and relative specifiers with the standard
 * `.ts/.tsx/.js/.jsx` + `index.*` resolution. A `features/**` file in the resulting closure
 * is REACHABLE; one outside it is PROVEN-DEAD.
 *
 * The closure must contain exactly the 10 `features/**` files the App Router imports
 * directly, and nothing else under `features/**`. If a deleted page is reintroduced into a
 * live import path, it re-enters the closure and this test fails.
 */
const KEEP_FEATURE_FILES = [
  'features/auth/MFASetup.tsx',
  'features/legal/PrivacyPolicy.tsx',
  'features/legal/TermsOfService.tsx',
  'features/settings/pages/NotificationPreferences.tsx',
  'features/scholarships/pages/ScholarshipApplication.tsx',
  'features/scholarships/scholarship-browser.ts',
  'features/scholarships/document-upload.ts',
  'features/scholarships/disbursement-paid.ts',
  'features/scholarships/components/application-documents-panel.tsx',
  'features/scholarships/components/document-upload-slots.tsx',
].sort();

const APP_ROUTER_ENTRY_NAMES = new Set([
  'page',
  'layout',
  'route',
  'template',
  'loading',
  'error',
  'not-found',
  'default',
  'global-error',
]);

const MODULE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];

function isTestFile(file: string): boolean {
  return /\.(test|spec)\.[tj]sx?$/.test(file);
}

/** Resolve an import specifier to a source file inside `src`, or null for bare modules. */
function resolveSpecifier(spec: string, fromFile: string): string | null {
  let base: string;
  if (spec.startsWith('@/')) base = join(WEB_SRC, spec.slice(2));
  else if (spec.startsWith('./') || spec.startsWith('../')) base = resolve(dirname(fromFile), spec);
  else return null; // bare package specifier — outside the app source graph

  const candidates = [
    base,
    ...MODULE_EXTENSIONS.map((ext) => base + ext),
    ...MODULE_EXTENSIONS.map((ext) => join(base, `index${ext}`)),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

const SPECIFIER_RE =
  /(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

function importedSpecifiers(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  const out: string[] = [];
  for (const match of source.matchAll(SPECIFIER_RE)) {
    const spec = match[1] ?? match[2];
    if (spec) out.push(spec);
  }
  return out;
}

/** The set of production files reachable from the App Router entrypoints. */
function appRouterClosure(): Set<string> {
  const roots: string[] = [];
  for (const file of walk(APP_DIR)) {
    if (isTestFile(file)) continue;
    if (!/\.[tj]sx?$/.test(file)) continue;
    const name = file.replace(/.*[/\\]/, '').replace(/\.[tj]sx?$/, '');
    // The deleted Vite SPA root is excluded by name; it no longer exists but the
    // exclusion keeps the algorithm faithful to plan §A.
    if (file === join(APP_DIR, 'App.tsx')) continue;
    if (APP_ROUTER_ENTRY_NAMES.has(name)) roots.push(file);
  }
  const middleware = resolveSpecifier('@/middleware', join(WEB_SRC, 'x'));
  if (middleware) roots.push(middleware);

  const seen = new Set<string>();
  const stack = [...roots];
  while (stack.length > 0) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    if (isTestFile(file)) continue;
    for (const spec of importedSpecifiers(file)) {
      const resolved = resolveSpecifier(spec, file);
      if (resolved && !seen.has(resolved)) stack.push(resolved);
    }
  }
  return seen;
}

describe('legacy SPA is unreachable', () => {
  it('has removed the Vite SPA entrypoints', () => {
    // The two roots of the dead SPA. Their absence is what makes every feature page
    // unreachable; if either returns, the closure below also fails.
    expect(existsSync(join(APP_DIR, 'App.tsx'))).toBe(false);
    expect(existsSync(join(WEB_SRC, 'RootRouter.tsx'))).toBe(false);
  });

  it('has removed the dead pasted-ID transcript form (PRC-L530)', () => {
    // Unreferenced; the live flow is IssueTranscriptByName on /students/records (D6).
    expect(existsSync(join(WEB_SRC, 'components/gradebook/issue-transcript-form.tsx'))).toBe(false);
  });

  it('pulls exactly the 10 live feature files into the App Router closure', () => {
    const closure = appRouterClosure();
    const reachableFeatures = [...closure]
      .map((file) => relative(WEB_SRC, file))
      .filter((rel) => rel.startsWith('features/'))
      .sort();

    // (c) every KEEP file is reachable, and (b) nothing else under features/** is.
    expect(reachableFeatures).toEqual(KEEP_FEATURE_FILES);
  });

  it('keeps every deleted feature path out of the production import graph', () => {
    const closure = appRouterClosure();
    const keep = new Set(KEEP_FEATURE_FILES);
    const leaked = [...closure]
      .map((file) => relative(WEB_SRC, file))
      .filter((rel) => rel.startsWith('features/') && !keep.has(rel))
      .sort();

    expect(
      leaked,
      leaked.length > 0
        ? `A deleted legacy SPA feature file re-entered the live App Router import ` +
            `closure:\n  ${leaked.join('\n  ')}\n` +
            `Remove the import into it rather than re-adding the file.`
        : '',
    ).toEqual([]);
  });
});
