/**
 * @vitest-environment jsdom
 *
 * purgeServiceWorkerCaches + signOut wiring (PRC-H026 / PRC-H032).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { purgeServiceWorkerCaches } from './purge';

function installCaches(names: string[]) {
  const store = new Set(names);
  const cachesMock = {
    keys: vi.fn(async () => [...store]),
    delete: vi.fn(async (name: string) => store.delete(name)),
  };
  vi.stubGlobal('caches', cachesMock);
  return store;
}

describe('purgeServiceWorkerCaches', () => {
  let postMessage: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    postMessage = vi.fn();
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { controller: { postMessage } },
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('deletes proctira-* caches and messages the active service worker', async () => {
    const store = installCaches(['proctira-runtime-v2', 'proctira-shell-v2', 'other']);
    await purgeServiceWorkerCaches();
    expect([...store]).toEqual(['other']);
    expect(postMessage).toHaveBeenCalledWith({ type: 'PURGE_CACHES' });
  });

  it('signOut purges caches before redirecting', async () => {
    const store = installCaches(['proctira-runtime-v2']);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 204 })),
    );
    const { signOut } = await import('@/lib/auth/session');
    await signOut('#logged-out');
    expect(store.size).toBe(0);
  });

  it('a 401 from the browser gateway purges caches', async () => {
    const store = installCaches(['proctira-runtime-v2']);
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('{}', { status: 401, headers: { 'content-type': 'application/json' } }),
      ),
    );
    const { browserGatewayFetch } = await import('@/lib/api/browser-gateway');
    await expect(browserGatewayFetch('/students')).rejects.toThrow();
    await vi.waitFor(() => expect(store.size).toBe(0));
  });
});
