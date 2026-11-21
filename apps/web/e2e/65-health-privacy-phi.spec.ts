import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import {
  BACKEND_READY,
  GATEWAY_URL,
  TENANT_A,
  TENANT_B,
  administrator,
  apiHeaders,
  counsellor,
  createCounsellor,
  createStudent,
  healthAdmin,
  newTag,
  nurse,
  openAs,
  seedAccommodationPlan,
  seedAllergy,
  seedCondition,
  seedCounselling,
  seedDiagnosis,
  seedIncident,
  seedScreeningProgram,
  seedVaccination,
  teacher,
  todayUtc,
  type Persona,
  type SeededPerson,
} from './fixtures/health-screens';

/**
 * Health module — privacy, tenancy and PHI access-log negatives (P1–P5).
 *
 * Each test seeds its own student and health rows through the gateway with a unique
 * tag and first proves a health admin can read them (positive control), then checks
 * that the personas who must not see them get the denial screen or an API refusal,
 * that another tenant's rows never cross over, and that a PHI read through the record
 * screen lands in the PHI access log.
 *
 * "Not shown" is checked against the page HTML (rendered text and the RSC payload), so
 * PHI that is sent to the browser but hidden also fails the test.
 */

type Row = Record<string, unknown>;

const HEALTH_DENIED = 'Your role is not authorized to access health records.';
const PHI_LOG_DENIED = 'PHI access logs require a health admin or health officer role.';
/** Past date: keeps these doses out of the vaccination register's today-first 100 rows (O5). */
const PAST_DOSE_DATE = '2024-01-15';

interface SeededRecords {
  student: SeededPerson;
  staff: SeededPerson;
  allergy: string;
  condition: string;
  vaccine: string;
  visit: string;
  reason: string;
  caseNotes: string;
  category: string;
  accommodation: string;
  screening: string;
  /** Every seeded health string (not the student label). */
  phi: string[];
}

async function getJson(request: APIRequestContext, p: Persona, path: string): Promise<unknown> {
  const res = await request.get(`${GATEWAY_URL}/api/v1${path}`, { headers: apiHeaders(p) });
  expect(res.status(), `GET ${path}: ${await res.text()}`).toBe(200);
  return res.json();
}

async function getRows(request: APIRequestContext, p: Persona, path: string): Promise<Row[]> {
  const body = (await getJson(request, p, path)) as { data?: Row[] };
  expect(Array.isArray(body.data), `GET ${path} returns { data: [] }`).toBe(true);
  return body.data ?? [];
}

/** Seed one student with a row on every health surface, all strings unique to `tag`. */
async function seedHealthRecords(
  request: APIRequestContext,
  p: Persona,
  tag: string,
  prefix: string,
): Promise<SeededRecords> {
  const student = await createStudent(request, p, tag);
  const staff = await createCounsellor(request, p, tag);
  const allergy = `${prefix} allergy ${tag}`;
  const condition = `${prefix} condition ${tag}`;
  const vaccine = `${prefix} vaccine ${tag}`;
  const visit = `${prefix} visit ${tag}`;
  const reason = `${prefix} reason ${tag}`;
  const caseNotes = `${prefix} case notes ${tag}`;
  const category = `${prefix} category ${tag}`;
  const accommodation = `${prefix} accommodation ${tag}`;
  const screening = `${prefix} screening ${tag}`;
  const studentId = student.id;
  await seedAllergy(request, p, { studentId, description: allergy });
  await seedCondition(request, p, { studentId, conditionName: condition });
  await seedVaccination(request, p, {
    studentId,
    vaccineName: vaccine,
    dateAdministered: PAST_DOSE_DATE,
  });
  await seedIncident(request, p, { studentId, category: visit });
  await seedCounselling(request, p, { studentId, counsellorId: staff.id, reason, caseNotes });
  await seedDiagnosis(request, p, { studentId, category });
  await seedAccommodationPlan(request, p, {
    studentId,
    accommodations: [{ type: 'exam', description: accommodation }],
  });
  await seedScreeningProgram(request, p, {
    name: screening,
    gradeLevel: `G${tag}`,
    assessmentTypes: ['vision'],
  });
  return {
    student,
    staff,
    allergy,
    condition,
    vaccine,
    visit,
    reason,
    caseNotes,
    category,
    accommodation,
    screening,
    phi: [
      allergy,
      condition,
      vaccine,
      visit,
      reason,
      caseNotes,
      category,
      accommodation,
      screening,
    ],
  };
}

/** Positive control: the seeding health admin reads every seeded row through the API. */
async function expectReadableBy(
  request: APIRequestContext,
  p: Persona,
  s: SeededRecords,
): Promise<void> {
  const id = s.student.id;
  const record = (await getJson(request, p, `/health/records/${id}`)) as Row;
  expect([record.allergies, record.chronicConditions]).toEqual([[s.allergy], [s.condition]]);
  const doses = await getRows(request, p, `/health/vaccinations/student/${id}`);
  expect(doses.map((v) => v.vaccineName)).toEqual([s.vaccine]);
  const visits = (await getRows(request, p, '/health/incidents')).filter((r) => r.studentId === id);
  expect(visits.map((r) => r.category)).toEqual([s.visit]);
  const sessions = await getRows(request, p, `/health/counselling/sessions/student/${id}`);
  expect(sessions.map((r) => r.counsellorId)).toEqual([s.staff.id]);
  const needs = (await getRows(request, p, '/health/special-needs')).find(
    (r) => r.studentId === id,
  );
  expect([needs?.category, needs?.accommodations]).toEqual([s.category, [s.accommodation]]);
  const programs = await getRows(request, p, '/health/screenings');
  expect(programs.map((r) => r.name)).toContain(s.screening);
}

/** Soft-assert none of `strings` is in the page HTML (rendered DOM and RSC payload). */
async function expectNotInPage(page: Page, where: string, strings: string[]): Promise<void> {
  const html = await page.content();
  for (const s of strings) {
    expect.soft(html, `${where}: "${s}" must not be sent to the browser`).not.toContain(s);
  }
}

interface Probe {
  method: 'GET' | 'POST';
  path: string;
  status: number;
  body: string;
}

async function probe(
  request: APIRequestContext,
  p: Persona,
  method: 'GET' | 'POST',
  path: string,
  data?: Row,
  extraHeaders: Record<string, string> = {},
): Promise<Probe> {
  const url = `${GATEWAY_URL}/api/v1${path}`;
  const headers = apiHeaders(p, extraHeaders);
  const res =
    method === 'GET'
      ? await request.get(url, { headers })
      : await request.post(url, { headers, data });
  return { method, path, status: res.status(), body: await res.text() };
}

test.describe('Health privacy and PHI access log — live (E2E_BACKEND_READY)', () => {
  test.skip(!BACKEND_READY, 'Requires live gateway (E2E_BACKEND_READY)');

  test('non-health staff see no PHI on any health screen', async ({ page, request }) => {
    test.slow();
    const tag = newTag();
    const ha = healthAdmin(`hl-admin-${tag}`);
    const s = await seedHealthRecords(request, ha, tag, 'HL');
    await expectReadableBy(request, ha, s);

    const routes = [
      '/health',
      `/health/${s.student.id}`,
      '/health/allergies',
      '/health/allergies/new',
      '/health/vaccinations',
      '/health/vaccinations/new',
      '/health/incidents',
      '/health/incidents/new',
      '/health/counselling',
      '/health/counselling/new',
      '/health/screenings',
      '/health/special-needs',
      '/health/phi-access',
    ];
    for (const p of [teacher(`hl-t-${tag}`), administrator(`hl-a-${tag}`)]) {
      await page.context().clearCookies();
      await openAs(page, p);
      const role = p.roles[0]!.roleName;
      for (const route of routes) {
        await page.goto(route, { waitUntil: 'domcontentloaded' });
        await expect
          .soft(page.getByText(HEALTH_DENIED), `${role} ${route}: health access denied`)
          .toHaveCount(1, { timeout: 8_000 });
        await expectNotInPage(page, `${role} ${route}`, [...s.phi, s.student.label]);
      }
    }
  });

  test('non-health staff are refused by the health API', async ({ request }) => {
    test.slow();
    const tag = newTag();
    const ha = healthAdmin(`hl-admin-${tag}`);
    const s = await seedHealthRecords(request, ha, tag, 'HL');
    await expectReadableBy(request, ha, s);
    const id = s.student.id;

    const counts = async () => ({
      allergies: (await getRows(request, ha, `/health/allergies/student/${id}`)).length,
      vaccinations: (await getRows(request, ha, `/health/vaccinations/student/${id}`)).length,
      incidents: (await getRows(request, ha, '/health/incidents')).filter((r) => r.studentId === id)
        .length,
      sessions: (await getRows(request, ha, `/health/counselling/sessions/student/${id}`)).length,
    });
    const before = await counts();
    expect(before).toEqual({ allergies: 1, vaccinations: 1, incidents: 1, sessions: 1 });

    const reads = [
      '/health/records',
      `/health/records/${id}`,
      `/health/allergies/student/${id}`,
      `/health/conditions/student/${id}`,
      '/health/vaccinations',
      `/health/vaccinations/student/${id}`,
      '/health/incidents',
      '/health/counselling',
      `/health/counselling/sessions/student/${id}`,
      '/health/special-needs',
      `/health/special-needs/diagnoses/student/${id}`,
      '/health/screenings',
      '/health/screening-programs',
      '/health/phi-access',
      `/health/phi-access?studentId=${id}`,
      `/health/dsar/${id}`,
    ];
    const writes: Array<[string, Row]> = [
      [
        '/health/allergies',
        { studentId: id, allergyType: 'food', severity: 'mild', description: `HL p2 ${tag}` },
      ],
      [
        '/health/vaccinations',
        {
          studentId: id,
          vaccineName: `HL p2 ${tag}`,
          doseNumber: 2,
          dateAdministered: PAST_DOSE_DATE,
        },
      ],
      [
        '/health/incidents',
        {
          studentId: id,
          incidentAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
          category: `HL p2 ${tag}`,
          severity: 'low',
          reportedBy: `hl-p2-${tag}`,
        },
      ],
      [
        '/health/counselling/sessions',
        {
          studentId: id,
          counsellorId: s.staff.id,
          sessionDate: todayUtc(),
          sessionType: 'individual',
          reason: `HL p2 ${tag}`,
          caseNotes: `HL p2 ${tag}`,
          followUpRequired: false,
          status: 'scheduled',
        },
      ],
    ];
    const secret = [...s.phi, s.student.label, `HL p2 ${tag}`];
    for (const p of [teacher(`hl-t-${tag}`), administrator(`hl-a-${tag}`)]) {
      const role = p.roles[0]!.roleName;
      const results: Probe[] = [];
      for (const path of reads) results.push(await probe(request, p, 'GET', path));
      for (const [path, data] of writes) results.push(await probe(request, p, 'POST', path, data));
      for (const r of results) {
        test.info().annotations.push({
          type: 'p2-status',
          description: `${role} ${r.method} ${r.path.replace(id, '<S>')} ${r.status}`,
        });
        expect.soft(r.status, `${role} ${r.method} ${r.path}: ${r.body.slice(0, 200)}`).toBe(403);
        for (const str of secret) {
          expect.soft(r.body, `${role} ${r.method} ${r.path} body`).not.toContain(str);
        }
      }
    }
    expect(await counts(), 'refused writes left no rows').toEqual(before);
  });

  test('school-bound nurse and counsellor without scope see no PHI and cannot read the PHI log', async ({
    page,
    request,
  }) => {
    const tag = newTag();
    const ha = healthAdmin(`hl-admin-${tag}`);
    const s = await seedHealthRecords(request, ha, tag, 'HL');
    await expectReadableBy(request, ha, s);
    const id = s.student.id;

    // Shipped registry roles: `nurse` holds health manage (the health domain then finds no
    // staff assignment, so no scope); `counsellor` holds case manage only (gateway RBAC).
    const personas: Array<{ p: Persona; records: number; record: number }> = [
      { p: nurse(`hl-n-${tag}`), records: 200, record: 404 },
      { p: counsellor(`hl-c-${tag}`), records: 403, record: 403 },
    ];
    for (const { p, records, record } of personas) {
      const role = p.roles[0]!.roleName;
      const log = await probe(request, p, 'GET', '/health/phi-access');
      expect
        .soft(log.status, `${role} GET /health/phi-access: ${log.body.slice(0, 200)}`)
        .toBe(403);
      const list = await probe(request, p, 'GET', '/health/records');
      expect.soft(list.status, `${role} GET /health/records`).toBe(records);
      expect.soft(list.body, `${role} GET /health/records has no S row`).not.toContain(id);
      const one = await probe(request, p, 'GET', `/health/records/${id}`);
      expect
        .soft(one.status, `${role} GET /health/records/S: ${one.body.slice(0, 200)}`)
        .toBe(record);
      for (const str of s.phi) {
        for (const r of [log, list, one]) {
          expect.soft(r.body, `${role} GET ${r.path} body`).not.toContain(str);
        }
      }

      await page.context().clearCookies();
      await openAs(page, p);
      await page.goto('/health/phi-access', { waitUntil: 'domcontentloaded' });
      await expect
        .soft(page.getByText(PHI_LOG_DENIED), `${role} /health/phi-access denied`)
        .toHaveCount(1, { timeout: 8_000 });
      await expectNotInPage(page, `${role} /health/phi-access`, s.phi);
      await page.goto('/health', { waitUntil: 'domcontentloaded' });
      await expect(page.locator('main')).toBeVisible();
      await expectNotInPage(page, `${role} /health`, s.phi);
      await page.goto('/health/allergies', { waitUntil: 'domcontentloaded' });
      await expect(page.locator('main')).toBeVisible();
      await expectNotInPage(page, `${role} /health/allergies`, s.phi);
      await page.goto('/health/vaccinations', { waitUntil: 'domcontentloaded' });
      await expect(page.locator('main')).toBeVisible();
      await expectNotInPage(page, `${role} /health/vaccinations`, s.phi);
      // O1 (defects.md): what the register renders for this persona; observed, not asserted.
      await page.screenshot({ path: test.info().outputPath(`O1-${role}-vaccinations.png`) });
      await page.goto('/health/incidents', { waitUntil: 'domcontentloaded' });
      await expect(page.locator('main')).toBeVisible();
      await expectNotInPage(page, `${role} /health/incidents`, s.phi);
      await page.screenshot({ path: test.info().outputPath(`O1-${role}-incidents.png`) });
      await page.goto('/health/screenings', { waitUntil: 'domcontentloaded' });
      await expect(page.locator('main')).toBeVisible();
      await page.screenshot({ path: test.info().outputPath(`O1-${role}-screenings.png`) });
      await page.goto('/health/counselling', { waitUntil: 'domcontentloaded' });
      await expect(page.locator('main')).toBeVisible();
      await expectNotInPage(page, `${role} /health/counselling`, s.phi);
      await page.goto('/health/special-needs', { waitUntil: 'domcontentloaded' });
      await expect(page.locator('main')).toBeVisible();
      await expectNotInPage(page, `${role} /health/special-needs`, s.phi);
      await page.goto(`/health/${id}`, { waitUntil: 'domcontentloaded' });
      await expect(page.locator('main')).toBeVisible();
      await expectNotInPage(page, `${role} /health/S`, s.phi);
    }
  });

  test("another tenant's health records never appear on screen or via the API", async ({
    page,
    request,
  }) => {
    test.slow();
    const tag = newTag();
    // Tenant of the "other" school; the rows below must never reach tenant A.
    const otherTenant = TENANT_B;
    const haB = healthAdmin(`hl-b-admin-${tag}`, otherTenant);
    const readerB = healthAdmin(`hl-b-reader-${tag}`, otherTenant);
    const b = await seedHealthRecords(request, haB, tag, 'HL-B');
    const sb = b.student.id;
    const readerRecord = (await getJson(request, readerB, `/health/records/${sb}`)) as Row;
    expect(readerRecord.studentId).toBe(sb);
    // Positive control: tenant B's own API returns the rows and the reader's PHI read.
    await expectReadableBy(request, haB, b);
    const records = await getRows(request, haB, '/health/records');
    expect(records.map((r) => r.studentId)).toContain(sb);
    const vaccinations = await getRows(request, haB, '/health/vaccinations');
    expect(vaccinations.map((r) => r.vaccineName)).toContain(b.vaccine);
    const counselling = await getRows(request, haB, '/health/counselling');
    expect(counselling.map((r) => r.studentId)).toContain(sb);
    const readsB = await getRows(request, haB, `/health/phi-access?studentId=${sb}`);
    expect(
      readsB.some(
        (r) => r.actorUserId === readerB.sub && r.resourceType === 'health_record.detail',
      ),
      'tenant B PHI log has the reader',
    ).toBe(true);

    const tagA = newTag();
    const haA = healthAdmin(`hl-admin-${tagA}`, TENANT_A);
    const studentA = await createStudent(request, haA, tagA);
    await seedAllergy(request, haA, { studentId: studentA.id, description: `HL allergy ${tagA}` });
    const leaked = [...b.phi, b.student.label, readerB.sub, haB.sub];

    // Tenant-A JWT, with and without a forged X-Tenant-ID for tenant B.
    for (const [label, extra] of [
      ['tenant A JWT', {}],
      ['tenant A JWT + forged X-Tenant-ID', { 'X-Tenant-ID': TENANT_B }],
    ] as Array<[string, Record<string, string>]>) {
      const list = await probe(request, haA, 'GET', '/health/records', undefined, extra);
      expect.soft(list.status, `${label} GET /health/records`).toBe(200);
      expect
        .soft(list.body, `${label} GET /health/records has tenant A's row`)
        .toContain(studentA.id);
      expect
        .soft(list.body, `${label} GET /health/records has no tenant-B student`)
        .not.toContain(sb);
      const one = await probe(request, haA, 'GET', `/health/records/${sb}`, undefined, extra);
      expect
        .soft(one.status, `${label} GET /health/records/SB: ${one.body.slice(0, 200)}`)
        .toBe(404);
      const results = [list, one];
      // Tenant-wide registers: no tenant-B student at all.
      for (const path of [
        '/health/vaccinations',
        '/health/incidents',
        '/health/counselling',
        '/health/special-needs',
        '/health/screenings',
      ]) {
        const r = await probe(request, haA, 'GET', path, undefined, extra);
        results.push(r);
        expect.soft(r.status, `${label} GET ${r.path}`).toBe(200);
        expect.soft(r.body, `${label} GET ${r.path} has no tenant-B student`).not.toContain(sb);
      }
      // Routes keyed by SB's id: tenant A holds no rows for it.
      for (const path of [
        `/health/allergies/student/${sb}`,
        `/health/vaccinations/student/${sb}`,
        `/health/counselling/sessions/student/${sb}`,
      ]) {
        const r = await probe(request, haA, 'GET', path, undefined, extra);
        results.push(r);
        expect.soft(r.status, `${label} GET ${r.path}`).toBe(200);
        const rows = r.status === 200 ? (JSON.parse(r.body) as { data?: Row[] }).data : null;
        expect.soft(rows, `${label} GET ${r.path} is empty`).toEqual([]);
      }
      // Tenant A's PHI log for SB's id holds only tenant A's own read attempts above
      // (O7, defects.md), never tenant B's reads.
      const log = await probe(
        request,
        haA,
        'GET',
        `/health/phi-access?studentId=${sb}`,
        undefined,
        extra,
      );
      results.push(log);
      expect.soft(log.status, `${label} GET ${log.path}`).toBe(200);
      const logRows =
        log.status === 200 ? ((JSON.parse(log.body) as { data: Row[] }).data ?? []) : [];
      for (const row of logRows) {
        expect
          .soft([row.tenantId, row.actorUserId], `${label} PHI log row`)
          .toEqual([TENANT_A, haA.sub]);
      }
      for (const r of results) {
        for (const str of leaked) {
          expect.soft(r.body, `${label} GET ${r.path} body`).not.toContain(str);
        }
      }
    }

    await openAs(page, haA);
    const screens: Array<[string, () => Promise<unknown>]> = [
      ['/health', () => page.goto('/health', { waitUntil: 'domcontentloaded' })],
      [
        '/health/allergies',
        () => page.goto('/health/allergies', { waitUntil: 'domcontentloaded' }),
      ],
      [
        '/health/vaccinations',
        () => page.goto('/health/vaccinations', { waitUntil: 'domcontentloaded' }),
      ],
      [
        '/health/incidents',
        () => page.goto('/health/incidents', { waitUntil: 'domcontentloaded' }),
      ],
      [
        '/health/counselling',
        () => page.goto('/health/counselling', { waitUntil: 'domcontentloaded' }),
      ],
      [
        '/health/screenings',
        () => page.goto('/health/screenings', { waitUntil: 'domcontentloaded' }),
      ],
      [
        '/health/special-needs',
        () => page.goto('/health/special-needs', { waitUntil: 'domcontentloaded' }),
      ],
      [
        '/health/phi-access',
        () => page.goto('/health/phi-access', { waitUntil: 'domcontentloaded' }),
      ],
    ];
    for (const [route, open] of screens) {
      await open();
      await expect(page.locator('main h1').first()).toBeVisible();
      await expectNotInPage(page, `tenant A ${route}`, leaked);
    }
    // Tenant A's own row is on its register (the screen did load live data).
    await page.goto('/health/allergies', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('main li', { hasText: `HL allergy ${tagA}` })).toHaveCount(1);

    await page.goto(`/health/${sb}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: /page not found/i })).toBeVisible();
    await expectNotInPage(page, 'tenant A /health/SB', leaked);
  });

  test('a PHI read made through the record screen is recorded in the PHI access log', async ({
    page,
    request,
  }) => {
    const tag = newTag();
    const ha = healthAdmin(`hl-admin-${tag}`);
    const reader = healthAdmin(`hl-reader-${tag}`);
    const auditor = healthAdmin(`hl-auditor-${tag}`);
    const student = await createStudent(request, ha, tag);
    const allergy = `HL allergy ${tag}`;
    const vaccine = `HL vaccine ${tag}`;
    await seedAllergy(request, ha, { studentId: student.id, description: allergy });
    await seedVaccination(request, ha, {
      studentId: student.id,
      vaccineName: vaccine,
      dateAdministered: PAST_DOSE_DATE,
    });
    const record = (await getJson(request, ha, `/health/records/${student.id}`)) as Row;
    expect(record.allergies).toEqual([allergy]);
    const before = await getRows(request, auditor, `/health/phi-access?studentId=${student.id}`);
    expect(before.filter((r) => r.actorUserId === reader.sub)).toEqual([]);

    await openAs(page, reader);
    await page.goto(`/health/${student.id}`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('main li', { hasText: allergy })).toHaveCount(1);
    await expect(page.locator('main li', { hasText: vaccine })).toHaveCount(1);

    await page.context().clearCookies();
    await openAs(page, auditor);
    // /health/phi-access shows the newest 100 rows tenant-wide, so the reader's rows are on
    // it only if no other test reads PHI meanwhile (GET /health/records logs one row per
    // student). Run with PLAYWRIGHT_WORKERS=1 on a reused database; CI shards use 1 worker
    // and fresh databases. The API check below filters by studentId and has no such limit.
    await page.goto('/health/phi-access', { waitUntil: 'domcontentloaded' });
    const readerRows = page.locator('main tr', { hasText: reader.sub });
    const detail = readerRows.filter({ hasText: 'health_record.detail' });
    await expect.soft(detail, 'PHI log row for the record read').toHaveCount(1);
    await expect.soft(detail).toContainText(student.label);
    await expect.soft(detail).toContainText('READ');
    const dose = readerRows.filter({ hasText: 'vaccination' });
    await expect.soft(dose, 'PHI log row for the vaccination read').toHaveCount(1);
    await expect.soft(dose).toContainText(student.label);
    await expect.soft(dose).toContainText('READ');

    const after = await getRows(request, auditor, `/health/phi-access?studentId=${student.id}`);
    const byReader = after.filter((r) => r.actorUserId === reader.sub);
    expect.soft(byReader.map((r) => [r.resourceType, r.action, r.studentId]).sort()).toEqual([
      ['health_record.detail', 'READ', student.id],
      ['vaccination', 'READ', student.id],
    ]);
  });
});
