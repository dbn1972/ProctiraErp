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
 *                       Also used for EVERY other `/api/*` GET: API
 *                       responses are per-user / per-tenant (students,
 *                       staff, fees, health, dashboards, auth) and must
 *                       never be written to Cache Storage, where they
 *                       would outlive logout on a shared device
 *                       (PRC-H026 / PRC-H032).
 *
 *   • `network-first` — try network with a short timeout, fall back to
 *                       cache only if the network fails. Only used for
 *                       the non-personal tenant-branding endpoint.
 *
 *   • `network-only`  — page navigations / HTML. Always fetched from the
 *                       network and never cached (authenticated pages
 *                       embed personal data). Offline navigations get a
 *                       synthetic offline page from the SW.
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

export type Strategy = 'bypass' | 'network-first' | 'cache-first' | 'network-only';
/** HTTP methods that the service worker must always pass through to
 * the network without caching. The Sync_Queue handles offline replay.
 */
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
/** Explicit allow-list of NON-PERSONAL API GETs that may be cached
 * (network-first). Every other `/api/` path is `bypass`.
 */
const CACHEABLE_API_PREFIXES = ['/api/v1/tenant/branding'] as const;
/** Path prefixes for content-hashed static assets that can safely use
 * cache-first with a long TTL. Next.js writes its hashed bundles to
 * `/_next/static/` and additional public-folder static lives under
 * `/static/`.
 */
const STATIC_PREFIXES = ['/_next/static/', '/static/'] as const;
/** File extensions for fonts and images that should be cache-first
 * regardless of path (covers brand assets dropped into `/public`).
 * Never applied under `/api/` (e.g. student photos).
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
/** Prefix shared by every cache this app's service worker creates. */
export const SW_CACHE_PREFIX = 'proctira-';
/** `postMessage` type the SW handles by deleting all `proctira-*` caches. */
export const SW_PURGE_MESSAGE = 'PURGE_CACHES';
/**
 * Normalise the input URL to a path-only string so the matchers below
 * can use simple `startsWith` comparisons. Returns `null` when the input
 * cannot be parsed — in which case the caller should treat the request
 * as `bypass` rather than guess.
 */
function extractPath(url: string): string | null {
  if (typeof url !== 'string' || url.length === 0) return null;
  try {
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
 *   3. `/api/*`: allow-listed non-personal prefix → `network-first`;
 *      anything else → `bypass` (never cached).
 *   4. Known static prefix or cacheable extension → `cache-first`.
 *   5. Anything else (HTML navigations) → `network-only`.
 */
export function pickStrategy(method: string, url: string): Strategy {
  const upper = (method ?? '').toUpperCase();
  if (MUTATING_METHODS.has(upper)) return 'bypass';
  const path = extractPath(url);
  if (path === null) return 'bypass';
  if (path === '/api' || path.startsWith('/api/')) {
    for (const prefix of CACHEABLE_API_PREFIXES) {
      if (path.startsWith(prefix)) return 'network-first';
    }
    return 'bypass';
  }
  for (const prefix of STATIC_PREFIXES) {
    if (path.startsWith(prefix)) return 'cache-first';
  }
  const lowerPath = path.toLowerCase();
  for (const ext of CACHEABLE_ASSET_EXTENSIONS) {
    if (lowerPath.endsWith(ext)) return 'cache-first';
  }
  return 'network-only';
}
/** Minimal header reader so the helper works with `Headers` or plain maps in tests. */
interface HeaderReader {
  get(name: string): string | null;
}
/**
 * True when a response may be written to Cache Storage. Mirrors
 * `isCacheableResponse` in `sw.js`. Refuses responses that are marked
 * `no-store` / `private`, set cookies, or vary on credentials, and
 * responses to requests that carried an Authorization header.
 */
export function isCacheableResponse(
  responseHeaders: HeaderReader,
  requestHeaders?: HeaderReader,
): boolean {
  if (requestHeaders?.get('authorization')) return false;
  const cacheControl = (responseHeaders.get('cache-control') ?? '').toLowerCase();
  if (/(^|[\s,])(no-store|private)([\s,=]|$)/.test(cacheControl)) return false;
  if (responseHeaders.get('set-cookie')) return false;
  const vary = (responseHeaders.get('vary') ?? '').toLowerCase();
  if (/(^|[\s,])(\*|cookie|authorization)([\s,]|$)/.test(vary)) return false;
  return true;
}
