import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import {
  BACKEND_READY,
  FEES_ROUTES,
  GATEWAY_URL,
  TENANT_A,
  TENANT_B,
  apiHeaders,
  cleanupFeesData,
  expectNotInPage,
  feesAdmin,
  invoicesFor,
  newTag,
  openAs,
  parentUser,
  seedFeesData,
  send,
  studentUser,
  teacher,
  type Persona,
  type Row,
  type SeededFeesData,
} from './fixtures/fees-screens';

/**
 * Fees module — privacy and tenancy negatives (P1–P4).
 *
 * Invoices, payments, receipts, refunds, concessions and scholarship credits are family
 * financial data. Each test seeds its own data set with a unique tag, proves the tenant
 * administrator can read it (positive control), then checks that roles without fees access
 * and another tenant never receive it, on screen or through the API the screens call,
 * with or without a forged `X-Tenant-ID`.
 *
 * "Not shown" is checked against the page HTML (rendered text and the RSC payload), so
 * data that reaches the browser but is hidden also fails the test.
 *
 * `/fees/**` has a web route guard (fees/layout.tsx plus a per-page check, #740): roles
 * outside admin / principal / super-admin get an access-denied screen. Behind it, the
 * gateway refuses them: teachers hold the gateway fees grant but the fees package refuses
 * them (403); students and parents are self-scoped, so the two lists they may read
 * (`/fees/invoices`, `/fees/receipts`) answer 200 with their own linked children only, and
 * every other fees call is 403.
 *
 * Known open defect not asserted here (defects.md): the finance roles (finance_officer,
 * bursar, accountant, registrar) are refused although the fees package allows them (F-D3).
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
  method: 'GET' | 'POST' | 'DELETE',
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

/** Lists the nine fees screens read (tenant-wide). */
const LIST_READS = [
  '/fees/plans',
  '/fees/invoices',
  '/fees/invoices?page=1&pageSize=50',
  '/fees/receipts',
  '/fees/receipts?page=1&pageSize=50',
  '/fees/structures',
  '/fees/reports/dues',
  '/fees/reconciliation/batches',
  '/fees/reminders/overdue',
  '/fees/reminders/suppressions',
  '/fees/reminders/audit',
  '/fees/scholarships/nettable-disbursements',
  '/fees/payments',
];

/**
 * What a student or parent gets for a fees read (by design, PRC-C005): the invoice and
 * receipt lists are self-scoped (200, own linked children only), a receipt by id answers
 * 404 unless it belongs to a linked child, and instalment schedules are structure-level
 * (not per-student) and readable. Everything else is staff-only (403).
 */
function portalReadStatus(path: string): number {
  if (/^\/fees\/(invoices|receipts)(\?(page=1&pageSize=50|studentId=[0-9a-f-]{36}))?$/.test(path)) {
    return 200;
  }
  if (/^\/fees\/receipts\/[0-9a-f-]{36}$/.test(path)) return 404;
  if (/^\/fees\/structures\/[0-9a-f-]{36}\/instalments$/.test(path)) return 200;
  return 403;
}

/** Reads keyed by one seeded row's id. */
function keyedReads(d: SeededFeesData): string[] {
  return [
    `/fees/invoices/${d.planInvoice.id}/ledger`,
    `/fees/structures/${d.structure.id}/instalments`,
    `/fees/reconciliation/batches/${d.batch.id}/rows`,
    `/fees/receipts/${d.planReceipt.id}`,
    `/fees/invoices?studentId=${d.student.id}`,
  ];
}

/** State of the seeded rows that a refused write must not change. */
async function snapshot(request: APIRequestContext, p: Persona, d: SeededFeesData) {
  const rows = await send<{ data: Array<Row> }>(
    request,
    p,
    'GET',
    `/fees/reconciliation/batches/${d.batch.id}/rows`,
  );
  const suppressions = await send<{ data: Array<{ id: string }> }>(
    request,
    p,
    'GET',
    '/fees/reminders/suppressions',
  );
  const audits = await send<{ data: Array<{ invoiceId: string }> }>(
    request,
    p,
    'GET',
    '/fees/reminders/audit',
  );
  const plans = await send<{ data: Array<{ id: string }> }>(request, p, 'GET', '/fees/plans');
  const structures = await send<{ data: Array<{ id: string }> }>(
    request,
    p,
    'GET',
    '/fees/structures',
  );
  const ledgers = [];
  for (const id of [d.planInvoice.id, d.structureInvoice.id]) {
    ledgers.push(
      (
        await send<{ data: Array<{ id: string }> }>(
          request,
          p,
          'GET',
          `/fees/invoices/${id}/ledger`,
        )
      ).data.length,
    );
  }
  return {
    invoices: (await invoicesFor(request, p, d.student.id))
      .map((i) => [i.id, i.amountCents, i.status])
      .sort(),
    ledgers,
    recon: rows.data.map((r) => [r.id, r.exceptionStatus, r.resolutionNote]).sort(),
    suppression: suppressions.data.some((s) => s.id === d.suppression.id),
    audits: audits.data.filter((a) =>
      [d.planInvoice.id, d.structureInvoice.id].includes(a.invoiceId),
    ).length,
    plans: plans.data.length,
    structures: structures.data.length,
  };
}

/** Positive control: the seeding administrator reads every seeded row through the API. */
async function expectReadableBy(request: APIRequestContext, p: Persona, d: SeededFeesData) {
  const ids = (rows: Array<{ id: string }>) => rows.map((r) => r.id);
  expect(
    ids((await send<{ data: Array<{ id: string }> }>(request, p, 'GET', '/fees/plans')).data),
  ).toContain(d.plan.id);
  expect(ids(await invoicesFor(request, p, d.student.id)).sort()).toEqual(
    [d.planInvoice.id, d.structureInvoice.id].sort(),
  );
  const batches = await send<{ data: Array<{ id: string }> }>(
    request,
    p,
    'GET',
    '/fees/reconciliation/batches',
  );
  expect(ids(batches.data)).toContain(d.batch.id);
  const receipt = await send<{ id: string }>(
    request,
    p,
    'GET',
    `/fees/receipts/${d.planReceipt.id}`,
  );
  expect(receipt.id).toBe(d.planReceipt.id);
}

async function open(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('body')).toBeVisible();
  // Server components render before the response ends; let streaming settle.
  await page.waitForLoadState('load');
}

test.describe('Fees privacy and tenancy — live (E2E_BACKEND_READY)', () => {
  test.skip(!BACKEND_READY, 'Requires live gateway (E2E_BACKEND_READY)');

  test.describe('roles without fees access on every fees route', () => {
    let d: SeededFeesData;
    const tag = newTag();
    const admin = feesAdmin(`fe-admin-${tag}`);

    test.beforeAll(async ({ request }) => {
      d = await seedFeesData(request, admin, tag);
      await expectReadableBy(request, admin, d);
    });

    test.afterAll(async ({ request }) => {
      if (d) await cleanupFeesData(request, admin, d);
    });

    test('the administrator sees the seeded rows (positive control)', async ({ page }) => {
      await openAs(page, admin);
      await open(page, '/fees/dunning');
      await expect(
        page
          .getByTestId('dunning-overdue-table')
          .locator('tr', { hasText: d.planInvoice.invoiceNumber }),
      ).toHaveCount(1);
    });

    // Teachers may read the student directory, so only fee strings are secret for them;
    // portal roles must not get the student's name either.
    for (const [role, make, portal] of [
      ['teacher', teacher, false],
      ['student', studentUser, true],
      ['parent', parentUser, true],
    ] as const) {
      test(`${role}: access-denied screen and no fees data on all nine routes`, async ({
        page,
      }) => {
        test.slow();
        const p = make(`fe-${role}-${tag}`);
        const secret = [...d.strings, ...d.ids, ...(portal ? [d.student.label] : [])];
        await openAs(page, p);
        for (const route of FEES_ROUTES) {
          await open(page, route);
          await expect
            .soft(page.getByTestId('route-access-denied'), `${role} ${route}: access denied`)
            .toHaveCount(1, { timeout: 8_000 });
          await expect
            .soft(page.locator('main form'), `${role} ${route}: no fees forms`)
            .toHaveCount(0);
          await expectNotInPage(page, `${role} ${route}`, secret);
        }
      });
    }
  });

  test('roles without fees access are refused by every fees API the screens use', async ({
    request,
  }) => {
    test.slow();
    const tag = newTag();
    const admin = feesAdmin(`fe-admin-${tag}`);
    const d = await seedFeesData(request, admin, tag);
    try {
      await expectReadableBy(request, admin, d);
      const before = await snapshot(request, admin, d);
      const marker = `FE p2 ${tag}`;
      const exceptionRow = (
        await send<{ data: Array<{ id: string; matched: boolean }> }>(
          request,
          admin,
          'GET',
          `/fees/reconciliation/batches/${d.batch.id}/rows`,
        )
      ).data.find((r) => !r.matched)!;
      const writes: Array<['POST' | 'DELETE', string, Row | undefined]> = [
        ['POST', '/fees/plans', { name: marker, code: `FE-P2${tag}`, amountCents: 100 }],
        ['POST', '/fees/invoices', { studentId: d.student.id, title: marker, amountCents: 100 }],
        [
          'POST',
          `/fees/invoices/${d.planInvoice.id}/pay`,
          {
            method: 'upi',
            amountCents: 100,
            reference: `P2-${tag}`,
            idempotencyKey: crypto.randomUUID(),
          },
        ],
        ['POST', `/fees/invoices/${d.planInvoice.id}/refund`, { amountCents: 100, reason: marker }],
        ['POST', `/fees/invoices/${d.planInvoice.id}/void`, { reason: marker }],
        [
          'POST',
          '/fees/concessions',
          {
            studentId: d.student.id,
            structureId: d.structure.id,
            invoiceId: d.structureInvoice.id,
            kind: 'percent',
            percent: 50,
            reason: marker,
          },
        ],
        ['POST', '/fees/structures', { name: marker, category: 'tuition', amountCents: 100 }],
        ['POST', `/fees/structures/${d.structure.id}/bulk-invoice`, { studentIds: [d.student.id] }],
        [
          'POST',
          '/fees/reconciliation/import',
          {
            csv: `invoiceNumber,amountCents\n${d.planInvoice.invoiceNumber},1`,
            filename: `${marker}.csv`,
          },
        ],
        [
          'POST',
          `/fees/reconciliation/rows/${exceptionRow.id}/resolve`,
          { status: 'resolved', resolutionNote: marker },
        ],
        ['POST', '/fees/reminders/suppressions', { studentId: d.student.id, reason: marker }],
        ['DELETE', `/fees/reminders/suppressions/${d.suppression.id}`, undefined],
        [
          'POST',
          '/fees/reminders/send',
          { invoiceIds: [d.structureInvoice.id], channels: ['email', 'sms'] },
        ],
        [
          'POST',
          '/fees/scholarships/net',
          {
            studentId: d.student.id,
            disbursementId: d.disbursement!.id,
            invoiceId: d.structureInvoice.id,
          },
        ],
      ];
      const secret = [...d.strings, ...d.ids, d.student.label, d.student.id];
      for (const p of [
        teacher(`fe-t-${tag}`),
        studentUser(`fe-s-${tag}`),
        parentUser(`fe-p-${tag}`),
      ]) {
        const role = p.roles[0]!.roleId;
        const results: Array<Probe & { expected: number }> = [];
        for (const path of [...LIST_READS, ...keyedReads(d)]) {
          const expected = role === 'teacher' ? 403 : portalReadStatus(path);
          results.push({ ...(await probe(request, p, 'GET', path)), expected });
        }
        for (const [method, path, data] of writes) {
          results.push({ ...(await probe(request, p, method, path, data)), expected: 403 });
        }
        for (const r of results) {
          const shown = r.path.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, '<id>');
          expect
            .soft(r.status, `${role} ${r.method} ${shown}: ${r.body.slice(0, 200)}`)
            .toBe(r.expected);
          if (r.expected === 200) {
            expect.soft(JSON.parse(r.body).data, `${role} GET ${shown} rows`).toEqual([]);
          }
          // A 404 echoes the id the caller asked for; nothing else may come back.
          for (const s of secret.filter((x) => !r.path.includes(x))) {
            expect.soft(r.body, `${role} ${r.method} ${shown} body`).not.toContain(s);
          }
        }
      }
      expect(await snapshot(request, admin, d), 'refused writes changed nothing').toEqual(before);
      const nettable = await send<{ data: Array<{ id: string }> }>(
        request,
        admin,
        'GET',
        '/fees/scholarships/nettable-disbursements',
      );
      expect(
        nettable.data.map((x) => x.id),
        'refused netting left the credit unapplied',
      ).toContain(d.disbursement!.id);
    } finally {
      await cleanupFeesData(request, admin, d);
    }
  });

  test("each tenant's fee data never reaches the other tenant on screen or via the API", async ({
    page,
    request,
  }) => {
    test.slow();
    const tag = newTag();
    const adminA = feesAdmin(`fe-a-admin-${tag}`, TENANT_A);
    const adminB = feesAdmin(`fe-b-admin-${tag}`, TENANT_B);
    const a = await seedFeesData(request, adminA, tag, 'FE');
    const b = await seedFeesData(request, adminB, tag, 'FEB');
    try {
      await expectReadableBy(request, adminA, a);
      await expectReadableBy(request, adminB, b);
      const views: Array<[Persona, SeededFeesData, SeededFeesData, string]> = [
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
          // Tenant-wide lists: 200, nothing of the other tenant.
          for (const path of LIST_READS) {
            const r = await probe(request, viewer, 'GET', path, undefined, extra);
            expect.soft(r.status, `${label} GET ${path}`).toBe(200);
            for (const s of leaked) {
              expect.soft(r.body, `${label} GET ${path} body`).not.toContain(s);
            }
          }
          // The viewer's own rows are there (the lists did read live data).
          const own200 = await probe(request, viewer, 'GET', '/fees/plans', undefined, extra);
          expect
            .soft(own200.body, `${label} GET /fees/plans has its own plan`)
            .toContain(own.plan.id);
          // Reads keyed by the other tenant's ids find nothing.
          const [ledger, instalments, rows, receipt, byStudent] = keyedReads(other);
          for (const path of [ledger!, instalments!, receipt!]) {
            const r = await probe(request, viewer, 'GET', path, undefined, extra);
            expect.soft(r.status, `${label} GET ${path}`).toBe(404);
          }
          for (const path of [rows!, byStudent!]) {
            const r = await probe(request, viewer, 'GET', path, undefined, extra);
            expect.soft(r.status, `${label} GET ${path}`).toBe(200);
            const data = r.status === 200 ? (JSON.parse(r.body) as { data?: Row[] }).data : null;
            expect.soft(data, `${label} GET ${path} is empty`).toEqual([]);
          }
        }
        await page.context().clearCookies();
        await openAs(page, viewer);
        for (const route of FEES_ROUTES) {
          await open(page, route);
          await expectNotInPage(page, `${who} ${route}`, leaked);
        }
        // The other tenant's batch id in the URL falls back to the viewer's own batches. The
        // page payload echoes the URL, so the batch id itself is excluded from the check.
        await open(page, `/fees/reconciliation?batch=${other.batch.id}`);
        await expectNotInPage(
          page,
          `${who} /fees/reconciliation?batch=<other>`,
          leaked.filter((s) => s !== other.batch.id),
        );
        // The screens did load live data: the viewer's own plan is on its register.
        await open(page, '/fees/plans');
        await expect(
          page.getByTestId('fee-plan-row').filter({ hasText: own.plan.name }),
        ).toHaveCount(1);
      }
    } finally {
      await cleanupFeesData(request, adminA, a);
      await cleanupFeesData(request, adminB, b);
    }
  });

  test("payments, refunds and other writes against another tenant's fee rows are refused and change nothing", async ({
    request,
  }) => {
    const tag = newTag();
    const adminA = feesAdmin(`fe-a-admin-${tag}`, TENANT_A);
    const adminB = feesAdmin(`fe-b-admin-${tag}`, TENANT_B);
    const b = await seedFeesData(request, adminB, tag, 'FEB');
    try {
      await expectReadableBy(request, adminB, b);
      const concession = await send<{ concession: { id: string } }>(
        request,
        adminB,
        'POST',
        '/fees/concessions',
        {
          studentId: b.student.id,
          structureId: b.structure.id,
          invoiceId: b.structureInvoice.id,
          kind: 'percent',
          percent: 10,
          reason: `FEB pending ${tag}`,
        },
      );
      const exceptionRow = (
        await send<{ data: Array<{ id: string; matched: boolean }> }>(
          request,
          adminB,
          'GET',
          `/fees/reconciliation/batches/${b.batch.id}/rows`,
        )
      ).data.find((r) => !r.matched)!;
      const before = await snapshot(request, adminB, b);
      const marker = `FE p4 ${tag}`;
      const refused: Array<['POST' | 'DELETE', string, Row | undefined, number]> = [
        [
          'POST',
          `/fees/invoices/${b.structureInvoice.id}/pay`,
          {
            method: 'cash',
            amountCents: 100,
            reference: `P4-${tag}`,
            idempotencyKey: crypto.randomUUID(),
          },
          404,
        ],
        [
          'POST',
          `/fees/invoices/${b.planInvoice.id}/refund`,
          { amountCents: 100, reason: marker },
          404,
        ],
        ['POST', `/fees/invoices/${b.planInvoice.id}/void`, { reason: marker }, 404],
        [
          'POST',
          `/fees/invoices/${b.structureInvoice.id}/credit-notes`,
          { amountCents: 100, reason: marker },
          404,
        ],
        [
          'POST',
          `/fees/invoices/${b.structureInvoice.id}/write-offs`,
          { amountCents: 100, reason: marker },
          404,
        ],
        [
          'POST',
          '/fees/concessions',
          {
            studentId: b.student.id,
            structureId: b.structure.id,
            invoiceId: b.structureInvoice.id,
            kind: 'percent',
            percent: 50,
            reason: marker,
          },
          404,
        ],
        ['POST', `/fees/concessions/${concession.concession.id}/approve`, {}, 404],
        ['POST', `/fees/structures/${b.structure.id}/instalments`, { partCount: 2 }, 404],
        [
          'POST',
          `/fees/structures/${b.structure.id}/bulk-invoice`,
          { studentIds: [b.student.id] },
          404,
        ],
        [
          'POST',
          `/fees/structures/${b.structure.id}/bulk-invoice/preview`,
          { studentIds: [b.student.id] },
          404,
        ],
        [
          'POST',
          `/fees/reconciliation/rows/${exceptionRow.id}/resolve`,
          { status: 'resolved', resolutionNote: marker },
          404,
        ],
        ['DELETE', `/fees/reminders/suppressions/${b.suppression.id}`, undefined, 404],
        // References to tenant B rows are unknown in tenant A.
        [
          'POST',
          '/fees/reminders/suppressions',
          { invoiceId: b.planInvoice.id, reason: marker },
          422,
        ],
        [
          'POST',
          '/fees/invoices',
          { studentId: b.student.id, title: marker, amountCents: 100 },
          422,
        ],
      ];
      const leaked = [...b.strings, b.student.label, b.student.id];
      for (const [label, extra] of [
        ['tenant A JWT', {}],
        ['tenant A JWT + forged X-Tenant-ID', { 'X-Tenant-ID': TENANT_B }],
      ] as Array<[string, Record<string, string>]>) {
        for (const [method, path, data, status] of refused) {
          const r = await probe(request, adminA, method, path, data, extra);
          const shown = path.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, '<id>');
          expect
            .soft(r.status, `${label} ${method} ${shown}: ${r.body.slice(0, 200)}`)
            .toBe(status);
          for (const s of leaked) {
            expect.soft(r.body, `${label} ${method} ${shown} body`).not.toContain(s);
          }
        }
        // A reminder for tenant B's overdue invoice is skipped as unknown; nothing is sent.
        const sent = await probe(
          request,
          adminA,
          'POST',
          '/fees/reminders/send',
          { invoiceIds: [b.structureInvoice.id], channels: ['email', 'sms'] },
          extra,
        );
        expect.soft(sent.status, `${label} POST /fees/reminders/send`).toBe(200);
        const results =
          sent.status === 200 ? (JSON.parse(sent.body) as { results: Row[] }).results : [];
        expect.soft(results, `${label} reminder results`).toEqual([
          expect.objectContaining({
            channel: 'email',
            messageId: null,
            skippedReason: 'not_overdue_or_unknown',
          }),
          expect.objectContaining({
            channel: 'sms',
            messageId: null,
            skippedReason: 'not_overdue_or_unknown',
          }),
        ]);
        for (const s of leaked) {
          expect.soft(sent.body, `${label} POST /fees/reminders/send body`).not.toContain(s);
        }
      }
      expect(await snapshot(request, adminB, b), "tenant B's fee rows are unchanged").toEqual(
        before,
      );
      const audits = await send<{ data: Array<{ invoiceId: string }> }>(
        request,
        adminA,
        'GET',
        '/fees/reminders/audit',
      );
      expect(
        audits.data.filter((x) => x.invoiceId === b.structureInvoice.id),
        'no audit in A',
      ).toEqual([]);
      const plans = await send<{ data: Array<{ name: string }> }>(
        request,
        adminA,
        'GET',
        '/fees/plans',
      );
      expect(plans.data.filter((x) => x.name === marker)).toEqual([]);
    } finally {
      await cleanupFeesData(request, adminB, b);
    }
  });
});
