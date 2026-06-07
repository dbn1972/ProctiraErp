/**
 * apps/web/public/sw.js — Offline-first service worker
 * (Task 54.1, Requirements 38.1, 38.4, Design §I)
 * =====================================================================
 *
 * Plain JavaScript on purpose: Next.js serves files in `public/` byte-
 * for-byte at the URL path they live at, with no transpile step, so a
 * `.ts` file would not work here.
 *
 * Lifecycle:
 *
 *   • install  — opens a versioned shell cache and precaches a small,
 *                hand-curated list of brand-critical static assets
 *                (root document, manifest, favicon, brand logo). Hashed
 *                JS/CSS chunks are NOT precached because Next.js writes
 *                them with build-time hashes — they are opportunistically
 *                cached on first fetch instead. `skipWaiting()` is called
 *                so a new SW activates as soon as its install completes.
 *
 *   • activate — claims uncontrolled clients and deletes any caches
 *                whose name does not match the current versioned
 *                prefixes. This is what frees disk after a deploy.
 *
 *   • fetch    — runs the request through `pickStrategy(method, url)`
 *                and dispatches to the matching handler:
 *
 *                  bypass        → fetch() unwrapped (writes always
 *                                  reach the network; if the user is
 *                                  offline the Sync_Queue layer in
 *                                  app code intercepts the failure
 *                                  and persists the operation).
 *                  swr           → respond from cache immediately if
 *                                  present, refresh the cache from
 *                                  the network in the background.
 *                  network-first → try network, fall back to cache
 *                                  on any failure.
 *                  cache-first   → serve from cache if fresh (≤ 30
 *                                  days old), else fetch and cache.
 *
 * The SW deliberately leaves authentication and tenant scoping to the
 * application layer. Cache keys include the full request URL (which
 * carries the tenant subdomain in production), so there is no cross-
 * tenant cache pollution.
 *
 * Mirror checklist when editing this file:
 *   1. Update `apps/web/src/lib/sw/pickStrategy.ts` to match the rule
 *      set encoded below.
 *   2. Bump SHELL_CACHE / RUNTIME_CACHE / STATIC_CACHE version suffixes
 *      so the activate handler evicts the previous generation.
 */

/* eslint-disable no-restricted-globals */
/* global self, caches, fetch, Response */

// ─── Cache versioning ──────────────────────────────────────────────────
//
// Bump the `-v1` suffix whenever the precache manifest, runtime
// behaviour, or storage layout changes. The activate handler will
// delete any cache whose name does not start with one of these.
const SHELL_CACHE = 'proctira-shell-v1';
const RUNTIME_CACHE = 'proctira-runtime-v1';
const STATIC_CACHE = 'proctira-static-v1';
const KNOWN_CACHE_PREFIXES = ['proctira-shell-', 'proctira-runtime-', 'proctira-static-'];

// Cache-first TTL for static assets (30 days). Entries older than this
// are refetched from the network on the next request. Content-hashed
// Next.js bundles will hit a different URL after a deploy, so this TTL
// only matters for assets without a hash in their filename.
const STATIC_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// Network-first timeout — short enough that an offline client falls
// through to the cached response quickly.
const NETWORK_FIRST_TIMEOUT_MS = 3000;

// Hand-curated precache. Hashed JS/CSS chunks are intentionally
// excluded — they cannot be hardcoded across builds and are picked up
// by the runtime cache-first handler on first fetch.
const PRECACHE_URLS = [
  '/',
  '/manifest.json',
  '/favicon.ico',
  '/logo.svg',
];

// ─── Strategy classifier — mirror of src/lib/sw/pickStrategy.ts ────────
//
// Keep this verbatim with the TS module. The TS module has the unit
// tests; this one has the runtime. Any rule change MUST update both.

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const SWR_API_PREFIXES = [
  '/api/v1/dashboards/',
  '/api/v1/students',
  '/api/v1/institutions',
  '/api/v1/staff',
];

const NETWORK_FIRST_API_PREFIXES = [
  '/api/v1/auth/',
  '/api/v1/tenant/branding',
];

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

  for (const prefix of SWR_API_PREFIXES) {
    if (path.startsWith(prefix)) return 'swr';
  }
  for (const prefix of NETWORK_FIRST_API_PREFIXES) {
    if (path.startsWith(prefix)) return 'network-first';
  }
  for (const prefix of STATIC_PREFIXES) {
    if (path.startsWith(prefix)) return 'cache-first';
  }
  const lowerPath = path.toLowerCase();
  for (const ext of CACHEABLE_ASSET_EXTENSIONS) {
    if (lowerPath.endsWith(ext)) return 'cache-first';
  }
  return 'network-first';
}

// ─── Cache helpers ─────────────────────────────────────────────────────

/**
 * Best-effort cache write. We swallow errors here because partial-
 * response writes (opaque cross-origin redirects, 206 partials, etc.)
 * can throw and we never want a cache write to take down a fetch.
 */
async function safeCachePut(cacheName, request, response) {
  try {
    const cache = await caches.open(cacheName);
    await cache.put(request, response);
  } catch (_err) {
    // Intentionally ignored — a failed write is not a fetch failure.
  }
}

/**
 * Stamp a response with the time it was cached so cache-first can
 * enforce a TTL. We clone the response with an extra header rather
 * than tracking timestamps in a sidecar store — this keeps the SW
 * stateless and survives restarts.
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

// ─── Strategy implementations ──────────────────────────────────────────

/**
 * `swr` — serve cache immediately when present and revalidate the
 * cache from the network in the background. If nothing is cached we
 * fall through to the network response so the first hit still
 * succeeds online.
 */
async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);

  const networkPromise = fetch(request)
    .then((response) => {
      // Only cache successful, basic/cors responses. Opaque
      // responses (status 0) are stored as-is by `cache.put` but we
      // skip them so they cannot mask a real error.
      if (response && response.ok) {
        void safeCachePut(RUNTIME_CACHE, request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  if (cached) return cached;
  const network = await networkPromise;
  if (network) return network;
  // Last-resort offline response so the SW never rejects with a
  // generic "Failed to fetch". Application code can detect this
  // synthetic 503 and fall back to its empty-state UI.
  return new Response('Service Unavailable', {
    status: 503,
    statusText: 'Offline',
  });
}

/**
 * `network-first` — try the network with a short timeout, fall back
 * to the cached entry on any failure (timeout, offline, server error).
 * Successful responses replace the cached entry so the next offline
 * fallback is current.
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
      void safeCachePut(RUNTIME_CACHE, request, network.clone());
    }
    return network;
  } catch (_err) {
    const cached = await cache.match(request);
    if (cached) return cached;

    // For navigation requests, fall back to the precached shell so
    // the user sees the app frame instead of the browser offline page.
    if (request.mode === 'navigate') {
      const shell = await caches.match('/');
      if (shell) return shell;
    }
    return new Response('Service Unavailable', {
      status: 503,
      statusText: 'Offline',
    });
  }
}

/**
 * `cache-first` — return the cached entry if it is still inside the
 * 30-day TTL window. Otherwise fetch, cache (with a fresh timestamp),
 * and return the network response. On total network failure we fall
 * back to whatever cache entry we have, even if expired.
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
      void safeCachePut(STATIC_CACHE, request, stampCachedAt(network.clone()));
    }
    return network;
  } catch (_err) {
    if (cached) return cached; // stale-but-served beats nothing
    return new Response('Service Unavailable', {
      status: 503,
      statusText: 'Offline',
    });
  }
}

// ─── Service worker lifecycle ──────────────────────────────────────────

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // `addAll` is atomic — if any of the precache URLs 404s the
      // whole install fails. We use `Promise.allSettled` over
      // individual `add` calls instead so a missing optional asset
      // (e.g. /logo.svg before brand assets are uploaded) does not
      // block the SW from installing.
      await Promise.allSettled(
        PRECACHE_URLS.map((url) =>
          cache.add(new Request(url, { cache: 'reload' })),
        ),
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
            // Delete any cache that is one of ours but not at the
            // current version. Leave third-party caches alone.
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

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const strategy = pickStrategy(request.method, request.url);

  // Bypass: never touch the cache. The Sync_Queue layer (task 54.2)
  // is responsible for persisting offline writes — the SW must not
  // hide a write failure behind a synthetic response.
  if (strategy === 'bypass') return;

  // Only same-origin requests use the cache. Cross-origin requests
  // (e.g. a direct CDN call) pass through to the network.
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (strategy === 'swr') {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }
  if (strategy === 'cache-first') {
    event.respondWith(cacheFirst(request));
    return;
  }
  // Default fall-through: network-first for navigations and any
  // uncategorised same-origin GET.
  event.respondWith(networkFirst(request));
});
