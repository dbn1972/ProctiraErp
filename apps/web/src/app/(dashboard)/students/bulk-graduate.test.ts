import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('@/lib/api/institutions', () => ({}));
vi.mock('@/lib/institutions/api', () => ({}));
vi.mock('@/lib/api/admin.server', () => ({
  getTenantSettings: vi.fn(async () => ({
    settings: { timezone: 'Asia/Kolkata' },
    source: 'gateway',
  })),
}));
vi.mock('@/lib/api/students', () => ({
  getStudentEnrollmentsResult: vi.fn(),
  getStudentEnrollments: vi.fn(),
  bulkUpdateEnrollmentStatus: vi.fn(),
}));

import {
  bulkUpdateEnrollmentStatus,
  getStudentEnrollments,
  getStudentEnrollmentsResult,
} from '@/lib/api/students';
import { bulkGraduateStudentsAction } from './actions';
import { loadActiveEnrollments } from './_components/load-student-placement';

const sid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const eid = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('bulk graduate enrollment lookups (PRC-L247)', () => {
  beforeEach(() => {
    vi.mocked(getStudentEnrollmentsResult).mockReset();
    vi.mocked(bulkUpdateEnrollmentStatus).mockReset();
  });

  it('reports students whose enrollment lookup failed instead of dropping them', async () => {
    vi.mocked(getStudentEnrollmentsResult).mockImplementation(async (id) =>
      id === sid(2)
        ? { ok: false, status: 503 }
        : { ok: true, enrollments: [{ id: eid(1), status: 'ENROLLED' }] as never },
    );
    vi.mocked(bulkUpdateEnrollmentStatus).mockResolvedValue({
      updated: [{ id: eid(1) }] as never,
      failed: [],
    });
    const result = await bulkGraduateStudentsAction([sid(1), sid(2)]);
    expect(result.status).toBe('partial');
    expect(result.data?.lookupFailedStudentIds).toEqual([sid(2)]);
    expect(result.message).toMatch(/could not be loaded for 1 student/);
  });

  it('returns partial with per-student failures for a mixed batch (PRC-L248)', async () => {
    vi.mocked(getStudentEnrollmentsResult).mockImplementation(async (id) => ({
      ok: true,
      enrollments: [{ id: id === sid(1) ? eid(1) : eid(2), status: 'ENROLLED' }] as never,
    }));
    vi.mocked(bulkUpdateEnrollmentStatus).mockResolvedValue({
      updated: [{ id: eid(1) }] as never,
      failed: [{ enrollmentId: eid(2), code: 'INVALID_TRANSITION', message: 'Not allowed' }],
    });
    const result = await bulkGraduateStudentsAction([sid(1), sid(2)]);
    expect(result.status).toBe('partial');
    expect(result.data?.failures).toEqual([
      {
        enrollmentId: eid(2),
        studentId: sid(2),
        code: 'INVALID_TRANSITION',
        message: 'Not allowed',
      },
    ]);
  });

  it('uses the tenant-local date for effectiveDate at 23:30 UTC (PRC-L248)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-03-10T23:30:00Z'));
    try {
      vi.mocked(getStudentEnrollmentsResult).mockResolvedValue({
        ok: true,
        enrollments: [{ id: eid(1), status: 'ENROLLED' }] as never,
      });
      vi.mocked(bulkUpdateEnrollmentStatus).mockResolvedValue({ updated: [], failed: [] });
      await bulkGraduateStudentsAction([sid(1)]);
      expect(vi.mocked(bulkUpdateEnrollmentStatus).mock.calls[0]?.[0].effectiveDate).toBe(
        '2026-03-11',
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('runs lookups concurrently (bounded) and issues a single bulk call', async () => {
    let inFlight = 0;
    let peak = 0;
    vi.mocked(getStudentEnrollmentsResult).mockImplementation(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight -= 1;
      return { ok: true, enrollments: [{ id: eid(1), status: 'ENROLLED' }] as never };
    });
    vi.mocked(bulkUpdateEnrollmentStatus).mockResolvedValue({ updated: [], failed: [] });
    const ids = Array.from({ length: 30 }, (_, i) => sid(i + 1));
    await bulkGraduateStudentsAction(ids);
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(8);
    expect(bulkUpdateEnrollmentStatus).toHaveBeenCalledTimes(1);
  });
});

describe('loadActiveEnrollments (PRC-L247)', () => {
  it('still resolves the list when one lookup rejects', async () => {
    vi.mocked(getStudentEnrollments).mockImplementation(async (id) => {
      if (id === sid(2)) throw new Error('boom');
      return [{ id: eid(1), status: 'ENROLLED' }] as never;
    });
    const map = await loadActiveEnrollments([sid(1), sid(2)]);
    expect(map.get(sid(1))?.id).toBe(eid(1));
    expect(map.get(sid(2))).toBeNull();
  });
});
