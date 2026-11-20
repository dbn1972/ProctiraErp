import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';

import {
  BACKEND_READY,
  GATEWAY_URL,
  apiHeaders,
  createCounsellor,
  createStudent,
  healthAdmin,
  newTag,
  openAs,
  todayUtc,
  waitForReact,
  type Persona,
} from './fixtures/health-screens';

/**
 * Health module — live write path for the 4 form screens (screen → API → DB).
 *
 * Each test seeds its own student (and counsellor) through the gateway with a unique
 * tag, saves through the screen's own form as a tenant health administrator, then
 * confirms the row on the redirected list screen, again after a reload, and through
 * the gateway route that reads it back.
 */

type Row = Record<string, unknown>;

async function getRows(request: APIRequestContext, p: Persona, path: string): Promise<Row[]> {
  const res = await request.get(`${GATEWAY_URL}/api/v1${path}`, { headers: apiHeaders(p) });
  expect(res.status(), `GET ${path}: ${await res.text()}`).toBe(200);
  const body = (await res.json()) as { data?: Row[] };
  expect(Array.isArray(body.data), `GET ${path} returns { data: [] }`).toBe(true);
  return body.data ?? [];
}

/** Marker-less forms: one form on the page and React attached before any fill. */
async function hydratedForm(page: Page, testId: string): Promise<Locator> {
  const form = page.getByTestId(testId);
  await expect(form).toHaveCount(1, { timeout: 20_000 });
  await waitForReact(form);
  return form;
}

/** The picker shows the first 20 by lastName; pickerSortKey() keeps this run's row in it. */
async function selectById(select: Locator, id: string): Promise<void> {
  await expect(select.locator(`option[value="${id}"]`)).toHaveCount(1);
  await select.selectOption(id);
}

/** `YYYY-MM-DDT10:00` for yesterday in the local time zone (datetime-local input). */
function yesterdayAtTenLocal(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T10:00`;
}

test.describe('Health screens — live form saves (E2E_BACKEND_READY)', () => {
  test.skip(!BACKEND_READY, 'Requires live gateway (E2E_BACKEND_READY)');

  test('/health/allergies/new saves an allergy shown on the register and the record', async ({
    page,
    request,
  }) => {
    const tag = newTag();
    const ha = healthAdmin(`hl-admin-${tag}`);
    const today = todayUtc();
    const student = await createStudent(request, ha, tag);
    const description = `HL form allergy ${tag}`;
    const reaction = `HL reaction ${tag}`;
    const treatment = `HL treatment ${tag}`;

    await openAs(page, ha);
    await page.goto('/health/allergies/new', { waitUntil: 'domcontentloaded' });
    const form = await hydratedForm(page, 'create-allergy-form');
    await selectById(form.locator('#studentId'), student.id);
    await form.locator('#allergyType').fill('food');
    await form.locator('#description').fill(description);
    await form.locator('#severity').selectOption('moderate');
    await form.locator('#reaction').fill(reaction);
    await form.locator('#treatment').fill(treatment);
    await form.locator('#diagnosedDate').fill(today);
    await page.getByRole('button', { name: 'Save allergy' }).click();

    await expect(page).toHaveURL(/\/health\/allergies$/, { timeout: 20_000 });
    // `has` locators resolve inside the row, so they never start from `main`.
    const href = `a[href="/health/${student.id}"]`;
    const item = page.locator('main li').filter({ has: page.locator(href) });
    await expect(item).toHaveCount(1, { timeout: 20_000 });
    await expect(item).toContainText(description);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(item).toHaveCount(1, { timeout: 20_000 });
    await expect(item).toContainText(description);
    // D1 (defects.md): the register link does not carry the student name yet; the name
    // assertion lives in d1-allergies-test.patch.

    const allergies = await getRows(request, ha, `/health/allergies/student/${student.id}`);
    expect(
      allergies.map((a) => [
        a.allergyType,
        a.description,
        a.severity,
        a.reaction,
        a.treatment,
        a.diagnosedDate,
      ]),
    ).toEqual([['food', description, 'moderate', reaction, treatment, today]]);

    await page.goto(`/health/${student.id}`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('main li', { hasText: description })).toHaveCount(1, {
      timeout: 20_000,
    });
  });

  test('/health/vaccinations/new saves a dose shown on the register and the record', async ({
    page,
    request,
  }) => {
    const tag = newTag();
    const ha = healthAdmin(`hl-admin-${tag}`);
    const today = todayUtc();
    // The register renders the first 100 rows by date_administered DESC (O5).
    const before = await getRows(request, ha, '/health/vaccinations');
    const othersToday = before.filter((v) => v.dateAdministered === today).length;
    expect(
      othersToday,
      `${othersToday} vaccination rows dated ${today} already exist in tenant A; the register shows the first 100, so this test needs a fresh database`,
    ).toBeLessThan(99);

    const student = await createStudent(request, ha, tag);
    const vaccine = `HL form vaccine ${tag}`;
    const administeredBy = `HL nurse ${tag}`;
    const batch = `HL-BATCH-${tag}`;
    const notes = `HL vaccine notes ${tag}`;

    await openAs(page, ha);
    await page.goto('/health/vaccinations/new', { waitUntil: 'domcontentloaded' });
    const form = await hydratedForm(page, 'create-vaccination-form');
    await selectById(form.locator('#studentId'), student.id);
    await form.locator('#vaccineName').fill(vaccine);
    await form.locator('#doseNumber').fill('1');
    await form.locator('#dateAdministered').fill(today);
    await form.locator('#administeredBy').fill(administeredBy);
    await form.locator('#batchNumber').fill(batch);
    await form.locator('#notes').fill(notes);
    await page.getByRole('button', { name: 'Save vaccination' }).click();

    await expect(page).toHaveURL(/\/health\/vaccinations$/, { timeout: 20_000 });
    const href = `a[href="/health/${student.id}"]`;
    const item = page.locator('main li').filter({ has: page.locator(href) });
    await expect(item).toHaveCount(1, { timeout: 20_000 });
    await expect(item.locator(href)).toContainText(student.label);
    await expect(item).toContainText(`${vaccine} · dose 1 · ${today}`);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(item).toHaveCount(1, { timeout: 20_000 });
    await expect(item.locator(href)).toContainText(student.label);
    await expect(item).toContainText(`${vaccine} · dose 1 · ${today}`);

    const doses = await getRows(request, ha, `/health/vaccinations/student/${student.id}`);
    expect(
      doses.map((v) => [
        v.vaccineName,
        v.doseNumber,
        v.dateAdministered,
        v.administeredBy,
        v.batchNumber,
        v.notes,
      ]),
    ).toEqual([[vaccine, 1, today, administeredBy, batch, notes]]);

    await page.goto(`/health/${student.id}`, { waitUntil: 'domcontentloaded' });
    const doseRow = page.locator('main li', { hasText: vaccine });
    await expect(doseRow).toHaveCount(1, { timeout: 20_000 });
    await expect(doseRow).toContainText(`· dose 1 · ${today}`);
  });

  test('/health/incidents/new logs a visit for the chosen school under the session user', async ({
    page,
    request,
  }) => {
    const tag = newTag();
    const ha = healthAdmin(`hl-admin-${tag}`);
    const student = await createStudent(request, ha, tag);
    const category = `HL form visit ${tag}`;
    const typedReporter = `HL form reporter ${tag}`;
    const notes = `HL visit notes ${tag}`;
    const incidentLocal = yesterdayAtTenLocal();

    await openAs(page, ha);
    await page.goto('/health/incidents/new', { waitUntil: 'domcontentloaded' });
    const form = await hydratedForm(page, 'create-incident-form');
    await selectById(form.locator('#studentId'), student.id);
    const school = form.locator('#institutionId');
    const institutionId = await school
      .locator('option:not([value=""])')
      .first()
      .getAttribute('value');
    expect(institutionId, 'the school picker lists a school').toBeTruthy();
    await school.selectOption(institutionId ?? '');
    await form.locator('#incidentAt').fill(incidentLocal);
    await form.locator('#category').fill(category);
    await form.locator('#severity').selectOption('medium');
    await form.locator('#reportedBy').fill(typedReporter);
    await form.locator('#notes').fill(notes);
    // The form sends new Date(<local>).toISOString(); compute it in the same browser.
    const incidentIso = await page.evaluate((v) => new Date(v).toISOString(), incidentLocal);
    await page.getByRole('button', { name: 'Save incident' }).click();

    await expect(page).toHaveURL(/\/health\/incidents$/, { timeout: 20_000 });
    const item = page.locator('main li', { hasText: `${category} · medium` });
    const shownAt = incidentIso.slice(0, 16).replace('T', ' ');
    await expect(item).toHaveCount(1, { timeout: 20_000 });
    await expect(item).toContainText(shownAt);
    await expect(item).toContainText(student.label);
    // PRC-M520 / O2: the server records the session user, not the typed "Reported by".
    await expect(item).toContainText(ha.sub);
    await expect(item).not.toContainText(typedReporter);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(item).toHaveCount(1, { timeout: 20_000 });
    await expect(item).toContainText(shownAt);
    await expect(item).toContainText(student.label);
    await expect(item).toContainText(ha.sub);

    const rows = (await getRows(request, ha, '/health/incidents')).filter(
      (r) => r.studentId === student.id,
    );
    expect(rows, 'GET /health/incidents has one visit for the student').toHaveLength(1);
    const row = rows[0]!;
    expect([row.category, row.severity, row.notes, row.institutionId, row.reportedBy]).toEqual([
      category,
      'medium',
      notes,
      institutionId,
      ha.sub,
    ]);
    expect(Date.parse(String(row.incidentAt))).toBe(Date.parse(incidentIso));
  });

  test('/health/counselling/new schedules a session listed with names and a sealed reason', async ({
    page,
    request,
  }) => {
    const tag = newTag();
    const ha = healthAdmin(`hl-admin-${tag}`);
    const today = todayUtc();
    const student = await createStudent(request, ha, tag);
    const staff = await createCounsellor(request, ha, tag);
    const reason = `HL form reason ${tag}`;
    const caseNotes = `HL form notes ${tag}`;

    await openAs(page, ha);
    await page.goto('/health/counselling/new', { waitUntil: 'domcontentloaded' });
    // Same hydration wait as 17b: an unhydrated duplicate can briefly stream in.
    const form = page.getByTestId('counselling-session-form');
    await expect(async () => {
      await expect(form).toHaveCount(1, { timeout: 2_000 });
      await expect(form).toHaveAttribute('data-hydrated', 'true', { timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
    await selectById(form.locator('#counselling-student-id'), student.id);
    await selectById(form.locator('#counselling-counsellor-id'), staff.id);
    await form.locator('#counselling-session-date').fill(today);
    await form.locator('#counselling-session-type').selectOption('individual');
    await form.locator('#counselling-status').selectOption('scheduled');
    await form.locator('#counselling-reason').fill(reason);
    await form.locator('#counselling-case-notes').fill(caseNotes);
    await page.getByRole('button', { name: 'Schedule session' }).click();

    await expect(page).toHaveURL(/\/health\/counselling$/, { timeout: 20_000 });
    const row = page.locator('main tr', { hasText: student.firstName });
    const main = page.locator('main');
    await expect(row).toHaveCount(1, { timeout: 20_000 });
    await expect(row).toContainText(student.label);
    await expect(row).toContainText(staff.label);
    await expect(row).toContainText('individual');
    await expect(row).toContainText('Scheduled');
    // PRC-M273: the reason and notes are counselling PHI; a health admin sees neither.
    await expect(main.getByText(reason)).toHaveCount(0);
    await expect(main.getByText(caseNotes)).toHaveCount(0);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(row).toHaveCount(1, { timeout: 20_000 });
    await expect(row).toContainText(student.label);
    await expect(row).toContainText(staff.label);
    await expect(row).toContainText('Scheduled');
    await expect(main.getByText(reason)).toHaveCount(0);

    const sessions = await getRows(
      request,
      ha,
      `/health/counselling/sessions/student/${student.id}`,
    );
    expect(sessions.map((s) => [s.counsellorId, s.sessionDate, s.sessionType, s.status])).toEqual([
      [staff.id, today, 'individual', 'scheduled'],
    ]);
    // The health admin's API view is redacted too (reason blanked, case notes sealed).
    expect(sessions[0]?.reason).toBe('');
    expect(String(sessions[0]?.caseNotes)).not.toContain(caseNotes);
  });
});
