/**
 * Dashboard preview-state switcher — authorization, all five states,
 * expiry, and audit (Task 14.1, `principal-dashboard-parity`, Requirement 6).
 *
 * Ungated: every case below except the final "live gateway" block. This
 * feature's whole design point (Req 6.1, 6.8, 6.11 — isolation from real
 * tenant data while an override is active) means the read side needs no
 * live gateway at all:
 *   - `getSession()` (`@/lib/auth/server`) only *decodes* the access-token
 *     JWT via `next/headers` cookies — it never calls the upstream
 *     auth-service or gateway (confirmed by reading `lib/auth/server.ts`).
 *     `setupFakeTenantSession()` (unsigned `alg:"none"` JWT) satisfies this
 *     completely; the gateway-signed `setupGatewayTenantSession()` is not
 *     needed anywhere in this file.
 *   - `resolvePreviewOverride()` and `hasDashboardPreviewPermission()` both
 *     re-check the permission against the *decoded* session's roles via the
 *     pure, in-process `@proctira/auth` RBAC registry — no network call.
 *   - Once an override is active, `page.tsx`'s `resolveDashboardSources()`
 *     substitutes `previewStateFixtures.ts` data for all six real gateway
 *     calls and explicitly does NOT call the real functions at all (see
 *     that module's own doc comment) — so nothing here needs a live
 *     gateway to observe fixture-driven rendering, expiry, or the
 *     visibility gate.
 *   - The set/clear route's audit call to the gateway
 *     (`recordPreviewStateAudit()`, `@/app/api/dashboard/preview-state/route.ts`)
 *     is explicitly best-effort and swallows a failed/unreachable gateway
 *     call without affecting the route's own 200/204 response — confirmed
 *     live against this repo's `next dev` server with no gateway running
 *     at all (`gatewayFetch` throws `ECONNREFUSED`, is caught, logged, and
 *     the cookie is still set). So the "clicking triggers a successful
 *     2xx" assertion (Req 6.13) is itself an ungated observation.
 *
 * Gated (E2E_BACKEND_READY): one additional test that, when a live gateway
 * is reachable, also confirms the gateway's own audit-anchor endpoint
 * (`POST/DELETE /api/v1/dashboard-preview`, proved at the unit level by
 * `apps/api-gateway/src/dashboard-preview-mount.test.ts`) is actually
 * reached end-to-end from a real browser click — the one thing the ungated
 * block cannot observe, since there it degrades silently by design.
 *
 * ## CSRF header fix applied during this task
 *
 * While building this suite, a real defect surfaced: `PreviewStateSwitcher.tsx`'s
 * `requestPreviewState()` called the bare global `fetch()` with no
 * `x-csrf-token` header. `middleware.ts`'s `/api/*` CSRF gate
 * (`handleApiRequest` -> `verifyCsrf` -> `verifyDoubleSubmit`) requires that
 * header on every unsafe-method request, matching the `csrf_token` cookie
 * the middleware itself issues on every page navigation
 * (`ensureCsrfCookie`). An unmodified browser click on any switcher option
 * (or Clear) returned `403 {"code":"CSRF_REJECTED","reason":"missing-header"}`,
 * never reaching `resolvePreviewOverride`/RBAC/the cookie write at all.
 * Task 10.3's unit tests mock `global.fetch` directly, bypassing the
 * browser's real cookie/header/middleware plumbing entirely, so they could
 * never have caught this.
 *
 * Fixed directly in `PreviewStateSwitcher.tsx` by routing both the POST and
 * DELETE calls through `withCsrfHeader()` (`@/lib/auth/csrf`) — the same
 * helper every other mutating client-side fetch in this app already uses
 * (e.g. `@/lib/auth/session.ts`'s login/logout/refresh calls). Every test
 * below that drives a real browser click now exercises the corrected
 * component with no workaround needed.
 *
 * _Requirements: 6.1, 6.8, 6.9, 6.11, 6.12, 6.13_
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import { createSignedJwt, setupFakeTenantSession, setupGatewayTenantSession } from './fixtures/fake-session';
import {
  PREVIEW_STATE_COOKIE_NAME,
  PREVIEW_STATE_MAX_AGE_SECONDS,
  encodePreviewStateCookieValue,
  type PreviewState,
} from '@/lib/dashboard/previewStateCookie';

const BACKEND_READY = !!process.env.E2E_BACKEND_READY;
const GATEWAY_URL =
  process.env.E2E_GATEWAY_URL ?? process.env.NEXT_PUBLIC_GATEWAY_URL ?? 'http://127.0.0.1:3000';
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3001';

const ADMIN_ROLE = [{ roleId: 'admin', roleName: 'Administrator', areaId: null }];
const PRINCIPAL_ROLE = [{ roleId: 'principal', roleName: 'Principal', areaId: null }];
const TEACHER_ROLE = [{ roleId: 'teacher', roleName: 'Teacher', areaId: null }];

/**
 * `FIXTURE_COUNTS.students` in `@/lib/dashboard/previewStateFixtures` — the
 * "Filled" state's distinctive, fabricated Students KPI value. Real
 * (non-override) rendering in this environment (no live gateway) shows
 * `0` for this card instead (the gateway client degrades to an empty,
 * zero-total result rather than throwing), so this exact number can only
 * appear on the page when a "filled"/"no-approvals"/"degraded" preview
 * fixture is genuinely active — making it a reliable, distinctive marker
 * for "did the override actually take effect".
 */
const FIXTURE_STUDENT_COUNT = '620';

function headers(roles = ADMIN_ROLE) {
  const token = createSignedJwt({
    sub: 'e2e-preview-admin',
    email: 'admin@tenant-a.test',
    displayName: 'E2E Preview Admin',
    tenantId: '00000000-0000-4000-8000-000000000001',
    roles,
    institutions: [],
  });
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-Tenant-ID': '00000000-0000-4000-8000-000000000001',
  };
}

async function gatewayHealthy(request: APIRequestContext): Promise<boolean> {
  try {
    const res = await request.get(`${GATEWAY_URL}/health`, { timeout: 5_000 });
    return res.ok();
  } catch {
    return false;
  }
}

/** Hand-crafts and installs the `Dashboard-Preview-State` cookie directly, bypassing the UI. */
async function setPreviewStateCookie(
  page: Page,
  state: PreviewState,
  setAtEpochSeconds?: number,
): Promise<void> {
  await page.context().addCookies([
    {
      name: PREVIEW_STATE_COOKIE_NAME,
      value: encodePreviewStateCookieValue(state, setAtEpochSeconds),
      url: BASE_URL,
    },
  ]);
}

/**
 * Waits for exactly one `[data-testid=testId]` node before asserting
 * visibility. Mirrors the identical helper (and rationale) in
 * `46-reports-real-exports-smoke.spec.ts`: under `next start` (the
 * turbo-driven Integration Tests CI job serves a prebuilt app), a streamed
 * SSR fragment can briefly sit outside `<main>` as a duplicate of the
 * already-hydrated tree for one render frame. `toBeVisible()` alone throws
 * immediately on that transient strict-mode violation; `toHaveCount(1)`
 * retries past it.
 */
async function stableVisible(page: Page, testId: string) {
  const el = page.getByTestId(testId);
  await expect(async () => {
    await expect(el).toHaveCount(1, { timeout: 2_000 });
    await expect(el).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  return el;
}

// ─── Authorization / visibility (Req 6.1, 6.12) ─────────────────────────────

test.describe('Preview-state switcher — authorization (ungated)', () => {
  test('a user without dashboard-preview:manage never sees the switcher', async ({ page }) => {
    await setupFakeTenantSession(page, { roles: TEACHER_ROLE });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('preview-state-switcher')).toHaveCount(0);
  });

  test('a permitted role (admin) does see the switcher with all five options', async ({
    page,
  }) => {
    await setupFakeTenantSession(page, { roles: ADMIN_ROLE });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await stableVisible(page, 'preview-state-switcher');
    for (const state of ['filled', 'no-approvals', 'degraded', 'loading', 'error']) {
      await expect(page.getByTestId(`preview-state-switcher-option-${state}`)).toBeVisible();
    }
  });

  test('a hand-crafted cookie has no effect on an unpermitted user\'s rendered page (Req 6.1, 6.8, 6.11, 6.12)', async ({
    page,
  }) => {
    // "resolvePreviewOverride()'s server-side permission re-check — not
    // cookie presence — is the actual authorization boundary" (per the
    // task description this test exists to prove): a teacher-role session
    // presents a validly-ENCODED, unexpired "filled" cookie, exactly as if
    // they had captured it from an admin's browser or crafted it by hand.
    await setupFakeTenantSession(page, { roles: TEACHER_ROLE });
    await setPreviewStateCookie(page, 'filled');
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    // No banner, no switcher, and — the core proof — none of "Filled"'s
    // fabricated data. `resolvePreviewOverride()` must have failed closed
    // to `null` purely because this session's real roles lack the
    // permission, regardless of the cookie it presented.
    await expect(page.getByTestId('preview-state-banner')).toHaveCount(0);
    await expect(page.getByTestId('preview-state-switcher')).toHaveCount(0);
    const body = await page.locator('body').innerText();
    expect(body).not.toContain(FIXTURE_STUDENT_COUNT);
  });
});

// ─── All five states (Req 6.2-6.7) ──────────────────────────────────────────

test.describe('Preview-state switcher — all five states (ungated)', () => {
  test('filled — driven through a real UI click, proving the whole wiring end-to-end (Req 6.3)', async ({
    page,
  }) => {
    await setupFakeTenantSession(page, { roles: PRINCIPAL_ROLE });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => {});
    await stableVisible(page, 'preview-state-switcher');

    const [response] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/dashboard/preview-state')),
      page.getByTestId('preview-state-switcher-option-filled').click(),
    ]);
    expect(response.status()).toBe(200);

    // The switcher's own optimistic UI...
    await expect(page.getByTestId('preview-state-switcher-active-label')).toHaveText(
      /Filled/,
    );
    // ...and the server-rendered result after router.refresh(): banner,
    // populated role snapshot, and the fixture's distinctive number.
    await stableVisible(page, 'preview-state-banner');
    await expect(page.getByTestId('preview-state-banner')).toContainText('Preview mode: Filled');
    await expect(page.getByTestId('dashboard-role-title')).toContainText('Principal dashboard');
    await expect(page.getByText(FIXTURE_STUDENT_COUNT)).toBeVisible();
    await expect(page.getByText('Currently unavailable')).toHaveCount(0);
  });

  test('no-approvals — cookie-driven, distinguishable from a genuine failure (Req 6.4)', async ({
    page,
  }) => {
    await setupFakeTenantSession(page, { roles: PRINCIPAL_ROLE });
    await setPreviewStateCookie(page, 'no-approvals');
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    await stableVisible(page, 'preview-state-banner');
    await expect(page.getByTestId('preview-state-banner')).toContainText('No approvals');
    await expect(page.getByText('All caught up')).toBeVisible();
    // Req 6.4: must not be indistinguishable from a service failure.
    await expect(page.getByText('Currently unavailable')).toHaveCount(0);
  });

  test('degraded — cookie-driven, a defined subset unavailable while the rest stays functional (Req 6.5)', async ({
    page,
  }) => {
    await setupFakeTenantSession(page, { roles: PRINCIPAL_ROLE });
    await setPreviewStateCookie(page, 'degraded');
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    await stableVisible(page, 'preview-state-banner');
    await expect(page.getByTestId('preview-state-banner')).toContainText('Degraded');
    await expect(page.getByText('Currently unavailable')).toHaveCount(3);
    // At least one section stays genuinely functional — distinct from total failure.
    await expect(page.getByTestId('dashboard-role-title')).toContainText('Principal dashboard');
    await expect(page.getByText('Student transfer approval')).toBeVisible();
  });

  test('loading — cookie-driven, renders the loading skeleton and never resolves on its own (Req 6.6)', async ({
    page,
  }) => {
    await setupFakeTenantSession(page, { roles: PRINCIPAL_ROLE });
    await setPreviewStateCookie(page, 'loading');
    // `waitUntil: 'domcontentloaded'` hangs here: the SSR response for this
    // route segment never fully completes while `resolveDashboardSources()`
    // is awaiting six never-resolving promises. `'commit'` — the point at
    // which the browser starts receiving and rendering the response — is
    // as far as this navigation ever gets, by design (confirmed live: a
    // curl against this exact cookie/session combo streams the App
    // Router's `loading.tsx` Suspense fallback markup and then never
    // terminates the connection on its own).
    await page.goto('/', { waitUntil: 'commit' });

    await expect(page.getByTestId('route-loading-panel')).toBeVisible({ timeout: 10_000 });
    // Stays showing — does not resolve to a final data state on its own.
    await page.waitForTimeout(2_000);
    await expect(page.getByTestId('route-loading-panel')).toBeVisible();
    await expect(page.getByTestId('dashboard-heading')).toHaveCount(0);
  });

  test('error — cookie-driven, the maximum failure surface, distinct from degraded and no-approvals (Req 6.7)', async ({
    page,
  }) => {
    await setupFakeTenantSession(page, { roles: PRINCIPAL_ROLE });
    await setPreviewStateCookie(page, 'error');
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    await stableVisible(page, 'preview-state-banner');
    await expect(page.getByTestId('preview-state-banner')).toContainText('Preview mode: Error');
    // All four KPI cards + the approvals panel — more than degraded's 3,
    // and none of no-approvals's empty-list presentation.
    await expect(page.getByText('Currently unavailable')).toHaveCount(5);
    await expect(page.getByText('All caught up')).toHaveCount(0);
    await expect(page.getByTestId('scaffold-mode-banner')).toBeVisible();
    await expect(page.getByTestId('dashboard-role-title')).toHaveCount(0);
  });
});

// ─── Expiry (Req 6.9) ────────────────────────────────────────────────────────

test.describe('Preview-state switcher — expiry (ungated)', () => {
  test('a cookie older than PREVIEW_STATE_MAX_AGE_SECONDS renders as if no override were active, for a permitted session', async ({
    page,
  }) => {
    await setupFakeTenantSession(page, { roles: ADMIN_ROLE });
    const expiredEpoch = Math.floor(Date.now() / 1000) - PREVIEW_STATE_MAX_AGE_SECONDS - 200;
    await setPreviewStateCookie(page, 'filled', expiredEpoch);
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    // Server-side re-validation must reject this regardless of whatever
    // Max-Age the browser's own cookie jar might still be honoring —
    // this cookie was hand-crafted with an old timestamp, not naturally
    // aged out, so only the epoch re-check inside `resolvePreviewOverride()`
    // (not browser cookie expiry) can be responsible for the result below.
    await expect(page.getByTestId('preview-state-banner')).toHaveCount(0);
    const body = await page.locator('body').innerText();
    expect(body).not.toContain(FIXTURE_STUDENT_COUNT);

    // The switcher itself still renders (the session still holds the
    // permission) but reflects no state as active.
    await stableVisible(page, 'preview-state-switcher');
    await expect(page.getByTestId('preview-state-switcher-option-filled')).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await expect(page.getByTestId('preview-state-switcher-clear')).toHaveCount(0);
  });
});

// ─── Audit (Req 6.13) ────────────────────────────────────────────────────────

test.describe('Preview-state switcher — audit-adjacent network behavior (ungated)', () => {
  test('clicking a state option triggers a successful (2xx) POST, and clicking Clear triggers a successful DELETE', async ({
    page,
  }) => {
    await setupFakeTenantSession(page, { roles: ADMIN_ROLE });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => {});
    await stableVisible(page, 'preview-state-switcher');

    const [postResponse] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/api/dashboard/preview-state') && r.request().method() === 'POST',
      ),
      page.getByTestId('preview-state-switcher-option-degraded').click(),
    ]);
    expect(postResponse.status()).toBeGreaterThanOrEqual(200);
    expect(postResponse.status()).toBeLessThan(300);

    await expect(page.getByTestId('preview-state-switcher-clear')).toBeVisible();
    const [deleteResponse] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes('/api/dashboard/preview-state') && r.request().method() === 'DELETE',
      ),
      page.getByTestId('preview-state-switcher-clear').click(),
    ]);
    expect(deleteResponse.status()).toBeGreaterThanOrEqual(200);
    expect(deleteResponse.status()).toBeLessThan(300);
  });
});

// ─── Scope isolation sanity (Req 6.8, 6.11) ─────────────────────────────────

test.describe('Preview-state switcher — scope isolation (ungated)', () => {
  test('a session with no cookie of its own is unaffected by another session\'s active preview state', async ({
    browser,
  }) => {
    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();
    await setupFakeTenantSession(pageA, { sub: 'user-a', roles: ADMIN_ROLE });
    await setPreviewStateCookie(pageA, 'error');
    await pageA.goto('/', { waitUntil: 'domcontentloaded' });
    await stableVisible(pageA, 'preview-state-banner');

    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    await setupFakeTenantSession(pageB, { sub: 'user-b', roles: ADMIN_ROLE });
    await pageB.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(pageB.getByTestId('preview-state-banner')).toHaveCount(0);

    await contextA.close();
    await contextB.close();
  });
});

// ─── Live gateway audit chain (E2E_BACKEND_READY) ───────────────────────────

test.describe('Preview-state switcher — live gateway audit chain (E2E_BACKEND_READY)', () => {
  test.skip(
    !BACKEND_READY,
    'Requires E2E_BACKEND_READY=1 and a live gateway; see e2e/README.md. Every other ' +
      'case in this file is intentionally ungated — see the file header comment.',
  );

  test.beforeEach(async ({ page, request }) => {
    if (!(await gatewayHealthy(request))) {
      test.skip(true, 'Gateway /health unreachable — soft-skip live audit chain');
    }
    await setupGatewayTenantSession(page, { roles: ADMIN_ROLE });
  });

  test('a real click reaches the gateway audit-anchor endpoint end-to-end, proving the full chain when a backend exists', async ({
    page,
    request,
  }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle').catch(() => {});
    await stableVisible(page, 'preview-state-switcher');

    const [postResponse] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/api/dashboard/preview-state') && r.request().method() === 'POST',
      ),
      page.getByTestId('preview-state-switcher-option-degraded').click(),
    ]);
    expect(postResponse.status()).toBe(200);

    // Independent confirmation that the gateway's own audit-anchor route
    // (unit-proved by `apps/api-gateway/src/dashboard-preview-mount.test.ts`)
    // is reachable with this same signed session — the one piece the
    // ungated block above cannot observe, since there the identical call
    // degrades silently by design (no live gateway to reach).
    const direct = await request.post(`${GATEWAY_URL}/api/v1/dashboard-preview`, {
      headers: headers(ADMIN_ROLE),
    });
    expect(direct.status()).toBe(200);

    await expect(page.getByTestId('preview-state-switcher-clear')).toBeVisible();
    const [deleteResponse] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().includes('/api/dashboard/preview-state') && r.request().method() === 'DELETE',
      ),
      page.getByTestId('preview-state-switcher-clear').click(),
    ]);
    expect(deleteResponse.status()).toBeGreaterThanOrEqual(200);
    expect(deleteResponse.status()).toBeLessThan(300);
  });
});
