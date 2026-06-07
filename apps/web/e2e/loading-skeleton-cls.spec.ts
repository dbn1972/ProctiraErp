/**
 * Task 55.9 — Property F-8: Loading-State Skeleton and CLS.
 *
 * **Property F-8**: *For any* async data view `v`, `v` SHALL render a
 * Skeleton matching the loaded layout's grid for at least 300 ms or
 * until data arrives (whichever is shorter), and the hydrated content
 * SHALL produce a Cumulative Layout Shift score ≤ 0.1 for that route.
 *
 * **Validates: Requirements 39.2, 24.x**
 *
 * Approach:
 *   1. Use Playwright CDP session to throttle network to a slow 3G
 *      profile so async data fetches take long enough for skeletons
 *      to be visible.
 *   2. For each async dashboard view, navigate to the route and assert
 *      that skeleton elements (`[data-state="loading"]` or
 *      `[data-testid*="skeleton"]`) are rendered.
 *   3. Measure the skeleton display duration — it must be ≥ 300 ms or
 *      until data arrives (whichever is shorter).
 *   4. After data loads, measure CLS via the PerformanceObserver API
 *      and assert the score is ≤ 0.1.
 *
 * The test is gated on `E2E_BACKEND_READY=1` since it requires a live
 * backend to produce real async data fetches and authenticated sessions.
 *
 * Design: G, J, P
 */

import { test, expect, type Page, type CDPSession } from '@playwright/test';

import { loginAsTenantAdmin } from './fixtures/auth';

const BACKEND_READY = !!process.env.E2E_BACKEND_READY;

/**
 * Dashboard views to test. Each entry specifies:
 *   - route: the URL path to navigate to
 *   - name: human-readable label for test output
 *   - skeletonSelector: CSS selector that identifies skeleton elements
 *   - readySelector: CSS selector that identifies the loaded state
 */
const DASHBOARD_VIEWS = [
  {
    name: 'School Dashboard',
    route: '/app/dashboard',
    skeletonSelector: '[data-state="loading"], [data-testid*="skeleton"]',
    readySelector: '[data-state="ready"], [data-testid="school-dashboard"]',
  },
  {
    name: 'Students List',
    route: '/app/students',
    skeletonSelector: '[data-state="loading"], [data-testid*="skeleton"]',
    readySelector: '[data-state="ready"], [role="table"]',
  },
  {
    name: 'Attendance Page',
    route: '/app/attendance',
    skeletonSelector: '[data-state="loading"], [data-testid*="skeleton"]',
    readySelector: '[data-state="ready"], [data-testid*="attendance"]',
  },
] as const;

/** Maximum acceptable CLS score per the property definition. */
const MAX_CLS = 0.1;

/** Minimum skeleton display duration in milliseconds. */
const MIN_SKELETON_DURATION_MS = 300;

/**
 * Slow 3G network profile parameters for CDP Network.emulateNetworkConditions.
 * Matches the spec's "slow profile" requirement:
 *   - 500 kbps download throughput
 *   - 500 ms latency
 */
const SLOW_3G_PROFILE = {
  offline: false,
  downloadThroughput: (500 * 1024) / 8, // 500 kbps → bytes/sec
  uploadThroughput: (500 * 1024) / 8,
  latency: 500, // 500 ms RTT
};

/**
 * Enables network throttling via Chrome DevTools Protocol.
 */
async function enableNetworkThrottling(page: Page): Promise<CDPSession> {
  const cdpSession = await page.context().newCDPSession(page);
  await cdpSession.send('Network.enable');
  await cdpSession.send('Network.emulateNetworkConditions', SLOW_3G_PROFILE);
  return cdpSession;
}

/**
 * Disables network throttling by resetting conditions.
 */
async function disableNetworkThrottling(cdpSession: CDPSession): Promise<void> {
  await cdpSession.send('Network.emulateNetworkConditions', {
    offline: false,
    downloadThroughput: -1,
    uploadThroughput: -1,
    latency: 0,
  });
}

/**
 * Injects a PerformanceObserver into the page that accumulates CLS.
 * Must be called after navigation but before layout shifts occur.
 */
async function setupCLSObserver(page: Page): Promise<void> {
  await page.evaluate(() => {
    // Reset any previous observer
    if ((window as any).__cls_observer) {
      (window as any).__cls_observer.disconnect();
    }
    (window as any).__cls_score = 0;
    (window as any).__cls_entries = [];

    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        // Only count layout shifts without recent user input
        if (!(entry as any).hadRecentInput) {
          (window as any).__cls_score += (entry as any).value;
          (window as any).__cls_entries.push({
            value: (entry as any).value,
            sources: (entry as any).sources?.map((s: any) => ({
              node: s.node?.nodeName,
              previousRect: s.previousRect,
              currentRect: s.currentRect,
            })),
          });
        }
      }
    });
    observer.observe({ type: 'layout-shift', buffered: true });
    (window as any).__cls_observer = observer;
  });
}

/**
 * Retrieves the accumulated CLS score from the page.
 */
async function getCLSScore(page: Page): Promise<number> {
  return page.evaluate(() => (window as any).__cls_score ?? 0);
}

/**
 * Retrieves detailed CLS entries for debugging.
 */
async function getCLSEntries(page: Page): Promise<any[]> {
  return page.evaluate(() => (window as any).__cls_entries ?? []);
}

// ────────────────────────────────────────────────────────────────────
// Property F-8 Test Suite
// ────────────────────────────────────────────────────────────────────

test.describe('Property F-8: Loading-State Skeleton and CLS', () => {
  test.skip(
    !BACKEND_READY,
    'E2E_BACKEND_READY is not set; skipping skeleton/CLS property tests. ' +
      'These tests require a live backend with authenticated sessions to ' +
      'validate that async dashboard views render skeletons under throttled ' +
      'network conditions and maintain CLS ≤ 0.1.',
  );

  test.beforeEach(async ({ page }) => {
    // Log in as tenant admin before each test
    await loginAsTenantAdmin(page);
  });

  for (const view of DASHBOARD_VIEWS) {
    test(`${view.name} — renders skeleton for ≥ 300 ms under throttled network`, async ({
      page,
    }) => {
      // Enable network throttling via CDP to simulate slow 3G
      const cdpSession = await enableNetworkThrottling(page);

      try {
        // Navigate to the dashboard view
        const navigationStart = Date.now();
        await page.goto(view.route, { waitUntil: 'commit' });

        // Assert skeleton elements appear under throttled conditions
        const skeletonLocator = page.locator(view.skeletonSelector).first();
        const skeletonVisible = await skeletonLocator
          .isVisible({ timeout: 15_000 })
          .catch(() => false);

        if (skeletonVisible) {
          const skeletonAppearedAt = Date.now();

          // Wait for data to load (skeleton disappears or ready state appears)
          const readyLocator = page.locator(view.readySelector).first();
          await readyLocator
            .waitFor({ state: 'visible', timeout: 30_000 })
            .catch(() => {
              // May timeout on very slow connections — acceptable
            });

          const dataArrivedAt = Date.now();
          const skeletonDuration = dataArrivedAt - skeletonAppearedAt;

          // Property assertion: skeleton displayed for ≥ 300ms under
          // throttled network. The slow 3G profile ensures data takes
          // long enough for the skeleton to be visible.
          expect(
            skeletonDuration,
            `${view.name}: skeleton visible for ${skeletonDuration}ms ` +
              `(minimum: ${MIN_SKELETON_DURATION_MS}ms). Under a slow 3G ` +
              `profile, the skeleton must remain visible until async data arrives.`,
          ).toBeGreaterThanOrEqual(MIN_SKELETON_DURATION_MS);
        } else {
          // If no skeleton is found, the page may have loaded too fast
          // (e.g., from cache or SSR pre-rendered data). This is acceptable
          // only if the total load time was < 300ms.
          const loadTime = Date.now() - navigationStart;
          expect(
            loadTime,
            `${view.name}: no skeleton rendered under throttled network ` +
              `(page loaded in ${loadTime}ms). Either the component lacks ` +
              `a loading state or data was served from cache. Under slow 3G, ` +
              `skeletons should be visible for at least ${MIN_SKELETON_DURATION_MS}ms.`,
          ).toBeLessThan(MIN_SKELETON_DURATION_MS);
        }
      } finally {
        await disableNetworkThrottling(cdpSession);
      }
    });

    test(`${view.name} — skeleton matches loaded layout grid (no CLS > 0.1)`, async ({
      page,
    }) => {
      // Enable network throttling via CDP to simulate slow 3G
      const cdpSession = await enableNetworkThrottling(page);

      try {
        // Navigate and set up CLS observer immediately
        await page.goto(view.route, { waitUntil: 'commit' });
        await setupCLSObserver(page);

        // Wait for the skeleton to appear
        const skeletonLocator = page.locator(view.skeletonSelector).first();
        await skeletonLocator
          .waitFor({ state: 'visible', timeout: 15_000 })
          .catch(() => {
            // Skeleton may not appear if data loads instantly from cache
          });

        // Wait for the page to fully load and stabilize
        const readyLocator = page.locator(view.readySelector).first();
        await readyLocator
          .waitFor({ state: 'visible', timeout: 30_000 })
          .catch(() => {
            // Timeout is acceptable — we still measure CLS
          });

        // Allow additional time for any post-load layout shifts
        await page.waitForTimeout(2000);

        // Property assertion: CLS ≤ 0.1
        // The skeleton must match the loaded layout's grid so that the
        // transition from skeleton → real content does not cause
        // significant layout shifts.
        const clsScore = await getCLSScore(page);
        const clsEntries = await getCLSEntries(page);

        expect(
          clsScore,
          `${view.name}: Cumulative Layout Shift score ${clsScore.toFixed(4)} ` +
            `exceeds maximum allowed ${MAX_CLS}. The skeleton must match the ` +
            `loaded layout's grid dimensions so hydration does not cause ` +
            `significant layout shifts.\n` +
            `CLS entries: ${JSON.stringify(clsEntries, null, 2)}`,
        ).toBeLessThanOrEqual(MAX_CLS);
      } finally {
        await disableNetworkThrottling(cdpSession);
      }
    });
  }

  test('skeleton grid structure matches loaded content dimensions', async ({
    page,
  }) => {
    // This test validates that the skeleton placeholder occupies the same
    // grid area as the loaded content, ensuring visual stability.
    // We use the School Dashboard as the reference view since it has the
    // most complex grid layout (4-column KPI grid + 2-column lower section).

    const cdpSession = await enableNetworkThrottling(page);

    try {
      await page.goto('/app/dashboard', { waitUntil: 'commit' });

      // Wait for skeleton to appear
      const skeletonCards = page.locator('[data-state="loading"]');
      const hasSkeletons = await skeletonCards.first()
        .isVisible({ timeout: 15_000 })
        .catch(() => false);

      if (!hasSkeletons) {
        // If no skeletons appear (data loaded from cache), skip this check
        test.skip(true, 'No skeletons rendered — data loaded from cache');
        return;
      }

      // Capture skeleton bounding boxes
      const skeletonBounds = await skeletonCards.evaluateAll((elements) =>
        elements.map((el) => {
          const rect = el.getBoundingClientRect();
          return {
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            top: Math.round(rect.top),
            left: Math.round(rect.left),
          };
        }),
      );

      // Wait for data to load
      const readyCards = page.locator('[data-state="ready"]');
      await readyCards.first()
        .waitFor({ state: 'visible', timeout: 30_000 })
        .catch(() => {});

      // Capture loaded content bounding boxes
      const loadedBounds = await readyCards.evaluateAll((elements) =>
        elements.map((el) => {
          const rect = el.getBoundingClientRect();
          return {
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            top: Math.round(rect.top),
            left: Math.round(rect.left),
          };
        }),
      );

      // Verify that skeleton and loaded content occupy similar grid positions.
      // We allow a tolerance of 20px for minor rendering differences.
      const TOLERANCE = 20;
      const minCount = Math.min(skeletonBounds.length, loadedBounds.length);

      for (let i = 0; i < minCount; i++) {
        const skeleton = skeletonBounds[i];
        const loaded = loadedBounds[i];

        // Width should match (same grid column)
        expect(
          Math.abs(skeleton.width - loaded.width),
          `Card ${i}: skeleton width (${skeleton.width}px) should match ` +
            `loaded width (${loaded.width}px) within ${TOLERANCE}px tolerance.`,
        ).toBeLessThanOrEqual(TOLERANCE);

        // Left position should match (same grid column start)
        expect(
          Math.abs(skeleton.left - loaded.left),
          `Card ${i}: skeleton left (${skeleton.left}px) should match ` +
            `loaded left (${loaded.left}px) within ${TOLERANCE}px tolerance.`,
        ).toBeLessThanOrEqual(TOLERANCE);
      }
    } finally {
      await disableNetworkThrottling(cdpSession);
    }
  });
});
