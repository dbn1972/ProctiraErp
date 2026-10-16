/**
 * Multidevice screen capture for Public Website.
 *
 *   node scripts/capture-multidevice.mjs [desktop|tablet|mobile ...]
 *
 * Writes PNGs under <repo>/artifacts/public-website-audit/multidevice/
 * (override with CAPTURE_OUT_DIR) and a summary.json. Requires the app at
 * PLAYWRIGHT_BASE_URL (default :3004).
 *
 * PRC-L404: the default output dir is repo-relative (no hard-coded /opt/cursor
 * environment path), any route that fails or returns a non-2xx status is
 * recorded in summary.json, and the process exits non-zero so a failed capture
 * can never be mistaken for a complete evidence pack.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3004';
// Default to a repo-relative artifacts dir (scripts/.. is the app root; ../..
// is the repo root) instead of a tool-specific absolute path.
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT_ROOT = path.resolve(
  SCRIPT_DIR,
  '..',
  '..',
  '..',
  'artifacts',
  'public-website-audit',
  'multidevice',
);
const OUT_ROOT = process.env.CAPTURE_OUT_DIR ?? DEFAULT_OUT_ROOT;

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
const failures = [];

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
      const status = resp?.status() ?? 0;
      // PRC-L404: a non-2xx response is a failure even though goto() does not
      // throw for it — otherwise a 404 page would be captured as "success".
      if (status < 200 || status >= 300) {
        failures.push({ profile, route, status });
        console.log(`  ✗ ${name}@${vp.width}  ${route}  — HTTP ${status}`);
        continue;
      }
      await page.waitForTimeout(1200);
      await page.screenshot({ path: file, fullPage: true });
      files.push(path.basename(file));
      console.log(`  ✓ ${name}@${vp.width}  HTTP ${status}  ${route}`);
    } catch (err) {
      failures.push({ profile, route, error: err.message.split('\n')[0] });
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
      failures,
      captured_at: new Date().toISOString().slice(0, 10),
    },
    null,
    2,
  ),
);

// PRC-L404: fail the process when any route failed so a partial evidence pack
// is never mistaken for a complete one.
if (failures.length > 0) {
  process.exitCode = 1;
  console.error(`Done with ${failures.length} failure(s); ${files.length} captured → ${OUT_ROOT}`);
} else {
  console.log(`Done: ${files.length} captured → ${OUT_ROOT}`);
}
