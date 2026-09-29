/**
 * Captures the institutions directory against the sunrise mock gateway.
 * Review-only SCREEN STATE chips are not part of this surface.
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

import { chromium } from '@playwright/test';

const OUT = '/opt/cursor/artifacts/institutions-directory';
const WEB = 'http://127.0.0.1:3011';
const GATEWAY = 'http://127.0.0.1:3999';

function jwt() {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const body = Buffer.from(
    JSON.stringify({
      sub: 'priya-sharma',
      email: 'priya.sharma@sunrise.test',
      displayName: 'Priya Sharma',
      tenantId: '00000000-0000-4000-8000-00000000a501',
      roles: [{ roleId: 'principal', roleName: 'Principal', areaId: null }],
      iat: now,
      exp: now + 60 * 60,
    }),
  ).toString('base64url');
  return `${header}.${body}.sig`;
}

function start(cmd, args, env) {
  const child = spawn(cmd, args, {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (buf) => process.stdout.write(buf));
  child.stderr.on('data', (buf) => process.stderr.write(buf));
  return child;
}

async function waitFor(url, timeoutMs = 120000) {
  const startAt = Date.now();
  while (Date.now() - startAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status < 500) return;
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function shoot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  console.log('captured', name);
}

const gateway = start('node', ['scripts/mock-gateway.mjs'], {
  PORT: '3999',
  SUNRISE_DIRECTORY: '1',
});
const web = start('pnpm', ['exec', 'next', 'dev', '--port', '3011'], {
  GATEWAY_URL: GATEWAY,
  NEXT_PUBLIC_GATEWAY_URL: GATEWAY,
  PORT: '3011',
});

try {
  mkdirSync(OUT, { recursive: true });
  await waitFor(`${GATEWAY}/api/v1/institutions/directory-context`);
  await waitFor(`${WEB}/login`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await context.addCookies([
    { name: 'access_token', value: jwt(), url: WEB },
    { name: 'refresh_token', value: jwt(), url: WEB },
  ]);
  const page = await context.newPage();

  const viewports = [
    ['desktop', { width: 1440, height: 900 }],
    ['tablet', { width: 834, height: 1112 }],
    ['mobile', { width: 390, height: 844 }],
  ];

  for (const [label, viewport] of viewports) {
    await page.setViewportSize(viewport);
    await page.goto(`${WEB}/institutions`, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: 'Institutions' }).first().waitFor();
    await shoot(page, `${label}-filled`);

    await page.goto(`${WEB}/institutions?search=zzzz-no-match`, { waitUntil: 'networkidle' });
    await page.getByTestId('institutions-empty').waitFor();
    await shoot(page, `${label}-empty`);

    await page.goto(`${WEB}/institutions?search=__error__`, { waitUntil: 'networkidle' });
    await page.getByTestId('institutions-error').waitFor();
    await shoot(page, `${label}-error`);
  }

  await browser.close();
  gateway.kill('SIGTERM');

  const slowGateway = start('node', ['scripts/mock-gateway.mjs'], {
    PORT: '3999',
    SUNRISE_DIRECTORY: '1',
    SUNRISE_DELAY_MS: '4000',
  });
  await waitFor(`${GATEWAY}/api/v1/tenant/branding`);
  const browser2 = await chromium.launch({ headless: true });
  const context2 = await browser2.newContext();
  await context2.addCookies([
    { name: 'access_token', value: jwt(), url: WEB },
    { name: 'refresh_token', value: jwt(), url: WEB },
  ]);
  const page2 = await context2.newPage();
  for (const [label, viewport] of viewports) {
    await page2.setViewportSize(viewport);
    const pending = page2.goto(`${WEB}/institutions?loading=1`, { waitUntil: 'commit' });
    await page2.getByTestId('institutions-loading').waitFor({ timeout: 20000 });
    await shoot(page2, `${label}-loading`);
    await pending;
  }
  await browser2.close();
  slowGateway.kill('SIGTERM');
} finally {
  gateway.kill('SIGTERM');
  web.kill('SIGTERM');
}
