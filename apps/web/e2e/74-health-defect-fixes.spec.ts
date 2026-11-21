import { expect, test, type APIRequestContext } from '@playwright/test';
import {
  BACKEND_READY,
  GATEWAY_URL,
  apiHeaders,
  counsellor,
  createStudent,
  healthAdmin,
  newTag,
  nurse,
  openAs,
  seedIncident,
  seedVaccination,
  type Persona,
} from './fixtures/health-screens';

/**
 * Health defect fixes — live (nightly), FEAT-003 / PR-3.
 *
 * HL-O1: a register the health service refuses shows the access panel, not "none
 *        recorded" with a create button.
 * HL-O4: a student beyond the first 20 of the directory is selectable in a health form.
 * HL-O3: reading the tenant-wide vaccination and incident registers writes PHI access
 *        log rows for the students returned.
 *
 * Each test seeds its own rows with a unique tag through the gateway.
 */

type Row = Record<string, unknown>;

/** Past date: keeps these doses out of the register's today-first rows (spec 63 guard). */
const PAST_DOSE_DATE = '2024-01-15';
const DENIED_TITLE = 'You do not have access to this list';

async function status(request: APIRequestContext, p: Persona, path: string): Promise<number> {
  const res = await request.get(`${GATEWAY_URL}/api/v1${path}`, { headers: apiHeaders(p) });
  return res.status();
}

async function getRows(request: APIRequestContext, p: Persona, path: string): Promise<Row[]> {
  const res = await request.get(`${GATEWAY_URL}/api/v1${path}`, { headers: apiHeaders(p) });
  expect(res.status(), `GET ${path}: ${await res.text()}`).toBe(200);
  const body = (await res.json()) as { data?: Row[] };
  expect(Array.isArray(body.data), `GET ${path} returns { data: [] }`).toBe(true);
  return body.data ?? [];
}

/** A student whose last name sorts after every digit-led `pickerSortKey()` name. */
async function createLateSortingStudent(
  request: APIRequestContext,
  p: Persona,
  tag: string,
): Promise<{ id: string; label: string }> {
  const firstName = `Hl${tag}`;
  const lastName = `zzHl${tag}`;
  const res = await request.post(`${GATEWAY_URL}/api/v1/students`, {
    headers: apiHeaders(p),
    data: { firstName, lastName, dateOfBirth: '2014-05-05', gender: 'female' },
  });
  expect(res.status(), `POST /students: ${await res.text()}`).toBe(201);
  const created = (await res.json()) as { id: string };
  return { id: created.id, label: `${firstName} ${lastName}` };
}

test.describe('Health defect fixes — live (E2E_BACKEND_READY)', () => {
  test.skip(!BACKEND_READY, 'Requires live gateway (E2E_BACKEND_READY)');

  test('HL-O1: a refused register shows the access panel, not an empty register', async ({
    page,
    request,
  }) => {
    const tag = newTag();
    const REGISTERS = {
      vaccinations: {
        path: '/health/vaccinations',
        empty: 'No vaccinations recorded yet',
        create: 'New vaccination',
      },
      incidents: { path: '/health/incidents', empty: 'No incidents yet', create: 'Log visit' },
      screenings: { path: '/health/screenings', empty: 'No screening programs yet', create: null },
    } as const;
    // School-bound personas with no staff assignment, and the registers the health
    // service refuses them (defects.md O1, spec 65 P3 evidence).
    const cases = [
      { p: nurse(`hl-n74-${tag}`), registers: [REGISTERS.vaccinations, REGISTERS.incidents] },
      {
        p: counsellor(`hl-c74-${tag}`),
        registers: [REGISTERS.vaccinations, REGISTERS.incidents, REGISTERS.screenings],
      },
    ];
    for (const { p, registers } of cases) {
      const role = p.roles[0]!.roleName;
      await page.context().clearCookies();
      await openAs(page, p);
      for (const r of registers) {
        expect(await status(request, p, r.path), `${role} GET ${r.path} (precondition)`).toBe(403);
        await page.goto(r.path, { waitUntil: 'domcontentloaded' });
        const panel = page.getByTestId('list-load-failure');
        await expect(panel, `${role} ${r.path} access panel`).toHaveAttribute(
          'data-failure-kind',
          'denied',
          { timeout: 20_000 },
        );
        await expect(panel).toContainText(DENIED_TITLE);
        await expect(panel).toContainText('Reference: HTTP 403');
        await expect(page.getByText(r.empty), `${role} ${r.path} empty state`).toHaveCount(0);
        if (r.create) {
          await expect(page.getByRole('link', { name: r.create })).toHaveCount(0);
        }
      }
    }
  });

  test('HL-O4: a student beyond the first 20 is selectable in the incident form', async ({
    page,
    request,
  }) => {
    const tag = newTag();
    const ha = healthAdmin(`hl-admin74-${tag}`);
    const target = await createLateSortingStudent(request, ha, tag);
    // 20 students whose digit-led last names sort before the target, so it is at
    // position 21 or later in the directory whatever else the tenant holds.
    for (let i = 0; i < 20; i += 1) await createStudent(request, ha, `${tag}${i}`);

    await openAs(page, ha);
    await page.goto('/health/incidents/new', { waitUntil: 'domcontentloaded' });
    const select = page.locator('[data-testid="create-incident-form"] #studentId');
    await expect(select.locator(`option[value="${target.id}"]`)).toHaveCount(1, {
      timeout: 20_000,
    });
    await expect(select.locator(`option[value="${target.id}"]`)).toHaveText(target.label);
    expect(await select.locator('option:not([value=""])').count()).toBeGreaterThan(20);
  });

  test('HL-O3: register reads add PHI access log rows for the students returned', async ({
    page,
    request,
  }) => {
    const tag = newTag();
    const ha = healthAdmin(`hl-admin74p-${tag}`);
    const reader = healthAdmin(`hl-reader74-${tag}`);
    const auditor = healthAdmin(`hl-auditor74-${tag}`);
    const student = await createStudent(request, ha, tag);
    await seedVaccination(request, ha, {
      studentId: student.id,
      vaccineName: `HL vaccine ${tag}`,
      dateAdministered: PAST_DOSE_DATE,
    });
    await seedIncident(request, ha, { studentId: student.id, category: `HL visit ${tag}` });

    const logPath = `/health/phi-access?studentId=${student.id}`;
    const byReader = async () =>
      (await getRows(request, auditor, logPath))
        .filter((r) => r.actorUserId === reader.sub)
        .map((r) => [r.resourceType, r.action, r.studentId]);
    expect(await byReader()).toEqual([]);

    await openAs(page, reader);
    // The register renders the newest 100 doses, but the API returns (and audits) all.
    await page.goto('/health/vaccinations', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1, name: 'Vaccinations' })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByTestId('list-load-failure')).toHaveCount(0);
    await page.goto('/health/incidents', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('main li', { hasText: `HL visit ${tag}` })).toHaveCount(1, {
      timeout: 20_000,
    });

    const rows = await byReader();
    for (const type of ['vaccination.list', 'incident.list']) {
      const logged = rows.filter(([t]) => t === type);
      expect(logged.length, `${type} rows for the register read`).toBeGreaterThanOrEqual(1);
      for (const row of logged) expect(row).toEqual([type, 'READ', student.id]);
    }
  });
});
