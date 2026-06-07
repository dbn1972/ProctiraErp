/**
 * Module-wise screen capture for the ProctiraERP web app.
 *
 * Drives a headless Chromium over every static (non-:id) route, grouped by
 * module, and writes a full-page PNG to `screens/<module>/<screen>.png`.
 *
 * Assumes the dev server is already running on PLAYWRIGHT_BASE_URL
 * (default http://localhost:3001). Dashboard routes are auth-gated, so we set a
 * locally-decoded access_token cookie (the middleware only checks the JWT `exp`,
 * it does not verify the signature). With no backend, data fetches fail and the
 * pages render their loading/empty/error states — which is still the real screen.
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_ROOT = path.resolve(__dirname, '..', 'screens');
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3001';

/**
 * Viewport profiles. The dashboard chrome switches at 768px: < 768 renders the
 * MobileShell, >= 768 the DesktopShell. `suffix` is appended to the file name
 * ('' = the canonical desktop PNG, so existing links keep working).
 */
const VIEWPORTS = {
  desktop: { suffix: '', width: 1440, height: 900 },
  tablet: { suffix: '.tablet', width: 834, height: 1112 },
  mobile: { suffix: '.mobile', width: 390, height: 844 },
};

// Which profiles to capture this run: `node capture-screens.mjs mobile tablet`.
// Defaults to all three.
const requested = process.argv.slice(2).filter((a) => VIEWPORTS[a]);
const ACTIVE = requested.length > 0 ? requested : Object.keys(VIEWPORTS);

// A far-future, unsigned JWT (alg=none). The middleware/requireSession only
// base64-decode the payload to read `exp`/`tenantId`; they never verify it.
function mintToken() {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const header = b64({ alg: 'none', typ: 'JWT' });
  const payload = b64({
    sub: '00000000-0000-4000-8000-000000000001',
    tenantId: '00000000-0000-4000-8000-0000000000aa',
    email: 'demo@proctira.dev',
    displayName: 'Demo Admin',
    roles: [{ roleId: 'super-admin', areaId: null }],
    exp: Math.floor(Date.now() / 1000) + 86_400,
  });
  return `${header}.${payload}.sig`;
}

// module -> [ [screenName, path], ... ]
const SCREENS = {
  auth: [
    ['login', '/login'],
    ['signup', '/signup'],
    ['forgot-password', '/forgot-password'],
    ['reset-password', '/reset-password'],
    ['mfa', '/mfa'],
  ],
  public: [['track', '/track']],
  dashboard: [['overview', '/']],
  students: [
    ['list', '/students'],
    ['new', '/students/new'],
    ['import', '/students/import'],
  ],
  staff: [
    ['list', '/staff'],
    ['new', '/staff/new'],
  ],
  institutions: [
    ['list', '/institutions'],
    ['new', '/institutions/new'],
  ],
  'academic-periods': [['list', '/academic-periods']],
  attendance: [
    ['mark', '/attendance'],
    ['reports', '/attendance/reports'],
  ],
  assessments: [
    ['list', '/assessments'],
    ['items', '/assessments/items'],
    ['results', '/assessments/results'],
    ['scheme-new', '/assessments/schemes/new'],
  ],
  examinations: [
    ['list', '/examinations'],
    ['new', '/examinations/new'],
  ],
  workflows: [
    ['list', '/workflows'],
    ['approvals', '/workflows/approvals'],
    ['instances', '/workflows/instances'],
    ['definition-new', '/workflows/definitions/new'],
  ],
  scholarships: [
    ['list', '/scholarships'],
    ['applications', '/scholarships/applications'],
    ['disbursements', '/scholarships/disbursements'],
    ['program-new', '/scholarships/programs/new'],
  ],
  reports: [
    ['list', '/reports'],
    ['new', '/reports/new'],
  ],
  health: [
    ['list', '/health'],
    ['counselling', '/health/counselling'],
    ['special-needs', '/health/special-needs'],
  ],
  'data-warehouse': [
    ['overview', '/data-warehouse'],
    ['import', '/data-warehouse/import'],
    ['map', '/data-warehouse/map'],
  ],
  admin: [
    ['overview', '/admin'],
    ['users', '/admin/users'],
    ['roles', '/admin/roles'],
    ['permissions', '/admin/permissions'],
    ['tenant', '/admin/tenant'],
  ],
};

async function main() {
  const token = mintToken();
  const browser = await chromium.launch();
  let ok = 0;
  let fail = 0;

  for (const profile of ACTIVE) {
    const vp = VIEWPORTS[profile];
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 1,
      isMobile: profile === 'mobile',
      hasTouch: profile !== 'desktop',
    });
    await context.addCookies([
      { name: 'access_token', value: token, url: BASE_URL },
      { name: 'refresh_token', value: token, url: BASE_URL },
    ]);
    const page = await context.newPage();

    let pOk = 0;
    let pFail = 0;
    for (const [module, screens] of Object.entries(SCREENS)) {
      const dir = path.join(OUT_ROOT, module);
      await mkdir(dir, { recursive: true });
      for (const [name, route] of screens) {
        const file = path.join(dir, `${name}${vp.suffix}.png`);
        try {
          await page.goto(`${BASE_URL}${route}`, {
            waitUntil: 'domcontentloaded',
            timeout: 30_000,
          });
          await page.waitForTimeout(2500);
          await page.screenshot({ path: file, fullPage: true });
          pOk += 1;
        } catch (err) {
          pFail += 1;
          console.log(`  ✗ [${profile}] ${module}/${name}  — ${err.message.split('\n')[0]}`);
        }
      }
    }
    await context.close();
    ok += pOk;
    fail += pFail;
    console.log(`[${profile}] ${vp.width}x${vp.height}: ${pOk} captured, ${pFail} failed.`);
  }

  await browser.close();
  console.log(`\nScreens written under: ${OUT_ROOT}`);
  console.log(`Done: ${ok} captured, ${fail} failed across ${ACTIVE.length} viewport(s).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
