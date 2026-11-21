/**
 * Admissions defect fixes — live (spec 107).
 *
 * AD-T1: tenant A's administrator could name tenant B's academic period on
 * `PUT /admissions/seat-matrix`, `POST /admissions/enquiries` and
 * `PATCH /admissions/applications/:id/placement` (200/201; a foreign grade was refused only
 * by the grade FK). Review M2-TR-4 adds a foreign period with tenant A's own grade on
 * `POST /admissions/merit-lists`, and an interview slot naming a tenant-B institution.
 *
 * Every such write must be refused with the #739 safe form (422 `REFERENCE_NOT_FOUND`, fixed
 * copy, correlation id, no database text) and must store nothing. The positive control shows
 * the same writes with tenant A's own ids still succeed.
 */
import { randomUUID } from 'node:crypto';

import { expect, test, type APIRequestContext } from '@playwright/test';

import {
  BACKEND_READY,
  INSTITUTION_A,
  INSTITUTION_B_CODE,
  TENANT_B,
  admissionsAdmin,
  enquiryBody,
  ensureInstitutionB,
  expectSafeReferenceError,
  getAllOffsetPages,
  getJson,
  newTag,
  probe,
  seedApplication,
  seedScope,
  sendJson,
  type Persona,
  type Row,
} from './fixtures/admissions-defect-fixes';

type Write = [label: string, method: 'POST' | 'PUT' | 'PATCH', path: string, data: Row];

function slotBody(institutionId: string, location: string): Row {
  const startsAt = new Date(Date.now() + 3 * 86_400_000);
  return {
    institutionId,
    startsAt: startsAt.toISOString(),
    endsAt: new Date(startsAt.getTime() + 1_800_000).toISOString(),
    capacity: 1,
    location,
  };
}

function meritBody(institutionId: string, periodId: string, gradeId: string): Row {
  return {
    institutionId,
    academicPeriodId: periodId,
    gradeId,
    interviewWeight: 0.5,
    testWeight: 0.5,
  };
}

async function refuseAll(
  request: APIRequestContext,
  admin: Persona,
  writes: Write[],
): Promise<void> {
  for (const [label, method, path, data] of writes) {
    expectSafeReferenceError(await probe(request, admin, method, path, data), label);
  }
}

async function seatRows(
  request: APIRequestContext,
  admin: Persona,
  institutionId: string,
  periodId: string,
): Promise<Row[]> {
  const body = await getJson<{ data: Row[] }>(
    request,
    admin,
    `/admissions/seat-matrix?institutionId=${institutionId}&academicPeriodId=${periodId}`,
  );
  return body.data;
}

async function taggedEnquiries(
  request: APIRequestContext,
  admin: Persona,
  firstName: string,
): Promise<Row[]> {
  return (await getAllOffsetPages(request, admin, '/admissions/enquiries')).filter(
    (row) => row.firstName === firstName,
  );
}

test.describe('Admissions defect fixes — live (E2E_BACKEND_READY)', () => {
  test.skip(!BACKEND_READY, 'Requires E2E_BACKEND_READY=1 and a live gateway + Postgres');

  test('AD-T1 writes naming another tenant period or grade are refused and store nothing', async ({
    request,
  }) => {
    const tag = newTag();
    const adminA = admissionsAdmin(tag);
    const adminB = admissionsAdmin(tag, TENANT_B);
    const scopeA = await seedScope(request, adminA, tag);
    const scopeB = await seedScope(request, adminB, newTag());
    const applicant = await seedApplication(request, adminA, scopeA, tag);
    const randomPeriod = randomUUID();
    const leadName = `AD${tag}T`;
    await refuseAll(request, adminA, [
      [
        'seat matrix, B period + B grade',
        'PUT',
        '/admissions/seat-matrix',
        { institutionId: INSTITUTION_A, ...pick(scopeB), seats: 3 },
      ],
      [
        'seat matrix, B period',
        'PUT',
        '/admissions/seat-matrix',
        {
          institutionId: INSTITUTION_A,
          academicPeriodId: scopeB.periodId,
          gradeId: scopeA.gradeId,
          seats: 3,
        },
      ],
      [
        'seat matrix, B grade',
        'PUT',
        '/admissions/seat-matrix',
        {
          institutionId: INSTITUTION_A,
          academicPeriodId: scopeA.periodId,
          gradeId: scopeB.gradeId,
          seats: 3,
        },
      ],
      [
        'merit list, B period + B grade',
        'POST',
        '/admissions/merit-lists',
        meritBody(INSTITUTION_A, scopeB.periodId, scopeB.gradeId),
      ],
      [
        'enquiry, B period',
        'POST',
        '/admissions/enquiries',
        enquiryBody(INSTITUTION_A, { ...scopeA, periodId: scopeB.periodId }, leadName, tag),
      ],
      [
        'enquiry, B grade',
        'POST',
        '/admissions/enquiries',
        enquiryBody(INSTITUTION_A, { ...scopeA, gradeId: scopeB.gradeId }, leadName, tag),
      ],
      [
        'enquiry, unknown period',
        'POST',
        '/admissions/enquiries',
        enquiryBody(INSTITUTION_A, { ...scopeA, periodId: randomPeriod }, leadName, tag),
      ],
      [
        'placement, B period',
        'PATCH',
        `/admissions/applications/${applicant.applicationId}/placement`,
        { academicPeriodId: scopeB.periodId, gradeId: scopeA.gradeId, interviewScore: 50 },
      ],
      [
        'placement, B grade',
        'PATCH',
        `/admissions/applications/${applicant.applicationId}/placement`,
        { academicPeriodId: scopeA.periodId, gradeId: scopeB.gradeId, interviewScore: 50 },
      ],
    ]);

    // Nothing was stored: no seat row in B's period, no tagged lead, placement unchanged.
    expect.soft(await seatRows(request, adminA, INSTITUTION_A, scopeB.periodId)).toEqual([]);
    expect
      .soft(
        (await seatRows(request, adminA, INSTITUTION_A, scopeA.periodId)).filter(
          (row) => row.gradeId === scopeB.gradeId,
        ),
      )
      .toEqual([]);
    expect.soft(await taggedEnquiries(request, adminA, leadName)).toEqual([]);
    const bundle = await getJson<{ placement: Row | null }>(
      request,
      adminA,
      `/admissions/applications/${applicant.applicationId}`,
    );
    expect(bundle.placement?.academicPeriodId).toBe(scopeA.periodId);
    expect(bundle.placement?.gradeId).toBe(scopeA.gradeId);
    expect(bundle.placement?.interviewScore).toBe(0);
  });

  test('M2-TR-4 a merit list for another tenant period with tenant A own grade is refused', async ({
    request,
  }) => {
    const tag = newTag();
    const adminA = admissionsAdmin(tag);
    const adminB = admissionsAdmin(tag, TENANT_B);
    const scopeA = await seedScope(request, adminA, tag);
    const scopeB = await seedScope(request, adminB, newTag());
    await seedApplication(request, adminA, scopeA, tag);
    await refuseAll(request, adminA, [
      [
        'merit list, B period + A grade',
        'POST',
        '/admissions/merit-lists',
        meritBody(INSTITUTION_A, scopeB.periodId, scopeA.gradeId),
      ],
    ]);
    const list = await probe(
      request,
      adminA,
      'GET',
      `/admissions/merit-lists?institutionId=${INSTITUTION_A}&academicPeriodId=${scopeB.periodId}&gradeId=${scopeA.gradeId}`,
    );
    expect(list.status, `no merit list stored: ${list.body.slice(0, 200)}`).toBe(404);
  });

  test('M2-TR-4 an interview slot and other writes naming a tenant B institution are refused', async ({
    request,
  }) => {
    const tag = newTag();
    const adminA = admissionsAdmin(tag);
    const adminB = admissionsAdmin(tag, TENANT_B);
    const institutionB = await ensureInstitutionB(request, adminB);
    // The id is tenant B's own institution, and tenant A cannot read it.
    const ownB = await getJson<{ code: string }>(request, adminB, `/institutions/${institutionB}`);
    expect(ownB.code).toBe(INSTITUTION_B_CODE);
    expect((await probe(request, adminA, 'GET', `/institutions/${institutionB}`)).status).toBe(404);

    const scopeA = await seedScope(request, adminA, tag);
    const location = `AD ${tag} Room`;
    const leadName = `AD${tag}I`;
    await refuseAll(request, adminA, [
      [
        'interview slot, B institution',
        'POST',
        '/registrations/interview-slots',
        slotBody(institutionB, location),
      ],
      [
        'seat matrix, B institution',
        'PUT',
        '/admissions/seat-matrix',
        { institutionId: institutionB, ...pick(scopeA), seats: 3 },
      ],
      [
        'enquiry, B institution',
        'POST',
        '/admissions/enquiries',
        enquiryBody(institutionB, scopeA, leadName, tag),
      ],
      [
        'merit list, B institution',
        'POST',
        '/admissions/merit-lists',
        meritBody(institutionB, scopeA.periodId, scopeA.gradeId),
      ],
    ]);

    const slots = await getJson<{ data: Row[] }>(
      request,
      adminA,
      `/registrations/interview-slots?institutionId=${institutionB}`,
    );
    expect.soft(slots.data.filter((row) => row.location === location)).toEqual([]);
    expect.soft(await seatRows(request, adminA, institutionB, scopeA.periodId)).toEqual([]);
    expect.soft(await taggedEnquiries(request, adminA, leadName)).toEqual([]);
    const list = await probe(
      request,
      adminA,
      'GET',
      `/admissions/merit-lists?institutionId=${institutionB}&academicPeriodId=${scopeA.periodId}&gradeId=${scopeA.gradeId}`,
    );
    expect(list.status, `no merit list stored: ${list.body.slice(0, 200)}`).toBe(404);
  });

  test('positive control: the same writes with tenant A own ids succeed', async ({ request }) => {
    const tag = newTag();
    const adminA = admissionsAdmin(tag);
    const scopeA = await seedScope(request, adminA, tag);
    const applicant = await seedApplication(request, adminA, scopeA, tag);
    const seat = await sendJson<{ seats: number; gradeId: string }>(
      request,
      adminA,
      'PUT',
      '/admissions/seat-matrix',
      { institutionId: INSTITUTION_A, ...pick(scopeA), seats: 3 },
      200,
    );
    expect(seat.seats).toBe(3);
    const placement = await sendJson<{ academicPeriodId: string; interviewScore: number }>(
      request,
      adminA,
      'PATCH',
      `/admissions/applications/${applicant.applicationId}/placement`,
      { ...pick(scopeA), interviewScore: 61, testScore: 59 },
      200,
    );
    expect(placement.academicPeriodId).toBe(scopeA.periodId);
    expect(placement.interviewScore).toBe(61);
    const merit = await sendJson<{ entries: Array<{ applicationId: string; rank: number }> }>(
      request,
      adminA,
      'POST',
      '/admissions/merit-lists',
      meritBody(INSTITUTION_A, scopeA.periodId, scopeA.gradeId),
      201,
    );
    expect(merit.entries.map((e) => [e.applicationId, e.rank])).toEqual([
      [applicant.applicationId, 1],
    ]);
    const location = `AD ${tag} Room`;
    const slot = await sendJson<{ institutionId: string; location: string }>(
      request,
      adminA,
      'POST',
      '/registrations/interview-slots',
      slotBody(INSTITUTION_A, location),
      201,
    );
    expect(slot.institutionId).toBe(INSTITUTION_A);
    expect(slot.location).toBe(location);
    const leadName = `AD${tag}P`;
    await sendJson(
      request,
      adminA,
      'POST',
      '/admissions/enquiries',
      enquiryBody(INSTITUTION_A, scopeA, leadName, tag),
      201,
    );
    const leads = await taggedEnquiries(request, adminA, leadName);
    expect(leads.map((row) => [row.academicPeriodId, row.gradeId])).toEqual([
      [scopeA.periodId, scopeA.gradeId],
    ]);
  });
});

function pick(scope: { periodId: string; gradeId: string }): Row {
  return { academicPeriodId: scope.periodId, gradeId: scope.gradeId };
}
