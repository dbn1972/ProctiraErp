/**
 * PRC-M070: merit list and seat matrix use the user's URL-selected scope
 * instead of silently using the first institution/period/grade.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getMeritList = vi.fn();
const listSeatMatrix = vi.fn();

vi.mock('@/lib/api/admissions', () => ({
  getMeritList: (...args: unknown[]) => getMeritList(...args),
  listApplications: vi.fn().mockResolvedValue([]),
  listSeatMatrix: (...args: unknown[]) => listSeatMatrix(...args),
}));
vi.mock('@/lib/admissions/lookups', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/admissions/lookups')>();
  return {
    ...actual,
    loadAdmissionsLookups: vi.fn().mockResolvedValue({
      institutions: [
        { id: 'inst-1', name: 'North' },
        { id: 'inst-2', name: 'South' },
      ],
      periods: [
        { id: 'per-1', name: '2025' },
        { id: 'per-2', name: '2026' },
      ],
      grades: [
        { id: 'gr-1', name: 'Grade 1' },
        { id: 'gr-2', name: 'Grade 2' },
      ],
    }),
  };
});
vi.mock('./_components/admissions-chrome', () => ({ AdmissionsChrome: () => null }));
vi.mock('./_components/merit-panel', () => ({ MeritPanel: () => null }));
vi.mock('./_components/seat-matrix-panel', () => ({ SeatMatrixPanel: () => null }));

import { pickSelectedLookup } from '@/lib/admissions/lookups';
import AdmissionsMeritPage from './merit/page';
import AdmissionsSeatMatrixPage from './seat-matrix/page';

describe('admissions scope selection (PRC-M070)', () => {
  beforeEach(() => {
    getMeritList.mockReset().mockResolvedValue({ entries: [] });
    listSeatMatrix.mockReset().mockResolvedValue([]);
  });

  it('generates the merit list for the selected second institution', async () => {
    await AdmissionsMeritPage({
      searchParams: Promise.resolve({
        institutionId: 'inst-2',
        academicPeriodId: 'per-2',
        gradeId: 'gr-2',
      }),
    });
    expect(getMeritList).toHaveBeenCalledWith({
      institutionId: 'inst-2',
      academicPeriodId: 'per-2',
      gradeId: 'gr-2',
    });
  });

  it('seat matrix filter reflects the selected institution', async () => {
    await AdmissionsSeatMatrixPage({ searchParams: Promise.resolve({ institutionId: 'inst-2' }) });
    expect(listSeatMatrix).toHaveBeenCalledWith({ institutionId: 'inst-2' });
  });

  it('ignores unknown ids and falls back to the first option', () => {
    const options = [{ id: 'a' }, { id: 'b' }];
    expect(pickSelectedLookup(options, 'zzz')).toBe('a');
    expect(pickSelectedLookup(options, ['b'])).toBe('b');
    expect(pickSelectedLookup([], 'b')).toBeUndefined();
  });
});
