/**
 * Multidevice screen capture for Public Website.
 *
 *   node scripts/capture-multidevice.mjs [desktop|tablet|mobile ...]
 *
 * Writes PNGs under /opt/cursor/artifacts/public-website-audit/multidevice/
 * (and a summary.json). Requires the app at PLAYWRIGHT_BASE_URL (default :3004).
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { chromium } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3004';
const OUT_ROOT =
  process.env.CAPTURE_OUT_DIR ??
  '/opt/cursor/artifacts/public-website-audit/multidevice';

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 834, height: 1112 },
  mobile: { width: 390, height: 844 },
};

const ROUTES = [
  ['home', '/'],
  ['product', '/product'],
  ['status', '/status'],
  ['contact', '/contact'],
  ['about', '/about'],
  ['privacy', '/privacy'],
  ['legal', '/legal'],
];

const requested = process.argv.slice(2).filter((a) => VIEWPORTS[a]);
const ACTIVE = requested.length > 0 ? requested : Object.keys(VIEWPORTS);

await mkdir(OUT_ROOT, { recursive: true });
const browser = await chromium.launch();
const files = [];

for (const profile of ACTIVE) {
  const vp = VIEWPORTS[profile];
  const context = await browser.newContext({
    viewport: vp,
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  for (const [name, route] of ROUTES) {
    const file = path.join(OUT_ROOT, `${name}-${vp.width}.png`);
    try {
      const resp = await page.goto(`${BASE_URL}${route}`, {
        waitUntil: 'domcontentloaded',
        timeout: 30_000,
      });
      await page.waitForTimeout(1200);
      await page.screenshot({ path: file, fullPage: true });
      files.push(path.basename(file));
      console.log(`  ✓ ${name}@${vp.width}  HTTP ${resp?.status() ?? '?'}  ${route}`);
    } catch (err) {
      console.log(`  ✗ ${name}@${vp.width}  ${route}  — ${err.message.split('\n')[0]}`);
    }
  }
  await context.close();
}

await browser.close();
await writeFile(
  path.join(OUT_ROOT, 'summary.json'),
  JSON.stringify(
    {
      pack: 'public-website-audit/multidevice',
      baseUrl: BASE_URL,
      viewports: ACTIVE,
      count: files.length,
      files: files.sort(),
      captured_at: new Date().toISOString().slice(0, 10),
    },
    null,
    2,
  ),
);
console.log(`Done: ${files.length} captured → ${OUT_ROOT}`);
