/**
 * PRC-M489: dedicated mocked-gateway suite for the examinations client.
 *
 * The results read model (`getExaminationResultsView`) is covered in
 * `domain-clients-2.test.ts`; this file pins the remaining calls' paths,
 * methods, bodies and failure handling.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const gatewayFetch = vi.fn();
vi.mock('./gateway', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('./gateway');
  return { ...actual, gatewayFetch: (...args: unknown[]) => gatewayFetch(...args) };
});

import {
  createExamination,
  createExamReevaluation,
  createExamSession,
  generateExamSeating,
  getExamination,
  listExaminations,
  listExamSeating,
  publishExaminationResults,
  recordExaminationMarks,
  registerExaminationCandidate,
  toCreateExaminationInput,
  type CreateExaminationInput,
} from './examinations';
import type { CreateExaminationFormValues } from '@/lib/validation/examination-schema';

function ok<T>(data: T) {
  return { ok: true, status: 200, data };
}
function fail(status: number) {
  return { ok: false, status, data: null, error: { code: 'E', message: 'e' } };
}

beforeEach(() => {
  gatewayFetch.mockReset();
});

const apiExam = {
  id: 'ex-1',
  name: 'Term 1',
  code: 'T1',
  startDate: '2025-03-01',
  endDate: '2025-03-10',
  status: 'SCHEDULED',
};

describe('examinations client — reads (PRC-M489)', () => {
  it('lists examinations without throwing and normalises startDate', async () => {
    gatewayFetch.mockResolvedValueOnce(ok({ data: [apiExam] }));
    const rows = await listExaminations();
    expect(gatewayFetch.mock.calls[0]![0]).toBe('/examinations');
    expect(gatewayFetch.mock.calls[0]![1]).toMatchObject({ throwOnError: false });
    expect(rows).toEqual([
      expect.objectContaining({
        id: 'ex-1',
        examinationDate: '2025-03-01',
        subjects: [],
        centers: [],
      }),
    ]);
  });

  it('falls back to examinationDate when startDate is absent', async () => {
    gatewayFetch.mockResolvedValueOnce(
      ok({ data: [{ ...apiExam, startDate: undefined, examinationDate: '2025-04-01' }] }),
    );
    const [row] = await listExaminations();
    expect(row!.examinationDate).toBe('2025-04-01');
  });

  it('returns [] when the list read fails', async () => {
    gatewayFetch.mockResolvedValueOnce(fail(500));
    await expect(listExaminations()).resolves.toEqual([]);
  });

  it('encodes the id on a detail read and returns null on a miss', async () => {
    gatewayFetch.mockResolvedValueOnce(ok(apiExam));
    await expect(getExamination('a/b')).resolves.toMatchObject({ id: 'ex-1' });
    expect(gatewayFetch.mock.calls[0]![0]).toBe('/examinations/a%2Fb');

    gatewayFetch.mockResolvedValueOnce(fail(404));
    await expect(getExamination('missing')).resolves.toBeNull();
  });
});

describe('examinations client — writes (PRC-M489)', () => {
  const input: CreateExaminationInput = {
    name: 'Term 1',
    code: 'T1',
    academicPeriodId: 'ap-1',
    startDate: '2025-03-01',
    endDate: '2025-03-10',
    subjects: [{ name: 'Maths', code: 'MA', maxScore: 100 }],
    centers: [],
    gradingSchemes: [],
  };

  it('creates via POST with a json body and normalises the response', async () => {
    gatewayFetch.mockResolvedValueOnce(ok(apiExam));
    await expect(createExamination(input)).resolves.toMatchObject({
      id: 'ex-1',
      examinationDate: '2025-03-01',
    });
    expect(gatewayFetch).toHaveBeenCalledWith('/examinations', { method: 'POST', json: input });
  });

  it('throws on an empty create response', async () => {
    gatewayFetch.mockResolvedValueOnce(ok(null));
    await expect(createExamination(input)).rejects.toThrow(
      'Empty response from examination-service',
    );
  });

  it('registers a candidate on the encoded candidates path', async () => {
    const body = { studentId: 's-1', centerId: 'c-1', subjectIds: ['m'] };
    gatewayFetch.mockResolvedValueOnce(ok({ id: 'reg-1' }));
    await registerExaminationCandidate('ex 1', body);
    expect(gatewayFetch).toHaveBeenCalledWith('/examinations/ex%201/candidates', {
      method: 'POST',
      json: body,
    });
  });

  it('records marks and publishes results with POST', async () => {
    const marks = { entries: [{ studentId: 's-1', marks: [{ subjectId: 'm', score: 80 }] }] };
    gatewayFetch.mockResolvedValueOnce(ok({ candidateCount: 1, subjectResultCount: 1 }));
    await recordExaminationMarks('ex-1', marks);
    expect(gatewayFetch).toHaveBeenLastCalledWith('/examinations/ex-1/results/marks', {
      method: 'POST',
      json: marks,
    });

    gatewayFetch.mockResolvedValueOnce(ok({ processedCount: 1, incompleteCount: 0 }));
    await expect(publishExaminationResults('ex-1')).resolves.toEqual({
      processedCount: 1,
      incompleteCount: 0,
    });
    expect(gatewayFetch).toHaveBeenLastCalledWith('/examinations/ex-1/results/publish', {
      method: 'POST',
    });
  });

  it('throws on an empty publish response', async () => {
    gatewayFetch.mockResolvedValueOnce(ok(null));
    await expect(publishExaminationResults('ex-1')).rejects.toThrow(
      'Empty response from examination-service',
    );
  });
});

describe('examinations client — exam ops (PRC-M489)', () => {
  it('creates a session with POST on the sessions path', async () => {
    const session = {
      subjectId: 'm',
      date: '2025-03-01',
      startTime: '09:00',
      endTime: '12:00',
      roomId: 'r-1',
    };
    gatewayFetch.mockResolvedValueOnce(ok({ id: 'ses-1' }));
    await createExamSession('ex-1', session);
    expect(gatewayFetch).toHaveBeenCalledWith('/examinations/ex-1/sessions', {
      method: 'POST',
      json: session,
    });
  });

  it('reads and generates seating', async () => {
    gatewayFetch.mockResolvedValueOnce(ok({ data: [{ id: 'seat-1' }] }));
    await expect(listExamSeating('ex-1')).resolves.toEqual([{ id: 'seat-1' }]);
    expect(gatewayFetch.mock.calls[0]![0]).toBe('/examinations/ex-1/seating');
    expect(gatewayFetch.mock.calls[0]![1]).toMatchObject({ throwOnError: false });

    gatewayFetch.mockResolvedValueOnce(ok({ data: [] }));
    await generateExamSeating('ex-1');
    expect(gatewayFetch).toHaveBeenLastCalledWith('/examinations/ex-1/seating/generate', {
      method: 'POST',
      json: {},
    });
  });

  it('creates a re-evaluation request with POST', async () => {
    const body = { candidateId: 'cand-1', subjectId: 'm', notes: 'recheck' };
    gatewayFetch.mockResolvedValueOnce(ok({ id: 'rv-1' }));
    await createExamReevaluation('ex-1', body);
    expect(gatewayFetch).toHaveBeenCalledWith('/examinations/ex-1/reevaluations', {
      method: 'POST',
      json: body,
    });
  });
});

describe('toCreateExaminationInput (PRC-M489)', () => {
  it('trims text, keeps numbers, and drops empty descriptors and descriptions', () => {
    const values = {
      name: '  Term 1 ',
      code: ' T1 ',
      description: '   ',
      academicPeriodId: 'ap-1',
      startDate: '2025-03-01',
      endDate: '2025-03-10',
      subjects: [{ name: ' Maths ', code: ' MA ', maxScore: 100 }],
      centers: [{ name: ' Hall ', code: ' H1 ', institutionId: 'inst-1', capacity: 40 }],
      gradingSchemes: [
        {
          name: ' Default ',
          minScore: 0,
          maxScore: 100,
          passThreshold: 35,
          thresholds: [
            { grade: ' A ', minScore: 90, maxScore: 100, descriptor: ' Excellent ' },
            { grade: 'F', minScore: 0, maxScore: 34, descriptor: '  ' },
          ],
        },
      ],
    } as unknown as CreateExaminationFormValues;
    const input = toCreateExaminationInput(values);
    expect(input).toEqual({
      name: 'Term 1',
      code: 'T1',
      academicPeriodId: 'ap-1',
      startDate: '2025-03-01',
      endDate: '2025-03-10',
      subjects: [{ name: 'Maths', code: 'MA', maxScore: 100 }],
      centers: [{ name: 'Hall', code: 'H1', institutionId: 'inst-1', capacity: 40 }],
      gradingSchemes: [
        {
          name: 'Default',
          minScore: 0,
          maxScore: 100,
          passThreshold: 35,
          thresholds: [
            { grade: 'A', minScore: 90, maxScore: 100, descriptor: 'Excellent' },
            { grade: 'F', minScore: 0, maxScore: 34 },
          ],
        },
      ],
    });
    expect('description' in input).toBe(false);
  });
});
