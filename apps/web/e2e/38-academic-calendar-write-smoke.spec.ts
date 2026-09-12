/**
 * Academic calendar — year → term hierarchy, calendar events, year-end
 * rollover (Wave 9 / G-905).
 *
 * Ungated: the periods list renders and the calendar page shows not-found
 * for an unknown id (no crash).
 * Gated (E2E_BACKEND_READY): live API year/term chain with the hierarchy
 * rules enforced, the UI adds + lists a holiday, the rollover previews then
 * executes into the next year (sections cloned), and tenant B sees nothing.
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import { createSignedJwt, setupGatewayTenantSession } from './fixtures/fake-session';

const BACKEND_READY = !!process.env.E2E_BACKEND_READY;
const GATEWAY_URL =
  process.env.E2E_GATEWAY_URL ?? process.env.NEXT_PUBLIC_GATEWAY_URL ?? 'http://127.0.0.1:3000';
const TENANT_A = '00000000-0000-4000-8000-000000000001';
const TENANT_B = '00000000-0000-4000-8000-0000000000bb';
/** Seeded by tools/e2e/seed-e2e-tenants.sql. */
const INSTITUTION_A = 'a2e96cd1-0232-4cce-97e2-00ebbfb9a374';

function headers(tenantId = TENANT_A) {
  const token = createSignedJwt({
    sub: 'e2e-admin',
    email: 'admin@tenant-a.test',
    displayName: 'E2E Admin',
    tenantId,
    roles: [{ roleId: 'admin', roleName: 'SUPER_ADMIN', areaId: null }],
    institutions: [],
  });
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-Tenant-ID': tenantId,
  };
}

function stamp() {
  return Date.now().toString(36).slice(-6).toUpperCase();
}

async function createYear(
  request: APIRequestContext,
  input: { label: string; startDate: string; endDate: string },
): Promise<{ id: string; name: string; code: string }> {
  const code = `AY-${input.label}-${stamp()}`;
  const res = await request.post(`${GATEWAY_URL}/api/v1/academic-periods`, {
    headers: headers(),
    data: {
      name: `E2E Year ${code}`,
      code,
      startDate: input.startDate,
      endDate: input.endDate,
      status: 'inactive',
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  const body = await res.json();
  return { id: body.id as string, name: body.name as string, code };
}

async function hydrated(page: Page, testId: string) {
  const el = page.getByTestId(testId);
  await expect(el).toHaveAttribute('data-hydrated', 'true', { timeout: 20_000 });
  return el;
}

async function pickOption(page: Page, triggerTestId: string, optionName: string) {
  await page.getByTestId(triggerTestId).click();
  await page.getByRole('option', { name: optionName }).click();
}

test.describe('Academic calendar — pages render (ungated)', () => {
  test.beforeEach(async ({ page }) => {
    await setupGatewayTenantSession(page);
  });

  test('/academic-periods renders with the New period action', async ({ page }) => {
    await page.goto('/academic-periods', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByTestId('new-period')).toBeVisible();
  });

  test('/academic-periods exposes Export calendar (.ics) CTA', async ({ page }) => {
    await page.goto('/academic-periods', { waitUntil: 'domcontentloaded' });
    const exportLink = page.getByTestId('export-calendar');
    await expect(exportLink).toBeVisible();
    await expect(exportLink).toHaveAttribute('href', '/api/academic-calendar/export');
  });

  test('/academic-periods/[id]/calendar shows not-found for an unknown period', async ({
    page,
  }) => {
    // The dashboard loading boundary streams before notFound() resolves, so
    // assert on the rendered not-found page rather than the HTTP status.
    await page.goto('/academic-periods/00000000-0000-4000-8000-00000000dead/calendar', {
      waitUntil: 'domcontentloaded',
    });
    await expect(page.getByRole('heading', { name: /page not found/i })).toBeVisible();
    await expect(page.getByTestId('calendar-period-name')).toHaveCount(0);
  });
});

test.describe('Academic calendar — live chain (E2E_BACKEND_READY)', () => {
  test.skip(!BACKEND_READY, 'Requires E2E_BACKEND_READY=1 and a live gateway + Postgres');

  test.beforeEach(async ({ page }) => {
    await setupGatewayTenantSession(page);
  });

  test('year → term hierarchy is enforced by the API and shown nested in the list', async ({
    page,
    request,
  }) => {
    const year = await createYear(request, {
      label: 'H',
      startDate: '2030-04-01',
      endDate: '2031-03-31',
    });

    const orphan = await request.post(`${GATEWAY_URL}/api/v1/academic-periods`, {
      headers: headers(),
      data: {
        name: 'Orphan term',
        code: `ORPHAN-${stamp()}`,
        kind: 'term',
        startDate: '2030-04-01',
        endDate: '2030-09-30',
      },
    });
    expect(orphan.status()).toBe(400);

    const spill = await request.post(`${GATEWAY_URL}/api/v1/academic-periods`, {
      headers: headers(),
      data: {
        name: 'Spills over',
        code: `SPILL-${stamp()}`,
        kind: 'term',
        parentId: year.id,
        startDate: '2031-01-01',
        endDate: '2031-06-30',
      },
    });
    expect(spill.status()).toBe(400);

    const termCode = `T1-${stamp()}`;
    const term = await request.post(`${GATEWAY_URL}/api/v1/academic-periods`, {
      headers: headers(),
      data: {
        name: `E2E Term ${termCode}`,
        code: termCode,
        kind: 'term',
        parentId: year.id,
        startDate: '2030-04-01',
        endDate: '2030-09-30',
      },
    });
    expect(term.status(), await term.text()).toBe(201);
    expect(await term.json()).toMatchObject({ kind: 'term', parentId: year.id });

    const children = await request.get(
      `${GATEWAY_URL}/api/v1/academic-periods?parentId=${year.id}`,
      { headers: headers() },
    );
    expect(children.status()).toBe(200);
    expect((await children.json()).map((p: { code: string }) => p.code)).toEqual([termCode]);

    const del = await request.delete(`${GATEWAY_URL}/api/v1/academic-periods/${year.id}`, {
      headers: headers(),
    });
    expect(del.status()).toBe(422);

    await page.goto('/academic-periods', { waitUntil: 'domcontentloaded' });
    const yearRow = page.locator(`[data-testid="period-row"][data-period-code="${year.code}"]`);
    const termRow = page.locator(`[data-testid="period-row"][data-period-code="${termCode}"]`);
    await expect(yearRow).toBeVisible();
    await expect(termRow).toBeVisible();
    await expect(termRow).toHaveAttribute('data-period-kind', 'term');

    const rows = page.getByTestId('period-row');
    const codes = await rows.evaluateAll((els) =>
      els.map((el) => el.getAttribute('data-period-code')),
    );
    expect(codes.indexOf(termCode)).toBe(codes.indexOf(year.code) + 1);
  });

  test('calendar page adds a holiday from the UI and lists it', async ({ page, request }) => {
    const year = await createYear(request, {
      label: 'C',
      startDate: '2032-04-01',
      endDate: '2033-03-31',
    });

    await page.goto(`/academic-periods/${year.id}/calendar`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('calendar-period-name')).toHaveText(year.name);
    await expect(page.getByTestId('calendar-empty')).toBeVisible();

    await hydrated(page, 'calendar-event-form');
    const holidayName = `Founders Day ${stamp()}`;
    await page.locator('#ce-name').fill(holidayName);
    await page.locator('#ce-start').fill('2032-11-10');
    await page.locator('#ce-end').fill('2032-11-11');
    await page.locator('#ce-notes').fill('School closed');
    await page.getByTestId('add-calendar-event').click();

    const row = page.locator('[data-testid="calendar-event-row"]', { hasText: holidayName });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row).toHaveAttribute('data-event-kind', 'holiday');
    await expect(row).toContainText('All institutions');

    const api = await request.get(`${GATEWAY_URL}/api/v1/academic-periods/${year.id}/calendar`, {
      headers: headers(),
    });
    expect(api.status()).toBe(200);
    const events = (await api.json()).data as Array<{ name: string; kind: string; notes: string }>;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ name: holidayName, kind: 'holiday', notes: 'School closed' });

    // Outside the period → the date inputs are clamped to the period in the
    // UI (min/max), and the API rejects it outright; nothing is added.
    await page.locator('#ce-name').fill('Too early');
    await page.locator('#ce-start').fill('2032-01-01');
    await page.locator('#ce-end').fill('2032-01-02');
    await page.getByTestId('add-calendar-event').click();
    await expect(page.getByTestId('calendar-event-row')).toHaveCount(1);
    const outside = await request.post(
      `${GATEWAY_URL}/api/v1/academic-periods/${year.id}/calendar`,
      {
        headers: headers(),
        data: {
          kind: 'holiday',
          name: 'Too early',
          startDate: '2032-01-01',
          endDate: '2032-01-02',
        },
      },
    );
    expect(outside.status()).toBe(400);
    const still = await request.get(`${GATEWAY_URL}/api/v1/academic-periods/${year.id}/calendar`, {
      headers: headers(),
    });
    expect((await still.json()).data).toHaveLength(1);
  });

  test('rollover previews then executes into the next year, cloning sections', async ({
    page,
    request,
  }) => {
    const source = await createYear(request, {
      label: 'S',
      startDate: '2034-04-01',
      endDate: '2035-03-31',
    });
    const target = await createYear(request, {
      label: 'T',
      startDate: '2035-04-01',
      endDate: '2036-03-31',
    });

    const gradeCode = `RG${stamp()}`;
    const grade = await request.post(`${GATEWAY_URL}/api/v1/grades`, {
      headers: headers(),
      data: { name: `Grade ${gradeCode}`, code: gradeCode, order: 5 },
    });
    expect(grade.status(), await grade.text()).toBe(201);
    const gradeId = (await grade.json()).id as string;

    const sectionName = `R${stamp()}-A`;
    const section = await request.post(`${GATEWAY_URL}/api/v1/classes`, {
      headers: headers(),
      data: {
        institutionId: INSTITUTION_A,
        gradeId,
        academicPeriodId: source.id,
        name: sectionName,
        capacity: 30,
      },
    });
    expect(section.status(), await section.text()).toBe(201);

    await page.goto(`/academic-periods/${source.id}/calendar`, { waitUntil: 'domcontentloaded' });
    const card = page.getByTestId('rollover-card');
    await expect(card).toBeVisible();
    await expect(card.locator('[data-hydrated]')).toHaveAttribute('data-hydrated', 'true', {
      timeout: 20_000,
    });

    await pickOption(page, 'rollover-target', target.name);
    await expect(page.getByTestId('rollover-execute')).toBeDisabled();

    await page.getByTestId('rollover-preview').click();
    const summary = page.getByTestId('rollover-summary');
    await expect(summary).toBeVisible({ timeout: 15_000 });
    await expect(summary).toHaveAttribute('data-dry-run', 'true');
    await expect(page.getByTestId('rollover-classes')).toHaveText('1');

    const before = await request.get(
      `${GATEWAY_URL}/api/v1/classes?institutionId=${INSTITUTION_A}&academicPeriodId=${target.id}`,
      { headers: headers() },
    );
    expect(await before.json()).toEqual([]);

    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByTestId('rollover-execute').click();
    await expect(summary).toHaveAttribute('data-dry-run', 'false', { timeout: 15_000 });
    await expect(page.getByTestId('rollover-classes')).toHaveText('1');

    const after = await request.get(
      `${GATEWAY_URL}/api/v1/classes?institutionId=${INSTITUTION_A}&academicPeriodId=${target.id}`,
      { headers: headers() },
    );
    expect(after.status()).toBe(200);
    const cloned = (await after.json()) as Array<{ name: string; gradeId: string }>;
    expect(cloned).toHaveLength(1);
    expect(cloned[0]).toMatchObject({ name: sectionName, gradeId });

    // Re-running is idempotent.
    const again = await request.post(
      `${GATEWAY_URL}/api/v1/academic-periods/${source.id}/rollover`,
      {
        headers: headers(),
        data: { targetPeriodId: target.id, dryRun: false },
      },
    );
    expect(again.status(), await again.text()).toBe(200);
    expect(await again.json()).toMatchObject({ classes: { toCreate: 0, existing: 1, created: 0 } });
  });

  test('cross-tenant: tenant B cannot read or write tenant A calendar', async ({ request }) => {
    const year = await createYear(request, {
      label: 'X',
      startDate: '2036-04-01',
      endDate: '2037-03-31',
    });
    const added = await request.post(`${GATEWAY_URL}/api/v1/academic-periods/${year.id}/calendar`, {
      headers: headers(),
      data: { kind: 'break', name: 'Winter break', startDate: '2036-12-24', endDate: '2037-01-02' },
    });
    expect(added.status(), await added.text()).toBe(201);

    const foreignList = await request.get(
      `${GATEWAY_URL}/api/v1/academic-periods/${year.id}/calendar`,
      { headers: headers(TENANT_B) },
    );
    expect(foreignList.status()).toBe(404);

    const foreignAdd = await request.post(
      `${GATEWAY_URL}/api/v1/academic-periods/${year.id}/calendar`,
      {
        headers: headers(TENANT_B),
        data: { kind: 'holiday', name: 'Nope', startDate: '2036-05-01', endDate: '2036-05-01' },
      },
    );
    expect(foreignAdd.status()).toBe(404);

    const foreignRollover = await request.post(
      `${GATEWAY_URL}/api/v1/academic-periods/${year.id}/rollover`,
      { headers: headers(TENANT_B), data: { targetPeriodId: year.id, dryRun: true } },
    );
    expect([400, 404]).toContain(foreignRollover.status());
  });
});
