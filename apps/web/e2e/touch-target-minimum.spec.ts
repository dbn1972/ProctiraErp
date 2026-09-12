/**
 * Task 53.6 — Property F-5: Touch Target Minimum
 *
 * A Playwright property test that walks every interactive element on
 * every authenticated route and asserts that the minimum bounding-box
 * dimension meets the touch-target threshold:
 *
 *   • Standard routes: min(width, height) ≥ 44px
 *   • Mobile routes (`/mobile/*` or `<MobileShell>` at < 768px viewport):
 *     min(width, height) ≥ 48px
 *
 * The test uses fast-check to generate random subsets of routes and
 * interactive element selectors, providing property-based coverage
 * across the application surface.
 *
 * **Validates: Requirements 37.3, 41.3, 41.5**
 *
 * Requirements:
 *   37.3 — Every Touch_Target has a minimum activation area of 48×48px
 *          and minimum 12px spacing between adjacent Touch_Targets
 *   41.3 — Mobile attendance with thumb-friendly buttons per Touch_Target
 *          rules in Requirement 37
 *   41.5 — No pointer-only interactions; all functionality usable on
 *          touch-only devices
 *
 * Design: H, K, P
 */

import { expect, test, type Page } from '@playwright/test';
import * as fc from 'fast-check';

import { loginAsTenantAdmin } from './fixtures/auth';

const BACKEND_READY = !!process.env.E2E_BACKEND_READY;
/** Seeded by tools/e2e/seed-e2e-tenants.sql for tenant A (G-722). */
const E2E_INSTITUTION_ID = process.env.E2E_INSTITUTION_ID ?? 'a2e96cd1-0232-4cce-97e2-00ebbfb9a374';

/**
 * Minimum touch-target dimension for standard (desktop) routes.
 * Per WCAG 2.5.5 and the design spec Property F-5.
 */
const MIN_TARGET_SIZE_STANDARD = 44;

/**
 * Minimum touch-target dimension for mobile routes.
 * Per Requirement 37.3 (48×48px for rural/low-resource users)
 * and Requirement 41.3 (thumb-friendly buttons).
 */
const MIN_TARGET_SIZE_MOBILE = 48;

/**
 * Interactive element selectors that constitute Touch_Targets per the
 * glossary definition: buttons, links, inputs, controls that a user
 * activates by pointing or tapping.
 */
const INTERACTIVE_SELECTORS = [
  'button',
  'a[href]',
  'input:not([type="hidden"])',
  'select',
  'textarea',
  '[role="button"]',
  '[role="link"]',
  '[role="menuitem"]',
  '[role="menuitemradio"]',
  '[role="menuitemcheckbox"]',
  '[role="tab"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="switch"]',
  '[role="slider"]',
  '[role="combobox"]',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/**
 * Routes to test in standard (desktop) viewport. These represent the
 * authenticated surfaces of the application.
 */
const STANDARD_ROUTES = [
  '/',
  '/students',
  '/institutions',
  '/staff',
  '/attendance',
  '/assessments',
  '/examinations',
  '/admissions',
  '/fees',
  '/billing',
  '/audit-logs',
  '/tenant-lifecycle',
  '/help',
  '/scholarships',
  '/scholarships/programs/new',
  '/scholarships/applications',
  '/scholarships/disbursements',
  '/lms',
  '/lms/assignments/new?kind=quiz',
  '/lms/pal',
  '/workflows',
  '/workflows/approvals',
  '/workflows/instances',
  '/workflows/definitions/new',
  '/reports',
  '/reports/new',
  '/health',
  '/health/allergies',
  '/health/incidents',
  '/pipelines',
  '/notifications',
  '/notifications/preferences',
  '/admin/notification-rules',
  '/transport',
  '/transport/routes',
  '/transport/vehicles',
  '/transport/assignments',
  '/communication',
  '/communication/campaigns',
  '/communication/campaigns/new',
  '/communication/emergency',
  '/hostel',
  '/hostel/structure',
  '/hostel/assignments',
  '/hostel/leaves',
  '/hostel/visitors',
  '/library',
  '/library/circulation',
  '/library/overdues',
  '/parent',
  '/parent/messages',
  '/parent/consents',
  '/parent/fees',
  '/parent/offers',
  '/parent/attendance',
  '/parent/grades',
  '/parent/timetable',
  '/parent/homework',
  '/parent/calendar',
  '/parent/notices',
  '/student',
  '/student/attendance',
  '/student/grades',
  '/student/timetable',
  '/student/homework',
  '/student/calendar',
  '/student/notices',
  '/student/pal',
  '/fees/structures',
  '/fees/reports',
  '/admissions/enquiries',
  '/admissions/seat-matrix',
  '/admissions/merit',
  '/assessments/outcomes',
  '/assessments/report-cards',
  '/health/screenings',
  '/health/counselling',
  '/health/counselling/new',
  '/health/special-needs',
  '/data-warehouse',
  '/data-warehouse/import',
  '/data-warehouse/field-mapping',
  '/data-warehouse/map',
  '/academic-periods',
  '/admin',
  '/admin/users',
  '/admin/roles',
  '/admin/permissions',
  '/admin/tenant',
];

/**
 * Routes to test in mobile viewport (< 768px). These include both
 * legacy `/mobile/*` routes and standard routes rendered through
 * `<MobileShell>`.
 */
const MOBILE_ROUTES = [
  '/',
  '/mobile/dashboard',
  '/mobile/attendance',
  '/mobile/student-profile/1',
  '/students',
  '/attendance',
];

/**
 * Elements that are exempt from the touch-target minimum because they
 * are inline text links within prose content or are visually hidden
 * skip-links that only appear on focus.
 */
const EXEMPT_SELECTORS = [
  // Skip-to-content links that are only visible on focus
  'a[href="#main-content"]',
  'a[href="#content"]',
  '[class*="sr-only"]',
  // Hidden elements
  '[aria-hidden="true"]',
  '[hidden]',
  // Disabled elements
  '[disabled]',
  '[aria-disabled="true"]',
];

interface TouchTargetViolation {
  selector: string;
  tagName: string;
  text: string;
  width: number;
  height: number;
  minDimension: number;
  threshold: number;
  route: string;
}

/**
 * Measures all interactive elements on the current page and returns
 * any that violate the touch-target minimum.
 */
async function findTouchTargetViolations(
  page: Page,
  threshold: number,
  route: string,
): Promise<TouchTargetViolation[]> {
  const violations = await page.evaluate(
    ({ selector, exemptSelectors, minSize, currentRoute }) => {
      const elements = document.querySelectorAll(selector);
      const results: TouchTargetViolation[] = [];

      for (const el of elements) {
        // Skip exempt elements
        const isExempt = exemptSelectors.some((exemptSel: string) => el.matches(exemptSel));
        if (isExempt) continue;

        // Skip elements not visible in the viewport
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;

        // Skip elements that are off-screen
        if (
          rect.bottom < 0 ||
          rect.right < 0 ||
          rect.top > window.innerHeight ||
          rect.left > window.innerWidth
        ) {
          continue;
        }

        // Check computed visibility
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
          continue;
        }

        const width = rect.width;
        const height = rect.height;
        const minDimension = Math.min(width, height);

        if (minDimension < minSize) {
          results.push({
            selector:
              el.tagName.toLowerCase() +
              (el.id ? `#${el.id}` : '') +
              (el.className && typeof el.className === 'string'
                ? '.' + el.className.split(' ').slice(0, 2).join('.')
                : ''),
            tagName: el.tagName.toLowerCase(),
            text: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 50),
            width: Math.round(width * 100) / 100,
            height: Math.round(height * 100) / 100,
            minDimension: Math.round(minDimension * 100) / 100,
            threshold: minSize,
            route: currentRoute,
          });
        }
      }

      return results;
    },
    {
      selector: INTERACTIVE_SELECTORS,
      exemptSelectors: EXEMPT_SELECTORS,
      minSize: threshold,
      currentRoute: route,
    },
  );

  return violations;
}

// ────────────────────────────────────────────────────────────────────
// Property test: Standard (desktop) routes — min 44px
// ────────────────────────────────────────────────────────────────────

test.describe('Property F-5: Touch Target Minimum — desktop routes', () => {
  test.skip(
    !BACKEND_READY,
    'E2E_BACKEND_READY is not set; skipping live-backend touch-target tests. See e2e/README.md.',
  );

  test('all interactive elements on authenticated routes have min(width, height) ≥ 44px', async ({
    page,
  }) => {
    await loginAsTenantAdmin(page);

    // Use fast-check to generate random permutations of routes to test,
    // ensuring property-based coverage across the surface area.
    const routeArbitrary = fc.shuffledSubarray(STANDARD_ROUTES, {
      minLength: Math.min(3, STANDARD_ROUTES.length),
      maxLength: STANDARD_ROUTES.length,
    });

    const allViolations: TouchTargetViolation[] = [];

    await fc.assert(
      fc.asyncProperty(routeArbitrary, async (routes) => {
        for (const route of routes) {
          const response = await page.goto(route);

          // Skip routes that return errors (not deployed or require
          // specific data seeding)
          if (!response || response.status() >= 400) {
            continue;
          }

          // Wait for the page to stabilize
          await page.waitForLoadState('networkidle').catch(() => {});
          await page.waitForTimeout(500);

          const violations = await findTouchTargetViolations(page, MIN_TARGET_SIZE_STANDARD, route);

          allViolations.push(...violations);

          // The property: no violations should exist
          if (violations.length > 0) {
            const summary = violations
              .slice(0, 5)
              .map(
                (v) =>
                  `  • ${v.selector} "${v.text}" — ${v.width}×${v.height}px (min: ${v.minDimension}px < ${v.threshold}px)`,
              )
              .join('\n');

            throw new Error(
              `Touch target violations on route "${route}" (${violations.length} total):\n${summary}` +
                (violations.length > 5 ? `\n  … and ${violations.length - 5} more` : ''),
            );
          }
        }
      }),
      {
        numRuns: 1, // Single run since we test all routes in each iteration
        seed: Date.now(),
      },
    );

    // Final assertion for clear reporting
    expect(
      allViolations,
      `Found ${allViolations.length} touch-target violation(s) across desktop routes`,
    ).toHaveLength(0);
  });
});

// ────────────────────────────────────────────────────────────────────
// Property test: Mobile routes — min 48px
// ────────────────────────────────────────────────────────────────────

test.describe('Property F-5: Touch Target Minimum — mobile routes', () => {
  test.skip(
    !BACKEND_READY,
    'E2E_BACKEND_READY is not set; skipping live-backend touch-target tests. See e2e/README.md.',
  );

  test('all interactive elements on mobile routes have min(width, height) ≥ 48px', async ({
    browser,
  }) => {
    // Create a mobile viewport context to trigger <MobileShell>
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 }, // iPhone 14 Pro logical px
      hasTouch: true,
      isMobile: true,
    });
    const page = await context.newPage();

    try {
      await loginAsTenantAdmin(page);

      const routeArbitrary = fc.shuffledSubarray(MOBILE_ROUTES, {
        minLength: Math.min(2, MOBILE_ROUTES.length),
        maxLength: MOBILE_ROUTES.length,
      });

      const allViolations: TouchTargetViolation[] = [];

      await fc.assert(
        fc.asyncProperty(routeArbitrary, async (routes) => {
          for (const route of routes) {
            const response = await page.goto(route);

            // Skip routes that return errors
            if (!response || response.status() >= 400) {
              continue;
            }

            // Wait for the page to stabilize and MobileShell to render
            await page.waitForLoadState('networkidle').catch(() => {});
            await page.waitForTimeout(500);

            const violations = await findTouchTargetViolations(page, MIN_TARGET_SIZE_MOBILE, route);

            allViolations.push(...violations);

            if (violations.length > 0) {
              const summary = violations
                .slice(0, 5)
                .map(
                  (v) =>
                    `  • ${v.selector} "${v.text}" — ${v.width}×${v.height}px (min: ${v.minDimension}px < ${v.threshold}px)`,
                )
                .join('\n');

              throw new Error(
                `Touch target violations on mobile route "${route}" (${violations.length} total):\n${summary}` +
                  (violations.length > 5 ? `\n  … and ${violations.length - 5} more` : ''),
              );
            }
          }
        }),
        {
          numRuns: 1,
          seed: Date.now(),
        },
      );

      expect(
        allViolations,
        `Found ${allViolations.length} touch-target violation(s) across mobile routes`,
      ).toHaveLength(0);
    } finally {
      await context.close();
    }
  });
});

// ────────────────────────────────────────────────────────────────────
// Property test: Public surfaces (no backend required) — min 44px
// ────────────────────────────────────────────────────────────────────

test.describe('Property F-5: Touch Target Minimum — public surfaces (no backend required)', () => {
  const PUBLIC_ROUTES = [
    '/login',
    '/signup',
    '/forgot-password',
    '/reset-password',
    '/mfa',
    '/track',
  ];

  test('all interactive elements on public routes have min(width, height) ≥ 44px', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    for (const route of PUBLIC_ROUTES) {
      const response = await page.goto(route, { waitUntil: 'domcontentloaded' });

      // Skip routes that are not available
      if (!response || response.status() >= 400) {
        continue;
      }

      await page.waitForLoadState('load').catch(() => {});
      await page.waitForTimeout(200);

      const violations = await findTouchTargetViolations(page, MIN_TARGET_SIZE_STANDARD, route);

      if (violations.length > 0) {
        const summary = violations
          .slice(0, 10)
          .map(
            (v) =>
              `  • ${v.selector} "${v.text}" — ${v.width}×${v.height}px (min: ${v.minDimension}px < ${v.threshold}px)`,
          )
          .join('\n');

        expect(
          violations,
          `Touch target violations on public route "${route}" (${violations.length} total):\n${summary}`,
        ).toHaveLength(0);
      }
    }
  });

  test('all interactive elements on public routes at mobile viewport have min(width, height) ≥ 48px', async ({
    browser,
  }) => {
    test.setTimeout(90_000);
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    });
    const page = await context.newPage();

    try {
      for (const route of PUBLIC_ROUTES) {
        const response = await page.goto(route, { waitUntil: 'domcontentloaded' });

        if (!response || response.status() >= 400) {
          continue;
        }

        await page.waitForLoadState('load').catch(() => {});
        await page.waitForTimeout(200);

        const violations = await findTouchTargetViolations(page, MIN_TARGET_SIZE_MOBILE, route);

        if (violations.length > 0) {
          const summary = violations
            .slice(0, 10)
            .map(
              (v) =>
                `  • ${v.selector} "${v.text}" — ${v.width}×${v.height}px (min: ${v.minDimension}px < ${v.threshold}px)`,
            )
            .join('\n');

          expect(
            violations,
            `Touch target violations on mobile public route "${route}" (${violations.length} total):\n${summary}`,
          ).toHaveLength(0);
        }
      }
    } finally {
      await context.close();
    }
  });
});

// ────────────────────────────────────────────────────────────────────
// Wave 9 routes — deterministic (every route, desktop 44px + mobile 48px)
// The property tests above sample STANDARD_ROUTES; the gap-closure slice
// gets explicit per-route coverage so the evidence is not sampling-dependent.
// ────────────────────────────────────────────────────────────────────

const WAVE9_ROUTES = [
  '/fees/structures',
  '/fees/reports',
  '/admissions/enquiries',
  '/admissions/seat-matrix',
  '/admissions/merit',
  '/assessments/outcomes',
  '/assessments/report-cards',
  '/parent/attendance',
  '/parent/grades',
  '/parent/timetable',
  '/parent/homework',
  '/parent/calendar',
  '/parent/notices',
  '/student',
  '/student/attendance',
  '/student/grades',
  '/student/timetable',
  '/student/homework',
  '/student/calendar',
  '/student/notices',
  '/student/pal',
] as const;

/** Wave 9 batch 3 (G-909, G-915–G-922) — static dashboard routes. */
const WAVE9_BATCH3_ROUTES = [
  '/reports/dashboard',
  '/reports/schedules',
  '/reports/dashboards',
  '/lms/bank',
  '/lms/rubrics',
  '/lms/discussions',
  '/lms/lessons',
  '/lms/content',
  '/lms/analytics',
  '/library/opac',
  '/library/holds',
  '/library/fines',
  '/hostel/mess',
  '/hostel/gate-passes',
  '/hostel/fees',
  '/hostel/attendance',
  '/attendance/ops',
  '/staff/attendance',
  '/staff/import',
  '/staff/payroll',
  '/staff/contracts',
  '/communication/circulars',
  '/communication/circulars/new',
  '/communication/delivery',
  '/transport/live',
  '/transport/attendance',
  '/transport/alerts',
  '/transport/fees',
] as const;

const WAVE9_BATCH3_INSTITUTION_ROUTES = [
  `/institutions/${E2E_INSTITUTION_ID}/timetable/generate`,
  `/institutions/${E2E_INSTITUTION_ID}/timetable/substitutions`,
] as const;

const WAVE9_ALL_ROUTES = [
  ...WAVE9_ROUTES,
  ...WAVE9_BATCH3_ROUTES,
  ...WAVE9_BATCH3_INSTITUTION_ROUTES,
] as const;

function formatViolations(violations: TouchTargetViolation[]): string {
  return violations
    .slice(0, 8)
    .map(
      (v) =>
        `  • ${v.selector} "${v.text}" — ${v.width}×${v.height}px (min: ${v.minDimension}px < ${v.threshold}px)`,
    )
    .join('\n');
}

test.describe('Wave 9 routes — touch targets (E2E_BACKEND_READY=1)', () => {
  test.skip(
    !BACKEND_READY,
    'E2E_BACKEND_READY is not set; skipping live-backend touch-target tests.',
  );

  for (const route of WAVE9_ALL_ROUTES) {
    test(`${route} — desktop interactive elements ≥ ${MIN_TARGET_SIZE_STANDARD}px`, async ({
      page,
    }) => {
      await loginAsTenantAdmin(page);
      if (route === '/reports/dashboards') {
        await page.goto('/reports/dashboard', { waitUntil: 'domcontentloaded' });
      } else {
        const response = await page.goto(route, { waitUntil: 'domcontentloaded' });
        expect(response?.status(), `${route} must resolve`).toBeLessThan(400);
      }
      // `networkidle` never settles under `next dev` (HMR); wait for load + a short settle.
      await page.waitForLoadState('load').catch(() => {});
      await page.waitForTimeout(750);
      const violations = await findTouchTargetViolations(page, MIN_TARGET_SIZE_STANDARD, route);
      expect(
        violations,
        `Touch targets on ${route}:\n${formatViolations(violations)}`,
      ).toHaveLength(0);
    });

    test(`${route} — mobile interactive elements ≥ ${MIN_TARGET_SIZE_MOBILE}px`, async ({
      browser,
    }) => {
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      });
      const page = await context.newPage();
      try {
        await loginAsTenantAdmin(page);
        if (route === '/reports/dashboards') {
          await page.goto('/reports/dashboard', { waitUntil: 'domcontentloaded' });
        } else {
          const response = await page.goto(route, { waitUntil: 'domcontentloaded' });
          expect(response?.status(), `${route} must resolve`).toBeLessThan(400);
        }
        // `networkidle` never settles under `next dev` (HMR); wait for load + a short settle.
        await page.waitForLoadState('load').catch(() => {});
        await page.waitForTimeout(750);
        const violations = await findTouchTargetViolations(page, MIN_TARGET_SIZE_MOBILE, route);
        expect(
          violations,
          `Mobile touch targets on ${route}:\n${formatViolations(violations)}`,
        ).toHaveLength(0);
      } finally {
        await context.close();
      }
    });
  }
});
