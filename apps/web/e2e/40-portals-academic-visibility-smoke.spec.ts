/**
 * Parent / student academic visibility — G-904.
 *
 * Ungated: each new portal page redirects to /login.
 * Gated (E2E_BACKEND_READY): linked parent GET of each academic view is 200;
 * an unlinked child id is 403/404; tenant B sees nothing. Student `me`
 * routes bind to the JWT subject.
 */
import { expect, test } from '@playwright/test';

import { createSignedJwt, setupGatewayTenantSession } from './fixtures/fake-session';
import {
  PARENT_PORTAL_STUDENT_ID,
  PARENT_PORTAL_TENANT_A,
  PARENT_PORTAL_TENANT_B,
  parentPortalJwtHeaders,
  studentPortalJwtHeaders,
} from './fixtures/parent-portal-auth';

const BACKEND_READY = !!process.env.E2E_BACKEND_READY;
const GATEWAY_URL =
  process.env.E2E_GATEWAY_URL ?? process.env.NEXT_PUBLIC_GATEWAY_URL ?? 'http://127.0.0.1:3000';
const TENANT_A = PARENT_PORTAL_TENANT_A;
const TENANT_B = PARENT_PORTAL_TENANT_B;
/** Seeded by tools/e2e/seed-e2e-tenants.sql — reserved for live page sessions. */
const INSTITUTION_A = 'a2e96cd1-0232-4cce-97e2-00ebbfb9a374';
const STUDENT_ID = PARENT_PORTAL_STUDENT_ID;
const UNLINKED_CHILD = '00000000-0000-4000-8000-00000000dead';

const PARENT_ACADEMIC_PAGES = [
  { id: 'attendance', path: '/parent/attendance', view: 'attendance', testId: 'parent-attendance' },
  { id: 'grades', path: '/parent/grades', view: 'grades', testId: 'parent-grades' },
  { id: 'timetable', path: '/parent/timetable', view: 'timetable', testId: 'parent-timetable' },
  { id: 'homework', path: '/parent/homework', view: 'homework', testId: 'parent-homework' },
  { id: 'calendar', path: '/parent/calendar', view: 'calendar', testId: 'parent-calendar' },
  { id: 'notices', path: '/parent/notices', view: 'notices', testId: 'parent-notices' },
] as const;

const STUDENT_PAGES = [
  { id: 'home', path: '/student', testId: 'student-home' },
  { id: 'attendance', path: '/student/attendance', testId: 'student-attendance' },
  { id: 'grades', path: '/student/grades', testId: 'student-grades' },
  { id: 'timetable', path: '/student/timetable', testId: 'student-timetable' },
  { id: 'homework', path: '/student/homework', testId: 'student-homework' },
  { id: 'calendar', path: '/student/calendar', testId: 'student-calendar' },
  { id: 'notices', path: '/student/notices', testId: 'student-notices' },
  { id: 'pal', path: '/student/pal', testId: 'student-pal' },
] as const;

const STUDENT_API_VIEWS = [
  'attendance',
  'grades',
  'timetable',
  'homework',
  'calendar',
  'notices',
  'pal',
] as const;

function academicUrl(studentId: string, view: string): string {
  return `${GATEWAY_URL}/api/v1/parent-portal/children/${studentId}/${view}`;
}

test.describe('G-904 portals academic visibility — ungated', () => {
  for (const route of PARENT_ACADEMIC_PAGES) {
    test(`parent ${route.id} (${route.path}) unauthenticated → /login`, async ({ page }) => {
      await page.goto(route.path, { waitUntil: 'domcontentloaded' });
      await expect(page).toHaveURL(/\/login/);
      await expect(page.locator('body')).toBeVisible();
      await expect(page.getByRole('heading').first()).toBeVisible();
    });
  }

  for (const route of STUDENT_PAGES) {
    test(`student ${route.id} (${route.path}) unauthenticated → /login`, async ({ page }) => {
      await page.goto(route.path, { waitUntil: 'domcontentloaded' });
      await expect(page).toHaveURL(/\/login/);
      await expect(page.locator('body')).toBeVisible();
      await expect(page.getByRole('heading').first()).toBeVisible();
    });
  }
});

test.describe('G-904 portals academic visibility — live (E2E_BACKEND_READY)', () => {
  test.skip(
    !BACKEND_READY,
    'Requires E2E_BACKEND_READY=1 and live gateway with parent-portal academic reads',
  );

  test('linked parent reads each academic view; unlinked child and tenant B are denied', async ({
    request,
    page,
  }) => {
    test.slow();
    const parentSub = `parent-g904-${Date.now()}`;
    const headers = parentPortalJwtHeaders(parentSub, { tenantId: TENANT_A });

    const link = await request.post(`${GATEWAY_URL}/api/v1/parent-portal/children/links`, {
      headers,
      data: { studentId: STUDENT_ID, relationship: 'guardian' },
    });
    expect(link.status(), await link.text()).toBe(201);

    for (const route of PARENT_ACADEMIC_PAGES) {
      const linked = await request.get(academicUrl(STUDENT_ID, route.view), { headers });
      expect(linked.status(), `${route.view} linked: ${await linked.text()}`).toBe(200);
      const body = await linked.json();
      expect(Array.isArray(body.data ?? body)).toBe(true);

      const unlinked = await request.get(academicUrl(UNLINKED_CHILD, route.view), { headers });
      expect([403, 404], `${route.view} unlinked ${unlinked.status()}`).toContain(
        unlinked.status(),
      );
    }

    const tenantB = parentPortalJwtHeaders(parentSub, { tenantId: TENANT_B });
    for (const route of PARENT_ACADEMIC_PAGES) {
      const cross = await request.get(academicUrl(STUDENT_ID, route.view), { headers: tenantB });
      expect([403, 404], `${route.view} tenant B ${cross.status()}`).toContain(cross.status());
    }

    const listB = await request.get(`${GATEWAY_URL}/api/v1/parent-portal/children`, {
      headers: tenantB,
    });
    expect(listB.status()).toBe(200);
    expect((await listB.json()).data ?? []).toEqual([]);

    const token = createSignedJwt({
      sub: parentSub,
      email: `${parentSub}@tenant.test`,
      displayName: parentSub,
      tenantId: TENANT_A,
      institutions: [INSTITUTION_A],
      roles: [{ roleId: 'parent', roleName: 'Parent', areaId: null }],
    });
    const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3001';
    await page.context().addCookies([
      { name: 'access_token', value: token, url: baseUrl },
      { name: 'refresh_token', value: token, url: baseUrl },
    ]);

    for (const route of PARENT_ACADEMIC_PAGES) {
      await page.goto(route.path, { waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId(route.testId)).toBeVisible({ timeout: 20_000 });
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    }
  });

  test('student JWT self-binding on /student-portal/me', async ({ request, page }) => {
    // Seven sequential page loads; under `next dev` each first visit compiles the route.
    test.slow();
    const studentSub = STUDENT_ID;
    const headers = studentPortalJwtHeaders(studentSub, TENANT_A);

    for (const view of STUDENT_API_VIEWS) {
      const res = await request.get(`${GATEWAY_URL}/api/v1/student-portal/me/${view}`, { headers });
      expect([200, 404], `${view} ${res.status()} ${await res.text()}`).toContain(res.status());
      if (res.status() === 200) {
        const body = await res.json();
        expect(Array.isArray(body.data ?? body)).toBe(true);
      }
    }

    await setupGatewayTenantSession(page, {
      sub: studentSub,
      email: 'student@tenant-a.test',
      displayName: 'E2E Student',
      tenantId: TENANT_A,
      roles: [{ roleId: 'student', roleName: 'Student', areaId: null }],
    });

    for (const route of STUDENT_PAGES) {
      await page.goto(route.path, { waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId(route.testId)).toBeVisible({ timeout: 20_000 });
    }
  });
});
