import { beforeEach, describe, expect, it, vi } from 'vitest';

const listInstitutions = vi.fn();
const listAcademicPeriods = vi.fn();
const listGrades = vi.fn();
vi.mock('@/lib/api/institutions', () => ({ listInstitutions: () => listInstitutions() }));
vi.mock('@/lib/institutions/api', () => ({
  listAcademicPeriods: () => listAcademicPeriods(),
  listGrades: () => listGrades(),
}));

import { loadAdmissionsLookups } from './lookups';

describe('PRC-M150 loadAdmissionsLookups', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    listAcademicPeriods.mockResolvedValue([{ id: 'p1', name: '2025-26' }]);
    listGrades.mockResolvedValue([{ id: 'g1', name: 'Grade 1' }]);
  });

  it('reports a failed institutions read instead of returning a silent empty list', async () => {
    listInstitutions.mockRejectedValue(new Error('gateway 500'));
    const result = await loadAdmissionsLookups();
    expect(result.errors).toEqual(['institutions']);
    expect(result.institutions).toEqual([]);
    expect(result.periods).toHaveLength(1);
    expect(console.error).toHaveBeenCalled();
  });

  it('has no errors when every lookup loads', async () => {
    listInstitutions.mockResolvedValue([{ id: 'i1', name: 'School' }]);
    const result = await loadAdmissionsLookups();
    expect(result.errors).toEqual([]);
    expect(result.institutions).toEqual([{ id: 'i1', name: 'School' }]);
  });
});
