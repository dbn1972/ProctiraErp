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
describe('getExaminationResultsView', () => {
  it('merges marks with published grades and computes totals/status', async () => {
    gatewayFetch.mockImplementation(async (path: string) =>
      path.endsWith('/results/marks')
        ? ok({
            data: [
              {
                id: 'c1',
                studentId: 's1',
                centerId: null,
                subjectResults: [
                  { subjectId: 'm', score: 80 },
                  { subjectId: 'e', score: 40 },
                ],
              },
              {
                id: 'c2',
                studentId: 's2',
                centerId: null,
                subjectResults: [{ subjectId: 'm', score: 50 }],
              },
            ],
          })
        : ok({
            publishedAt: '2025-02-01',
            gradeResults: [{ studentId: 's1', subjectId: 'm', score: 80, grade: 'A' }],
          }),
    );
    const view = await getExaminationResultsView(exam);
    expect(view.published).toBe(true);
    const [r1, r2] = view.rows;
    expect(r1).toMatchObject({ totalScore: 120, maxScore: 150, status: 'PUBLISHED' });
    expect(r2).toMatchObject({ totalScore: null, status: 'INCOMPLETE' });
  });
  it('treats a failed publication read as unpublished and marks complete rows PENDING', async () => {
    gatewayFetch.mockImplementation(async (path: string) =>
      path.endsWith('/results/marks')
        ? ok({
            data: [
              {
                id: 'c1',
                studentId: 's1',
                centerId: null,
                subjectResults: [
                  { subjectId: 'm', score: 1 },
                  { subjectId: 'e', score: 2 },
                ],
              },
            ],
          })
        : fail(404),
    );
    const view = await getExaminationResultsView(exam);
    expect(view.published).toBe(false);
    expect(view.rows[0]).toMatchObject({ totalScore: 3, status: 'PENDING' });
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
