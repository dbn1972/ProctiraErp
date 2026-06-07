/**
 * apps/web/src/lib/sw/pickStrategy.ts — Service worker route classifier
 * (Task 54.1, Requirements 38.1, 38.4, Design §I)
 * =====================================================================
 *
 * The service worker (`apps/web/public/sw.js`) must pick one of four
 * fetch strategies for every request. To keep that decision auditable
 * and unit-testable, the rule set lives here as a pure TypeScript
 * function and is mirrored verbatim inside `sw.js` (which cannot
 * import TypeScript modules at runtime).
 *
 * Strategies:
 *
 *   • `bypass`        — never cache, never read from cache. Used for
 *                       all mutating verbs (`POST`/`PUT`/`PATCH`/`DELETE`)
 *                       and for cross-origin requests. The Sync_Queue
 *                       (task 54.2) handles offline writes by intercepting
 *                       them at the application layer, not the SW layer,
 *                       so the SW must never mask a write failure with a
 *                       cached response.
 *
 *   • `swr`           — stale-while-revalidate. Read-heavy GETs where
 *                       the user benefits from instant render (cached
 *                       payload) followed by a background refresh:
 *                       dashboards, student lists, institution metadata,
 *                       staff lists.
 *
 *   • `network-first` — try network with a short timeout, fall back to
 *                       cache only if the network fails. Used for
 *                       write-sensitive or freshness-critical reads:
 *                       auth endpoints (token refresh, session probe),
 *                       tenant branding (so a republished theme
 *                       propagates within minutes), and any other
 *                       endpoint where stale data is unsafe.
 *
 *   • `cache-first`   — serve from cache if present, else fetch and
 *                       cache. Used for static assets that ship with a
 *                       content hash (`/_next/static/*`, `/static/*`)
 *                       and for fonts/images. The cache itself enforces
 *                       a 30-day TTL on these entries (see `sw.js`).
 *
 * The helper is method- and URL-only — it never inspects headers or
 * the request body. That keeps it cheap to call on every fetch event
 * and trivially testable.
 *
 * Mirror checklist when editing this file:
 *   1. Update `apps/web/public/sw.js` `pickStrategy()` to match.
 *   2. Run `pnpm --filter @proctira/web test src/lib/sw` to confirm
 *      the test matrix still classifies every named branch correctly.
 */

export type Strategy = 'bypass' | 'swr' | 'network-first' | 'cache-first';

/** HTTP methods that the service worker must always pass through to
 * the network without caching. The Sync_Queue handles offline replay.
 */
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** API path prefixes whose GET responses are read-heavy and benefit
 * from stale-while-revalidate. Order does not matter — the first
 * prefix that matches wins.
 */
const SWR_API_PREFIXES = [
  '/api/v1/dashboards/',
  '/api/v1/students',
  '/api/v1/institutions',
  '/api/v1/staff',
] as const;

/** API path prefixes whose GET responses are freshness-critical and
 * must hit the network first; cache is only a fallback for offline.
 */
const NETWORK_FIRST_API_PREFIXES = [
  '/api/v1/auth/',
  '/api/v1/tenant/branding',
] as const;

/** Path prefixes for content-hashed static assets that can safely use
 * cache-first with a long TTL. Next.js writes its hashed bundles to
 * `/_next/static/` and additional public-folder static lives under
 * `/static/`.
 */
const STATIC_PREFIXES = ['/_next/static/', '/static/'] as const;

/** File extensions for fonts and images that should be cache-first
 * regardless of path (covers brand assets dropped into `/public`).
 */
const CACHEABLE_ASSET_EXTENSIONS = [
  '.woff2',
  '.woff',
  '.ttf',
  '.otf',
  '.svg',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.ico',
] as const;

/**
 * Normalise the input URL to a path-only string so the matchers below
 * can use simple `startsWith` comparisons. Accepts absolute URLs
 * (e.g. the request URL the SW receives), relative paths, or anything
 * the `URL` constructor can parse against `http://localhost`.
 *
 * Returns `null` when the input cannot be parsed — in which case the
 * caller should treat the request as `bypass` rather than guess.
 */
function extractPath(url: string): string | null {
  if (typeof url !== 'string' || url.length === 0) return null;
  try {
    // `URL` requires either an absolute URL or a base. Using a fixed
    // `http://localhost` base lets us accept relative paths uniformly.
    const parsed = new URL(url, 'http://localhost');
    return parsed.pathname;
  } catch {
    return null;
  }
}

/**
 * Decide which fetch strategy the service worker should apply.
 *
 * Decision order (first match wins):
 *   1. Mutating verbs → `bypass`.
 *   2. Unparseable URL → `bypass` (defensive: do not cache unknowns).
 *   3. URL on a SWR API prefix → `swr`.
 *   4. URL on a network-first API prefix → `network-first`.
 *   5. URL on a known static prefix or with a cacheable extension →
 *      `cache-first`.
 *   6. Anything else (HTML navigations, other API calls) →
 *      `network-first` so navigations always try the live page first
 *      but still fall back to the precached shell when offline.
 */
export function pickStrategy(method: string, url: string): Strategy {
  const upper = (method ?? '').toUpperCase();

  // 1. All mutating verbs go straight through — the Sync_Queue layer
  //    above the SW is responsible for offline write handling.
  if (MUTATING_METHODS.has(upper)) return 'bypass';

  const path = extractPath(url);
  if (path === null) return 'bypass';

  // 3. Read-heavy GETs.
  for (const prefix of SWR_API_PREFIXES) {
    if (path.startsWith(prefix)) return 'swr';
  }

  // 4. Freshness-critical / write-sensitive GETs.
  for (const prefix of NETWORK_FIRST_API_PREFIXES) {
    if (path.startsWith(prefix)) return 'network-first';
  }

  // 5. Static assets and brand images/fonts.
  for (const prefix of STATIC_PREFIXES) {
    if (path.startsWith(prefix)) return 'cache-first';
  }
  const lowerPath = path.toLowerCase();
  for (const ext of CACHEABLE_ASSET_EXTENSIONS) {
    if (lowerPath.endsWith(ext)) return 'cache-first';
  }

  // 6. Default — page navigations and uncategorised API calls.
  //    Network-first lets the SW serve the precached shell on offline
  //    navigations while keeping fresh data when online.
  return 'network-first';
}
