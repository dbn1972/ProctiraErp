/**
 * Task 48.5 — Arabic (`ar`) locale pilot, end-to-end RTL validation.
 *
 * Walks the canonical RTL acceptance checklist from Requirement 18 AC 4
 * (RTL languages render correctly), AC 10 (logical-property utilities),
 * and AC 11 (directional icons mirror via `<DirectionalIcon>`):
 *
 *   1. Sign in as the seeded tenant admin (LTR baseline).
 *   2. Switch the language to Arabic via `<LanguageSelector>`.
 *   3. Assert `<html dir="rtl" lang="ar">` was stamped onto the page
 *      (Requirement 18 AC 4 / AC 8 — locale persistence + direction
 *      attribute).
 *   4. Assert the sidebar visually sits on the RIGHT half of the
 *      viewport (Requirement 18 AC 4 — mirrored layout). We compute
 *      this from `getBoundingClientRect()` so we test the *rendered*
 *      mirror rather than the source-order DOM, which logical-property
 *      flips do not change.
 *   5. Assert the breadcrumb chevron has `data-rtl-flipped="true"`
 *      (Requirement 18 AC 11 — directional icons flipped via
 *      `<DirectionalIcon>` / `-scale-x-100`).
 *   6. Assert at least one element exposes a logical-property utility
 *      class (`ms-*`, `me-*`, `ps-*`, `pe-*`, `border-s-*`, `border-e-*`,
 *      `start-*`, `end-*`, `text-start`, `text-end`) — physical-axis
 *      utilities are flagged by the lint rule from task 48.4, so this
 *      assertion guards the runtime equivalent (Requirement 18 AC 10).
 *   7. Navigate within the dashboard and re-assert that direction +
 *      sidebar mirroring survive route changes.
 *
 * The spec is gated on `E2E_BACKEND_READY=1`, matching the rest of the
 * `apps/web/e2e/*.spec.ts` suite. Without that flag every assertion is
 * skipped — `pnpm playwright test --list` keeps parsing the file so the
 * suite stays green in CI without a live backend.
 *
 * Requirements: 18.4, 18.10, 18.11
 * Design: Section C
 */

import { expect, test, type Locator, type Page } from '@playwright/test';

import { loginAsTenantAdmin } from './fixtures/auth';
import { runAxe } from './helpers/axe';

const BACKEND_READY = !!process.env.E2E_BACKEND_READY;

/**
 * Logical-axis Tailwind utilities mandated by Requirement 18 AC 10. The
 * lint rule from task 48.4 forbids the corresponding physical-axis
 * classes (`ml-*`, `mr-*`, `pl-*`, …) so the runtime should only ever
 * surface logical equivalents on locale-aware components.
 */
const LOGICAL_UTILITY_PATTERN =
  /\b(?:ms-|me-|ps-|pe-|border-s-|border-e-|start-|end-|text-start\b|text-end\b)/;

test.describe('Task 48.5 — Arabic locale pilot end-to-end RTL behaviour', () => {
  test.skip(
    !BACKEND_READY,
    'E2E_BACKEND_READY is not set; skipping live-backend e2e test. See e2e/README.md.',
  );

  test('switching to Arabic mirrors the dashboard shell, flips chevrons, and applies logical utilities', async ({
    page,
  }) => {
    await loginAsTenantAdmin(page);

    // Sanity: signed-in baseline is LTR (the seeded tenant uses English).
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');

    // (1) Open the language selector and switch to العربية.
    const languageTrigger = page.getByRole('button', {
      name: /select language/i,
    });
    await expect(languageTrigger).toBeVisible();
    await languageTrigger.click();

    const arabicOption = page.getByRole('menuitemradio', { name: /العربية|arabic/i }).first();
    await arabicOption.click();

    // (2) `<html lang="ar" dir="rtl">` is stamped by `<LanguageProvider>`
    //     before any nav happens (Requirement 18 AC 8).
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl', {
      timeout: 10_000,
    });
    await expect(page.locator('html')).toHaveAttribute('lang', /^ar(-|$)/);

    // (3) Sidebar mirrors visually to the right edge of the viewport.
    await assertSidebarOnRight(page);

    // (4) Breadcrumb chevron flips via `<DirectionalIcon>` / `-scale-x-100`.
    //     The `<BreadcrumbSeparator>` rendered by
    //     `apps/web/src/components/layout/breadcrumbs.tsx` carries the
    //     `rtl:rotate-180` utility, while any `<DirectionalIcon>` in the
    //     header / shell renders `data-rtl-flipped="true"` once `<html
    //     dir="rtl">` is set.
    await assertChevronFlipped(page);

    // (5) At least one element on the dashboard surfaces a logical
    //     spacing utility (Requirement 18 AC 10).
    await assertLogicalUtilityPresent(page);

    // (6) Navigate to /students and re-assert the mirrored shell so the
    //     direction survives route changes (Requirement 18 AC 4 — RTL
    //     applies to all authenticated pages, not just the landing).
    await page.goto('/students');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('main')).toBeVisible();
    await assertSidebarOnRight(page);

    // (7) Task 56.7 — RTL shell must also pass WCAG 2.1 AA at the same
    //     checkpoints we just structurally validated. Running axe in
    //     RTL mode catches direction-conditional regressions (e.g. a
    //     dropdown that escapes the viewport, a focus ring clipped by
    //     `overflow: hidden`, or a label/control swap).
    await runAxe(page, { checkpointLabel: 'RTL /students' });
  });
});

// ─── Assertion helpers ──────────────────────────────────────────────────────

/**
 * Asserts the dashboard sidebar sits on the right half of the viewport
 * once the document direction has flipped to RTL. We assert against the
 * *rendered* geometry rather than DOM order because logical-property
 * utilities (`border-e-*`, `flex` row) do not reorder children — the
 * mirror happens because `<html dir="rtl">` flips the writing direction
 * of the parent flex container.
 */
async function assertSidebarOnRight(page: Page): Promise<void> {
  const sidebar = page
    .locator('aside')
    .filter({ has: page.getByRole('navigation', { name: /main navigation/i }) })
    .first();
  await expect(sidebar).toBeVisible({ timeout: 10_000 });

  const [sidebarBox, viewport] = await Promise.all([sidebar.boundingBox(), page.viewportSize()]);
  expect(sidebarBox).not.toBeNull();
  expect(viewport).not.toBeNull();
  if (!sidebarBox || !viewport) return;

  const sidebarCenter = sidebarBox.x + sidebarBox.width / 2;
  const viewportCenter = viewport.width / 2;

  // Sidebar centroid must be in the right half of the viewport. Using the
  // centroid (rather than the left edge) keeps the assertion robust to
  // sidebar width changes and small render-time adjustments.
  expect(sidebarCenter).toBeGreaterThan(viewportCenter);
}

/**
 * Asserts a directional chevron icon is mirrored. The dashboard shell
 * exposes two pathways:
 *   • `<BreadcrumbSeparator>` uses `rtl:rotate-180` Tailwind variants.
 *   • `<DirectionalIcon>` adds `data-rtl-flipped="true"` and the
 *     `-scale-x-100` utility class when `dir === 'rtl'`.
 * Either is acceptable evidence that Requirement 18 AC 11 is honoured;
 * we assert that *at least one* shows up on the page.
 */
async function assertChevronFlipped(page: Page): Promise<void> {
  const directionalIcons = page.locator('[data-rtl-flipped="true"]');
  const breadcrumbChevrons = page.locator('.breadcrumb-separator');

  const directionalCount = await directionalIcons.count();
  const breadcrumbCount = await breadcrumbChevrons.count();

  // Prefer the explicit `<DirectionalIcon>` evidence when it's present.
  if (directionalCount > 0) {
    const first = directionalIcons.first();
    await expect(first).toBeAttached();
    const className = (await first.getAttribute('class')) ?? '';
    expect(className).toMatch(/-scale-x-100/);
    return;
  }

  // Fallback: the breadcrumb separator renders an SVG with the
  // `rtl:rotate-180` utility. Tailwind compiles the variant into a CSS
  // rule that becomes active once `<html dir="rtl">` is set, so the
  // computed `transform` should include a 180° rotation.
  expect(breadcrumbCount).toBeGreaterThan(0);
  const transform = await breadcrumbChevrons
    .first()
    .evaluate((node) => window.getComputedStyle(node).transform);
  // `matrix(-1, 0, 0, -1, 0, 0)` is the canonical 180° rotation matrix.
  // Allow either `rotate(180deg)` or the matrix form depending on the
  // browser's serialization.
  expect(transform === 'none' ? '' : transform).toMatch(/matrix\(-1|rotate\(180/);
}

/**
 * Asserts that at least one rendered element carries a logical-property
 * Tailwind utility class. Mirrors the lint rule from task 48.4 at
 * runtime — the rule prevents authors from introducing physical-axis
 * classes; this assertion verifies the dashboard shell actually emits
 * the logical-axis classes the design system mandates.
 */
async function assertLogicalUtilityPresent(page: Page): Promise<void> {
  const candidates: Locator = page.locator(
    [
      '[class*="ms-"]',
      '[class*="me-"]',
      '[class*="ps-"]',
      '[class*="pe-"]',
      '[class*="border-s-"]',
      '[class*="border-e-"]',
      '[class*="start-"]',
      '[class*="end-"]',
      '[class~="text-start"]',
      '[class~="text-end"]',
    ].join(', '),
  );

  await expect(candidates.first()).toBeAttached({ timeout: 10_000 });
  const className = (await candidates.first().getAttribute('class')) ?? '';
  expect(className).toMatch(LOGICAL_UTILITY_PATTERN);
}
