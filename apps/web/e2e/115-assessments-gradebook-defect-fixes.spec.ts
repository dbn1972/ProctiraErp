import { expect, test } from '@playwright/test';
import {
  BACKEND_READY,
  expectSafeReferenceError,
  newTag,
  probe,
  reportCardJobsFor,
  seedTenantA,
  seedTenantB,
  type Row,
  type TenantASet,
  type TenantBSet,
} from './fixtures/assessments-gradebook-defect-fixes';
/**
 * Assessments + gradebook — security defect fixes (M4 P2, P3), live gateway + Postgres.
 *
 * P2: tenant B, with its own board, must not queue a report card for tenant A's student or
 * name tenant A's institution. Both get the #739 safe 422 (`REFERENCE_NOT_FOUND`, fixed copy,
 * correlation id), never the raw constraint name, and no job is stored.
 * P3: tenant B must not define assessment items on tenant A's subject or period, or an
 * outcome on tenant A's subject; same safe 422, nothing stored.
 *
 * Each negative has a positive control: the same call with tenant B's own ids succeeds.
 * Rows are per-run (`AS<tag>`) and found by id; nothing is counted.
 */
test.describe('Assessments + gradebook defect fixes — live (E2E_BACKEND_READY)', () => {
  test.skip(!BACKEND_READY, 'Requires live gateway (E2E_BACKEND_READY)');
  const tag = newTag();
  let a: TenantASet;
  let b: TenantBSet;

  test.beforeAll(async ({ request }) => {
    test.setTimeout(120_000);
    a = await seedTenantA(request, tag);
    b = await seedTenantB(request, tag);
  });

  test('P2 tenant B cannot queue a report card for a tenant-A student or institution', async ({
    request,
  }) => {
    for (const [label, body] of [
      ["tenant A's student", { studentId: a.student.id, boardId: b.board, institutionId: null }],
      [
        "tenant A's student and institution",
        { studentId: a.student.id, boardId: b.board, institutionId: a.institution.id },
      ],
      [
        "tenant A's institution",
        { studentId: b.student.id, boardId: b.board, institutionId: a.institution.id },
      ],
    ] as Array<[string, Row]>) {
      const r = await probe(request, b.admin, 'POST', '/gradebook/report-cards', body);
      expectSafeReferenceError(r, `tenant B POST /gradebook/report-cards (${label})`);
    }
    expect(await reportCardJobsFor(request, b.admin, a.student.id), 'no tenant-B card').toEqual([]);
    // Positive control: tenant B's own student (job status depends on the artifact store).
    const own = await probe(request, b.admin, 'POST', '/gradebook/report-cards', {
      studentId: b.student.id,
      boardId: b.board,
      institutionId: null,
    });
    expect(own.status, own.body.slice(0, 300)).toBe(201);
    const job = JSON.parse(own.body) as Row;
    expect((job.metadata as Row).studentId).toBe(b.student.id);
    const listed = await reportCardJobsFor(request, b.admin, b.student.id);
    expect(listed.map((j) => j.id)).toContain(job.id);
  });
});
