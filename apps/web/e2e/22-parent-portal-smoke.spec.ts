/**
 * Parent portal — ungated inventory smokes + gated write/security.
 */
import { expect, test } from '@playwright/test';

import { createSignedJwt } from './fixtures/fake-session';

const PARENT_ROUTES = [
  { id: 'home', path: '/parent' },
  { id: 'messages', path: '/parent/messages' },
  { id: 'consents', path: '/parent/consents' },
  { id: 'fees', path: '/parent/fees' },
] as const;

const BACKEND_READY = !!process.env.E2E_BACKEND_READY;
const GATEWAY_URL =
  process.env.E2E_GATEWAY_URL ?? process.env.NEXT_PUBLIC_GATEWAY_URL ?? 'http://127.0.0.1:3000';
const TENANT_A = '00000000-0000-4000-8000-000000000001';
const TENANT_B = '00000000-0000-4000-8000-0000000000bb';
const STUDENT_ID = '00000000-0000-4000-8000-000000000099';

function gatewayAuthHeaders(sub: string, tenantId: string = TENANT_A): Record<string, string> {
  const token = createSignedJwt({
    sub,
    email: `${sub}@tenant.test`,
    displayName: sub,
    tenantId,
    roles: [{ roleId: 'parent', roleName: 'Parent', areaId: null }],
  });
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-Tenant-ID': tenantId,
  };
}

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

test.describe('Parent portal — live writes (E2E_BACKEND_READY)', () => {
  test.skip(
    !BACKEND_READY,
    'Requires E2E_BACKEND_READY=1 and live gateway with parent-portal plugin',
  );

  test('link child, message, consent decide, sandbox fee pay', async ({ request }) => {
    const parentSub = `parent-e2e-${Date.now()}`;
    const link = await request.post(`${GATEWAY_URL}/api/v1/parent-portal/children/links`, {
      headers: gatewayAuthHeaders(parentSub),
      data: { studentId: STUDENT_ID, relationship: 'guardian' },
    });
    const linked = await link.json();
    expect(link.status(), JSON.stringify(linked)).toBe(201);

    const thread = await request.post(`${GATEWAY_URL}/api/v1/parent-portal/messages/threads`, {
      headers: gatewayAuthHeaders(parentSub),
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
        headers: gatewayAuthHeaders(parentSub),
        data: { body: 'Follow-up' },
      },
    );
    expect(reply.status(), await reply.text()).toBe(201);

    const consent = await request.post(`${GATEWAY_URL}/api/v1/parent-portal/consents`, {
      headers: gatewayAuthHeaders('staff-e2e'),
      data: {
        studentId: STUDENT_ID,
        parentUserId: parentSub,
        consentType: 'photo_media',
        title: 'E2E photo consent',
      },
    });
    const consentBody = await consent.json();
    expect(consent.status(), JSON.stringify(consentBody)).toBe(201);

    const decide = await request.post(
      `${GATEWAY_URL}/api/v1/parent-portal/consents/${consentBody.id}/decide`,
      {
        headers: gatewayAuthHeaders(parentSub),
        data: { status: 'approved' },
      },
    );
    expect(decide.status()).toBe(200);

    const invoice = await request.post(`${GATEWAY_URL}/api/v1/parent-portal/fees/invoices`, {
      headers: gatewayAuthHeaders('staff-e2e'),
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
        headers: gatewayAuthHeaders(parentSub),
        data: { method: 'sandbox' },
      },
    );
    const paid = await pay.json();
    expect(pay.status(), JSON.stringify(paid)).toBe(200);
  });

  test('cross-tenant deny: tenant B cannot list tenant A children', async ({ request }) => {
    await request.post(`${GATEWAY_URL}/api/v1/parent-portal/children/links`, {
      headers: gatewayAuthHeaders('parent-iso'),
      data: { studentId: STUDENT_ID, relationship: 'guardian' },
    });

    const cross = await request.get(`${GATEWAY_URL}/api/v1/parent-portal/children`, {
      headers: gatewayAuthHeaders('parent-iso', TENANT_B),
    });
    const body = await cross.json();
    expect(cross.status()).toBe(200);
    expect(body.data ?? body).toEqual([]);
  });
});
