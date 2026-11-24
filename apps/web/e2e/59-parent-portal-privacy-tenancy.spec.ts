/**
 * Parent portal — privacy and tenancy negatives (child data and PII).
 *
 * A guardian must not see a child who is not linked to them, nor another
 * tenant's child or rows, on the parent screens or through the gateway routes
 * those screens call. Every negative has a positive control: the owning
 * guardian (or the same guardian with the other tenant's JWT) sees the same
 * rows, and the guardian under test sees their own child's rows on the same
 * screens, so an empty or broken page cannot pass a negative by accident.
 *
 * Code facts asserted here: an unlinked or no-custody child is a 404 from
 * parent-portal-service.ts `assertParentLinkedToStudent` (no existence leak);
 * AcademicFrame `pickChild` renders "You can only view records for students
 * linked to your account." for an unlinked `?studentId`; the thread page calls
 * notFound() for a thread outside the guardian's list; the gateway ignores a
 * client X-Tenant-ID and takes the tenant from the verified JWT.
 *
 * Families, children and rows are created per run with unique tags
 * (fixtures/parent-portal-family.ts), so re-runs on the same database are
 * deterministic. Failing-first evidence for these tests was produced with
 * local-only mutations (wrong link, wrong tenant, web scope break, API scope
 * break) that are not part of the repository.
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import {
  GATEWAY_URL,
  TENANT_A,
  TENANT_B,
  adminHeaders,
  createFamily,
  guardianHeaders,
  newTag,
  openAsGuardian,
  publishGrade,
  type Child,
  type Family,
} from './fixtures/parent-portal-family';
import { parentPortalJwtHeaders } from './fixtures/parent-portal-auth';

const BACKEND_READY = !!process.env.E2E_BACKEND_READY;

const FORBIDDEN_TEXT = 'You can only view records for students linked to your account.';

/** Child views the academic screens read (packages/backend/parent-portal/src/routes.ts childViews). */
const CHILD_VIEWS = [
  'attendance',
  'grades',
  'timetable',
  'homework',
  'lms',
  'report-cards',
  'pal',
  'calendar',
  'notices',
] as const;

type Json = Record<string, unknown>;
type Rows = Json[];

async function call(
  request: APIRequestContext,
  method: 'get' | 'post',
  path: string,
  headers: Record<string, string>,
  data?: unknown,
): Promise<{ status: number; text: string }> {
  const res = await request[method](`${GATEWAY_URL}/api/v1${path}`, { headers, data });
  return { status: res.status(), text: await res.text() };
}

async function send(
  request: APIRequestContext,
  path: string,
  data: unknown,
  headers: Record<string, string> = adminHeaders(),
): Promise<Json> {
  const res = await call(request, 'post', path, headers, data);
  expect(res.status, `POST ${path}: ${res.text}`).toBe(201);
  return JSON.parse(res.text) as Json;
}

async function list(
  request: APIRequestContext,
  path: string,
  headers: Record<string, string>,
): Promise<Rows> {
  const res = await call(request, 'get', path, headers);
  expect(res.status, `GET ${path}: ${res.text}`).toBe(200);
  return (JSON.parse(res.text) as { data: Rows }).data;
}

/** Records the actual status in the report (annotation) and asserts it is one of `allowed`. */
function expectDenied(
  label: string,
  res: { status: number; text: string },
  allowed: number[] = [404],
): void {
  test.info().annotations.push({ type: 'denied-status', description: `${label} -> ${res.status}` });
  expect(allowed, `${label} returned ${res.status}: ${res.text}`).toContain(res.status);
}

function only<T>(rows: T[]): T {
  expect(rows).toHaveLength(1);
  return rows[0] as T;
}

/** Staff invoice, staff consent request and a guardian thread for one child. */
async function seedChildRows(
  request: APIRequestContext,
  input: {
    tenantId: string;
    guardianSub: string;
    child: Child;
    invoiceTitle: string;
    consentTitle: string;
    threadSubject: string;
    threadBody: string;
  },
): Promise<{ invoiceId: string; consentId: string; threadId: string }> {
  const staff = adminHeaders(input.tenantId);
  const invoice = await send(
    request,
    '/fees/invoices',
    { studentId: input.child.id, title: input.invoiceTitle, amountCents: 10_000 },
    staff,
  );
  expect(invoice.status).toBe('open');
  const consent = await send(
    request,
    '/parent-portal/consents',
    {
      studentId: input.child.id,
      parentUserId: input.guardianSub,
      consentType: 'photo_media',
      title: input.consentTitle,
      consentVersion: 'photo-media-v2026-01',
    },
    staff,
  );
  const thread = await send(
    request,
    '/parent-portal/messages/threads',
    { studentId: input.child.id, subject: input.threadSubject, body: input.threadBody },
    guardianHeaders(input.guardianSub, input.tenantId),
  );
  return {
    invoiceId: invoice.id as string,
    consentId: consent.id as string,
    threadId: (thread.thread as Json).id as string,
  };
}

/** Home lists exactly the guardian's own child and none of the hidden child's PII. */
async function expectHomeShowsOnly(page: Page, own: Child, hidden: Child): Promise<void> {
  await page.goto('/parent', { waitUntil: 'domcontentloaded' });
  const home = page.getByTestId('parent-home');
  await expect(home).toBeVisible();
  await expect(home.getByText('1 linked child.')).toBeVisible();
  await expect(home.getByRole('listitem').filter({ hasText: own.label })).toHaveCount(1);
  await expect(home).not.toContainText(hidden.label);
}

/** Fees, consents and messages show the own row and not the hidden one. */
async function expectListsShowOnly(
  page: Page,
  own: { invoice: string; consent: string; thread: string },
  hidden: { invoice: string; consent: string; thread: string; childLabel: string },
): Promise<void> {
  await page.goto('/parent/fees', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { level: 1, name: 'Fees' })).toBeVisible();
  const invoices = page.getByTestId('parent-invoice-row');
  await expect(invoices.filter({ hasText: own.invoice })).toHaveCount(1);
  await expect(invoices.filter({ hasText: hidden.invoice })).toHaveCount(0);
  await expect(page.getByRole('main')).not.toContainText(hidden.childLabel);

  await page.goto('/parent/consents', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { level: 1, name: 'Consents' })).toBeVisible();
  const consents = page.getByTestId('parent-consent-row');
  await expect(consents.filter({ hasText: own.consent })).toHaveCount(1);
  await expect(consents.filter({ hasText: hidden.consent })).toHaveCount(0);
  await expect(page.getByRole('main')).not.toContainText(hidden.childLabel);

  await page.goto('/parent/messages', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { level: 1, name: 'Messages' })).toBeVisible();
  const threads = page.getByTestId('parent-thread-row');
  await expect(threads.filter({ hasText: own.thread })).toHaveCount(1);
  await expect(threads.filter({ hasText: hidden.thread })).toHaveCount(0);
  await expect(page.getByRole('main')).not.toContainText(hidden.childLabel);
}

/** An explicit `?studentId=` for a child the guardian may not see renders the forbidden frame. */
async function expectForbiddenFrame(page: Page, testId: string, mustNotShow: string[]) {
  const screen = page.getByTestId(testId);
  await expect(screen).toBeVisible();
  await expect(screen.getByRole('status')).toHaveText(FORBIDDEN_TEXT);
  await expect(screen.getByText('This record is not available for your account.')).toBeVisible();
  for (const text of mustNotShow) await expect(screen).not.toContainText(text);
}

function ids(rows: Rows, key: string): unknown[] {
  return rows.map((row) => row[key]);
}

test.describe('Parent portal — privacy and tenancy negatives (E2E_BACKEND_READY)', () => {
  test.skip(!BACKEND_READY, 'Requires E2E_BACKEND_READY=1 and a live gateway + Postgres');

  test('unlinked child in the same tenant is hidden on screen and via API', async ({
    page,
    request,
  }) => {
    test.slow();
    const tag = newTag();
    // F1 = guardian under test (G1, C1); F2 = another family in the same tenant (G2, C3).
    const f1: Family = await createFamily(request, { childCount: 1, tag });
    const f2: Family = await createFamily(request, { childCount: 1, tag: newTag() });
    const [c1] = f1.children as [Child];
    const [c3] = f2.children as [Child];
    const g1 = guardianHeaders(f1.guardianSub);
    const g2 = guardianHeaders(f2.guardianSub);

    const gradeX = `PPX-${tag}`;
    await publishGrade(request, c3.id, gradeX);
    const hidden = {
      invoice: `PP fee X ${tag}`,
      consent: `PP consent X ${tag}`,
      thread: `PP thread X ${tag}`,
      secret: `PP secret ${tag}`,
    };
    const x = await seedChildRows(request, {
      tenantId: TENANT_A,
      guardianSub: f2.guardianSub,
      child: c3,
      invoiceTitle: hidden.invoice,
      consentTitle: hidden.consent,
      threadSubject: hidden.thread,
      threadBody: hidden.secret,
    });
    const own = {
      invoice: `PP fee A ${tag}`,
      consent: `PP consent A ${tag}`,
      thread: `PP thread A ${tag}`,
    };
    await seedChildRows(request, {
      tenantId: TENANT_A,
      guardianSub: f1.guardianSub,
      child: c1,
      invoiceTitle: own.invoice,
      consentTitle: own.consent,
      threadSubject: own.thread,
      threadBody: `PP own body ${tag}`,
    });

    // Positive control: C3's own guardian sees every row this test hides from G1.
    expect(ids(await list(request, '/parent-portal/children', g2), 'studentId')).toContain(c3.id);
    expect(
      ids(await list(request, `/parent-portal/children/${c3.id}/grades`, g2), 'assessmentCode'),
    ).toContain(gradeX);
    expect(ids(await list(request, '/fees/invoices?scope=parent', g2), 'id')).toContain(
      x.invoiceId,
    );
    expect(ids(await list(request, '/parent-portal/consents', g2), 'id')).toContain(x.consentId);
    expect(ids(await list(request, '/parent-portal/messages/threads', g2), 'id')).toContain(
      x.threadId,
    );
    expect((await call(request, 'get', `/students/${c3.id}`, g2)).status).toBe(200);

    // Screens as G1.
    await openAsGuardian(page, f1);
    await expectHomeShowsOnly(page, c1, c3);

    await page.goto(`/parent/grades?studentId=${c3.id}`, { waitUntil: 'domcontentloaded' });
    await expectForbiddenFrame(page, 'parent-grades', [gradeX, c3.label]);
    await page.goto(`/parent/attendance?studentId=${c3.id}`, { waitUntil: 'domcontentloaded' });
    await expectForbiddenFrame(page, 'parent-attendance', [c3.label]);

    await expectListsShowOnly(page, own, { ...hidden, childLabel: c3.label });
    // Still on /parent/messages: the new-thread child picker offers only G1's child.
    const picker = page.locator('#thread-student');
    await expect(picker.locator(`option[value="${c1.id}"]`)).toHaveCount(1);
    await expect(picker.locator(`option[value="${c3.id}"]`)).toHaveCount(0);

    const threadPage = await page.goto(`/parent/messages/${x.threadId}`, {
      waitUntil: 'domcontentloaded',
    });
    test.info().annotations.push({
      type: 'denied-status',
      description: `screen /parent/messages/<C3 thread> -> HTTP ${threadPage?.status()}`,
    });
    await expect(page.getByTestId('not-found-page')).toBeVisible();
    await expect(page.locator('body')).not.toContainText(hidden.secret);
    await expect(page.locator('body')).not.toContainText(hidden.thread);

    await page.goto('/parent/scholarships', { waitUntil: 'domcontentloaded' });
    const childSelect = page.getByLabel('Child', { exact: true });
    await expect(childSelect.locator(`option[value="${c1.id}"]`)).toHaveCount(1);
    await expect(childSelect.locator(`option[value="${c3.id}"]`)).toHaveCount(0);
    await expect(page.getByTestId('parent-scholarships')).not.toContainText(c3.label);

    // API as G1: the routes those screens call.
    const g1Children = ids(await list(request, '/parent-portal/children', g1), 'studentId');
    expect(g1Children).toEqual([c1.id]);
    for (const view of CHILD_VIEWS) {
      expectDenied(
        `GET /parent-portal/children/<C3>/${view}`,
        await call(request, 'get', `/parent-portal/children/${c3.id}/${view}`, g1),
      );
    }
    const g1Invoices = await list(request, '/fees/invoices?scope=parent', g1);
    expect(ids(g1Invoices, 'studentId')).not.toContain(c3.id);
    expect(ids(g1Invoices, 'title')).toContain(own.invoice);
    expect(await list(request, `/fees/invoices?scope=parent&studentId=${c3.id}`, g1)).toEqual([]);
    expect(ids(await list(request, '/parent-portal/consents', g1), 'studentId')).toEqual([c1.id]);
    expect(ids(await list(request, '/parent-portal/messages/threads', g1), 'studentId')).toEqual([
      c1.id,
    ]);

    expectDenied(
      'POST /parent-portal/consents/<X>/decide',
      await call(request, 'post', `/parent-portal/consents/${x.consentId}/decide`, g1, {
        status: 'approved',
      }),
    );
    const consentAfter = only(
      (await list(request, '/parent-portal/consents', g2)).filter(
        (row) => row.consentChainId === x.consentId,
      ),
    );
    expect(consentAfter).toMatchObject({ id: x.consentId, status: 'pending', version: 1 });

    expectDenied(
      'GET /parent-portal/messages/threads/<X>/messages',
      await call(request, 'get', `/parent-portal/messages/threads/${x.threadId}/messages`, g1),
    );
    expectDenied(
      'POST /parent-portal/messages/threads/<X>/messages',
      await call(request, 'post', `/parent-portal/messages/threads/${x.threadId}/messages`, g1, {
        body: `PP intrusion ${tag}`,
      }),
    );
    expectDenied(
      'POST /parent-portal/messages/threads {studentId: C3}',
      await call(request, 'post', '/parent-portal/messages/threads', g1, {
        studentId: c3.id,
        subject: `PP intrusion ${tag}`,
        body: `PP intrusion ${tag}`,
      }),
    );
    const threadMessages = await list(
      request,
      `/parent-portal/messages/threads/${x.threadId}/messages`,
      g2,
    );
    expect(threadMessages.map((row) => row.body)).toEqual([hidden.secret]);
    expect(
      ids(await list(request, '/parent-portal/messages/threads', g2), 'subject'),
    ).not.toContain(`PP intrusion ${tag}`);

    expectDenied(
      'POST /parent-portal/fees/invoices/<X>/pay',
      await call(request, 'post', `/parent-portal/fees/invoices/${x.invoiceId}/pay`, g1, {
        method: 'sandbox',
      }),
    );
    const staffView = await list(request, `/fees/invoices?studentId=${c3.id}`, adminHeaders());
    expect(only(staffView.filter((row) => row.id === x.invoiceId))).toMatchObject({
      status: 'open',
    });

    // Students route: a portal caller reads only linked students and gets 404 otherwise
    // (PRC-C010); the positive control above shows the parent role itself is allowed.
    expectDenied('GET /students/<C3>', await call(request, 'get', `/students/${c3.id}`, g1));
  });

  test('another tenant’s child and data are hidden on screen and via API', async ({
    page,
    request,
  }) => {
    test.slow();
    const tag = newTag();
    // The other tenant for this test; the failing-first M2 mutation points it at tenant A.
    const otherTenant = TENANT_B;
    // The same guardian identity (JWT sub) exists in tenant A (child CA) and the other tenant (CB).
    const fA: Family = await createFamily(request, { childCount: 1, tag });
    const fB: Family = await createFamily(request, {
      tenantId: otherTenant,
      childCount: 1,
      guardianSub: fA.guardianSub,
      tag: newTag(),
    });
    const [ca] = fA.children as [Child];
    const [cb] = fB.children as [Child];
    const gA = guardianHeaders(fA.guardianSub, TENANT_A);
    const gB = guardianHeaders(fA.guardianSub, otherTenant);

    const hidden = {
      invoice: `PP fee B ${tag}`,
      consent: `PP consent B ${tag}`,
      thread: `PP thread B ${tag}`,
    };
    const b = await seedChildRows(request, {
      tenantId: otherTenant,
      guardianSub: fA.guardianSub,
      child: cb,
      invoiceTitle: hidden.invoice,
      consentTitle: hidden.consent,
      threadSubject: hidden.thread,
      threadBody: `PP secret B ${tag}`,
    });
    const own = {
      invoice: `PP fee A ${tag}`,
      consent: `PP consent A ${tag}`,
      thread: `PP thread A ${tag}`,
    };
    const a = await seedChildRows(request, {
      tenantId: TENANT_A,
      guardianSub: fA.guardianSub,
      child: ca,
      invoiceTitle: own.invoice,
      consentTitle: own.consent,
      threadSubject: own.thread,
      threadBody: `PP own body ${tag}`,
    });

    // Positive control: the same guardian with the other tenant's JWT sees CB and its rows.
    expect(ids(await list(request, '/parent-portal/children', gB), 'studentId')).toContain(cb.id);
    expect(ids(await list(request, '/fees/invoices?scope=parent', gB), 'id')).toContain(
      b.invoiceId,
    );
    expect(ids(await list(request, '/parent-portal/consents', gB), 'id')).toContain(b.consentId);
    expect(ids(await list(request, '/parent-portal/messages/threads', gB), 'id')).toContain(
      b.threadId,
    );

    // Screens with the tenant-A session.
    await openAsGuardian(page, fA);
    await expectHomeShowsOnly(page, ca, cb);
    await expectListsShowOnly(page, own, { ...hidden, childLabel: cb.label });
    await page.goto(`/parent/grades?studentId=${cb.id}`, { waitUntil: 'domcontentloaded' });
    await expectForbiddenFrame(page, 'parent-grades', [cb.label]);

    // API with the tenant-A JWT, then with a forged X-Tenant-ID for the other tenant: the
    // gateway takes the tenant from the verified JWT, so both return tenant-A rows only.
    const forged = parentPortalJwtHeaders(fA.guardianSub, {
      tenantId: TENANT_A,
      forgedActorHeaders: { 'X-Tenant-ID': otherTenant },
    });
    for (const [label, headers] of [
      ['tenant-A JWT', gA],
      ['tenant-A JWT + forged X-Tenant-ID', forged],
    ] as const) {
      await test.step(label, async () => {
        expect(ids(await list(request, '/parent-portal/children', headers), 'studentId')).toEqual([
          ca.id,
        ]);
        expect(ids(await list(request, '/fees/invoices?scope=parent', headers), 'id')).toEqual([
          a.invoiceId,
        ]);
        expect(ids(await list(request, '/parent-portal/consents', headers), 'id')).toEqual([
          a.consentId,
        ]);
        expect(ids(await list(request, '/parent-portal/messages/threads', headers), 'id')).toEqual([
          a.threadId,
        ]);
        expectDenied(
          `GET /parent-portal/children/<CB>/grades (${label})`,
          await call(request, 'get', `/parent-portal/children/${cb.id}/grades`, headers),
        );
      });
    }
  });
});
