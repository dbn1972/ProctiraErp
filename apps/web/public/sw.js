/**
 * apps/web/public/sw.js — Offline-first service worker
 * (Task 54.1, Requirements 38.1, 38.4, Design §I; PRC-H026 / PRC-H032)
 * =====================================================================
 *
 * Plain JavaScript on purpose: Next.js serves files in `public/` byte-
 * for-byte at the URL path they live at, with no transpile step, so a
 * `.ts` file would not work here.
 *
 * Lifecycle:
 *
 *   • install  — opens a versioned shell cache and precaches a small,
 *                hand-curated list of NON-PERSONAL static assets
 *                (manifest, favicon, brand logo). The root document is
 *                not precached: for a signed-in user it is a
 *                personalised page. `skipWaiting()` is called so a new
 *                SW activates as soon as its install completes.
 *
 *   • activate — claims uncontrolled clients and deletes any caches
 *                whose name does not match the current versioned
 *                prefixes. This is what frees disk after a deploy.
 *
 *   • message  — `{ type: 'PURGE_CACHES' }` deletes every proctira-*
 *                cache. The app sends it on logout, on 401 and on
 *                user/tenant change.
 *
 *   • fetch    — runs the request through `pickStrategy(method, url)`
 *                and dispatches to the matching handler:
 *
 *                  bypass        → fetch() unwrapped, never cached.
 *                                  Mutating verbs and EVERY /api/* GET
 *                                  except the non-personal allow-list.
 *                  network-first → try network, fall back to cache
 *                                  on any failure (tenant branding).
 *                  network-only  → navigations/HTML: never cached;
 *                                  offline gets a static offline page.
 *                  cache-first   → serve from cache if fresh (≤ 30
 *                                  days old), else fetch and cache.
 *
 * Authenticated, per-user data (API JSON, HTML pages) is never written
 * to Cache Storage: caches are keyed by URL only and outlive logout on
 * shared devices. Responses marked no-store/private, setting cookies,
 * varying on credentials, or answering an Authorization-bearing request
 * are also never stored.
 *
 * Mirror checklist when editing this file:
 *   1. Update `apps/web/src/lib/sw/pickStrategy.ts` to match the rule
 *      set encoded below.
 *   2. Bump SHELL_CACHE / RUNTIME_CACHE / STATIC_CACHE version suffixes
 *      so the activate handler evicts the previous generation.
 */

/* eslint-disable no-restricted-globals */
/* global self, caches, fetch, Response, Headers */

// ─── Cache versioning ──────────────────────────────────────────────────
//
// v2: evicts v1 runtime/shell caches that held authenticated payloads.
const SHELL_CACHE = 'proctira-shell-v2';
const RUNTIME_CACHE = 'proctira-runtime-v2';
const STATIC_CACHE = 'proctira-static-v2';
const CACHE_PREFIX = 'proctira-';
const KNOWN_CACHE_PREFIXES = ['proctira-shell-', 'proctira-runtime-', 'proctira-static-'];
const PURGE_MESSAGE = 'PURGE_CACHES';

// Cache-first TTL for static assets (30 days).
const STATIC_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// Network-first timeout — short enough that an offline client falls
// through to the cached response quickly.
const NETWORK_FIRST_TIMEOUT_MS = 3000;

// Hand-curated, non-personal precache.
const PRECACHE_URLS = ['/manifest.json', '/favicon.ico', '/logo.svg'];

const OFFLINE_HTML =
  '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width, initial-scale=1">' +
  '<title>Offline</title></head><body><main>' +
  '<h1>You are offline</h1><p>Reconnect to the internet and reload this page.</p>' +
  '</main></body></html>';

// ─── Strategy classifier — mirror of src/lib/sw/pickStrategy.ts ────────

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Explicit allow-list of NON-PERSONAL API GETs that may be cached.
const CACHEABLE_API_PREFIXES = ['/api/v1/tenant/branding'];

const STATIC_PREFIXES = ['/_next/static/', '/static/'];

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
];

function extractPath(url) {
  if (typeof url !== 'string' || url.length === 0) return null;
  try {
    return new URL(url, 'http://localhost').pathname;
  } catch (_err) {
    return null;
  }
}

function pickStrategy(method, url) {
  const upper = (method || '').toUpperCase();
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

// Mirror of isCacheableResponse() in src/lib/sw/pickStrategy.ts.
function isCacheableResponse(responseHeaders, requestHeaders) {
  if (requestHeaders && requestHeaders.get('authorization')) return false;
  const cacheControl = (responseHeaders.get('cache-control') || '').toLowerCase();
  if (/(^|[\s,])(no-store|private)([\s,=]|$)/.test(cacheControl)) return false;
  if (responseHeaders.get('set-cookie')) return false;
  const vary = (responseHeaders.get('vary') || '').toLowerCase();
  if (/(^|[\s,])(\*|cookie|authorization)([\s,]|$)/.test(vary)) return false;
  return true;
}

// ─── Cache helpers ─────────────────────────────────────────────────────

/**
 * Best-effort cache write that refuses non-shareable responses. Errors
 * are swallowed: a failed write must never take down a fetch.
 */
async function safeCachePut(cacheName, request, response) {
  if (!isCacheableResponse(response.headers, request.headers)) return;
  try {
    const cache = await caches.open(cacheName);
    await cache.put(request, response);
  } catch (_err) {
    // Intentionally ignored — a failed write is not a fetch failure.
  }
}

async function purgeAllCaches() {
  const names = await caches.keys();
  await Promise.all(
    names.filter((name) => name.startsWith(CACHE_PREFIX)).map((name) => caches.delete(name)),
  );
}

/**
 * Stamp a response with the time it was cached so cache-first can
 * enforce a TTL.
 */
function stampCachedAt(response) {
  const headers = new Headers(response.headers);
  headers.set('x-sw-cached-at', String(Date.now()));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function isFreshByTtl(response, ttlMs) {
  const stamp = response.headers.get('x-sw-cached-at');
  if (!stamp) return true; // un-stamped (e.g. precached) — always fresh
  const cachedAt = Number(stamp);
  if (!Number.isFinite(cachedAt)) return true;
  return Date.now() - cachedAt < ttlMs;
}

function offlineResponse() {
  return new Response('Service Unavailable', { status: 503, statusText: 'Offline' });
}

// ─── Strategy implementations ──────────────────────────────────────────

/**
 * `network-first` — try the network with a short timeout, fall back
 * to the cached entry on failure. Only used for allow-listed,
 * non-personal API GETs.
 */
async function networkFirst(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  try {
    const network = await Promise.race([
      fetch(request),
      new Promise((_resolve, reject) =>
        setTimeout(() => reject(new Error('network-timeout')), NETWORK_FIRST_TIMEOUT_MS),
      ),
    ]);
    if (network && network.ok) {
      await safeCachePut(RUNTIME_CACHE, request, network.clone());
    }
    return network;
  } catch (_err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    return offlineResponse();
  }
}

/**
 * `network-only` — navigations/HTML. Never read from or written to the
 * cache; offline users get a static, non-personal offline page.
 */
async function networkOnly(request) {
  try {
    return await fetch(request);
  } catch (_err) {
    return new Response(OFFLINE_HTML, {
      status: 503,
      statusText: 'Offline',
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
}

/**
 * `cache-first` — return the cached entry if it is still inside the
 * 30-day TTL window. Otherwise fetch, cache (with a fresh timestamp),
 * and return the network response.
 */
async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  if (cached && isFreshByTtl(cached, STATIC_TTL_MS)) {
    return cached;
  }
  try {
    const network = await fetch(request);
    if (network && network.ok) {
      await safeCachePut(STATIC_CACHE, request, stampCachedAt(network.clone()));
    }
    return network;
  } catch (_err) {
    if (cached) return cached; // stale-but-served beats nothing
    return offlineResponse();
  }
}

// ─── Service worker lifecycle ──────────────────────────────────────────

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      await Promise.allSettled(
        PRECACHE_URLS.map((url) => cache.add(new Request(url, { cache: 'reload' }))),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => {
            const isOurs = KNOWN_CACHE_PREFIXES.some((p) => name.startsWith(p));
            const isCurrent =
              name === SHELL_CACHE || name === RUNTIME_CACHE || name === STATIC_CACHE;
            return isOurs && !isCurrent;
          })
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

// Session end / user switch: the app posts { type: 'PURGE_CACHES' }.
self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || data.type !== PURGE_MESSAGE) return;
  const done = purgeAllCaches().catch(() => undefined);
  if (typeof event.waitUntil === 'function') event.waitUntil(done);
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const strategy = pickStrategy(request.method, request.url);

  // Bypass: never touch the cache.
  if (strategy === 'bypass') return;

  // Only same-origin requests use the cache.
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (strategy === 'network-only') {
    event.respondWith(networkOnly(request));
    return;
  }
  if (strategy === 'cache-first') {
    event.respondWith(cacheFirst(request));
    return;
  }
  // network-first: allow-listed non-personal API GETs only.
  event.respondWith(networkFirst(request));
});
