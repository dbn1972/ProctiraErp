import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import {
  BACKEND_READY,
  GATEWAY_URL,
  HOSTEL_ROUTES,
  TENANT_A,
  TENANT_B,
  apiHeaders,
  createStudent,
  expectNotInPage,
  getAllPages,
  getRows,
  hostelAdmin,
  newTag,
  openAs,
  parentUser,
  seedHostelData,
  studentUser,
  teacher,
  utcDate,
  type Persona,
  type Row,
  type SeededHostelData,
} from './fixtures/hostel-screens';

/**
 * Hostel module — privacy and tenancy negatives (P1–P4).
 *
 * Hostel residents, leaves, visitors, gate passes and night-roll marks are child and
 * safeguarding data. Each test seeds its own data set with a unique tag, proves the
 * tenant administrator can read it (positive control), then checks that roles without
 * hostel access and another tenant never receive it, on screen or through the API the
 * screens call.
 *
 * "Not shown" is checked against the page HTML (rendered text and the RSC payload), so
 * data that reaches the browser but is hidden also fails the test.
 *
 * /hostel/** has a web route guard (hostel/layout.tsx plus a per-page check, #733), so
 * these roles get an access-denied screen on every hostel route (H-D1 test below).
 *
 * A known open defect is not asserted here (defects.md): writes that reference another
 * tenant's hostel, block or room are accepted (H-D3). Its assertion lives in patches/
 * for the fix PR.
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
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  data?: Row,
  extra: Record<string, string> = {},
): Promise<Probe> {
  const res = await request.fetch(`${GATEWAY_URL}/api/v1${path}`, {
    method,
    headers: apiHeaders(p, extra),
    data,
  });
  return { method, path, status: res.status(), body: await res.text() };
}

/** Every GET the nine hostel screens make, keyed to `d` where the screen filters. */
function screenReads(d: SeededHostelData): string[] {
  return [
    '/hostel',
    '/hostel/blocks',
    '/hostel/rooms',
    '/hostel/beds',
    '/hostel/assignments',
    '/hostel/leaves',
    '/hostel/visitors',
    '/hostel/gate-passes',
    '/hostel/mess/plans',
    '/hostel/mess/subscriptions',
    '/hostel/fee-structures',
    `/hostel/blocks?hostelId=${d.hostel.id}`,
    `/hostel/rooms?blockId=${d.block.id}`,
    `/hostel/beds?roomId=${d.room.id}`,
    `/hostel/gate-passes?hostelId=${d.hostel.id}`,
    `/hostel/fee-structures?hostelId=${d.hostel.id}`,
    `/hostel/mess/plans?hostelId=${d.hostel.id}`,
    `/hostel/mess/menu?planId=${d.plan.id}`,
    `/hostel/mess/subscriptions?planId=${d.plan.id}`,
    `/hostel/attendance?blockId=${d.block.id}&onDate=${d.attendance.onDate}`,
  ];
}

/** Positive control: the seeding administrator reads every seeded row through the API. */
async function expectReadableBy(
  request: APIRequestContext,
  p: Persona,
  d: SeededHostelData,
): Promise<void> {
  const ids = (rows: Row[]) => rows.map((r) => r.id);
  expect(ids(await getRows(request, p, '/hostel'))).toContain(d.hostel.id);
  expect(ids(await getRows(request, p, `/hostel/blocks?hostelId=${d.hostel.id}`))).toEqual([
    d.block.id,
  ]);
  expect(ids(await getRows(request, p, `/hostel/rooms?blockId=${d.block.id}`))).toEqual([
    d.room.id,
  ]);
  expect(ids(await getRows(request, p, `/hostel/beds?roomId=${d.room.id}`))).toEqual([d.bed.id]);
  expect(ids(await getAllPages(request, p, '/hostel/assignments'))).toContain(d.assignment.id);
  expect(ids(await getAllPages(request, p, '/hostel/leaves'))).toContain(d.leave.id);
  expect(ids(await getAllPages(request, p, '/hostel/visitors'))).toContain(d.visitor.id);
  expect(ids(await getRows(request, p, `/hostel/gate-passes?hostelId=${d.hostel.id}`))).toEqual([
    d.gatePass.id,
  ]);
  expect(ids(await getRows(request, p, `/hostel/fee-structures?hostelId=${d.hostel.id}`))).toEqual([
    d.fee.id,
  ]);
  expect(ids(await getRows(request, p, `/hostel/mess/plans?hostelId=${d.hostel.id}`))).toEqual([
    d.plan.id,
  ]);
  expect(ids(await getRows(request, p, `/hostel/mess/menu?planId=${d.plan.id}`))).toEqual([
    d.menu.id,
  ]);
  expect(ids(await getRows(request, p, `/hostel/mess/subscriptions?planId=${d.plan.id}`))).toEqual([
    d.subscription.id,
  ]);
  expect(
    ids(
      await getRows(
        request,
        p,
        `/hostel/attendance?blockId=${d.block.id}&onDate=${d.attendance.onDate}`,
      ),
    ),
  ).toEqual([d.attendance.id]);
}

/** State of the seeded rows that a refused write or transition must not change. */
async function snapshot(request: APIRequestContext, p: Persona, d: SeededHostelData) {
  const mine = (rows: Row[]) => rows.filter((r) => r.studentId === d.student.id);
  return {
    hostels: (await getRows(request, p, '/hostel')).filter((h) =>
      String(h.name).includes(d.hostel.name.split(' ').pop()!),
    ).length,
    blocks: (await getRows(request, p, `/hostel/blocks?hostelId=${d.hostel.id}`)).length,
    beds: (await getRows(request, p, `/hostel/beds?roomId=${d.room.id}`)).map((b) => [
      b.id,
      b.isAvailable,
    ]),
    assignments: mine(await getAllPages(request, p, '/hostel/assignments')).map((a) => a.id),
    leaves: mine(await getAllPages(request, p, '/hostel/leaves')).map((l) => [l.id, l.status]),
    visitors: mine(await getAllPages(request, p, '/hostel/visitors')).map((v) => [v.id, v.status]),
    gatePasses: (await getRows(request, p, `/hostel/gate-passes?hostelId=${d.hostel.id}`)).map(
      (g) => [g.id, g.status],
    ),
    fees: (await getRows(request, p, `/hostel/fee-structures?hostelId=${d.hostel.id}`)).length,
    plans: (await getRows(request, p, `/hostel/mess/plans?hostelId=${d.hostel.id}`)).length,
    menu: (await getRows(request, p, `/hostel/mess/menu?planId=${d.plan.id}`)).length,
    subscriptions: (await getRows(request, p, `/hostel/mess/subscriptions?planId=${d.plan.id}`))
      .length,
    attendance: (
      await getRows(
        request,
        p,
        `/hostel/attendance?blockId=${d.block.id}&onDate=${d.attendance.onDate}`,
      )
    ).map((m) => [m.id, m.status]),
  };
}

function screenUrl(route: string, d: SeededHostelData): string {
  return route === '/hostel/attendance'
    ? `${route}?blockId=${d.block.id}&onDate=${d.attendance.onDate}`
    : route;
}

async function open(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('body')).toBeVisible();
  // Server components render before the response ends; let streaming settle.
  await page.waitForLoadState('load');
}

test.describe('Hostel privacy and tenancy — live (E2E_BACKEND_READY)', () => {
  test.skip(!BACKEND_READY, 'Requires live gateway (E2E_BACKEND_READY)');

  test('roles without hostel access get no hostel data on any hostel screen', async ({
    page,
    request,
  }) => {
    test.slow();
    const tag = newTag();
    const admin = hostelAdmin(`ho-admin-${tag}`);
    const d = await seedHostelData(request, admin, tag);
    await expectReadableBy(request, admin, d);

    // Positive control on screen: the administrator sees the seeded leave.
    await openAs(page, admin);
    await open(page, '/hostel/leaves');
    await expect(page.locator('main li', { hasText: d.leave.reason })).toHaveCount(1);

    // Teachers may read the student directory, so only hostel strings are secret for
    // them; portal roles must not get the resident's name either.
    const personas: Array<{ p: Persona; secret: string[] }> = [
      { p: teacher(`ho-t-${tag}`), secret: d.strings },
      { p: studentUser(`ho-s-${tag}`), secret: [...d.strings, d.student.label] },
      { p: parentUser(`ho-p-${tag}`), secret: [...d.strings, d.student.label] },
    ];
    for (const { p, secret } of personas) {
      await page.context().clearCookies();
      await openAs(page, p);
      const role = p.roles[0]!.roleId;
      for (const route of HOSTEL_ROUTES) {
        await open(page, screenUrl(route, d));
        await expectNotInPage(page, `${role} ${route}`, secret);
      }
    }
  });

  test('H-D1 roles without hostel access get an access-denied screen on every hostel route', async ({
    page,
  }) => {
    test.slow();
    const tag = newTag();
    for (const p of [
      teacher(`ho-t-${tag}`),
      studentUser(`ho-s-${tag}`),
      parentUser(`ho-p-${tag}`),
    ]) {
      await page.context().clearCookies();
      await openAs(page, p);
      const role = p.roles[0]!.roleId;
      for (const route of HOSTEL_ROUTES) {
        await open(page, route);
        await expect
          .soft(
            page.getByRole('alert').filter({ hasText: /access denied|not authori[sz]ed/i }),
            `${role} ${route}: access denied`,
          )
          .toHaveCount(1, { timeout: 8_000 });
        await expect
          .soft(page.locator('form[data-testid^="hostel-"]'), `${role} ${route}: no hostel forms`)
          .toHaveCount(0);
      }
    }
  });

  test('roles without hostel access are refused by every hostel API the screens use', async ({
    request,
  }) => {
    test.slow();
    const tag = newTag();
    const admin = hostelAdmin(`ho-admin-${tag}`);
    const d = await seedHostelData(request, admin, tag);
    await expectReadableBy(request, admin, d);
    const before = await snapshot(request, admin, d);

    const marker = `HO p2 ${tag}`;
    const day = utcDate(4);
    const writes: Array<['POST' | 'PUT', string, Row]> = [
      ['POST', '/hostel', { name: marker, code: `HOP2-${tag}` }],
      ['POST', '/hostel/blocks', { hostelId: d.hostel.id, name: marker }],
      ['POST', '/hostel/rooms', { blockId: d.block.id, roomNumber: `P2${tag}` }],
      ['POST', '/hostel/beds', { roomId: d.room.id, bedLabel: `P2${tag}` }],
      ['POST', '/hostel/assignments', { studentId: d.student.id, bedId: d.bed.id, startDate: day }],
      [
        'POST',
        '/hostel/leaves',
        { studentId: d.student.id, hostelId: d.hostel.id, startDate: day, endDate: day },
      ],
      [
        'POST',
        '/hostel/visitors',
        { hostelId: d.hostel.id, visitorName: marker, studentId: d.student.id, visitDate: day },
      ],
      [
        'POST',
        '/hostel/gate-passes',
        {
          hostelId: d.hostel.id,
          studentId: d.student.id,
          reason: marker,
          expectedOutAt: `${day}T08:00:00.000Z`,
          expectedInAt: `${day}T18:00:00.000Z`,
        },
      ],
      [
        'POST',
        '/hostel/fee-structures',
        { hostelId: d.hostel.id, roomType: marker, termLabel: marker, amountCents: 100 },
      ],
      ['POST', '/hostel/mess/plans', { hostelId: d.hostel.id, name: marker }],
      [
        'POST',
        '/hostel/mess/menu',
        { planId: d.plan.id, weekday: 1, meal: 'lunch', itemName: marker },
      ],
      [
        'POST',
        '/hostel/mess/subscriptions',
        { planId: d.plan.id, studentId: d.student.id, startDate: day },
      ],
      [
        'PUT',
        '/hostel/attendance',
        {
          blockId: d.block.id,
          studentId: d.student.id,
          onDate: d.attendance.onDate,
          status: 'present',
        },
      ],
      ['POST', `/hostel/leaves/${d.leave.id}/decide`, { status: 'approved' }],
      ['POST', `/hostel/visitors/${d.visitor.id}/status`, { status: 'checked_in' }],
      ['POST', `/hostel/gate-passes/${d.gatePass.id}/approve`, {}],
    ];
    const secret = [...d.strings, ...d.ids, d.student.label];
    for (const p of [
      teacher(`ho-t-${tag}`),
      studentUser(`ho-s-${tag}`),
      parentUser(`ho-p-${tag}`),
    ]) {
      const role = p.roles[0]!.roleId;
      const results: Probe[] = [];
      for (const path of screenReads(d)) results.push(await probe(request, p, 'GET', path));
      for (const [method, path, data] of writes) {
        results.push(await probe(request, p, method, path, data));
      }
      for (const r of results) {
        const shown = r.path.split(d.leave.id).join('<L>');
        expect.soft(r.status, `${role} ${r.method} ${shown}: ${r.body.slice(0, 200)}`).toBe(403);
        for (const s of secret) {
          expect.soft(r.body, `${role} ${r.method} ${shown} body`).not.toContain(s);
        }
      }
    }
    expect(await snapshot(request, admin, d), 'refused writes changed nothing').toEqual(before);
    const leaked = (await getRows(request, admin, '/hostel')).filter((h) => h.name === marker);
    expect(leaked, 'refused POST /hostel created no hostel').toEqual([]);
  });

  test("each tenant's hostel data never reaches the other tenant on screen or via the API", async ({
    page,
    request,
  }) => {
    test.slow();
    const tag = newTag();
    const adminA = hostelAdmin(`ho-a-admin-${tag}`, TENANT_A);
    const adminB = hostelAdmin(`ho-b-admin-${tag}`, TENANT_B);
    const a = await seedHostelData(request, adminA, tag, 'HO');
    const b = await seedHostelData(request, adminB, tag, 'HO-B');
    await expectReadableBy(request, adminA, a);
    await expectReadableBy(request, adminB, b);

    const views: Array<[Persona, SeededHostelData, SeededHostelData, string]> = [
      [adminA, a, b, TENANT_B],
      [adminB, b, a, TENANT_A],
    ];
    for (const [viewer, own, other, otherTenant] of views) {
      const who = viewer.tenantId === TENANT_A ? 'tenant A' : 'tenant B';
      const leaked = [...other.strings, ...other.ids, other.student.id, other.student.label];
      for (const [label, extra] of [
        [`${who} JWT`, {}],
        [`${who} JWT + forged X-Tenant-ID`, { 'X-Tenant-ID': otherTenant }],
      ] as Array<[string, Record<string, string>]>) {
        // Tenant-wide lists: 200, the viewer's own rows, nothing of the other tenant.
        const own200 = await probe(request, viewer, 'GET', '/hostel', undefined, extra);
        expect.soft(own200.status, `${label} GET /hostel`).toBe(200);
        expect
          .soft(own200.body, `${label} GET /hostel has its own hostel`)
          .toContain(own.hostel.id);
        for (const path of screenReads(own)) {
          const r = await probe(request, viewer, 'GET', path, undefined, extra);
          expect.soft(r.status, `${label} GET ${path}`).toBe(200);
          for (const s of leaked) {
            expect.soft(r.body, `${label} GET ${path} body`).not.toContain(s);
          }
        }
        // Reads keyed by the other tenant's ids return nothing.
        for (const path of screenReads(other).filter((x) => x.includes('?'))) {
          const r = await probe(request, viewer, 'GET', path, undefined, extra);
          expect.soft(r.status, `${label} GET ${path}`).toBe(200);
          const rows = r.status === 200 ? (JSON.parse(r.body) as { data?: Row[] }).data : null;
          expect.soft(rows, `${label} GET ${path} is empty`).toEqual([]);
        }
      }

      await page.context().clearCookies();
      await openAs(page, viewer);
      for (const route of HOSTEL_ROUTES) {
        await open(page, screenUrl(route, own));
        await expectNotInPage(page, `${who} ${route}`, leaked);
      }
      // The other tenant's block id in the URL falls back to the viewer's own blocks. The
      // page payload echoes the URL, so the block id itself is excluded from the check.
      await open(
        page,
        `/hostel/attendance?blockId=${other.block.id}&onDate=${other.attendance.onDate}`,
      );
      await expectNotInPage(
        page,
        `${who} /hostel/attendance?blockId=<other>`,
        leaked.filter((s) => s !== other.block.id),
      );
      await expect(
        page.getByTestId('hostel-attendance-row').filter({ hasText: other.attendance.reason }),
      ).toHaveCount(0);
      // The screens did load live data: the viewer's own hostel is on its register.
      await open(page, '/hostel');
      await expect(page.getByTestId('hostel-row').filter({ hasText: own.hostel.name })).toHaveCount(
        1,
      );
    }
  });

  test("writes and decisions against another tenant's hostel rows are refused and change nothing", async ({
    request,
  }) => {
    const tag = newTag();
    const adminA = hostelAdmin(`ho-a-admin-${tag}`, TENANT_A);
    const adminB = hostelAdmin(`ho-b-admin-${tag}`, TENANT_B);
    const b = await seedHostelData(request, adminB, tag, 'HO-B');
    await expectReadableBy(request, adminB, b);
    const studentA = await createStudent(request, adminA, tag);
    const before = await snapshot(request, adminB, b);

    const marker = `HO p4 ${tag}`;
    const day = utcDate(6);
    // Only the cross-tenant writes the API already refuses; the hostel, block and room
    // references it accepts today are H-D3 (patches/h-d3-cross-tenant-references.patch).
    const writes: Array<['POST' | 'PUT', string, Row]> = [
      [
        'POST',
        '/hostel/gate-passes',
        {
          hostelId: b.hostel.id,
          studentId: studentA.id,
          reason: marker,
          expectedOutAt: `${day}T08:00:00.000Z`,
          expectedInAt: `${day}T18:00:00.000Z`,
        },
      ],
      [
        'POST',
        '/hostel/fee-structures',
        { hostelId: b.hostel.id, roomType: marker, termLabel: marker, amountCents: 100 },
      ],
      ['POST', '/hostel/mess/plans', { hostelId: b.hostel.id, name: marker }],
      ['POST', '/hostel/assignments', { studentId: studentA.id, bedId: b.bed.id, startDate: day }],
      [
        'PUT',
        '/hostel/attendance',
        {
          blockId: b.block.id,
          studentId: studentA.id,
          onDate: b.attendance.onDate,
          status: 'present',
        },
      ],
      [
        'POST',
        '/hostel/mess/menu',
        { planId: b.plan.id, weekday: 3, meal: 'lunch', itemName: marker },
      ],
      [
        'POST',
        '/hostel/mess/subscriptions',
        { planId: b.plan.id, studentId: studentA.id, startDate: day },
      ],
      ['POST', `/hostel/leaves/${b.leave.id}/decide`, { status: 'approved' }],
      ['POST', `/hostel/visitors/${b.visitor.id}/status`, { status: 'checked_in' }],
      ['POST', `/hostel/gate-passes/${b.gatePass.id}/approve`, {}],
    ];
    const leaked = [...b.strings, b.student.label];
    for (const [label, extra] of [
      ['tenant A JWT', {}],
      ['tenant A JWT + forged X-Tenant-ID', { 'X-Tenant-ID': TENANT_B }],
    ] as Array<[string, Record<string, string>]>) {
      for (const [method, path, data] of writes) {
        const r = await probe(request, adminA, method, path, data, extra);
        expect.soft(r.status, `${label} ${method} ${path}: ${r.body.slice(0, 200)}`).toBe(404);
        for (const s of leaked) {
          expect.soft(r.body, `${label} ${method} ${path} body`).not.toContain(s);
        }
      }
    }
    expect(await snapshot(request, adminB, b), "tenant B's rows are unchanged").toEqual(before);
    for (const path of ['/hostel/fee-structures', '/hostel/mess/plans', '/hostel/gate-passes']) {
      const rows = await getRows(request, adminA, path);
      expect(
        rows.filter((r) => JSON.stringify(r).includes(marker)),
        `tenant A ${path} gained no row`,
      ).toEqual([]);
    }
  });
});
