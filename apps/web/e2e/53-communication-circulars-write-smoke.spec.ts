/**
 * Communication circulars — WhatsApp sandbox, ack, delivery log (Wave 9 / G-922).
 *
 * Ungated: communication overview and circulars pages render with a heading.
 * Gated (E2E_BACKEND_READY): circular → send → ack; tenant B isolation.
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import { createSignedJwt, setupGatewayTenantSession } from './fixtures/fake-session';

const BACKEND_READY = !!process.env.E2E_BACKEND_READY;
const GATEWAY_URL =
  process.env.E2E_GATEWAY_URL ?? process.env.NEXT_PUBLIC_GATEWAY_URL ?? 'http://127.0.0.1:3000';
const TENANT_A = '00000000-0000-4000-8000-000000000001';
const TENANT_B = '00000000-0000-4000-8000-0000000000bb';

function headers(tenantId = TENANT_A, sub = 'e2e-admin') {
  const token = createSignedJwt({
    sub,
    email: `${sub}@tenant-a.test`,
    displayName: 'E2E Admin',
    tenantId,
    roles: [{ roleId: 'admin', roleName: 'SUPER_ADMIN', areaId: null }],
    institutions: [],
  });
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-Tenant-ID': tenantId,
  };
}

function stamp() {
  return Date.now().toString(36).slice(-6).toUpperCase();
}

async function postOk(
  request: APIRequestContext,
  path: string,
  data: unknown,
  expected: number,
  tenantId = TENANT_A,
) {
  const res = await request.post(`${GATEWAY_URL}/api/v1${path}`, {
    headers: headers(tenantId),
    data,
  });
  expect(res.status(), `${path}: ${await res.text()}`).toBe(expected);
  return res.json();
}

async function hydrated(page: Page, testId: string) {
  const el = page.getByTestId(testId);
  await expect(el).toHaveAttribute('data-hydrated', 'true', { timeout: 20_000 });
  return el;
}

test.describe('Communication circulars — pages render (ungated)', () => {
  test.beforeEach(async ({ page }) => {
    await setupGatewayTenantSession(page);
  });

  test('/communication lists with a heading', async ({ page }) => {
    await page.goto('/communication', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('/communication/circulars/new hydrates the form', async ({ page }) => {
    await page.goto('/communication/circulars/new', { waitUntil: 'domcontentloaded' });
    await hydrated(page, 'communication-circular-form');
  });

  test('/communication/delivery renders the delivery log', async ({ page }) => {
    await page.goto('/communication/delivery', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1, name: /delivery log/i })).toBeVisible();
  });
});

test.describe('Communication circulars — live chain (E2E_BACKEND_READY)', () => {
  test.skip(!BACKEND_READY, 'Requires E2E_BACKEND_READY=1 and a live gateway + Postgres');

  test.beforeEach(async ({ page }) => {
    await setupGatewayTenantSession(page);
  });

  test('circular → send → ack', async ({ page, request }) => {
    const tag = stamp();
    const created = await postOk(
      request,
      '/communication/circulars',
      {
        title: `Holiday ${tag}`,
        body: 'School closed Friday. Please acknowledge.',
        audienceType: 'all',
        requiresAck: true,
        channels: ['whatsapp', 'in_app'],
        recipientIds: ['staff-e2e-1', 'staff-e2e-2'],
      },
      201,
    );
    expect(created.ackTotal).toBe(2);
    expect(created.ackRate).toBe(0);

    const sent = await postOk(request, `/communication/circulars/${created.id}/send`, {}, 200);
    expect(sent.status).toBe('sent');

    const logs = await request.get(
      `${GATEWAY_URL}/api/v1/communication/delivery-log?channel=whatsapp`,
      {
        headers: headers(),
      },
    );
    expect(logs.status()).toBe(200);
    expect((await logs.json()).data.length).toBeGreaterThan(0);

    const acked = await postOk(
      request,
      `/communication/circulars/${created.id}/ack`,
      { recipientId: 'staff-e2e-1' },
      200,
    );
    expect(acked.ackCount).toBe(1);
    expect(acked.ackRate).toBe(0.5);

    await page.goto(`/communication/circulars/${created.id}`, { waitUntil: 'domcontentloaded' });
    await hydrated(page, 'circular-ack-panel');
    await expect(page.getByTestId('circular-ack-row').first()).toBeVisible();
  });

  test('cross-tenant: tenant B cannot read tenant A circulars', async ({ request }) => {
    const created = await postOk(
      request,
      '/communication/circulars',
      {
        title: 'Private circular',
        body: 'Internal only',
        audienceType: 'institution',
        requiresAck: true,
        recipientIds: ['only-a'],
      },
      201,
    );
    const res = await request.get(`${GATEWAY_URL}/api/v1/communication/circulars/${created.id}`, {
      headers: headers(TENANT_B),
    });
    expect([403, 404], `circulars/${created.id} → ${res.status()}`).toContain(res.status());
  });
});
