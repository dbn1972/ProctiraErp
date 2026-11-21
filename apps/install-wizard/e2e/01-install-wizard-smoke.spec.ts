import { expect, test } from '@playwright/test';

import { runAxe } from './helpers/axe';
import { E2E_BOOTSTRAP_SECRET, unlockWizard } from './helpers/install-session';

/**
 * Install Wizard production smoke.
 * First-run UI + axe + CSRF/bootstrap-lock BFF always run.
 * Optional upstream live install gates on E2E_BACKEND_READY.
 */
const BACKEND_READY = !!process.env.E2E_BACKEND_READY;

const CONFIGURE_PAYLOADS: Record<string, Record<string, unknown>> = {
  database: {
    provider: 'postgresql',
    host: 'localhost',
    port: 5432,
    database: 'proctira',
    username: 'admin',
    password: 'secret',
  },
  storage: {
    adapter: 'minio',
    bucket: 'files',
    endpoint: 'https://minio.example.com',
    accessKeyId: 'admin',
    secretAccessKey: 'secret',
  },
  cache: { adapter: 'redis', host: 'localhost', port: 6379 },
  queue: {
    backend: 'rabbitmq',
    rabbitmq: { url: 'amqps://mq.example.com:5671', exchange: 'proctira' },
  },
  cdn: { adapter: 'nginx', baseUrl: 'https://cdn.example.com', tenantAware: true },
};

test.describe('Install Wizard — first-run UI', () => {
  test('PRC-M467: home asks for the operator bootstrap secret first', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.ok()).toBeTruthy();
    await expect(page.getByRole('heading', { name: /operator verification/i })).toBeVisible();
    await expect(page.getByLabel('Bootstrap secret')).toHaveAttribute('type', 'password');
    await expect(page.getByTestId('database-step')).toHaveCount(0);
  });

  test('home loads with brand and Step 1 database fields', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.ok()).toBeTruthy();
    await unlockWizard(page);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByText(/Proctira/i).first()).toBeVisible();
    await expect(
      page.getByRole('heading', { name: /step 1.*database|database/i }).first(),
    ).toBeVisible();
    await expect(page.getByLabel(/host/i).first()).toBeVisible();
    await expect(page.getByTestId('database-step')).toBeVisible();
  });

  test('stepper lists all six setup stages', async ({ page }) => {
    await page.goto('/');
    await unlockWizard(page);
    for (const label of [
      'Database',
      'Object Storage',
      'Redis Cache',
      'Message Queue',
      'CDN',
      'Admin Account',
    ]) {
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
    }
  });

  test('database step shows client validation when credentials empty', async ({ page }) => {
    await page.goto('/');
    await unlockWizard(page);
    await page.getByTestId('database-test-submit').click();
    await expect(page.getByTestId('db-error-username')).toContainText(/required/i);
    await expect(page.getByTestId('db-error-password')).toContainText(/required/i);
  });

  test('footer links are not empty hash stubs', async ({ page }) => {
    await page.goto('/');
    const docs = page.getByRole('link', { name: /installation guide/i });
    const support = page.getByRole('link', { name: /get help/i });
    await expect(docs).toBeVisible();
    await expect(support).toBeVisible();
    const docsHref = await docs.getAttribute('href');
    const supportHref = await support.getAttribute('href');
    expect(docsHref).toBeTruthy();
    expect(supportHref).toBeTruthy();
    expect(docsHref).not.toMatch(/^#/);
    expect(supportHref).not.toMatch(/^#/);
  });

  test('health endpoint reports install-wizard', async ({ request }) => {
    const response = await request.get('/api/health');
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body).toMatchObject({ status: 'ok', service: 'install-wizard' });
  });
});

test.describe('Install Wizard — CSRF + bootstrap lock', () => {
  test('rejects mutate without CSRF; locks configure after finalize', async ({
    request,
  }, testInfo) => {
    // PRC-M467: the install lock is global, so only one project may engage it.
    test.skip(testInfo.project.name !== 'chromium', 'global install lock engaged once (chromium)');
    const denied = await request.post('/api/install/finalize', {
      data: {},
    });
    expect(denied.status()).toBe(403);
    const noSecret = await request.post('/api/install/session');
    expect(noSecret.status()).toBe(401);
    const sessionRes = await request.post('/api/install/session', {
      headers: { 'x-install-bootstrap-secret': E2E_BOOTSTRAP_SECRET },
    });
    expect(sessionRes.ok()).toBeTruthy();
    const session = (await sessionRes.json()) as {
      csrfToken: string;
      installToken: string;
    };
    expect(session.csrfToken).toBeTruthy();
    expect(session.installToken).toBeTruthy();

    const auth = {
      'x-csrf-token': session.csrfToken,
      'x-install-token': session.installToken,
    };

    const missingToken = await request.post('/api/install/configure/database', {
      headers: { 'x-csrf-token': session.csrfToken },
      data: CONFIGURE_PAYLOADS.database,
    });
    expect(missingToken.status()).toBe(401);

    for (const step of Object.keys(CONFIGURE_PAYLOADS)) {
      const res = await request.post(`/api/install/configure/${step}`, {
        headers: auth,
        data: CONFIGURE_PAYLOADS[step],
      });
      expect(res.ok(), `configure ${step} → ${res.status()}`).toBeTruthy();
    }

    const finalized = await request.post('/api/install/finalize', {
      headers: auth,
      data: {},
    });
    expect(finalized.ok()).toBeTruthy();
    const finBody = await finalized.json();
    expect(finBody.success).toBe(true);

    const lockedConfigure = await request.post('/api/install/configure/database', {
      headers: auth,
      data: CONFIGURE_PAYLOADS.database,
    });
    expect(lockedConfigure.status()).toBe(409);
    expect((await lockedConfigure.json()).error).toMatch(/already finalized|locked/i);

    const lockedFinalize = await request.post('/api/install/finalize', {
      headers: auth,
      data: {},
    });
    expect(lockedFinalize.status()).toBe(409);

    const status = await request.get('/api/install/status', { headers: auth });
    expect(status.ok()).toBeTruthy();
    expect((await status.json()).isComplete).toBe(true);
    // PRC-M467: a fresh session cannot be opened once installed.
    const fresh = await request.post('/api/install/session', {
      headers: { 'x-install-bootstrap-secret': E2E_BOOTSTRAP_SECRET },
    });
    expect(fresh.status()).toBe(409);
  });
});

test.describe('Install Wizard — axe WCAG 2.1 AA', () => {
  test('operator gate has no critical axe violations', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByLabel('Bootstrap secret')).toBeVisible();
    await runAxe(page, { checkpointLabel: 'install-wizard-gate' });
  });

  test('setup home has no critical axe violations', async ({ page }) => {
    await page.goto('/');
    await unlockWizard(page);
    await expect(page.getByTestId('database-step')).toBeVisible();
    await runAxe(page, { checkpointLabel: 'install-wizard-home' });
  });
});

test.describe('Install Wizard — live install API', () => {
  test.skip(!BACKEND_READY, 'E2E_BACKEND_READY is not set; skipping live install e2e.');

  test('status endpoint reachable when backend ready', async ({ request }) => {
    const base = process.env.NEXT_PUBLIC_INSTALL_API_URL ?? 'http://127.0.0.1:3000/install';
    const response = await request.get(`${base}/status`);
    expect(response.ok()).toBeTruthy();
  });
});
