import { createHmac } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const OUT = '/tmp/institutions-detail-captures';
const MAYUR = '00000000-0000-4000-8000-00000000a551';
const SECTION = '00000000-0000-4000-8000-00000000a572';
const LIVE = 'http://127.0.0.1:3001';
const PROTO = 'http://127.0.0.1:8099';

const pages = [
  { name: 'overview', proto: '/institutions/detail-overview.html', live: `/institutions/${MAYUR}/overview` },
  { name: 'classes', proto: '/institutions/detail-classes.html', live: `/institutions/${MAYUR}/classes` },
  { name: 'grades', proto: '/institutions/detail-grades.html', live: `/institutions/${MAYUR}/grades` },
  { name: 'schedule', proto: '/institutions/detail-schedule.html', live: `/institutions/${MAYUR}/schedule` },
  {
    name: 'schedule-section',
    proto: '/institutions/detail-schedule-section.html',
    live: `/institutions/${MAYUR}/schedule/${SECTION}`,
  },
];

const viewports = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 834, height: 1112 },
  { name: 'mobile', width: 390, height: 844 },
];

function signedJwt() {
  const now = Math.floor(Date.now() / 1000);
  const body = {
    iss: 'proctira-platform',
    aud: 'proctira-api',
    iat: now,
    exp: now + 60 * 60 * 8,
    sub: 'priya-sharma',
    email: 'priya.sharma@school.edu',
    displayName: 'Priya Sharma',
    tenantId: '00000000-0000-4000-8000-00000000a501',
    roles: [{ roleId: 'principal', roleName: 'Principal', areaId: null }],
  };
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const encoded = Buffer.from(JSON.stringify(body)).toString('base64url');
  const sig = createHmac('sha256', 'dev-secret-change-in-production')
    .update(`${header}.${encoded}`)
    .digest('base64url');
  return `${header}.${encoded}.${sig}`;
}

async function hidePrototypeChrome(page) {
  await page.evaluate(() => {
    document.querySelectorAll('.states, .review-fab, .review-drawer, .review-panel').forEach((el) => {
      el.remove();
    });
    document.querySelectorAll('[data-panel]').forEach((el) => {
      if (el.getAttribute('data-panel') !== 'filled') el.remove();
    });
  });
}

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
const token = signedJwt();

for (const vp of viewports) {
  const protoContext = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  const liveContext = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  await liveContext.addCookies([
    { name: 'access_token', value: token, url: LIVE },
    { name: 'refresh_token', value: token, url: LIVE },
  ]);
  const protoPage = await protoContext.newPage();
  const livePage = await liveContext.newPage();

  for (const item of pages) {
    await protoPage.goto(`${PROTO}${item.proto}`, { waitUntil: 'networkidle' });
    await hidePrototypeChrome(protoPage);
    await protoPage.screenshot({
      path: `${OUT}/${item.name}-${vp.name}-prototype.png`,
      fullPage: true,
    });

    await livePage.goto(`${LIVE}${item.live}`, { waitUntil: 'domcontentloaded' });
    await livePage.getByRole('heading', { name: /Sunrise Public School/ }).waitFor({ timeout: 20000 });
    if (vp.width >= 768) {
      await livePage
        .getByRole('navigation', { name: 'Breadcrumb' })
        .getByText('Sunrise Public School – Mayur Vihar')
        .waitFor({ timeout: 20000 });
      const shell = await livePage.locator('body').innerText();
      if (!shell.includes('Priya Sharma')) {
        throw new Error(`signed-out shell on ${item.live}`);
      }
    }
    const devBadge = await livePage.locator('nextjs-portal').count();
    if (devBadge > 0) throw new Error('Next dev badge is present; capture a production build');
    await livePage.waitForTimeout(300);
    const contentHeight = await livePage.evaluate(() => {
      const nodes = [document.scrollingElement, document.querySelector('main'), document.body];
      return Math.max(
        ...nodes.filter(Boolean).map((node) => node.scrollHeight || 0),
        window.innerHeight,
      );
    });
    await livePage.setViewportSize({
      width: vp.width,
      height: Math.min(Math.max(contentHeight + 32, vp.height), 5000),
    });
    await livePage.waitForTimeout(200);
    await livePage.screenshot({
      path: `${OUT}/${item.name}-${vp.name}-live.png`,
      fullPage: true,
    });
    console.log('captured', item.name, vp.name);
  }
  await protoContext.close();
  await liveContext.close();
}

await browser.close();
console.log('done', OUT);
