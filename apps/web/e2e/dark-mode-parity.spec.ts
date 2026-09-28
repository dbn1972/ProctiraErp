/**
 * Task 47.6 — Property F-2: Dark Mode Parity
 *
 * **Validates: Requirements 36.5, 36.6, 37.2, 37.8**
 *
 * For any route `r` reachable in the authenticated dashboard, `r` SHALL
 * render without WCAG 2.1 AA contrast violations in both `light` and
 * `dark` themes when toggled via the ThemeProvider.
 *
 * Strategy:
 *   1. Enumerate every top-level dashboard route (the page.tsx files
 *      under `src/app/(dashboard)/`).
 *   2. For each route, log in, navigate to the route, and run axe-core
 *      in light mode.
 *   3. Toggle the theme to dark mode via the `<html>` element's
 *      `data-theme` attribute and `.dark` class (matching ThemeProvider
 *      behavior).
 *   4. Run axe-core again in dark mode.
 *   5. Assert zero WCAG 2.1 AA contrast violations in both modes.
 *
 * The test is gated on `E2E_BACKEND_READY=1` because the dashboard
 * routes require an authenticated session backed by a live API.
 *
 * ## Volume 12 §10 / §13 — this file was never executed by any workflow
 *
 * `grep -rn dark-mode-parity .github/ tools/` returned nothing: the spec appeared in
 * neither `PR_SPECS` nor `NIGHTLY_SPECS` in `e2e-backend-ready.yml`, and the only other
 * path that reaches it — `ci.yml`'s turbo `test:e2e` step — does not set
 * `E2E_BACKEND_READY`, so every dashboard scan self-skipped. Volume 12 §10 requires all
 * screens in both light and dark, and §13 makes theme regressions a release exit
 * criterion; both were being satisfied by a file that had never run.
 *
 * Wiring it in required splitting the cost. The dashboard matrix is ~125 routes, and at
 * one login and one navigation per theme it does not fit a pull-request gate, so:
 *
 *   • **Per pull request** — the public/auth block below, in both themes plus real
 *     `prefers-color-scheme` emulation. Cheap, no backend, always on.
 *   • **Nightly** (`E2E_THEME_MATRIX=1`) — the full authenticated route matrix.
 *
 * Each route is now a single test covering light *and* dark rather than two tests, which
 * halves the logins and navigations. The per-theme `checkpointLabel` still names the
 * failing theme, so nothing is lost in the report.
 */

import { expect, test, type Page } from '@playwright/test';

import { loginAsTenantAdmin } from './fixtures/auth';
import { runAxe } from './helpers/axe';

const BACKEND_READY = !!process.env.E2E_BACKEND_READY;
/**
 * The ~125-route authenticated matrix. Off by default so this spec is affordable in the
 * pull-request set; `e2e-backend-ready.yml` sets it for the nightly run.
 */
const THEME_MATRIX = !!process.env.E2E_THEME_MATRIX;

/**
 * All top-level authenticated dashboard routes derived from the
 * `src/app/(dashboard)/` directory structure. Dynamic routes (e.g.
 * `[id]`) are excluded because they require seeded entity IDs; the
 * list pages exercise the same layout chrome, sidebar, header, and
 * shared components that dynamic pages inherit.
 */
const DASHBOARD_ROUTES = [
  { path: '/', label: 'dashboard home' },
  { path: '/students', label: 'students list' },
  { path: '/staff', label: 'staff list' },
  { path: '/institutions', label: 'institutions list' },
  { path: '/attendance', label: 'attendance' },
  { path: '/assessments', label: 'assessments' },
  { path: '/examinations', label: 'examinations' },
  { path: '/admissions', label: 'admissions' },
  { path: '/fees', label: 'fees' },
  { path: '/billing', label: 'billing' },
  { path: '/audit-logs', label: 'audit-logs' },
  { path: '/tenant-lifecycle', label: 'tenant-lifecycle' },
  { path: '/help', label: 'help' },
  { path: '/scholarships', label: 'scholarships' },
  { path: '/scholarships/programs/new', label: 'scholarships-program-new' },
  { path: '/scholarships/applications', label: 'scholarships-applications' },
  { path: '/scholarships/disbursements', label: 'scholarships-disbursements' },
  { path: '/lms', label: 'lms' },
  { path: '/lms/assignments/new?kind=quiz', label: 'lms-quiz-builder' },
  { path: '/lms/pal', label: 'lms-spiral-pal' },
  { path: '/health', label: 'health' },
  { path: '/health/allergies', label: 'health-allergies' },
  { path: '/health/incidents', label: 'health-incidents' },
  { path: '/pipelines', label: 'pipelines' },
  { path: '/notifications', label: 'notifications' },
  { path: '/notifications/preferences', label: 'notification-preferences' },
  { path: '/admin/notification-rules', label: 'notification-rules' },
  { path: '/transport', label: 'transport' },
  { path: '/transport/routes', label: 'transport-routes' },
  { path: '/transport/vehicles', label: 'transport-vehicles' },
  { path: '/transport/assignments', label: 'transport-assignments' },
  { path: '/communication', label: 'communication' },
  { path: '/communication/campaigns', label: 'communication-campaigns' },
  { path: '/communication/emergency', label: 'communication-emergency' },
  { path: '/hostel', label: 'hostel' },
  { path: '/hostel/structure', label: 'hostel-structure' },
  { path: '/hostel/assignments', label: 'hostel-assignments' },
  { path: '/library', label: 'library' },
  { path: '/library/circulation', label: 'library-circulation' },
  { path: '/library/overdues', label: 'library-overdues' },
  { path: '/parent', label: 'parent-portal' },
  { path: '/parent/messages', label: 'parent-messages' },
  { path: '/parent/consents', label: 'parent-consents' },
  { path: '/parent/fees', label: 'parent-fees' },
  { path: '/parent/offers', label: 'parent-offers' },
  { path: '/parent/attendance', label: 'parent-attendance' },
  { path: '/parent/grades', label: 'parent-grades' },
  { path: '/parent/timetable', label: 'parent-timetable' },
  { path: '/parent/homework', label: 'parent-homework' },
  { path: '/parent/calendar', label: 'parent-calendar' },
  { path: '/parent/notices', label: 'parent-notices' },
  { path: '/student', label: 'student-portal' },
  { path: '/student/attendance', label: 'student-attendance' },
  { path: '/student/grades', label: 'student-grades' },
  { path: '/student/timetable', label: 'student-timetable' },
  { path: '/student/homework', label: 'student-homework' },
  { path: '/student/calendar', label: 'student-calendar' },
  { path: '/student/notices', label: 'student-notices' },
  { path: '/student/pal', label: 'student-pal' },
  { path: '/fees/structures', label: 'fees-structures' },
  { path: '/fees/reports', label: 'fees-reports' },
  { path: '/fees/dunning', label: 'fees-dunning' },
  { path: '/fees/reconciliation', label: 'fees-reconciliation' },
  { path: '/admissions/enquiries', label: 'admissions-enquiries' },
  { path: '/admissions/seat-matrix', label: 'admissions-seat-matrix' },
  { path: '/admissions/merit', label: 'admissions-merit' },
  { path: '/assessments/outcomes', label: 'assessments-outcomes' },
  { path: '/assessments/report-cards', label: 'assessments-report-cards' },
  { path: '/health/screenings', label: 'health-screenings' },
  { path: '/health/counselling', label: 'health-counselling' },
  { path: '/health/counselling/new', label: 'health-counselling-new' },
  { path: '/health/special-needs', label: 'health-special-needs' },
  { path: '/workflows', label: 'workflows' },
  { path: '/workflows/approvals', label: 'workflows-approvals' },
  { path: '/workflows/instances', label: 'workflows-instances' },
  { path: '/workflows/definitions/new', label: 'workflows-definition-new' },
  { path: '/reports', label: 'reports' },
  { path: '/reports/new', label: 'reports-new' },
  { path: '/data-warehouse', label: 'data warehouse' },
  { path: '/data-warehouse/import', label: 'data-warehouse-import' },
  { path: '/data-warehouse/field-mapping', label: 'data-warehouse-field-mapping' },
  { path: '/data-warehouse/map', label: 'data-warehouse-gis-map' },
  { path: '/academic-periods', label: 'academic periods' },
  { path: '/admin', label: 'admin' },
  { path: '/admin/users', label: 'admin-users' },
  { path: '/admin/roles', label: 'admin-roles' },
  { path: '/admin/permissions', label: 'admin-permissions' },
  { path: '/admin/tenant', label: 'admin-tenant' },
  // Wave 9 batch 3 (G-909, G-915–G-922)
  { path: '/reports/dashboard', label: 'reports-dashboard' },
  { path: '/reports/schedules', label: 'reports-schedules' },
  { path: '/reports/dashboards', label: 'reports-dashboards' },
  { path: '/lms/bank', label: 'lms-bank' },
  { path: '/lms/rubrics', label: 'lms-rubrics' },
  { path: '/lms/discussions', label: 'lms-discussions' },
  { path: '/lms/lessons', label: 'lms-lessons' },
  { path: '/lms/content', label: 'lms-content' },
  { path: '/lms/analytics', label: 'lms-analytics' },
  { path: '/library/opac', label: 'library-opac' },
  { path: '/library/holds', label: 'library-holds' },
  { path: '/library/fines', label: 'library-fines' },
  { path: '/hostel/mess', label: 'hostel-mess' },
  { path: '/hostel/gate-passes', label: 'hostel-gate-passes' },
  { path: '/hostel/fees', label: 'hostel-fees' },
  { path: '/hostel/attendance', label: 'hostel-attendance' },
  { path: '/attendance/ops', label: 'attendance-ops' },
  { path: '/staff/attendance', label: 'staff-attendance' },
  { path: '/staff/import', label: 'staff-import' },
  { path: '/staff/payroll', label: 'staff-payroll' },
  { path: '/staff/contracts', label: 'staff-contracts' },
  { path: '/communication/circulars', label: 'communication-circulars' },
  { path: '/communication/circulars/new', label: 'communication-circulars-new' },
  { path: '/communication/delivery', label: 'communication-delivery' },
  { path: '/transport/live', label: 'transport-live' },
  { path: '/transport/attendance', label: 'transport-attendance' },
  { path: '/transport/alerts', label: 'transport-alerts' },
  { path: '/transport/fees', label: 'transport-fees' },
] as const;

/** Seeded by tools/e2e/seed-e2e-tenants.sql for tenant A (G-722). */
const E2E_INSTITUTION_ID = process.env.E2E_INSTITUTION_ID ?? 'a2e96cd1-0232-4cce-97e2-00ebbfb9a374';

/** Wave 9 batch 3 institution-scoped routes (G-917 timetable generation). */
const WAVE9_BATCH3_INSTITUTION_ROUTES = [
  { path: `/institutions/${E2E_INSTITUTION_ID}/timetable/generate`, label: 'timetable-generate' },
  {
    path: `/institutions/${E2E_INSTITUTION_ID}/timetable/substitutions`,
    label: 'timetable-substitutions',
  },
] as const;

/**
 * Remove colour transitions so a contrast measurement reads settled values.
 *
 * `globals.css` puts `transition-colors` (150ms) on themed surfaces, so a scan taken
 * during a theme change samples interpolated colours. Measured on `/forgot-password`
 * after switching to dark, the submit button read:
 *
 *   t+0ms    #ffffff on #5048e5   (still light)
 *   t+50ms   #5c5b72 on #7278f2   (1.78:1 — neither theme)
 *   t+150ms  #141334 on #828df8   (6.15:1 — settled dark, passes AA)
 *
 * `document.getAnimations().length` went 22 → 0 across that window. Every "violation" in
 * the 1.3–3.4:1 range that this spec reported while being wired up came from that window,
 * not from the product. Freezing transitions removes the sampling race outright, which is
 * the same reason `toHaveScreenshot` takes `animations: 'disabled'`.
 */
async function freezeTransitions(page: Page): Promise<void> {
  await page.addStyleTag({
    content:
      '*,*::before,*::after{transition:none!important;animation:none!important;' +
      'animation-duration:0s!important;transition-duration:0s!important}',
  });
}

/**
 * Switch the theme the way a user's machine does, then **verify the switch landed**.
 *
 * ## Why the previous implementation asserted nothing
 *
 * This function used to write `data-theme` and the `.dark` class onto `<html>` directly,
 * "mirroring what the ThemeProvider does". `ThemeProvider` then undid it. Its mount effect
 * resolves `system` mode from `prefers-color-scheme` — which Playwright reports as `light`
 * by default — and calls `applyResolvedTheme('light')`, overwriting the mutation. Measured
 * on `/login`: after `setTheme(page, 'dark')`, `document.documentElement.dataset.theme`
 * read back **`light`** immediately and was still `light` three seconds later, with `body`
 * painted `rgb(248, 250, 252)`.
 *
 * So every test in this file labelled `[dark]` was scanning the light theme. Five
 * always-on tests had been green on that basis.
 *
 * ## What it does now
 *
 * `emulateMedia` changes the real media state, which is the input `ThemeProvider`
 * subscribes to in `system` mode — so the product's own resolution path performs the
 * switch. Whether the provider has hydrated or not, both paths converge: its mount
 * resolve reads the current media state, and its `matchMedia` listener catches later
 * changes.
 *
 * The `toHaveAttribute` wait is the part that must never be dropped. It retries until the
 * product has actually applied the theme, which turns a silent no-op into a timeout with a
 * name on it.
 */
async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await freezeTransitions(page);
  await page.emulateMedia({ colorScheme: theme });
  await expect(
    page.locator('html'),
    `the app did not apply the ${theme} theme after emulating prefers-color-scheme: ${theme}`,
  ).toHaveAttribute('data-theme', theme);
}

async function gotoDashboardRoute(page: Page, path: string): Promise<void> {
  const target = path === '/reports/dashboards' ? '/reports/dashboard' : path;
  await page.goto(target);
  await page
    .waitForSelector('[role="main"], main', {
      state: 'visible',
      timeout: 15_000,
    })
    .catch(() => {
      // Some routes may not have a <main> landmark yet; proceed anyway.
    });
}

test.describe('Property F-2: Dark Mode Parity (E2E_BACKEND_READY=1, E2E_THEME_MATRIX=1)', () => {
  test.skip(
    !BACKEND_READY,
    'E2E_BACKEND_READY is not set; skipping dark-mode parity scans. See e2e/README.md.',
  );
  test.skip(
    !THEME_MATRIX,
    'E2E_THEME_MATRIX is not set; the ~125-route authenticated theme matrix runs nightly. ' +
      'The public/auth theme block below runs unconditionally.',
  );

  for (const route of [...DASHBOARD_ROUTES, ...WAVE9_BATCH3_INSTITUTION_ROUTES]) {
    // One test, both themes: the login and the navigation are the expensive parts, and
    // running them twice per route is what put this matrix out of reach of any workflow.
    test(`${route.label} (${route.path}) — no WCAG 2.1 AA contrast violations in light or dark mode`, async ({
      page,
    }) => {
      await loginAsTenantAdmin(page);
      await gotoDashboardRoute(page, route.path);

      await setTheme(page, 'light');
      await runAxe(page, { checkpointLabel: `${route.path} [light]` });

      await setTheme(page, 'dark');
      await runAxe(page, { checkpointLabel: `${route.path} [dark]` });
    });
  }
});

/**
 * Public Auth surfaces do not need a live backend — keep a always-on dark
 * parity smoke so Auth enterprise claims are not gated solely on dashboard.
 */
const AUTH_PUBLIC_ROUTES = [
  { path: '/login', label: 'login' },
  { path: '/signup', label: 'signup' },
  { path: '/forgot-password', label: 'forgot-password' },
  { path: '/reset-password', label: 'reset-password' },
  { path: '/mfa', label: 'mfa' },
] as const;

/**
 * No route is exempt.
 *
 * An earlier revision of this change carried a `test.fail()` list here, asserting that
 * dark `--primary` / `--primary-foreground` was a 3.34:1 WCAG failure. That was wrong: the
 * 3.34:1 was a mid-transition sample (see `freezeTransitions`), and the settled pair is
 * 6.15:1. The list is deliberately not replaced with an empty array — there is no known
 * exemption to leave a hook for.
 */

test.describe('Property F-2: Dark Mode Parity — Auth public surfaces (always on)', () => {
  for (const route of AUTH_PUBLIC_ROUTES) {
    // Both themes, not dark alone. Volume 12 §10 asks for every screen in light *and*
    // dark, and "parity" between one rendered theme and nothing is not a comparison.
    test(`${route.label} (${route.path}) — no WCAG 2.1 AA contrast violations in light or dark mode`, async ({
      page,
    }) => {
      const response = await page.goto(route.path);
      if (!response || response.status() >= 400) {
        test.skip(true, `${route.path} is not enabled in this build`);
      }

      await setTheme(page, 'light');
      await runAxe(page, { checkpointLabel: `${route.path} [light]` });

      await setTheme(page, 'dark');
      await runAxe(page, { checkpointLabel: `${route.path} [dark]` });
    });
  }
});

/**
 * The scans above force the theme by writing `data-theme` and the `.dark` class directly,
 * which is deterministic but bypasses everything that decides the theme in production:
 * the inline boot script in `app/layout.tsx`, `localStorage`, and the
 * `prefers-color-scheme` media query that `ThemeProvider` subscribes to in `system` mode.
 * A regression in that resolution path would leave every scan above green while shipping
 * users the wrong theme, and no Playwright asset in this repository used `colorScheme`
 * emulation at all.
 *
 * This block closes that hole. It asserts the *resolution*, not the palette: with a clean
 * storage origin the provider is in `system` mode, so the emulated OS preference is the
 * only input.
 */
test.describe('Volume 12 §10 — theme resolution honours prefers-color-scheme', () => {
  for (const scheme of ['light', 'dark'] as const) {
    test(`an OS preference of ${scheme} resolves to the ${scheme} theme on first paint`, async ({
      browser,
    }) => {
      // A fresh context guarantees no persisted mode, so `system` is in force.
      const context = await browser.newContext({ colorScheme: scheme });
      const page = await context.newPage();

      try {
        const response = await page.goto('/login', { waitUntil: 'domcontentloaded' });
        if (!response || response.status() >= 400) {
          test.skip(true, '/login is not enabled in this build');
          return;
        }

        const root = page.locator('html');
        await expect(
          root,
          `prefers-color-scheme: ${scheme} did not stamp data-theme="${scheme}" on <html>`,
        ).toHaveAttribute('data-theme', scheme);
        // ThemeProvider maintains both classes so Tailwind's `dark:` variant and
        // theme.css's `:root.light` / `:root.dark` blocks activate together.
        await expect(root).toHaveClass(new RegExp(`\\b${scheme}\\b`));
        await expect(root).not.toHaveClass(
          new RegExp(`\\b${scheme === 'dark' ? 'light' : 'dark'}\\b`),
        );
      } finally {
        await context.close();
      }
    });
  }
});
