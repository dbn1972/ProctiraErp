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
// Cookie host must match this origin exactly (localhost ≠ 127.0.0.1) or
// dashboard captures silently land on /login.
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

// Optional module filter: CAPTURE_MODULES=students,staff,attendance
const MODULE_FILTER = (process.env.CAPTURE_MODULES ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// A far-future, unsigned JWT (alg=none). The middleware/requireSession only
// base64-decode the payload to read `exp`/`tenantId`; they never verify it.
// CAPTURE_ROLE=parent|guardian|student|admin (default admin) for shell-accurate demos.
function mintToken() {
  const roleKey = (process.env.CAPTURE_ROLE ?? 'admin').toLowerCase();
  const roleMap = {
    parent: {
      email: 'parent@proctira.dev',
      displayName: 'Demo Parent',
      roles: [{ roleId: 'parent', roleName: 'Parent', areaId: null }],
    },
    guardian: {
      email: 'guardian@proctira.dev',
      displayName: 'Demo Guardian',
      roles: [{ roleId: 'guardian', roleName: 'Guardian', areaId: null }],
    },
    student: {
      email: 'student@proctira.dev',
      displayName: 'Demo Student',
      roles: [{ roleId: 'student', roleName: 'Student', areaId: null }],
    },
    admin: {
      email: 'demo@proctira.dev',
      displayName: 'Demo Admin',
      roles: [{ roleId: 'super-admin', roleName: 'SUPER_ADMIN', areaId: null }],
    },
  };
  const identity = roleMap[roleKey] ?? roleMap.admin;
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const header = b64({ alg: 'none', typ: 'JWT' });
  const payload = b64({
    sub: '00000000-0000-4000-8000-000000000001',
    tenantId: '00000000-0000-4000-8000-0000000000aa',
    email: identity.email,
    displayName: identity.displayName,
    roles: identity.roles,
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
    ['logout', '/logout'],
    ['oauth-callback', '/oauth/callback'],
  ],
  public: [['track', '/track']],
  dashboard: [['overview', '/']],
  students: [
    ['list', '/students'],
    ['new', '/students/new'],
    ['import', '/students/import'],
    [
      'profile',
      `/students/${process.env.STUDENT_ID ?? process.env.E2E_STUDENT_ID ?? 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'}`,
    ],
    [
      'edit',
      `/students/${process.env.STUDENT_ID ?? process.env.E2E_STUDENT_ID ?? 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'}/edit`,
    ],
    [
      'transfer',
      `/students/${process.env.STUDENT_ID ?? process.env.E2E_STUDENT_ID ?? 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'}/transfer`,
    ],
  ],
  staff: [
    ['list', '/staff'],
    ['new', '/staff/new'],
    [
      'profile',
      `/staff/${process.env.STAFF_ID ?? process.env.E2E_STAFF_ID ?? 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'}`,
    ],
    [
      'edit',
      `/staff/${process.env.STAFF_ID ?? process.env.E2E_STAFF_ID ?? 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'}/edit`,
    ],
    [
      'assignment-new',
      `/staff/${process.env.STAFF_ID ?? process.env.E2E_STAFF_ID ?? 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'}/assignments/new`,
    ],
    [
      'appraisal-new',
      `/staff/${process.env.STAFF_ID ?? process.env.E2E_STAFF_ID ?? 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1'}/appraisals/new`,
    ],
  ],
  institutions: [
    ['list', '/institutions'],
    ['new', '/institutions/new'],
    [
      'profile',
      `/institutions/${process.env.INSTITUTION_ID ?? '11111111-1111-4111-8111-111111111111'}`,
    ],
    [
      'overview',
      `/institutions/${process.env.INSTITUTION_ID ?? '11111111-1111-4111-8111-111111111111'}/overview`,
    ],
    [
      'edit',
      `/institutions/${process.env.INSTITUTION_ID ?? '11111111-1111-4111-8111-111111111111'}/edit`,
    ],
    [
      'classes',
      `/institutions/${process.env.INSTITUTION_ID ?? '11111111-1111-4111-8111-111111111111'}/classes`,
    ],
    [
      'grades',
      `/institutions/${process.env.INSTITUTION_ID ?? '11111111-1111-4111-8111-111111111111'}/grades`,
    ],
    [
      'infrastructure',
      `/institutions/${process.env.INSTITUTION_ID ?? '11111111-1111-4111-8111-111111111111'}/infrastructure`,
    ],
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
    [
      'definition-detail',
      `/workflows/definitions/${process.env.WORKFLOW_DEFINITION_ID ?? 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1'}`,
    ],
  ],
  scholarships: [
    ['programs', '/scholarships'],
    ['program-new', '/scholarships/programs/new'],
    [
      'program-detail',
      `/scholarships/programs/${process.env.SCHOLARSHIP_PROGRAM_ID ?? '11111111-1111-4111-8111-111111111111'}`,
    ],
    ['applications', '/scholarships/applications'],
    [
      'application-detail',
      `/scholarships/applications/${process.env.SCHOLARSHIP_APPLICATION_ID ?? '22222222-2222-4222-8222-222222222222'}`,
    ],
    ['disbursements', '/scholarships/disbursements'],
  ],
  reports: [
    ['list', '/reports'],
    ['new', '/reports/new'],
    [
      'results',
      `/reports/${process.env.REPORT_TEMPLATE_ID ?? 'rrrrrrrr-rrrr-4rrr-8rrr-rrrrrrrrrrr1'}/results`,
    ],
  ],
  health: [
    ['list', '/health'],
    ['screenings', '/health/screenings'],
    [
      'student-profile',
      `/health/${process.env.HEALTH_STUDENT_ID ?? 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'}`,
    ],
    ['counselling', '/health/counselling'],
    ['counselling-new', '/health/counselling/new'],
    ['special-needs', '/health/special-needs'],
  ],
  notifications: [
    ['inbox', '/notifications'],
    ['rules', '/admin/notification-rules'],
  ],
  transport: [
    ['overview', '/transport'],
    ['routes', '/transport/routes'],
    ['route-new', '/transport/routes/new'],
    ['vehicles', '/transport/vehicles'],
    ['assignments', '/transport/assignments'],
  ],
  communication: [
    ['overview', '/communication'],
    ['campaigns', '/communication/campaigns'],
    ['campaign-new', '/communication/campaigns/new'],
    ['emergency', '/communication/emergency'],
  ],
  hostel: [
    ['overview', '/hostel'],
    ['structure', '/hostel/structure'],
    ['assignments', '/hostel/assignments'],
    ['leaves', '/hostel/leaves'],
    ['visitors', '/hostel/visitors'],
  ],
  library: [
    ['catalog', '/library'],
    ['circulation', '/library/circulation'],
    ['overdues', '/library/overdues'],
  ],
  parent: [
    ['home', '/parent'],
    ['messages', '/parent/messages'],
    ['consents', '/parent/consents'],
    ['fees', '/parent/fees'],
  ],
  'data-warehouse': [
    ['overview', '/data-warehouse'],
    ['import', '/data-warehouse/import'],
    ['field-mapping', '/data-warehouse/field-mapping'],
    ['map', '/data-warehouse/map'],
  ],
  admin: [
    ['overview', '/admin'],
    ['users', '/admin/users'],
    ['roles', '/admin/roles'],
    ['permissions', '/admin/permissions'],
    ['tenant', '/admin/tenant'],
  ],
  // Wave 9 gap-closure slice (G-903/904/906/907/908/914/923)
  wave9: [
    ['fees-structures', '/fees/structures'],
    ['fees-reports', '/fees/reports'],
    ['admissions-enquiries', '/admissions/enquiries'],
    ['admissions-seat-matrix', '/admissions/seat-matrix'],
    ['admissions-merit', '/admissions/merit'],
    ['assessments-outcomes', '/assessments/outcomes'],
    ['assessments-report-cards', '/assessments/report-cards'],
    [
      'institution-gradebook',
      `/institutions/${process.env.INSTITUTION_ID ?? '11111111-1111-4111-8111-111111111111'}/gradebook`,
    ],
    [
      'institution-curriculum',
      `/institutions/${process.env.INSTITUTION_ID ?? '11111111-1111-4111-8111-111111111111'}/curriculum`,
    ],
    ['parent-attendance', '/parent/attendance'],
    ['parent-grades', '/parent/grades'],
    ['parent-timetable', '/parent/timetable'],
    ['parent-homework', '/parent/homework'],
    ['parent-calendar', '/parent/calendar'],
    ['parent-notices', '/parent/notices'],
    ['student-home', '/student'],
    ['student-attendance', '/student/attendance'],
    ['student-grades', '/student/grades'],
    ['student-timetable', '/student/timetable'],
    ['student-homework', '/student/homework'],
    ['student-calendar', '/student/calendar'],
    ['student-notices', '/student/notices'],
    ['student-pal', '/student/pal'],
  ],
  track: [['public-track', '/track']],
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
      if (MODULE_FILTER.length > 0 && !MODULE_FILTER.includes(module)) continue;
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
          if (page.url().includes('/login')) {
            throw new Error(`login redirect (cookie host must match BASE_URL=${BASE_URL})`);
          }
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
