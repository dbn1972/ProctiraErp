/**
 * Generic single-app screen capture.
 *
 *   node scripts/capture-app.mjs <baseUrl> <outDir> <routesJsonFile> [cookieToken]
 *
 * routesJsonFile: JSON array of { module, name, path }.
 * Writes <outDir>/<module>/<name>.png (full-page, 1440x900). If a cookie token
 * is given it is set as access_token/refresh_token (for auth-gated apps).
 */
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { chromium } from '@playwright/test';

const [, , BASE_URL, OUT_DIR, ROUTES_FILE, TOKEN, COOKIE_PREFIX] = process.argv;
if (!BASE_URL || !OUT_DIR || !ROUTES_FILE) {
  console.error('usage: capture-app.mjs <baseUrl> <outDir> <routesJsonFile> [cookieToken] [cookiePrefix]');
  process.exit(2);
}
// cookiePrefix '' -> access_token/refresh_token; 'admin_' -> admin_access_token/...
const prefix = COOKIE_PREFIX ?? '';

const routes = JSON.parse(await readFile(ROUTES_FILE, 'utf8'));

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
});
if (TOKEN) {
  await context.addCookies([
    { name: `${prefix}access_token`, value: TOKEN, url: BASE_URL },
    { name: `${prefix}refresh_token`, value: TOKEN, url: BASE_URL },
  ]);
}
const page = await context.newPage();

let ok = 0;
let fail = 0;
for (const { module, name, path: route } of routes) {
  const dir = path.join(OUT_DIR, module);
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${name}.png`);
  try {
    const resp = await page.goto(`${BASE_URL}${route}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
    await page.waitForTimeout(2200);
    await page.screenshot({ path: file, fullPage: true });
    ok += 1;
    console.log(`  ✓ ${module}/${name}  (HTTP ${resp?.status() ?? '?'})  ${route}`);
  } catch (err) {
    fail += 1;
    console.log(`  ✗ ${module}/${name}  ${route}  — ${err.message.split('\n')[0]}`);
  }
}

await browser.close();
console.log(`Done: ${ok} captured, ${fail} failed → ${OUT_DIR}`);
