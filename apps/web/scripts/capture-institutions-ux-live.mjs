/**
 * Live Sunrise captures for Institutions UX (List, Overview, Edit, New,
 * Classes, Grades, Schedule) at 1440 / 834 / 390 into docs/audits/captures/.
 */
import { createHmac } from 'node:crypto';
import { mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3001';
const SUNRISE = '00000000-0000-4000-8000-00000000a501';
const MAYUR = '00000000-0000-4000-8000-00000000a551';
const SECRET = process.env.JWT_SECRET ?? 'dev-secret-change-in-production';

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 834, height: 1112 },
  { name: 'mobile', width: 390, height: 844 },
];

const ROUTES = [
  { key: 'list', dir: 'institutions-list', file: 'filled', path: '/institutions' },
  { key: 'new', dir: 'institutions-new', file: 'form', path: '/institutions/new' },
  {
    key: 'overview',
    dir: 'institutions-detail',
    file: 'overview',
    path: `/institutions/${MAYUR}/overview`,
  },
  {
    key: 'edit',
    dir: 'institutions-edit',
    file: 'form',
    path: `/institutions/${MAYUR}/edit`,
  },
  {
    key: 'classes',
    dir: 'institutions-detail',
    file: 'classes',
    path: `/institutions/${MAYUR}/classes`,
  },
  {
    key: 'grades',
    dir: 'institutions-detail',
    file: 'grades',
    path: `/institutions/${MAYUR}/grades`,
  },
  {
    key: 'schedule',
    dir: 'institutions-detail',
    file: 'schedule',
    path: `/institutions/${MAYUR}/schedule`,
  },
];

function mintToken() {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const header = b64({ alg: 'HS256', typ: 'JWT' });
  const payload = b64({
    iss: 'proctira-platform',
    aud: 'proctira-api',
    iat: now,
    exp: now + 86_400,
    sub: 'priya-sharma',
    email: 'priya.sharma@school.edu',
    displayName: 'Priya Sharma',
    tenantId: SUNRISE,
    roles: [{ roleId: 'principal', roleName: 'Principal', areaId: null }],
  });
  const data = `${header}.${payload}`;
  return `${data}.${createHmac('sha256', SECRET).update(data).digest('base64url')}`;
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const token = mintToken();
await context.addCookies([
  { name: 'access_token', value: token, url: BASE },
  { name: 'refresh_token', value: token, url: BASE },
]);

for (const route of ROUTES) {
  const outDir = path.join(ROOT, 'docs/audits/captures', route.dir);
  await mkdir(outDir, { recursive: true });
  for (const vp of VIEWPORTS) {
    const page = await context.newPage();
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto(`${BASE}${route.path}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForTimeout(1500);
    const file = `${route.file}-${vp.name}-live.png`;
    const out = path.join(outDir, file);
    await page.screenshot({ path: out, fullPage: true });
    console.log('wrote', path.relative(ROOT, out));
    await page.close();
  }
}

await browser.close();
console.log('done');
