/**
 * Campus communication — gated live write smoke.
 * Uses HS256 cookies (`setupGatewayTenantSession`) so api-gateway jwtVerify accepts writes.
 * Does not relax production auth. Requires JWT_SECRET aligned with the gateway.
 */
import { expect, test } from '@playwright/test';

import { createSignedJwt, setupGatewayTenantSession } from './fixtures/fake-session';

const BACKEND_READY = !!process.env.E2E_BACKEND_READY;
const GATEWAY_URL =
  process.env.E2E_GATEWAY_URL ?? process.env.NEXT_PUBLIC_GATEWAY_URL ?? 'http://127.0.0.1:3000';
const TENANT_A = '00000000-0000-4000-8000-000000000001';
const TENANT_B = '00000000-0000-4000-8000-0000000000bb';
const TENANT_ID = TENANT_A;

function gatewayAuthHeaders(sub: string, tenantId: string = TENANT_A): Record<string, string> {
  const token = createSignedJwt({
    sub,
    email: `${sub}@tenant-a.test`,
    displayName: sub,
    tenantId,
    roles: [{ roleId: 'admin', roleName: 'Administrator', areaId: null }],
  });
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-Tenant-ID': tenantId,
  };
}

test.describe('Communication — client validation (ungated)', () => {
  test.beforeEach(async ({ page }) => {
    await setupGatewayTenantSession(page);
  });

  test('/communication/campaigns/new rejects empty name client-side', async ({ page }) => {
    await page.goto('/communication/campaigns/new', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('communication-campaign-form')).toHaveAttribute(
      'data-hydrated',
      'true',
    );
    await page.getByRole('button', { name: /create campaign/i }).click();
    await expect(page.getByText(/name is required/i)).toBeVisible();
  });
});

test.describe('Communication — live campaign create (E2E_BACKEND_READY)', () => {
  test.skip(
    !BACKEND_READY,
    'Requires E2E_BACKEND_READY=1 and live gateway (JWT uses JWT_SECRET or gateway default)',
  );

  test.beforeEach(async ({ page }) => {
    await setupGatewayTenantSession(page);
  });

  test('creates a draft campaign via live API', async ({ page }) => {
    await page.goto('/communication/campaigns/new', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('communication-campaign-form')).toHaveAttribute(
      'data-hydrated',
      'true',
    );

    const name = `E2E campaign ${Date.now()}`;
    await page.getByLabel(/^name/i).fill(name);
    await page.getByLabel(/message body/i).fill('Created by campus live write smoke.');
    await page.getByRole('button', { name: /create campaign/i }).click();

    await expect(page).toHaveURL(/\/communication\/campaigns/, { timeout: 20_000 });
    await expect(page.getByText(name)).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('Communication — live emergency dual-confirm (E2E_BACKEND_READY)', () => {
  test.skip(
    !BACKEND_READY,
    'Requires E2E_BACKEND_READY=1 and live gateway (JWT uses JWT_SECRET or gateway default)',
  );

  test('drafts an emergency blast that awaits dual confirm', async ({ page }) => {
    await setupGatewayTenantSession(page, { sub: 'officer-a' });
    await page.goto('/communication/emergency', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('emergency-blast-form')).toHaveAttribute('data-hydrated', 'true');

    const reason = `E2E emergency ${Date.now()}`;
    await page.getByLabel(/^reason/i).fill(reason);
    await page.getByLabel(/acknowledge dual confirm/i).check();
    await page.getByRole('button', { name: /draft blast/i }).click();

    await expect(page.getByText(reason)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/pending_confirm/i).first()).toBeVisible();
  });

  test('dual-confirms then sandbox-dispatches via gateway API', async ({ request }) => {
    const createRes = await request.post(`${GATEWAY_URL}/api/v1/communication/emergency`, {
      headers: gatewayAuthHeaders('officer-a'),
      data: {
        reason: `API dual-confirm ${Date.now()}`,
        channels: ['sms', 'push'],
        createdBy: 'officer-a',
      },
    });
    expect(createRes.status()).toBe(201);
    const blast = await createRes.json();

    const first = await request.post(
      `${GATEWAY_URL}/api/v1/communication/emergency/${blast.id}/confirm`,
      {
        headers: gatewayAuthHeaders('officer-a'),
        data: { actorId: 'officer-a' },
      },
    );
    expect(first.status()).toBe(200);
    expect((await first.json()).status).toBe('pending_confirm');

    const second = await request.post(
      `${GATEWAY_URL}/api/v1/communication/emergency/${blast.id}/confirm`,
      {
        headers: gatewayAuthHeaders('officer-b'),
        data: { actorId: 'officer-b' },
      },
    );
    expect(second.status()).toBe(200);
    expect((await second.json()).status).toBe('confirmed');

    // Bodyless POST with Content-Type: application/json (gateway must accept empty → {}).
    const dispatch = await request.post(
      `${GATEWAY_URL}/api/v1/communication/emergency/${blast.id}/dispatch`,
      { headers: gatewayAuthHeaders('officer-a') },
    );
    const dispatchBody = await dispatch.json();
    expect(dispatch.status(), JSON.stringify(dispatchBody)).toBe(200);
    expect(dispatchBody.status).toBe('sent');
    expect(dispatchBody.delivery.mode).toBe('sandbox');
  });
});

test.describe('Communication — campaign send + isolation (E2E_BACKEND_READY)', () => {
  test.skip(
    !BACKEND_READY,
    'Requires E2E_BACKEND_READY=1 and live gateway (JWT uses JWT_SECRET or gateway default)',
  );

  test('sandbox-sends a draft campaign via gateway API', async ({ request }) => {
    const create = await request.post(`${GATEWAY_URL}/api/v1/communication/campaigns`, {
      headers: gatewayAuthHeaders('comms-a'),
      data: {
        name: `API send ${Date.now()}`,
        body: 'Sandbox send smoke',
        channels: ['email', 'sms'],
        audienceJson: { scope: 'all' },
        createdBy: 'comms-a',
      },
    });
    const campaign = await create.json();
    expect(create.status(), JSON.stringify(campaign)).toBe(201);
    expect(campaign.status).toBe('draft');

    const send = await request.post(
      `${GATEWAY_URL}/api/v1/communication/campaigns/${campaign.id}/send`,
      { headers: gatewayAuthHeaders('comms-a') },
    );
    const body = await send.json();
    expect(send.status(), JSON.stringify(body)).toBe(200);
    expect(body.status).toBe('sent');
    expect(body.delivery.mode).toBe('sandbox');
    expect(String(body.delivery.honestyNote)).toMatch(/sandbox/i);
  });

  test('cross-tenant deny: tenant B cannot send tenant A campaign', async ({ request }) => {
    const create = await request.post(`${GATEWAY_URL}/api/v1/communication/campaigns`, {
      headers: gatewayAuthHeaders('comms-a', TENANT_A),
      data: {
        name: `Isolation ${Date.now()}`,
        body: 'Cross-tenant deny',
        channels: ['in_app'],
        audienceJson: { scope: 'all' },
        createdBy: 'comms-a',
      },
    });
    expect(create.status()).toBe(201);
    const campaign = await create.json();

    const cross = await request.post(
      `${GATEWAY_URL}/api/v1/communication/campaigns/${campaign.id}/send`,
      { headers: gatewayAuthHeaders('comms-b', TENANT_B) },
    );
    expect(cross.status()).toBe(404);
  });

  test('cross-tenant deny: tenant B cannot confirm tenant A emergency', async ({ request }) => {
    const create = await request.post(`${GATEWAY_URL}/api/v1/communication/emergency`, {
      headers: gatewayAuthHeaders('officer-a', TENANT_A),
      data: {
        reason: `Isolation emergency ${Date.now()}`,
        channels: ['sms'],
        createdBy: 'officer-a',
      },
    });
    expect(create.status()).toBe(201);
    const blast = await create.json();

    const cross = await request.post(
      `${GATEWAY_URL}/api/v1/communication/emergency/${blast.id}/confirm`,
      {
        headers: gatewayAuthHeaders('officer-b', TENANT_B),
        data: { actorId: 'officer-b' },
      },
    );
    expect(cross.status()).toBe(404);
  });
});
