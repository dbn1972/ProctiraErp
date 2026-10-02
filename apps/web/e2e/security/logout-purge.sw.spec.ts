/**
 * PRC-H026 / PRC-H032 / PRC-L253 — real-browser, service-worker-enabled proof
 * that signing out (and signing in as someone else) leaves none of the
 * previous user's data on a shared device.
 *
 * Runs only in the `chromium-sw` Playwright project (serviceWorkers: 'allow').
 * The service worker is registered by production builds only, so every test
 * skips with a reason under `next dev`.
 *
 * 1. "sign-out purge" — always on (no backend needed): seeds a runtime cache
 *    entry, a queued offline write and a draft, visits /logout (POST
 *    signOut) and asserts all three are gone.
 * 2. "login A / logout / login B offline" — `E2E_BACKEND_READY=1`: real
 *    logins as tenant A then tenant B; B going offline must not see any of
 *    A's cached student data.
 */
import { expect, test, type Page } from '@playwright/test';
import { loginAsTenantAdmin, loginAsTenantBUser } from '../fixtures/auth';

const BACKEND_READY = !!process.env.E2E_BACKEND_READY;
const BRAND = process.env.NEXT_PUBLIC_BRAND || 'proctira';
const SYNC_DB = `${BRAND}-sync-queue`;
const DRAFT_KEY = `${BRAND}-draft:/students/new:student-form`;

/** Waits for the production service worker to control the page; false under `next dev`. */
async function serviceWorkerControls(page: Page): Promise<boolean> {
  const registered = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return false;
    const ready = navigator.serviceWorker.ready.then(() => true);
    const timeout = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 10_000));
    return Promise.race([ready, timeout]);
  });
  if (!registered) return false;
  if (!(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)))) {
    // First load installs the worker; a reload puts the page under its control.
    await page.reload();
  }
  return page.evaluate(() => Boolean(navigator.serviceWorker.controller));
}

async function seedOfflineUserData(page: Page): Promise<void> {
  await page.evaluate(
    async ({ syncDb, draftKey }) => {
      const runtime = await caches.open('proctira-runtime-v2');
      await runtime.put(
        new Request('/api/v1/students?seeded=1'),
        new Response(JSON.stringify({ data: [{ name: 'Seeded Student A' }] }), {
          headers: { 'content-type': 'application/json' },
        }),
      );
      await new Promise<void>((resolve, reject) => {
        const open = indexedDB.open(syncDb, 1);
        open.onupgradeneeded = () => {
          const store = open.result.createObjectStore('operations', { keyPath: 'id' });
          store.createIndex('createdAt', 'createdAt', { unique: false });
        };
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const tx = open.result.transaction('operations', 'readwrite');
          tx.objectStore('operations').put({
            id: 'seeded-op',
            createdAt: new Date().toISOString(),
            tenantId: 'tenant-a',
            userId: 'user-a',
          });
          tx.oncomplete = () => {
            open.result.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      });
      localStorage.setItem(draftKey, JSON.stringify({ values: { firstName: 'Seeded' } }));
    },
    { syncDb: SYNC_DB, draftKey: DRAFT_KEY },
  );
}

interface OfflineSnapshot {
  runtimeEntries: string[];
  syncDbExists: boolean;
  draft: string | null;
}

async function offlineSnapshot(page: Page): Promise<OfflineSnapshot> {
  return page.evaluate(
    async ({ syncDb, draftKey }) => {
      const runtimeEntries: string[] = [];
      for (const name of await caches.keys()) {
        if (!name.startsWith('proctira-runtime')) continue;
        const cache = await caches.open(name);
        for (const request of await cache.keys()) runtimeEntries.push(request.url);
      }
      const databases = (await indexedDB.databases?.()) ?? [];
      return {
        runtimeEntries,
        syncDbExists: databases.some((db) => db.name === syncDb),
        draft: localStorage.getItem(draftKey),
      };
    },
    { syncDb: SYNC_DB, draftKey: DRAFT_KEY },
  );
}

async function signOutViaLogoutPage(page: Page): Promise<void> {
  await page.goto('/logout');
  await page.waitForURL((url) => url.pathname.startsWith('/login'), { timeout: 20_000 });
}

test.describe('service worker: session-end purge', () => {
  test('sign-out wipes runtime caches, the offline sync queue and drafts', async ({ page }) => {
    await page.goto('/login');
    test.skip(
      !(await serviceWorkerControls(page)),
      'Service worker is registered only by production builds (next start).',
    );

    await seedOfflineUserData(page);
    const before = await offlineSnapshot(page);
    expect(before.runtimeEntries.length).toBeGreaterThan(0);
    expect(before.syncDbExists).toBe(true);
    expect(before.draft).not.toBeNull();

    await signOutViaLogoutPage(page);

    await expect
      .poll(async () => offlineSnapshot(page), { timeout: 10_000 })
      .toEqual({ runtimeEntries: [], syncDbExists: false, draft: null });
  });

  test('login A, logout, login B offline: none of A’s data is served', async ({ page }) => {
    test.skip(!BACKEND_READY, 'E2E_BACKEND_READY is not set; see e2e/README.md.');

    await loginAsTenantAdmin(page);
    test.skip(
      !(await serviceWorkerControls(page)),
      'Service worker is registered only by production builds (next start).',
    );
    await page.goto('/students');
    const studentA = page.getByRole('link', { name: /^[A-Z][\w\s.'-]+$/ }).first();
    await expect(studentA).toBeVisible({ timeout: 15_000 });
    const studentAName = (await studentA.innerText()).trim();

    await signOutViaLogoutPage(page);
    const afterLogout = await offlineSnapshot(page);
    expect(afterLogout.runtimeEntries.filter((url) => /\/api\/|\/students/.test(url))).toEqual([]);
    expect(afterLogout.syncDbExists).toBe(false);

    await loginAsTenantBUser(page);
    await serviceWorkerControls(page);
    // Snapshot while still on an app origin page (an offline navigation may land on
    // the browser's error page, where Cache Storage is not reachable).
    const beforeOffline = await offlineSnapshot(page);
    expect(beforeOffline.runtimeEntries.filter((url) => url.includes('/students'))).toEqual([]);

    await page.context().setOffline(true);
    try {
      // Offline: the SW must not answer with A's cached page or API payload.
      await page.goto('/students').catch(() => null);
      await page.waitForLoadState('domcontentloaded').catch(() => null);
      await expect(page.getByText(studentAName, { exact: true })).toHaveCount(0);
    } finally {
      await page.context().setOffline(false);
    }
  });
});
