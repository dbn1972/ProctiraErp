/**
 * Volume 12 §3 (test environment matrix) and §5 (responsive and layout testing).
 *
 * ## What was missing
 *
 * Volume 12 §5 enumerates seven named *responsive failure classes* — hidden critical
 * actions, overlapping controls, off-screen modals, unusable table content, clipped
 * validation messages, broken primary CTA visibility, unsafe destructive action placement
 * — and §13 makes "responsive smoke coverage passed" a release exit criterion. Before
 * this spec the repository automated none of them. Three files touched a viewport at all:
 * `24-visual-regression.spec.ts` pins 1280×720 so screenshots match baselines,
 * `a11y-axe.spec.ts` runs one scan at 390×844, and `touch-target-minimum.spec.ts` checks
 * hit-box sizes at 390×844. None asserts that a layout survives a width change, and all
 * three of the sizes involved are phone-or-desktop — nothing between 390px and 1280px
 * was ever rendered by a test.
 *
 * ## Why the viewport sweep lives inside the test and not in projects
 *
 * §3.1 names seven viewport classes. Seven Playwright projects would multiply all ~75
 * specs in this directory by seven. Driving `browser.newContext({ viewport })` inside one
 * test keeps the whole sweep at the cost of a single spec, which is what makes it
 * affordable as a per-pull-request gate rather than a weekly cron.
 *
 * §3.2's device classes are the exception: a device's user agent, device-scale factor and
 * touch flags can only come from a project, so `qa-matrix.ts` registers four of them with
 * a `testMatch` narrowed to this file.
 *
 * ## No backend required
 *
 * Every route here is anonymous-reachable, so this spec is a real gate instead of a
 * `test.skip` that reads as coverage. That is also the reason the route list is short:
 * authenticated and table-heavy surfaces are the ones most likely to overflow, and they
 * need `E2E_BACKEND_READY`. Extending the sweep to them is tracked, not claimed.
 */

import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';

import { BROWSER_CLASSES, DEVICE_CLASSES, VIEWPORT_CLASSES, findProject } from './qa-matrix';

/** Sub-pixel layout rounding; a fractional overhang is not a defect. */
const OVERFLOW_TOLERANCE_PX = 2;

/**
 * The project that owns the once-only blocks. Every project registered in `qa-matrix.ts`
 * matches this file — the device-class projects match nothing else — so the matrix
 * assertions and the viewport sweep have to name one project or they run five times over.
 */
const SWEEP_PROJECT = 'chromium';

function skipUnlessSweepProject(testInfo: TestInfo, reason: string): void {
  test.skip(testInfo.project.name !== SWEEP_PROJECT, reason);
}

interface ResponsiveRoute {
  path: string;
  label: string;
  /** Resolves once the screen has painted enough to measure. */
  ready: (page: Page) => Promise<void>;
  /**
   * The screen's primary call to action. Omitted for read-only documents, which have
   * none — §5's CTA failure class does not apply to them.
   */
  primaryCta?: (page: Page) => Locator;
}

const ROUTES: readonly ResponsiveRoute[] = [
  {
    path: '/login',
    label: 'login',
    ready: async (page) => {
      await expect(page.locator('form button[type="submit"]').first()).toBeVisible();
    },
    primaryCta: (page) => page.locator('form button[type="submit"]').first(),
  },
  {
    path: '/signup',
    label: 'signup',
    ready: async (page) => {
      await expect(page.locator('form button[type="submit"]').first()).toBeVisible();
    },
    primaryCta: (page) => page.locator('form button[type="submit"]').first(),
  },
  {
    path: '/forgot-password',
    label: 'forgot-password',
    ready: async (page) => {
      await expect(page.locator('form button[type="submit"]').first()).toBeVisible();
    },
    primaryCta: (page) => page.locator('form button[type="submit"]').first(),
  },
  {
    // A long prose document: the text-wrapping and truncation half of §5, and the one
    // page where a horizontally scrolled paragraph is unambiguously a defect.
    path: '/legal/privacy',
    label: 'legal-privacy',
    ready: async (page) => {
      await expect(page.getByTestId('legal-privacy-page')).toBeVisible();
    },
  },
] as const;

// ─── Measurement ─────────────────────────────────────────────────────────────

interface OverflowFinding {
  selector: string;
  text: string;
  left: number;
  right: number;
}

interface LayoutMeasurement {
  /** The width the browser context was configured with — the device width. */
  deviceWidth: number;
  /** `window.innerWidth`. Under mobile emulation this is the *layout* viewport. */
  layoutViewportWidth: number;
  documentScrollWidth: number;
  escapees: OverflowFinding[];
}

/**
 * Measure horizontal containment against the **configured device width**, not
 * `window.innerWidth`.
 *
 * This distinction was found by a negative control, and it matters. With
 * `isMobile: true` and `width=device-width`, Chromium shrinks to fit when content is
 * wider than the device: injecting a 3000px block into a 393px context made
 * `window.innerWidth` report **1572**. Comparing `scrollWidth` against `innerWidth` would
 * therefore have passed for any overflow the layout viewport managed to absorb. The
 * configured width is the only stable reference, and the expansion itself is reported as
 * its own finding.
 *
 * The element-level rule carries the rest of the value: an element wider than the device
 * is only a defect when nothing between it and `<body>` can scroll. A data table inside
 * `overflow-x: auto` is the *correct* degradation for §4.1 ("tables degrade
 * appropriately"), so flagging it would train people to ignore this test.
 */
async function measureLayout(page: Page): Promise<LayoutMeasurement> {
  const configured = page.viewportSize();
  if (!configured) {
    throw new Error('measureLayout requires a fixed viewport; this page has none.');
  }

  const measured = await page.evaluate(
    ({ tolerance, deviceWidth }) => {
      const describe = (el: Element): string => {
        const tag = el.tagName.toLowerCase();
        const id = el.id ? `#${el.id}` : '';
        const cls =
          typeof el.className === 'string' && el.className.trim()
            ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.')
            : '';
        return `${tag}${id}${cls}`;
      };

      const hasScrollableAncestor = (el: Element): boolean => {
        let node: Element | null = el.parentElement;
        while (node && node !== document.documentElement) {
          const { overflowX } = window.getComputedStyle(node);
          if (overflowX === 'auto' || overflowX === 'scroll' || overflowX === 'hidden') {
            return true;
          }
          node = node.parentElement;
        }
        return false;
      };

      const escapees: {
        selector: string;
        text: string;
        left: number;
        right: number;
      }[] = [];

      for (const el of Array.from(document.body.querySelectorAll('*'))) {
        if (el.getClientRects().length === 0) continue;

        const style = window.getComputedStyle(el);
        if (style.visibility === 'hidden' || style.display === 'none') continue;
        if (Number(style.opacity) === 0) continue;
        // Fixed/absolute off-canvas drawers are positioned out of view by design; they
        // become §5 findings only once opened, which needs interaction this spec does not
        // perform. Measuring them closed would be noise.
        if (style.position === 'fixed' || style.position === 'absolute') continue;

        const rect = el.getBoundingClientRect();
        // Screen-reader-only clips collapse to a 1px box.
        if (rect.width <= 1 && rect.height <= 1) continue;
        if (hasScrollableAncestor(el)) continue;

        if (rect.right > deviceWidth + tolerance || rect.left < -tolerance) {
          escapees.push({
            selector: describe(el),
            text: (el.textContent ?? '').trim().slice(0, 60),
            left: Math.round(rect.left),
            right: Math.round(rect.right),
          });
        }
      }

      return {
        layoutViewportWidth: window.innerWidth,
        documentScrollWidth: document.documentElement.scrollWidth,
        // Report the outermost offenders only: one overflowing container drags every
        // descendant with it, and the container is the fix site.
        escapees: escapees.slice(0, 8),
      };
    },
    { tolerance: OVERFLOW_TOLERANCE_PX, deviceWidth: configured.width },
  );

  return { deviceWidth: configured.width, ...measured };
}

/**
 * Assert the primary CTA is reachable: visible, fully inside the viewport horizontally,
 * and topmost at its own centre.
 *
 * The occlusion arm is what catches §5's "overlapping controls" and the sticky-header
 * case in §4.1 ("fixed headers/footers do not block key actions") — a control can pass
 * `toBeVisible()` while a sticky bar sits on top of it, because Playwright's visibility
 * check does not consider paint order.
 */
async function assertPrimaryCtaReachable(page: Page, cta: Locator, context: string): Promise<void> {
  await expect(cta, `${context}: primary CTA is not visible`).toBeVisible();
  await cta.scrollIntoViewIfNeeded();

  const box = await cta.boundingBox();
  expect(box, `${context}: primary CTA has no layout box`).not.toBeNull();
  if (!box) return;

  // Configured device width, not `window.innerWidth` — see `measureLayout`.
  const deviceWidth = page.viewportSize()?.width ?? 0;
  expect(
    box.x >= -OVERFLOW_TOLERANCE_PX,
    `${context}: primary CTA starts off the left edge (x=${Math.round(box.x)})`,
  ).toBe(true);
  expect(
    box.x + box.width <= deviceWidth + OVERFLOW_TOLERANCE_PX,
    `${context}: primary CTA extends past the right edge ` +
      `(right=${Math.round(box.x + box.width)}, device=${deviceWidth})`,
  ).toBe(true);

  const occluder = await cta.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    if (!hit) return 'nothing (point is outside the viewport)';
    if (hit === el || el.contains(hit) || hit.contains(el)) return null;
    const tag = hit.tagName.toLowerCase();
    const cls =
      typeof hit.className === 'string' && hit.className.trim()
        ? '.' + hit.className.trim().split(/\s+/).slice(0, 2).join('.')
        : '';
    return `${tag}${hit.id ? `#${hit.id}` : ''}${cls}`;
  });
  expect(occluder, `${context}: primary CTA is covered by ${occluder}`).toBeNull();
}

async function assertHorizontallyContained(page: Page, context: string): Promise<void> {
  const measurement = await measureLayout(page);

  // Shrink-to-fit: the layout viewport growing past the device width is itself the
  // symptom that content does not fit, and it is the arm that keeps the scrollWidth
  // comparison below honest under mobile emulation.
  expect(
    measurement.layoutViewportWidth <= measurement.deviceWidth + OVERFLOW_TOLERANCE_PX,
    `${context}: the layout viewport expanded past the device width — content forced a ` +
      `shrink-to-fit (innerWidth=${measurement.layoutViewportWidth}, device=${measurement.deviceWidth})`,
  ).toBe(true);

  expect(
    measurement.documentScrollWidth <= measurement.deviceWidth + OVERFLOW_TOLERANCE_PX,
    `${context}: document scrolls horizontally ` +
      `(scrollWidth=${measurement.documentScrollWidth}, device=${measurement.deviceWidth})`,
  ).toBe(true);

  expect(
    measurement.escapees,
    `${context}: ${measurement.escapees.length} element(s) extend outside the ` +
      `${measurement.deviceWidth}px device width with no scrollable ancestor:\n` +
      measurement.escapees
        .map((e) => `  • ${e.selector} [${e.left}…${e.right}px] "${e.text}"`)
        .join('\n'),
  ).toEqual([]);
}

async function visit(page: Page, route: ResponsiveRoute): Promise<boolean> {
  const response = await page.goto(route.path, { waitUntil: 'domcontentloaded' });
  if (!response || response.status() >= 400) return false;
  if (new URL(page.url()).pathname !== route.path) return false;
  await route.ready(page);
  return true;
}

// ─── §3 — the matrix is complete and selects the engines it claims ────────────

test.describe('Volume 12 §3 — test environment matrix conformance', () => {
  // The matrix is global, not per-project: asserting it once avoids repeating the same
  // failure on every registered project.
  test('every §3.1 viewport class is declared and distinct', async ({}, testInfo) => {
    skipUnlessSweepProject(testInfo, 'Matrix conformance is asserted once, under chromium.');

    const expected = [
      'mobile-portrait',
      'mobile-landscape',
      'small-tablet',
      'large-tablet',
      'laptop',
      'desktop',
      'large-desktop',
    ];
    expect(VIEWPORT_CLASSES.map((v) => v.id)).toEqual(expected);

    // Distinct widths, or two "classes" are one class with two names.
    const widths = VIEWPORT_CLASSES.map((v) => v.viewport.width);
    expect(new Set(widths).size, `viewport widths are not distinct: ${widths.join(', ')}`).toBe(
      widths.length,
    );
  });

  test('every §3.2 device class resolves to a registered project', async ({}, testInfo) => {
    skipUnlessSweepProject(testInfo, 'Matrix conformance is asserted once, under chromium.');

    for (const deviceClass of DEVICE_CLASSES) {
      expect(
        findProject(deviceClass.project),
        `§3.2 "${deviceClass.label}" names project "${deviceClass.project}", which is not declared in qa-matrix.ts`,
      ).toBeDefined();
    }
    expect(DEVICE_CLASSES).toHaveLength(7);
  });

  test('every §3.3 browser class resolves to a project that launches that browser', async ({}, testInfo) => {
    skipUnlessSweepProject(testInfo, 'Matrix conformance is asserted once, under chromium.');

    expect(BROWSER_CLASSES.map((b) => b.id)).toEqual(['chrome', 'edge', 'safari', 'firefox']);

    for (const browserClass of BROWSER_CLASSES) {
      const project = findProject(browserClass.project);
      expect(
        project,
        `§3.3 "${browserClass.label}" names project "${browserClass.project}", which is not declared in qa-matrix.ts`,
      ).toBeDefined();

      const use = (project?.use ?? {}) as {
        browserName?: string;
        defaultBrowserType?: string;
        channel?: string;
      };
      // Device presets carry `defaultBrowserType`; an explicit `browserName` overrides it
      // (which is how `tablet` pins the webkit-defaulted iPad preset to Chromium).
      const engine = use.browserName ?? use.defaultBrowserType ?? 'chromium';
      expect(
        engine,
        `§3.3 "${browserClass.label}" must launch ${browserClass.browserName}, project "${browserClass.project}" launches ${engine}`,
      ).toBe(browserClass.browserName);

      // The arm that catches the original defect. `devices['Desktop Edge']` sets an Edge
      // user-agent string and still launches bundled Chromium, so a project claiming
      // Edge without `channel: 'msedge'` tests Chrome twice.
      if (browserClass.channel) {
        expect(
          use.channel,
          `§3.3 "${browserClass.label}" needs channel "${browserClass.channel}" — a Chromium build with an Edge user agent is not Edge`,
        ).toBe(browserClass.channel);
      }
    }
  });
});

// ─── §5 — responsive layout regression across every §3.1 viewport class ──────

test.describe('Volume 12 §5 — responsive layout across viewport classes', () => {
  for (const viewportClass of VIEWPORT_CLASSES) {
    test(`${viewportClass.label} (${viewportClass.viewport.width}×${viewportClass.viewport.height})`, async ({
      browser,
    }, testInfo) => {
      // One project drives the sweep. `isMobile` is Chromium-only, and re-running the same
      // seven widths under `tablet` and `mobile-chrome` would multiply the cost to
      // re-prove an axis those projects do not vary.
      skipUnlessSweepProject(
        testInfo,
        'The viewport sweep runs under chromium; device presets are covered by the §3.2 block.',
      );
      // Four routes at one width, and `next dev` compiles each route on first visit.
      testInfo.setTimeout(Math.max(testInfo.timeout * 2, 120_000));

      const context = await browser.newContext({
        viewport: viewportClass.viewport,
        isMobile: viewportClass.isMobile,
        hasTouch: viewportClass.hasTouch,
      });
      const page = await context.newPage();

      try {
        for (const route of ROUTES) {
          const label = `${route.path} @ ${viewportClass.label}`;
          if (!(await visit(page, route))) {
            // A route absent from this build is not a responsive defect. Recorded so a
            // silently shrinking route list is visible in the report.
            testInfo.annotations.push({ type: 'route-unavailable', description: route.path });
            continue;
          }

          await assertHorizontallyContained(page, label);

          if (route.primaryCta) {
            await assertPrimaryCtaReachable(page, route.primaryCta(page), label);
          }
        }
      } finally {
        await context.close();
      }
    });
  }

  test('validation messages stay inside the viewport on the narrowest class', async ({
    browser,
  }, testInfo) => {
    skipUnlessSweepProject(testInfo, 'Runs once, under chromium.');

    // §5's "clipped validation messages" failure class. `/signup` is the only anonymous
    // form with `noValidate` plus rendered error nodes — `/login` relies on native
    // `required`, whose bubble is not in the DOM and cannot be measured.
    const narrowest = VIEWPORT_CLASSES.reduce((a, b) =>
      a.viewport.width <= b.viewport.width ? a : b,
    );
    const context = await browser.newContext({
      viewport: narrowest.viewport,
      isMobile: narrowest.isMobile,
      hasTouch: narrowest.hasTouch,
    });
    const page = await context.newPage();

    try {
      const signup = ROUTES.find((route) => route.path === '/signup');
      expect(signup, '/signup is missing from the route list').toBeDefined();
      if (!signup || !(await visit(page, signup))) {
        test.skip(true, '/signup is not enabled in this build');
        return;
      }

      // The form is server-rendered, so the button is clickable before React attaches
      // `onSubmit`. A pre-hydration click on a `noValidate` form with no `action`
      // submits nothing and renders no message — the failure looks like a missing
      // validator. Wait for the repository's hydration marker instead.
      await expect(page.getByTestId('signup-form')).toHaveAttribute('data-hydrated', 'true');
      await page.locator('form button[type="submit"]').first().click();

      const errors = page.locator('[data-testid^="signup-"][data-testid$="-error"]');
      await expect(
        errors.first(),
        'submitting the empty signup form produced no rendered validation message',
      ).toBeVisible();

      const count = await errors.count();
      const viewportWidth = narrowest.viewport.width;
      for (let index = 0; index < count; index += 1) {
        const error = errors.nth(index);
        const testId = await error.getAttribute('data-testid');
        const box = await error.boundingBox();
        if (!box) continue;
        expect(
          box.x >= -OVERFLOW_TOLERANCE_PX &&
            box.x + box.width <= viewportWidth + OVERFLOW_TOLERANCE_PX,
          `validation message ${testId} is clipped at ${narrowest.label}: ` +
            `[${Math.round(box.x)}…${Math.round(box.x + box.width)}px] in a ${viewportWidth}px viewport`,
        ).toBe(true);
      }

      await assertHorizontallyContained(page, `/signup (invalid) @ ${narrowest.label}`);
    } finally {
      await context.close();
    }
  });
});

// ─── §3.2 — the device presets themselves ────────────────────────────────────

test.describe('Volume 12 §3.2 — device-class layout', () => {
  // Runs under whichever project is active, using that project's own device preset. This
  // is the block the `tablet-android`, `desktop` and `desktop-large` projects exist to
  // run (see the `testMatch` in qa-matrix.ts), and it also gives `mobile-chrome` and
  // `tablet` a layout assertion they did not have.
  for (const route of ROUTES) {
    test(`${route.label} holds its layout`, async ({ page }, testInfo) => {
      const label = `${route.path} @ project ${testInfo.project.name}`;
      if (!(await visit(page, route))) {
        test.skip(true, `${route.path} is not enabled in this build`);
        return;
      }

      await assertHorizontallyContained(page, label);

      if (route.primaryCta) {
        await assertPrimaryCtaReachable(page, route.primaryCta(page), label);
      }
    });
  }
});
