import { createHmac } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const OUT = '/workspace/docs/audits/captures/institutions-timetable/';
const MAYUR = '00000000-0000-4000-8000-00000000a551';
const LIVE = 'http://127.0.0.1:3001';
const PROTO = 'http://127.0.0.1:8099';

const pages = [
  {
    name: 'timetable',
    proto: '/institutions/detail-timetable.html',
    live: `/institutions/${MAYUR}/timetable`,
  },
  {
    name: 'generate',
    proto: '/institutions/detail-timetable-generate.html',
    live: `/institutions/${MAYUR}/timetable/generate`,
  },
  {
    name: 'substitutions',
    proto: '/institutions/detail-timetable-substitutions.html',
    live: `/institutions/${MAYUR}/timetable/substitutions`,
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
    document
      .querySelectorAll('.states, .review-fab, .review-drawer, .review-panel')
      .forEach((el) => {
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
  const protoContext = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
  });
  const liveContext = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
  });
  await liveContext.addCookies([
    { name: 'access_token', value: token, url: LIVE },
    { name: 'refresh_token', value: token, url: LIVE },
  ]);
  const protoPage = await protoContext.newPage();
  const livePage = await liveContext.newPage();

  for (const item of pages) {
    await protoPage.goto(`${PROTO}${item.proto}`, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    await hidePrototypeChrome(protoPage);
    await protoPage.screenshot({
      path: `${OUT}/${item.name}-${vp.name}-prototype.png`,
      fullPage: true,
    });
    await livePage.goto(`${LIVE}${item.live}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await livePage.waitForTimeout(2500);
    if (await livePage.getByRole('heading', { name: 'Unable to load institutions' }).count()) {
      await livePage.waitForTimeout(8000);
      await livePage.reload({ waitUntil: 'domcontentloaded' });
      await livePage.waitForTimeout(2000);
    }
    await livePage.screenshot({ path: `${OUT}/${item.name}-${vp.name}-live.png`, fullPage: true });
  }
  await protoContext.close();
  await liveContext.close();
}

await browser.close();
console.log('captures written to', OUT);
