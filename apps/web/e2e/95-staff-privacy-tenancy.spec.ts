import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import {
  BACKEND_READY,
  GATEWAY_URL,
  TENANT_A,
  TENANT_B,
  apiHeaders,
  expectNotInPage,
  getAllPages,
  getJson,
  hrAdmin,
  hydratedForm,
  newTag,
  officeStaff,
  openAs,
  parentUser,
  seedStaffData,
  seedSubstitution,
  staffRoutes,
  studentUser,
  teacher,
  utcDate,
  type Persona,
  type Row,
  type SeededStaffData,
  type SeededSubstitution,
} from './fixtures/staff-screens';

/**
 * Staff / HR module — privacy and tenancy negatives (P1–P4).
 *
 * Staff identity numbers, contacts, contracts (salary bands and gross pay), leave reasons,
 * attendance and payroll are employee personal data. Each test seeds its own data set with
 * a unique tag, proves the tenant administrator can read it (positive control), then
 * checks that roles without staff access and another tenant never receive it, on screen or
 * through the API the screens call, including with a forged X-Tenant-ID.
 *
 * "Not shown" is checked against the page HTML (rendered text and the RSC payload), so
 * data that reaches the browser but is hidden also fails the test.
 *
 * Roles without staff access here: teacher, office staff (`staff`), student and parent.
 * The web guard (staff/layout.tsx and a per-page check), gateway RBAC and staff-access.ts
 * all refuse them.
 *
 * A known open defect is not asserted here (defects.md): `GET /timetable/substitutions`
 * returns every staff substitution, with its reason, to student, parent, teacher and staff
 * JWTs (S-D2, PRIVACY). Its assertion lives in patches/ for the fix PR.
 */

interface Probe {
  method: string;
  path: string;
  status: number;
  body: string;
}

async function probe(
  request: APIRequestContext,
  p: Persona,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH',
  path: string,
  data?: unknown,
  extra: Record<string, string> = {},
): Promise<Probe> {
  const res = await request.fetch(`${GATEWAY_URL}/api/v1${path}`, {
    method,
    headers: apiHeaders(p, extra),
    data,
  });
  return { method, path, status: res.status(), body: await res.text() };
}

/** Every staff GET the twelve screens make for `d` (payroll for the month it posted). */
function screenReads(d: SeededStaffData): string[] {
  const id = d.staff.id;
  return [
    '/staff?page=1&pageSize=100&sortBy=lastName&sortOrder=asc',
    `/staff?search=${d.staff.firstName}`,
    `/staff/${id}`,
    `/staff/${id}/leave-balances`,
    `/staff/assignments?staffId=${id}&pageSize=100`,
    `/staff/appraisals?staffId=${id}`,
    '/staff/appraisals/templates',
    `/staff/training/certifications?staffId=${id}`,
    '/staff/contracts',
    `/staff/contracts?staffId=${id}`,
    `/staff/contracts/${d.contract.id}`,
    '/staff/qualifications',
    `/staff/attendance?date=${d.attendance.date}`,
    `/staff/attendance/summary?month=${d.attendance.date.slice(0, 7)}`,
    '/staff/leaves',
    `/staff/payroll/export?month=${d.payroll.month}`,
  ];
}

/** Positive control: the seeding administrator reads every seeded row through the API. */
async function expectReadableBy(
  request: APIRequestContext,
  p: Persona,
  d: SeededStaffData,
): Promise<void> {
  const ids = (rows: Row[]) => rows.map((r) => r.id);
  const staff = await getJson<Row>(request, p, `/staff/${d.staff.id}`);
  expect([staff.identityNumber, staff.contactPhone]).toEqual([
    d.staff.identityNumber,
    d.staff.contactPhone,
  ]);
  expect(ids(await getAllPages(request, p, `/staff/contracts?staffId=${d.staff.id}`))).toContain(
    d.contract.id,
  );
  expect(ids(await getAllPages(request, p, `/staff/qualifications?staffId=${d.staff.id}`))).toEqual(
    [d.qualification.id],
  );
  const leaves = ids(await getAllPages(request, p, '/staff/leaves'));
  expect(leaves).toContain(d.approvedLeave.id);
  expect(leaves).toContain(d.pendingLeave.id);
  expect(
    ids(
      await getAllPages(
        request,
        p,
        `/staff/attendance?staffId=${d.staff.id}&date=${d.attendance.date}`,
      ),
    ),
  ).toEqual([d.attendance.id]);
  const payroll = await getJson<{ rows: Row[] }>(
    request,
    p,
    `/staff/payroll/export?month=${d.payroll.month}`,
  );
  expect(payroll.rows.filter((r) => r.staffId === d.staff.id).map((r) => r.grossCents)).toEqual([
    d.payroll.grossCents,
  ]);
}

/** State of the seeded rows that a refused write or decision must not change. */
async function snapshot(request: APIRequestContext, p: Persona, d: SeededStaffData) {
  const id = d.staff.id;
  const staff = await getJson<Row>(request, p, `/staff/${id}`);
  return {
    staff: [staff.firstName, staff.lastName, staff.position, staff.contactPhone, staff.status],
    contracts: (await getAllPages(request, p, `/staff/contracts?staffId=${id}`)).map((c) => [
      c.id,
      c.salaryBand,
      c.status,
      c.endDate,
    ]),
    qualifications: (await getAllPages(request, p, `/staff/qualifications?staffId=${id}`)).map(
      (q) => [q.id, q.verified],
    ),
    leaves: (await getAllPages(request, p, '/staff/leaves'))
      .filter((l) => l.staffId === id)
      .map((l) => [l.id, l.status])
      .sort(),
    attendance: (await getAllPages(request, p, `/staff/attendance?staffId=${id}`)).map((m) => [
      m.id,
      m.date,
      m.status,
    ]),
    assignments: (await getAllPages(request, p, `/staff/assignments?staffId=${id}`)).length,
    balances: await getJson(request, p, `/staff/${id}/leave-balances`),
    payroll: (
      await getJson<{ rows: Row[] }>(request, p, `/staff/payroll/export?month=${d.payroll.month}`)
    ).rows.filter((r) => r.staffId === id),
  };
}

/** Writes the staff screens make, aimed at `d`'s rows. */
function screenWrites(
  d: SeededStaffData,
  marker: string,
): Array<['POST' | 'PUT' | 'PATCH', string, unknown]> {
  const id = d.staff.id;
  const day = utcDate(-335);
  const csv = [
    'firstName,lastName,dateOfBirth,identityNumber,contactPhone,position',
    `${marker},Refused,1980-01-01,${marker},+15550000000,Teacher`,
  ].join('\n');
  return [
    [
      'POST',
      '/staff',
      {
        firstName: marker,
        lastName: 'Refused',
        dateOfBirth: '1980-01-01',
        identityNumber: marker,
        contactPhone: '+15550000000',
        position: 'Teacher',
      },
    ],
    ['PUT', `/staff/${id}`, { position: marker }],
    ['POST', '/staff/contracts', { staffId: id, contractType: 'intern', startDate: day }],
    ['PATCH', `/staff/contracts/${d.contract.id}`, { salaryBand: marker }],
    [
      'POST',
      '/staff/qualifications',
      { staffId: id, degree: marker, institution: marker, year: 2000 },
    ],
    ['POST', '/staff/attendance', { staffId: id, date: day, status: 'absent' }],
    ['POST', '/staff/attendance/bulk', { date: day, marks: [{ staffId: id, status: 'absent' }] }],
    ['POST', '/staff/import/dry-run', { csv }],
    ['POST', '/staff/import/commit', { csv }],
    ['POST', '/staff/leaves', { staffId: id, leaveType: 'other', startDate: day, endDate: day }],
    ['POST', `/staff/leaves/${d.pendingLeave.id}/decide`, { status: 'rejected' }],
    ['PUT', `/staff/${id}/leave-balances`, { leaveType: 'annual', balanceDays: 99 }],
    [
      'POST',
      '/staff/assignments',
      {
        staffId: id,
        institutionId: '00000000-0000-4000-8000-0000000005a1',
        subjectId: '00000000-0000-4000-8000-0000000005b1',
        classId: '00000000-0000-4000-8000-0000000005c1',
        role: marker,
        allocationPercentage: 5,
        startDate: day,
      },
    ],
    [
      'POST',
      '/staff/appraisals',
      {
        staffId: id,
        templateId: '00000000-0000-4000-8000-0000000005d1',
        appraisalDate: day,
        scores: [{ criterionName: marker, score: 1 }],
      },
    ],
  ];
}

async function open(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('body')).toBeVisible();
  // Server components render before the response ends; let streaming settle.
  await page.waitForLoadState('load');
}

function noAccessPersonas(tag: string): Persona[] {
  return [
    teacher(`st-t-${tag}`),
    officeStaff(`st-o-${tag}`),
    studentUser(`st-s-${tag}`),
    parentUser(`st-p-${tag}`),
  ];
}

test.describe('Staff privacy and tenancy — live (E2E_BACKEND_READY)', () => {
  test.skip(!BACKEND_READY, 'Requires live gateway (E2E_BACKEND_READY)');

  test('roles without staff access get no staff data on any staff screen', async ({
    page,
    request,
  }) => {
    test.slow();
    const tag = newTag();
    const admin = hrAdmin(`st-admin-${tag}`);
    const d = await seedStaffData(request, admin, tag);
    const sub = await seedSubstitution(request, admin, tag);
    await expectReadableBy(request, admin, d);

    // Positive control on screen: the administrator sees the seeded contract.
    await openAs(page, admin);
    await open(page, '/staff/contracts');
    await expect(
      page.getByTestId('staff-contract-row').filter({ hasText: d.contract.band }),
    ).toHaveCount(1);

    // The staff id is in two route URLs (echoed in the payload), so it is not a secret here.
    const secret = [
      ...d.strings,
      ...d.ids.filter((i) => i !== d.staff.id),
      d.staff.name,
      sub.reason,
      sub.original.firstName,
      sub.substitute.firstName,
    ];
    for (const p of noAccessPersonas(tag)) {
      await page.context().clearCookies();
      await openAs(page, p);
      const role = p.roles[0]!.roleId;
      for (const route of [
        ...staffRoutes(d.staff.id),
        `/staff/attendance?date=${d.attendance.date}`,
      ]) {
        await open(page, route);
        await expectNotInPage(page, `${role} ${route}`, secret);
      }
    }
  });

  test('roles without staff access get an access-denied screen on every staff route', async ({
    page,
  }) => {
    test.slow();
    const tag = newTag();
    const someStaffId = '00000000-0000-4000-8000-000000000098';
    for (const p of noAccessPersonas(tag)) {
      await page.context().clearCookies();
      await openAs(page, p);
      const role = p.roles[0]!.roleId;
      for (const route of staffRoutes(someStaffId)) {
        await open(page, route);
        await expect
          .soft(
            page.getByRole('alert').filter({ hasText: /access denied/i }),
            `${role} ${route}: access denied`,
          )
          .toHaveCount(1, { timeout: 8_000 });
        await expect
          .soft(
            page.locator('[data-testid^="staff-"][data-hydrated]'),
            `${role} ${route}: no staff forms`,
          )
          .toHaveCount(0);
      }
    }
  });

  test('roles without staff access are refused by every staff API the screens use', async ({
    request,
  }) => {
    test.slow();
    const tag = newTag();
    const admin = hrAdmin(`st-admin-${tag}`);
    const d = await seedStaffData(request, admin, tag);
    await expectReadableBy(request, admin, d);
    const before = await snapshot(request, admin, d);
    const marker = `ST p2 ${tag}`;
    const secret = [...d.strings, ...d.ids, d.staff.lastName];

    for (const p of noAccessPersonas(tag)) {
      const role = p.roles[0]!.roleId;
      const results: Probe[] = [];
      for (const path of screenReads(d)) results.push(await probe(request, p, 'GET', path));
      // A month nobody exported: a refused export must not post a run either.
      results.push(
        await probe(request, p, 'GET', `/staff/payroll/export?month=0${d.payroll.month.slice(1)}`),
      );
      for (const [method, path, data] of screenWrites(d, marker)) {
        results.push(await probe(request, p, method, path, data));
      }
      for (const r of results) {
        const shown = r.path.split(d.staff.id).join('<S>');
        expect.soft(r.status, `${role} ${r.method} ${shown}: ${r.body.slice(0, 200)}`).toBe(403);
        for (const s of secret) {
          expect.soft(r.body, `${role} ${r.method} ${shown} body`).not.toContain(s);
        }
      }
    }
    expect(await snapshot(request, admin, d), 'refused writes changed nothing').toEqual(before);
    const created = (await getJson<{ data: Row[] }>(request, admin, `/staff?search=${marker}`))
      .data;
    expect(created, 'refused POST /staff and import created no staff').toEqual([]);
  });

  test("each tenant's staff, contracts, leave and payroll never reach the other tenant", async ({
    page,
    request,
  }) => {
    test.slow();
    const tag = newTag();
    const adminA = hrAdmin(`st-a-admin-${tag}`, TENANT_A);
    const adminB = hrAdmin(`st-b-admin-${tag}`, TENANT_B);
    const a = await seedStaffData(request, adminA, tag, { prefix: 'St' });
    const b = await seedStaffData(request, adminB, tag, { prefix: 'Sb', attendanceOffset: 336 });
    const subA: SeededSubstitution = await seedSubstitution(request, adminA, tag);
    await expectReadableBy(request, adminA, a);
    await expectReadableBy(request, adminB, b);

    const views: Array<[Persona, SeededStaffData, SeededStaffData, string, string[]]> = [
      [adminA, a, b, TENANT_B, []],
      [adminB, b, a, TENANT_A, [subA.reason, subA.original.firstName, subA.substitute.firstName]],
    ];
    for (const [viewer, own, other, otherTenant, extraLeaks] of views) {
      const who = viewer.tenantId === TENANT_A ? 'tenant A' : 'tenant B';
      const leaked = [...other.strings, ...other.ids, other.staff.name, ...extraLeaks];
      for (const [label, extra] of [
        [`${who} JWT`, {}],
        [`${who} JWT + forged X-Tenant-ID`, { 'X-Tenant-ID': otherTenant }],
      ] as Array<[string, Record<string, string>]>) {
        // The viewer's own record is served: the request ran in the viewer's tenant.
        const mine = await probe(
          request,
          viewer,
          'GET',
          `/staff/${own.staff.id}`,
          undefined,
          extra,
        );
        expect.soft(mine.status, `${label} GET own staff`).toBe(200);
        expect.soft(mine.body, `${label} GET own staff body`).toContain(own.staff.identityNumber);
        // Tenant-wide lists, and lists filtered to the other tenant's date, month and name.
        const lists = [
          ...screenReads(own).filter((x) => !x.includes(own.staff.id)),
          `/staff?search=${other.staff.firstName}`,
          `/staff/attendance?date=${other.attendance.date}`,
          `/staff/attendance/summary?month=${other.attendance.date.slice(0, 7)}`,
          `/staff/payroll/export?month=${other.payroll.month}`,
          '/timetable/substitutions',
        ];
        for (const path of lists) {
          const r = await probe(request, viewer, 'GET', path, undefined, extra);
          expect.soft(r.status, `${label} GET ${path}`).toBe(200);
          for (const s of leaked) {
            expect.soft(r.body, `${label} GET ${path} body`).not.toContain(s);
          }
        }
        // Reads keyed by the other tenant's ids find nothing.
        const keyed = [
          `/staff/${other.staff.id}`,
          `/staff/${other.staff.id}/leave-balances`,
          `/staff/contracts/${other.contract.id}`,
        ];
        for (const path of keyed) {
          const r = await probe(request, viewer, 'GET', path, undefined, extra);
          const shown = path.split(other.staff.id).join('<other>');
          expect.soft(r.status, `${label} GET ${shown}`).toBe(404);
          // A not-found message may echo the requested id; nothing else may come back.
          for (const s of leaked.filter((x) => !path.includes(x))) {
            expect.soft(r.body, `${label} GET ${shown} body`).not.toContain(s);
          }
        }
        for (const path of [
          `/staff/contracts?staffId=${other.staff.id}`,
          `/staff/qualifications?staffId=${other.staff.id}`,
          `/staff/attendance?staffId=${other.staff.id}`,
          `/staff/appraisals?staffId=${other.staff.id}`,
          `/staff/training/certifications?staffId=${other.staff.id}`,
        ]) {
          const r = await probe(request, viewer, 'GET', path, undefined, extra);
          const shown = path.split(other.staff.id).join('<other>');
          expect.soft(r.status, `${label} GET ${shown}`).toBe(200);
          const rows = r.status === 200 ? (JSON.parse(r.body) as { data?: Row[] }).data : null;
          expect.soft(rows, `${label} GET ${shown} is empty`).toEqual([]);
        }
      }

      // Screens. Staff ids are in route URLs (`/staff/<id>`), and `next dev` (the harness's
      // web server) can echo an earlier request's route params in its React debug payload,
      // so the HTML checks leave staff ids out; every other id and string stays secret.
      const screenLeaked = leaked.filter((s) => s !== other.staff.id);
      await page.context().clearCookies();
      await openAs(page, viewer);
      for (const route of [
        ...staffRoutes(own.staff.id),
        `/staff/attendance?date=${other.attendance.date}`,
      ]) {
        await open(page, route);
        await expectNotInPage(page, `${who} ${route}`, screenLeaked);
      }
      // The other tenant's payroll month built on screen holds none of its rows.
      await open(page, '/staff/payroll');
      const panel = await hydratedForm(page, 'staff-payroll-panel');
      await panel.getByLabel('Month').fill(other.payroll.month);
      await panel.getByRole('button', { name: 'Build export' }).click();
      await expect(panel.getByTestId('staff-payroll-row').first()).toBeVisible({
        timeout: 30_000,
      });
      await expect(
        panel.getByTestId('staff-payroll-row').filter({ hasText: other.staff.name }),
      ).toHaveCount(0);
      await expectNotInPage(page, `${who} /staff/payroll ${other.payroll.month}`, screenLeaked);
      // The screens did load live data: the viewer's own contract is in its registry.
      await open(page, '/staff/contracts');
      await expect(
        page.getByTestId('staff-contract-row').filter({ hasText: own.contract.band }),
      ).toHaveCount(1);
      // The other tenant's staff id in the URL is not found.
      await open(page, `/staff/${other.staff.id}`);
      await expect(page.getByRole('heading', { level: 1, name: other.staff.name })).toHaveCount(0);
      await expectNotInPage(page, `${who} /staff/<other id>`, screenLeaked);
    }
  });

  test("writes and decisions against another tenant's staff rows are refused and change nothing", async ({
    request,
  }) => {
    test.slow();
    const tag = newTag();
    const adminA = hrAdmin(`st-a-admin-${tag}`, TENANT_A);
    const adminB = hrAdmin(`st-b-admin-${tag}`, TENANT_B);
    const b = await seedStaffData(request, adminB, tag, { prefix: 'Sb', attendanceOffset: 337 });
    await expectReadableBy(request, adminB, b);
    const before = await snapshot(request, adminB, b);
    const marker = `ST p4 ${tag}`;
    // Only writes that name a tenant B row; creating new top-level rows (POST /staff,
    // import) in the caller's own tenant is allowed and not cross-tenant.
    const writes = screenWrites(b, marker).filter(
      ([, path]) => path !== '/staff' && !path.startsWith('/staff/import'),
    );
    const leaked = [...b.strings, b.staff.lastName];
    for (const [label, extra] of [
      ['tenant A JWT', {}],
      ['tenant A JWT + forged X-Tenant-ID', { 'X-Tenant-ID': TENANT_B }],
    ] as Array<[string, Record<string, string>]>) {
      for (const [method, path, data] of writes) {
        const r = await probe(request, adminA, method, path, data, extra);
        const shown = path.split(b.staff.id).join('<B>');
        expect.soft(r.status, `${label} ${method} ${shown}: ${r.body.slice(0, 200)}`).toBe(404);
        for (const s of leaked) {
          expect.soft(r.body, `${label} ${method} ${shown} body`).not.toContain(s);
        }
      }
    }
    expect(await snapshot(request, adminB, b), "tenant B's rows are unchanged").toEqual(before);
    for (const path of ['/staff/contracts', '/staff/qualifications', '/staff/leaves']) {
      const rows = await getAllPages(request, adminA, path);
      expect(
        rows.filter((r) => JSON.stringify(r).includes(marker) || r.staffId === b.staff.id),
        `tenant A ${path} gained no row`,
      ).toEqual([]);
    }
  });
});
