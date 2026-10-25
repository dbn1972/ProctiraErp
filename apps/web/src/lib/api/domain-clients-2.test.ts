/**
 * PRC-M489: mocked-gateway tests for exam results, admin.server source
 * classification, and health single-record reads.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
const gatewayFetch = vi.fn();
vi.mock('./gateway', async () => {
  const actual = await vi.importActual<typeof import('./gateway')>('./gateway');
  return { ...actual, gatewayFetch: (...args: unknown[]) => gatewayFetch(...args) };
});
import { listTenantRoles } from './admin.server';
import { getExaminationResultsView, type Examination } from './examinations';
import { getHealthRecordResult } from './health';
function ok<T>(data: T) {
  return { ok: true, status: 200, data };
}
function fail(status: number) {
  return { ok: false, status, data: null, error: { code: 'E', message: 'e' } };
}
beforeEach(() => {
  gatewayFetch.mockReset();
});
const exam: Examination = {
  id: 'ex-1',
  name: 'Term 1',
  code: 'T1',
  examinationDate: '2025-01-01',
  status: 'COMPLETED',
  subjects: [
    { id: 'm', name: 'Maths', code: 'MA', maxScore: 100 },
    { id: 'e', name: 'English', code: 'EN', maxScore: 50 },
  ],
  centers: [],
};
function registration(studentId: string, subjectIds: string[], status = 'REGISTERED') {
  return {
    id: `reg-${studentId}`,
    examinationId: 'ex-1',
    studentId,
    centerId: 'ctr-1',
    subjectIds,
    status,
    registeredAt: '2025-01-01T00:00:00.000Z',
  };
}
/** Route the three reads the results view makes: marks, publication, registrations. */
function mockExamReads(opts: {
  marks: unknown[];
  publication?: unknown;
  registrations?: unknown[] | null;
}) {
  gatewayFetch.mockImplementation(async (path: string) => {
    if (path.endsWith('/results/marks')) return ok({ data: opts.marks });
    if (path.endsWith('/candidates')) {
      return opts.registrations === null ? fail(500) : ok({ data: opts.registrations ?? [] });
    }
    return opts.publication ? ok(opts.publication) : fail(404);
  });
}
describe('getExaminationResultsView', () => {
  it('merges marks with published grades and computes totals/status', async () => {
    mockExamReads({
      marks: [
        {
          id: 'c1',
          studentId: 's1',
          centerId: null,
          subjectResults: [
            { subjectId: 'm', score: 80, isComplete: true },
            { subjectId: 'e', score: 40, isComplete: true },
          ],
        },
        {
          id: 'c2',
          studentId: 's2',
          centerId: null,
          subjectResults: [{ subjectId: 'm', score: 50, isComplete: true }],
        },
      ],
      registrations: [registration('s1', ['m', 'e']), registration('s2', ['m', 'e'])],
      publication: {
        publishedAt: '2025-02-01',
        // PRC-M243: the real route paginates this field (`{ data, meta }`),
        // not a bare array — match production shape so this mock can't drift
        // from it the way the production client code once did.
        gradeResults: {
          data: [{ studentId: 's1', subjectId: 'm', score: 80, grade: 'A' }],
          meta: { page: 1, pageSize: 100, totalItems: 1, totalPages: 1 },
        },
      },
    });
    const view = await getExaminationResultsView(exam);
    expect(view.published).toBe(true);
    const [r1, r2] = view.rows;
    expect(r1).toMatchObject({ totalScore: 120, maxScore: 150, status: 'PUBLISHED' });
    // s2 is registered for Maths and English but only Maths has a marks row.
    expect(r2).toMatchObject({ totalScore: null, maxScore: 150, status: 'INCOMPLETE' });
  });
  it('treats a failed publication read as unpublished and marks complete rows PENDING', async () => {
    mockExamReads({
      marks: [
        {
          id: 'c1',
          studentId: 's1',
          centerId: null,
          subjectResults: [
            { subjectId: 'm', score: 1, isComplete: true },
            { subjectId: 'e', score: 2, isComplete: true },
          ],
        },
      ],
      registrations: [registration('s1', ['m', 'e'])],
    });
    const view = await getExaminationResultsView(exam);
    expect(view.published).toBe(false);
    expect(view.rows[0]).toMatchObject({ totalScore: 3, status: 'PENDING' });
  });
  it('keeps a candidate INCOMPLETE when a registered subject has no marks row (PRC-M145)', async () => {
    // Backend contract: subjectResults only contains subjects with recorded marks.
    mockExamReads({
      marks: [
        {
          id: 'c1',
          studentId: 's1',
          centerId: null,
          subjectResults: [{ subjectId: 'm', score: 80, isComplete: true }],
        },
      ],
      registrations: [registration('s1', ['m', 'e'])],
    });
    const view = await getExaminationResultsView(exam);
    expect(view.rows[0]).toMatchObject({ status: 'INCOMPLETE', totalScore: null, maxScore: 150 });
    expect(view.rows[0]!.subjects.map((s) => [s.code, s.score])).toEqual([
      ['MA', 80],
      ['EN', null],
    ]);
  });
  it('assesses a partly-registered candidate only on registered subjects (PRC-M145)', async () => {
    mockExamReads({
      marks: [
        {
          id: 'c2',
          studentId: 's2',
          centerId: null,
          subjectResults: [{ subjectId: 'm', score: 50, isComplete: true }],
        },
      ],
      registrations: [registration('s2', ['m'])],
    });
    const view = await getExaminationResultsView(exam);
    expect(view.rows[0]).toMatchObject({ totalScore: 50, maxScore: 100, status: 'PENDING' });
    expect(view.rows[0]!.subjects.map((s) => s.code)).toEqual(['MA']);
  });
  it('lists registered candidates with no marks row as INCOMPLETE and skips cancelled ones', async () => {
    mockExamReads({
      marks: [
        {
          id: 'c3',
          studentId: 's3',
          centerId: null,
          subjectResults: [{ subjectId: 'm', score: 70, isComplete: true }],
        },
      ],
      registrations: [registration('s3', ['m'], 'CANCELLED'), registration('s4', ['m', 'e'])],
    });
    const view = await getExaminationResultsView(exam);
    expect(view.rows).toHaveLength(1);
    expect(view.rows[0]).toMatchObject({
      candidateId: 'reg-s4',
      studentId: 's4',
      status: 'INCOMPLETE',
      totalScore: null,
      maxScore: 150,
    });
  });
  it('falls back to every exam subject when no registration is readable', async () => {
    mockExamReads({
      marks: [
        {
          id: 'c1',
          studentId: 's1',
          centerId: null,
          subjectResults: [{ subjectId: 'm', score: 80, isComplete: true }],
        },
      ],
      registrations: null,
    });
    const view = await getExaminationResultsView(exam);
    expect(view.rows[0]).toMatchObject({ status: 'INCOMPLETE', maxScore: 150 });
  });
});
describe('admin.server sourceOf', () => {
  it.each([
    [ok({ data: [{ id: 'r' }] }), 'gateway', 1],
    [fail(403), 'forbidden', 0],
    [fail(500), 'scaffold', 0],
  ])('classifies %#', async (response, source, count) => {
    gatewayFetch.mockResolvedValueOnce(response);
    const result = await listTenantRoles();
    expect(result.source).toBe(source);
    expect(result.roles).toHaveLength(count);
  });
});
describe('health getHealthRecordResult', () => {
  it('distinguishes 404 (none on file) from 403', async () => {
    gatewayFetch.mockResolvedValueOnce(fail(404));
    await expect(getHealthRecordResult('s1')).resolves.toMatchObject({ ok: false, status: 404 });
    gatewayFetch.mockResolvedValueOnce(fail(403));
    await expect(getHealthRecordResult('s1')).resolves.toMatchObject({
      ok: false,
      status: 403,
      kind: 'denied',
    });
  });
  it('returns the record on success', async () => {
    gatewayFetch.mockResolvedValueOnce(ok({ studentId: 's1' }));
    await expect(getHealthRecordResult('s1')).resolves.toMatchObject({
      ok: true,
      record: { studentId: 's1' },
    });
  });
});
