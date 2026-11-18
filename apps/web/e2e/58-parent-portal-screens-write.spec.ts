/**
 * Parent portal screens — write path, screen → API → database.
 *
 * Every parent screen that writes is opened as a seeded guardian, first shows
 * a row this test wrote through the API (read path), then saves through its
 * own form (messages, thread reply, consent approve/deny, sandbox fee pay,
 * offer accept, scholarship apply with a document upload). The result is
 * confirmed on screen after a reload and through the gateway route the screen
 * uses, with the guardian JWT.
 *
 * Each test builds its own family (fixtures/parent-portal-family.ts): new
 * children via `POST /students` with unique names, then the guardian identity
 * rows (household, member, custody, link) by psql, because no HTTP route
 * writes households or custody. Per-run guardians and children make every
 * per-guardian list start empty, and assertions use per-run unique strings,
 * so re-runs against the same database are deterministic.
 *
 * The fees test needs FEES_STAFF_SANDBOX_PAYMENTS on the web server, which
 * tools/scripts/run-e2e-backend-ready.sh exports (PRC-M484).
 */
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';

import {
  GATEWAY_URL,
  INSTITUTION_A,
  adminHeaders,
  createFamily,
  enrolInSharedYear,
  guardianHeaders,
  newTag,
  openAsGuardian,
  pdfBuffer,
  type Family,
} from './fixtures/parent-portal-family';
import { uniqueFarFutureYearWindow, uniqueGradeOrder } from './fixtures/test-data';

const BACKEND_READY = !!process.env.E2E_BACKEND_READY;

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

type Json = Record<string, unknown>;

async function send(
  request: APIRequestContext,
  method: 'post' | 'put' | 'patch',
  path: string,
  data: unknown,
  expected: number,
  headers: Record<string, string> = adminHeaders(),
): Promise<Json> {
  const res = await request[method](`${GATEWAY_URL}/api/v1${path}`, { headers, data });
  expect(res.status(), `${method.toUpperCase()} ${path}: ${await res.text()}`).toBe(expected);
  return (await res.json()) as Json;
}

// Form errors render as role=alert inside <main>; Next's route announcer is
// also role=alert, outside <main>, so error checks are scoped to main.

async function guardianGet(request: APIRequestContext, family: Family, path: string) {
  const res = await request.get(`${GATEWAY_URL}/api/v1${path}`, {
    headers: guardianHeaders(family.guardianSub, family.tenantId),
  });
  const text = await res.text();
  expect(res.status(), `GET ${path}: ${text}`).toBe(200);
  return JSON.parse(text) as Json & { data: Json[] };
}

/** Waits for one `[data-testid]` node with `data-hydrated="true"` (pattern from 42/51). */
async function hydrated(page: Page, testId: string): Promise<Locator> {
  const el = page.getByTestId(testId);
  await expect(async () => {
    await expect(el).toHaveCount(1, { timeout: 2_000 });
    await expect(el).toHaveAttribute('data-hydrated', 'true', { timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  return el;
}

/**
 * For controls without a `data-hydrated` marker: waits until React has
 * attached its props to the element, so a click runs the client handler
 * instead of a native form submit on the server-rendered HTML.
 */
async function reactReady(control: Locator): Promise<void> {
  await expect(async () => {
    await expect(control).toHaveCount(1, { timeout: 2_000 });
    await expect(control).toBeEnabled({ timeout: 2_000 });
    const attached = await control.evaluate((el) =>
      Object.keys(el).some((key) => key.startsWith('__reactProps$')),
    );
    expect(attached, 'React props attached').toBe(true);
  }).toPass({ timeout: 20_000 });
}

test.describe('Parent portal screens — write path (E2E_BACKEND_READY)', () => {
  test.skip(!BACKEND_READY, 'Requires E2E_BACKEND_READY=1 and a live gateway + Postgres');

  test('/parent/messages lists a seeded thread and starts a new one through the form', async ({
    page,
    request,
  }) => {
    const tag = newTag();
    const family = await createFamily(request, { childCount: 1, tag });
    const [c1] = family.children as [Family['children'][0]];
    const seededSubject = `PP seeded ${tag}`;
    await send(
      request,
      'post',
      '/parent-portal/messages/threads',
      { studentId: c1.id, subject: seededSubject, body: `PP seeded body ${tag}` },
      201,
      guardianHeaders(family.guardianSub),
    );

    await openAsGuardian(page, family);
    await page.goto('/parent/messages', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1, name: 'Messages' })).toBeVisible();
    const seededRow = page.getByTestId('parent-thread-row').filter({ hasText: seededSubject });
    await expect(seededRow).toHaveCount(1);
    await expect(seededRow).toContainText(c1.label);

    const subject = `PP new ${tag}`;
    const body = `PP body ${tag}`;
    const sendButton = page.getByRole('button', { name: 'Send message' });
    await reactReady(sendButton);
    await page.locator('#thread-student').selectOption(c1.id);
    await page.locator('#thread-subject').fill(subject);
    await page.locator('#thread-body').fill(body);
    await page.getByRole('button', { name: 'Send message' }).click();

    await expect(page).toHaveURL(new RegExp(`/parent/messages/${UUID}$`), { timeout: 30_000 });
    const threadId = new URL(page.url()).pathname.split('/').pop() as string;
    await expect(page.getByRole('heading', { level: 1, name: subject })).toBeVisible();
    await expect(page.getByRole('listitem').filter({ hasText: body })).toContainText('parent · ');
    await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);

    const threads = await guardianGet(request, family, '/parent-portal/messages/threads');
    expect(threads.data.find((row) => row.id === threadId)).toMatchObject({
      subject,
      studentId: c1.id,
    });
    const messages = await guardianGet(
      request,
      family,
      `/parent-portal/messages/threads/${threadId}/messages`,
    );
    expect(messages.data).toEqual([expect.objectContaining({ body, senderRole: 'parent' })]);

    await page.goto('/parent/messages', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('parent-thread-row')).toHaveCount(2);
    await expect(page.getByTestId('parent-thread-row').filter({ hasText: subject })).toHaveCount(1);
  });

  test('/parent/messages/[threadId] shows the staff reply and sends a reply through the form', async ({
    page,
    request,
  }) => {
    const tag = newTag();
    const family = await createFamily(request, { childCount: 1, tag });
    const [c1] = family.children as [Family['children'][0]];
    const subject = `PP thread ${tag}`;
    const created = await send(
      request,
      'post',
      '/parent-portal/messages/threads',
      { studentId: c1.id, subject, body: `PP first ${tag}` },
      201,
      guardianHeaders(family.guardianSub),
    );
    const threadId = (created.thread as Json).id as string;
    const staffBody = `PP staff ${tag}`;
    const staffMessage = await send(
      request,
      'post',
      `/parent-portal/messages/threads/${threadId}/messages`,
      { body: staffBody },
      201,
    );
    expect(staffMessage.senderRole).toBe('staff');

    await openAsGuardian(page, family);
    await page.goto(`/parent/messages/${threadId}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1, name: subject })).toBeVisible();
    await expect(page.getByRole('listitem').filter({ hasText: staffBody })).toContainText(
      'staff · ',
    );
    await expect(page.getByText('2 messages.')).toBeVisible();

    const replyBody = `PP reply ${tag}`;
    const replyButton = page.getByRole('button', { name: 'Send reply' });
    await reactReady(replyButton);
    await page.locator('#reply-body').fill(replyBody);
    await page.getByRole('button', { name: 'Send reply' }).click();
    await expect(page.getByRole('listitem').filter({ hasText: replyBody })).toContainText(
      'parent · ',
      { timeout: 30_000 },
    );
    await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByText('3 messages.')).toBeVisible();
    await expect(page.getByRole('listitem').filter({ hasText: replyBody })).toContainText(
      'parent · ',
    );

    const messages = await guardianGet(
      request,
      family,
      `/parent-portal/messages/threads/${threadId}/messages`,
    );
    expect(messages.data.map((row) => [row.body, row.senderRole])).toEqual([
      [`PP first ${tag}`, 'parent'],
      [staffBody, 'staff'],
      [replyBody, 'parent'],
    ]);
  });

  test('/parent/consents approves one request and denies another through the dialogs', async ({
    page,
    request,
  }) => {
    const tag = newTag();
    const family = await createFamily(request, { childCount: 1, tag });
    const [c1] = family.children as [Family['children'][0]];
    const titleA = `PP consent A ${tag}`;
    const titleB = `PP consent B ${tag}`;
    const created: Record<string, Json> = {};
    for (const title of [titleA, titleB]) {
      const consent = await send(
        request,
        'post',
        '/parent-portal/consents',
        {
          studentId: c1.id,
          parentUserId: family.guardianSub,
          consentType: 'photo_media',
          title,
          consentVersion: 'photo-media-v2026-01',
        },
        201,
      );
      expect(consent).toMatchObject({ status: 'pending', version: 1 });
      created[title] = consent;
    }

    await openAsGuardian(page, family);
    await page.goto('/parent/consents', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1, name: 'Consents' })).toBeVisible();
    const rowA = page.getByTestId('parent-consent-row').filter({ hasText: titleA });
    const rowB = page.getByTestId('parent-consent-row').filter({ hasText: titleB });
    for (const row of [rowA, rowB]) {
      await expect(row).toContainText('Pending');
      await expect(row).toContainText(c1.label);
    }

    const approve = rowA.getByRole('button', { name: 'Approve' });
    await reactReady(approve);
    await rowA.getByRole('button', { name: 'Approve' }).click();
    await page.getByTestId('consent-approve-confirm-confirm').click();
    await expect(rowA).toContainText('Approved', { timeout: 30_000 });
    await expect(rowA.getByRole('button')).toHaveCount(0);

    const deny = rowB.getByRole('button', { name: 'Deny' });
    await reactReady(deny);
    await rowB.getByRole('button', { name: 'Deny' }).click();
    await page.getByTestId('consent-deny-confirm-confirm').click();
    await expect(rowB).toContainText('Denied', { timeout: 30_000 });
    await expect(rowB.getByRole('button')).toHaveCount(0);
    await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(rowA).toContainText('Approved');
    await expect(rowB).toContainText('Denied');

    // A decision appends version 2 of the consent chain (bodies are immutable,
    // W1-PRIV-01); the parent list returns the current version only.
    const consents = await guardianGet(request, family, '/parent-portal/consents');
    for (const [title, status] of [
      [titleA, 'approved'],
      [titleB, 'denied'],
    ] as const) {
      const first = created[title] as Json;
      const chain = consents.data.filter((row) => row.consentChainId === first.consentChainId);
      expect(chain).toEqual([
        expect.objectContaining({ title, status, version: 2, supersedesId: first.id }),
      ]);
    }
  });

  test('/parent/fees pays an open invoice through the sandbox Pay form', async ({
    page,
    request,
  }) => {
    const tag = newTag();
    const family = await createFamily(request, { childCount: 1, tag });
    const [c1] = family.children as [Family['children'][0]];
    const title = `PP fee ${tag}`;
    const invoice = await send(
      request,
      'post',
      '/fees/invoices',
      { studentId: c1.id, title, amountCents: 10_000 },
      201,
    );
    expect(invoice.status).toBe('open');

    await openAsGuardian(page, family);
    await page.goto('/parent/fees', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1, name: 'Fees' })).toBeVisible();
    const row = page.getByTestId('parent-invoice-row').filter({ hasText: title });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(c1.label);
    await expect(row).toContainText('Open');
    const balance = page.getByTestId('parent-remaining-balance');
    await expect(balance).toHaveCount(1);
    await expect(balance).not.toHaveText('Nothing owed');
    await expect(page.getByTestId('parent-receipt-row')).toHaveCount(0);

    const payButton = row.getByTestId('parent-pay-button');
    await reactReady(payButton);
    await row.getByTestId('parent-pay-button').click();
    await page.getByTestId('parent-pay-confirm-confirm').click();
    await expect(row).toContainText('Paid', { timeout: 30_000 });
    await expect(row.getByTestId('parent-pay-button')).toHaveCount(0);
    await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
    await expect(page.getByTestId('parent-receipt-row')).toHaveCount(1);
    await expect(balance).toHaveText('Nothing owed');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(row).toContainText('Paid');
    await expect(page.getByTestId('parent-receipt-row')).toHaveCount(1);
    await expect(page.getByTestId('parent-remaining-balance')).toHaveText('Nothing owed');

    const invoices = await guardianGet(request, family, '/fees/invoices?scope=parent');
    expect(invoices.data.find((row) => row.id === invoice.id)).toMatchObject({
      title,
      status: 'paid',
    });
    const receipts = await guardianGet(request, family, '/fees/receipts?scope=parent');
    expect(receipts.data).toEqual([
      expect.objectContaining({ invoiceId: invoice.id, amountCents: 10_000 }),
    ]);
    await expect(page.getByTestId('parent-receipt-row')).toContainText(
      String(receipts.data[0]?.receiptNumber),
    );
  });

  test('/parent/offers accepts a sent offer through the form once the fee is paid', async ({
    page,
    request,
  }) => {
    test.slow();
    const tag = newTag();
    const family = await createFamily(request, { childCount: 1, tag });
    const window = uniqueFarFutureYearWindow();
    const period = await send(
      request,
      'post',
      '/academic-periods',
      {
        name: `PP Adm Year ${tag}`,
        code: `AY-PP-${tag}`,
        startDate: window.startDate,
        endDate: window.endDate,
        status: 'inactive',
      },
      201,
    );
    const grade = await send(
      request,
      'post',
      '/grades',
      { name: `PP Adm Grade ${tag}`, code: `PA${tag.slice(0, 6)}`, order: uniqueGradeOrder() },
      201,
    );
    const klass = await send(
      request,
      'post',
      '/classes',
      {
        institutionId: INSTITUTION_A,
        gradeId: grade.id,
        academicPeriodId: period.id,
        name: `PP Adm Class ${tag}`,
        capacity: 40,
      },
      201,
    );
    const firstName = `PPO${tag}`;
    const applicant = `${firstName} Offer`;
    const enquiry = await send(
      request,
      'post',
      '/admissions/enquiries',
      {
        institutionId: INSTITUTION_A,
        academicPeriodId: period.id,
        gradeId: grade.id,
        quota: 'general',
        source: 'website',
        firstName,
        lastName: 'Offer',
        dateOfBirth: '2012-09-01',
        gender: 'female',
        guardianName: `PP Guardian ${tag}`,
        guardianPhone: '+15550155',
        guardianEmail: family.guardianEmail,
        interviewScore: 91,
        testScore: 94,
      },
      201,
    );
    await send(
      request,
      'patch',
      `/admissions/enquiries/${enquiry.id}`,
      { stage: 'qualified' },
      200,
    );
    const converted = await send(
      request,
      'post',
      `/admissions/enquiries/${enquiry.id}/convert`,
      undefined,
      201,
    );
    const applicationId = (converted.application as Json).id as string;
    const merit = await send(
      request,
      'post',
      '/admissions/merit-lists',
      {
        institutionId: INSTITUTION_A,
        academicPeriodId: period.id,
        gradeId: grade.id,
        interviewWeight: 0.4,
        testWeight: 0.6,
      },
      201,
    );
    expect(
      (merit.entries as Array<{ applicationId: string }>).some(
        (row) => row.applicationId === applicationId,
      ),
    ).toBe(true);
    await send(
      request,
      'put',
      '/admissions/seat-matrix',
      {
        institutionId: INSTITUTION_A,
        academicPeriodId: period.id,
        gradeId: grade.id,
        quota: 'general',
        seats: 3,
      },
      200,
    );
    const offer = await send(
      request,
      'post',
      '/admissions/offers',
      { applicationId, classId: klass.id, feeAmount: 15_000 },
      201,
    );
    const sent = await send(request, 'post', `/admissions/offers/${offer.id}/send`, undefined, 200);
    expect(sent.status).toBe('sent');
    const offerFeeInvoiceId = (sent.offerFeeInvoiceId ?? offer.offerFeeInvoiceId) as string;
    expect(offerFeeInvoiceId, 'offer send raises an offer-fee invoice').toBeTruthy();
    // PRC-H079: accept is gated on a paid offer-fee invoice (staff sandbox cashier path).
    await send(
      request,
      'post',
      `/fees/invoices/${offerFeeInvoiceId}/pay`,
      { method: 'sandbox' },
      201,
    );

    await openAsGuardian(page, family);
    await page.goto('/parent/offers', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('parent-offers')).toBeVisible();
    const openRow = page.getByTestId('parent-offer-row').filter({ hasText: applicant });
    await expect(openRow).toHaveCount(1);
    await expect(openRow).toHaveAttribute('data-status', 'sent');

    const paymentRef = `PP-REF-${tag}`;
    await hydrated(page, 'parent-accept-offer-form');
    await openRow.getByTestId('parent-payment-ref').fill(paymentRef);
    await openRow.getByTestId('parent-accept-offer').click();
    await page.getByTestId('parent-accept-offer-confirm-confirm').click();
    const acceptedRow = page
      .getByTestId('parent-offer-accepted-row')
      .filter({ hasText: applicant });
    await expect(acceptedRow).toContainText(`${applicant} · enrolled`, { timeout: 30_000 });
    await expect(acceptedRow).toContainText(`Ref ${paymentRef}`);
    await expect(page.getByTestId('parent-offer-error')).toHaveCount(0);
    await expect(page.getByTestId('parent-offer-row')).toHaveCount(0);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(acceptedRow).toContainText(`Ref ${paymentRef}`);
    await expect(page.getByTestId('parent-offer-row')).toHaveCount(0);

    const offers = await guardianGet(request, family, '/parent-portal/offers');
    const accepted = offers.data.find((row) => row.id === offer.id);
    expect(accepted).toMatchObject({ status: 'accepted', paymentRef });
    expect(accepted?.enrolledStudentId).toEqual(expect.stringMatching(new RegExp(`^${UUID}$`)));
  });

  test('/parent/scholarships starts, uploads a document for and submits an application', async ({
    page,
    request,
  }) => {
    test.slow();
    const tag = newTag();
    const family = await createFamily(request, { childCount: 1, tag });
    const [c1] = family.children as [Family['children'][0]];
    // The application's institution comes from the child's current enrolment (PRC-L345).
    await enrolInSharedYear(request, tag, [c1.id]);
    const programName = `PP Sch ${tag}`;
    const program = await send(
      request,
      'post',
      '/scholarships/programs',
      {
        name: programName,
        applicationStartDate: '2020-01-01',
        applicationEndDate: '2099-12-31',
        totalSlots: 5,
        amountPerRecipient: 10000,
        currency: 'INR',
        eligibility: { requiredDocuments: ['income_certificate'] },
      },
      201,
    );
    await send(request, 'put', `/scholarships/programs/${program.id}`, { status: 'open' }, 200);

    await openAsGuardian(page, family);
    await page.goto('/parent/scholarships', { waitUntil: 'domcontentloaded' });
    const screen = page.getByTestId('parent-scholarships');
    await expect(screen).toBeVisible();
    // The program list is fetched by the client component, so the option also proves hydration.
    const programSelect = page.getByLabel('Scholarship program', { exact: true });
    await expect(programSelect.locator(`option[value="${program.id}"]`)).toHaveText(programName, {
      timeout: 30_000,
    });
    await expect(screen.getByText('No applications for this child yet.')).toBeVisible();

    await page.getByLabel('Child', { exact: true }).selectOption(c1.id);
    await programSelect.selectOption(String(program.id));
    await page.getByLabel('Current school or institution').fill(`PP School ${tag}`);
    await page.getByLabel('GPA', { exact: true }).fill('3.5');
    await page.getByLabel('Declared annual family income').fill('150000');
    await page.getByRole('button', { name: 'Start application' }).click();

    const fileName = `pp-income-${tag.toLowerCase()}.pdf`;
    const slot = page.getByLabel('Income certificate (required)');
    await expect(slot).toHaveCount(1, { timeout: 30_000 });
    await slot.setInputFiles({ name: fileName, mimeType: 'application/pdf', buffer: pdfBuffer() });
    await expect(screen.getByText(fileName, { exact: true })).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Submit application' }).click();
    await expect(screen.getByRole('status')).toHaveText('Application submitted.', {
      timeout: 30_000,
    });
    await expect(screen.getByRole('alert')).toHaveCount(0);

    const applications = await guardianGet(
      request,
      family,
      '/parent-portal/scholarships/applications',
    );
    const own = applications.data.filter((row) => row.applicantId === c1.id);
    expect(own).toEqual([expect.objectContaining({ programId: program.id, status: 'submitted' })]);
    const applicationId = own[0]?.id as string;

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId(`parent-application-${applicationId}`)).toContainText(
      'submitted',
      { timeout: 30_000 },
    );
  });
});
