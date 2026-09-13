/**
 * Parent / student portal — live API journeys with JWT actor (G-306).
 *
 * Ungated: parent shell routes redirect to /login.
 * Gated (E2E_BACKEND_READY): consent / messaging / fees against live gateway;
 * forgeable x-user-id headers must not change the JWT actor.
 */
import { expect, test } from '@playwright/test';

import {
  PARENT_PORTAL_STUDENT_ID,
  PARENT_PORTAL_TENANT_A,
  PARENT_PORTAL_TENANT_B,
  parentPortalJwtHeaders,
  studentPortalJwtHeaders,
} from './fixtures/parent-portal-auth';

const PARENT_ROUTES = [
  { id: 'home', path: '/parent' },
  { id: 'messages', path: '/parent/messages' },
  { id: 'consents', path: '/parent/consents' },
  { id: 'fees', path: '/parent/fees' },
  { id: 'offers', path: '/parent/offers' },
  // G-804: page-wise matrix — the thread detail route must also be auth-gated.
  { id: 'thread', path: '/parent/messages/00000000-0000-4000-8000-0000000000e2' },
] as const;

const BACKEND_READY = !!process.env.E2E_BACKEND_READY;
const GATEWAY_URL =
  process.env.E2E_GATEWAY_URL ?? process.env.NEXT_PUBLIC_GATEWAY_URL ?? 'http://127.0.0.1:3000';
const STUDENT_ID = PARENT_PORTAL_STUDENT_ID;

test.describe('Parent portal — inventory smoke (ungated)', () => {
  for (const route of PARENT_ROUTES) {
    test(`${route.id} (${route.path}) unauthenticated → /login`, async ({ page }) => {
      await page.goto(route.path, { waitUntil: 'domcontentloaded' });
      await expect(page).toHaveURL(/\/login/);
      await expect(page.locator('body')).toBeVisible();
      await expect(page.getByRole('heading').first()).toBeVisible();
    });
  }
});

test.describe('Parent portal — live JWT journeys (E2E_BACKEND_READY)', () => {
  test.skip(
    !BACKEND_READY,
    'Requires E2E_BACKEND_READY=1 and live gateway with parent-portal plugin',
  );

  test('link child, message, consent decide, sandbox fee pay', async ({ request }) => {
    const parentSub = `parent-e2e-${Date.now()}`;
    const link = await request.post(`${GATEWAY_URL}/api/v1/parent-portal/children/links`, {
      headers: parentPortalJwtHeaders(parentSub),
      data: { studentId: STUDENT_ID, relationship: 'guardian' },
    });
    const linked = await link.json();
    expect(link.status(), JSON.stringify(linked)).toBe(201);

    const thread = await request.post(`${GATEWAY_URL}/api/v1/parent-portal/messages/threads`, {
      headers: parentPortalJwtHeaders(parentSub),
      data: {
        studentId: STUDENT_ID,
        subject: `E2E thread ${Date.now()}`,
        body: 'Hello from parent e2e',
      },
    });
    const createdThread = await thread.json();
    expect(thread.status(), JSON.stringify(createdThread)).toBe(201);
    const threadId = createdThread.thread?.id ?? createdThread.id;
    expect(threadId).toBeTruthy();

    const reply = await request.post(
      `${GATEWAY_URL}/api/v1/parent-portal/messages/threads/${threadId}/messages`,
      {
        headers: parentPortalJwtHeaders(parentSub),
        data: { body: 'Follow-up' },
      },
    );
    expect(reply.status(), await reply.text()).toBe(201);

    const consent = await request.post(`${GATEWAY_URL}/api/v1/parent-portal/consents`, {
      headers: parentPortalJwtHeaders('staff-e2e', {
        roles: [{ roleId: 'admin', roleName: 'Administrator', areaId: null }],
      }),
      data: {
        studentId: STUDENT_ID,
        parentUserId: parentSub,
        consentType: 'photo_media',
        title: 'E2E photo consent',
        consentVersion: 'photo-media-v2026-01',
      },
    });
    const consentBody = await consent.json();
    expect(consent.status(), JSON.stringify(consentBody)).toBe(201);

    const decide = await request.post(
      `${GATEWAY_URL}/api/v1/parent-portal/consents/${consentBody.id}/decide`,
      {
        headers: parentPortalJwtHeaders(parentSub),
        data: { status: 'approved' },
      },
    );
    expect(decide.status()).toBe(200);

    const invoice = await request.post(`${GATEWAY_URL}/api/v1/parent-portal/fees/invoices`, {
      headers: parentPortalJwtHeaders('staff-e2e', {
        roles: [{ roleId: 'admin', roleName: 'Administrator', areaId: null }],
      }),
      data: {
        studentId: STUDENT_ID,
        title: `E2E fee ${Date.now()}`,
        amountCents: 10000,
      },
    });
    const invoiceBody = await invoice.json();
    expect(invoice.status(), JSON.stringify(invoiceBody)).toBe(201);

    const pay = await request.post(
      `${GATEWAY_URL}/api/v1/parent-portal/fees/invoices/${invoiceBody.id}/pay`,
      {
        headers: parentPortalJwtHeaders(parentSub),
        data: { method: 'sandbox' },
      },
    );
    const paid = await pay.json();
    expect(pay.status(), JSON.stringify(paid)).toBe(200);
  });

  test('JWT actor ignores forgeable x-user-id header', async ({ request }) => {
    const realParent = `parent-jwt-${Date.now()}`;
    const forgedParent = `forged-attacker-${Date.now()}`;

    const link = await request.post(`${GATEWAY_URL}/api/v1/parent-portal/children/links`, {
      headers: parentPortalJwtHeaders(realParent, {
        forgedActorHeaders: {
          'x-user-id': forgedParent,
          'x-actor': forgedParent,
          'X-User-Id': forgedParent,
        },
      }),
      data: { studentId: STUDENT_ID, relationship: 'guardian' },
    });
    const body = await link.json();
    expect(link.status(), JSON.stringify(body)).toBe(201);
    const parentUserId = body.parentUserId ?? body.link?.parentUserId ?? body.data?.parentUserId;
    expect(parentUserId).toBe(realParent);
    expect(parentUserId).not.toBe(forgedParent);

    const children = await request.get(`${GATEWAY_URL}/api/v1/parent-portal/children`, {
      headers: parentPortalJwtHeaders(realParent, {
        forgedActorHeaders: { 'x-user-id': forgedParent },
      }),
    });
    expect(children.status()).toBe(200);
    const list = await children.json();
    const rows = list.data ?? list;
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.some((r: { studentId?: string }) => r.studentId === STUDENT_ID)).toBe(true);

    const forgedView = await request.get(`${GATEWAY_URL}/api/v1/parent-portal/children`, {
      headers: parentPortalJwtHeaders(forgedParent),
    });
    const forgedBody = await forgedView.json();
    expect(forgedView.status()).toBe(200);
    expect(forgedBody.data ?? forgedBody).toEqual([]);
  });

  test('cross-tenant deny: tenant B cannot list tenant A children', async ({ request }) => {
    await request.post(`${GATEWAY_URL}/api/v1/parent-portal/children/links`, {
      headers: parentPortalJwtHeaders('parent-iso', { tenantId: PARENT_PORTAL_TENANT_A }),
      data: { studentId: STUDENT_ID, relationship: 'guardian' },
    });

    const cross = await request.get(`${GATEWAY_URL}/api/v1/parent-portal/children`, {
      headers: parentPortalJwtHeaders('parent-iso', { tenantId: PARENT_PORTAL_TENANT_B }),
    });
    const body = await cross.json();
    expect(cross.status()).toBe(200);
    expect(body.data ?? body).toEqual([]);
  });
});

test.describe('Student portal scaffolding — JWT against API (E2E_BACKEND_READY)', () => {
  test.skip(
    !BACKEND_READY,
    'Requires E2E_BACKEND_READY=1; student shell reuses parent-portal linkage APIs',
  );

  test('student JWT can authenticate to gateway health/parent surfaces without forgeable headers', async ({
    request,
  }) => {
    const studentSub = `student-e2e-${Date.now()}`;
    const headers = studentPortalJwtHeaders(studentSub);

    const health = await request.get(`${GATEWAY_URL}/health`, { headers });
    expect([200, 204].includes(health.status()) || health.status() < 500).toBeTruthy();

    // Student actor listing children should be empty (no forge via headers).
    const children = await request.get(`${GATEWAY_URL}/api/v1/parent-portal/children`, {
      headers: {
        ...headers,
        'x-user-id': 'should-not-matter',
      },
    });
    expect(children.status()).toBe(200);
    const childBody = await children.json();
    expect(childBody.data ?? childBody).toEqual([]);
  });
});
