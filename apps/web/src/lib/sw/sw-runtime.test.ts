/**
 * Runtime tests for apps/web/public/sw.js (PRC-H026 / PRC-H032).
 *
 * Executes the real service-worker script in a VM sandbox with an
 * in-memory Cache Storage, then drives its fetch/message handlers:
 *   • user A's /api/v1/students and page HTML are never stored, so user B
 *     offline gets no A payload;
 *   • `Cache-Control: no-store` responses are not stored;
 *   • `PURGE_CACHES` deletes every proctira-* cache.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { beforeEach, describe, expect, it } from 'vitest';

const SW_SOURCE = readFileSync(resolve(__dirname, '../../../public/sw.js'), 'utf8');
const ORIGIN = 'https://school.example.test';

class MemoryCache {
  readonly entries = new Map<string, Response>();
  async match(req: Request | string) {
    const key = typeof req === 'string' ? new URL(req, ORIGIN).href : req.url;
    return this.entries.get(key)?.clone();
  }
  async put(req: Request, res: Response) {
    this.entries.set(req.url, res);
  }
  async add(req: Request) {
    this.entries.set(req.url, new Response('asset'));
  }
}

class MemoryCacheStorage {
  readonly stores = new Map<string, MemoryCache>();
  async open(name: string) {
    if (!this.stores.has(name)) this.stores.set(name, new MemoryCache());
    return this.stores.get(name)!;
  }
  async keys() {
    return [...this.stores.keys()];
  }
  async delete(name: string) {
    return this.stores.delete(name);
  }
  async match(req: Request | string) {
    for (const cache of this.stores.values()) {
      const hit = await cache.match(req);
      if (hit) return hit;
    }
    return undefined;
  }
  totalEntries() {
    let n = 0;
    for (const c of this.stores.values()) n += c.entries.size;
    return n;
  }
}

type Handler = (event: Record<string, unknown>) => void;

function loadSw(fetchImpl: (req: Request) => Promise<Response>) {
  const handlers = new Map<string, Handler>();
  const caches = new MemoryCacheStorage();
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, fn: Handler) => handlers.set(type, fn),
    skipWaiting: async () => undefined,
    clients: { claim: async () => undefined },
  };
  vm.runInNewContext(SW_SOURCE, {
    self,
    caches,
    fetch: fetchImpl,
    Response,
    Request,
    Headers,
    URL,
    setTimeout,
    Promise,
  });
  async function dispatchFetch(url: string, init: RequestInit = {}) {
    const request = new Request(new URL(url, ORIGIN).href, init);
    let responded: Promise<Response> | undefined;
    handlers.get('fetch')!({ request, respondWith: (p: Promise<Response>) => (responded = p) });
    return responded ? await responded : undefined;
  }
  async function dispatchMessage(data: unknown) {
    const pending: Promise<unknown>[] = [];
    handlers.get('message')?.({ data, waitUntil: (p: Promise<unknown>) => pending.push(p) });
    await Promise.all(pending);
  }
  return { caches, dispatchFetch, dispatchMessage, handlers };
}

describe('sw.js runtime — no authenticated data in Cache Storage', () => {
  let online = true;
  let body = 'A';
  let headers: Record<string, string> = {};
  const fetchImpl = async (req: Request) => {
    if (!online) throw new TypeError('Failed to fetch');
    return new Response(`${body}:${new URL(req.url).pathname}`, { status: 200, headers });
  };

  beforeEach(() => {
    online = true;
    body = 'A';
    headers = {};
  });

  it('login A, load /api/v1/students + page, logout, B offline: no A payload served', async () => {
    const sw = loadSw(fetchImpl);
    // User A online.
    await sw.dispatchFetch('/api/v1/students');
    const page = await sw.dispatchFetch('/students', { mode: 'same-origin' });
    expect(await page?.text()).toBe('A:/students');
    // User B, offline.
    online = false;
    body = 'B';
    const api = await sw.dispatchFetch('/api/v1/students');
    expect(api).toBeUndefined(); // bypass → browser network error, never a cached A body
    const offlinePage = await sw.dispatchFetch('/students');
    const text = (await offlinePage?.text()) ?? '';
    expect(text).not.toContain('A:');
    expect(offlinePage?.status).toBe(503);
    expect(sw.caches.totalEntries()).toBe(0);
  });

  it('does not store Cache-Control: no-store responses', async () => {
    const sw = loadSw(fetchImpl);
    headers = { 'cache-control': 'no-store' };
    await sw.dispatchFetch('/api/v1/tenant/branding');
    await sw.dispatchFetch('/_next/static/chunk.js');
    expect(sw.caches.totalEntries()).toBe(0);
  });

  it('still caches public static assets', async () => {
    const sw = loadSw(fetchImpl);
    await sw.dispatchFetch('/_next/static/chunk.js');
    expect(sw.caches.totalEntries()).toBe(1);
  });

  it('PURGE_CACHES deletes every proctira-* cache and leaves others', async () => {
    const sw = loadSw(fetchImpl);
    await sw.caches.open('proctira-runtime-v1');
    await sw.caches.open('proctira-static-v2');
    await sw.caches.open('third-party');
    await sw.dispatchMessage({ type: 'PURGE_CACHES' });
    expect(await sw.caches.keys()).toEqual(['third-party']);
  });
});
